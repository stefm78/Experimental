const BUILD_ID = '2026-08-31.android-diag-v3';
const DIAGNOSTIC_SCHEMA = 'offline-interview.diagnostic.v1';
const TRANSFORMERS_VERSION = '4.2.0';
const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;
const MODEL_ID = 'onnx-community/whisper-tiny';
const DB_NAME = 'offline-interview';
const DB_VERSION = 1;
const STATE_KEY = 'current-session';

const $ = id => document.getElementById(id);
const ui = {
  setupView: $('setupView'), interviewView: $('interviewView'), doneView: $('doneView'),
  networkBadge: $('networkBadge'), swStatus: $('swStatus'), storageStatus: $('storageStatus'), modelStatus: $('modelStatus'),
  progressBlock: $('progressBlock'), progressLabel: $('progressLabel'), progressValue: $('progressValue'), modelProgress: $('modelProgress'), setupError: $('setupError'),
  prepareBtn: $('prepareBtn'), resumeBtn: $('resumeBtn'), interviewTitle: $('interviewTitle'), questionCounter: $('questionCounter'), questionProgress: $('questionProgress'), questionText: $('questionText'),
  recordState: $('recordState'), timer: $('timer'), recordBtn: $('recordBtn'), stopBtn: $('stopBtn'), transcribing: $('transcribing'), answerText: $('answerText'), answerMeta: $('answerMeta'), interviewError: $('interviewError'),
  prevBtn: $('prevBtn'), retryBtn: $('retryBtn'), validateBtn: $('validateBtn'), homeBtn: $('homeBtn'), doneSummary: $('doneSummary'), reviewBtn: $('reviewBtn'), exportTxtBtn: $('exportTxtBtn'), exportJsonBtn: $('exportJsonBtn'), newSessionBtn: $('newSessionBtn'),
  diagBuild: $('diagBuild'), diagNetwork: $('diagNetwork'), diagSw: $('diagSw'), diagPersist: $('diagPersist'), diagStage: $('diagStage'),
  copyDiagBtn: $('copyDiagBtn'), copyDiagStatus: $('copyDiagStatus'), diagnosticOutput: $('diagnosticOutput')
};

let interview;
let session;
let transcriber;
let recorder;
let stream;
let chunks = [];
let startedRecordingAt = 0;
let timerHandle;
let lastRecordingDuration = 0;
let db;
let currentDiagStage = 'boot';
let lastDiagnosticError = null;
let lastProgressBucket = -1;
const diagnosticEvents = [];

function diagEvent(stage, status, detail = null) {
  const entry = {
    at: new Date().toISOString(),
    stage,
    status,
    detail: detail == null ? null : String(detail).slice(0, 1200)
  };
  diagnosticEvents.push(entry);
  if (diagnosticEvents.length > 120) diagnosticEvents.shift();
  currentDiagStage = stage;
  if (ui.diagStage) ui.diagStage.textContent = `${stage} · ${status}`;
}

function diagError(stage, error) {
  lastDiagnosticError = {
    at: new Date().toISOString(),
    stage,
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: error?.stack ? String(error.stack).slice(0, 8000) : null
  };
  diagEvent(stage, 'ERROR', lastDiagnosticError.message);
}

window.addEventListener('error', event => {
  diagError('window.error', event.error || event.message);
});
window.addEventListener('unhandledrejection', event => {
  diagError('window.unhandledrejection', event.reason || 'Unhandled rejection');
});

function show(el, visible = true) { el.classList.toggle('hidden', !visible); }
function showError(el, message = '') { el.textContent = message; show(el, Boolean(message)); }
function setView(name) {
  show(ui.setupView, name === 'setup');
  show(ui.interviewView, name === 'interview');
  show(ui.doneView, name === 'done');
}
function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function updateNetwork() {
  const offline = !navigator.onLine;
  ui.networkBadge.textContent = offline ? 'Hors connexion' : 'En ligne';
  ui.networkBadge.className = `badge ${offline ? 'offline' : 'online'}`;
  ui.diagNetwork.textContent = offline ? 'hors connexion' : 'en ligne';
}

async function modelRangeProbe(filename) {
  if (!navigator.onLine) {
    diagEvent(`range-probe:${filename}`, 'SKIP', 'offline');
    return { filename, skipped: 'offline' };
  }
  const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${filename}`;
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      cache: 'no-store'
    });
    const result = {
      filename,
      status: response.status,
      ok: response.ok,
      contentRange: response.headers.get('content-range'),
      contentLength: response.headers.get('content-length'),
      type: response.type,
      elapsedMs: Math.round(performance.now() - started)
    };
    try { await response.body?.cancel(); } catch {}
    diagEvent(`range-probe:${filename}`, response.ok ? 'PASS' : 'FAIL', JSON.stringify(result));
    return result;
  } catch (error) {
    diagError(`range-probe:${filename}`, error);
    return { filename, error: String(error?.message || error) };
  }
}

async function cacheDiagnostics() {
  if (!('caches' in window)) return { supported: false };
  try {
    const names = await caches.keys();
    const entries = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      entries.push({
        name,
        count: requests.length,
        sample: requests.slice(0, 20).map(request => {
          try {
            const u = new URL(request.url);
            return `${u.hostname}${u.pathname}`;
          } catch {
            return request.url;
          }
        })
      });
    }
    return { supported: true, entries };
  } catch (error) {
    return { supported: true, error: String(error?.message || error) };
  }
}

async function serviceWorkerDiagnostics() {
  if (!('serviceWorker' in navigator)) return { supported: false };
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    return {
      supported: true,
      controller: navigator.serviceWorker.controller ? {
        scriptURL: navigator.serviceWorker.controller.scriptURL,
        state: navigator.serviceWorker.controller.state
      } : null,
      registration: reg ? {
        scope: reg.scope,
        active: reg.active ? { scriptURL: reg.active.scriptURL, state: reg.active.state } : null,
        waiting: reg.waiting ? { scriptURL: reg.waiting.scriptURL, state: reg.waiting.state } : null,
        installing: reg.installing ? { scriptURL: reg.installing.scriptURL, state: reg.installing.state } : null
      } : null
    };
  } catch (error) {
    return { supported: true, error: String(error?.message || error) };
  }
}

async function collectDiagnosticReport() {
  let storage = {};
  try {
    storage.persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    storage.estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch (error) {
    storage.error = String(error?.message || error);
  }

  let microphonePermission = 'unknown';
  try {
    if (navigator.permissions?.query) {
      microphonePermission = (await navigator.permissions.query({ name: 'microphone' })).state;
    }
  } catch {}

  const uaData = navigator.userAgentData ? {
    mobile: navigator.userAgentData.mobile,
    platform: navigator.userAgentData.platform,
    brands: navigator.userAgentData.brands
  } : null;

  return {
    schema: DIAGNOSTIC_SCHEMA,
    generatedAt: new Date().toISOString(),
    privacy: 'No audio and no interview answer text included.',
    app: {
      build: BUILD_ID,
      url: location.origin + location.pathname,
      secureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated
    },
    runtime: {
      transformersVersion: TRANSFORMERS_VERSION,
      transformersUrl: TRANSFORMERS_URL,
      modelId: MODEL_ID,
      modelDtype: 'q4',
      requestedDevice: 'wasm',
      currentStage: currentDiagStage
    },
    browser: {
      userAgent: navigator.userAgent,
      userAgentData: uaData,
      language: navigator.language,
      languages: navigator.languages,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      online: navigator.onLine,
      visibilityState: document.visibilityState
    },
    capabilities: {
      WebAssembly: typeof WebAssembly !== 'undefined',
      SharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      AudioContext: Boolean(window.AudioContext || window.webkitAudioContext),
      OfflineAudioContext: typeof OfflineAudioContext !== 'undefined',
      MediaRecorder: typeof MediaRecorder !== 'undefined',
      mediaDevices: Boolean(navigator.mediaDevices),
      getUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      indexedDB: typeof indexedDB !== 'undefined',
      CacheStorage: 'caches' in window,
      serviceWorker: 'serviceWorker' in navigator,
      microphonePermission,
      mediaRecorderTypes: typeof MediaRecorder !== 'undefined' ? {
        webmOpus: MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ?? null,
        webm: MediaRecorder.isTypeSupported?.('audio/webm') ?? null,
        mp4: MediaRecorder.isTypeSupported?.('audio/mp4') ?? null
      } : null
    },
    storage,
    serviceWorker: await serviceWorkerDiagnostics(),
    caches: await cacheDiagnostics(),
    ui: {
      swStatus: ui.swStatus?.textContent || null,
      storageStatus: ui.storageStatus?.textContent || null,
      modelStatus: ui.modelStatus?.textContent || null,
      modelProgress: ui.modelProgress?.value ?? null,
      setupError: ui.setupError && !ui.setupError.classList.contains('hidden') ? ui.setupError.textContent : null,
      interviewError: ui.interviewError && !ui.interviewError.classList.contains('hidden') ? ui.interviewError.textContent : null
    },
    lastError: lastDiagnosticError,
    events: diagnosticEvents.slice(-100)
  };
}

async function copyDiagnosticReport() {
  ui.copyDiagBtn.disabled = true;
  ui.copyDiagStatus.textContent = 'Génération du rapport…';
  try {
    const report = await collectDiagnosticReport();
    const text = `OFFLINE_INTERVIEW_DIAGNOSTIC\n${JSON.stringify(report, null, 2)}`;
    ui.diagnosticOutput.value = text;
    show(ui.diagnosticOutput, true);

    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      ui.diagnosticOutput.focus();
      ui.diagnosticOutput.select();
      copied = document.execCommand?.('copy') || false;
      ui.diagnosticOutput.setSelectionRange(0, 0);
    }
    ui.copyDiagStatus.textContent = copied
      ? 'Diagnostic copié. Collez-le tel quel dans ChatGPT.'
      : 'Copie automatique refusée : sélectionnez le rapport ci-dessous et copiez-le.';
  } catch (error) {
    diagError('diagnostic.generate', error);
    ui.copyDiagStatus.textContent = `Échec du diagnostic : ${error.message || error}`;
  } finally {
    ui.copyDiagBtn.disabled = false;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function dbGet(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function saveSession() { if (session) await dbPut(STATE_KEY, session); }

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    ui.swStatus.textContent = 'Non supporté';
    ui.diagSw.textContent = 'non supporté';
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    ui.swStatus.textContent = 'Mis en cache';
    ui.diagSw.textContent = reg.active ? 'actif' : 'installé';
    return true;
  } catch (error) {
    ui.swStatus.textContent = 'Erreur';
    ui.diagSw.textContent = String(error.message || error);
    return false;
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    ui.storageStatus.textContent = 'Standard';
    ui.diagPersist.textContent = 'API indisponible';
    return false;
  }
  const already = await navigator.storage.persisted();
  const persisted = already || await navigator.storage.persist();
  ui.storageStatus.textContent = persisted ? 'Persistant' : 'Navigateur';
  ui.diagPersist.textContent = persisted ? 'accordé' : 'non garanti';
  return persisted;
}

function progressCallback(item) {
  show(ui.progressBlock, true);
  if (item.status === 'progress' && typeof item.progress === 'number') {
    const value = Math.max(0, Math.min(100, item.progress));
    ui.modelProgress.value = value;
    ui.progressValue.textContent = `${Math.round(value)} %`;
    ui.progressLabel.textContent = item.file ? `Chargement ${item.file.split('/').pop()}` : 'Chargement du modèle';
  } else if (item.status === 'ready') {
    ui.progressLabel.textContent = 'Ressource prête';
  } else if (item.status === 'initiate') {
    ui.progressLabel.textContent = item.file ? `Préparation ${item.file.split('/').pop()}` : 'Préparation';
  }
}

async function prepareModel() {
  if (transcriber) return transcriber;
  if (!navigator.onLine) ui.modelStatus.textContent = 'Chargement depuis cache…';
  else ui.modelStatus.textContent = 'Téléchargement…';
  showError(ui.setupError);
  ui.prepareBtn.disabled = true;
  show(ui.progressBlock, true);
  try {
    const {
      AutoTokenizer,
      AutoProcessor,
      WhisperForConditionalGeneration,
      AutomaticSpeechRecognitionPipeline,
      env
    } = await import(TRANSFORMERS_URL);

    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.allowRemoteModels = true;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

    // Do not rely on pipeline() auto-detection here. On the Android POC,
    // Transformers.js 4.2.0 created an ASR pipeline with processor === null,
    // which only failed later at transcription time on processor.feature_extractor.
    // Bind all Whisper components explicitly and fail during preparation instead.
    const progressOptions = { progress_callback: progressCallback };
    const [tokenizer, processor, model] = await Promise.all([
      AutoTokenizer.from_pretrained(MODEL_ID, progressOptions),
      AutoProcessor.from_pretrained(MODEL_ID, progressOptions),
      WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: progressCallback
      })
    ]);

    if (!processor?.feature_extractor) {
      await model?.dispose?.();
      throw new Error('Processeur Whisper incomplet : feature_extractor absent');
    }

    // Cheap readiness probe: exercise the actual feature extractor before
    // announcing that the STT engine is ready.
    const probe = await processor(new Float32Array(1600));
    if (!probe?.input_features) {
      await model?.dispose?.();
      throw new Error('Processeur Whisper invalide : input_features absent');
    }

    transcriber = new AutomaticSpeechRecognitionPipeline({
      task: 'automatic-speech-recognition',
      model,
      tokenizer,
      processor
    });

    ui.modelProgress.value = 100;
    ui.progressValue.textContent = '100 %';
    ui.progressLabel.textContent = 'Moteur prêt';
    ui.modelStatus.textContent = 'Prêt hors ligne';
    return transcriber;
  } catch (error) {
    transcriber = null;
    ui.modelStatus.textContent = 'Échec';
    showError(ui.setupError, `Impossible de préparer le moteur STT : ${error.message || error}`);
    throw error;
  } finally {
    ui.prepareBtn.disabled = false;
  }
}

function newSession() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`,
    interviewId: interview.id,
    interviewVersion: interview.version,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentIndex: 0,
    completed: false,
    answers: {}
  };
}

function currentQuestion() { return interview.questions[session.currentIndex]; }
function renderQuestion() {
  const q = currentQuestion();
  if (!q) return finishInterview();
  setView('interview');
  ui.interviewTitle.textContent = interview.title.toUpperCase();
  ui.questionCounter.textContent = `Question ${session.currentIndex + 1} / ${interview.questions.length}`;
  ui.questionProgress.max = interview.questions.length;
  ui.questionProgress.value = session.currentIndex + 1;
  ui.questionText.textContent = q.text;
  const answer = session.answers[q.id];
  ui.answerText.value = answer?.text || answer?.draft || '';
  lastRecordingDuration = answer?.durationSeconds || 0;
  ui.answerMeta.textContent = answer?.validatedAt ? `Réponse validée · ${Math.round(answer.durationSeconds || 0)} s d'enregistrement` : '';
  ui.prevBtn.disabled = session.currentIndex === 0;
  ui.validateBtn.textContent = session.currentIndex === interview.questions.length - 1 ? 'Valider et terminer ✓' : 'Valider et continuer →';
  ui.recordState.textContent = 'Prêt à enregistrer';
  ui.timer.textContent = '00:00';
  showError(ui.interviewError);
}

async function startInterview() {
  if (!session || session.completed || session.interviewId !== interview.id) session = newSession();
  await saveSession();
  renderQuestion();
}

function preferredMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

async function startRecording() {
  showError(ui.interviewError);
  if (!transcriber) {
    try { await prepareModel(); }
    catch { showError(ui.interviewError, 'Le moteur STT n’est pas disponible. Revenez à l’accueil et relancez la préparation en ligne.'); return; }
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const mimeType = preferredMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = handleRecordingStopped;
    recorder.start(500);
    startedRecordingAt = performance.now();
    ui.recordBtn.setAttribute('aria-pressed', 'true');
    show(ui.recordBtn, false); show(ui.stopBtn, true);
    ui.recordState.textContent = 'Enregistrement en cours…';
    timerHandle = setInterval(() => { ui.timer.textContent = formatTime((performance.now() - startedRecordingAt) / 1000); }, 250);
  } catch (error) {
    showError(ui.interviewError, `Accès au microphone impossible : ${error.message || error}`);
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  lastRecordingDuration = (performance.now() - startedRecordingAt) / 1000;
  clearInterval(timerHandle);
  recorder.stop();
  stream?.getTracks().forEach(track => track.stop());
  show(ui.stopBtn, false); show(ui.recordBtn, true);
  ui.recordBtn.setAttribute('aria-pressed', 'false');
  ui.recordState.textContent = 'Enregistrement terminé';
}

async function blobTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const offline = new OfflineAudioContext(1, frames, 16000);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  const samples = new Float32Array(rendered.getChannelData(0));
  await context.close();
  return samples;
}

async function handleRecordingStopped() {
  if (!chunks.length) return;
  show(ui.transcribing, true);
  ui.recordBtn.disabled = true;
  ui.validateBtn.disabled = true;
  try {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const samples = await blobTo16kMono(blob);
    const result = await transcriber(samples, {
      language: 'french',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5
    });
    const text = (result?.text || '').trim();
    ui.answerText.value = text;
    const q = currentQuestion();
    session.answers[q.id] = {
      ...(session.answers[q.id] || {}),
      draft: text,
      durationSeconds: Math.round(lastRecordingDuration * 10) / 10,
      transcribedAt: new Date().toISOString()
    };
    session.updatedAt = new Date().toISOString();
    await saveSession();
    ui.answerMeta.textContent = `Transcription locale · ${Math.round(lastRecordingDuration)} s d'enregistrement`;
    ui.recordState.textContent = 'Transcription terminée';
  } catch (error) {
    showError(ui.interviewError, `La transcription a échoué : ${error.message || error}`);
    ui.recordState.textContent = 'Transcription en échec';
  } finally {
    chunks = [];
    show(ui.transcribing, false);
    ui.recordBtn.disabled = false;
    ui.validateBtn.disabled = false;
  }
}

async function saveDraft() {
  if (!session || session.completed) return;
  const q = currentQuestion();
  if (!q) return;
  const existing = session.answers[q.id] || {};
  session.answers[q.id] = { ...existing, draft: ui.answerText.value, durationSeconds: existing.durationSeconds || lastRecordingDuration };
  session.updatedAt = new Date().toISOString();
  await saveSession();
}

async function validateCurrent() {
  const text = ui.answerText.value.trim();
  if (!text) { showError(ui.interviewError, 'Ajoutez une réponse avant de valider.'); return; }
  const q = currentQuestion();
  const existing = session.answers[q.id] || {};
  session.answers[q.id] = {
    ...existing,
    text,
    draft: text,
    durationSeconds: existing.durationSeconds || lastRecordingDuration || 0,
    validatedAt: new Date().toISOString()
  };
  session.updatedAt = new Date().toISOString();
  if (session.currentIndex >= interview.questions.length - 1) {
    session.completed = true;
    session.completedAt = new Date().toISOString();
    await saveSession();
    finishInterview();
  } else {
    session.currentIndex += 1;
    await saveSession();
    renderQuestion();
  }
}

async function goPrevious() {
  await saveDraft();
  if (session.currentIndex > 0) session.currentIndex -= 1;
  await saveSession();
  renderQuestion();
}

async function retryAnswer() {
  const q = currentQuestion();
  session.answers[q.id] = {};
  ui.answerText.value = '';
  ui.answerMeta.textContent = '';
  lastRecordingDuration = 0;
  await saveSession();
  await startRecording();
}

function finishInterview() {
  setView('done');
  const answered = interview.questions.filter(q => session.answers[q.id]?.text).length;
  ui.doneSummary.textContent = `${answered} réponse${answered > 1 ? 's' : ''} sur ${interview.questions.length}. Session commencée le ${new Date(session.startedAt).toLocaleString('fr-FR')}.`;
}

function exportPayload() {
  return {
    schemaVersion: '1.0',
    exportedAt: new Date().toISOString(),
    interview: { id: interview.id, version: interview.version, title: interview.title },
    session: { id: session.id, startedAt: session.startedAt, completedAt: session.completedAt || null },
    responses: interview.questions.map((q, index) => ({
      order: index + 1,
      questionId: q.id,
      question: q.text,
      answer: session.answers[q.id]?.text || session.answers[q.id]?.draft || '',
      durationSeconds: session.answers[q.id]?.durationSeconds || 0,
      validatedAt: session.answers[q.id]?.validatedAt || null
    }))
  };
}
function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJson() {
  download(`interview-${session.id}.json`, 'application/json;charset=utf-8', JSON.stringify(exportPayload(), null, 2));
}
function exportTxt() {
  const p = exportPayload();
  const lines = [p.interview.title, `Session : ${p.session.id}`, `Début : ${p.session.startedAt}`, ''];
  for (const r of p.responses) lines.push(`Q${r.order} — ${r.question}`, '', r.answer || '[Sans réponse]', '', '---', '');
  download(`interview-${session.id}.txt`, 'text/plain;charset=utf-8', lines.join('\n'));
}

async function resetSession() {
  if (!confirm('Effacer toutes les réponses de cette session sur cet appareil ?')) return;
  await dbDelete(STATE_KEY);
  session = null;
  ui.resumeBtn.classList.add('hidden');
  setView('setup');
}

async function init() {
  updateNetwork();
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  interview = await fetch('./interview.json').then(r => { if (!r.ok) throw new Error('Questionnaire introuvable'); return r.json(); });
  db = await openDb();
  session = await dbGet(STATE_KEY);
  if (session && session.interviewId === interview.id) {
    ui.resumeBtn.textContent = session.completed ? 'Voir le dernier entretien' : `Reprendre · question ${session.currentIndex + 1}/${interview.questions.length}`;
    show(ui.resumeBtn, true);
  }
  await Promise.allSettled([registerServiceWorker(), requestPersistentStorage()]);
}

ui.prepareBtn.addEventListener('click', async () => {
  try { await prepareModel(); await startInterview(); } catch { /* surfaced in UI */ }
});
ui.resumeBtn.addEventListener('click', async () => {
  try {
    await prepareModel();
    if (session.completed) finishInterview(); else renderQuestion();
  } catch { /* surfaced */ }
});
ui.homeBtn.addEventListener('click', async () => { await saveDraft(); setView('setup'); });
ui.recordBtn.addEventListener('click', startRecording);
ui.stopBtn.addEventListener('click', stopRecording);
ui.retryBtn.addEventListener('click', retryAnswer);
ui.validateBtn.addEventListener('click', validateCurrent);
ui.prevBtn.addEventListener('click', goPrevious);
ui.answerText.addEventListener('change', saveDraft);
ui.reviewBtn.addEventListener('click', () => { session.completed = false; session.currentIndex = 0; renderQuestion(); });
ui.exportTxtBtn.addEventListener('click', exportTxt);
ui.exportJsonBtn.addEventListener('click', exportJson);
ui.newSessionBtn.addEventListener('click', resetSession);

init().catch(error => {
  ui.swStatus.textContent = 'Erreur initialisation';
  showError(ui.setupError, `Initialisation impossible : ${error.message || error}`);
});

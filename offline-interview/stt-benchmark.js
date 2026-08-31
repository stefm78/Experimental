const BUILD_ID = '2026-08-31.stt-benchmark-v1';
const TRANSFORMERS_VERSION = '4.2.0';
const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

const MODELS = {
  tiny: {
    key: 'tiny',
    label: 'Tiny q4',
    id: 'onnx-community/whisper-tiny',
    role: 'baseline'
  },
  base: {
    key: 'base',
    label: 'Base q4',
    id: 'onnx-community/whisper-base',
    role: 'candidate'
  },
  small: {
    key: 'small',
    label: 'Small q4',
    id: 'onnx-community/whisper-small',
    role: 'upper-bound'
  }
};

const $ = id => document.getElementById(id);
const ui = {
  referenceText: $('referenceText'),
  recordState: $('recordState'),
  timer: $('timer'),
  recordBtn: $('recordBtn'),
  stopBtn: $('stopBtn'),
  audioMeta: $('audioMeta'),
  audioError: $('audioError'),
  benchmarkError: $('benchmarkError'),
  runBtn: $('runBtn'),
  cancelBtn: $('cancelBtn'),
  resultsCard: $('resultsCard'),
  resultsGrid: $('resultsGrid'),
  runStatus: $('runStatus'),
  copyResultsBtn: $('copyResultsBtn'),
  rerunBtn: $('rerunBtn'),
  copyStatus: $('copyStatus'),
  resultsOutput: $('resultsOutput'),
  buildInfo: $('buildInfo'),
  browserInfo: $('browserInfo'),
  memoryInfo: $('memoryInfo'),
  networkInfo: $('networkInfo'),
  swInfo: $('swInfo'),
  storageInfo: $('storageInfo'),
  modelTiny: $('modelTiny'),
  modelBase: $('modelBase'),
  modelSmall: $('modelSmall')
};

let mediaRecorder = null;
let mediaStream = null;
let recordedChunks = [];
let recordingStartedAt = 0;
let timerHandle = null;
let audioSamples = null;
let audioDurationSeconds = 0;
let transformersModule = null;
let runAbortRequested = false;
let latestReport = null;

function show(el, visible = true) {
  el.classList.toggle('hidden', !visible);
}

function showError(el, message = '') {
  el.textContent = message;
  show(el, Boolean(message));
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function selectedModelKeys() {
  return [
    ui.modelTiny.checked ? 'tiny' : null,
    ui.modelBase.checked ? 'base' : null,
    ui.modelSmall.checked ? 'small' : null
  ].filter(Boolean);
}

function updateRunButton() {
  ui.runBtn.disabled = !audioSamples || selectedModelKeys().length === 0;
}

function preferredMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
  return candidates.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
}

async function blobTo16kMono(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
    const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    await context.close();
  }
}

async function startRecording() {
  showError(ui.audioError);
  ui.audioMeta.textContent = '';
  ui.runBtn.disabled = true;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1
      }
    });

    const mimeType = preferredMimeType();
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);

    recordedChunks = [];
    mediaRecorder.ondataavailable = event => {
      if (event.data?.size) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = handleRecordingStopped;
    mediaRecorder.start(500);

    recordingStartedAt = performance.now();
    ui.recordState.textContent = 'Enregistrement en cours…';
    ui.timer.textContent = '00:00';
    show(ui.recordBtn, false);
    show(ui.stopBtn, true);

    timerHandle = setInterval(() => {
      ui.timer.textContent = formatTime((performance.now() - recordingStartedAt) / 1000);
    }, 250);
  } catch (error) {
    showError(ui.audioError, `Accès au microphone impossible : ${error.message || error}`);
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  clearInterval(timerHandle);
  mediaRecorder.stop();
  mediaStream?.getTracks().forEach(track => track.stop());
  show(ui.stopBtn, false);
  show(ui.recordBtn, true);
  ui.recordState.textContent = 'Préparation du signal audio…';
}

async function handleRecordingStopped() {
  try {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    const samples = await blobTo16kMono(blob);
    if (samples.length < 16000 * 3) {
      throw new Error('Enregistrement trop court : lisez au moins quelques phrases du texte.');
    }

    audioSamples = samples;
    audioDurationSeconds = samples.length / 16000;
    recordedChunks = [];
    ui.recordState.textContent = 'Audio de référence prêt';
    ui.timer.textContent = formatTime(audioDurationSeconds);
    ui.audioMeta.textContent = `${audioDurationSeconds.toFixed(1)} s · mono · 16 kHz · conservé uniquement en mémoire`;
    updateRunButton();
  } catch (error) {
    audioSamples = null;
    audioDurationSeconds = 0;
    showError(ui.audioError, `Préparation audio impossible : ${error.message || error}`);
    ui.recordState.textContent = 'Échec de préparation audio';
    updateRunButton();
  }
}

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordErrorRate(reference, hypothesis) {
  const ref = normalizeText(reference).split(' ').filter(Boolean);
  const hyp = normalizeText(hypothesis).split(' ').filter(Boolean);
  if (!ref.length) return null;

  const previous = new Array(hyp.length + 1);
  const current = new Array(hyp.length + 1);
  for (let j = 0; j <= hyp.length; j++) previous[j] = j;

  for (let i = 1; i <= ref.length; i++) {
    current[0] = i;
    for (let j = 1; j <= hyp.length; j++) {
      const substitution = previous[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const insertion = current[j - 1] + 1;
      const deletion = previous[j] + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    for (let j = 0; j <= hyp.length; j++) previous[j] = current[j];
  }

  return {
    distance: previous[hyp.length],
    referenceWords: ref.length,
    hypothesisWords: hyp.length,
    wer: previous[hyp.length] / ref.length
  };
}

async function storageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return {
      usage: estimate?.usage ?? null,
      quota: estimate?.quota ?? null,
      caches: estimate?.usageDetails?.caches ?? null,
      indexedDB: estimate?.usageDetails?.indexedDB ?? null
    };
  } catch {
    return { usage: null, quota: null, caches: null, indexedDB: null };
  }
}

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = Math.abs(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const sign = bytes < 0 ? '-' : '';
  return `${sign}${value.toFixed(unit < 2 ? 0 : 1)} ${units[unit]}`;
}

function modelResultCard(spec) {
  let card = document.getElementById(`result-${spec.key}`);
  if (card) return card;

  card = document.createElement('article');
  card.id = `result-${spec.key}`;
  card.className = 'benchmark-result';
  card.innerHTML = `
    <div class="benchmark-result-head">
      <div><strong>${spec.label}</strong><small>${spec.id}</small></div>
      <span class="badge" data-role="status">En attente</span>
    </div>
    <div class="benchmark-metrics">
      <div><span>Chargement</span><strong data-role="load">—</strong></div>
      <div><span>Transcription</span><strong data-role="inference">—</strong></div>
      <div><span>Temps réel</span><strong data-role="rtf">—</strong></div>
      <div><span>WER</span><strong data-role="wer">—</strong></div>
      <div><span>Cache ajouté</span><strong data-role="cache">—</strong></div>
    </div>
    <p class="hint" data-role="progress"></p>
    <label>Transcription</label>
    <textarea rows="6" readonly data-role="text" spellcheck="false"></textarea>
  `;
  ui.resultsGrid.appendChild(card);
  return card;
}

function setModelStatus(spec, status, detail = '') {
  const card = modelResultCard(spec);
  const badge = card.querySelector('[data-role="status"]');
  badge.textContent = status;
  card.querySelector('[data-role="progress"]').textContent = detail;
}

function updateResultCard(spec, result) {
  const card = modelResultCard(spec);
  card.querySelector('[data-role="status"]').textContent = result.ok ? 'Terminé' : 'Échec';
  card.querySelector('[data-role="load"]').textContent = result.loadMs != null ? `${(result.loadMs / 1000).toFixed(1)} s` : '—';
  card.querySelector('[data-role="inference"]').textContent = result.inferenceMs != null ? `${(result.inferenceMs / 1000).toFixed(1)} s` : '—';
  card.querySelector('[data-role="rtf"]').textContent = result.realTimeFactor != null ? `${result.realTimeFactor.toFixed(2)}×` : '—';
  card.querySelector('[data-role="wer"]').textContent = result.wer != null ? `${(result.wer * 100).toFixed(1)} %` : '—';
  card.querySelector('[data-role="cache"]').textContent = result.cacheDeltaBytes != null ? formatBytes(result.cacheDeltaBytes) : '—';
  card.querySelector('[data-role="progress"]').textContent = result.error || (result.ok ? 'Même audio source que les autres modèles.' : '');
  card.querySelector('[data-role="text"]').value = result.transcript || '';
}

async function loadTransformers() {
  if (transformersModule) return transformersModule;
  transformersModule = await import(TRANSFORMERS_URL);
  const { env } = transformersModule;
  env.useBrowserCache = true;
  env.useWasmCache = true;
  env.allowRemoteModels = true;
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
  return transformersModule;
}

async function loadAsrPipeline(spec, progress) {
  const {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    AutomaticSpeechRecognitionPipeline
  } = await loadTransformers();

  const options = {
    progress_callback: item => progress?.(item)
  };

  const tokenizer = await AutoTokenizer.from_pretrained(spec.id, options);
  const processor = await AutoProcessor.from_pretrained(spec.id, options);
  if (!processor?.feature_extractor) {
    throw new Error('feature_extractor absent');
  }

  const model = await WhisperForConditionalGeneration.from_pretrained(spec.id, {
    device: 'wasm',
    dtype: 'q4',
    progress_callback: item => progress?.(item)
  });

  const probe = await processor(new Float32Array(1600));
  if (!probe?.input_features) {
    await model.dispose?.();
    throw new Error('input_features absent lors du probe');
  }

  return new AutomaticSpeechRecognitionPipeline({
    task: 'automatic-speech-recognition',
    model,
    tokenizer,
    processor
  });
}

async function runOneModel(spec) {
  const result = {
    key: spec.key,
    label: spec.label,
    modelId: spec.id,
    ok: false,
    loadMs: null,
    inferenceMs: null,
    realTimeFactor: null,
    wer: null,
    wordDistance: null,
    referenceWords: null,
    hypothesisWords: null,
    cacheDeltaBytes: null,
    transcript: '',
    error: null
  };

  const storageBefore = await storageUsage();
  let pipeline = null;
  try {
    setModelStatus(spec, 'Chargement', navigator.onLine ? 'Téléchargement ou lecture du cache…' : 'Lecture du cache local…');
    const loadStarted = performance.now();
    let lastProgress = -1;

    pipeline = await loadAsrPipeline(spec, item => {
      if (item.status === 'progress' && typeof item.progress === 'number') {
        const rounded = Math.floor(item.progress / 10) * 10;
        if (rounded !== lastProgress) {
          lastProgress = rounded;
          const file = item.file ? item.file.split('/').pop() : 'ressource';
          setModelStatus(spec, 'Chargement', `${file} · ${rounded} %`);
        }
      }
    });

    result.loadMs = performance.now() - loadStarted;

    setModelStatus(spec, 'Transcription', `${audioDurationSeconds.toFixed(1)} s d'audio…`);
    const inferenceStarted = performance.now();
    const output = await pipeline(audioSamples, {
      language: 'french',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5
    });
    result.inferenceMs = performance.now() - inferenceStarted;
    result.transcript = String(output?.text || '').trim();
    result.realTimeFactor = (result.inferenceMs / 1000) / audioDurationSeconds;

    const score = wordErrorRate(ui.referenceText.textContent, result.transcript);
    if (score) {
      result.wer = score.wer;
      result.wordDistance = score.distance;
      result.referenceWords = score.referenceWords;
      result.hypothesisWords = score.hypothesisWords;
    }

    result.ok = true;
  } catch (error) {
    result.error = `${error?.name || 'Error'}: ${error?.message || error}`;
  } finally {
    if (pipeline) {
      try {
        await pipeline.dispose();
      } catch {}
    }
    pipeline = null;

    await new Promise(resolve => setTimeout(resolve, 400));
    const storageAfter = await storageUsage();
    if (storageBefore.usage != null && storageAfter.usage != null) {
      result.cacheDeltaBytes = storageAfter.usage - storageBefore.usage;
    }
  }

  updateResultCard(spec, result);
  return result;
}

async function runBenchmark() {
  const keys = selectedModelKeys();
  if (!audioSamples || !keys.length) return;

  showError(ui.benchmarkError);
  show(ui.resultsCard, true);
  ui.resultsGrid.innerHTML = '';
  ui.runBtn.disabled = true;
  ui.recordBtn.disabled = true;
  ui.modelTiny.disabled = true;
  ui.modelBase.disabled = true;
  ui.modelSmall.disabled = true;
  show(ui.cancelBtn, true);
  runAbortRequested = false;
  ui.runStatus.textContent = 'En cours';

  const startedAt = new Date().toISOString();
  const results = [];

  for (const key of keys) {
    if (runAbortRequested) break;
    const spec = MODELS[key];
    modelResultCard(spec);
    const result = await runOneModel(spec);
    results.push(result);
  }

  const completed = !runAbortRequested && results.length === keys.length;
  ui.runStatus.textContent = completed ? 'Terminé' : 'Arrêté';
  show(ui.cancelBtn, false);
  ui.recordBtn.disabled = false;
  ui.modelTiny.disabled = false;
  ui.modelBase.disabled = false;
  ui.modelSmall.disabled = false;
  updateRunButton();

  latestReport = {
    schema: 'offline-interview.stt-benchmark.v1',
    build: BUILD_ID,
    generatedAt: new Date().toISOString(),
    startedAt,
    privacy: 'No audio included. Benchmark transcripts are included.',
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform || navigator.platform,
      mobile: navigator.userAgentData?.mobile ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      online: navigator.onLine,
      crossOriginIsolated: window.crossOriginIsolated,
      transformersVersion: TRANSFORMERS_VERSION,
      backend: 'wasm',
      dtype: 'q4'
    },
    audio: {
      durationSeconds: Number(audioDurationSeconds.toFixed(3)),
      sampleRate: 16000,
      samples: audioSamples.length
    },
    referenceText: ui.referenceText.textContent.trim(),
    modelsRequested: keys,
    completed,
    results
  };
}

async function copyResults() {
  if (!latestReport) {
    ui.copyStatus.textContent = 'Aucun benchmark terminé à copier.';
    return;
  }

  const text = `OFFLINE_STT_BENCHMARK\n${JSON.stringify(latestReport, null, 2)}`;
  ui.resultsOutput.value = text;
  show(ui.resultsOutput, true);

  try {
    await navigator.clipboard.writeText(text);
    ui.copyStatus.textContent = 'Rapport copié. Collez-le tel quel dans ChatGPT.';
  } catch {
    ui.resultsOutput.focus();
    ui.resultsOutput.select();
    const copied = document.execCommand?.('copy') || false;
    ui.copyStatus.textContent = copied
      ? 'Rapport copié. Collez-le tel quel dans ChatGPT.'
      : 'Sélectionnez le rapport ci-dessous et copiez-le manuellement.';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    ui.swInfo.textContent = 'non supporté';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=4', { scope: './' });
    try { await reg.update(); } catch {}
    await navigator.serviceWorker.ready;
    ui.swInfo.textContent = navigator.serviceWorker.controller?.scriptURL?.includes('v=4') ? 'actif · v4' : 'actif';
  } catch (error) {
    ui.swInfo.textContent = `erreur · ${error.message || error}`;
  }
}

async function updateTechInfo() {
  ui.buildInfo.textContent = BUILD_ID;
  ui.browserInfo.textContent = navigator.userAgentData?.brands?.map(x => `${x.brand} ${x.version}`).join(' · ') || navigator.userAgent;
  ui.memoryInfo.textContent = navigator.deviceMemory ? `${navigator.deviceMemory} Go · ${navigator.hardwareConcurrency || '?'} threads` : `${navigator.hardwareConcurrency || '?'} threads`;
  ui.networkInfo.textContent = navigator.onLine ? 'en ligne' : 'hors connexion';

  const storage = await storageUsage();
  ui.storageInfo.textContent = storage.usage != null
    ? `${formatBytes(storage.usage)} utilisés / ${formatBytes(storage.quota)}`
    : 'indisponible';
}

function init() {
  updateRunButton();
  updateTechInfo();
  registerServiceWorker();

  window.addEventListener('online', updateTechInfo);
  window.addEventListener('offline', updateTechInfo);

  ui.recordBtn.addEventListener('click', startRecording);
  ui.stopBtn.addEventListener('click', stopRecording);
  ui.runBtn.addEventListener('click', runBenchmark);
  ui.rerunBtn.addEventListener('click', runBenchmark);
  ui.cancelBtn.addEventListener('click', () => {
    runAbortRequested = true;
    ui.cancelBtn.disabled = true;
    ui.runStatus.textContent = 'Arrêt demandé';
  });
  ui.copyResultsBtn.addEventListener('click', copyResults);

  for (const checkbox of [ui.modelTiny, ui.modelBase, ui.modelSmall]) {
    checkbox.addEventListener('change', updateRunButton);
  }
}

init();

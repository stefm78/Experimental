import { SAMPLE_RATE, blobTo16kMono, scoreTranscript } from './stt-lab-audio.js?v=4';

const BUILD_ID = '2026-09-01.device-stt-capability-v3';
const LANG = 'fr-FR';
const TRANSFORMERS_VERSION = '4.2.0';
const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;
const WHISPER_MODEL_ID = 'onnx-community/whisper-base-ONNX';
const MAX_SPEECH_SECONDS = 75;

const $ = id => document.getElementById(id);
const ui = {
  speechApiStatus: $('speechApiStatus'),
  localPropertyStatus: $('localPropertyStatus'),
  availableStatus: $('availableStatus'),
  installStatus: $('installStatus'),
  frLocalStatus: $('frLocalStatus'),
  frDictationStatus: $('frDictationStatus'),
  networkStatus: $('networkStatus'),
  micStatus: $('micStatus'),
  refreshCapabilitiesBtn: $('refreshCapabilitiesBtn'),
  installFrenchBtn: $('installFrenchBtn'),
  capabilityMessage: $('capabilityMessage'),
  capabilityError: $('capabilityError'),

  referenceText: $('referenceText'),
  runNormalBtn: $('runNormalBtn'),
  runLocalBtn: $('runLocalBtn'),
  stopSpeechBtn: $('stopSpeechBtn'),
  activeMode: $('activeMode'),
  speechTimer: $('speechTimer'),
  interimSupport: $('interimSupport'),
  captureStatus: $('captureStatus'),
  speechInputStatus: $('speechInputStatus'),
  micLevelStatus: $('micLevelStatus'),
  speechEventsStatus: $('speechEventsStatus'),
  liveTranscript: $('liveTranscript'),
  speechError: $('speechError'),

  browserMetrics: $('browserMetrics'),
  browserWer: $('browserWer'),
  browserCer: $('browserCer'),
  browserLatency: $('browserLatency'),
  browserWords: $('browserWords'),
  runWhisperSameAudioBtn: $('runWhisperSameAudioBtn'),
  parallelCaptureToggle: $('parallelCaptureToggle'),

  whisperComparison: $('whisperComparison'),
  whisperWer: $('whisperWer'),
  whisperCer: $('whisperCer'),
  whisperLatency: $('whisperLatency'),
  whisperRtf: $('whisperRtf'),
  whisperTranscript: $('whisperTranscript'),

  runOfflineLocalBtn: $('runOfflineLocalBtn'),
  offlineProofStatus: $('offlineProofStatus'),

  osDictationText: $('osDictationText'),
  scoreOsDictationBtn: $('scoreOsDictationBtn'),
  osMetrics: $('osMetrics'),
  osWer: $('osWer'),
  osCer: $('osCer'),
  osWords: $('osWords'),

  copyReportBtn: $('copyReportBtn'),
  copyStatus: $('copyStatus'),
  reportOutput: $('reportOutput'),

  buildInfo: $('buildInfo'),
  browserInfo: $('browserInfo'),
  platformInfo: $('platformInfo'),
  swInfo: $('swInfo'),
  storageInfo: $('storageInfo')
};

const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const speechCtorName = window.SpeechRecognition ? 'SpeechRecognition' : window.webkitSpeechRecognition ? 'webkitSpeechRecognition' : null;

let capabilities = null;
let activeRecognition = null;
let activeCapture = null;
let activeInput = null;
let speechTimerHandle = null;
let speechTimeoutHandle = null;
let speechStartedAt = 0;
let finalizedForActiveRun = false;
let currentRun = null;
let lastCaptureSamples = null;
let lastCaptureDuration = 0;
let lastBrowserResult = null;
let whisperPipeline = null;
let whisperLoadPromise = null;

const tests = [];
let osDictationResult = null;
let offlineProof = {
  attempted: false,
  startedOffline: false,
  result: null,
  error: null
};

function show(el, yes = true) {
  el.classList.toggle('hidden', !yes);
}

function showError(el, message = '') {
  el.textContent = message;
  show(el, Boolean(message));
}

function formatPct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(1)} %`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

function preferredMimeType() {
  if (!window.MediaRecorder) return '';
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
    .find(type => MediaRecorder.isTypeSupported?.(type)) || '';
}

async function micPermissionState() {
  try {
    if (!navigator.permissions?.query) return 'inconnu';
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state;
  } catch {
    return 'inconnu';
  }
}

async function storageUsage() {
  try {
    const e = await navigator.storage?.estimate?.();
    return { usage: e?.usage ?? null, quota: e?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

function safeStatus(value) {
  return typeof value === 'string' ? value : value == null ? 'non disponible' : String(value);
}

async function callAvailable(options) {
  if (!SpeechCtor?.available) return { supported: false, value: null, error: null };
  try {
    return { supported: true, value: await SpeechCtor.available(options), error: null };
  } catch (error) {
    return { supported: true, value: null, error: `${error.name || 'Error'}: ${error.message || error}` };
  }
}

async function probeCapabilities() {
  showError(ui.capabilityError);
  ui.capabilityMessage.textContent = 'Diagnostic en cours…';
  ui.networkStatus.textContent = navigator.onLine ? 'en ligne' : 'hors connexion';
  ui.micStatus.textContent = await micPermissionState();

  const hasApi = Boolean(SpeechCtor);
  let localProperty = false;
  let interimResults = false;

  if (hasApi) {
    try {
      const probe = new SpeechCtor();
      localProperty = 'processLocally' in probe;
      interimResults = 'interimResults' in probe;
    } catch {}
  }

  const normal = hasApi
    ? await callAvailable({ langs: [LANG], processLocally: false })
    : { supported: false, value: null, error: null };

  const local = hasApi
    ? await callAvailable({ langs: [LANG], processLocally: true })
    : { supported: false, value: null, error: null };

  const dictation = hasApi
    ? await callAvailable({ langs: [LANG], processLocally: true, quality: 'dictation' })
    : { supported: false, value: null, error: null };

  capabilities = {
    probedAt: new Date().toISOString(),
    constructor: speechCtorName,
    speechRecognition: hasApi,
    processLocallyProperty: localProperty,
    interimResultsProperty: interimResults,
    staticAvailable: Boolean(SpeechCtor?.available),
    staticInstall: Boolean(SpeechCtor?.install),
    normalAvailability: normal,
    localAvailability: local,
    localDictationAvailability: dictation,
    onlineAtProbe: navigator.onLine,
    micPermission: ui.micStatus.textContent
  };

  ui.speechApiStatus.textContent = hasApi ? speechCtorName : 'Absent';
  ui.localPropertyStatus.textContent = localProperty ? 'Disponible' : 'Absent';
  ui.availableStatus.textContent = SpeechCtor?.available ? 'Disponible' : 'Absent';
  ui.installStatus.textContent = SpeechCtor?.install ? 'Disponible' : 'Absent';
  ui.frLocalStatus.textContent = safeStatus(local.value);
  ui.frDictationStatus.textContent = safeStatus(dictation.value);
  ui.interimSupport.textContent = interimResults ? 'oui' : 'non';

  const installable = Boolean(SpeechCtor?.install) &&
    (
      ['downloadable', 'downloading'].includes(dictation.value) ||
      ['downloadable', 'downloading'].includes(local.value)
    );
  show(ui.installFrenchBtn, installable);

  if (!hasApi) {
    ui.capabilityMessage.textContent = 'Le navigateur n’expose pas Web Speech Recognition. Whisper reste le fallback Web local.';
  } else if (localProperty && local.value === 'available') {
    ui.capabilityMessage.textContent = 'Reconnaissance locale FR détectée. Le test mode avion permettra de la prouver.';
  } else if (installable) {
    ui.capabilityMessage.textContent = 'Un pack français local semble installable. L’installation reste une action explicite.';
  } else if (local.error || dictation.error) {
    ui.capabilityMessage.textContent = 'API présente, mais le diagnostic local a retourné une erreur. Le rapport conservera le détail.';
  } else {
    ui.capabilityMessage.textContent = 'Web Speech est présent, mais le traitement local français n’est pas confirmé sur ce navigateur.';
  }

  const localReady = localProperty && local.value === 'available';
  ui.runNormalBtn.disabled = !hasApi;
  ui.runLocalBtn.disabled = !hasApi || !localReady;
  ui.runOfflineLocalBtn.disabled = !hasApi || !localReady;

  return capabilities;
}

async function installFrenchPack() {
  showError(ui.capabilityError);
  if (!SpeechCtor?.install) return;

  ui.installFrenchBtn.disabled = true;
  ui.capabilityMessage.textContent = 'Installation du pack FR local…';

  let installed = false;
  let detail = null;
  try {
    const dictationState = capabilities?.localDictationAvailability?.value;
    const standardState = capabilities?.localAvailability?.value;

    if (['downloadable', 'downloading', 'available'].includes(dictationState)) {
      try {
        installed = await SpeechCtor.install({
          langs: [LANG],
          processLocally: true,
          quality: 'dictation'
        });
        if (installed) detail = 'dictation';
      } catch {}
    }

    if (!installed && ['downloadable', 'downloading', 'available'].includes(standardState)) {
      installed = await SpeechCtor.install({
        langs: [LANG],
        processLocally: true
      });
      if (installed) detail = 'standard';
    }

    if (!installed) throw new Error('Le navigateur a refusé ou échoué à installer le pack FR local.');
    ui.capabilityMessage.textContent = `Pack FR installé (${detail}). Nouveau diagnostic en cours…`;
    await probeCapabilities();
  } catch (error) {
    showError(ui.capabilityError, `Installation impossible : ${error.message || error}`);
  } finally {
    ui.installFrenchBtn.disabled = false;
  }
}

async function openSpeechInput(parallelCaptureEnabled) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia absent');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach(t => t.stop());
    throw new Error('Aucune piste audio micro');
  }

  try { track.contentHint = 'speech-recognition'; } catch {}
  const settings = track.getSettings?.() || {};
  const constraints = track.getConstraints?.() || {};
  const label = track.label || 'micro sans label';

  let audioContext = null;
  let analyser = null;
  let meterTimer = null;
  let meterBuffer = null;

  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    meterBuffer = new Float32Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      if (!currentRun || !analyser) return;
      analyser.getFloatTimeDomainData(meterBuffer);
      let sum = 0;
      let peak = 0;
      for (const sample of meterBuffer) {
        sum += sample * sample;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
      }
      const rms = Math.sqrt(sum / meterBuffer.length);
      currentRun.audioLevel.samples += 1;
      currentRun.audioLevel.maxRms = Math.max(currentRun.audioLevel.maxRms, rms);
      currentRun.audioLevel.maxPeak = Math.max(currentRun.audioLevel.maxPeak, peak);
      currentRun.audioLevel.lastRms = rms;
      currentRun.audioLevel.lastPeak = peak;
      ui.micLevelStatus.textContent = `RMS ${rms.toFixed(4)} · peak ${peak.toFixed(3)}`;
    }, 120);
  } catch (error) {
    ui.micLevelStatus.textContent = `mètre indisponible · ${error.message || error}`;
  }

  let capture = null;
  if (parallelCaptureEnabled && window.MediaRecorder) {
    const clone = track.clone();
    const captureStream = new MediaStream([clone]);
    const mimeType = preferredMimeType();
    const recorder = mimeType ? new MediaRecorder(captureStream, { mimeType }) : new MediaRecorder(captureStream);
    const chunks = [];
    const promise = new Promise(resolve => {
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onerror = e => resolve({ samples: null, durationSeconds: null, error: e.error?.message || 'MediaRecorder error' });
      recorder.onstop = async () => {
        captureStream.getTracks().forEach(t => t.stop());
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const samples = await blobTo16kMono(blob);
          resolve({ samples, durationSeconds: samples.length / SAMPLE_RATE, error: null });
        } catch (error) {
          resolve({ samples: null, durationSeconds: null, error: error.message || String(error) });
        }
      };
    });
    recorder.start(500);
    capture = {
      available: true,
      stop: () => { if (recorder.state !== 'inactive') recorder.stop(); },
      promise
    };
  }

  return {
    stream,
    track,
    label,
    settings,
    constraints,
    capture,
    stop: async () => {
      clearInterval(meterTimer);
      meterTimer = null;
      stream.getTracks().forEach(t => t.stop());
      try { await audioContext?.close?.(); } catch {}
    }
  };
}

function speechEvent(name) {
  if (!currentRun) return;
  const ms = performance.now() - speechStartedAt;
  currentRun.speechEvents.push({ name, ms });
  ui.speechEventsStatus.textContent = currentRun.speechEvents.map(x => x.name).join(' → ');
}

function stopTimer() {
  clearInterval(speechTimerHandle);
  clearTimeout(speechTimeoutHandle);
  speechTimerHandle = null;
  speechTimeoutHandle = null;
}

function stopActiveSpeech(reason = 'manual-stop') {
  if (currentRun && !currentRun.stopRequestedAt) {
    currentRun.stopRequestedAt = performance.now();
    currentRun.stopReason = reason;
  }
  if (activeRecognition) {
    try { activeRecognition.stop(); } catch {}
  }
  activeCapture?.stop?.();
  ui.stopSpeechBtn.disabled = true;
}

async function finalizeSpeechRun(reason = 'end') {
  if (finalizedForActiveRun || !currentRun) return;
  finalizedForActiveRun = true;
  stopTimer();

  activeCapture?.stop?.();
  const captureResult = activeCapture
    ? await activeCapture.promise
    : { samples: null, durationSeconds: null, error: null };
  const inputSnapshot = currentRun.input
    ? {
        label: currentRun.input.label,
        settings: currentRun.input.settings,
        constraints: currentRun.input.constraints,
        startMode: currentRun.input.startMode
      }
    : null;
  await activeInput?.stop?.();

  const finishedPerf = performance.now();
  const runDurationMs = finishedPerf - speechStartedAt;
  const firstResultMs = currentRun.firstResultAt == null ? null : currentRun.firstResultAt - speechStartedAt;
  const lastResultMs = currentRun.lastResultAt == null ? null : currentRun.lastResultAt - speechStartedAt;
  const finalizationAfterStopMs = currentRun.stopRequestedAt == null ? null : finishedPerf - currentRun.stopRequestedAt;
  const transcript = ui.liveTranscript.value.trim();
  const score = scoreTranscript(ui.referenceText.textContent, transcript);

  lastCaptureSamples = captureResult.samples;
  lastCaptureDuration = captureResult.durationSeconds || 0;

  const result = {
    id: crypto.randomUUID?.() || `speech-${Date.now()}`,
    mode: currentRun.mode,
    processLocallyRequested: currentRun.processLocally,
    startedOnline: currentRun.startedOnline,
    endedOnline: navigator.onLine,
    endedBy: reason,
    startedAt: currentRun.startedAt,
    finishedAt: new Date().toISOString(),
    runDurationMs,
    firstResultMs,
    lastResultMs,
    finalizationAfterStopMs,
    resultEvents: currentRun.resultEvents,
    stopReason: currentRun.stopReason || null,
    parallelCaptureEnabled: currentRun.parallelCaptureEnabled,
    input: inputSnapshot,
    audioLevel: currentRun.audioLevel,
    speechEvents: currentRun.speechEvents,
    transcript,
    wer: score.wer,
    cer: score.cer,
    wordDistance: score.wordDistance,
    referenceWords: score.referenceWords,
    hypothesisWords: score.hypothesisWords,
    wordRatio: score.wordRatio,
    capture: {
      available: Boolean(captureResult.samples),
      durationSeconds: captureResult.durationSeconds,
      error: captureResult.error
    },
    error: currentRun.error || null,
    whisperComparison: null
  };

  tests.push(result);
  lastBrowserResult = result;

  ui.browserWer.textContent = formatPct(score.wer);
  ui.browserCer.textContent = formatPct(score.cer);
  ui.browserLatency.textContent = firstResultMs == null
    ? 'aucun résultat'
    : `1er ${(firstResultMs / 1000).toFixed(2)} s · dernier ${(lastResultMs / 1000).toFixed(2)} s${finalizationAfterStopMs == null ? '' : ` · fin +${(finalizationAfterStopMs / 1000).toFixed(2)} s`}`;
  ui.browserWords.textContent = `${score.hypothesisWords} / ${score.referenceWords}`;
  show(ui.browserMetrics, true);
  show(ui.runWhisperSameAudioBtn, Boolean(lastCaptureSamples));
  ui.captureStatus.textContent = currentRun.parallelCaptureEnabled
    ? (captureResult.samples
      ? `${captureResult.durationSeconds.toFixed(2)} s en RAM · expérimental`
      : `échec : ${captureResult.error || 'inconnu'}`)
    : 'désactivée · benchmark propre';

  if (currentRun.mode === 'local-offline') {
    offlineProof = {
      attempted: true,
      startedOffline: !currentRun.startedOnline,
      result: transcript ? 'transcript-produced' : 'no-transcript',
      error: currentRun.error || null
    };
    const proven = !currentRun.startedOnline && transcript && !currentRun.error;
    ui.offlineProofStatus.textContent = proven
      ? 'PASS : transcription locale produite alors que navigator.onLine=false.'
      : `Test terminé sans preuve forte. startedOnline=${currentRun.startedOnline}; transcript=${Boolean(transcript)}; error=${currentRun.error || 'none'}`;
  }

  activeRecognition = null;
  activeCapture = null;
  activeInput = null;
  currentRun = null;
  show(ui.stopSpeechBtn, false);
  ui.stopSpeechBtn.disabled = false;
  const localReady = capabilities?.localAvailability?.value === 'available';
  ui.runNormalBtn.disabled = !SpeechCtor;
  ui.runLocalBtn.disabled = !SpeechCtor || !localReady;
  ui.runOfflineLocalBtn.disabled = !SpeechCtor || !localReady;
  ui.activeMode.textContent = '—';
}

async function runSpeech(mode) {
  showError(ui.speechError);
  show(ui.browserMetrics, false);
  show(ui.whisperComparison, false);
  show(ui.runWhisperSameAudioBtn, false);
  ui.liveTranscript.value = '';
  ui.speechInputStatus.textContent = 'ouverture…';
  ui.micLevelStatus.textContent = 'mesure…';
  ui.speechEventsStatus.textContent = '—';
  lastCaptureSamples = null;
  lastCaptureDuration = 0;
  lastBrowserResult = null;

  if (!SpeechCtor) {
    showError(ui.speechError, 'SpeechRecognition absent.');
    return;
  }

  const processLocally = mode !== 'normal';
  if (processLocally && !capabilities?.processLocallyProperty) {
    showError(ui.speechError, 'processLocally n’est pas exposé par ce navigateur.');
    return;
  }

  if (mode === 'local-offline' && navigator.onLine) {
    showError(ui.speechError, 'Activez d’abord le mode avion / coupez le réseau. Le test exige navigator.onLine=false au démarrage.');
    return;
  }

  ui.runNormalBtn.disabled = true;
  ui.runLocalBtn.disabled = true;
  ui.runOfflineLocalBtn.disabled = true;
  show(ui.stopSpeechBtn, true);

  const parallelCaptureEnabled = Boolean(ui.parallelCaptureToggle?.checked);
  ui.captureStatus.textContent = parallelCaptureEnabled ? 'même track · capture activée' : 'désactivée';

  try {
    activeInput = await openSpeechInput(parallelCaptureEnabled);
    activeCapture = activeInput.capture;

    const recognition = new SpeechCtor();
    recognition.lang = LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if (processLocally) recognition.processLocally = true;

    let finalText = '';
    let interimText = '';
    finalizedForActiveRun = false;
    speechStartedAt = performance.now();
    currentRun = {
      mode,
      processLocally,
      parallelCaptureEnabled,
      startedOnline: navigator.onLine,
      startedAt: new Date().toISOString(),
      firstResultAt: null,
      lastResultAt: null,
      resultEvents: 0,
      stopRequestedAt: null,
      stopReason: null,
      error: null,
      speechEvents: [],
      audioLevel: { samples: 0, maxRms: 0, maxPeak: 0, lastRms: 0, lastPeak: 0 },
      input: {
        label: activeInput.label,
        settings: activeInput.settings,
        constraints: activeInput.constraints,
        startMode: null
      }
    };
    activeRecognition = recognition;

    ui.speechInputStatus.textContent = `${activeInput.label} · ${activeInput.settings.sampleRate || '?'} Hz`;

    recognition.onstart = () => {
      speechEvent('start');
      ui.activeMode.textContent = mode === 'normal'
        ? 'Web Speech normal'
        : mode === 'local-offline'
          ? 'Web Speech local · offline'
          : 'Web Speech local';
      ui.speechTimer.textContent = '00:00';
      speechTimerHandle = setInterval(() => {
        ui.speechTimer.textContent = formatTime((performance.now() - speechStartedAt) / 1000);
      }, 250);
      speechTimeoutHandle = setTimeout(() => {
        if (activeRecognition) stopActiveSpeech('max-duration');
      }, MAX_SPEECH_SECONDS * 1000);
    };

    recognition.onaudiostart = () => speechEvent('audiostart');
    recognition.onsoundstart = () => speechEvent('soundstart');
    recognition.onspeechstart = () => speechEvent('speechstart');
    recognition.onspeechend = () => speechEvent('speechend');
    recognition.onsoundend = () => speechEvent('soundend');
    recognition.onaudioend = () => speechEvent('audioend');

    recognition.onresult = event => {
      speechEvent('result');
      if (currentRun) {
        const now = performance.now();
        if (currentRun.firstResultAt == null) currentRun.firstResultAt = now;
        currentRun.lastResultAt = now;
        currentRun.resultEvents += 1;
      }
      interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) finalText += `${text} `;
        else interimText += text;
      }
      ui.liveTranscript.value = `${finalText}${interimText}`.trim();
    };

    recognition.onerror = event => {
      speechEvent(`error:${event.error || 'unknown'}`);
      const detail = [event.error, event.message].filter(Boolean).join(' · ');
      if (currentRun) currentRun.error = detail || 'speech recognition error';
      showError(ui.speechError, `Web Speech : ${detail || 'erreur inconnue'}`);
    };

    recognition.onend = () => {
      speechEvent('end');
      finalizeSpeechRun('recognition-end');
    };

    try {
      recognition.start(activeInput.track);
      currentRun.input.startMode = 'explicit-audio-track';
      ui.speechInputStatus.textContent += ' · explicit track';
    } catch (error) {
      currentRun.input.startMode = `implicit-fallback:${error.name || 'Error'}`;
      ui.speechInputStatus.textContent += ' · fallback micro implicite';
      recognition.start();
    }
  } catch (error) {
    activeCapture?.stop?.();
    await activeInput?.stop?.();
    activeCapture = null;
    activeInput = null;
    activeRecognition = null;
    currentRun = null;
    show(ui.stopSpeechBtn, false);
    ui.runNormalBtn.disabled = false;
    const localReady = capabilities?.localAvailability?.value === 'available';
    ui.runLocalBtn.disabled = !localReady;
    ui.runOfflineLocalBtn.disabled = !localReady;
    showError(ui.speechError, `Impossible de démarrer le test : ${error.name || 'Error'}: ${error.message || error}`);
  }
}

async function loadWhisperPipeline() {
  if (whisperPipeline) return whisperPipeline;
  if (whisperLoadPromise) return whisperLoadPromise;

  whisperLoadPromise = (async () => {
    const {
      env,
      AutoTokenizer,
      AutoProcessor,
      WhisperForConditionalGeneration,
      AutomaticSpeechRecognitionPipeline
    } = await import(TRANSFORMERS_URL);

    env.useBrowserCache = true;
    env.useWasmCache = true;
    env.allowRemoteModels = true;
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;

    const tokenizer = await AutoTokenizer.from_pretrained(WHISPER_MODEL_ID);
    const processor = await AutoProcessor.from_pretrained(WHISPER_MODEL_ID);
    const model = await WhisperForConditionalGeneration.from_pretrained(WHISPER_MODEL_ID, {
      device: 'wasm',
      dtype: {
        encoder_model: 'int8',
        decoder_model_merged: 'int8'
      },
      session_options: { graphOptimizationLevel: 'basic' }
    });

    whisperPipeline = new AutomaticSpeechRecognitionPipeline({
      task: 'automatic-speech-recognition',
      model,
      tokenizer,
      processor
    });
    return whisperPipeline;
  })();

  try {
    return await whisperLoadPromise;
  } finally {
    whisperLoadPromise = null;
  }
}

async function compareWhisperSameAudio() {
  showError(ui.speechError);
  if (!lastCaptureSamples || !lastBrowserResult) return;

  ui.runWhisperSameAudioBtn.disabled = true;
  ui.runWhisperSameAudioBtn.textContent = 'Whisper en cours…';

  try {
    const pipeline = await loadWhisperPipeline();
    const started = performance.now();
    const output = await pipeline(lastCaptureSamples, {
      language: 'french',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5
    });
    const inferenceMs = performance.now() - started;
    const transcript = String(output?.text || '').trim();
    const score = scoreTranscript(ui.referenceText.textContent, transcript);
    const rtf = lastCaptureDuration ? (inferenceMs / 1000) / lastCaptureDuration : null;

    lastBrowserResult.whisperComparison = {
      modelId: WHISPER_MODEL_ID,
      dtype: { encoder_model: 'int8', decoder_model_merged: 'int8' },
      device: 'wasm',
      graphOptimizationLevel: 'basic',
      transcript,
      inferenceMs,
      rtf,
      wer: score.wer,
      cer: score.cer,
      hypothesisWords: score.hypothesisWords,
      referenceWords: score.referenceWords
    };

    ui.whisperWer.textContent = formatPct(score.wer);
    ui.whisperCer.textContent = formatPct(score.cer);
    ui.whisperLatency.textContent = `${(inferenceMs / 1000).toFixed(2)} s`;
    ui.whisperRtf.textContent = rtf == null ? '—' : `${rtf.toFixed(2)}×`;
    ui.whisperTranscript.value = transcript;
    show(ui.whisperComparison, true);
  } catch (error) {
    showError(ui.speechError, `Comparaison Whisper impossible : ${error.name || 'Error'}: ${error.message || error}`);
  } finally {
    ui.runWhisperSameAudioBtn.disabled = false;
    ui.runWhisperSameAudioBtn.textContent = 'Comparer Whisper int8 sur la même prise';
  }
}

function scoreOsDictation() {
  const transcript = ui.osDictationText.value.trim();
  if (!transcript) return;
  const score = scoreTranscript(ui.referenceText.textContent, transcript);
  osDictationResult = {
    scoredAt: new Date().toISOString(),
    transcript,
    wer: score.wer,
    cer: score.cer,
    referenceWords: score.referenceWords,
    hypothesisWords: score.hypothesisWords
  };
  ui.osWer.textContent = formatPct(score.wer);
  ui.osCer.textContent = formatPct(score.cer);
  ui.osWords.textContent = `${score.hypothesisWords} / ${score.referenceWords}`;
  show(ui.osMetrics, true);
}

async function buildReport() {
  return {
    schema: 'offline-interview.device-stt-capability.v3',
    build: BUILD_ID,
    generatedAt: new Date().toISOString(),
    privacy: 'No audio included or persisted. Transcripts and capability metadata are included.',
    environment: {
      userAgent: navigator.userAgent,
      platform: navigator.userAgentData?.platform || navigator.platform,
      mobile: navigator.userAgentData?.mobile ?? null,
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      online: navigator.onLine,
      crossOriginIsolated: window.crossOriginIsolated,
      secureContext: window.isSecureContext
    },
    capabilities,
    referenceText: ui.referenceText.textContent.trim(),
    tests,
    offlineProof,
    osDictation: osDictationResult,
    storage: await storageUsage()
  };
}

async function copyReport() {
  const report = await buildReport();
  const text = `DEVICE_STT_CAPABILITY_REPORT\n${JSON.stringify(report, null, 2)}`;
  ui.reportOutput.value = text;
  show(ui.reportOutput, true);

  try {
    await navigator.clipboard.writeText(text);
    ui.copyStatus.textContent = 'Rapport copié. Collez-le tel quel dans ChatGPT.';
  } catch {
    ui.reportOutput.focus();
    ui.reportOutput.select();
    const copied = document.execCommand?.('copy') || false;
    ui.copyStatus.textContent = copied ? 'Rapport copié.' : 'Copiez manuellement le rapport ci-dessous.';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    ui.swInfo.textContent = 'non supporté';
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=13', { scope: './' });
    try { await reg.update(); } catch {}
    await navigator.serviceWorker.ready;
    ui.swInfo.textContent = navigator.serviceWorker.controller?.scriptURL?.includes('v=13') ? 'actif · v13' : 'actif';
  } catch (error) {
    ui.swInfo.textContent = `erreur · ${error.message || error}`;
  }
}

async function updateTechnicalInfo() {
  ui.buildInfo.textContent = BUILD_ID;
  ui.browserInfo.textContent = navigator.userAgentData?.brands
    ?.map(x => `${x.brand} ${x.version}`).join(' · ') || navigator.userAgent;
  ui.platformInfo.textContent = `${navigator.userAgentData?.platform || navigator.platform} · ${navigator.deviceMemory || '?'} Go · ${navigator.hardwareConcurrency || '?'} threads`;
  ui.networkStatus.textContent = navigator.onLine ? 'en ligne' : 'hors connexion';
  const s = await storageUsage();
  ui.storageInfo.textContent = s.usage == null ? 'indisponible' : `${formatBytes(s.usage)} / ${formatBytes(s.quota)}`;
}

ui.refreshCapabilitiesBtn.addEventListener('click', probeCapabilities);
ui.installFrenchBtn.addEventListener('click', installFrenchPack);
ui.runNormalBtn.addEventListener('click', () => runSpeech('normal'));
ui.runLocalBtn.addEventListener('click', () => runSpeech('local'));
ui.runOfflineLocalBtn.addEventListener('click', () => runSpeech('local-offline'));
ui.stopSpeechBtn.addEventListener('click', () => stopActiveSpeech('manual-stop'));
ui.runWhisperSameAudioBtn.addEventListener('click', compareWhisperSameAudio);
ui.scoreOsDictationBtn.addEventListener('click', scoreOsDictation);
ui.copyReportBtn.addEventListener('click', copyReport);

window.addEventListener('online', () => {
  updateTechnicalInfo();
  if (offlineProof.attempted && !offlineProof.startedOffline) {
    ui.offlineProofStatus.textContent = 'Le dernier test offline n’a pas démarré hors connexion.';
  }
});
window.addEventListener('offline', () => {
  updateTechnicalInfo();
  ui.offlineProofStatus.textContent = 'Hors connexion détecté. Vous pouvez lancer « Tester local en mode avion ».';
});

updateTechnicalInfo();
registerServiceWorker();
probeCapabilities();

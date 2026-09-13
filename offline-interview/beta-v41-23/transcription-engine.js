import { detectSystemSpeech as detectBrowserSystemSpeech, createSystemSpeechSession as createBrowserSystemSpeechSession } from './system-stt.js';

export const TRANSCRIPTION_ENGINE_SCHEMA = 'offline-interview.transcription-engine-contract.v1';
export const BROWSER_PROVIDER_ID = 'browser-system-live';
export const ANDROID_PROVIDER_ID = 'ANDROID_SYSTEM_DEFAULT_V3_DRAFT';
export const ANDROID_MODE = 'android-native-draft';
const NATIVE_BRIDGE_NAME = 'OfflineInterviewNative';

export const TRANSCRIPTION_STATUS = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  PENDING: 'PENDING',
  DRAFT: 'DRAFT',
  FINAL: 'FINAL',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE'
});

let nativeCapabilityCache = null;
let nativeListenerInstalled = false;
const nativeRequests = new Map();
const nativeSessions = new Map();

const scopeKey = (sessionId, turnId) => `${sessionId}::${turnId}`;
const nativeBridge = () => globalThis?.[NATIVE_BRIDGE_NAME] || null;
const hasNativeBridge = () => typeof nativeBridge()?.postMessage === 'function';

function parseNativeMessage(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

function installNativeListener() {
  if (nativeListenerInstalled || !hasNativeBridge()) return;
  const bridge = nativeBridge();
  const handler = event => {
    const message = parseNativeMessage(event?.data ?? event);
    if (!message) return;
    if (message.requestId && nativeRequests.has(message.requestId)) {
      const pending = nativeRequests.get(message.requestId);
      nativeRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.resolve(message);
      return;
    }
    const sessionId = message.sessionId;
    const turnId = message.turnId;
    if (!sessionId || !turnId) return;
    nativeSessions.get(scopeKey(sessionId, turnId))?.handleEvent(message);
  };
  if (typeof bridge.addEventListener === 'function') bridge.addEventListener('message', handler);
  else bridge.onmessage = handler;
  nativeListenerInstalled = true;
}

function postNative(payload) {
  installNativeListener();
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.postMessage !== 'function') return false;
  bridge.postMessage(JSON.stringify(payload));
  return true;
}

async function requestNativeCapabilities(language = 'fr-FR') {
  if (!hasNativeBridge()) return null;
  installNativeListener();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => {
      nativeRequests.delete(requestId);
      resolve(null);
    }, 900);
    nativeRequests.set(requestId, { resolve, timer });
    if (!postNative({ type: 'GET_TRANSCRIPTION_CAPABILITIES', requestId, language })) {
      clearTimeout(timer);
      nativeRequests.delete(requestId);
      resolve(null);
    }
  });
  nativeCapabilityCache = result;
  return result;
}

export function assertScopedIdentity({ sessionId, turnId } = {}) {
  if (!sessionId || !turnId) throw new Error('transcription scope requires sessionId and turnId');
  return { sessionId, turnId };
}

export function validateScopedEvent({ sessionId, turnId }, event) {
  if (!event || event.sessionId !== sessionId || event.turnId !== turnId) {
    return { accepted: false, reason: 'scope-mismatch' };
  }
  return { accepted: true, reason: null };
}

export function providerMayOverwriteTurn(turn) {
  return !Boolean(turn?.humanEdited || turn?.humanLock || turn?.humanLocked);
}

export function applyProviderText(turn, event) {
  const scoped = validateScopedEvent({ sessionId: turn?.sessionId, turnId: turn?.id }, event);
  if (!scoped.accepted) return { applied: false, reason: scoped.reason, turn };
  if (!providerMayOverwriteTurn(turn)) return { applied: false, reason: 'human-authority', turn };
  const text = String(event?.text || '').trim();
  if (!text) return { applied: false, reason: 'empty', turn };
  return {
    applied: true,
    reason: null,
    turn: {
      ...turn,
      text,
      rawTranscript: text,
      transcriptionStatus: event.status || TRANSCRIPTION_STATUS.DRAFT,
      transcriptionProviderId: event.providerId || null
    }
  };
}

export async function getTranscriptionCapabilities(lang = 'fr-FR') {
  if (hasNativeBridge()) {
    const native = await requestNativeCapabilities(lang);
    if (native) {
      return {
        schema: TRANSCRIPTION_ENGINE_SCHEMA,
        providerId: native.providerId || ANDROID_PROVIDER_ID,
        role: native.role || 'LIVE_DRAFT_ONLY',
        language: lang,
        available: Boolean(native.available),
        liveDraft: Boolean(native.liveDraft),
        recordedAudioReplay: Boolean(native.recordedAudioReplay),
        offline: native.offline ?? null,
        providerMode: native.providerMode || ANDROID_MODE,
        hostBuild: native.hostBuild || null,
        webBuildId: native.webBuildId || null,
        raw: native
      };
    }
    return {
      schema: TRANSCRIPTION_ENGINE_SCHEMA,
      providerId: ANDROID_PROVIDER_ID,
      role: 'LIVE_DRAFT_ONLY',
      language: lang,
      available: false,
      liveDraft: false,
      recordedAudioReplay: false,
      offline: null,
      providerMode: 'android-native-unavailable',
      raw: null
    };
  }

  const capability = await detectBrowserSystemSpeech(lang);
  return {
    schema: TRANSCRIPTION_ENGINE_SCHEMA,
    providerId: BROWSER_PROVIDER_ID,
    role: 'LIVE_DRAFT_ONLY',
    language: lang,
    available: capability.mode !== 'unavailable',
    liveDraft: capability.mode !== 'unavailable',
    recordedAudioReplay: false,
    offline: capability.mode === 'local',
    providerMode: capability.mode,
    raw: capability
  };
}

// Compatibility port for the protected V41.23 runtime. In a normal browser the
// existing browser provider is unchanged. Inside the trusted Android host the
// native V3 provider is preferred and browser SpeechRecognition is not started.
export async function detectSystemSpeech(lang = 'fr-FR') {
  if (hasNativeBridge()) {
    const capability = await getTranscriptionCapabilities(lang);
    return {
      supported: Boolean(capability.available),
      mode: capability.available ? ANDROID_MODE : 'unavailable',
      localAvailability: null,
      availability: capability.available ? 'available' : 'unavailable',
      providerId: capability.providerId,
      providerMode: capability.providerMode,
      nativeHost: true,
      hostBuild: capability.hostBuild,
      webBuildId: capability.webBuildId
    };
  }
  return detectBrowserSystemSpeech(lang);
}

function createNativeDraftSession({
  sessionId,
  turnId,
  lang = 'fr-FR',
  onText = () => {},
  onState = () => {},
  onError = () => {}
} = {}) {
  assertScopedIdentity({ sessionId, turnId });
  const key = scopeKey(sessionId, turnId);
  let text = '';
  let finalText = '';
  let lastError = null;
  let resultSeen = false;
  let started = false;
  let stopped = false;

  const state = {
    handleEvent(event) {
      if (!validateScopedEvent({ sessionId, turnId }, event).accepted) return;
      if (event.type === 'TRANSCRIPT_PARTIAL' || event.type === 'TRANSCRIPT_FINAL') {
        const next = String(event.text || '').trim();
        if (next) {
          text = next;
          resultSeen = true;
          if (event.type === 'TRANSCRIPT_FINAL') finalText = next;
          onText({ text, finalText: finalText || text, mode: ANDROID_MODE, providerId: ANDROID_PROVIDER_ID });
        }
        if (event.type === 'TRANSCRIPT_FINAL') {
          stopped = true;
          setTimeout(() => nativeSessions.delete(key), 1200);
        }
        return;
      }
      if (event.type === 'TRANSCRIPTION_STATUS') {
        onState(event.detail || event.status || 'native');
        return;
      }
      if (event.type === 'TRANSCRIPTION_ERROR') {
        lastError = event.code || event.message || 'android-native-error';
        onError(lastError);
        if (stopped || event.code === 'NO_TEXT') setTimeout(() => nativeSessions.delete(key), 1200);
      }
    }
  };
  nativeSessions.set(key, state);

  return {
    start() {
      if (started || stopped) return false;
      started = postNative({ type: 'START_LIVE_DRAFT', sessionId, turnId, language: lang });
      if (!started) {
        lastError = 'native-bridge-unavailable';
        onError(lastError);
      }
      return started;
    },
    stop() {
      if (!started || stopped) return;
      stopped = true;
      postNative({ type: 'STOP_LIVE_DRAFT', sessionId, turnId });
      setTimeout(() => nativeSessions.delete(key), 5000);
    },
    abort() {
      stopped = true;
      postNative({ type: 'CANCEL_TRANSCRIPTION', sessionId, turnId });
      nativeSessions.delete(key);
    },
    snapshot() {
      return {
        text,
        finalText: finalText || text,
        mode: ANDROID_MODE,
        providerId: ANDROID_PROVIDER_ID,
        resultSeen,
        lastError
      };
    }
    // No takeSegment(): Product deliberately falls back to an audio-safe stop/start
    // boundary when the Android provider is active.
  };
}

export function createSystemSpeechSession(options = {}) {
  if (hasNativeBridge()) {
    if (!nativeCapabilityCache?.available) return null;
    if (!options.sessionId || !options.turnId) return null;
    return createNativeDraftSession(options);
  }
  return createBrowserSystemSpeechSession(options);
}

export async function transcribeFinal({ sessionId, turnId, audioAsset, language = 'fr-FR' } = {}) {
  assertScopedIdentity({ sessionId, turnId });
  if (!audioAsset?.recordingId) throw new Error('TRANSCRIBE_FINAL requires a product-owned audioAsset.recordingId');
  const providerId = hasNativeBridge() ? ANDROID_PROVIDER_ID : BROWSER_PROVIDER_ID;
  return {
    schema: TRANSCRIPTION_ENGINE_SCHEMA,
    type: 'TRANSCRIPTION_ERROR',
    sessionId,
    turnId,
    providerId,
    providerMode: hasNativeBridge() ? ANDROID_MODE : 'live-only',
    language,
    status: TRANSCRIPTION_STATUS.UNAVAILABLE,
    code: 'RECORDED_AUDIO_NOT_SUPPORTED',
    retryableWithSameProvider: false,
    audioAsset
  };
}

import { hasNativeBridge, postNative, requestNative, subscribeNative } from './native-host-bridge.js';

export const NATIVE_AUDIO_CAPTURE_ID = 'ANDROID_AUDIORECORD_WAV_V1';
const sessions = new Map();
let listenerInstalled = false;

function key(sessionId, captureId) { return `${sessionId}::${captureId}`; }

function installListener() {
  if (listenerInstalled || !hasNativeBridge()) return;
  subscribeNative(message => {
    const sessionId = message?.sessionId;
    const captureId = message?.captureId;
    if (!sessionId || !captureId) return;
    sessions.get(key(sessionId, captureId))?.handle(message);
  });
  listenerInstalled = true;
}

export function hasNativeAudioCapture() {
  return hasNativeBridge();
}

export async function getNativeAudioCapabilities() {
  if (!hasNativeBridge()) return null;
  return requestNative('GET_AUDIO_CAPTURE_CAPABILITIES', {}, 1200);
}

export function createNativeAudioRecorder({ sessionId, captureId } = {}) {
  if (!sessionId || !captureId) throw new Error('native audio requires sessionId and captureId');
  installListener();
  let state = 'inactive';
  let startAt = 0;
  let stopped = false;
  let finalized = false;
  let stopResolve = null;
  let stopReject = null;

  const recorder = {
    mimeType: 'audio/wav',
    ondataavailable: null,
    onstop: null,
    onerror: null,
    get state() { return state; },

    async start() {
      if (state !== 'inactive') return false;
      state = 'starting';
      const response = await requestNative('START_AUDIO_CAPTURE', { sessionId, captureId }, 2500);
      if (!response || response.type !== 'AUDIO_CAPTURE_STARTED') {
        state = 'inactive';
        const error = new Error(response?.message || 'Native AudioRecord could not start');
        recorder.onerror?.(error);
        throw error;
      }
      state = 'recording';
      startAt = performance.now();
      sessions.set(key(sessionId, captureId), controller);
      return true;
    },

    stop() {
      if (state === 'inactive' || stopped) return;
      stopped = true;
      state = 'stopping';
      postNative({ type: 'STOP_AUDIO_CAPTURE', sessionId, captureId });
      return new Promise((resolve, reject) => {
        stopResolve = resolve;
        stopReject = reject;
        setTimeout(() => {
          if (!finalized) rejectFinalize(new Error('Native audio finalization timeout'));
        }, 5000);
      });
    },

    abort() {
      stopped = true;
      state = 'inactive';
      postNative({ type: 'CANCEL_AUDIO_CAPTURE', sessionId, captureId });
      sessions.delete(key(sessionId, captureId));
    },

    elapsedMs() {
      return state === 'recording' || state === 'stopping' ? Math.max(0, performance.now() - startAt) : 0;
    }
  };

  async function finalize(message) {
    if (finalized) return;
    finalized = true;
    try {
      const audioUrl = String(message.audioUrl || '');
      if (!audioUrl) throw new Error('Native capture finalized without audioUrl');
      const response = await fetch(audioUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Native WAV fetch failed: HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('Native WAV is empty');
      recorder.ondataavailable?.({ data: blob });
      state = 'inactive';
      sessions.delete(key(sessionId, captureId));
      recorder.onstop?.();
      stopResolve?.(message);
    } catch (error) {
      rejectFinalize(error);
    }
  }

  function rejectFinalize(error) {
    if (finalized && state === 'inactive') return;
    finalized = true;
    state = 'inactive';
    sessions.delete(key(sessionId, captureId));
    recorder.onerror?.(error);
    stopReject?.(error);
  }

  const controller = {
    handle(message) {
      if (message.type === 'AUDIO_CAPTURE_FINALIZED') finalize(message);
      else if (message.type === 'AUDIO_CAPTURE_ERROR') rejectFinalize(new Error(message.message || message.code || 'Native audio error'));
    }
  };

  return recorder;
}

import { detectSystemSpeech as detectBrowserSystemSpeech, createSystemSpeechSession as createBrowserSystemSpeechSession } from './system-stt.js';

export const TRANSCRIPTION_ENGINE_SCHEMA = 'offline-interview.transcription-engine-contract.v1';
export const SYSTEM_PROVIDER_ID = 'browser-system-live';

export const TRANSCRIPTION_STATUS = Object.freeze({
  NOT_REQUESTED: 'NOT_REQUESTED',
  PENDING: 'PENDING',
  DRAFT: 'DRAFT',
  FINAL: 'FINAL',
  FAILED: 'FAILED',
  UNAVAILABLE: 'UNAVAILABLE'
});

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
  const capability = await detectBrowserSystemSpeech(lang);
  return {
    schema: TRANSCRIPTION_ENGINE_SCHEMA,
    providerId: SYSTEM_PROVIDER_ID,
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

// Compatibility bridge for the protected V41.23 runtime. The product imports this
// port instead of the concrete browser provider; provider-specific evolution stays
// behind this module.
export async function detectSystemSpeech(lang = 'fr-FR') {
  return detectBrowserSystemSpeech(lang);
}

export function createSystemSpeechSession(options = {}) {
  return createBrowserSystemSpeechSession(options);
}

export async function transcribeFinal({ sessionId, turnId, audioAsset, language = 'fr-FR' } = {}) {
  assertScopedIdentity({ sessionId, turnId });
  if (!audioAsset?.recordingId) throw new Error('TRANSCRIBE_FINAL requires a product-owned audioAsset.recordingId');
  return {
    schema: TRANSCRIPTION_ENGINE_SCHEMA,
    type: 'TRANSCRIPTION_ERROR',
    sessionId,
    turnId,
    providerId: SYSTEM_PROVIDER_ID,
    providerMode: 'live-only',
    language,
    status: TRANSCRIPTION_STATUS.UNAVAILABLE,
    code: 'RECORDED_AUDIO_NOT_SUPPORTED',
    retryableWithSameProvider: false,
    audioAsset
  };
}

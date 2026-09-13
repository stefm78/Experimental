# Offline Interview — Product / Transcription split V3

Status: CANDIDATE FOUNDATION

## Physical finding driving this correction

A real V41.23 run on 2026-09-13 completed the interview and preserved a validated Web audio asset with no capture gaps, while `system_boundary_live_missing` / `system_transcription_missing` left answer text empty. The observed failure boundary is therefore `AUDIO -> TEXT`, not Product navigation/state/audio capture.

The active trajectory has exactly two streams.

## STREAM PRODUCT / WEB APP

Protected product surface: `offline-interview/beta-v41-23`.

Owns:

- setup/questionnaire loading;
- participants;
- desktop/mobile question navigation;
- question intent and follow-ups;
- interview lifecycle and state;
- current Web MediaRecorder capture and IndexedDB audio asset while it remains healthy;
- semantic `sessionId`, `turnId` and `audioRef` identity;
- review/correction and human-authoritative text;
- end-of-interview export;
- Web/PWA persistence/offline/accessibility;
- product acceptance.

A captured audio answer remains a valid answer even when transcription is unavailable. The Product must degrade explicitly rather than erase audio or interview state.

## STREAM TRANSCRIPTION ENGINE

Owns one product capability: `AUDIO -> TEXT`.

Owns:

- provider discovery/selection;
- provider adapters and execution;
- live-draft transcription where supported;
- recorded-audio transcription/retranscription where supported;
- provider status/error/diagnostics;
- WER/CER, critical-entity/meaning, latency, resource and offline/network qualification.

Does not own:

- audio capture lifecycle;
- question navigation;
- participants/follow-ups;
- interview lifecycle;
- human-final text authority;
- Product export semantics.

Browser/system SpeechRecognition is currently `LIVE_DRAFT_ONLY`. It is connected behind the engine port but does not support qualified saved-audio replay on the tested Edge path. Android system-default evidence remains draft-only/pivot-confirmed. Replayable PCM providers such as Vosk/Whisper/sherpa remain provider candidates, not Product architecture.

## Shared boundary — not a third stream

`offline-interview.transcription-engine-contract.v1` is the shared interface.

The Product passes a product-owned audio asset or optional live stream together with `sessionId` / `turnId`. The engine returns scoped status/results. Mismatched turn identity is rejected. Provider text is always draft until Product/human acceptance. Human-edited or human-locked text cannot be silently overwritten.

The engine can fail while the interview and audio stay valid. A future replayable provider must be able to retry the same `audioRef` without re-recording.

## Independent gates

- `WEB_PRODUCT_READY`: Product behavior and audio preservation; independent of WER.
- `TRANSCRIPTION_INTEGRATION_READY`: Product can invoke the engine boundary, receive status/result, preserve audio on provider failure and maintain turn isolation.
- `TRANSCRIPTION_PROVIDER_QUALIFIED`: a provider separately meets quality/performance/offline requirements.

Do not collapse these gates.

## Historical evidence treatment

- V41.23: protected Product baseline.
- 2026-09-13 physical Web result: Product/audio path works; browser system transcription missing.
- #96 Vosk: embedded PCM architecture evidence, quality HOLD.
- #97 Vosk/Whisper: replayable comparison evidence.
- #98/#99/#100: Android system-default long-form evidence; do not reopen endpoint/rearm micro-tuning.
- #101/#102: superseded first split.
- #106: Native Speech Capability framing is too broad for the immediate causal boundary and should be superseded rather than merged.

## Anti-coupling rules

- Product changes must not benchmark or select ASR models.
- Engine changes must not own Product navigation/state/audio lifecycle.
- Product-owned audio survives engine/provider failure.
- A provider PASS is not permission to replace Product capture or Product truth.
- Android host/device work is downstream and must consume this same Product/Transcription boundary if later required.

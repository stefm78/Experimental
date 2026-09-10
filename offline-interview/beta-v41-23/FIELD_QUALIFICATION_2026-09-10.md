# Offline Interview V41.23 — field qualification

Date: 2026-09-10
Status: CORE PATH FIELD QUALIFIED

## Evidence

Two short real-browser runs were supplied after publication of V41.23.

### Edge 152

- Runtime identity: `2026-09-10.interview-runtime-v41.23`.
- One `speech_recognition_error: network` occurred and LIVE text was unavailable afterwards, as expected for the qualified fail-stop path.
- The interview nevertheless completed normally.
- Audio blob finalized, decoded and validated.
- Timeline was coherent (`captureGaps: []`).
- Speaker boundaries produced three audio-backed answer turns.
- Replay started successfully.
- Completion was `1/1 answered` despite empty text, proving the audio-authoritative answer-evidence rule in the field.
- Export provenance correctly reports `transcriptionFallback: null`.

### Chrome 152

- Runtime identity: `2026-09-10.interview-runtime-v41.23`.
- LIVE system transcription committed at both speaker boundaries and for the final turn.
- Audio blob finalized, decoded and validated.
- Timeline was coherent (`captureGaps: []`).
- The interview completed normally with `1/1 answered`.
- Export provenance correctly reports `transcriptionFallback: null`.

## Qualification verdict

The core interview path is field-qualified for the two intended browser behaviors:

1. **Chrome / LIVE available** — audio + LIVE transcription + speaker boundaries + completion/export PASS.
2. **Edge / LIVE network failure** — audio authoritative + graceful LIVE degradation + speaker boundaries + replay + completion/export PASS.

The following are explicitly outside this verdict and are not reopened here:

- authoritative saved-audio browser retranscription;
- Whisper fallback in the product path;
- concurrent STT lanes;
- server/backend transcription.

## Product consequence

V41.23 becomes the field-qualified beta baseline. Further work should focus on product readiness (structured interview, free interview, direct links, resume, navigation, review, exports and UX), not on renewed STT experimentation unless new field evidence materially invalidates this qualification.

# QUALITY Backend Handoff Lab V1

Isolated experiment for the asynchronous quality-transcription boundary after rejection of browser `SpeechRecognition.start(audioTrack)` as an authoritative saved-audio engine.

This lab does **not** select or call a real provider. It validates orchestration semantics first: immutable audio identity, idempotency, lifecycle, stale-result rejection and human-edit protection.

## Protocol
1. Record one short segment.
2. Create a QUALITY job. The lab computes SHA-256 over the saved blob and freezes `segmentId`, `revision`, timing and idempotency key.
3. Type a mock provider transcript and complete the job.
4. Verify normal application when no human edit/revision change occurred.
5. Repeat with a human edit before completion: provider result must be retained for audit but must not overwrite human text.
6. Repeat after incrementing the source revision: result must become `STALE`.
7. Export diagnostic JSON.

## Contract
Lifecycle: `QUEUED -> RUNNING -> SUCCEEDED | FAILED | STALE`.

A result is applicable only when:
- current audio SHA-256 equals the job source hash;
- current revision equals job revision;
- target text has not been human-edited after job creation.

No network request, API key, retry loop, service worker, product runtime integration or automatic overwrite exists in this experiment.

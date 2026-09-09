# Autonomous mission prompt — QUALITY STT boundary V1

`/audit /solve /build`

Continue Offline Interview transcription requalification from the V1.2 Chrome/Edge field evidence.

Treat these conclusions as evidence-bound, not assumptions:
- Edge 152 consumes complete saved audio through `SpeechRecognition.start(audioTrack)` but repeatedly returns empty final results without error;
- trimming leading silence does not repair Edge;
- Chrome 152 can succeed on the same mechanism, but a second effective-identical run can return empty, demonstrating session-level non-determinism;
- therefore browser `start(audioTrack)` is not acceptable as the authoritative cross-browser saved-audio quality engine;
- this does not invalidate browser Web Speech as a separate LIVE best-effort UX lane.

Mission:
1. Freeze V41.x runtime and do not reintegrate any transcription change.
2. Record the engine decision explicitly.
3. Build the smallest isolated provider-neutral asynchronous QUALITY-STT handoff lab.
4. Prove immutable audio identity (SHA-256), source revision, stable idempotency key, lifecycle QUEUED/RUNNING/SUCCEEDED/FAILED/STALE, stale-result rejection and human-edit protection.
5. Keep the experiment free of network calls, credentials, service workers, retries and SpeechRecognition so orchestration is qualified independently of provider choice.
6. Add CI contract checks and publish only after exact-head validation.
7. Stop at the next genuine external-provider gate: selecting/authorizing a real quality STT engine or local model and its privacy boundary.

Return evidence, exact commit/PR/CI identities, and the smallest next gate. Do not claim provider quality before a real engine has been tested.
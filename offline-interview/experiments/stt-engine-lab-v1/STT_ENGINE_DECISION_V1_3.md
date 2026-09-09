# STT Engine Decision V1.3

Date: 2026-09-09
Status: EXPERIMENTAL DECISION — NO PRODUCT REINTEGRATION

## Question
Can browser `SpeechRecognition.start(audioTrack)` be used as the dependable saved-audio / quality transcription engine for Offline Interview across the current desktop Chromium targets?

## Field evidence

### Edge 152 — V1.2
- decoded segment: 23.04 s; peak 0.8645; leading speech 480 ms; trim offset 330 ms;
- raw R1: 8 final result events, all empty; 23.466 s total;
- raw R2: 9 final result events, all empty; 25.652 s total;
- trim R3: 8 final result events, all empty; 23.027 s total;
- all three runs: `recognitionEndedBeforeMedia=false`;
- no recognizer error.

The recognizer consumes the complete media and still returns empty final results. Premature termination and leading silence are therefore excluded as primary causes.

### Chrome 152 — V1.2
- decoded segment: 14.10 s; peak 1.0434; leading speech 140 ms; trim offset 0 ms;
- raw R1 succeeds with coherent French; first result 1.197 s; total 14.227 s;
- trim R2 has the same effective offset (`sourceOffsetMs=0`) but returns no result; total 14.164 s;
- both runs: `recognitionEndedBeforeMedia=false`;
- local fr-FR dictation model: `unavailable`.

Because raw and trim both use offset 0, the two runs are effectively repeated recognition of the same saved audio through the same engine. One succeeds and one is empty: session-level non-determinism is demonstrated.

## Decision
`SpeechRecognition.start(audioTrack)` is **REJECTED as the cross-browser authoritative saved-audio / quality STT engine**.

The evidence shows both cross-browser divergence and same-browser non-determinism. Silence trimming and recognizer-lifetime repair do not resolve the failure mode.

This does **not** reject browser Web Speech for LIVE UX transcription. LIVE remains a separate best-effort lane.

## Architectural consequence
1. LIVE lane: browser Web Speech may remain low-latency UX assistance.
2. QUALITY lane: use an engine independent of the browser SpeechRecognition service, consuming immutable saved audio asynchronously.
3. Quality results never overwrite human-edited text automatically.
4. The provider boundary must be explicit because sending audio off-device changes the privacy model.

## Next experiment
Validate the provider-neutral asynchronous QUALITY-STT handoff before selecting a provider:
- immutable segment identity and timing;
- audio SHA-256 and revision;
- stable job/idempotency key;
- lifecycle `QUEUED -> RUNNING -> SUCCEEDED | FAILED | STALE`;
- stale-result rejection;
- human-edit protection;
- retries outside live capture;
- exportable audit trail;
- no V41.x runtime modification.

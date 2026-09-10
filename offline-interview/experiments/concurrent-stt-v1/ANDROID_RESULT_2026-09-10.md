# Android concurrent STT fail-fast result — 2026-09-10

## Verdict

**FAIL_FAST for dual browser SpeechRecognition on the tested Android environment.**

The experiment tested the exact browser-native concurrency hypothesis:

- lane LIVE: microphone `SpeechRecognition`;
- lane BACKGROUND: a second `SpeechRecognition` fed with a previously recorded audio `MediaStreamTrack`;
- both requested concurrently.

## Observed evidence

User field log:

```text
{"t":14823,"type":"live_start_requested"}
{"t":14832,"type":"live_start"}
{"t":16077,"type":"background_start_requested","trackKind":"audio","durationMs":7260}
{"t":16080,"type":"live_error","error":"aborted","message":""}
{"t":16080,"type":"live_end"}
{"t":16125,"type":"background_start"}
{"t":18088,"type":"background_result","text":"test"}
{"t":18879,"type":"background_result","text":"test d'enregistrement"}
{"t":18957,"type":"background_result","text":"test d'enregistrement"}
{"t":18958,"type":"background_end"}
```

Timing is discriminating: LIVE was aborted about **3 ms** after the BACKGROUND start request, before BACKGROUND reported its own `start`. BACKGROUND then transcribed the saved clip successfully.

This matches the experiment's predefined FAIL_FAST criterion: starting the background lane aborts/errors the live lane.

## Decision

For Android, do **not** integrate two simultaneous browser `SpeechRecognition` instances into Offline Interview.

This does not prove that true parallel transcription is impossible. It disproves the specific same-browser/same-Web-Speech-engine architecture on the tested Android stack.

The qualified product path remains unchanged. Audio remains authoritative and LIVE transcription remains best-effort. No production or beta runtime is modified by this experiment.

## Next architecture discriminator

If true simultaneous background transcription is still required, the next experiment must use an **independent transcription engine/process** rather than a second browser `SpeechRecognition` instance. The useful target architecture is:

1. LIVE browser SpeechRecognition keeps absolute priority.
2. Completed immutable audio spans are queued by `{recordingId,startMs,endMs,revision}`.
3. A separate backend/service transcribes those saved spans asynchronously.
4. Results return under a stable job identity and never overwrite human-edited text.
5. The test passes only if LIVE remains uninterrupted while the independent background job executes.

Until such an independent backend is available, the Android browser-native concurrency branch is closed as FAIL_FAST.

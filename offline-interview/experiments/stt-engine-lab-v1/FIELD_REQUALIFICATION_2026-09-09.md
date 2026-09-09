# Offline Interview — STT Engine Lab field requalification — 2026-09-09

## Scope
Application runtime remains frozen. This document concerns only the disposable STT engine lab.

## Evidence set
Two lab exports were supplied from Chromium 152 on Windows 11: Microsoft Edge 152 and Google Chrome 152.

## Findings from V1.1

### A — Capture
PASS at the instrumentation level on both browsers: master and segment MediaRecorder outputs finalize as WebM/Opus with non-zero payloads and coherent durations. Human auditory fidelity remains the authority for final A/B qualification.

### B — Segmentation
PASS at the timestamp/accounting level: consecutive boundaries are coherent and segment durations sum closely to master duration. Human replay remains required to prove semantic fidelity.

### C — LIVE SpeechRecognition, standard
PASS in these two runs on both Edge 152 and Chrome 152. Both browsers started recognition and produced substantial French text without a recognition error. The prior Edge `network` failures are therefore not deterministic and must be treated as environmental/service variability rather than a permanent lack of API support.

V1.1 had an instrumentation defect: interim hypotheses were concatenated as if independent transcript chunks. V1.2 replaces this with a result snapshot and stores final results separately.

### D — Saved-audio SpeechRecognition.start(audioTrack)
DIVERGENT.

Edge 152: multiple standard runs on several decoded segments started successfully but returned an empty final result in roughly 2–3 seconds. The local fr-FR model reported `unavailable`.

Chrome 152: saved-audio standard recognition produced French text. On-device/local recognition was also available and produced text. However V1.1 concatenated interim snapshots, making the displayed result artificially repetitive; this is an instrumentation error, not evidence of model repetition. V1.2 uses final-only accounting for saved audio.

### Manual clear/retry
PASS behaviorally: clearing saved STT results did not prevent a subsequent explicit retranscription attempt in either run. The application-level human-protection bug is therefore not intrinsic to the STT primitive.

## V1.2 experiment
V1.2 changes only the lab and tests three saved-audio variants without concurrency or retries:
1. standard raw track;
2. standard track with detected leading silence removed;
3. local dictation when available.

For each run it records decoded duration, detected leading speech, source offset, first-result latency, total latency, result count, and whether SpeechRecognition ended before the media source ended.

The recognizer is now `continuous=true`, `interimResults=false`, and is explicitly stopped at media end. This directly tests whether Edge V1.1 was terminating recognition before consuming the full track.

## Current architectural position
Do not select a final STT architecture yet. LIVE standard is viable enough to continue qualification on both browsers, but saved-audio system STT is not yet cross-browser qualified. No concurrency test is justified until the Edge saved-track failure mode is resolved or rejected.

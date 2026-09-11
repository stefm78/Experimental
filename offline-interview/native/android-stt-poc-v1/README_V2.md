# Android native STT POC v0.2.0 — field retest

Install the APK built from this branch, run the same 3-question sequence, and export the JSON.

Expected improvements versus v0.1.0:

1. The WAV master remains authoritative and continuous.
2. Text from an utterance crossing a question boundary must not jump to the next turn merely because a callback arrived later.
3. Each turn draft contains all committed segments, not only the most recent segment.
4. Partials remain visible for responsiveness but are not treated as durable committed transcript.
5. Human validation remains canonical and survives later STT.
6. The export reports `timedPartEvents`, `fallbackSegmentEvents`, and `crossBoundaryWordCount` so routing behavior is auditable.

Return the full JSON export after the run.

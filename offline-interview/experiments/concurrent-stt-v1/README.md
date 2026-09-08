# Concurrent STT fail-fast experiment

Goal: answer one question without modifying the Offline Interview runtime: can this browser/device sustain a live microphone SpeechRecognition session while a second SpeechRecognition session transcribes a saved audio track at the same time?

This experiment is intentionally isolated from production and beta application code.

## Protocol

1. Record a short 8-15 second reference clip in the page.
2. Start the concurrency test.
3. While speaking continuously into the microphone, the page starts live SpeechRecognition and simultaneously feeds the saved reference clip to a second SpeechRecognition instance through a MediaStreamTrack.
4. Observe whether both lanes complete, whether either lane raises an error or is terminated, and whether the live transcript remains responsive.

## Decision

PASS_CANDIDATE when both lanes produce text in the same overlap window without live error/end attributable to the background lane.

FAIL_FAST when starting the background lane aborts/errors the live lane, the background lane cannot start from an audio track, or the page becomes materially unresponsive.

INCONCLUSIVE when the browser does not support SpeechRecognition.start(audioTrack).

No result from this page promotes an application change by itself. It only decides whether true concurrent STT deserves a controlled integration candidate.

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

## Android field result — 2026-09-10

The tested Android environment produced a discriminating FAIL_FAST result: LIVE started successfully, the BACKGROUND start was requested, then LIVE emitted `error: aborted` and `end` about 3 ms later; BACKGROUND subsequently started and transcribed the saved clip.

Conclusion for this platform: **do not integrate two simultaneous browser SpeechRecognition instances.** See `ANDROID_RESULT_2026-09-10.md` for the field evidence and next architecture discriminator.

The harness has also been hardened so a premature LIVE error/end after BACKGROUND launch is now classified immediately as FAIL_FAST, and the saved audio source starts only after the BACKGROUND recognizer reports `onstart`, eliminating an avoidable source-start race.

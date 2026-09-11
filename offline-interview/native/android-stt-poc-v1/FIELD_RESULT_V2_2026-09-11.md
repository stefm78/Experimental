# Android native STT POC V2 — field result — 2026-09-11

## Verdict

**PASS_AUDIO_ARCHITECTURE / FAIL_TURN_ROUTING_V2**

The installed APK ran successfully on the physical Android device and confirmed the core native architecture:

- one authoritative `AudioRecord` capture;
- continuous PCM-to-WAV master recording;
- the same PCM stream fed to Android on-device `SpeechRecognizer` via `EXTRA_AUDIO_SOURCE`;
- live partial transcription remained active across the three-question session.

Observed export:

- schema: `offline-interview.android-native-stt-poc.v2`
- PCM bytes: `728320`
- T1 boundary: `0 ms`
- T2 boundary: `8698 ms`
- T3 boundary: `14527 ms`
- `timedPartEvents = 0`
- `fallbackSegmentEvents = 0`
- `crossBoundaryWordCount = 0`
- no committed segments

## Material finding

The provider emitted a long cumulative partial hypothesis whose utterance origin remained in T1. Changing the application question did not create a new provider utterance. Consequently all partials were routed to T1 even while the spoken content clearly crossed T2 and T3.

The V2 assumption that `RecognitionPart.timestampMillis`, `onSegmentResults()` or intermediate final callbacks would provide enough segmentation information is therefore not reliable on the tested device.

## Decision

V3 must make turn identity an application-controlled STT-session property rather than infer it from callback timing.

The WAV master remains continuous and authoritative. STT becomes replaceable/degradable and is rotated per question.

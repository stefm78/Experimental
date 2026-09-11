# Android native STT POC — field result — 2026-09-11

## Verdict

**PASS_ARCHITECTURE / HOLD_ROUTING_V1**

The primary architectural hypothesis is validated on the tested Android device: a single native `AudioRecord` capture can remain the authoritative audio source while the same PCM stream is fed to Android on-device `SpeechRecognizer` through `RecognizerIntent.EXTRA_AUDIO_SOURCE` in a segmented session.

Observed export:
- schema: `offline-interview.android-native-stt-poc.v1`
- audio authority: `single_AudioRecord_PCM_to_WAV`
- provider: Android on-device SpeechRecognizer via `EXTRA_AUDIO_SOURCE`
- PCM bytes: `1,315,840`
- three turn boundaries: T1 `0 ms`, T2 `12,356 ms`, T3 `21,518 ms`
- continuous partial and segment transcription was produced while the native capture remained active
- human lock on T3 survived later STT and remained canonical

## Material finding

The browser/Voice Access problem is no longer the limiting factor. Native single-capture + injected-audio STT works on the field device.

The remaining defect is in **application transcript assembly/routing**, not microphone coexistence:

1. V1 routed every callback using callback arrival time. A speech segment that started before a question boundary but was finalized after the boundary could therefore be assigned to the next turn.
2. V1 stored only the latest segment as the turn draft, so earlier committed segments were lost from the displayed/exported draft.
3. Partial hypotheses were treated too much like durable transcript state.

Example from the field result: the phrase beginning `pour pour le mettre sous la carte` started under T1, but partial callbacks arriving just after the `12,356 ms` boundary were labelled T2. This is callback-time leakage, not evidence that the STT engine listened to the wrong audio.

## V2 corrective design

- Keep exactly one authoritative `AudioRecord` + WAV path.
- Treat partial results as ephemeral display hypotheses.
- Persist/aggregate only segment/final results.
- On API 34+, request `RecognitionPart` word timing and route each word using `RecognitionPart.timestampMillis`, which is an offset from recognition-session start.
- If word timing is unavailable, route a completed segment to the turn where `onBeginningOfSpeech()` occurred rather than where the callback arrived.
- Aggregate committed segments per turn instead of replacing the whole draft with the latest segment.
- Preserve human canonical lock as higher authority than any later STT.
- Export routing diagnostics (`timedPartEvents`, fallback events, cross-boundary words) so the next field run can prove which routing mode actually executed.

## Next gate

Install/build POC version `0.2.0`, repeat the same three-question field test, and return the JSON export. PASS requires:
- authoritative WAV remains intact;
- no callback-time turn leakage;
- each turn draft contains all committed segments, not only the last one;
- human lock remains immutable;
- export reports the routing mode used on the device.

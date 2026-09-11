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

The remaining defect is in application transcript assembly/routing, not microphone coexistence:

1. V1 routed callbacks using callback arrival time. A speech segment that started before a question boundary but was finalized after it could be assigned to the next turn.
2. V1 stored only the latest segment as the turn draft, so earlier committed segments were lost.
3. Partial hypotheses were treated too much like durable state.

## V2 corrective design

- Keep one authoritative `AudioRecord` + WAV path.
- Treat partials as ephemeral display hypotheses.
- Persist/aggregate segment/final results.
- API 34+: route `RecognitionPart` words using `timestampMillis` audio offsets.
- If word timing is unavailable, route a completed segment to the turn active at `onBeginningOfSpeech()`.
- Preserve human canonical lock above later STT.
- Export routing diagnostics.

## Next gate

Install POC version `0.2.0`, repeat the same 3-question field test, and return the JSON export. PASS requires WAV continuity, no callback-time turn leakage, aggregate drafts, preserved human lock, and auditable routing mode.

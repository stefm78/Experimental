# Native STT routing v2

Field result v1 validated the native single-capture architecture. Remaining defect: transcript callbacks were routed by callback arrival time and turn drafts retained only the latest segment.

V2 rules:

- Audio authority remains one `AudioRecord` PCM stream written to WAV and simultaneously injected into on-device `SpeechRecognizer`.
- Partial hypotheses are display-only and are not durable committed transcript state.
- Segment/final results are accumulated instead of replacing previous committed text.
- API 34+ requests word timing. When `SpeechRecognizer.RECOGNITION_PARTS` supplies `RecognitionPart.timestampMillis`, each recognized word is routed using its audio-time offset from recognition-session start.
- If word timing is unavailable, a completed segment is routed to the turn active at `onBeginningOfSpeech()`, not the turn active when the callback arrives.
- Human lock remains canonical and cannot be overwritten by later STT.
- Export includes routing diagnostics so the physical-device run can prove whether timed-word routing or utterance-origin fallback was used.

Success gate: repeat the three-question test on the device and return schema `offline-interview.android-native-stt-poc.v2`. WAV continuity, aggregate drafts, boundary routing, and human lock must all pass.

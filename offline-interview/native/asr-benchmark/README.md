# Native ASR Acceptance Benchmark

## Purpose

This benchmark answers one product question: **is the platform-native speech recognizer already good enough for Offline Interview?** It is not an academic ASR bake-off and it does not attempt to improve recognition.

The frozen corpus is `fr-FR-v1.json`. It is intentionally platform-neutral so Android and iOS can later run the same texts, annotations, normalization rules and acceptance gates.

## Primary Android mode

`ANDROID_SYSTEM_DEFAULT`

- `SpeechRecognizer.createSpeechRecognizer(context)`
- microphone input managed by the Android recognition service
- `fr-FR`
- `LANGUAGE_MODEL_FREE_FORM`
- partials recorded for latency/observability
- final result is the scoring authority
- no `EXTRA_AUDIO_SOURCE`
- no `EXTRA_PREFER_OFFLINE`
- no Vosk, Whisper, sherpa-onnx or bundled ASR model

`SpeechRecognizer.isOnDeviceRecognitionAvailable()` is recorded only as device capability. An explicit on-device-only campaign is a separate future benchmark if privacy/offline requirements make it necessary.

## Frozen corpus

Six passages, about 250–350 normalized words total:

1. everyday French
2. numbers, dates, times and amounts
3. proper nouns and locations
4. professional/technical vocabulary
5. complex conversational French
6. product stress: version, ticket, port, HTTP code and other exact values

Do not edit `fr-FR-v1.json` after physical results exist. Create a new corpus version instead.

## Scoring

Primary metric: normalized WER = `(substitutions + deletions + insertions) / reference words`.

Secondary metrics:

- CER
- critical-entity accuracy by category (`number`, `dateTime`, `properNoun`, `technicalTerm`, `acronym`)
- partial/final counts
- time to first partial
- time from end-of-speech to final result
- total recognition latency
- provider/system errors
- completion ratio

Punctuation is reported separately and excluded from lexical WER.

Deterministic aliases make semantically equivalent benchmark values comparable, for example `14 h 35`, `14 heures 35` and `quatorze heures trente-cinq`.

The platform-neutral reference scorer is `score-native-asr.mjs`.

## Product acceptance gate

`PASS_NATIVE_ASR` requires all of:

- 100% passages have a final result
- no blocking recognizer error
- global normalized WER <= 10%
- critical-entity accuracy >= 90%
- everyday-French WER <= 8%

`PASS_WITH_LIMITATIONS` requires all finals/no blocking error, global WER <= 15% and critical entities >= 80%.

`HOLD_NATIVE_ASR` means the system is operational but the quality/reliability evidence is insufficient. `FAIL_NATIVE_ASR` means the native path is not acceptable for this campaign.

These are Offline Interview product gates, not universal ASR-quality claims.

## Physical protocol

For each displayed passage:

1. tap **Démarrer la lecture**;
2. read the text naturally once;
3. wait for Android's final result;
4. tap **Suivant**.

Do not impose a speaking rate and do not deliberately create errors. A recognizer error counts in the primary campaign; do not silently repeat the passage unless the campaign is explicitly restarted.

After the sixth passage, save the generated `offline-interview.native-asr-benchmark-result.v1` JSON.

## Future iOS portability

An iOS implementation should preserve corpus IDs, raw reference strings, annotations, normalization, metrics and verdict gates. The primary comparison should be `ANDROID_SYSTEM_DEFAULT` versus `IOS_SYSTEM_DEFAULT`. Explicit on-device-only modes remain separate dimensions rather than being mixed into the primary score.

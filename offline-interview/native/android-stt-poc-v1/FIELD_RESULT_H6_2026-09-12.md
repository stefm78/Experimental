# Offline Interview Android — H6 composite physical field result — 2026-09-12

## Authority

Physical-device result JSON supplied by the user is the authority for this gate.

Candidate identity:
- app build: `android-native-0.4.5-h6-tactical`
- runtime schema: `offline-interview.android-native-runtime.v6.0`
- session: `e16b7e1f-093d-4dfa-86cb-f5fc4c22261a`

## Composite verdict

`HOLD_H6 / MASTER_AUDIO_PASS / PROVIDER_LIFECYCLE_PASS / FINALIZATION_FAIL / STT_DELIVERY_Q01_FAIL`

H6 materially improves provider lifecycle behavior over H5 but does not achieve provider finalization.

Observed:
- 5/5 questions answered;
- master PCM/WAV authority remained active: `pcmBytes=1,525,120`, duration about `47.66 s`;
- `sttDegraded=false`;
- zero provider errors 5, 8 or 11;
- zero retries on every question;
- zero provider finals on all five questions;
- zero provider segments on all five questions;
- all five finalizations ended by the 900 ms bounded EOF timeout and partial fallback;
- `finalizationFallbackCount=5`;
- `droppedSttPcmChunks=53`, all observed on Q01; Q02-Q05 each reported zero STT PCM drop;
- H6 partial-event telemetry array was empty despite non-zero partial counts because the rate-limit sentinel used `Long.MIN_VALUE`, whose subtraction overflows on the first event and causes every partial event to be discarded from telemetry.

Per-turn summary:

| Question | Attempts | Partials | Finals | Segments | Provider errors | STT PCM drops | Finalization |
| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |
| Q01 | 1 | 10 | 0 | 0 | none | 53 | `eof_timeout_partial_fallback` ~901 ms |
| Q02 | 1 | 58 | 0 | 0 | none | 0 | `eof_timeout_partial_fallback` ~902 ms |
| Q03 | 1 | 24 | 0 | 0 | none | 0 | `eof_timeout_partial_fallback` ~901 ms |
| Q04 | 1 | 24 | 0 | 0 | none | 0 | `eof_timeout_partial_fallback` ~900 ms |
| Q05 | 1 | 36 | 0 | 0 | none | 0 | `eof_timeout_partial_fallback` ~900 ms |

## New historical regression finding

The original Android V1 implementation, commit `f85b7c58b9a0804f27dddeb658f9e212d381b75d`, explicitly set:

`RecognizerIntent.EXTRA_SEGMENTED_SESSION = RecognizerIntent.EXTRA_AUDIO_SOURCE`

Its physical field result recorded continuous partial **and segment** transcription.

The later per-turn V3/H4/H5/H6 path retained `EXTRA_AUDIO_SOURCE` but omitted `EXTRA_SEGMENTED_SESSION`. This is a concrete semantic regression aligned with the H4-H6 symptom `segmentCount=0`.

Therefore H6 does **not** justify `FAIL_STRATEGY` yet. There is one bounded, evidence-backed successor worth testing before abandoning Android system STT: restore segmented injected-audio mode while preserving the qualified per-turn routing and nonblocking audio architecture.

## H7 bounded corrective design

H7 must:
1. preserve H4/H6 single `AudioRecord` -> continuous WAV authority;
2. preserve disposable feeder ownership of blocking STT writes;
3. preserve per-turn recognizer/session identity;
4. preserve EOF-driven finalization and provider cooldown;
5. restore `EXTRA_SEGMENTED_SESSION = EXTRA_AUDIO_SOURCE` exactly as in V1;
6. enlarge the bounded STT queue to absorb the Q01 provider-startup backlog without changing master-audio semantics;
7. export queue high-water marks and all drop counts;
8. fix first-partial telemetry rate limiting without changing recognition behavior;
9. run one composite five-question physical test only.

## Decision rule after H7

- `PASS_SYSTEM_STT_SEGMENTED` if H7 preserves master stability, removes material PCM loss, and produces durable provider segment/final results on a meaningful fraction of turns without provider lifecycle regressions.
- `HOLD` only if H7 shows a material but incomplete provider improvement that identifies one concrete, bounded remaining defect.
- `FAIL_STRATEGY` if the restored segmented mode still produces zero durable provider results across all turns (or otherwise remains product-unsuitable) without a new concrete regression to repair. In that case stop incremental SpeechRecognizer timing/lifecycle patches and move to the README's pre-declared embedded-ASR fallback while retaining the same AudioRecord/WAV authority.

# Android native H2 — physical-device result — 2026-09-11

## Verdict

**PASS_BUILD_IDENTITY / PASS_AUDIO_AUTHORITY / PASS_ROUTING_ISOLATION / FAIL_COMPLETION_Q02 / FAIL_PROVIDER_BUSY / HOLD_H2**

The physical phone ran the tactical H2 productization build and exported a valid `offline-interview.interview-result.v1` result.

Observed identity:

- `provenance.appBuild = android-native-0.4.1-h2-tactical`
- `nativeCapture.schema = offline-interview.android-native-runtime.v4.1`
- `nativeCapture.appVersion = 0.4.1-h2-tactical`
- audio authority remained `single_AudioRecord_PCM_to_WAV`
- routing authority remained `stt_session_identity`

Observed session:

- session id `a8987be3-ff92-4ccf-b365-4833c693d589`
- continuous PCM bytes: `786560`
- audio duration: `24580 ms`
- five question boundaries were present
- completion: `4/5`
- `sttDegraded = true`

Per-turn evidence:

- Q01: 14 partial callbacks; transcript retained (`depuis`)
- Q02: 0 partial callbacks; no answer turn retained
- Q03: 15 partial callbacks; transcript retained
- Q04: 12 partial callbacks; transcript retained
- Q05: 13 partial callbacks; transcript retained

## Material failure

Immediately after the Q01 -> Q02 boundary (`5382 ms`), Q02 emitted `error=8` at `5397 ms`, only about 15 ms after the transition. Android `SpeechRecognizer.ERROR_RECOGNIZER_BUSY` is error code 8.

The H2 implementation created/started the new question recognizer before closing the previous recognizer. The physical evidence is therefore consistent with provider contention during overlapping recognizer ownership.

A later expected teardown `ERROR_CLIENT (5)` overwrote Q02's session-level `providerError`, while the transcript event still preserved the earlier `error=8`. This is an observability defect because it hides the first material provider failure in the session summary.

## Decision

Do not merge H2 or productization based on this run.

H3 must remain bounded:

1. keep the authoritative `AudioRecord` / WAV uninterrupted;
2. snapshot and close the old turn;
3. cancel/destroy the old recognizer and close its read descriptor;
4. only then create/start the new turn recognizer;
5. preserve the first material provider error so a later expected teardown cannot overwrite it;
6. retain NO_MATCH bounded rearm semantics and human-lock precedence.

## H3 physical gate

PASS requires:

- `appBuild = android-native-0.4.2-h3-tactical`;
- runtime schema `offline-interview.android-native-runtime.v4.2`;
- 5/5 answers when speech is supplied for all five questions;
- no `error=8` at question boundaries;
- no cross-question transcript migration;
- WAV continuous with non-zero PCM;
- `sttDegraded=false` unless a genuinely unrecovered provider failure occurs;
- if an unexpected provider error occurs, `sttSessions[].providerError` must preserve that causal error even if an expected teardown error follows.

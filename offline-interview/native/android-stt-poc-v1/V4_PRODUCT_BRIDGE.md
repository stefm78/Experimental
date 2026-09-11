# Android Native Runtime V4 — product contract bridge

## Objective

Move the physically-qualified V3 audio/STT architecture from a three-question routing POC toward a usable Offline Interview native client without changing the qualified capture invariant.

## Preserved qualified invariant

- one continuous authoritative `AudioRecord`;
- one local PCM/WAV master for the interview;
- one Android on-device `SpeechRecognizer` / `EXTRA_AUDIO_SOURCE` session per question;
- routing authority is STT-session identity, never callback arrival time;
- `human_lock` remains canonical over later STT callbacks;
- STT failure never invalidates the master WAV.

## V4 product bridge

APK `0.4.0` now:

1. consumes `offline-interview.interview-spec.v1`;
2. bundles the platform demonstration `interview.json` as its default spec;
3. lets the user open another JSON questionnaire through Android's document picker;
4. registers as an Android viewer for `application/json`, enabling compatible JSON files/links to be opened with the app when Android resolves that MIME type;
5. flattens the platform section/question model only for runtime navigation while preserving the original sections/questions in export;
6. uses the interview spec language for Android on-device speech recognition;
7. keeps the V3 per-question STT session rotation for an arbitrary number of questions;
8. exports top-level `offline-interview.interview-result.v1` with interview metadata, participants, session/completion data, original sections/questions and answer turns;
9. embeds native-only observability under `nativeCapture` rather than replacing the product result contract;
10. lets the user save the result JSON through Android's document creator.

## ERROR_CLIENT teardown classification

Physical V3 evidence showed Android `SpeechRecognizer.ERROR_CLIENT` (`5`) only immediately after intentional STT-session teardown.

V4 retains the raw provider error but classifies error 5 as `expected_teardown_error` only when all of the following are true:

- the STT session is already marked closed;
- its close reason is `turn_boundary` or `interview_stop`;
- the provider error is `SpeechRecognizer.ERROR_CLIENT`.

Such an event does **not** set `sttDegraded=true`. Any other provider error remains `unexpected_provider_error` and degrades STT while preserving the WAV master.

## Qualification gates

### CI gate

- Android debug APK compiles;
- APK exists and is uploaded by the existing workflow;
- existing Offline Interview regression workflow remains green.

### Physical V4 gate

Use either the bundled five-question demonstration or a valid externally loaded `interview-spec.v1`.

PASS requires:

- correct interview title/question IDs shown in the native UI;
- navigation covers every question in spec order;
- each answer remains attached to its question after boundary transitions;
- local WAV remains continuous/non-zero;
- top-level export schema is `offline-interview.interview-result.v1`;
- exported interview id/title and sections/questions match the loaded spec;
- answer turns contain the expected question id and interviewee provenance;
- `nativeCapture.routingAuthority == stt_session_identity`;
- expected teardown error 5, if emitted, is classified `expected_teardown_error` and does not alone set `sttDegraded`;
- JSON can be saved through the Android document flow.

No claim of physical V4 qualification is allowed before this phone test.

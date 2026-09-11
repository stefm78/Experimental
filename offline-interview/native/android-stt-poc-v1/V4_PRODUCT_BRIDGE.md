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

## Android signing migration

A physical V4 installation attempt exposed a separate distribution defect in the historical workflow: it built `assembleDebug` on fresh GitHub-hosted runners without a pinned signing key. The installed historical APK and later APK can therefore have the same package ID and increasing version codes but different signing certificates. Android recognizes the package as an update candidate, then rejects installation because the signing identity changed.

The historical V3 private debug key was not persisted. It cannot be reconstructed from the installed APK certificate, so a signature-compatible in-place upgrade from that installed copy is not recoverable.

A durable signing identity has now been generated outside the public repository. Certificate SHA-256:

`D7:C1:15:C8:D9:13:55:BF:E0:8C:B7:DE:7D:DF:CF:69:85:8A:5D:7A:9B:88:22:21:57:FA:4B:B7:3F:F0:41:85`

Gradle and CI now support this durable identity via GitHub Actions secrets. If those secrets are absent, CI may compile but labels the APK `UNSTABLE-SIGNATURE-do-not-update`; such an APK is compile-only and must not be distributed as an Android update.

See `ANDROID_SIGNING_MIGRATION.md`.

## Qualification gates

### CI gate

- Android debug APK compiles;
- APK exists;
- existing Offline Interview regression workflow remains green;
- an APK is distributable only when the durable signing secrets are present and the pinned certificate fingerprint matches.

### Durable-signing bootstrap gate

`HOLD_DURABLE_SIGNING_BOOTSTRAP`

Lift only when:

- the four durable signing secrets are configured;
- CI restores the expected key and verifies the pinned SHA-256 fingerprint;
- CI reports `DISTRIBUTABLE_APK=true`;
- the produced APK is the one used for the migration install.

Because the currently installed historical V3 is signed by a lost ephemeral key, one uninstall/reinstall is unavoidable when moving to the durable identity. This should be the last forced reinstall caused by signing identity; subsequent versions signed by the durable key can update normally subject to Android version-code rules.

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

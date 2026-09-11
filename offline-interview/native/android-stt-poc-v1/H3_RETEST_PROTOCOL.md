# Android native H3 — physical retest protocol

Install mode remains tactical: uninstall the previous tactical app before installing H3.

1. Install `0.4.2-h3-tactical` (`versionCode 8`).
2. Run the bundled five-question interview.
3. Speak a distinct short answer for every question, especially Q01 and Q02.
4. Move through Q01 -> Q05 at a normal pace; do not intentionally pause between questions just to help the recognizer.
5. Finish and save the result JSON.
6. Optionally export the diagnostic bundle from `00 Offline Interview Diagnostic`.

PASS requires:

- `provenance.appBuild = android-native-0.4.2-h3-tactical`;
- `nativeCapture.schema = offline-interview.android-native-runtime.v4.2`;
- `answeredQuestions = 5` and `unansweredQuestions = 0`;
- each Q01-Q05 has its own answer and no answer migrates to another question;
- no `error=8` / recognizer-busy event at a turn boundary;
- `pcmBytes > 0` and continuous WAV authority remains intact;
- `sttDegraded = false` when only expected teardown events occur;
- no UI freeze during finalization or save.

Return the complete saved result JSON. If available, also return the diagnostic bundle JSON.

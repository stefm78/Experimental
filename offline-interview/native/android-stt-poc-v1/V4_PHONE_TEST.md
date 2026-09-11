# Android Native V4 — minimal physical qualification

## APK

Version: `0.4.0` (`versionCode 4`)

## Prerequisite — durable signing migration

Do **not** use an artifact named `UNSTABLE-SIGNATURE-do-not-update` for this phone test.

The historical installed V3/V4 debug APK was signed by a runner-local debug key that was not retained. Android cannot update that installation with the new durable signing identity.

Before testing V4 product behavior:

1. configure the durable Android signing secrets described in `ANDROID_SIGNING_MIGRATION.md`;
2. obtain `offline-interview-android-native-durable-debug` from a workflow reporting `DISTRIBUTABLE_APK=true`;
3. uninstall the historical ephemeral-signed installation once;
4. install the durable-signed V4 APK.

Future builds signed with the same durable identity should then install as normal updates.

## Goal

Validate only the new V4 product bridge. V3 audio/STT per-turn routing is already physically qualified.

## Test A — bundled real interview spec

1. Open durable-signed APK 0.4.0.
2. Confirm the title is `Entretien de démonstration`.
3. Confirm first question metadata contains `Contexte · Q01 · 1/5`.
4. Start interview.
5. Say for Q01: `alpha réponse question un alpha`.
6. Tap **Question suivante**.
7. Say for Q02: `bravo réponse question deux bravo`.
8. Tap **Question suivante** until Q05, saying one short distinct marker for each question (for example `charlie trois`, `delta quatre`, `echo cinq`).
9. On Q05 optionally press **Valider le texte humain**.
10. Press **Terminer**.
11. Confirm the displayed JSON has top-level schema `offline-interview.interview-result.v1`.
12. Press **Enregistrer le résultat JSON** and save it once.
13. Return the complete displayed/saved JSON.

## Expected PASS evidence

- `provenance.appBuild == android-native-0.4.0`;
- `interview.id == demo-fr-v2`;
- `session.completion.totalQuestions == 5`;
- `sections` preserve Q01..Q05;
- each answered question has a turn whose `questionId` matches the source question;
- markers do not migrate to another question;
- `nativeCapture.schema == offline-interview.android-native-runtime.v4`;
- `nativeCapture.routingAuthority == stt_session_identity`;
- `nativeCapture.pcmBytes > 0`;
- if provider error `5` appears after intentional question teardown, its `providerErrorClass` is `expected_teardown_error` and `sttDegraded` remains false unless another unexpected STT failure occurred;
- saved JSON is readable after Android document creation.

## Optional Test B — external spec loading

Only after Test A passes:

1. Tap **Charger un questionnaire JSON**.
2. Select any valid `offline-interview.interview-spec.v1` file.
3. Confirm title/question count changes to the selected spec.
4. One short two-question run is enough to qualify external loading.

Test B is desirable but does not block the first V4 architectural promotion if Test A proves the platform contract bridge and no defect appears in the loader UI.

## FAIL conditions

- hardcoded three-question flow reappears;
- title/question IDs do not match the bundled platform spec;
- answer migrates to another question;
- export is not `offline-interview.interview-result.v1`;
- result cannot be saved;
- master WAV is empty or native capture fails;
- teardown-only error 5 still incorrectly sets `sttDegraded=true`.

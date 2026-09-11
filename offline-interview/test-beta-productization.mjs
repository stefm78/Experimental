import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const webSpec = json('offline-interview/interview.json');
const betaSpec = json('offline-interview/beta/interview.json');
const androidSpec = json('offline-interview/native/android-stt-poc-v1/app/src/main/assets/interview.json');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');
const main = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/MainActivity.kt');
const workflow = read('.github/workflows/android-native-stt-poc.yml');
const directLink = read('offline-interview/beta/direct-interview-link.js');

for (const [name, spec] of [['web', webSpec], ['beta', betaSpec], ['android', androidSpec]]) {
  assert.equal(spec.schema, 'offline-interview.interview-spec.v1', `${name}: wrong schema`);
  assert.ok(spec.id, `${name}: missing id`);
  assert.equal(spec.language, 'fr-FR', `${name}: expected fr-FR fixture`);
  assert.ok(Array.isArray(spec.sections) && spec.sections.length > 0, `${name}: sections missing`);
  const ids = spec.sections.flatMap(s => (s.questions || []).map(q => q.id));
  assert.equal(new Set(ids).size, ids.length, `${name}: duplicate question ids`);
  assert.ok(ids.length >= 5, `${name}: expected multi-question product fixture`);
}

assert.match(manifest, /android:label="00 Offline Interview Native"/);
assert.match(gradle, /versionCode\s*=\s*8/);
assert.match(gradle, /versionName\s*=\s*"0\.4\.2-h3-tactical"/);
assert.match(main, /offline-interview\.android-native-runtime\.v4\.2/);
assert.match(main, /BuildConfig\.VERSION_NAME/);
assert.match(main, /single_AudioRecord_PCM_to_WAV/);
assert.match(main, /stt_session_identity/);
assert.match(main, /recoverable_no_match/);
assert.match(main, /ERROR_RECOGNIZER_BUSY \(8\)/);
assert.match(main, /retireRecognizer\(sttSessions\[oldTurn\]\)/);
assert.match(main, /Preserve the first material provider error/);

const nextTurnBody = main.slice(main.indexOf('private fun nextTurn()'), main.indexOf('private fun snapshotPartialAtClose'));
assert.ok(nextTurnBody.indexOf('closeTurnSession(oldTurn') < nextTurnBody.indexOf('createTurnSttSession(newTurn'), 'H3 must close the previous STT session before creating the next one');
assert.ok(nextTurnBody.indexOf('retireRecognizer(sttSessions[oldTurn])') < nextTurnBody.indexOf('createTurnSttSession(newTurn'), 'H3 must destroy the previous recognizer before creating the next one');

assert.match(workflow, /offline-interview-android-native-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(workflow, /offline-interview-android-native-durable-debug/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: web/beta/android schemas, H3 serialized STT handoff, routing invariants, direct-link and distribution policy.');

import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const webSpec = json('offline-interview/interview.json');
const betaSpec = json('offline-interview/beta/interview.json');
const androidSpec = json('offline-interview/native/android-stt-poc-v1/app/src/main/assets/interview.json');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');
const h4 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H4MainActivity.kt');
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

assert.match(manifest, /android:name="\.H4MainActivity"/);
assert.match(manifest, /android:label="00 Offline Interview Native"/);
assert.match(gradle, /versionCode\s*=\s*9/);
assert.match(gradle, /versionName\s*=\s*"0\.4\.3-h4-tactical"/);
assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /BuildConfig\.VERSION_NAME/);
assert.match(h4, /single_AudioRecord_PCM_to_WAV/);
assert.match(h4, /stt_session_identity/);
assert.match(h4, /ArrayBlockingQueue/);
assert.match(h4, /pcmQueue\.offer\(copy\)/);
assert.match(h4, /private fun sttFeederLoop/);
assert.match(h4, /ERROR_SERVER_DISCONNECTED/);
assert.match(h4, /STT_HANDOFF_DELAY_MS/);
assert.match(h4, /TRANSIENT_REARM_DELAY_MS/);
assert.match(h4, /droppedSttPcmChunks/);

const capture = h4.slice(h4.indexOf('private fun captureLoop()'), h4.indexOf('private fun beginPendingWindow'));
assert.doesNotMatch(capture, /sink\.write/,
  'H4 master capture loop must never write synchronously into the SpeechRecognizer pipe');
assert.match(capture, /wavRaf\?\.write/);
assert.match(capture, /pcmQueue\.offer/);

const feeder = h4.slice(h4.indexOf('private fun sttFeederLoop'), h4.indexOf('private fun captureLoop'));
assert.match(feeder, /session\.sink\.write/,
  'Only the disposable STT feeder thread may own the blocking pipe write');

assert.match(workflow, /offline-interview-android-native-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(workflow, /offline-interview-android-native-durable-debug/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: H4 nonblocking STT feed, transient provider recovery, WAV authority, routing, direct-link and distribution policy.');

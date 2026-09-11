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
const h5 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H5MainActivity.kt');
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

assert.match(manifest, /android:name="\.H5MainActivity"/);
assert.match(manifest, /android:label="00 Offline Interview Native"/);
assert.match(gradle, /versionCode\s*=\s*10/);
assert.match(gradle, /versionName\s*=\s*"0\.4\.4-h5-tactical"/);
assert.match(h5, /offline-interview\.android-native-runtime\.v5\.0/);
assert.match(h5, /single_AudioRecord_PCM_to_WAV/);
assert.match(h5, /stt_session_identity/);
assert.match(h5, /ArrayBlockingQueue/);
assert.match(h5, /private fun requestFinalization/);
assert.match(h5, /FINALIZATION_GRACE_MS/);
assert.match(h5, /finalizationOutcome/);
assert.match(h5, /partial_snapshot_at_finalize_timeout/);
assert.match(h5, /provider_final/);
assert.match(h5, /provider_segment/);
assert.match(h5, /ERROR_SERVER_DISCONNECTED/);
assert.match(h5, /droppedSttPcmChunks/);

const captureH5 = h5.slice(h5.indexOf('private fun captureLoop()'), h5.indexOf('private fun beginPendingWindow'));
assert.doesNotMatch(captureH5, /sink\.write/,
  'H5 master capture loop must preserve the H4 rule: never write synchronously to the STT pipe');
assert.match(captureH5, /wavRaf\?\.write/);
assert.match(captureH5, /pcmQueue\.offer/);

const feederH5 = h5.slice(h5.indexOf('private fun sttFeederLoop'), h5.indexOf('private fun captureLoop'));
assert.match(feederH5, /s\.sink\.write/,
  'Only the disposable feeder may own blocking STT pipe writes');

const nextTurnH5 = h5.slice(h5.indexOf('private fun nextTurn()'), h5.indexOf('private fun requestFinalization'));
assert.match(nextTurnH5, /currentTurn = newTurn/,
  'H5 must advance the user-visible turn immediately at the exact boundary');
assert.match(nextTurnH5, /beginPendingWindow\(newTurn\)/,
  'H5 must prebuffer the new turn while the old recognizer finalizes');
assert.match(nextTurnH5, /requestFinalization\(old/,
  'H5 must finalize the old recognizer asynchronously rather than cancel immediately');
assert.doesNotMatch(nextTurnH5, /Thread\.sleep|join\(/,
  'H5 turn transition must never synchronously wait on the UI thread');

// Preserve explicit H4 source as the qualified stability baseline for forensic comparison.
assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /private fun sttFeederLoop/);

assert.match(workflow, /offline-interview-android-native-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(workflow, /offline-interview-android-native-durable-debug/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: H5 bounded async STT finalization layered on the physically-qualified H4 nonblocking audio architecture.');

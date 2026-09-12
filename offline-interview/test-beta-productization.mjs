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
const h6 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H5MainActivity.kt');
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
assert.match(gradle, /versionCode\s*=\s*11/);
assert.match(gradle, /versionName\s*=\s*"0\.4\.5-h6-tactical"/);
assert.match(h6, /offline-interview\.android-native-runtime\.v6\.0/);
assert.match(h6, /single_AudioRecord_PCM_to_WAV/);
assert.match(h6, /stt_session_identity/);
assert.match(h6, /ArrayBlockingQueue/);
assert.match(h6, /private fun requestFinalization/);
assert.match(h6, /FINALIZATION_GRACE_MS/);
assert.match(h6, /PROVIDER_COOLDOWN_MS/);
assert.match(h6, /pipe_eof_no_stopListening/);
assert.match(h6, /partial_snapshot_at_eof_timeout/);
assert.match(h6, /provider_final/);
assert.match(h6, /provider_segment/);
assert.match(h6, /ERROR_SERVER_DISCONNECTED/);
assert.match(h6, /droppedSttPcmChunks/);

const captureH6 = h6.slice(h6.indexOf('private fun captureLoop()'), h6.indexOf('private fun beginPendingWindow'));
assert.doesNotMatch(captureH6, /sink\.write/,
  'H6 master capture loop must preserve H4: never write synchronously to the STT pipe');
assert.match(captureH6, /wavRaf\?\.write/);
assert.match(captureH6, /pcmQueue\.offer/);

const feederH6 = h6.slice(h6.indexOf('private fun sttFeederLoop'), h6.indexOf('private fun captureLoop'));
assert.match(feederH6, /s\.sink\.write/,
  'Only the disposable feeder may own blocking STT pipe writes');
assert.match(feederH6, /s\.sink\.close/,
  'H6 must signal end-of-audio by closing the write side of EXTRA_AUDIO_SOURCE');

const requestFinalizationH6 = h6.slice(h6.indexOf('private fun requestFinalization'), h6.indexOf('private fun completeFinalization'));
assert.doesNotMatch(requestFinalizationH6, /\.stopListening\(/,
  'H6 must not call SpeechRecognizer.stopListening during external-audio finalization');
assert.match(requestFinalizationH6, /pcmQueue\.offer\(POISON\)/,
  'H6 must drain queued PCM and signal EOF to the provider');

const nextTurnH6 = h6.slice(h6.indexOf('private fun nextTurn()'), h6.indexOf('private fun requestFinalization'));
assert.match(nextTurnH6, /currentTurn = newTurn/);
assert.match(nextTurnH6, /beginPendingWindow\(newTurn\)/);
assert.match(nextTurnH6, /requestFinalization\(old/);
assert.doesNotMatch(nextTurnH6, /Thread\.sleep|join\(/,
  'H6 UI transition must never synchronously wait');

const completeH6 = h6.slice(h6.indexOf('private fun completeFinalization'), h6.indexOf('private fun snapshotPartialAtClose'));
assert.match(completeH6, /postDelayed\(\{ continuation\.invoke\(\) \}, PROVIDER_COOLDOWN_MS\)/,
  'H6 must enforce a bounded provider cooldown before the next recognizer');

assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /private fun sttFeederLoop/);
assert.match(workflow, /offline-interview-android-native-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(workflow, /offline-interview-android-native-durable-debug/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: H6 EOF-driven bounded finalization with H4 nonblocking WAV authority and provider cooldown.');

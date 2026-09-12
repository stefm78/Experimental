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
const h7 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H7MainActivity.kt');
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

assert.match(manifest, /android:name="\.H7MainActivity"/);
assert.match(manifest, /android:label="00 Offline Interview Native"/);
assert.match(gradle, /versionCode\s*=\s*12/);
assert.match(gradle, /versionName\s*=\s*"0\.4\.6-h7-segmented-tactical"/);

// H4 remains the physical stability baseline; H6 remains retained evidence.
assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /private fun sttFeederLoop/);
assert.match(h6, /offline-interview\.android-native-runtime\.v6\.0/);
assert.match(h6, /pipe_eof_no_stopListening/);

// H7 must restore the exact segmented-session semantic that existed in the original V1.
assert.match(h7, /offline-interview\.android-native-runtime\.v7\.0/);
assert.match(h7, /RecognizerIntent\.EXTRA_SEGMENTED_SESSION/);
assert.match(h7, /RecognizerIntent\.EXTRA_AUDIO_SOURCE/);
assert.match(h7, /putExtra\(RecognizerIntent\.EXTRA_SEGMENTED_SESSION, RecognizerIntent\.EXTRA_AUDIO_SOURCE\)/);
assert.match(h7, /segmented_pipe_eof_no_stopListening/);
assert.match(h7, /provider_segment/);
assert.match(h7, /onSegmentResults/);
assert.match(h7, /onEndOfSegmentedSession/);

// Preserve single authoritative capture and H4 nonblocking feeder isolation.
assert.match(h7, /single_AudioRecord_PCM_to_WAV/);
assert.match(h7, /stt_session_identity/);
assert.match(h7, /ArrayBlockingQueue/);
const captureH7 = h7.slice(h7.indexOf('private fun captureLoop()'), h7.indexOf('private fun beginPendingWindow'));
assert.doesNotMatch(captureH7, /sink\.write/,
  'H7 master capture loop must never write synchronously to the STT pipe');
assert.match(captureH7, /wavRaf\?\.write/);
assert.match(captureH7, /offerSttChunk/);
const feederH7 = h7.slice(h7.indexOf('private fun sttFeederLoop'), h7.indexOf('private fun offerSttChunk'));
assert.match(feederH7, /s\.sink\.write/,
  'Only the disposable feeder may own blocking STT writes');

// Finalization remains EOF-driven and UI-nonblocking.
const requestH7 = h7.slice(h7.indexOf('private fun requestFinalization'), h7.indexOf('private fun completeFinalization'));
assert.doesNotMatch(requestH7, /\.stopListening\(/,
  'H7 must not reintroduce the H5 stopListening finalization path');
assert.match(requestH7, /pcmQueue\.offer\(POISON\)/);
const nextH7 = h7.slice(h7.indexOf('private fun nextTurn()'), h7.indexOf('private fun requestFinalization'));
assert.doesNotMatch(nextH7, /Thread\.sleep|join\(/,
  'H7 UI transition must never synchronously wait');
assert.match(nextH7, /beginPendingWindow\(newTurn\)/);

// H6 field evidence showed Q01 STT queue overflow. H7 must increase bounded elasticity
// and expose high-water telemetry instead of hiding provider backpressure.
assert.match(h7, /STT_QUEUE_CHUNKS = 128/);
assert.match(h7, /queueHighWaterMark/);
assert.match(h7, /sttQueueCapacityChunks/);
assert.match(h7, /droppedSttPcmChunks/);

// H6 partial-event telemetry was empty because Long.MIN_VALUE subtraction overflowed.
// H7 must rate-limit only when a prior timestamp actually exists.
assert.match(h7, /previousAt != null && e\.callbackAtMs - previousAt < PARTIAL_TELEMETRY_MIN_INTERVAL_MS/);
assert.doesNotMatch(h7, /Long\.MIN_VALUE/,
  'H7 partial telemetry must not use an overflow-prone Long.MIN_VALUE sentinel');

assert.match(workflow, /offline-interview-android-native-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(workflow, /offline-interview-android-native-durable-debug/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: H7 restores segmented injected-audio sessions while preserving H4/H6 audio stability and bounded handoff.');

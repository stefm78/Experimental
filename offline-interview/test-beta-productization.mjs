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
const lab = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/EmbeddedAsrLabActivity.kt');
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

assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /single_AudioRecord_PCM_to_WAV/);
assert.match(h4, /private fun sttFeederLoop/);

assert.match(manifest, /android:name="\.EmbeddedAsrLabActivity"/);
assert.match(manifest, /android:label="00 Offline Interview Embedded ASR Lab"/);
assert.match(gradle, /versionCode\s*=\s*13/);
assert.match(gradle, /versionName\s*=\s*"0\.5\.0-vosk-lab-tactical"/);
assert.match(gradle, /com\.alphacephei:vosk-android:0\.3\.75@aar/);
assert.match(gradle, /net\.java\.dev\.jna:jna:5\.18\.1@aar/);

assert.match(lab, /offline-interview\.android-embedded-asr-lab\.v1/);
assert.match(lab, /single_AudioRecord_PCM_to_WAV/);
assert.match(lab, /turn_pcm_snapshot_at_ui_boundary/);
assert.match(lab, /vosk-model-small-fr-0\.22/);
assert.match(lab, /cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad/);
assert.match(lab, /runtimeNetworkRequired"\s*,\s*false/);
assert.match(lab, /private fun transcribeTurn/);
assert.match(lab, /Recognizer\(m, SAMPLE_RATE\.toFloat\(\)\)/);
assert.match(lab, /recognizer\.acceptWaveForm/);
assert.match(lab, /recognizer\.finalResult/);
assert.match(lab, /asrExecutor\.execute/);
assert.doesNotMatch(lab, /import\s+android\.speech\.|SpeechRecognizer\.|RecognizerIntent\./,
  'Embedded ASR experiment must not invoke Android SpeechRecognizer APIs');

const capture = lab.slice(lab.indexOf('private fun captureLoop()'), lab.indexOf('private fun nextTurn()'));
assert.match(capture, /wavRaf\?\.write/);
assert.match(capture, /turnPcmChunks\[currentTurn\]\.add\(copy\)/);
assert.doesNotMatch(capture, /Recognizer\(|acceptWaveForm|transcribeTurn/,
  'Authoritative capture loop must never perform ASR inference');

const transcribe = lab.slice(lab.indexOf('private fun transcribeTurn'), lab.indexOf('private fun parseVoskText'));
assert.match(transcribe, /Recognizer\(/);
assert.match(transcribe, /acceptWaveForm/);
assert.match(transcribe, /finalResult/);

assert.match(workflow, /vosk-model-small-fr-0\.22\.zip/);
assert.match(workflow, /cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad/);
assert.match(workflow, /sha256sum --check --strict/);
assert.match(workflow, /offline-interview-android-embedded-asr-vosk-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS beta productization contract: isolated Vosk embedded-ASR lab preserves H4 WAV authority and removes Android SpeechRecognizer from durable transcription.');

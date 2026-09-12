import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const webSpec = json('offline-interview/interview.json');
const betaSpec = json('offline-interview/beta/interview.json');
const androidSpec = json('offline-interview/native/android-stt-poc-v1/app/src/main/assets/interview.json');
const corpus = json('offline-interview/native/asr-benchmark/fr-FR-v1.json');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');
const h4 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H4MainActivity.kt');
const benchmark = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkActivity.kt');
const workflow = read('.github/workflows/android-native-stt-poc.yml');
const directLink = read('offline-interview/beta/direct-interview-link.js');

for (const [name, spec] of [['web', webSpec], ['beta', betaSpec], ['android', androidSpec]]) {
  assert.equal(spec.schema, 'offline-interview.interview-spec.v1', `${name}: wrong schema`);
  assert.ok(spec.id, `${name}: missing id`);
  assert.equal(spec.language, 'fr-FR', `${name}: expected fr-FR fixture`);
  assert.ok(Array.isArray(spec.sections) && spec.sections.length > 0, `${name}: sections missing`);
}

// H4 remains the historical audio-stability baseline; this benchmark does not mutate it.
assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /single_AudioRecord_PCM_to_WAV/);

assert.equal(corpus.id, 'fr-FR-v1');
assert.equal(corpus.status, 'FROZEN');
assert.equal(corpus.passages.length, 6);
assert.match(manifest, /android:name="\.NativeAsrBenchmarkActivity"/);
assert.match(manifest, /android:label="00 Native ASR Benchmark"/);
assert.match(gradle, /versionCode\s*=\s*15/);
assert.match(gradle, /versionName\s*=\s*"0\.6\.0-native-asr-benchmark-tactical"/);
assert.match(benchmark, /ANDROID_SYSTEM_DEFAULT/);
assert.match(benchmark, /SpeechRecognizer\.createSpeechRecognizer/);
assert.match(benchmark, /offline-interview\.native-asr-benchmark-result\.v1/);
assert.match(benchmark, /PASS_NATIVE_ASR/);
assert.match(benchmark, /PASS_WITH_LIMITATIONS/);
assert.match(benchmark, /HOLD_NATIVE_ASR/);
assert.match(benchmark, /FAIL_NATIVE_ASR/);
assert.doesNotMatch(benchmark, /putExtra\(RecognizerIntent\.EXTRA_AUDIO_SOURCE/);
assert.doesNotMatch(benchmark, /putExtra\(RecognizerIntent\.EXTRA_PREFER_OFFLINE/);
assert.doesNotMatch(gradle, /vosk|sherpa|whisper/i);
assert.match(workflow, /offline-interview-android-native-asr-benchmark-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(directLink, /URLSearchParams|searchParams/);

console.log('PASS beta productization contract: frozen native-ASR acceptance benchmark uses Android system-default microphone recognition without embedded ASR models.');

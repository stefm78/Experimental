import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const webSpec = json('offline-interview/interview.json');
const betaSpec = json('offline-interview/beta/interview.json');
const androidSpec = json('offline-interview/native/android-stt-poc-v1/app/src/main/assets/interview.json');
const corpus = json('offline-interview/native/asr-benchmark/fr-FR-v1.json');
const policy = json('offline-interview/native/asr-benchmark/fr-FR-v1-scoring-v3.json');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');
const h4 = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/H4MainActivity.kt');
const benchmark = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkV3Activity.kt');
const accumulator = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/RecognitionSessionAccumulator.kt');
const workflow = read('.github/workflows/android-native-stt-poc.yml');
const directLink = read('offline-interview/beta/direct-interview-link.js');

for (const [name, spec] of [['web', webSpec], ['beta', betaSpec], ['android', androidSpec]]) {
  assert.equal(spec.schema, 'offline-interview.interview-spec.v1', `${name}: wrong schema`);
  assert.ok(spec.id, `${name}: missing id`);
  assert.equal(spec.language, 'fr-FR', `${name}: expected fr-FR fixture`);
  assert.ok(Array.isArray(spec.sections) && spec.sections.length > 0, `${name}: sections missing`);
}

assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /single_AudioRecord_PCM_to_WAV/);

assert.equal(corpus.id, 'fr-FR-v1');
assert.equal(corpus.status, 'FROZEN');
assert.equal(corpus.passages.length, 6);
assert.equal(policy.id, 'fr-FR-v1-scoring-v3');
assert.equal(policy.basePolicyId, 'fr-FR-v1-scoring-v2');
assert.equal(policy.corpusId, corpus.id);
assert.match(manifest, /android:name="\.NativeAsrBenchmarkV3Activity"/);
assert.match(manifest, /android:label="00 Native ASR Benchmark v3"/);
assert.match(gradle, /versionCode\s*=\s*17/);
assert.match(gradle, /versionName\s*=\s*"0\.6\.2-native-asr-lossless-stitching-v3-tactical"/);
assert.match(benchmark, /ANDROID_SYSTEM_DEFAULT/);
assert.match(benchmark, /SpeechRecognizer\.createSpeechRecognizer/);
assert.match(benchmark, /offline-interview\.native-asr-benchmark-result\.v3/);
assert.match(benchmark, /completionAuthority/);
assert.match(benchmark, /USER_BUTTON/);
assert.match(benchmark, /COMMIT_FINAL_OR_PARTIAL_FALLBACK_THEN_AUTO_REARM/);
assert.match(benchmark, /PIVOT_NATIVE_ENGINE/);
assert.match(accumulator, /RecognitionSessionAccumulator/);
assert.match(accumulator, /PARTIAL_BOUNDARY_FALLBACK/);
assert.match(accumulator, /USER_FINISH_PARTIAL_FALLBACK/);
assert.doesNotMatch(benchmark, /ERROR_REARM_LIMIT|MAX_AUTO_REARMS/);
assert.doesNotMatch(benchmark, /putExtra\(RecognizerIntent\.EXTRA_AUDIO_SOURCE/);
assert.doesNotMatch(benchmark, /putExtra\(RecognizerIntent\.EXTRA_PREFER_OFFLINE/);
assert.doesNotMatch(gradle, /vosk|sherpa|whisper/i);
assert.match(workflow, /offline-interview-android-native-asr-lossless-v3-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /:app:testDebugUnitTest/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(directLink, /URLSearchParams|searchParams/);

console.log('PASS beta productization contract: native-ASR v3 preserves the frozen corpus and system microphone recognizer while making provider endpointing transparent through lossless inter-session stitching.');

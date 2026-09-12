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
const voskLab = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/EmbeddedAsrLabActivity.kt');
const dual = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/DualAsrBenchmarkActivity.kt');
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

// Protected H4 stability baseline and the Vosk architecture proof remain present as historical evidence.
assert.match(h4, /offline-interview\.android-native-runtime\.v4\.3/);
assert.match(h4, /single_AudioRecord_PCM_to_WAV/);
assert.match(voskLab, /offline-interview\.android-embedded-asr-lab\.v1/);

// Dual benchmark identity: no provider is promoted.
assert.match(manifest, /android:name="\.DualAsrBenchmarkActivity"/);
assert.match(manifest, /android:label="00 Offline Interview ASR Benchmark"/);
assert.match(gradle, /versionCode\s*=\s*14/);
assert.match(gradle, /versionName\s*=\s*"0\.5\.1-dual-asr-benchmark-tactical"/);
assert.match(gradle, /com\.alphacephei:vosk-android:0\.3\.75@aar/);
assert.match(gradle, /sherpa-onnx-1\.13\.8\.aar/);

assert.match(dual, /offline-interview\.android-embedded-asr-benchmark\.v1/);
assert.match(dual, /single_AudioRecord_PCM_to_WAV/);
assert.match(dual, /turn_pcm_snapshot_at_ui_boundary/);
assert.match(dual, /NONE_BENCHMARK_ONLY/);
assert.match(dual, /OfflineWhisperModelConfig/);
assert.match(dual, /language = "fr"/);
assert.match(dual, /task = "transcribe"/);
assert.match(dual, /tiny-encoder\.int8\.onnx/);
assert.match(dual, /tiny-decoder\.int8\.onnx/);
assert.match(dual, /benchmarkExecutor\.execute/);
assert.match(dual, /private fun transcribeVosk/);
assert.match(dual, /private fun transcribeWhisper/);
assert.doesNotMatch(dual, /import\s+android\.speech\.|SpeechRecognizer\.|RecognizerIntent\./,
  'Dual benchmark must not invoke Android SpeechRecognizer APIs');

// Authoritative capture is provider-blind.
const capture = dual.slice(dual.indexOf('private fun captureLoop()'), dual.indexOf('private fun nextTurn()'));
assert.match(capture, /wavRaf\?\.write/);
assert.match(capture, /turnPcmChunks\[currentTurn\]\.add\(copy\)/);
assert.doesNotMatch(capture, /Recognizer\(|OfflineRecognizer|acceptWaveForm|acceptWaveform|decode\(/,
  'AudioRecord capture must never run ASR inference');

// Replayable qualification bundle is explicit user export, not hidden audio egress.
assert.match(dual, /offline-interview\.asr-benchmark-bundle\.v1/);
assert.match(dual, /ZipOutputStream/);
assert.match(dual, /ZipEntry\("audio\/master\.wav"\)/);
assert.match(dual, /ZipEntry\("result\.json"\)/);
assert.match(dual, /ZipEntry\("manifest\.json"\)/);
assert.match(dual, /sha256File/);
assert.match(dual, /replaySemantics/);
assert.match(dual, /WAV leaves the device only if the user explicitly exports/);

// CI assembles both offline providers. First run may discover the old Whisper archive digest;
// the final deliverable must pin it before artifact upload.
assert.match(workflow, /vosk-model-small-fr-0\.22\.zip/);
assert.match(workflow, /cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad/);
assert.match(workflow, /sherpa-onnx-1\.13\.8\.aar/);
assert.match(workflow, /633c9768d7a9519d840d8d8b6b528c6e6fede754e43f32fef3bf2e0acd069021/);
assert.match(workflow, /sherpa-onnx-whisper-tiny\.tar\.bz2/);
assert.match(workflow, /WHISPER_MODEL_SHA256_DISCOVERED/);
assert.match(workflow, /tiny-encoder\.int8\.onnx/);
assert.match(workflow, /tiny-decoder\.int8\.onnx/);
assert.match(workflow, /offline-interview-android-embedded-asr-dual-benchmark-TACTICAL-REINSTALL-ONLY/);
assert.match(workflow, /INSTALL_MODE=UNINSTALL_THEN_REINSTALL/);
assert.match(directLink, /URLSearchParams|searchParams/);

const androidQuestionIds = androidSpec.sections.flatMap(s => (s.questions || []).map(q => q.id));
assert.deepEqual(androidQuestionIds.slice(0, 5), ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']);

console.log('PASS dual embedded-ASR benchmark contract: provider-blind H4 capture, Vosk + Whisper, replayable WAV bundle, no provider promotion.');

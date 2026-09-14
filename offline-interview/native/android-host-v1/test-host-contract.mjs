import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

execFileSync(process.execPath, [path.join(here, '../../beta-v41-23/build-android-native-audio-authority.mjs')], { stdio: 'inherit' });

const host = read('app/src/main/java/com/stefm78/offlineinterview/host/AndroidHostActivity.kt');
const capture = read('app/src/main/java/com/stefm78/offlineinterview/host/NativeAudioCapture.kt');
const provider = read('app/src/main/java/com/stefm78/offlineinterview/host/AndroidSpeechDraftProvider.kt');
const accumulator = read('app/src/main/java/com/stefm78/offlineinterview/host/RecognitionSessionAccumulator.kt');
const manifest = read('app/src/main/AndroidManifest.xml');
const gradle = read('app/build.gradle.kts');
const prepare = read('prepare-web-assets.mjs');
const wrapper = read('../../beta-v41-23/build-android-native-audio-authority.mjs');
const app = read('../../beta-v41-23/app.js');
const engine = read('../../beta-v41-23/transcription-engine.js');
const bridge = read('../../beta-v41-23/native-host-bridge.js');
const audioAdapter = read('../../beta-v41-23/native-audio-capture.js');

for (const token of [
  'WebViewAssetLoader',
  'WebViewCompat.addWebMessageListener',
  'https://appassets.androidplatform.net',
  '.addPathHandler("/recordings/"',
  'RecordingPathHandler',
  'request.deny()',
  'allowFileAccess = false',
  'allowContentAccess = false',
  'START_AUDIO_CAPTURE',
  'STOP_AUDIO_CAPTURE'
]) assert.ok(host.includes(token), `host missing native-audio authority token: ${token}`);
assert.doesNotMatch(host, /request\.grant\(/);
assert.doesNotMatch(host, /addJavascriptInterface/);
assert.match(manifest, /android.permission.RECORD_AUDIO/);
assert.match(manifest, /android:label="Offline Interview"/);

for (const token of [
  'AudioRecord',
  'MediaRecorder.AudioSource.MIC',
  'ANDROID_AUDIORECORD_WAV_V1',
  'write(ByteArray(44))',
  'wavHeader',
  'audioUrl',
  'onPcm(buffer.copyOf(n))'
]) assert.ok(capture.includes(token), `capture missing authority token: ${token}`);

for (const token of [
  'ANDROID_SYSTEM_DEFAULT_V3_DRAFT_PCM_BRIDGE',
  'SpeechRecognizer.createSpeechRecognizer',
  'RecognitionSessionAccumulator',
  'LIVE_DRAFT_ONLY',
  'offerPcm',
  'EXTRA_AUDIO_SOURCE',
  'PCM16_PUSH_FROM_NATIVE_AUDIO_AUTHORITY',
  'ArrayBlockingQueue'
]) assert.ok(provider.includes(token), `provider missing PCM bridge token: ${token}`);
assert.doesNotMatch(provider, /MediaRecorder\.AudioSource\.MIC|AudioRecord\(/);
assert.match(accumulator, /PARTIAL_BOUNDARY_FALLBACK/);
assert.match(accumulator, /USER_FINISH_PARTIAL_FALLBACK/);

assert.match(gradle, /0\.9\.0-android-native-audio-authority1-tactical/);
assert.match(gradle, /ANDROID_AUDIORECORD_WAV_V1/);
assert.match(prepare, /build-android-native-audio-authority\.mjs/);
assert.match(prepare, /native-host-bridge\.js/);
assert.match(prepare, /native-audio-capture\.js/);
assert.match(wrapper, /hasNativeAudioCapture/);
assert.match(wrapper, /createNativeAudioRecorder/);
assert.match(wrapper, /setAudioHealth\('DEGRADED'/);

for (const token of [
  "2026-09-14.interview-runtime-v41.24-android-native-audio-authority1-candidate",
  "from './native-audio-capture.js'",
  'ANDROID_AUDIORECORD_WAV_V1',
  'hasNativeAudioCapture()'
]) assert.ok(app.includes(token), `generated Product runtime missing native-audio token: ${token}`);

assert.match(engine, /ANDROID_SYSTEM_DEFAULT_V3_DRAFT_PCM_BRIDGE/);
assert.match(bridge, /previous\?\.\(event\)/);
assert.match(audioAdapter, /AUDIO_CAPTURE_FINALIZED/);
assert.match(audioAdapter, /fetch\(audioUrl/);

console.log('PASS Android native audio authority: one physical mic owner, WAV master, PCM-fed draft ASR, Web Product unchanged in authority.');

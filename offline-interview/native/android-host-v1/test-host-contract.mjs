import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(here, relative), 'utf8');

const host = read('app/src/main/java/com/stefm78/offlineinterview/host/AndroidHostActivity.kt');
const provider = read('app/src/main/java/com/stefm78/offlineinterview/host/AndroidSpeechDraftProvider.kt');
const accumulator = read('app/src/main/java/com/stefm78/offlineinterview/host/RecognitionSessionAccumulator.kt');
const manifest = read('app/src/main/AndroidManifest.xml');
const gradle = read('app/build.gradle.kts');
const prepare = read('prepare-web-assets.mjs');
const productBuild = read('../../beta-v41-23/build-runtime.mjs');
const engine = read('../../beta-v41-23/transcription-engine.js');

for (const token of [
  'WebViewAssetLoader',
  'WebViewCompat.addWebMessageListener',
  'https://appassets.androidplatform.net',
  'PermissionRequest.RESOURCE_AUDIO_CAPTURE',
  'isTrustedOrigin',
  'allowFileAccess = false',
  'allowContentAccess = false'
]) assert.ok(host.includes(token), `host missing security/runtime token: ${token}`);

assert.doesNotMatch(host, /addJavascriptInterface/);
assert.doesNotMatch(host, /grant\(request\.resources\)/);
assert.doesNotMatch(host, /setOf\("\*"\)/);
assert.match(manifest, /android:name="\.AndroidHostActivity"/);
assert.doesNotMatch(manifest, /MainActivity|NativeAsrBenchmark/);
assert.match(manifest, /android:label="Offline Interview"/);

for (const token of [
  'ANDROID_SYSTEM_DEFAULT_V3_DRAFT',
  'SpeechRecognizer.createSpeechRecognizer',
  'RecognitionSessionAccumulator',
  'LIVE_DRAFT_ONLY',
  'PRODUCT_STOP_GRACE_MS',
  'recognizer?.destroy()',
  'scheduleRearm'
]) assert.ok(provider.includes(token), `provider missing V3 extraction token: ${token}`);
assert.doesNotMatch(provider, /putExtra\(RecognizerIntent\.EXTRA_AUDIO_SOURCE/);
assert.doesNotMatch(provider, /putExtra\(RecognizerIntent\.EXTRA_PREFER_OFFLINE/);
assert.match(accumulator, /PARTIAL_BOUNDARY_FALLBACK/);
assert.match(accumulator, /USER_FINISH_PARTIAL_FALLBACK/);

assert.match(gradle, /0\.8\.0-android-native-draft1-tactical/);
assert.match(gradle, /androidx\.webkit:webkit/);
assert.match(gradle, /dependsOn\(prepareWebAssets\)/);
assert.match(prepare, /25493983644b3fecbc36c3483b1d11c48f268c09/);
assert.match(prepare, /host-provenance\.json/);
assert.match(prepare, /ANDROID_SYSTEM_DEFAULT_V3_DRAFT/);

for (const token of [
  "let recordingTurnId = null",
  "recordingTurnId = uuid('turn')",
  'turnId: recordingTurnId',
  'turnId: previousTurnId',
  'recordingTurnId = nextTurnId'
]) assert.ok(productBuild.includes(token), `Product generator missing turn-scope token: ${token}`);

for (const token of [
  'OfflineInterviewNative',
  'ANDROID_SYSTEM_DEFAULT_V3_DRAFT',
  'hasNativeBridge()',
  'nativeCapabilityCache?.available',
  'createNativeDraftSession'
]) assert.ok(engine.includes(token), `engine missing Android host adapter token: ${token}`);
assert.doesNotMatch(engine, /takeSegment\(.*ANDROID/);

console.log('PASS Android host contract: one Web product, trusted local bridge, Product-owned turn identity, Android V3 draft provider only.');

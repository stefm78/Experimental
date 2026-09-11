import fs from 'node:fs';
import assert from 'node:assert/strict';

const base = 'offline-interview/native/android-stt-poc-v1/app/src/main';
const activityPath = `${base}/java/com/stefm78/offlineinterview/nativepoc/DiagnosticExportActivity.kt`;
const manifestPath = `${base}/AndroidManifest.xml`;

const activity = fs.readFileSync(activityPath, 'utf8');
const manifest = fs.readFileSync(manifestPath, 'utf8');

assert.match(activity, /offline-interview\.android-diagnostic-bundle\.v1/);
assert.match(activity, /last-ui-stall\.json/);
assert.match(activity, /last-uncaught-crash\.json/);
assert.match(activity, /previous-process-exit\.json/);
assert.match(activity, /BuildConfig\.VERSION_NAME/);
assert.match(activity, /ACTION_CREATE_DOCUMENT/);
assert.match(activity, /application\/json/);
assert.match(activity, /No WAV, interview specification, transcript, result payload, signing material or secret is included/);

assert.doesNotMatch(activity, /wavFile/);
assert.doesNotMatch(activity, /lastExportJson/);
assert.doesNotMatch(activity, /ANDROID_SIGNING_/);

assert.match(manifest, /\.DiagnosticExportActivity/);
assert.match(manifest, /00 Offline Interview Diagnostic/);
assert.match(manifest, /android\.intent\.action\.MAIN/);
assert.match(manifest, /android\.intent\.category\.LAUNCHER/);

console.log('PASS android diagnostic export contract');

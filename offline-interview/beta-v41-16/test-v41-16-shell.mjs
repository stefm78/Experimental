import fs from 'node:fs';
import assert from 'node:assert/strict';

const layer=fs.readFileSync('offline-interview/beta-v41-16/calibrated-field-layer-v41-16-1.js','utf8');
const index=fs.readFileSync('offline-interview/beta-v41-16/index.html','utf8');

assert.match(layer,/2026-09-08\.interview-runtime-v41\.16\.1-calibrated-system/);
assert.doesNotMatch(layer,/new\s+MutationObserver\s*\(/,'V41.16.1 must not install the self-triggering DOM MutationObserver');
assert.match(layer,/iframe\.addEventListener\('load',attach,\{once:true\}\)/);
assert.match(layer,/supportsSystemAudioTrackRecognition/);
assert.match(layer,/transcribeSystemAudioTrack/);
assert.match(layer,/audio_boundary_calibrated_v41_16/);
assert.match(index,/calibrated-field-layer-v41-16-1\.js\?v=41\.16\.1/);

console.log(JSON.stringify({status:'PASS',contract:'offline-interview.v41.16.1-shell'}));

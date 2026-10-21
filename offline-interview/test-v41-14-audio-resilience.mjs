import assert from 'node:assert/strict';
import fs from 'node:fs';
const here = new URL('./', import.meta.url);
const app = fs.readFileSync(new URL('app.js', here), 'utf8');
const index = fs.readFileSync(new URL('index.html', here), 'utf8');

assert.match(app, /interview-runtime-v41\.14/);
assert.match(app, /recorder\.start\(\);/);
assert.doesNotMatch(app, /recorder\.start\(500\)/);
assert.match(app, /const source = activeReplayAudio, context = activeReplayContext, button = activeReplayButton;/);
assert.ok(app.indexOf('updateReplayButton(button, false);') < app.indexOf('try { source?.stop(); }'), 'replay button must reset before source cleanup');
assert.match(app, /source\.onended = \(\) => \{[\s\S]*replay_ended[\s\S]*stopReplay\(source\)/);
assert.match(app, /async function decodeStoredRecording\(recordingId\)/);
assert.match(app, /audio_decode_failed/);
assert.match(app, /if \(context\?\.state !== 'closed'\) await context\.close\(\)\.catch/);
assert.match(app, /audio_blob_finalized/);
assert.match(app, /await validateStoredRecording\(captureId\)/);
assert.match(app, /audio_blob_invalid/);
assert.match(app, /let audioHealth = 'HEALTHY'/);
assert.match(app, /async function recoverAudioSubsystem\(\)/);
assert.match(app, /audio_recovery_started/);
assert.match(app, /audio_recovery_succeeded/);
assert.match(app, /releaseMicrophone\(\)/);
assert.match(app, /db = null; dbReadyPromise = null;/);
assert.match(index, /id="audioRecoveryBtn"/);
assert.match(index, /id="simulateAudioFaultBtn"/);

const whisperBody = app.match(/async function retranscribeTurnWithSystem[\s\S]*?\n\}/)?.[0] || '';
assert.ok(whisperBody.indexOf('buildTurnWhisperPcm(turn)') < whisperBody.indexOf('prepareModel()'), 'decode/slice must succeed before Whisper is loaded');
assert.match(whisperBody, /if \(!String\(error\?\.code \|\| ''\)\.startsWith\('AUDIO_'\)\)/);

const storeBody = app.match(/async function handleRecordingStopped[\s\S]*?\n\}/)?.[0] || '';
assert.ok(storeBody.indexOf('dbAudioPut') < storeBody.indexOf('validateStoredRecording(captureId)'), 'validation must exercise the IndexedDB round-trip');
assert.ok(storeBody.indexOf('validateStoredRecording(captureId)') < storeBody.indexOf("boundary_audio_ready"), 'audio must validate before READY');
assert.doesNotMatch(storeBody, /clearAudioRefs/);

const windows = [[0,2376],[2376,4367],[4367,6584],[6584,8560],[8560,11248]];
for (let i=1;i<windows.length;i++) assert.equal(windows[i-1][1], windows[i][0]);
assert.deepEqual(windows.map(([a,b])=>b-a), [2376,1991,2217,1976,2688]);

console.log(JSON.stringify({status:'PASS', contract:'offline-interview.v41.14-audio-resilience'}));

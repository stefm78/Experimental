import assert from 'node:assert/strict';
import fs from 'node:fs';
import { turnAudioWindow } from './audio-window.js';
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const bounds = [[0,3404],[3404,7210],[7210,10332],[10332,13551],[13551,16640]];
for (const [startMs,endMs] of bounds) {
  const w = turnAudioWindow({audioRef:{recordingId:'field',startMs,endMs}}, 'canonical');
  assert.deepEqual([w.startMs,w.endMs],[startMs,endMs]);
}
assert.match(app,/async function loadTurnAudioWindow\(turn\)[\s\S]*turnAudioWindow\(turn, 'canonical'\)/);
assert.match(app,/const buffer = context\.createBuffer\([\s\S]*copyToChannel/);
assert.match(app,/async function replayTurnAudio\(turn, button\)[\s\S]*source\.buffer = buffer[\s\S]*source\.start\(\)/);
assert.doesNotMatch(app,/replayTurnAudio[\s\S]{0,1200}new Audio\(/);
assert.match(app,/async function buildTurnWhisperPcm\(turn\)[\s\S]*OfflineAudioContext\(1, frames, rate\)/);
assert.match(app,/await run\(pcm, \{ language: 'french', task: 'transcribe' \}\)/);
assert.match(app,/mode: 'whisper-local'/);
assert.doesNotMatch(app,/buildTurnRecognitionTrack\(/);
assert.doesNotMatch(app,/transcribeSystemAudioTrack\(/);
console.log('PASS V41.13 canonical replay + manual Whisper isolation contract');

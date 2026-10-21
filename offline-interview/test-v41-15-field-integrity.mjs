import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessWhisperTranscript } from './whisper-quality.js';
const here = new URL('./', import.meta.url);
const app = fs.readFileSync(new URL('app.js', here), 'utf8');
const index = fs.readFileSync(new URL('index.html', here), 'utf8');

assert.match(app, /interview-runtime-v41\.15/);
assert.match(index, /id="interviewDiagnosticPanel"/);
assert.match(index, /id="interviewSimulateAudioFaultBtn"/);
assert.match(app, /interviewSimulateAudioFaultBtn\?\.addEventListener\('click', simulateAudioFault\)/);
assert.match(app, /if \(ui\.interviewDiagnosticPanel && next === 'DEGRADED'\) ui\.interviewDiagnosticPanel\.open = true/);
assert.match(app, /audio_boundary_observed/);
assert.match(app, /audio_timeline_measured/);
assert.match(app, /decodedDurationMs: timeline\.durationMs/);
assert.match(app, /tailMs: timeline\.durationMs - logicalStopMs/);

const bad = `Tu es une ${'cation '.repeat(80)}`;
assert.equal(assessWhisperTranscript(bad).ok, false, 'pathological repeated Whisper output must be rejected');
assert.equal(assessWhisperTranscript('Ceci est un segment normal pour vérifier que la retranscription reste lisible et fidèle à une phrase française ordinaire.').ok, true);
assert.equal(assessWhisperTranscript('alpha rouge stop').ok, true, 'short normal utterances must not be rejected');

const whisperBody = app.match(/async function retranscribeTurnWithSystem[\s\S]*?\n\}/)?.[0] || '';
assert.match(whisperBody, /const attempt = \(Number\(previous\?\.attempt\) \|\| 0\) \+ 1/);
assert.doesNotMatch(whisperBody, /déjà une retranscription stabilisée/);
assert.match(whisperBody, /assessWhisperTranscript\(text\)/);
assert.match(whisperBody, /status: 'rejected'/);
assert.match(whisperBody, /manual_whisper_rejected/);
assert.match(whisperBody, /humanProtected = Boolean\(turn\.humanEdited\)/);
assert.match(app, /retranscribe\.disabled = !audioReady;/);
assert.match(app, /Retranscrire cet audio/);
assert.match(app, /turn\.humanEdited = true; turn\.humanEditedAt = nowIso\(\)/);

console.log(JSON.stringify({status:'PASS', contract:'offline-interview.v41.15-field-integrity'}));

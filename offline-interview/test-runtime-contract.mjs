import assert from 'node:assert/strict';
import fs from 'node:fs';

const here = new URL('./', import.meta.url);
const read = name => fs.readFileSync(new URL(name, here), 'utf8');
const bytes = text => Buffer.byteLength(text, 'utf8');

const app = read('app.js');
const css = read('styles.css');
const index = read('index.html');
const sw = read('sw.js');
const systemStt = read('system-stt.js');
const spec = JSON.parse(read('test-interviews/interview-test-ux-v40.json'));

// Completion remains a single state transition shared by both responsive controls.
assert.match(app, /interview-runtime-v41\.4/);
assert.match(app, /let completionInProgress = false;/);
assert.match(app, /let pendingInterviewCompletion = false;/);
assert.match(app, /completion_requested/);
assert.match(app, /completion_succeeded/);
assert.match(app, /completion_error/);
assert.match(app, /pendingInterviewCompletion && !nextSpeakerId/);
assert.match(app, /if \(captureFinalizing \|\| recordingCompletionPromise\) \{[\s\S]*pendingInterviewCompletion = true;[\s\S]*return;/);
assert.match(app, /ui\.mobileFinishBtn\?\.addEventListener\('click', completeInterview\)/);
assert.match(app, /ui\.sidebarFinishBtn\?\.addEventListener\('click', completeInterview\)/);

// View visibility is state, not responsive layout. CSS must never force a hidden interview view open.
assert.match(app, /el\.hidden = !visible;/);
assert.match(app, /el\.classList\.toggle\('hidden', !visible\)/);
const interviewLayoutBlocks = [...css.matchAll(/\.interview-layout\s*\{([^{}]*)\}/gs)].map(match => match[1]);
assert.ok(interviewLayoutBlocks.length > 0, 'interview-layout CSS contract missing');
assert.equal(interviewLayoutBlocks.some(block => /display\s*:[^;!}]+!important/i.test(block)), false, 'responsive CSS must not override hidden state');
assert.match(css, /@media\(max-width:979px\)\{\.mobile-finish-button\{display:inline-flex/);
assert.match(index, /id="interviewView" class="interview-layout hidden"/);
assert.match(index, /id="doneView"/);
assert.match(index, /id="exportJsonBtn"/);

// One runtime identity; service-worker registration does not carry a stale duplicate version.
assert.doesNotMatch(app, /register\('\.\/sw\.js\?v=/);
assert.match(sw, /offline-interview-v41\.4/);
assert.match(index, /styles\.css\?v=41\.4/);
assert.match(index, /app\.js\?v=41\.4/);

// Diagnostic/lab pages stay available in the repository but are not mandatory install-shell bytes.
const shell = sw.match(/const SHELL = \[(.*?)\];/s)?.[1] || '';
for (const optional of [
  'stt-benchmark.html', 'stt-benchmark.js',
  'stt-deep-benchmark.html', 'stt-deep-benchmark.js',
  'device-stt-capability.html', 'device-stt-capability.js',
  'stt-lab-audio.js', 'stt-lab-engines.js', 'stt-lab-fixtures.js'
]) {
  assert.equal(shell.includes(optional), false, `${optional} must remain lazy, not install-shell`);
}



// V41: audio is retained locally as complete recording blobs; turns hold only time references.
assert.match(app, /createObjectStore\('audio', \{ keyPath: 'id' \}\)/);
assert.match(app, /let dbReadyPromise = null/);
assert.match(app, /function ensureDb\(\)/);
assert.match(app, /const connection = await ensureDb\(\)/);
assert.doesNotMatch(app, /db\.transaction\(/);
assert.match(app, /masterAudioChunks = \[\]/);
assert.match(app, /masterAudioChunks\.push\(event\.data\)/);
assert.match(app, /blob: masterBlob/);
assert.match(app, /const recordingId = recordingCaptureId/);
assert.match(app, /audioRef: failedAudioCaptureIds\.has\(recordingId\) \? null : \{ recordingId, startMs: segmentStartMs, endMs: segmentEndMs \}/);
assert.match(app, /replayTurnAudio\(turn\)/);
assert.match(app, /const targetQuestionId = all\[index\]\?\.question\?\.id \|\| null;/);
assert.match(app, /if \(isRecording\(\) && targetQuestionId && recordingQuestionId !== targetQuestionId\)/);
assert.match(app, /moveRecordingToViewedQuestion\(\)\.catch/);
assert.match(app, /AudioContext \|\| window\.webkitAudioContext/);
assert.match(app, /getFloatTimeDomainData/);
assert.match(app, /Math\.sqrt\(sum \/ samples\.length\)/);
assert.match(index, /id="micMeterFill"/);
assert.match(index, /id="micPreviewBtn"/);
assert.match(index, /id="deleteAudioBtn"/);
assert.doesNotMatch(app, /base64.*audio/i);

// V41.2: loading/start path cannot lose participants, and free interview is a first-class path.
assert.match(app, /function ensureInterviewParticipants\(\)/);
assert.match(app, /function renderSetup\(\) \{\s+ensureInterviewParticipants\(\)/);
assert.match(app, /interview = normalizeSpec\(raw\);\s+ensureInterviewParticipants\(\)/);
assert.match(app, /session = newSession\(\);\s+renderQuestion\(\);\s+try \{ await persistSession\(\); \}/);
assert.match(app, /function freeInterviewSpec\(\)/);
assert.match(app, /async function startFreeInterview\(\)/);
assert.match(index, /id="freeStartBtn"/);


// V41.4: interaction state is fail-open with respect to local persistence/finalizers.
const navBody = app.match(/async function goToQuestion\(index\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(navBody.indexOf('renderQuestion();') >= 0 && navBody.indexOf('renderQuestion();') < navBody.indexOf("persistSessionLater('question-navigation')"), 'question UI must render before persistence');
assert.doesNotMatch(navBody, /await persistSession\(\)/);
assert.match(navBody, /moveRecordingToViewedQuestion\(\)\.catch/);
const selectBody = app.match(/async function selectSpeaker\(participantId\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(selectBody.indexOf('renderSpeakerButtons();') >= 0 && selectBody.indexOf('renderSpeakerButtons();') < selectBody.indexOf("persistSessionLater('speaker-selection')"), 'speaker control must update before persistence');
assert.doesNotMatch(selectBody, /await persistSession\(\)/);
assert.match(app, /boundedWait\(dbAudioPut\([\s\S]*5000, 'stockage audio'\)/);
assert.match(app, /finishInterview\(\);\s+persistSessionLater\('completion'\)/);
assert.match(app, /failedAudioCaptureIds\.has\(recordingId\) \? null/);

// Explicit anti-growth budgets. Raising one requires a conscious code-review decision.
const coreBytes = bytes(app) + bytes(css) + bytes(systemStt) + bytes(index) + bytes(sw);
assert.ok(bytes(app) <= 101_000, `app.js budget exceeded: ${bytes(app)} bytes`);
assert.ok(bytes(css) <= 66_000, `styles.css budget exceeded: ${bytes(css)} bytes`);
assert.ok(coreBytes <= 200_000, `core source budget exceeded: ${coreBytes} bytes`);

assert.equal(spec.id, 'test-ux-v40-result-replaces-capture');
console.log(JSON.stringify({
  status: 'PASS',
  contract: 'offline-interview.runtime-contract.v41.4',
  appBytes: bytes(app),
  cssBytes: bytes(css),
  coreBytes
}));

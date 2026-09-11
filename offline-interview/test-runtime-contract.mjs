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
const audioWindow = read('audio-window.js');
const whisperQuality = read('whisper-quality.js');
const spec = JSON.parse(read('test-interviews/interview-test-ux-v40.json'));

// Completion remains a single state transition shared by both responsive controls.
assert.match(app, /interview-runtime-v41\.15/);
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
assert.match(sw, /offline-interview-v41\.15/);
assert.match(index, /styles\.css\?v=41\.15/);
assert.match(index, /app\.js\?v=41\.15/);

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
assert.match(app, /const audioRef = \{ recordingId, startMs: segmentStartMs, endMs: segmentEndMs \}/);
assert.match(app, /replayTurnAudio\(turn, replay\)/);
assert.match(app, /AudioContext \|\| window\.webkitAudioContext/);
assert.match(app, /getFloatTimeDomainData/);
assert.match(app, /Math\.sqrt\(sum \/ samples\.length\)/);
assert.match(index, /id="micMeterFill"/);
assert.doesNotMatch(index, /id="micPreviewBtn"/);
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
assert.doesNotMatch(navBody, /moveRecordingToViewedQuestion\(\)\.catch/);
assert.match(navBody, /renderCaptureQuestionContext\(\)/);
const selectBody = app.match(/async function selectSpeaker\(participantId\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.ok(selectBody.indexOf('renderSpeakerButtons();') >= 0 && selectBody.indexOf('renderSpeakerButtons();') < selectBody.indexOf("persistSessionLater('speaker-selection')"), 'speaker control must update before persistence');
assert.doesNotMatch(selectBody, /await persistSession\(\)/);
assert.match(app, /boundedWait\(dbAudioPut\([\s\S]*5000, 'stockage audio'\)/);
assert.match(app, /finishInterview\(\);\s+persistSessionLater\('completion'\)/);
assert.doesNotMatch(app, /failedAudioCaptureIds/);

// V41.13: live transcription stays system-first; explicit saved-audio retranscription is local Whisper on the canonical window.
assert.match(app, /appendAudioOnlyTurn\(/);
assert.match(app, /audio-system-pending/);
assert.match(app, /retranscribeTurnWithSystem\(turn, retranscribe\)/);
assert.match(app, /buildTurnWhisperPcm\(turn\)/);
assert.match(app, /turnAudioWindow\(turn, 'canonical'\)/);
assert.match(app, /whisper-local-retranscribed/);
assert.doesNotMatch(app, /supportsSystemAudioTrackRecognition/);
assert.doesNotMatch(app, /transcribeSystemAudioTrack\(/);
assert.match(systemStt, /export function transcribeSystemAudioTrack\(/);

// V41.11 field stabilization: explicit capture ownership, gapless semantic boundaries, replay pause, idempotent retranscription.
assert.match(app, /systemSpeechSession\?\.takeSegment/);
assert.doesNotMatch(app.match(/async function rotateLiveSegment[\s\S]*?return true;\n\}/)?.[0] || '', /cutSegment\(/);
assert.match(app, /L’enregistrement reste sur/);
assert.match(app, /replayTurnAudio\(turn, replay\)/);
assert.match(app, /activeReplayTurnId === turn\?\.id/);
assert.match(app, /systemRetranscription = \{ audioKey, status: 'succeeded'/);
assert.doesNotMatch(app, /\['succeeded', 'failed'\]\.includes\(stableRetranscription\)/);

// V41.11: semantic boundary text is derived from immutable saved-audio intervals, not cross-boundary live hypotheses.
assert.match(app, /let recordingMasterStartedAt = 0/);
assert.match(app, /performance\.now\(\) - recordingMasterStartedAt/);
assert.match(app, /audio-system-boundary-pending/);
assert.match(app, /const audioReady = Boolean\(turn\.audioRef\?\.recordingId\) && recordingAudioUsable\(turn\.audioRef\.recordingId\)/);

// V41.11: live system text is committed immediately; saved-audio retranscription is recovery, never a critical-path prerequisite.
assert.match(app, /system-boundary-draft/);
assert.match(app, /system_boundary_live_committed/);
assert.match(app, /system_boundary_live_missing/);
assert.match(app, /boundary_audio_ready/);

// V41.11 hybrid audio: master remains authoritative; context is a derived window only.
assert.match(app, /import \{ turnAudioWindow \} from '.\/audio-window\.js'/);
assert.match(audioWindow, /AUDIO_CONTEXT_BEFORE_MS = 250/);
assert.match(audioWindow, /AUDIO_CONTEXT_AFTER_MS = 250/);
assert.match(audioWindow, /canonicalStartMs/);
assert.match(audioWindow, /mode==='recovery'/);
assert.doesNotMatch(app, /recorder\.stop\(\).*selectSpeaker/);
// Live-first remains intact: no automatic saved-audio recovery is reintroduced.
assert.doesNotMatch(app, /recoverBoundaryTurnsWithSystem/);
assert.doesNotMatch(app, /await retranscribeTurnWithSystem\(turn, null, 'boundary-recovery'\)/);
// UX: audio-only turns are retained but compact; transcription action is provider-neutral.
assert.match(app, /audio-only-turn/);
assert.match(app, /Transcrire cet audio en texte/);
assert.doesNotMatch(app, /↻ Système/);
assert.doesNotMatch(app, /✓ Système/);
assert.doesNotMatch(app, /× Système/);
assert.doesNotMatch(css, /mic-preview-button\[data-level-state=good\]/);
assert.match(css, /audio-to-text-svg/);
assert.match(app, /captureFinalizing = false;\n    renderTurns\(\);/);
assert.match(app, /audio-to-text-arrow/);
assert.match(css, /turn-retranscribe-button\{[^}]*width:34px;height:34px;min-width:34px/);
assert.match(css, /turn-replay-button\{min-width:34px/);
assert.match(index, /top-on-air[\s\S]*mic-meter-row/);
assert.doesNotMatch(app, /recoverBoundaryTurnsWithSystem/);
assert.doesNotMatch(app, /await retranscribeTurnWithSystem\(turn, null, 'boundary-recovery'\)/);


// V41.11: direct-link and targeted field repair invariants.
assert.match(app, /resolveDirectInterviewLink/);
assert.match(app, /directLaunch\?\.view === 'interview'/);
assert.match(app, /turnAudioWindow\(turn, 'canonical'\)/);
assert.doesNotMatch(app, /\['succeeded', 'failed'\]\.includes\(stableRetranscription\)/);
assert.match(index, /class="mic-meter" role="meter"/);
assert.doesNotMatch(index, />Micro<\/button>/);
assert.doesNotMatch(index, />Silence<\/span>/);
// V41.15 field-integrity invariants: active diagnostic access, measured timeline, conservative Whisper quality gate + retry.
assert.match(index, /id="interviewDiagnosticPanel"/);
assert.match(app, /audio_timeline_measured/);
assert.match(app, /manual_whisper_rejected/);
assert.match(app, /retranscribe\.disabled = !audioReady/);
assert.match(app, /turn\.humanEdited = true/);
assert.match(sw, /whisper-quality\.js/);
// Explicit anti-growth budgets. Raising one requires a conscious code-review decision.
const coreBytes = bytes(app) + bytes(css) + bytes(systemStt) + bytes(index) + bytes(sw) + bytes(whisperQuality);
// V41.15 adds only bounded field-integrity logic on top of V41.14 resilience.
assert.ok(bytes(app) <= 121_000, `app.js V41.15 field-integrity budget exceeded: ${bytes(app)} bytes`);
assert.ok(bytes(css) <= 66_000, `styles.css budget exceeded: ${bytes(css)} bytes`);
assert.ok(coreBytes <= 223_000, `core source V41.15 field-integrity budget exceeded: ${coreBytes} bytes`);

assert.equal(spec.id, 'test-ux-v40-result-replaces-capture');
await import('./test-v41-13-field-repair.mjs');
await import('./test-v41-14-audio-resilience.mjs');
await import('./test-v41-15-field-integrity.mjs');
console.log(JSON.stringify({
  status: 'PASS',
  contract: 'offline-interview.runtime-contract.v41.15',
  appBytes: bytes(app),
  cssBytes: bytes(css),
  coreBytes
}));

from pathlib import Path
import re, json

root = Path('offline-interview')
app_p = root/'app.js'; index_p=root/'index.html'; css_p=root/'styles.css'; sw_p=root/'sw.js'; test_p=root/'test-runtime-contract.mjs'
app=app_p.read_text(); index=index_p.read_text(); css=css_p.read_text(); sw=sw_p.read_text(); test=test_p.read_text()

def once(text, old, new, label):
    if old not in text: raise SystemExit(f'missing {label}')
    if text.count(old) != 1: raise SystemExit(f'non-unique {label}: {text.count(old)}')
    return text.replace(old,new,1)

# Runtime identity + IndexedDB schema.
app=once(app, "const BUILD_ID = '2026-09-06.interview-runtime-v40';", "const BUILD_ID = '2026-09-06.interview-runtime-v41';", 'build id')
app=once(app, 'const DB_VERSION = 1;', 'const DB_VERSION = 2;', 'db version')
app=once(app,
"""    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
    };""",
"""    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
      if (!request.result.objectStoreNames.contains('audio')) request.result.createObjectStore('audio', { keyPath: 'id' });
    };""", 'audio store')
app=once(app,
"async function persistSession() { if (session) await dbPut(STATE_KEY, session); }",
"""function audioStore(mode = 'readonly') { return db.transaction('audio', mode).objectStore('audio'); }
function dbAudioPut(value) {
  return new Promise((resolve, reject) => {
    const req = audioStore('readwrite').put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbAudioGet(id) {
  return new Promise((resolve, reject) => {
    const req = audioStore().get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function dbAudioDeleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    const store = audioStore('readwrite');
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      if (cursor.value?.sessionId === sessionId) cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
async function persistSession() { if (session) await dbPut(STATE_KEY, session); }""", 'audio db helpers')

# UI bindings.
app=once(app,
"captureDock: $('captureDock'), captureModeLabel: $('captureModeLabel'), recordState: $('recordState'), timer: $('timer'), liveTranscriptPreview: $('liveTranscriptPreview'), transcribing: $('transcribing'),",
"captureDock: $('captureDock'), captureModeLabel: $('captureModeLabel'), recordState: $('recordState'), timer: $('timer'), liveTranscriptPreview: $('liveTranscriptPreview'), transcribing: $('transcribing'), micPreviewBtn: $('micPreviewBtn'), micMeterFill: $('micMeterFill'), micMeterState: $('micMeterState'),",
'audio ui capture')
app=once(app,
"doneSummary: $('doneSummary'), doneQuestionStat: $('doneQuestionStat'), doneTurnStat: $('doneTurnStat'), doneTimeStat: $('doneTimeStat'), reviewBtn: $('reviewBtn'), exportTxtBtn: $('exportTxtBtn'), exportJsonBtn: $('exportJsonBtn'), newSessionBtn: $('newSessionBtn'),",
"doneSummary: $('doneSummary'), doneQuestionStat: $('doneQuestionStat'), doneTurnStat: $('doneTurnStat'), doneTimeStat: $('doneTimeStat'), reviewBtn: $('reviewBtn'), exportTxtBtn: $('exportTxtBtn'), exportJsonBtn: $('exportJsonBtn'), deleteAudioBtn: $('deleteAudioBtn'), newSessionBtn: $('newSessionBtn'),",
'audio ui done')
app=once(app,
"let pendingInterviewCompletion = false;",
"""let pendingInterviewCompletion = false;
let recordingAudioOffsetMs = 0;
let audioContext = null;
let audioAnalyser = null;
let audioSourceNode = null;
let audioMeterFrame = 0;
let activeReplayAudio = null;
let activeReplayUrl = null;""", 'audio globals')

# Microphone meter + replay helpers, fully local.
anchor="function setView(name) {"
helpers=r'''function updateMicMeter(level = 0, peak = 0) {
  const rms = Math.max(0, Math.min(1, Number(level) || 0));
  const pk = Math.max(0, Math.min(1, Number(peak) || 0));
  const db = rms > 0 ? 20 * Math.log10(rms) : -96;
  const visual = Math.max(0, Math.min(1, (db + 60) / 60));
  let state = 'Silence';
  let key = 'silence';
  if (pk >= 0.95 || db > -4) { state = 'Trop fort'; key = 'hot'; }
  else if (db >= -30) { state = 'Bon niveau'; key = 'good'; }
  else if (db >= -50) { state = 'Faible'; key = 'low'; }
  if (ui.micMeterFill) ui.micMeterFill.style.setProperty('--level', visual.toFixed(3));
  if (ui.micMeterState) { ui.micMeterState.textContent = state; ui.micMeterState.dataset.levelState = key; }
}

async function startMicrophoneMeter(targetStream) {
  if (!targetStream) return;
  stopMicrophoneMeter(false);
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  audioContext = new Context();
  audioAnalyser = audioContext.createAnalyser();
  audioAnalyser.fftSize = 1024;
  audioAnalyser.smoothingTimeConstant = 0.65;
  audioSourceNode = audioContext.createMediaStreamSource(targetStream);
  audioSourceNode.connect(audioAnalyser);
  const samples = new Float32Array(audioAnalyser.fftSize);
  const tick = () => {
    if (!audioAnalyser) return;
    audioAnalyser.getFloatTimeDomainData(samples);
    let sum = 0, peak = 0;
    for (const sample of samples) { const a = Math.abs(sample); sum += sample * sample; if (a > peak) peak = a; }
    updateMicMeter(Math.sqrt(sum / samples.length), peak);
    audioMeterFrame = requestAnimationFrame(tick);
  };
  tick();
}

function stopMicrophoneMeter(reset = true) {
  if (audioMeterFrame) cancelAnimationFrame(audioMeterFrame);
  audioMeterFrame = 0;
  try { audioSourceNode?.disconnect(); } catch {}
  try { audioAnalyser?.disconnect(); } catch {}
  const context = audioContext;
  audioSourceNode = null; audioAnalyser = null; audioContext = null;
  if (context && context.state !== 'closed') context.close().catch(() => {});
  if (reset) updateMicMeter(0, 0);
}

async function ensureMicrophoneStream() {
  const reusable = stream && stream.getAudioTracks?.().some(track => track.readyState === 'live');
  if (!reusable) stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  if (!audioAnalyser) await startMicrophoneMeter(stream);
  if (ui.micPreviewBtn) { ui.micPreviewBtn.textContent = isRecording() ? 'Micro actif' : 'Couper le test micro'; ui.micPreviewBtn.setAttribute('aria-pressed', 'true'); }
  return stream;
}

function releaseMicrophone() {
  stopMicrophoneMeter();
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  if (ui.micPreviewBtn) { ui.micPreviewBtn.textContent = 'Tester le micro'; ui.micPreviewBtn.setAttribute('aria-pressed', 'false'); }
}

async function toggleMicrophonePreview() {
  if (isRecording() || captureFinalizing) return;
  const live = stream && stream.getAudioTracks?.().some(track => track.readyState === 'live');
  if (live) releaseMicrophone();
  else {
    try { await ensureMicrophoneStream(); showError(ui.interviewError, ''); }
    catch (error) { releaseMicrophone(); showError(ui.interviewError, `Microphone indisponible : ${error.message || error}`); }
  }
}

function stopReplay() {
  try { activeReplayAudio?.pause(); } catch {}
  activeReplayAudio = null;
  if (activeReplayUrl) URL.revokeObjectURL(activeReplayUrl);
  activeReplayUrl = null;
}

async function replayTurnAudio(turn) {
  const ref = turn?.audioRef;
  if (!ref?.recordingId) return;
  stopReplay();
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) { showError(ui.interviewError, 'Audio local introuvable pour cette prise de parole.'); return; }
  const url = URL.createObjectURL(record.blob);
  const audio = new Audio(url);
  activeReplayAudio = audio; activeReplayUrl = url;
  const end = Math.max(0, Number(ref.endMs) || 0) / 1000;
  audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.max(0, Number(ref.startMs) || 0) / 1000; audio.play().catch(() => stopReplay()); }, { once: true });
  audio.addEventListener('timeupdate', () => { if (end && audio.currentTime >= end) stopReplay(); });
  audio.addEventListener('ended', stopReplay, { once: true });
}

'''
if anchor not in app: raise SystemExit('missing setView anchor')
app=app.replace(anchor, helpers+anchor,1)

# Audio refs in data model.
app=once(app,
"function createTurn({ type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, followUpId = null, followUpKind = null }) {",
"function createTurn({ type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, audioRef = null, followUpId = null, followUpKind = null }) {",
'createTurn audio ref sig')
app=once(app,
"    durationSeconds: Math.round((durationSeconds || 0) * 10) / 10,\n    followUpId,",
"    durationSeconds: Math.round((durationSeconds || 0) * 10) / 10,\n    audioRef: audioRef ? { recordingId: audioRef.recordingId, startMs: Math.max(0, Math.round(audioRef.startMs || 0)), endMs: Math.max(0, Math.round(audioRef.endMs || 0)) } : null,\n    followUpId,",
'createTurn audio ref value')
app=once(app,
"async function appendAnswerTurn({ questionId, speakerId, text, source, rawTranscript = null, durationSeconds = 0 }) {",
"async function appendAnswerTurn({ questionId, speakerId, text, source, rawTranscript = null, durationSeconds = 0, audioRef = null }) {",
'appendAnswer sig')
app=once(app,
"        last.durationSeconds = Math.max(Number(last.durationSeconds) || 0, Number(durationSeconds) || 0);",
"        last.durationSeconds = Math.max(Number(last.durationSeconds) || 0, Number(durationSeconds) || 0);\n        if (audioRef) last.audioRef = audioRef;",
'duplicate audio ref')
app=once(app,
"    rawTranscript,\n    durationSeconds\n  }));",
"    rawTranscript,\n    durationSeconds,\n    audioRef\n  }));",
'new turn audio ref')

# Semantic speaker cuts keep offsets into the valid whole recording blob.
app=once(app,
"  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);\n  const cut = systemSpeechSession.cutSegment();",
"  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);\n  const segmentStartMs = recordingAudioOffsetMs;\n  const segmentEndMs = segmentStartMs + durationSeconds * 1000;\n  recordingAudioOffsetMs = segmentEndMs;\n  const cut = systemSpeechSession.cutSegment();",
'cut audio offsets')
app=once(app,
"      rawTranscript: settled?.finalText || text,\n      durationSeconds\n    });",
"      rawTranscript: settled?.finalText || text,\n      durationSeconds,\n      audioRef: { recordingId: recordingCaptureId, startMs: segmentStartMs, endMs: segmentEndMs }\n    });",
'cut audio ref append')

# Recording start: reset audio offset and always feed the real microphone meter from the same stream.
app=once(app,
"    recordingCaptureId = uuid('capture');\n    recordingCompletionPromise = new Promise(resolve => { resolveRecordingCompletion = resolve; });",
"    recordingCaptureId = uuid('capture');\n    recordingAudioOffsetMs = 0;\n    recordingCompletionPromise = new Promise(resolve => { resolveRecordingCompletion = resolve; });",
'recording offset reset')
app=once(app,
"""    const reusableStream = stream && stream.getAudioTracks?.().some(track => track.readyState === 'live');
    if (!reusableStream) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    }
    const mimeType = preferredMimeType();""",
"""    await ensureMicrophoneStream();
    const mimeType = preferredMimeType();""", 'recording uses metered stream')

# Store the complete valid recording blob once, then reference time ranges from turns.
app=once(app,
"    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });\n    const systemSnapshot = systemSpeechSession?.snapshot()",
"    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });\n    await dbAudioPut({ id: captureId, sessionId: session.id, blob, mimeType: blob.type || 'audio/webm', createdAt: nowIso() });\n    const systemSnapshot = systemSpeechSession?.snapshot()",
'persist complete audio blob')
# Final answer append in handleRecordingStopped: target the first matching final duration call after system transcription flow.
pattern=re.compile(r"(rawTranscript:\s*rawTranscript,\s*durationSeconds\s*)(\n\s*}\);)")
m=pattern.search(app)
if not m: raise SystemExit('missing final answer append')
replacement=m.group(1)+",\n      audioRef: { recordingId: captureId, startMs: recordingAudioOffsetMs, endMs: recordingAudioOffsetMs + Math.max(0, durationSeconds || 0) * 1000 }"+m.group(2)
app=app[:m.start()]+replacement+app[m.end():]

# Release analyser and microphone with the existing stream lifecycle.
app=once(app,
"""    if (!keepMicrophoneOpen) {
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
    }""",
"""    if (!keepMicrophoneOpen) releaseMicrophone();""", 'release microphone lifecycle')
app=once(app,
"async function returnToSetup() {\n  const ok = await finishActiveCaptureBeforeLeaving",
"async function returnToSetup() {\n  const ok = await finishActiveCaptureBeforeLeaving",
'return setup anchor')
app=once(app,
"  await persistSession();\n  renderSetup();\n}\n\nfunction setCompletionBusy",
"  await persistSession();\n  releaseMicrophone();\n  renderSetup();\n}\n\nfunction setCompletionBusy",
'return setup release')
app=once(app,
"function finishInterview() {\n  setView('done');",
"function finishInterview() {\n  releaseMicrophone();\n  stopReplay();\n  setView('done');",
'finish release')

# Replay control per voice turn.
app=once(app,
"    head.append(select, type, meta, remove);",
"""    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'ghost small turn-replay-button';
    replay.textContent = '▶';
    replay.title = 'Réécouter cette prise de parole';
    replay.setAttribute('aria-label', replay.title);
    replay.disabled = !turn.audioRef?.recordingId;
    replay.addEventListener('click', () => replayTurnAudio(turn));
    if (turn.type === 'answer') head.append(select, type, meta, replay, remove);
    else head.append(select, type, meta, remove);""", 'replay button')

# Export only references, never audio bytes.
app=once(app,
"          durationSeconds: turn.durationSeconds || 0,\n          followUpId: turn.followUpId,",
"          durationSeconds: turn.durationSeconds || 0,\n          audioRef: turn.audioRef || null,\n          followUpId: turn.followUpId,",
'export audio ref')
app=once(app,
"      privacy: 'The app does not persist or export audio. System speech recognition may be processed locally or remotely depending on the browser/OS.'",
"      privacy: 'Audio replay is stored locally in IndexedDB when captured and is never included in JSON/TXT exports or sent by this app. System speech recognition may be processed locally or remotely depending on the browser/OS.'",
'privacy export')

# UI actions.
app=once(app,
"ui.mobileQuestionSelect?.addEventListener('change', event => {",
"ui.micPreviewBtn?.addEventListener('click', toggleMicrophonePreview);\nui.deleteAudioBtn?.addEventListener('click', async () => {\n  if (!session || !confirm('Supprimer définitivement les enregistrements audio locaux de cette session ?')) return;\n  stopReplay();\n  await dbAudioDeleteSession(session.id);\n  for (const response of Object.values(session.responses || {})) for (const turn of response.turns || []) turn.audioRef = null;\n  await persistSession();\n  ui.deleteAudioBtn.textContent = 'Audio local supprimé';\n  ui.deleteAudioBtn.disabled = true;\n});\n\nui.mobileQuestionSelect?.addEventListener('change', event => {",
'ui audio listeners')

# Ensure preview control mirrors recording state.
app=once(app,
"  ui.captureDock?.classList.toggle('is-finalizing', captureFinalizing && !recording);",
"  ui.captureDock?.classList.toggle('is-finalizing', captureFinalizing && !recording);\n  if (ui.micPreviewBtn) { ui.micPreviewBtn.disabled = recording || captureFinalizing; if (recording) { ui.micPreviewBtn.textContent = 'Micro actif'; ui.micPreviewBtn.setAttribute('aria-pressed', 'true'); } }",
'mic preview state')

# HTML.
index=once(index, './styles.css?v=40', './styles.css?v=41', 'css version')
index=once(index, './app.js?v=40', './app.js?v=41', 'app version')
index=once(index,
"""          <div class="capture-state-row">
            <div class="capture-state-copy">
              <strong id="captureModeLabel">PRÊT</strong>
              <span id="recordState" class="record-state">Cliquez sur la personne qui parle</span>
            </div>
            <span id="timer" class="timer">00:00</span>
          </div>

          <div id="speakerButtons" class="speaker-buttons"></div>""",
"""          <div class="capture-state-row">
            <div class="capture-state-copy">
              <strong id="captureModeLabel">PRÊT</strong>
              <span id="recordState" class="record-state">Cliquez sur la personne qui parle</span>
            </div>
            <span id="timer" class="timer">00:00</span>
          </div>

          <div class="mic-meter-row">
            <button id="micPreviewBtn" class="ghost small mic-preview-button" type="button" aria-pressed="false">Tester le micro</button>
            <div class="mic-meter" role="meter" aria-label="Niveau du microphone" aria-valuemin="0" aria-valuemax="100">
              <span class="mic-meter-recommended" aria-hidden="true"></span>
              <span id="micMeterFill" class="mic-meter-fill" style="--level:0" aria-hidden="true"></span>
            </div>
            <span id="micMeterState" class="mic-meter-state" data-level-state="silence">Silence</span>
          </div>

          <div id="speakerButtons" class="speaker-buttons"></div>""", 'meter html')
index=once(index,
"""      <div class="done-secondary">
        <button id="reviewBtn" class="link-button">Relire / corriger</button>
        <button id="newSessionBtn" class="link-button done-new-session">Nouvelle session</button>
      </div>""",
"""      <div class="done-secondary">
        <button id="reviewBtn" class="link-button">Relire / corriger</button>
        <button id="deleteAudioBtn" class="link-button">Supprimer l’audio local</button>
        <button id="newSessionBtn" class="link-button done-new-session">Nouvelle session</button>
      </div>""", 'delete audio html')

# New component styles only: no override strata.
css += """

/* Audio replay + real microphone level (V41 component styles). */
.mic-meter-row{display:grid;grid-template-columns:auto minmax(120px,1fr) auto;align-items:center;gap:10px}
.mic-meter{position:relative;height:10px;border-radius:999px;background:#e8edf2;overflow:hidden}
.mic-meter-fill{position:absolute;inset:0 auto 0 0;width:calc(var(--level,0)*100%);background:linear-gradient(90deg,#4f8f67 0 72%,#c79a36 86%,#b94747 100%);transition:width 45ms linear}
.mic-meter-recommended{position:absolute;left:68%;top:0;bottom:0;width:2px;background:#1d2733;opacity:.45;z-index:2}
.mic-meter-state{min-width:74px;font-size:.78rem;font-weight:700;text-align:right}
.mic-meter-state[data-level-state="low"]{opacity:.68}.mic-meter-state[data-level-state="hot"]{font-weight:800}
.turn-replay-button{min-width:34px;padding-inline:8px}
@media(max-width:560px){.mic-meter-row{grid-template-columns:auto 1fr}.mic-meter-state{grid-column:1/-1;text-align:right;margin-top:-6px}}
"""

# Service worker cache identity.
sw=once(sw, "const VERSION = 'offline-interview-v40';", "const VERSION = 'offline-interview-v41';", 'sw version')
sw=sw.replace('./styles.css?v=40','./styles.css?v=41').replace('./app.js?v=40','./app.js?v=41')

# Add audio runtime behavior to the canonical contract without creating another versioned test file.
test=test.replace('/interview-runtime-v40/', '/interview-runtime-v41/')
test=test.replace('/offline-interview-v40/', '/offline-interview-v41/')
test=test.replace('/styles\\.css\\?v=40/', '/styles\\.css\\?v=41/').replace('/app\\.js\\?v=40/', '/app\\.js\\?v=41/')
test=test.replace("'offline-interview.runtime-contract.v40'", "'offline-interview.runtime-contract.v41'")
test=test.replace("assert.ok(bytes(app) <= 89_000", "assert.ok(bytes(app) <= 98_000")
test=test.replace("assert.ok(bytes(css) <= 64_500", "assert.ok(bytes(css) <= 66_000")
test=test.replace("assert.ok(coreBytes <= 185_000", "assert.ok(coreBytes <= 196_000")
insert="""

// V41: audio is retained locally as complete recording blobs; turns hold only time references.
assert.match(app, /createObjectStore\('audio', \{ keyPath: 'id' \}\)/);
assert.match(app, /await dbAudioPut\(\{ id: captureId, sessionId: session\.id, blob/);
assert.match(app, /audioRef: \{ recordingId: recordingCaptureId, startMs: segmentStartMs, endMs: segmentEndMs \}/);
assert.match(app, /replayTurnAudio\(turn\)/);
assert.match(app, /AudioContext \|\| window\.webkitAudioContext/);
assert.match(app, /getFloatTimeDomainData/);
assert.match(app, /Math\.sqrt\(sum \/ samples\.length\)/);
assert.match(index, /id=\"micMeterFill\"/);
assert.match(index, /id=\"micPreviewBtn\"/);
assert.match(index, /id=\"deleteAudioBtn\"/);
assert.doesNotMatch(app, /base64.*audio/i);
"""
pos=test.find("// Explicit anti-growth budgets")
if pos<0: raise SystemExit('missing budget marker')
test=test[:pos]+insert+"\n"+test[pos:]

# Focused field test.
spec={
  'schema':'offline-interview.interview-spec.v1','id':'test-ux-v41-audio-replay-vumeter','version':'1.0',
  'title':'Test V41 — niveau micro et réécoute locale','context':'V40 est validée. V41 ajoute un indicateur réel du niveau microphone et conserve localement l’audio pour permettre la réécoute par prise de parole.',
  'objective':'Vérifier que la jauge suit réellement la voix avant et pendant la prise, puis qu’une prise enregistrée peut être réécoutée sans réseau.',
  'language':'fr-FR','tags':['v41','audio','replay','vu-meter','offline'], 'estimatedDurationMinutes':4,
  'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],
  'sections':[{'id':'S1','title':'Micro et réécoute','questions':[{
    'id':'Q1','label':'Jauge réelle et replay','text':'Vérifiez que Runtime affiche 2026-09-06.interview-runtime-v41. Avant d’enregistrer, cliquez sur « Tester le micro » : restez silencieux, parlez doucement, normalement puis très fort près du micro. La jauge doit suivre immédiatement ces changements et indiquer Silence, Faible, Bon niveau ou Trop fort de façon cohérente. Lancez ensuite une prise de parole normale, arrêtez-la, puis utilisez le bouton ▶ de cette prise pour réécouter exactement ce segment. Coupez le réseau si vous voulez confirmer que la réécoute reste locale. Dites si la jauge et la réécoute fonctionnent correctement.',
    'intent':'Qualifier la nouvelle capture audio locale sans confondre transcription et signal microphone.','estimatedMinutes':4,'required':True,'audience':['P2'],'followUps':[]
  }]}]
}
(root/'test-interviews'/'interview-test-ux-v41.json').write_text(json.dumps(spec,ensure_ascii=False,indent=2)+'\n')

for p,content in [(app_p,app),(index_p,index),(css_p,css),(sw_p,sw),(test_p,test)]: p.write_text(content)
print('V41 patch applied')

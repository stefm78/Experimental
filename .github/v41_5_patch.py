from pathlib import Path
import json

# --- app.js ---
p = Path('offline-interview/app.js')
s = p.read_text()
s = s.replace("import { detectSystemSpeech, createSystemSpeechSession } from './system-stt.js';", "import { detectSystemSpeech, createSystemSpeechSession, supportsSystemAudioTrackRecognition, transcribeSystemAudioTrack } from './system-stt.js';", 1)
s = s.replace("2026-09-06.interview-runtime-v41.4", "2026-09-06.interview-runtime-v41.5", 1)

old = """function systemSpeechLabel() {
  if (systemSpeechCapability.mode === 'local') return 'Système local';
  if (systemSpeechCapability.mode === 'standard') return 'Système';
  return 'Whisper local';
}

function refreshSttStatus() {
  if (systemSpeechCapability.mode === 'local') {
    ui.modelStatus.textContent = transcriber ? 'Automatique · secours local prêt' : 'Automatique · secours local';
    if (ui.diagStt) ui.diagStt.textContent = 'Système local · Whisper secours';
    return;
  }
  if (systemSpeechCapability.mode === 'standard') {
    ui.modelStatus.textContent = transcriber ? 'Automatique · secours local prêt' : 'Automatique · secours local';
    if (ui.diagStt) ui.diagStt.textContent = 'Système (réseau possible) · Whisper secours';
    return;
  }
  ui.modelStatus.textContent = transcriber ? 'Local prêt' : 'Secours local disponible';
  if (ui.diagStt) ui.diagStt.textContent = 'Système indisponible · Whisper secours';
}
"""
new = """function systemSpeechLabel() {
  if (systemSpeechCapability.mode === 'local') return 'Système local';
  if (systemSpeechCapability.mode === 'standard') return 'Système';
  return 'Audio seul';
}

function refreshSttStatus() {
  if (systemSpeechCapability.mode === 'local') {
    ui.modelStatus.textContent = 'Automatique · système local';
    if (ui.diagStt) ui.diagStt.textContent = 'Système local · Whisper uniquement manuel';
    return;
  }
  if (systemSpeechCapability.mode === 'standard') {
    ui.modelStatus.textContent = 'Automatique · système';
    if (ui.diagStt) ui.diagStt.textContent = 'Système (réseau possible) · Whisper uniquement manuel';
    return;
  }
  ui.modelStatus.textContent = transcriber ? 'Audio seul · Whisper manuel prêt' : 'Audio seul · système indisponible';
  if (ui.diagStt) ui.diagStt.textContent = 'Système indisponible · aucun Whisper automatique';
}
"""
if old not in s: raise SystemExit('STT status anchor missing')
s = s.replace(old, new, 1)

# Post-interview direct system retranscription from stored audio track.
anchor = """async function replayTurnAudio(turn) {
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
"""
insert = anchor + """
async function buildTurnRecognitionTrack(turn) {
  const ref = turn?.audioRef;
  if (!ref?.recordingId) throw new Error('Audio local absent pour cette prise.');
  const record = await dbAudioGet(ref.recordingId);
  if (!record?.blob) throw new Error('Audio local introuvable pour cette prise.');
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Web Audio indisponible.');
  const context = new Context();
  await context.resume();
  const decoded = await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));
  const startSeconds = Math.max(0, Number(ref.startMs) || 0) / 1000;
  const requestedEnd = Math.max(startSeconds, Number(ref.endMs) || 0) / 1000;
  const endSeconds = Math.min(decoded.duration, requestedEnd > startSeconds ? requestedEnd : decoded.duration);
  const durationSeconds = Math.max(0.05, endSeconds - startSeconds);
  const destination = context.createMediaStreamDestination();
  const source = context.createBufferSource();
  source.buffer = decoded;
  source.connect(destination);
  const track = destination.stream.getAudioTracks()[0];
  if ('contentHint' in track) track.contentHint = 'speech-recognition';
  let started = false;
  return {
    track,
    durationMs: Math.ceil(durationSeconds * 1000),
    start() { if (!started) { started = true; source.start(0, startSeconds, durationSeconds); } },
    cleanup() { try { if (started) source.stop(); } catch {} try { track.stop(); } catch {} context.close().catch(() => {}); }
  };
}

async function retranscribeTurnWithSystem(turn, button) {
  showError(ui.interviewError, '');
  if (!supportsSystemAudioTrackRecognition()) {
    showError(ui.interviewError, 'La retranscription système d’un enregistrement est disponible dans Chrome/Edge de bureau récents, mais pas encore dans les navigateurs mobiles. L’audio reste réécoutable et le texte modifiable.');
    return;
  }
  if (systemSpeechCapability.mode === 'unavailable') {
    showError(ui.interviewError, 'La transcription système n’est pas disponible dans ce navigateur.');
    return;
  }
  const previousLabel = button?.textContent || '↻ Système';
  if (button) { button.disabled = true; button.textContent = '…'; }
  stopReplay();
  let input = null;
  try {
    input = await buildTurnRecognitionTrack(turn);
    const result = await transcribeSystemAudioTrack(input.track, {
      lang: interview?.language || 'fr-FR',
      mode: systemSpeechCapability.mode,
      durationMs: input.durationMs,
      onStart: () => input.start()
    });
    const text = cleanText(result?.text);
    if (!meaningfulTranscript(text)) throw new Error('Aucun texte reconnu par le système pour cet extrait.');
    if (!Array.isArray(turn.transcriptionHistory)) turn.transcriptionHistory = [];
    if (cleanText(turn.text)) turn.transcriptionHistory.push({ text: turn.text, source: turn.source || null, at: nowIso() });
    turn.text = text;
    turn.rawTranscript = text;
    turn.source = result.mode === 'local' ? 'system-local-retranscribed' : 'system-retranscribed';
    turn.updatedAt = nowIso();
    session.updatedAt = nowIso();
    logRuntimeEvent('system_retranscription_succeeded', { turnId: turn.id, mode: result.mode });
    renderTurns();
    persistSessionLater('system-retranscription');
  } catch (error) {
    recordRuntimeWarning('system_retranscription_error', error);
    showError(ui.interviewError, `Retranscription système impossible : ${error.message || error}`);
  } finally {
    input?.cleanup();
    if (button?.isConnected) { button.disabled = false; button.textContent = previousLabel; }
  }
}
"""
if anchor not in s: raise SystemExit('replay anchor missing')
s = s.replace(anchor, insert, 1)

# Preserve audio-only answer turns when the system produced no text.
marker = """async function addComposerTurn() {
"""
helper = """async function appendAudioOnlyTurn({ questionId, speakerId, durationSeconds = 0, audioRef = null }) {
  if (!questionId || !speakerId || !audioRef?.recordingId) return false;
  const response = responseFor(questionId);
  response.turns.push(createTurn({ type: 'answer', speakerId, text: '', source: 'audio-system-pending', durationSeconds, audioRef }));
  response.status = 'answered';
  session.updatedAt = nowIso();
  await persistSession();
  renderTurns();
  renderQuestionNav();
  renderInterviewMetrics();
  return true;
}

"""
if marker not in s: raise SystemExit('composer marker missing')
s = s.replace(marker, helper + marker, 1)

old = """    if (!meaningfulTranscript(text)) {
      registerCaptureGap(
        previousQuestionId,
        previousSpeakerId,
        'Aucun texte reconnu pour ce passage au changement de personne. Répétez ce passage.'
      );
      return;
    }
"""
new = """    if (!meaningfulTranscript(text)) {
      await appendAudioOnlyTurn({
        questionId: previousQuestionId,
        speakerId: previousSpeakerId,
        durationSeconds,
        audioRef: failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs }
      });
      logRuntimeEvent('system_transcription_missing', { questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true });
      return;
    }
"""
if old not in s: raise SystemExit('boundary missing-text anchor missing')
s = s.replace(old, new, 1)

old = """    if (!text) {
      show(ui.transcribing, true);
      if (recordingHadCuts) {
        const message = 'Aucun texte système pour cette prise après un changement de personne. Répétez ce passage.';
        registerCaptureGap(questionId, speakerId, message);
        throw new Error(message);
      }
      ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'
        ? 'Transcription Whisper locale…'
        : 'Aucun texte système · secours Whisper…';
      if (!transcriber) await prepareModel();
      const samples = await blobTo16kMono(blob);
      const result = await transcriber(samples, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      text = cleanText(result?.text);
      source = 'whisper-local';
      rawTranscript = text;
    }
"""
new = """    if (!text) {
      ui.recordState.textContent = 'Audio enregistré · transcription système à relancer';
      logRuntimeEvent('system_transcription_missing', { questionId, speakerId, boundary: false, systemMode: systemSpeechCapability.mode });
    }
"""
if old not in s: raise SystemExit('automatic Whisper fallback anchor missing')
s = s.replace(old, new, 1)

old = """    } else {
      ui.recordState.textContent = 'Aucun texte reconnu';
      showError(ui.interviewError, 'Aucun texte n’a été reconnu pour cette prise de parole.');
    }
"""
new = """    } else if (audioStored) {
      await appendAudioOnlyTurn({
        questionId,
        speakerId,
        durationSeconds,
        audioRef: { recordingId: captureId, startMs: recordingAudioOffsetMs, endMs: recordingAudioOffsetMs + Math.max(0, durationSeconds || 0) * 1000 }
      });
      ui.recordState.textContent = 'Audio enregistré · texte à retranscrire';
      showError(ui.interviewError, 'La transcription système n’a rien renvoyé. L’audio est conservé : vous pourrez le réécouter et relancer la transcription système après l’entretien.');
    } else {
      ui.recordState.textContent = 'Audio non conservé';
      showError(ui.interviewError, 'La transcription système n’a rien renvoyé et l’audio local n’a pas pu être conservé.');
    }
"""
if old not in s: raise SystemExit('final no-text anchor missing')
s = s.replace(old, new, 1)

# Voice labels include audio-only turns, and each answer gets a direct system retranscription control.
s = s.replace("(/system|whisper|speech/.test(turn.source || '') ? 'Voix' : 'Texte')", "(/system|whisper|speech|audio/.test(turn.source || '') ? 'Voix' : 'Texte')", 1)
old = """    replay.disabled = !turn.audioRef?.recordingId;
    replay.addEventListener('click', () => replayTurnAudio(turn));
    if (turn.type === 'answer') head.append(select, type, meta, replay, remove);
    else head.append(select, type, meta, remove);
"""
new = """    replay.disabled = !turn.audioRef?.recordingId;
    replay.addEventListener('click', () => replayTurnAudio(turn));
    const retranscribe = document.createElement('button');
    retranscribe.type = 'button';
    retranscribe.className = 'ghost small turn-retranscribe-button';
    retranscribe.textContent = '↻ Système';
    const trackSupported = supportsSystemAudioTrackRecognition();
    retranscribe.disabled = !turn.audioRef?.recordingId || !trackSupported || systemSpeechCapability.mode === 'unavailable';
    retranscribe.title = trackSupported
      ? 'Relancer la transcription système directement depuis cet audio'
      : 'Retranscription système depuis un audio enregistré non prise en charge sur ce navigateur mobile ou ancien';
    retranscribe.setAttribute('aria-label', retranscribe.title);
    retranscribe.addEventListener('click', () => retranscribeTurnWithSystem(turn, retranscribe));
    if (turn.type === 'answer') head.append(select, type, meta, replay, retranscribe, remove);
    else head.append(select, type, meta, remove);
"""
if old not in s: raise SystemExit('turn replay anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)

# --- system-stt.js ---
p = Path('offline-interview/system-stt.js')
s = p.read_text()
if 'export function supportsSystemAudioTrackRecognition()' in s:
    raise SystemExit('system audio-track helper already exists')
s += r'''

// V41.5 — direct post-hoc recognition from a saved audio MediaStreamTrack.
// Chromium exposes SpeechRecognition.start(audioTrack) on desktop from 135 onward.
// Mobile engines do not currently expose this path, so capability is deliberately conservative.
export function supportsSystemAudioTrackRecognition() {
  const ua = navigator.userAgent || '';
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(ua);
  const version = ua.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);
  return Boolean(SpeechRecognitionCtor && !mobile && version && Number(version[1]) >= 135);
}

export function transcribeSystemAudioTrack(audioTrack, {
  lang = 'fr-FR', mode = 'standard', durationMs = 0, onStart = () => {}
} = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognitionCtor) { reject(new Error('SpeechRecognition indisponible')); return; }
    if (!audioTrack || audioTrack.kind !== 'audio' || audioTrack.readyState !== 'live') { reject(new Error('Piste audio invalide')); return; }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if ('processLocally' in recognition) recognition.processLocally = mode === 'local';
    const results = new Map();
    let settled = false;
    let stopTimer = null;
    let hardTimer = null;
    const text = () => [...results.keys()].sort((a, b) => a - b).map(i => results.get(i)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer); clearTimeout(hardTimer);
      try { recognition.abort(); } catch {}
      if (error) reject(error); else resolve({ text: text(), finalText: text(), mode });
    };
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const value = String(event.results[i]?.[0]?.transcript || '').trim();
        if (value) results.set(i, value);
      }
    };
    recognition.onerror = event => {
      const code = event?.error || 'speech-recognition-error';
      if (code === 'no-speech') return;
      finish(new Error(code));
    };
    recognition.onend = () => finish();
    recognition.onstart = () => {
      try { onStart(); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
      stopTimer = setTimeout(() => { try { recognition.stop(); } catch { finish(); } }, Math.max(800, Number(durationMs) || 0) + 700);
    };
    hardTimer = setTimeout(() => finish(new Error('Délai de retranscription système dépassé')), Math.max(8000, (Number(durationMs) || 0) + 8000));
    try { recognition.start(audioTrack); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}
'''
p.write_text(s)

# --- versioned assets ---
for name in ['offline-interview/index.html', 'offline-interview/sw.js']:
    p = Path(name); s = p.read_text()
    s = s.replace('41.4', '41.5')
    p.write_text(s)

# --- runtime contract ---
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text().replace('41\\.4', '41\\.5').replace('v41.4', 'v41.5')
marker = '// Explicit anti-growth budgets. Raising one requires a conscious code-review decision.'
checks = r'''// V41.5: automatic transcription is system-first/system-only; saved audio remains usable when text is absent.
assert.doesNotMatch(app, /Aucun texte système · secours Whisper/);
assert.doesNotMatch(app, /Transcription Whisper locale/);
assert.match(app, /appendAudioOnlyTurn\(/);
assert.match(app, /audio-system-pending/);
assert.match(app, /retranscribeTurnWithSystem\(turn, retranscribe\)/);
assert.match(app, /supportsSystemAudioTrackRecognition\(\)/);
assert.match(systemStt, /export function transcribeSystemAudioTrack\(/);
assert.match(systemStt, /recognition\.start\(audioTrack\)/);
assert.match(systemStt, /Chrome\|Chromium\|Edg/);

'''
if marker not in s: raise SystemExit('runtime contract marker missing')
s = s.replace(marker, checks + marker, 1)
s = s.replace("contract: 'offline-interview.runtime-contract.v41.4'", "contract: 'offline-interview.runtime-contract.v41.5'")
p.write_text(s)

# --- field test ---
field = {
  'schema':'offline-interview.interview-spec.v1','id':'test-ux-v41-5-system-retranscription','version':'1.0',
  'title':'Test V41.5 — transcription système et reprise audio',
  'context':'Vérifier que Whisper ne remplace plus automatiquement une transcription système manquante et que l’audio reste exploitable.',
  'objective':'Tester la transcription Windows, la conservation audio et la retranscription système depuis un replay.',
  'language':'fr-FR','estimatedDurationMinutes':5,
  'participants':[{'id':'P1','name':'Interviewer','role':'interviewer'},{'id':'P2','name':'Testeur','role':'interviewee'}],
  'sections':[{'id':'S1','title':'Transcription système','questions':[
    {'id':'Q1','label':'Windows','text':'Sur Windows avec Chrome ou Edge récent, dites une phrase normale pendant environ dix secondes. Vérifiez que le texte vient du système comme avant et qu’aucun secours Whisper ne démarre tout seul.','intent':'Ne pas régresser le bon fonctionnement Windows.','estimatedMinutes':1,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q2','label':'Après la fin','text':'Terminez l’entretien, puis choisissez Relire / corriger. Sur une prise avec audio, cliquez sur ▶ pour l’écouter, puis sur ↻ Système. Le texte doit être recalculé depuis cet audio et rester modifiable.','intent':'Tester la retranscription directe depuis le replay.','estimatedMinutes':2,'required':True,'audience':['P2'],'followUps':[]},
    {'id':'Q3','label':'Téléphone','text':'Sur téléphone, faites une petite prise. Si le système ne donne pas de texte, vérifiez qu’aucun Whisper automatique ne se lance et que la prise audio reste visible et réécoutable. Le bouton ↻ Système peut être indisponible sur mobile : son message doit l’expliquer clairement.','intent':'Vérifier le comportement sûr lorsque le navigateur mobile ne sait pas retranscrire un fichier audio avec le système.','estimatedMinutes':2,'required':True,'audience':['P2'],'followUps':[]}
  ]}]
}
Path('offline-interview/test-interviews/interview-test-ux-v41-5.json').write_text(json.dumps(field, ensure_ascii=False, indent=2)+'\n')

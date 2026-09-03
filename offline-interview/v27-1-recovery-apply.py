from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
styles_path = root / 'offline-interview' / 'styles.css'
sw_path = root / 'offline-interview' / 'sw.js'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)


app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "const BUILD_ID = '2026-09-03.interview-runtime-v27';",
    "const BUILD_ID = '2026-09-03.interview-runtime-v27-1';",
    'build id'
)
for line in [
    'let recordingUsesBoundedAudio = false;\n',
    'let boundedPendingCount = 0;\n',
    'let boundedTranscriptionQueue = Promise.resolve();\n',
]:
    if line not in app:
        raise RuntimeError(f'missing V27 state line: {line.strip()}')
    app = app.replace(line, '', 1)

v26_rotate = '''async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {
  if (!isRecording() || !recordingSpeakerId || !recordingQuestionId) return false;
  if (!nextSpeakerId || !nextQuestionId) return false;
  if (nextSpeakerId === recordingSpeakerId && nextQuestionId === recordingQuestionId) return true;
  if (!systemSpeechSession?.takeSegment) return false;

  const snapshot = systemSpeechSession.takeSegment();
  const text = cleanText(snapshot?.text);
  if (!meaningfulTranscript(text)) return false;

  const previousSpeakerId = recordingSpeakerId;
  const previousQuestionId = recordingQuestionId;
  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);
  const source = snapshot.mode === 'local' ? 'system-local' : 'system';
  const rawTranscript = snapshot.finalText || text;

  recordingSpeakerId = nextSpeakerId;
  recordingQuestionId = nextQuestionId;
  session.activeSpeakerId = nextSpeakerId;
  session.updatedAt = nowIso();
  startedRecordingAt = performance.now();
  composerDurationSeconds = 0;
  chunks = [];
  ui.timer.textContent = '00:00';
  if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';

  renderSpeakerButtons();
  renderQuestionNav();
  updateCaptureUi();

  await appendAnswerTurn({
    questionId: previousQuestionId,
    speakerId: previousSpeakerId,
    text,
    source,
    rawTranscript,
    durationSeconds
  });
  await persistSession();
  return true;
}

'''
app, n = re.subn(
    r'async function rotateLiveSegment\(nextSpeakerId, nextQuestionId\) \{.*?\n\}\n\n(?=function captureQuestionEntry)',
    v26_rotate,
    app,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'rotateLiveSegment replacement count={n}')

app = app.replace('  await boundedTranscriptionQueue;\n', '')

app, n = re.subn(
    r'\nfunction rotateAudioRecorderAtBoundary\(\) \{.*?\n\}\nasync function startRecording',
    '\nasync function startRecording',
    app,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'bounded audio helper removal count={n}')

app = app.replace('    recordingUsesBoundedAudio = false;\n', '')

new_logic = '''    const systemSnapshot = systemSpeechSession?.snapshot() || { text: '', finalText: '', mode: systemSpeechCapability.mode };
    let text = cleanText(systemSnapshot.text);
    let source = systemSnapshot.mode === 'local' ? 'system-local' : 'system';
    let rawTranscript = systemSnapshot.finalText || text;

    if (!text) {
      show(ui.transcribing, true);
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

'''
pattern = re.compile(
    r"    const systemSnapshot = systemSpeechSession\?\.snapshot\(\) \|\| \{ text: '', finalText: '', mode: systemSpeechCapability\.mode \};\n"
    r".*?"
    r"(?=    if \(text\) \{)",
    re.S,
)
app, n = pattern.subn(new_logic, app, count=1)
if n != 1:
    raise RuntimeError(f'handleRecordingStopped structural replacement count={n}')

app = replace_once(app, "register('./sw.js?v=27'", "register('./sw.js?v=27-1'", 'sw registration query')
app = replace_once(app, "'actif · v27'", "'actif · v27.1'", 'active sw label')
app = replace_once(app, "'installé · v27'", "'installé · v27.1'", 'installed sw label')

for forbidden in ['recordingUsesBoundedAudio', 'boundedTranscriptionQueue', 'boundedPendingCount', 'transcribeBoundedAudio', 'rotateAudioRecorderAtBoundary', 'whisper-local-boundary']:
    if forbidden in app:
        raise RuntimeError(f'forbidden V27 runtime symbol remains: {forbidden}')
app_path.write_text(app, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
index = replace_once(index, 'Continuer sur la question affichée →', 'Basculer sur la question affichée →', 'static transfer copy')
index = replace_once(
    index,
    '<span class="recording-mic" aria-hidden="true">🎙</span>',
    '<span class="recording-mic" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.92V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.08A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg></span>',
    'microphone svg'
)
index = replace_once(index, '<script type="module" src="./app.js?v=26"></script>', '<script type="module" src="./app.js?v=27-1"></script>', 'app cache bust')
index_path.write_text(index, encoding='utf-8')

styles = styles_path.read_text(encoding='utf-8')
svg_css = '''

/* V27.1 — deterministic microphone glyph, independent from emoji fonts */
.recording-mic svg{
  width:18px!important;
  height:18px!important;
  display:block!important;
  fill:currentColor!important;
}
'''
if '/* V27.1 — deterministic microphone glyph' not in styles:
    styles += svg_css
styles_path.write_text(styles, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = replace_once(sw, "const VERSION = 'offline-interview-v27';", "const VERSION = 'offline-interview-v27-1';", 'sw version')
sw = replace_once(sw, "'./', './index.html', './styles.css', './app.js?v=27', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=27-1', './system-stt.js',", 'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V27.1 recovery patch applied')

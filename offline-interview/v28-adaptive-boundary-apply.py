from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
sw_path = root / 'offline-interview' / 'sw.js'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

app = app_path.read_text(encoding='utf-8')
app = replace_once(
    app,
    "const BUILD_ID = '2026-09-04.interview-runtime-v27-2';",
    "const BUILD_ID = '2026-09-04.interview-runtime-v28';",
    'build id'
)
app = replace_once(
    app,
    'let recordingCaptureId = null;\n',
    'let recordingCaptureId = null;\nlet semanticBoundaryCommitQueue = Promise.resolve();\n',
    'semantic boundary queue state'
)

new_rotate = r'''async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {
  if (!isRecording() || !recordingSpeakerId || !recordingQuestionId) return false;
  if (!nextSpeakerId || !nextQuestionId) return false;
  if (nextSpeakerId === recordingSpeakerId && nextQuestionId === recordingQuestionId) return true;
  if (!systemSpeechSession?.takeSegment) return false;

  const snapshot = systemSpeechSession.takeSegment();
  const initialText = cleanText(snapshot?.text);
  if (!meaningfulTranscript(initialText)) return false;

  const previousSpeakerId = recordingSpeakerId;
  const previousQuestionId = recordingQuestionId;
  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);
  const baseSource = snapshot.mode === 'local' ? 'system-local' : 'system';

  // Ownership switches immediately in the UI. Only persistence of the previous semantic
  // segment waits for Chromium to finalise result indexes that were still interim at the
  // click. This keeps the interface responsive while preventing late-tail leakage.
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

  const commit = async () => {
    let settled = null;
    try { settled = snapshot.settled ? await snapshot.settled : null; } catch {}
    const text = cleanText(settled?.text || snapshot.finalText || snapshot.text);
    if (!meaningfulTranscript(text)) return;
    const source = snapshot.pendingCount > 0 ? `${baseSource}-settled` : baseSource;
    await appendAnswerTurn({
      questionId: previousQuestionId,
      speakerId: previousSpeakerId,
      text,
      source,
      rawTranscript: text,
      durationSeconds
    });
    await persistSession();
  };
  semanticBoundaryCommitQueue = semanticBoundaryCommitQueue.then(commit, commit);
  return true;
}

'''
app, n = re.subn(
    r'async function rotateLiveSegment\(nextSpeakerId, nextQuestionId\) \{.*?\n\}\n\n(?=function captureQuestionEntry)',
    new_rotate,
    app,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'rotateLiveSegment replacement count={n}')

app = replace_once(
    app,
    '  if (captureFinalizing || recordingCompletionPromise) {\n    if (recordingCompletionPromise) await recordingCompletionPromise;\n  }\n  return true;\n}',
    '  if (captureFinalizing || recordingCompletionPromise) {\n    if (recordingCompletionPromise) await recordingCompletionPromise;\n  }\n  await semanticBoundaryCommitQueue;\n  return true;\n}',
    'finish queue drain'
)
app = replace_once(
    app,
    '    if (text) {\n      await appendAnswerTurn({',
    '    await semanticBoundaryCommitQueue;\n\n    if (text) {\n      await appendAnswerTurn({',
    'final capture ordering'
)
app = replace_once(app, "register('./sw.js?v=27-2'", "register('./sw.js?v=28'", 'sw registration')
app = replace_once(app, "'actif · v27.2'", "'actif · v28'", 'sw active label')
app = replace_once(app, "'installé · v27.2'", "'installé · v28'", 'sw installed label')
app_path.write_text(app, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
index = replace_once(index,
    '                <span class="top-on-air-mic" aria-hidden="true">🎙</span>\n',
    '',
    'top microphone removal')
index, n = re.subn(
    r'\s*<span class="recording-mic" aria-hidden="true"><svg.*?</svg></span>\n',
    '\n',
    index,
    count=1,
    flags=re.S,
)
if n != 1:
    raise RuntimeError(f'capture microphone removal count={n}')
index = replace_once(index,
    '<script type="module" src="./app.js?v=27-2"></script>',
    '<script type="module" src="./app.js?v=28"></script>',
    'app query')
index_path.write_text(index, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = replace_once(sw, "const VERSION = 'offline-interview-v27-2';", "const VERSION = 'offline-interview-v28';", 'sw version')
sw = replace_once(sw,
    "'./', './index.html', './styles.css', './app.js?v=27-2', './system-stt.js',",
    "'./', './index.html', './styles.css', './app.js?v=28', './system-stt.js',",
    'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V28 adaptive boundary app patch applied')

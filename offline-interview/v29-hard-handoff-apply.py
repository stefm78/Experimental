from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
stt_path = root / 'offline-interview' / 'system-stt.js'
index_path = root / 'offline-interview' / 'index.html'
style_path = root / 'offline-interview' / 'styles.css'
sw_path = root / 'offline-interview' / 'sw.js'


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

# ---------- system-stt.js ----------
stt = stt_path.read_text(encoding='utf-8')
stt = once(stt,
    "  let restartTimer = null;\n  let carryText = '';",
    "  let restartTimer = null;\n  let carryText = '';\n  let hardCut = null;\n  const hardCutKey = `offline-interview.stt-hard-cut.v1:${mode}:${lang}`;\n  let hardCutSamples = [];\n  try {\n    const saved = JSON.parse(localStorage.getItem(hardCutKey) || 'null');\n    if (Array.isArray(saved?.samples)) hardCutSamples = saved.samples.map(Number).filter(Number.isFinite).filter(v => v >= 0 && v <= 5000).slice(-24);\n  } catch {}",
    'hard-cut state')

stt = once(stt,
    "  const percentile = (values, p) => {\n    if (!values.length) return null;\n    const sorted = [...values].sort((a, b) => a - b);\n    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];\n  };",
    "  const percentile = (values, p) => {\n    if (!values.length) return null;\n    const sorted = [...values].sort((a, b) => a - b);\n    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];\n  };\n\n  const rememberHardCut = ms => {\n    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;\n    hardCutSamples.push(Math.round(ms));\n    hardCutSamples = hardCutSamples.slice(-24);\n    try { localStorage.setItem(hardCutKey, JSON.stringify({ samples: hardCutSamples })); } catch {}\n  };\n\n  const hardCutCalibration = () => ({\n    sampleCount: hardCutSamples.length,\n    p50Ms: percentile(hardCutSamples, 0.50),\n    p95Ms: percentile(hardCutSamples, 0.95)\n  });",
    'hard-cut calibration helpers')

stt = once(stt,
    "  recognition.onstart = () => onState(mode === 'local' ? 'listening-local' : 'listening');",
    "  recognition.onstart = () => {\n    if (hardCut?.waitingForRestart) {\n      const handoffMs = Math.max(0, performance.now() - hardCut.startedAt);\n      rememberHardCut(handoffMs);\n      hardCut.readyResolve({ ready: true, handoffMs: Math.round(handoffMs), calibration: hardCutCalibration() });\n      clearTimeout(hardCut.timer);\n      hardCut = null;\n    }\n    onState(mode === 'local' ? 'listening-local' : 'listening');\n  };",
    'onstart hard cut')

old_onend = """  recognition.onend = () => {\n    // Chromium restarts reset result indexes. Resolve any outstanding semantic boundary\n    // before dropping the index namespace, then carry only the current segment forward.\n    resolveAllBoundaries('recognition-end');\n    if (!shouldRun) return;\n\n    const current = segmentText();\n    if (current) carryText = current;\n    latestResults.clear();\n    boundaryResults = new Map();\n\n    restartTimer = setTimeout(() => {\n      if (!shouldRun) return;\n      try { recognition.start(); } catch {}\n    }, 120);\n  };"""
new_onend = """  recognition.onend = () => {\n    // A semantic hard cut deliberately ends this SpeechRecognition session. All results\n    // delivered before onend — even a brand-new result index arriving after the click —\n    // still belong to the previous speaker. The next speaker starts with a fresh result\n    // namespace after restart.\n    if (hardCut) {\n      resolveAllBoundaries('hard-cut');\n      const text = segmentText();\n      hardCut.settledResolve({\n        text, finalText: text, mode, resultSeen: Boolean(text) || resultSeen, lastError\n      });\n      latestResults.clear();\n      boundaryResults = new Map();\n      carryText = '';\n      resultSeen = false;\n      lastError = null;\n      hardCut.waitingForRestart = true;\n\n      if (!shouldRun) {\n        hardCut.readyResolve({ ready: false, handoffMs: null, reason: 'stopped', calibration: hardCutCalibration() });\n        clearTimeout(hardCut.timer);\n        hardCut = null;\n        return;\n      }\n\n      restartTimer = setTimeout(() => {\n        if (!shouldRun || !hardCut) return;\n        try {\n          recognition.start();\n        } catch (error) {\n          hardCut.readyResolve({ ready: false, handoffMs: null, reason: String(error?.message || error), calibration: hardCutCalibration() });\n          clearTimeout(hardCut.timer);\n          hardCut = null;\n        }\n      }, 0);\n      return;\n    }\n\n    // Unplanned Chromium restarts keep the same semantic speaker and may therefore carry\n    // the current text into the next recognition namespace.\n    resolveAllBoundaries('recognition-end');\n    if (!shouldRun) return;\n    const current = segmentText();\n    if (current) carryText = current;\n    latestResults.clear();\n    boundaryResults = new Map();\n    restartTimer = setTimeout(() => {\n      if (!shouldRun) return;\n      try { recognition.start(); } catch {}\n    }, 120);\n  };"""
stt = once(stt, old_onend, new_onend, 'onend hard cut')

needle = """    snapshot() {\n      const text = segmentText();\n      return {\n        text,\n        finalText: text,\n        mode,\n        resultSeen: Boolean(text) || resultSeen,\n        lastError\n      };\n    },\n    takeSegment({ settleTimeoutMs = null } = {}) {"""
replacement = """    snapshot() {\n      const text = segmentText();\n      return {\n        text,\n        finalText: text,\n        mode,\n        resultSeen: Boolean(text) || resultSeen,\n        lastError\n      };\n    },\n    cutSegment({ timeoutMs = 1800 } = {}) {\n      if (hardCut) return null;\n      const initialText = segmentText();\n      let settledResolve;\n      let readyResolve;\n      const settled = new Promise(resolve => { settledResolve = resolve; });\n      const ready = new Promise(resolve => { readyResolve = resolve; });\n      hardCut = {\n        startedAt: performance.now(),\n        settledResolve,\n        readyResolve,\n        waitingForRestart: false,\n        timer: null\n      };\n      hardCut.timer = setTimeout(() => {\n        if (!hardCut) return;\n        try { recognition.abort(); } catch {}\n      }, Math.max(700, Math.min(3000, Number(timeoutMs) || 1800)));\n      try {\n        recognition.stop();\n      } catch (error) {\n        settledResolve({ text: initialText, finalText: initialText, mode, resultSeen: Boolean(initialText) || resultSeen, lastError: String(error?.message || error) });\n        readyResolve({ ready: false, handoffMs: null, reason: String(error?.message || error), calibration: hardCutCalibration() });\n        clearTimeout(hardCut.timer);\n        hardCut = null;\n      }\n      return { text: initialText, finalText: initialText, mode, settled, ready };\n    },\n    takeSegment({ settleTimeoutMs = null } = {}) {"""
stt = once(stt, needle, replacement, 'cutSegment api')

stt = once(stt,
    "        timeoutMs: recommendedSettleTimeoutMs()\n      };\n    }",
    "        timeoutMs: recommendedSettleTimeoutMs(),\n        hardCut: hardCutCalibration()\n      };\n    }",
    'calibration export')
stt_path.write_text(stt, encoding='utf-8')

# ---------- app.js ----------
app = app_path.read_text(encoding='utf-8')
app = once(app, "const BUILD_ID = '2026-09-04.interview-runtime-v28';", "const BUILD_ID = '2026-09-04.interview-runtime-v29';", 'build id')
app = once(app,
    "let semanticBoundaryCommitQueue = Promise.resolve();",
    "let semanticBoundaryCommitQueue = Promise.resolve();\nlet captureHandoffPending = false;\nlet latestHandoffCalibration = null;",
    'handoff app state')

new_rotate = r'''async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {
  if (!isRecording() || !recordingSpeakerId || !recordingQuestionId) return false;
  if (!nextSpeakerId || !nextQuestionId) return false;
  if (nextSpeakerId === recordingSpeakerId && nextQuestionId === recordingQuestionId) return true;
  if (!systemSpeechSession?.cutSegment) return false;

  const previousSpeakerId = recordingSpeakerId;
  const previousQuestionId = recordingQuestionId;
  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);
  const cut = systemSpeechSession.cutSegment();
  if (!cut) return false;

  // UI ownership changes immediately, but ON AIR is briefly replaced by PASSAGE until
  // the fresh SpeechRecognition session is listening. This makes the semantic boundary
  // real instead of guessing from late result indexes.
  recordingSpeakerId = nextSpeakerId;
  recordingQuestionId = nextQuestionId;
  session.activeSpeakerId = nextSpeakerId;
  session.updatedAt = nowIso();
  startedRecordingAt = performance.now();
  composerDurationSeconds = 0;
  chunks = [];
  captureHandoffPending = true;
  ui.timer.textContent = '00:00';
  if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';
  renderSpeakerButtons();
  renderQuestionNav();
  updateCaptureUi();

  const baseSource = systemSpeechCapability.mode === 'local' ? 'system-local-cut' : 'system-cut';
  const commit = async () => {
    let settled = null;
    try { settled = await cut.settled; } catch {}
    const text = cleanText(settled?.text || cut.text);
    if (!meaningfulTranscript(text)) return;
    await appendAnswerTurn({
      questionId: previousQuestionId,
      speakerId: previousSpeakerId,
      text,
      source: baseSource,
      rawTranscript: settled?.finalText || text,
      durationSeconds
    });
    await persistSession();
  };
  semanticBoundaryCommitQueue = semanticBoundaryCommitQueue.then(commit, commit);

  Promise.resolve(cut.ready).then(info => {
    latestHandoffCalibration = info?.calibration || latestHandoffCalibration;
    captureHandoffPending = false;
    renderSpeakerButtons();
    renderQuestionNav();
    updateCaptureUi();
  }).catch(() => {
    captureHandoffPending = false;
    updateCaptureUi();
  });
  return true;
}

'''
app, n = re.subn(r'async function rotateLiveSegment\(nextSpeakerId, nextQuestionId\) \{.*?\n\}\n\n(?=function captureQuestionEntry)', new_rotate, app, count=1, flags=re.S)
if n != 1: raise RuntimeError(f'rotateLiveSegment replacement count={n}')

app = once(app,
    "  show(ui.topOnAir, recording);",
    "  show(ui.topOnAir, recording && !captureHandoffPending);",
    'top ON AIR handoff')

old_recording_ui = """  if (recording) {\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'ON AIR';\n    ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';\n  } else if (captureFinalizing) {"""
new_recording_ui = """  if (recording && captureHandoffPending) {\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'PASSAGE';\n    ui.recordState.textContent = active ? `${active.name} · préparation…` : 'Passage de parole…';\n  } else if (recording) {\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'ON AIR';\n    ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';\n  } else if (captureFinalizing) {"""
app = once(app, old_recording_ui, new_recording_ui, 'handoff capture UI')

app = once(app,
    "    button.dataset.captureState = recording ? 'recording' : queued ? 'queued' : 'idle';",
    "    button.dataset.captureState = recording ? 'recording' : queued ? 'queued' : 'idle';\n    button.disabled = Boolean(captureHandoffPending);",
    'disable speaker buttons during cut')

app = once(app,
    "  ui.questionText.textContent = question.text;\n  ui.questionIntent.textContent = question.intent || '';",
    "  ui.questionText.textContent = question.text;\n  const questionLength = cleanText(question.text).length;\n  ui.questionText.classList.toggle('question-long', questionLength > 220);\n  ui.questionText.classList.toggle('question-very-long', questionLength > 420);\n  ui.questionText.scrollTop = 0;\n  ui.questionIntent.textContent = question.intent || '';",
    'adaptive long question')

app = once(app,
    "      transcriptionFallback: 'whisper-local',\n      privacy:",
    "      transcriptionFallback: 'whisper-local',\n      speechHandoffCalibration: latestHandoffCalibration,\n      privacy:",
    'export handoff calibration')

app = app.replace("register('./sw.js?v=28'", "register('./sw.js?v=29'")
app = app.replace("'actif · v28'", "'actif · v29'")
app = app.replace("'installé · v28'", "'installé · v29'")
app_path.write_text(app, encoding='utf-8')

# ---------- index / styles / service worker ----------
index = index_path.read_text(encoding='utf-8')
index = once(index, '<script type="module" src="./app.js?v=28"></script>', '<script type="module" src="./app.js?v=29"></script>', 'app cache query')
index_path.write_text(index, encoding='utf-8')

styles = style_path.read_text(encoding='utf-8')
styles += r'''

/* V29 — long questions stay central without consuming the whole interview viewport. */
.question.question-long{
  font-size:clamp(1.15rem,1.8vw,1.6rem)!important;
  line-height:1.42!important;
  max-height:38vh;
  overflow-y:auto;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding-right:10px;
}
.question.question-very-long{
  font-size:clamp(1.05rem,1.55vw,1.4rem)!important;
  max-height:34vh;
}
@media(max-width:759px){
  .question.question-long,.question.question-very-long{
    font-size:clamp(1.05rem,5vw,1.3rem)!important;
    max-height:42vh;
  }
}
.capture-dock.is-recording #captureModeLabel{min-width:5.2rem;text-align:center}
'''
style_path.write_text(styles, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = once(sw, "const VERSION = 'offline-interview-v28';", "const VERSION = 'offline-interview-v29';", 'sw version')
sw = once(sw, "'./', './index.html', './styles.css', './app.js?v=28', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=29', './system-stt.js',", 'sw app cache')
sw_path.write_text(sw, encoding='utf-8')

print('V29 hard STT handoff + long-question UX patch applied')

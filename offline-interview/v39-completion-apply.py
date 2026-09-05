from pathlib import Path

root = Path(__file__).resolve().parent

# app.js — make completion a stateful workflow that survives active-capture finalization.
app = root / 'app.js'
s = app.read_text(encoding='utf-8')
old = "const BUILD_ID = '2026-09-04.interview-runtime-v38';"
new = "const BUILD_ID = '2026-09-05.interview-runtime-v39';"
if old not in s:
    raise SystemExit('V38 BUILD_ID anchor not found')
s = s.replace(old, new, 1)

old = "let lastDeletedTurn = null;"
new = "let lastDeletedTurn = null;\nlet completionInProgress = false;\nlet pendingInterviewCompletion = false;"
if old not in s:
    raise SystemExit('completion globals anchor not found')
s = s.replace(old, new, 1)

start = s.find('async function completeInterview() {')
if start < 0:
    raise SystemExit('completeInterview start not found')
end = s.find('\n}\n', start)
if end < 0:
    raise SystemExit('completeInterview end not found')
end += 3
replacement = r'''function setCompletionBusy(busy) {
  for (const button of [ui.mobileFinishBtn, ui.sidebarFinishBtn]) {
    if (button) button.disabled = busy;
  }
  if (ui.mobileFinishBtn) ui.mobileFinishBtn.textContent = busy ? 'Finalisation…' : 'Terminer';
  if (ui.sidebarFinishBtn) ui.sidebarFinishBtn.textContent = busy ? 'Finalisation…' : 'Terminer l’entretien';
}

function resetCompletionState() {
  pendingInterviewCompletion = false;
  completionInProgress = false;
  setCompletionBusy(false);
}

async function finalizeInterviewCompletion() {
  if (!session) {
    resetCompletionState();
    return false;
  }
  try {
    await semanticBoundaryCommitQueue;
    const gaps = unresolvedCaptureGaps();
    if (gaps.length && !confirm(`${gaps.length} passage${gaps.length > 1 ? 's' : ''} reste${gaps.length > 1 ? 'nt' : ''} à reprendre après un échec de transcription. Terminer quand même ?`)) {
      logRuntimeEvent('completion_cancelled', { stage: 'capture_gaps', gapCount: gaps.length });
      return false;
    }
    flushSessionClock();
    await addComposerTurn();
    session.completed = true;
    session.completedAt = nowIso();
    session.updatedAt = nowIso();
    logRuntimeEvent('completion_succeeded', { viewportWidth: Math.round(window.innerWidth || 0) });
    await persistSession();
    finishInterview();
    return true;
  } catch (error) {
    diagnosticError = String(error?.message || error);
    logRuntimeEvent('completion_error', { stage: 'finalize', error: diagnosticError });
    showError(ui.interviewError, `Impossible de terminer l’entretien : ${diagnosticError}. Réessayez sans quitter la page.`);
    return false;
  } finally {
    resetCompletionState();
  }
}

async function completeInterview(event) {
  if (!session || completionInProgress) return;
  completionInProgress = true;
  setCompletionBusy(true);
  showError(ui.interviewError, '');
  const source = event?.currentTarget?.id || 'programmatic';
  logRuntimeEvent('completion_requested', {
    source,
    recording: isRecording(),
    captureFinalizing: Boolean(captureFinalizing),
    viewportWidth: Math.round(window.innerWidth || 0)
  });

  if (isRecording()) {
    if (!confirm('Un enregistrement est en cours. L’arrêter, conserver sa transcription puis terminer l’entretien ?')) {
      logRuntimeEvent('completion_cancelled', { stage: 'active_capture', source });
      resetCompletionState();
      return;
    }
    pendingInterviewCompletion = true;
    queuedSpeakerId = null;
    queuedRecordingQuestionId = null;
    ui.recordState.textContent = 'Finalisation de l’entretien…';
    updateCaptureUi();
    stopRecording();
    return;
  }

  if (captureFinalizing || recordingCompletionPromise) {
    pendingInterviewCompletion = true;
    try {
      if (recordingCompletionPromise) await recordingCompletionPromise;
    } catch (error) {
      diagnosticError = String(error?.message || error);
      logRuntimeEvent('completion_error', { stage: 'capture_wait', error: diagnosticError });
      showError(ui.interviewError, `Impossible de finaliser la prise de parole : ${diagnosticError}. Réessayez.`);
      resetCompletionState();
      return;
    }
  }

  await finalizeInterviewCompletion();
}
'''
s = s[:start] + replacement + s[end:]

old = "    renderSpeakerButtons();\n    renderQuestionNav();\n\n    if (nextSpeakerId && participantById(nextSpeakerId)) {"
new = "    renderSpeakerButtons();\n    renderQuestionNav();\n\n    if (pendingInterviewCompletion && !nextSpeakerId) {\n      queueMicrotask(() => { finalizeInterviewCompletion().catch(() => {}); });\n    }\n\n    if (nextSpeakerId && participantById(nextSpeakerId)) {"
if old not in s:
    raise SystemExit('recording-finalization continuation anchor not found')
s = s.replace(old, new, 1)
app.write_text(s, encoding='utf-8')

# styles.css — sidebar disappears at 979px, so the top completion control must take over at the same breakpoint.
styles = root / 'styles.css'
s = styles.read_text(encoding='utf-8')
old = "@media(max-width:759px){.mobile-finish-button{display:inline-flex;align-items:center;justify-content:center;padding:7px 10px;white-space:nowrap;border-color:#a9b8cc;background:#fff;color:#172554}.mobile-finish-button:focus-visible{outline:3px solid rgba(37,99,235,.24);outline-offset:2px}}"
new = "@media(max-width:979px){.mobile-finish-button{display:inline-flex;align-items:center;justify-content:center;padding:7px 10px;white-space:nowrap;border-color:#a9b8cc;background:#fff;color:#172554}.mobile-finish-button:focus-visible{outline:3px solid rgba(37,99,235,.24);outline-offset:2px}}"
if old not in s:
    raise SystemExit('V37 mobile finish breakpoint anchor not found')
s = s.replace(old, new, 1)
styles.write_text(s, encoding='utf-8')

# index.html — cache-bust the runtime assets.
index = root / 'index.html'
s = index.read_text(encoding='utf-8')
if './styles.css?v=38' not in s or './app.js?v=38' not in s:
    raise SystemExit('V38 index cache anchors not found')
s = s.replace('./styles.css?v=38', './styles.css?v=39')
s = s.replace('./app.js?v=38', './app.js?v=39')
index.write_text(s, encoding='utf-8')

# service worker — move the offline shell atomically to V39.
sw = root / 'sw.js'
s = sw.read_text(encoding='utf-8')
if "const VERSION = 'offline-interview-v38';" not in s:
    raise SystemExit('V38 service-worker version anchor not found')
s = s.replace("const VERSION = 'offline-interview-v38';", "const VERSION = 'offline-interview-v39';", 1)
s = s.replace("'./styles.css?v=38', './app.js?v=38'", "'./styles.css?v=39', './app.js?v=39'", 1)
sw.write_text(s, encoding='utf-8')

# Focused field questionnaire for the exact two width classes that failed in V38.
field = root / 'test-interviews' / 'interview-test-ux-v39.json'
field.write_text(r'''{
  "schema": "offline-interview.interview-spec.v1",
  "id": "test-ux-v39-completion-state",
  "version": "1.0",
  "title": "Test UX V39 — Terminer réellement à toutes les largeurs",
  "context": "Le test V38 a prouvé deux défauts distincts : un intervalle de largeur où aucun bouton Terminer n'était disponible, et des clics sur le bouton Terminer de la barre haute qui pouvaient finaliser la prise de parole sans ouvrir l'écran de résultat.",
  "objective": "Vérifier que Terminer est toujours accessible quand la barre latérale disparaît et que le même clic conduit réellement à Entretien terminé puis à l'export, y compris pendant une prise de parole active.",
  "language": "fr-FR",
  "tags": ["ux", "v39", "responsive", "completion", "active-capture", "export"],
  "estimatedDurationMinutes": 3,
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Testeur", "role": "interviewee"}
  ],
  "sections": [{
    "id": "S1",
    "title": "Fin réelle",
    "questions": [{
      "id": "Q1",
      "label": "Terminer en intermédiaire puis étroit",
      "text": "Vérifiez que Runtime affiche 2026-09-05.interview-runtime-v39. Placez d'abord la fenêtre vers 850 px de large : la barre latérale doit être absente mais Terminer doit rester visible en haut. Lancez une prise de parole, puis cliquez sur Terminer pendant que ON AIR est encore affiché et acceptez la confirmation. Sans redimensionner, vous devez arriver sur « Entretien terminé » et pouvoir atteindre « Exporter pour une IA ». Cliquez ensuite sur « Relire / corriger », réduisez la fenêtre vers 480 px, recommencez une courte prise de parole et cliquez à nouveau sur Terminer pendant ON AIR. Le même écran de résultat et l'export doivent être accessibles. Si une erreur de finalisation apparaît, lisez-la à voix haute.",
      "intent": "Réattaquer exactement le trou 760–979 px et le défaut de continuation Terminer pendant une capture active observés en V38.",
      "estimatedMinutes": 3,
      "required": true,
      "audience": ["P2"],
      "followUps": []
    }]
  }]
}
''', encoding='utf-8')

# Static regression guard. It is intentionally narrow: exact breakpoint handoff + completion-state contract.
test = root / 'test-completion-path-v39.mjs'
test.write_text(r'''import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const spec = JSON.parse(fs.readFileSync(new URL('./test-interviews/interview-test-ux-v39.json', import.meta.url), 'utf8'));

assert.match(app, /interview-runtime-v39/);
assert.match(app, /let completionInProgress = false;/);
assert.match(app, /let pendingInterviewCompletion = false;/);
assert.match(app, /completion_requested/);
assert.match(app, /completion_succeeded/);
assert.match(app, /completion_error/);
assert.match(app, /pendingInterviewCompletion && !nextSpeakerId/);
assert.match(app, /ui\.mobileFinishBtn\?\.addEventListener\('click', completeInterview\)/);
assert.match(app, /ui\.sidebarFinishBtn\?\.addEventListener\('click', completeInterview\)/);
assert.match(css, /@media\(max-width:979px\)\{\.mobile-finish-button\{display:inline-flex/);
assert.doesNotMatch(css, /@media\(max-width:759px\)\{\.mobile-finish-button\{display:inline-flex/);
assert.match(index, /id="doneView"/);
assert.match(index, /id="exportJsonBtn"/);
assert.equal(spec.id, 'test-ux-v39-completion-state');
console.log('PASS V39 completion path contract');
''', encoding='utf-8')

# CI must carry the exact regression guard, not rely only on field memory.
pages = root.parent / '.github' / 'workflows' / 'pages.yml'
s = pages.read_text(encoding='utf-8')
anchor = "      - name: Hard STT handoff regression\n        run: node --experimental-default-type=module offline-interview/test-system-stt-hard-cut.mjs\n"
insert = anchor + "      - name: Completion path regression\n        run: node offline-interview/test-completion-path-v39.mjs\n"
if anchor not in s:
    raise SystemExit('pages workflow regression anchor not found')
s = s.replace(anchor, insert, 1)
pages.write_text(s, encoding='utf-8')

checks = {
    'runtime v39': "interview-runtime-v39" in app.read_text(encoding='utf-8'),
    'completion pending state': 'pendingInterviewCompletion = true' in app.read_text(encoding='utf-8'),
    'capture continuation': 'pendingInterviewCompletion && !nextSpeakerId' in app.read_text(encoding='utf-8'),
    'completion error visibility': 'completion_error' in app.read_text(encoding='utf-8'),
    'breakpoint aligned': '@media(max-width:979px){.mobile-finish-button{display:inline-flex' in styles.read_text(encoding='utf-8'),
    'cache v39': "offline-interview-v39" in sw.read_text(encoding='utf-8'),
    'field spec': field.exists(),
    'CI regression': 'Completion path regression' in pages.read_text(encoding='utf-8'),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('V39 invariant failure: ' + ', '.join(failed))
print('V39 completion patch applied:', ', '.join(checks))

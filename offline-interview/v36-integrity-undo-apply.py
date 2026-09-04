from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
styles_path = root / 'offline-interview' / 'styles.css'
index_path = root / 'offline-interview' / 'index.html'
sw_path = root / 'offline-interview' / 'sw.js'
test_path = root / 'offline-interview' / 'test-interviews' / 'interview-test-ux-v36.json'

app = app_path.read_text(encoding='utf-8')
styles = styles_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')
sw = sw_path.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch anchor: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'non-unique patch anchor: {label} count={text.count(old)}')
    return text.replace(old, new, 1)

app = replace_once(app,
    "const BUILD_ID = '2026-09-04.interview-runtime-v35';",
    "const BUILD_ID = '2026-09-04.interview-runtime-v36';",
    'build id')

app = replace_once(app,
    "captureDock: $('captureDock'), captureModeLabel: $('captureModeLabel'), recordState: $('recordState'), timer: $('timer'), liveTranscriptPreview: $('liveTranscriptPreview'), transcribing: $('transcribing'), captureQuestionContext: $('captureQuestionContext'), captureQuestionStatus: $('captureQuestionStatus'), captureQuestionLabel: $('captureQuestionLabel'), moveCaptureBtn: $('moveCaptureBtn'),",
    "captureDock: $('captureDock'), captureModeLabel: $('captureModeLabel'), recordState: $('recordState'), timer: $('timer'), liveTranscriptPreview: $('liveTranscriptPreview'), transcribing: $('transcribing'), captureQuestionContext: $('captureQuestionContext'), captureQuestionStatus: $('captureQuestionStatus'), captureQuestionLabel: $('captureQuestionLabel'), moveCaptureBtn: $('moveCaptureBtn'), captureIntegrityAlert: $('captureIntegrityAlert'),",
    'capture alert ui')

app = replace_once(app,
    "let recordingHadCuts = false;",
    "let recordingHadCuts = false;\nlet lastDeletedTurn = null;",
    'undo state')

app = replace_once(app,
    "    responses: {},\n    runtimeEvents: []",
    "    responses: {},\n    runtimeEvents: [],\n    captureGaps: []",
    'session capture gaps')

anchor = """function logRuntimeEvent(type, details = {}) {
  if (!session) return;
  if (!Array.isArray(session.runtimeEvents)) session.runtimeEvents = [];
  const event = { at: nowIso(), type: cleanText(type) || 'runtime_event' };
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) event[key] = value;
  }
  session.runtimeEvents.push(event);
  if (session.runtimeEvents.length > 100) session.runtimeEvents = session.runtimeEvents.slice(-100);
  session.updatedAt = nowIso();
  persistSession().catch(() => {});
}
"""
replacement = anchor + """
function unresolvedCaptureGaps() {
  if (!Array.isArray(session?.captureGaps)) return [];
  return session.captureGaps.filter(gap => !gap.resolvedAt);
}

function registerCaptureGap(questionId, speakerId, error) {
  if (!session || !questionId || !speakerId) return;
  if (!Array.isArray(session.captureGaps)) session.captureGaps = [];
  const duplicate = session.captureGaps.find(gap => !gap.resolvedAt && gap.questionId === questionId && gap.speakerId === speakerId);
  if (!duplicate) {
    session.captureGaps.push({
      id: uuid('gap'),
      questionId,
      speakerId,
      createdAt: nowIso(),
      resolvedAt: null,
      error: cleanText(error)
    });
  }
  logRuntimeEvent('transcription_gap', {
    questionId,
    speakerId,
    stage: 'system-empty-after-handoff',
    error: cleanText(error)
  });
  renderCaptureIntegrityAlert();
  renderQuestionNav();
}

function resolveCaptureGap(questionId, speakerId) {
  if (!session || !questionId || !speakerId || !Array.isArray(session.captureGaps)) return false;
  let resolved = false;
  const resolvedAt = nowIso();
  for (const gap of session.captureGaps) {
    if (!gap.resolvedAt && gap.questionId === questionId && gap.speakerId === speakerId) {
      gap.resolvedAt = resolvedAt;
      resolved = true;
    }
  }
  if (resolved) {
    logRuntimeEvent('transcription_gap_resolved', { questionId, speakerId });
    renderCaptureIntegrityAlert();
    renderQuestionNav();
  }
  return resolved;
}

function renderCaptureIntegrityAlert() {
  if (!ui.captureIntegrityAlert) return;
  const gaps = unresolvedCaptureGaps();
  const gap = gaps[gaps.length - 1];
  if (!gap) {
    ui.captureIntegrityAlert.textContent = '';
    show(ui.captureIntegrityAlert, false);
    return;
  }
  const speaker = participantById(gap.speakerId) || session?.participantHistory?.[gap.speakerId];
  const question = flattenedQuestions().find(entry => entry.question.id === gap.questionId)?.question;
  const who = speaker?.name || gap.speakerId || 'ce locuteur';
  const where = question?.label ? ` sur « ${question.label} »` : '';
  ui.captureIntegrityAlert.textContent = `⚠ Propos non transcrit pour ${who}${where}. Répétez ce passage : l’alerte restera affichée jusqu’à sa récupération.`;
  show(ui.captureIntegrityAlert, true);
}
"""
app = replace_once(app, anchor, replacement, 'capture integrity helpers')

app = replace_once(app,
    "      const answered = questionHasAnswer(question.id);\n      const current = index === session.currentIndex;",
    "      const answered = questionHasAnswer(question.id);\n      const hasGap = unresolvedCaptureGaps().some(gap => gap.questionId === question.id);\n      const current = index === session.currentIndex;",
    'nav gap state')
app = replace_once(app,
    "      row.className = 'question-nav-item' + (answered ? ' answered' : '') + (current ? ' current' : '') + (recordingTarget ? ' on-air' : '') + (finalizingTarget ? ' finalizing' : '');",
    "      row.className = 'question-nav-item' + (answered ? ' answered' : '') + (hasGap ? ' integrity-gap' : '') + (current ? ' current' : '') + (recordingTarget ? ' on-air' : '') + (finalizingTarget ? ' finalizing' : '');",
    'nav gap class')
app = replace_once(app,
    "      state.textContent = recordingTarget ? '🎙' : finalizingTarget ? '…' : current ? '›' : answered ? '✓' : '';",
    "      state.textContent = recordingTarget ? '🎙' : hasGap ? '⚠' : finalizingTarget ? '…' : current ? '›' : answered ? '✓' : '';",
    'nav gap icon')
app = replace_once(app,
    "      duration.textContent = recordingTarget ? 'ON AIR' : finalizingTarget ? 'TRAITEMENT' : (spent >= 30 ? elapsedMinutesLabel(spent) : '~' + estimatedQuestionMinutes(question) + ' min');",
    "      duration.textContent = recordingTarget ? 'ON AIR' : hasGap ? 'À REPRENDRE' : finalizingTarget ? 'TRAITEMENT' : (spent >= 30 ? elapsedMinutesLabel(spent) : '~' + estimatedQuestionMinutes(question) + ' min');",
    'nav gap duration')

app = replace_once(app,
    "      const answered = questionHasAnswer(entry.question.id);\n      const recordingTarget = Boolean(isRecording() && recordingQuestionId === entry.question.id);",
    "      const answered = questionHasAnswer(entry.question.id);\n      const hasGap = unresolvedCaptureGaps().some(gap => gap.questionId === entry.question.id);\n      const recordingTarget = Boolean(isRecording() && recordingQuestionId === entry.question.id);",
    'mobile gap state')
app = replace_once(app,
    "      const stateSuffix = recordingTarget ? ' · ON AIR' : finalizingTarget ? ' · TRAITEMENT' : answered ? ' ✓' : '';",
    "      const stateSuffix = recordingTarget ? ' · ON AIR' : hasGap ? ' · ⚠ À reprendre' : finalizingTarget ? ' · TRAITEMENT' : answered ? ' ✓' : '';",
    'mobile gap suffix')

app = replace_once(app,
    "  renderCaptureQuestionContext();\n}",
    "  renderCaptureQuestionContext();\n  renderCaptureIntegrityAlert();\n}",
    'capture alert render')

app = replace_once(app,
    "  renderCaptureQuestionContext();\n}\n\nfunction createTurn",
    "  renderCaptureQuestionContext();\n  renderCaptureIntegrityAlert();\n}\n\nfunction createTurn",
    'question alert render')

app = replace_once(app,
    "        await persistSession();\n        renderTurns();\n      }\n      return false;",
    "        resolveCaptureGap(questionId, speakerId);\n        await persistSession();\n        renderTurns();\n      }\n      return false;",
    'resolve gap duplicate path')
app = replace_once(app,
    "  response.turns.push(createTurn({\n    type: 'answer',\n    speakerId,\n    text: clean,\n    source,\n    rawTranscript,\n    durationSeconds\n  }));\n  response.status = 'answered';",
    "  response.turns.push(createTurn({\n    type: 'answer',\n    speakerId,\n    text: clean,\n    source,\n    rawTranscript,\n    durationSeconds\n  }));\n  resolveCaptureGap(questionId, speakerId);\n  response.status = 'answered';",
    'resolve gap new answer')

app = replace_once(app,
    "  const turns = response.turns || [];\n  ui.turnsList.innerHTML = '';\n  show(ui.turnsSection, turns.length > 0);",
    "  const turns = response.turns || [];\n  ui.turnsList.innerHTML = '';\n  const questionFrame = ui.questionText?.closest('.question-sticky');\n  if (questionFrame) {\n    questionFrame.classList.toggle('question-space-empty', turns.length === 0);\n    questionFrame.classList.toggle('question-space-few', turns.length > 0 && turns.length < 3);\n    questionFrame.classList.toggle('question-space-busy', turns.length >= 3);\n  }\n  const canUndo = Boolean(lastDeletedTurn && lastDeletedTurn.questionId === entry.question.id);\n  show(ui.turnsSection, turns.length > 0 || canUndo);\n  if (canUndo) {\n    const undoRow = document.createElement('div');\n    undoRow.className = 'undo-turn-row';\n    const label = document.createElement('span');\n    label.textContent = 'Prise de parole supprimée';\n    const undoButton = document.createElement('button');\n    undoButton.type = 'button';\n    undoButton.className = 'ghost small';\n    undoButton.textContent = 'Annuler';\n    undoButton.addEventListener('click', async () => {\n      const deleted = lastDeletedTurn;\n      if (!deleted || deleted.questionId !== entry.question.id) return;\n      const target = responseFor(deleted.questionId);\n      target.turns.splice(Math.min(deleted.index, target.turns.length), 0, clone(deleted.turn));\n      target.status = target.turns.some(t => t.type === 'answer' && cleanText(t.text)) ? 'answered' : 'draft';\n      lastDeletedTurn = null;\n      session.updatedAt = nowIso();\n      await persistSession();\n      renderTurns();\n      renderFollowUps();\n      renderQuestionNav();\n      renderInterviewMetrics();\n    });\n    undoRow.append(label, undoButton);\n    ui.turnsList.append(undoRow);\n  }",
    'adaptive question and undo row')

app = replace_once(app,
    "    remove.className = 'ghost small icon-button';\n    remove.textContent = '×';",
    "    remove.className = 'ghost small icon-button turn-delete-button';\n    remove.textContent = '×';",
    'delete button class')
app = replace_once(app,
    "    remove.addEventListener('click', async () => {\n      response.turns = response.turns.filter(t => t.id !== turn.id);",
    "    remove.addEventListener('click', async () => {\n      const deletedIndex = response.turns.findIndex(t => t.id === turn.id);\n      if (deletedIndex < 0) return;\n      lastDeletedTurn = { questionId: entry.question.id, turn: clone(turn), index: deletedIndex };\n      response.turns.splice(deletedIndex, 1);",
    'undoable delete')

app = replace_once(app,
    "        logRuntimeEvent('transcription_gap', {\n          questionId, speakerId, stage: 'system-empty-after-handoff',\n          error: message\n        });\n        throw new Error(message);",
    "        registerCaptureGap(questionId, speakerId, message);\n        throw new Error(message);",
    'register persistent gap')

app = replace_once(app,
    "  const ok = await finishActiveCaptureBeforeLeaving('Un enregistrement est en cours. L’arrêter, conserver sa transcription puis terminer l’entretien ?');\n  if (!ok) return;\n  flushSessionClock();",
    "  const ok = await finishActiveCaptureBeforeLeaving('Un enregistrement est en cours. L’arrêter, conserver sa transcription puis terminer l’entretien ?');\n  if (!ok) return;\n  const gaps = unresolvedCaptureGaps();\n  if (gaps.length && !confirm(`${gaps.length} passage${gaps.length > 1 ? 's' : ''} reste${gaps.length > 1 ? 'nt' : ''} à reprendre après un échec de transcription. Terminer quand même ?`)) return;\n  flushSessionClock();",
    'completion integrity gate')

app = replace_once(app,
    "      runtimeEvents: clone(session.runtimeEvents || [])\n    },",
    "      runtimeEvents: clone(session.runtimeEvents || []),\n      captureGaps: clone(session.captureGaps || [])\n    },",
    'export gaps')

app = replace_once(app,
    "  if (!session.responses || typeof session.responses !== 'object') session.responses = {};\n  if (!session.questionSeconds || typeof session.questionSeconds !== 'object') session.questionSeconds = {};",
    "  if (!session.responses || typeof session.responses !== 'object') session.responses = {};\n  if (!Array.isArray(session.runtimeEvents)) session.runtimeEvents = [];\n  if (!Array.isArray(session.captureGaps)) session.captureGaps = [];\n  if (!session.questionSeconds || typeof session.questionSeconds !== 'object') session.questionSeconds = {};",
    'resume gaps')

app = app.replace("navigator.serviceWorker.register('./sw.js?v=32'", "navigator.serviceWorker.register('./sw.js?v=36'")
app = app.replace("reg.active ? 'actif · v32' : 'installé · v32'", "reg.active ? 'actif · v36' : 'installé · v36'")
app_path.write_text(app, encoding='utf-8')

styles += r'''

/* V36 — data-integrity affordances and safer compact editing. */
.capture-integrity-alert{
  margin:0 0 8px;
  padding:8px 10px;
  border:1px solid #f59e0b;
  border-radius:10px;
  background:#fffbeb;
  color:#7c2d12;
  font-size:.82rem;
  font-weight:800;
  line-height:1.35;
}
.question-nav-item.integrity-gap{background:#fff7ed!important;color:#9a3412!important}
.question-nav-item.integrity-gap .question-nav-state{color:#c2410c!important}
.undo-turn-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  padding:7px 9px;
  border:1px solid #bfdbfe;
  border-radius:9px;
  background:#eff6ff;
  color:#334155;
  font-size:.82rem;
  font-weight:750;
}
.turn-delete-button{
  margin-left:10px!important;
  min-width:42px!important;
  color:#991b1b!important;
  border-color:#fecaca!important;
  background:#fff7f7!important;
}

@media(max-width:640px){
  .turn-head{column-gap:14px!important}
  .turn-delete-button{min-width:44px!important;margin-left:8px!important}
  /* Empty questions can use the available screen; conversation progressively takes it back. */
  .question-sticky.question-space-empty{max-height:min(56dvh,440px)!important}
  .question-sticky.question-space-few{max-height:min(44dvh,340px)!important}
  .question-sticky.question-space-busy{max-height:min(35dvh,275px)!important}
  .question-sticky.question-space-empty .question-long,
  .question-sticky.question-space-empty .question-very-long{max-height:min(38dvh,300px)!important}
  .question-sticky.question-space-few .question-long,
  .question-sticky.question-space-few .question-very-long{max-height:min(25dvh,200px)!important}
  .question-sticky.question-space-busy .question-long,
  .question-sticky.question-space-busy .question-very-long{max-height:min(16dvh,138px)!important}
}
'''
styles_path.write_text(styles, encoding='utf-8')

index = replace_once(index, './styles.css?v=35', './styles.css?v=36', 'css cache id')
index = replace_once(index, './app.js?v=35', './app.js?v=36', 'js cache id')
index = replace_once(index,
    "          <div class=\"live-transcript-slot\">",
    "          <div id=\"captureIntegrityAlert\" class=\"capture-integrity-alert hidden\" role=\"alert\"></div>\n\n          <div class=\"live-transcript-slot\">",
    'integrity alert markup')
index_path.write_text(index, encoding='utf-8')

sw = replace_once(sw, "const VERSION = 'offline-interview-v35';", "const VERSION = 'offline-interview-v36';", 'sw version')
sw = sw.replace('./styles.css?v=35', './styles.css?v=36').replace('./app.js?v=35', './app.js?v=36')
sw_path.write_text(sw, encoding='utf-8')

spec = {
  "schema": "offline-interview.interview-spec.v1",
  "id": "test-ux-v36-integrity-undo",
  "version": "1.0",
  "title": "Test UX V36 — intégrité, annulation et espace adaptatif",
  "context": "V35 valide ON AIR continu, la densité des réponses et la petite fenêtre. Deux points matériels restent : la suppression d'une prise est trop proche du chevron de locuteur en petite largeur, et la télémétrie V35 a détecté un passage non transcrit alors que le verdict humain final n'avait pas remarqué l'erreur. Une amélioration souhaitée consiste aussi à donner plus d'espace à une question longue tant qu'aucune réponse n'existe, puis à réduire progressivement cet espace.",
  "objective": "Vérifier une édition plus sûre avec annulation, une alerte d'intégrité impossible à ignorer si une transcription se perd, et une répartition verticale qui s'adapte au nombre de réponses sans réouvrir les décisions V35 déjà acquises.",
  "language": "fr-FR",
  "tags": ["ux", "v36", "integrity", "undo", "responsive", "stt-gap"],
  "estimatedDurationMinutes": 5,
  "participants": [
    {"id":"P1","name":"Interviewer","role":"interviewer"},
    {"id":"P2","name":"Testeur","role":"interviewee"},
    {"id":"P3","name":"Second participant","role":"interviewee"}
  ],
  "sections": [
    {"id":"S1","title":"Édition sûre","questions":[
      {"id":"Q1","label":"Supprimer puis annuler","text":"En fenêtre très étroite, créez trois réponses très courtes. Sur l'une d'elles, utilisez le menu de locuteur puis supprimez volontairement cette même réponse. Vérifiez deux choses : le bouton de suppression est assez séparé du chevron pour réduire le risque de mauvais clic, et une barre « Prise de parole supprimée — Annuler » apparaît. Cliquez sur Annuler et vérifiez que la réponse revient à sa place. Dites si cette interaction vous paraît maintenant sûre.","intent":"Éliminer le risque de perte irréversible signalé en V35.","estimatedMinutes":1,"required":True,"audience":["P2"],"followUps":[]}
    ]},
    {"id":"S2","title":"Espace adaptatif","questions":[
      {"id":"Q2","label":"Question qui cède la place","text":"Gardez la fenêtre très étroite. Cette question est volontairement longue : avant toute réponse, elle doit pouvoir utiliser une grande partie de l'espace disponible afin d'être facile à lire. Ajoutez ensuite une première petite réponse, puis une deuxième, puis plusieurs réponses courtes. À mesure que la conversation se remplit, la zone de question doit céder progressivement de la hauteur à la conversation tout en restant défilable et sans faire disparaître les boutons de personne en bas. Dites si ce comportement correspond à ce que vous aviez demandé.","intent":"Valider l'allocation verticale adaptative suggérée après V35.","estimatedMinutes":2,"required":True,"audience":["P2"],"followUps":[]}
    ]},
    {"id":"S3","title":"Intégrité transcription","questions":[
      {"id":"Q3","label":"Handoffs rapides","text":"Faites dix changements rapides entre Testeur et Second participant avec des phrases très courtes. Si tout est transcrit, dites simplement qu'aucune alerte d'intégrité n'est apparue. Si une transcription se perd, une alerte jaune doit rester visible dans la zone de capture et la question doit être marquée « À reprendre » dans la navigation. Répétez alors le passage pour la même personne et vérifiez que l'alerte disparaît seulement après récupération.","intent":"Vérifier que la perte de transcription ne peut plus être silencieuse.","estimatedMinutes":1,"required":True,"audience":["P2","P3"],"followUps":[]},
      {"id":"Q4","label":"Verdict V36","text":"Donnez un verdict bref : 1) suppression/annulation sûre ? 2) espace de question adaptatif satisfaisant ? 3) changement de personne toujours fluide ? 4) avez-vous vu une alerte d'intégrité ou un message de transcription ? Ne réouvrez pas l'ordre des réponses, ON AIR ou la densité générale sauf régression nette.","intent":"Décider si les derniers défauts matériels sont fermés.","estimatedMinutes":1,"required":True,"audience":["P2"],"followUps":[]}
    ]}
  ]
}
test_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('V36 patch applied')

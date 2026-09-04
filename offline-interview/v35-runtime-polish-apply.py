from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
styles_path = root / 'offline-interview' / 'styles.css'
index_path = root / 'offline-interview' / 'index.html'
sw_path = root / 'offline-interview' / 'sw.js'
test_path = root / 'offline-interview' / 'test-interviews' / 'interview-test-ux-v35.json'

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
    "const BUILD_ID = '2026-09-04.interview-runtime-v34';",
    "const BUILD_ID = '2026-09-04.interview-runtime-v35';",
    'build id')

app = replace_once(app,
    "let latestHandoffCalibration = null;",
    "let latestHandoffCalibration = null;\nlet recordingHadCuts = false;",
    'recording cut state')

app = replace_once(app,
    "    participantHistory: Object.fromEntries(interview.participants.map(p => [p.id, { ...clone(p), removedAt: null }])),\n    responses: {}\n  };\n}",
    "    participantHistory: Object.fromEntries(interview.participants.map(p => [p.id, { ...clone(p), removedAt: null }])),\n    responses: {},\n    runtimeEvents: []\n  };\n}\n\nfunction logRuntimeEvent(type, details = {}) {\n  if (!session) return;\n  if (!Array.isArray(session.runtimeEvents)) session.runtimeEvents = [];\n  const event = { at: nowIso(), type: cleanText(type) || 'runtime_event' };\n  for (const [key, value] of Object.entries(details || {})) {\n    if (value == null) continue;\n    if (['string', 'number', 'boolean'].includes(typeof value)) event[key] = value;\n  }\n  session.runtimeEvents.push(event);\n  if (session.runtimeEvents.length > 100) session.runtimeEvents = session.runtimeEvents.slice(-100);\n  session.updatedAt = nowIso();\n  persistSession().catch(() => {});\n}",
    'runtime event log')

app = replace_once(app,
    "  const cut = systemSpeechSession.cutSegment();\n  if (!cut) return false;",
    "  const cut = systemSpeechSession.cutSegment();\n  if (!cut) return false;\n  recordingHadCuts = true;",
    'mark semantic cuts')

app = replace_once(app,
    "  show(ui.topOnAir, recording && !captureHandoffPending);",
    "  // Audio capture remains live during the short SpeechRecognition handoff.\n  // Keep the global ON AIR indicator continuous instead of blinking.\n  show(ui.topOnAir, recording);",
    'top on air continuity')

old_update = """  if (recording && captureHandoffPending) {\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'PASSAGE';\n    ui.recordState.textContent = active ? `${active.name} · préparation…` : 'Passage de parole…';\n  } else if (recording) {\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'ON AIR';\n    ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';\n  } else if (captureFinalizing) {"""
new_update = """  if (recording) {\n    // The active red speaker button already identifies the person. Keep capture chrome stable\n    // across the sub-second recognition handoff: no PASSAGE flash and no duplicated name.\n    if (ui.captureModeLabel) ui.captureModeLabel.textContent = 'ON AIR';\n    ui.recordState.textContent = '';\n  } else if (captureFinalizing) {"""
app = replace_once(app, old_update, new_update, 'capture stable ui')

app = replace_once(app,
    "    systemSpeechSession = createSystemSpeechSession({\n      lang: interview?.language || 'fr-FR',\n      mode: systemSpeechCapability.mode,\n      onText: applySystemText,\n      onState: () => {\n        const active = participantById(recordingSpeakerId);\n        ui.recordState.textContent = active ? `${active.name} · en cours` : 'Enregistrement en cours';\n      },\n      onError: error => { diagnosticError = `SpeechRecognition: ${error}`; }\n    });",
    "    systemSpeechSession = createSystemSpeechSession({\n      lang: interview?.language || 'fr-FR',\n      mode: systemSpeechCapability.mode,\n      onText: applySystemText,\n      onState: () => {},\n      onError: error => {\n        diagnosticError = `SpeechRecognition: ${error}`;\n        logRuntimeEvent('speech_recognition_error', {\n          questionId: recordingQuestionId,\n          speakerId: recordingSpeakerId,\n          error: String(error)\n        });\n      }\n    });",
    'speech error telemetry')

app = replace_once(app,
    "    startedRecordingAt = performance.now();",
    "    recordingHadCuts = false;\n    startedRecordingAt = performance.now();",
    'reset cut state')

app = replace_once(app,
    "    if (!usingSystem) ui.recordState.textContent = `Enregistrement · ${participantById(recordingSpeakerId)?.name || 'locuteur'}`;",
    "    if (!usingSystem) ui.recordState.textContent = 'Transcription système indisponible';",
    'no duplicate speaker state')

app = replace_once(app,
    "    if (!text) {\n      show(ui.transcribing, true);\n      ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'\n        ? 'Transcription Whisper locale…'\n        : 'Aucun texte système · secours Whisper…';\n      if (!transcriber) await prepareModel();\n      const samples = await blobTo16kMono(blob);",
    "    if (!text) {\n      show(ui.transcribing, true);\n      if (recordingHadCuts) {\n        const message = 'Aucun texte système pour cette prise après un changement de personne. Répétez ce passage.';\n        logRuntimeEvent('transcription_gap', {\n          questionId, speakerId, stage: 'system-empty-after-handoff',\n          error: message\n        });\n        throw new Error(message);\n      }\n      ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'\n        ? 'Transcription Whisper locale…'\n        : 'Aucun texte système · secours Whisper…';\n      if (!transcriber) await prepareModel();\n      const samples = await blobTo16kMono(blob);",
    'safe fallback after handoff')

app = replace_once(app,
    "  } catch (error) {\n    diagnosticError = String(error?.message || error);\n    showError(ui.interviewError, `La transcription a échoué : ${error.message || error}`);\n    ui.recordState.textContent = 'Transcription en échec';\n  } finally {",
    "  } catch (error) {\n    diagnosticError = String(error?.message || error);\n    logRuntimeEvent('transcription_error', {\n      questionId, speakerId, stage: recordingHadCuts ? 'after-handoff' : 'finalize',\n      error: diagnosticError\n    });\n    showError(ui.interviewError, `La transcription a échoué : ${error.message || error}`);\n    ui.recordState.textContent = 'Transcription en échec';\n  } finally {",
    'transcription error telemetry')

app = replace_once(app,
    "      completion: {\n        answeredQuestions,\n        totalQuestions,\n        unansweredQuestions: totalQuestions - answeredQuestions,\n        followUpsUsed\n      }\n    },",
    "      completion: {\n        answeredQuestions,\n        totalQuestions,\n        unansweredQuestions: totalQuestions - answeredQuestions,\n        followUpsUsed\n      },\n      runtimeEvents: clone(session.runtimeEvents || [])\n    },",
    'export runtime events')

app = replace_once(app,
    "      systemSpeechLastError: systemSpeechSession?.snapshot?.().lastError || null,\n      lastError: diagnosticError",
    "      systemSpeechLastError: systemSpeechSession?.snapshot?.().lastError || null,\n      lastError: diagnosticError,\n      runtimeEvents: clone(session?.runtimeEvents || []).slice(-20)",
    'diagnostic runtime events')

app = replace_once(app,
    "      text.style.height = Math.min(280, Math.max(34, text.scrollHeight)) + 'px';",
    "      text.style.height = Math.min(220, Math.max(28, text.scrollHeight)) + 'px';",
    'denser textarea sizing')

app_path.write_text(app, encoding='utf-8')

styles += r'''

/* V35 — stable capture chrome, denser conversation, narrower compact header. */
/* ON AIR means audio capture is live. A SpeechRecognition handoff must not blink the indicator. */
.top-on-air{min-width:66px!important;justify-content:center!important}
.capture-dock.is-recording .record-state{display:none!important}
.capture-dock.is-recording #captureModeLabel{animation:none!important}
.question-nav-item.on-air .question-nav-duration{animation:none!important}

/* Field V34 still had too much air around very short turns. */
.turns-list{gap:4px!important}
.turn-card{padding:5px 7px!important;border-radius:9px!important}
.turn-head{margin-bottom:2px!important;gap:4px!important;min-height:28px!important}
.turn-speaker-select{padding:5px 7px!important;border-radius:8px!important}
.turn-card .turn-text{
  min-height:28px!important;
  padding:4px 7px!important;
  line-height:1.28!important;
  resize:vertical!important;
}
.turn-meta-inline{font-size:.66rem!important}
.turn-card .icon-button{padding:5px 7px!important}

@media(max-width:640px){
  /* Put question navigation and Participants on one row to return useful vertical space. */
  .compact-interview-nav{grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important}
  .mobile-participants-panel[open]{grid-column:1/-1!important}
  .mobile-participants-panel{padding:7px 9px!important}
  .mobile-question-select{padding:8px 9px!important}
  .question-sticky{max-height:min(35dvh,275px)!important}
  .question.question-long,.question.question-very-long{max-height:min(16dvh,138px)!important}
  .turn-card{padding:4px 6px!important}
  .turn-card .turn-text{min-height:27px!important;padding:4px 6px!important}
}
'''
styles_path.write_text(styles, encoding='utf-8')

index = replace_once(index, './styles.css?v=34', './styles.css?v=35', 'css cache id')
index = replace_once(index, './app.js?v=34', './app.js?v=35', 'js cache id')
index_path.write_text(index, encoding='utf-8')

sw = replace_once(sw, "const VERSION = 'offline-interview-v34';", "const VERSION = 'offline-interview-v35';", 'sw version')
sw = sw.replace('./styles.css?v=34', './styles.css?v=35').replace('./app.js?v=34', './app.js?v=35')
sw_path.write_text(sw, encoding='utf-8')

spec = {
  "schema": "offline-interview.interview-spec.v1",
  "id": "test-ux-v35-runtime-polish",
  "version": "1.0",
  "title": "Test UX V35 — stabilité visuelle et erreurs de transcription",
  "context": "La V34 a confirmé que l'ordre actuel des réponses convient. Elle a aussi révélé trois détails restants : ON AIR clignotait encore pendant les changements de personne, les réponses courtes restaient un peu trop aérées et une erreur de transcription a fait perdre une partie d'un propos.",
  "objective": "Vérifier que l'écran ne clignote plus quand on change de personne, que les réponses sont plus compactes, que la petite fenêtre laisse davantage de place au contenu et que la frontière entre personnes reste correcte. Si une erreur de transcription survient, elle doit être explicite et rester traçable dans l'export.",
  "language": "fr-FR",
  "tags": ["ux", "v35", "on-air", "density", "runtime-events", "responsive", "stt-boundary"],
  "estimatedDurationMinutes": 6,
  "participants": [
    {"id":"P1","name":"Interviewer","role":"interviewer"},
    {"id":"P2","name":"Testeur","role":"interviewee"},
    {"id":"P3","name":"Second participant","role":"interviewee"}
  ],
  "sections": [
    {"id":"S1","title":"Stabilité visuelle","questions":[
      {"id":"Q1","label":"ON AIR continu","text":"Avec une fenêtre large, démarrez avec Testeur puis changez huit fois rapidement entre Testeur, Second participant et Interviewer. Le badge ON AIR du haut doit rester visible sans disparaître ni réapparaître. Dans la zone rouge du bas, ON AIR doit rester stable aussi : le mot PASSAGE ne doit plus apparaître et le nom de la personne ne doit pas être répété à côté, puisque le bouton rouge indique déjà qui parle. Dites seulement si vous observez encore un clignotement ou un changement inutile.","intent":"Vérifier que le handoff technique est devenu invisible pour l'utilisateur.","estimatedMinutes":1,"required":true,"audience":["P2","P3"],"followUps":[]},
      {"id":"Q2","label":"Réponses vraiment compactes","text":"Restez sur cette question et faites six prises de parole très courtes, une phrase chacune. Regardez leur empilement. Dites si les petites réponses utilisent maintenant une hauteur raisonnable sans devenir difficiles à lire, modifier ou supprimer.","intent":"Valider la dernière réduction d'espace des réponses courtes.","estimatedMinutes":1,"required":true,"audience":["P2","P3"],"followUps":[]}
    ]},
    {"id":"S2","title":"Petite fenêtre","questions":[
      {"id":"Q3","label":"En-tête compact","text":"Rendez la fenêtre très étroite. Le menu de question et Participants doivent tenir sur la même ligne tant que Participants est fermé. La question, les réponses et la zone rouge du bas doivent disposer de plus de hauteur qu'en V34. Ouvrez puis refermez Participants et dites si l'équilibre de l'écran vous paraît naturel.","intent":"Réduire la part d'écran consommée par les commandes en petite largeur.","estimatedMinutes":1,"required":true,"audience":["P2"],"followUps":[]},
      {"id":"Q4","label":"Question longue","text":"Cette question est volontairement assez longue pour vérifier que le texte reste lisible sans reprendre une trop grande partie de l'écran. Faites défiler uniquement le texte de la question si nécessaire. Pendant ce temps, la conversation doit conserver une zone utile et les boutons de personne doivent rester visibles en bas. Dites si les proportions vous conviennent maintenant.","intent":"Vérifier les proportions finales en petite fenêtre.","estimatedMinutes":1,"required":true,"audience":["P2"],"followUps":[]}
    ]},
    {"id":"S3","title":"Voix et verdict","questions":[
      {"id":"Q5","label":"Frontière rapide","text":"Sans ralentir exprès : Testeur dit « alpha bravo charlie », cliquez sur Second participant ; Second participant dit « delta echo foxtrot », cliquez sur Testeur ; Testeur dit « golf hotel india », cliquez sur Second participant ; Second participant dit « juliet kilo lima ». Vérifiez qu'un groupe complet ne se retrouve pas chez la mauvaise personne.","intent":"Rejouer une frontière locuteur après les modifications d'interface.","estimatedMinutes":1,"required":true,"audience":["P2","P3"],"followUps":[]},
      {"id":"Q6","label":"Verdict V35","text":"Donnez un verdict simple sur quatre points : 1) ON AIR reste-t-il continu quand vous changez de personne ? 2) les réponses courtes sont-elles assez compactes ? 3) la petite fenêtre est-elle mieux proportionnée ? 4) avez-vous rencontré une erreur de transcription ? Si oui, laissez le message affiché et mentionnez brièvement ce que vous étiez en train de faire. L'ordre des réponses n'est plus à arbitrer : V34 a conclu qu'il n'est pas nécessaire de l'inverser.","intent":"Fermer les points UX restants et capturer toute anomalie de transcription.","estimatedMinutes":1,"required":true,"audience":["P2"],"followUps":[]}
    ]}
  ]
}
test_path.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('V35 patch applied')

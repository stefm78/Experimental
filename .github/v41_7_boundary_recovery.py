from pathlib import Path
import json

app_path = Path('offline-interview/app.js')
s = app_path.read_text()

s = s.replace("const BUILD_ID = '2026-09-06.interview-runtime-v41.6';", "const BUILD_ID = '2026-09-07.interview-runtime-v41.7';", 1)
s = s.replace("let startedRecordingAt = 0;\n", "let startedRecordingAt = 0;\nlet recordingMasterStartedAt = 0;\n", 1)

old = """  const previousSpeakerId = recordingSpeakerId;\n  const previousQuestionId = recordingQuestionId;\n  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);\n  const recordingId = recordingCaptureId;\n  const segmentStartMs = recordingAudioOffsetMs;\n  const segmentEndMs = segmentStartMs + durationSeconds * 1000;\n  const cut = systemSpeechSession.takeSegment();\n"""
new = """  const previousSpeakerId = recordingSpeakerId;\n  const previousQuestionId = recordingQuestionId;\n  const recordingId = recordingCaptureId;\n  const segmentStartMs = recordingAudioOffsetMs;\n  const segmentEndMs = Math.max(segmentStartMs, recordingMasterStartedAt ? performance.now() - recordingMasterStartedAt : segmentStartMs);\n  const durationSeconds = Math.max(0, (segmentEndMs - segmentStartMs) / 1000);\n  const cut = systemSpeechSession.takeSegment();\n"""
if old not in s: raise SystemExit('rotate timing block not found')
s = s.replace(old, new, 1)

old = """  const baseSource = systemSpeechCapability.mode === 'local' ? 'system-local-cut' : 'system-cut';\n  const commit = async () => {\n    let settled = null;\n    try { settled = await cut.settled; } catch {}\n    const text = cleanText(settled?.text || cut.text);\n    if (!meaningfulTranscript(text)) {\n      await appendAudioOnlyTurn({\n        questionId: previousQuestionId,\n        speakerId: previousSpeakerId,\n        durationSeconds,\n        audioRef: failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs }\n      });\n      logRuntimeEvent('system_transcription_missing', { questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true });\n      return;\n    }\n    await appendAnswerTurn({\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,\n      text,\n      source: baseSource,\n      rawTranscript: settled?.finalText || text,\n      durationSeconds,\n      audioRef: failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs }\n    });\n    await persistSession();\n  };\n"""
new = """  const commit = async () => {\n    let settled = null;\n    try { settled = await cut.settled; } catch {}\n    const provisionalText = cleanText(settled?.text || cut.text);\n    // Continuous SpeechRecognition may emit one hypothesis spanning a human click.\n    // Never assign that hypothesis across speakers as authoritative text. Preserve the\n    // exact audio interval and recover it from that immutable interval after capture.\n    await appendAudioOnlyTurn({\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,\n      durationSeconds,\n      audioRef: failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs },\n      source: 'audio-system-boundary-pending',\n      rawTranscript: provisionalText || null\n    });\n    logRuntimeEvent('system_boundary_deferred', {\n      questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true, provisionalText: Boolean(provisionalText)\n    });\n  };\n"""
if old not in s: raise SystemExit('rotate commit block not found')
s = s.replace(old, new, 1)

s = s.replace("async function retranscribeTurnWithSystem(turn, button) {", "async function retranscribeTurnWithSystem(turn, button, reason = 'manual') {", 1)
s = s.replace("logRuntimeEvent('system_retranscription_succeeded', { turnId: turn.id, mode: result.mode, stable: true });", "logRuntimeEvent('system_retranscription_succeeded', { turnId: turn.id, mode: result.mode, stable: true, reason });", 1)

old = """async function appendAudioOnlyTurn({ questionId, speakerId, durationSeconds = 0, audioRef = null }) {\n  if (!questionId || !speakerId || !audioRef?.recordingId) return false;\n  const response = responseFor(questionId);\n  response.turns.push(createTurn({ type: 'answer', speakerId, text: '', source: 'audio-system-pending', durationSeconds, audioRef }));\n  response.status = 'answered';\n  session.updatedAt = nowIso();\n  await persistSession();\n  renderTurns();\n  renderQuestionNav();\n  renderInterviewMetrics();\n  return true;\n}\n"""
new = """async function appendAudioOnlyTurn({ questionId, speakerId, durationSeconds = 0, audioRef = null, source = 'audio-system-pending', rawTranscript = null }) {\n  if (!questionId || !speakerId || !audioRef?.recordingId) return false;\n  const response = responseFor(questionId);\n  response.turns.push(createTurn({ type: 'answer', speakerId, text: '', source, rawTranscript, durationSeconds, audioRef }));\n  response.status = 'answered';\n  session.updatedAt = nowIso();\n  await persistSession();\n  renderTurns();\n  renderQuestionNav();\n  renderInterviewMetrics();\n  return true;\n}\n\nasync function recoverBoundaryTurnsWithSystem(captureId) {\n  const pending = Object.values(session?.responses || {}).flatMap(response => response.turns || []).filter(turn =>\n    turn.audioRef?.recordingId === captureId && turn.source === 'audio-system-boundary-pending'\n  );\n  if (!pending.length) return;\n  if (!supportsSystemAudioTrackRecognition() || systemSpeechCapability.mode === 'unavailable') {\n    logRuntimeEvent('system_boundary_recovery_deferred', { captureId, count: pending.length, reason: 'audio-track-unsupported' });\n    return;\n  }\n  for (const turn of pending) await retranscribeTurnWithSystem(turn, null, 'boundary-recovery');\n}\n"""
if old not in s: raise SystemExit('appendAudioOnlyTurn block not found')
s = s.replace(old, new, 1)

old = """    recorder.onstop = handleRecordingStopped;\n    recorder.start(500);\n\n    systemSpeechSession = createSystemSpeechSession({\n"""
new = """    recorder.onstop = handleRecordingStopped;\n    recorder.start(500);\n    recordingMasterStartedAt = performance.now();\n\n    systemSpeechSession = createSystemSpeechSession({\n"""
if old not in s: raise SystemExit('recorder start block not found')
s = s.replace(old, new, 1)
s = s.replace("    startedRecordingAt = performance.now();\n", "    startedRecordingAt = recordingMasterStartedAt || performance.now();\n", 1)

old = """function stopRecording() {\n  if (!recorder || recorder.state === 'inactive') return;\n  composerDurationSeconds = (performance.now() - startedRecordingAt) / 1000;\n"""
new = """function stopRecording() {\n  if (!recorder || recorder.state === 'inactive') return;\n  const masterEndMs = recordingMasterStartedAt ? Math.max(recordingAudioOffsetMs, performance.now() - recordingMasterStartedAt) : recordingAudioOffsetMs + Math.max(0, performance.now() - startedRecordingAt);\n  composerDurationSeconds = Math.max(0, (masterEndMs - recordingAudioOffsetMs) / 1000);\n"""
if old not in s: raise SystemExit('stopRecording block not found')
s = s.replace(old, new, 1)

old = """    } else {\n      ui.recordState.textContent = 'Audio non conservé';\n      showError(ui.interviewError, 'La transcription système n’a rien renvoyé et l’audio local n’a pas pu être conservé.');\n    }\n  } catch (error) {\n"""
new = """    } else {\n      ui.recordState.textContent = 'Audio non conservé';\n      showError(ui.interviewError, 'La transcription système n’a rien renvoyé et l’audio local n’a pas pu être conservé.');\n    }\n    if (audioStored) await recoverBoundaryTurnsWithSystem(captureId);\n  } catch (error) {\n"""
if old not in s: raise SystemExit('recovery insertion point not found')
s = s.replace(old, new, 1)

s = s.replace("    recordingSpeakerId = null;\n    recordingQuestionId = null;\n    recorder = null;", "    recordingSpeakerId = null;\n    recordingQuestionId = null;\n    recordingMasterStartedAt = 0;\n    recorder = null;", 1)

old = """    replay.disabled = !turn.audioRef?.recordingId;\n    replay.addEventListener('click', () => replayTurnAudio(turn, replay));\n"""
new = """    const audioReady = Boolean(turn.audioRef?.recordingId) && !isRecording() && !captureFinalizing;\n    replay.disabled = !audioReady;\n    replay.addEventListener('click', () => replayTurnAudio(turn, replay));\n"""
if old not in s: raise SystemExit('replay readiness block not found')
s = s.replace(old, new, 1)
s = s.replace("retranscribe.disabled = !turn.audioRef?.recordingId || !trackSupported || systemSpeechCapability.mode === 'unavailable' || ['succeeded', 'failed'].includes(stableRetranscription);", "retranscribe.disabled = !audioReady || !trackSupported || systemSpeechCapability.mode === 'unavailable' || ['succeeded', 'failed'].includes(stableRetranscription);", 1)

app_path.write_text(s)

for name in ['offline-interview/index.html', 'offline-interview/sw.js']:
    p = Path(name)
    t = p.read_text().replace('41.6', '41.7')
    p.write_text(t)

contract = Path('offline-interview/test-runtime-contract.mjs')
t = contract.read_text().replace('41\\.6', '41\\.7').replace('41.6', '41.7')
anchor = "assert.match(app, /\\['succeeded', 'failed'\\]\\.includes\\(stableRetranscription\\)/);\n"
extra = """\n// V41.7: semantic boundary text is derived from immutable saved-audio intervals, not cross-boundary live hypotheses.\nassert.match(app, /let recordingMasterStartedAt = 0/);\nassert.match(app, /performance\\.now\\(\\) - recordingMasterStartedAt/);\nassert.match(app, /audio-system-boundary-pending/);\nassert.match(app, /recoverBoundaryTurnsWithSystem\\(captureId\\)/);\nassert.match(app, /'boundary-recovery'/);\nassert.match(app, /const audioReady = Boolean\\(turn\\.audioRef\\?\\.recordingId\\) && !isRecording\\(\\) && !captureFinalizing/);\n"""
if anchor not in t: raise SystemExit('contract anchor not found')
t = t.replace(anchor, anchor + extra, 1)
contract.write_text(t)

questionnaire = {
  "schema": "offline-interview.interview-spec.v1",
  "version": "1.0",
  "id": "test-ux-v41-7-boundary-recovery",
  "title": "Test V41.7 — frontières audio et récupération",
  "context": "Qualification humaine exact-head avant toute promotion.",
  "objective": "Vérifier que les changements de personne ne produisent plus d’attribution textuelle trompeuse et que l’audio exact reste la source de récupération.",
  "language": "fr-FR",
  "estimatedDurationMinutes": 7,
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Testeur", "role": "interviewee"}
  ],
  "sections": [{
    "id": "S1", "title": "Qualification V41.7", "questions": [
      {"id": "Q1", "label": "Préflight exact-head", "text": "Avant tout test, ouvrez Diagnostic et vérifiez exactement 2026-09-07.interview-runtime-v41.7. Si une autre version apparaît, arrêtez immédiatement et répondez INVALID_TEST_TARGET.", "intent": "Empêcher un test sur la mauvaise version.", "estimatedMinutes": 1, "required": True, "audience": ["P2"], "followUps": []},
      {"id": "Q2", "label": "Changements rapides de personne", "text": "Dans une seule captation, alternez Testeur et Interviewer quatre fois. Dites lentement : alpha bravo charlie ; delta echo foxtrot ; golf hotel india ; juliet kilo lima. Après avoir arrêté l’enregistrement, vérifiez que chaque prise appartient à la bonne personne. Réécoutez chaque prise : elle ne doit pas commencer par un mot prononcé avant le clic de changement. Indiquez aussi si le texte apparaît automatiquement après l’arrêt ou reste à retranscrire.", "intent": "Qualifier la frontière audio exacte et la récupération système depuis chaque segment sauvegardé.", "estimatedMinutes": 3, "required": True, "audience": ["P1", "P2"], "followUps": []},
      {"id": "Q3", "label": "Pas de retranscription prématurée", "text": "Pendant qu’un enregistrement est encore en cours, regardez une prise déjà créée dans ce même enregistrement. Vérifiez que la relecture et la retranscription de cet audio ne sont pas proposées comme disponibles avant la sauvegarde de l’audio. Après l’arrêt, vérifiez qu’elles deviennent utilisables quand le navigateur les prend en charge.", "intent": "Éviter l’erreur Audio local introuvable pendant une captation active.", "estimatedMinutes": 1, "required": True, "audience": ["P2"], "followUps": []},
      {"id": "Q4", "label": "Téléphone fail-closed", "text": "Sur téléphone, refaites au moins deux changements de personne. Vérifiez que l’audio reste réécoutable et correctement attribué. Si la retranscription d’un audio enregistré n’est pas prise en charge, elle doit rester indisponible sans lancer Whisper automatiquement. Un segment sans texte doit rester visible et réécoutable, pas disparaître.", "intent": "Conserver l’intégrité sur mobile même sans retranscription système a posteriori.", "estimatedMinutes": 2, "required": True, "audience": ["P1", "P2"], "followUps": []}
    ]
  }]
}
Path('offline-interview/test-interviews/interview-test-ux-v41-7.json').write_text(json.dumps(questionnaire, ensure_ascii=False, indent=2) + '\n')

from pathlib import Path
import json

app_path = Path('offline-interview/app.js')
s = app_path.read_text()

s = s.replace("const BUILD_ID = '2026-09-07.interview-runtime-v41.7';", "const BUILD_ID = '2026-09-07.interview-runtime-v41.8';", 1)

old = """  const commit = async () => {\n    let settled = null;\n    try { settled = await cut.settled; } catch {}\n    const provisionalText = cleanText(settled?.text || cut.text);\n    // Continuous SpeechRecognition may emit one hypothesis spanning a human click.\n    // Never assign that hypothesis across speakers as authoritative text. Preserve the\n    // exact audio interval and recover it from that immutable interval after capture.\n    await appendAudioOnlyTurn({\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,\n      durationSeconds,\n      audioRef: failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs },\n      source: 'audio-system-boundary-pending',\n      rawTranscript: provisionalText || null\n    });\n    logRuntimeEvent('system_boundary_deferred', {\n      questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true, provisionalText: Boolean(provisionalText)\n    });\n  };\n"""
new = """  const commit = async () => {\n    const provisionalText = cleanText(cut.text);\n    const audioRef = failedAudioCaptureIds.has(recordingId) ? null : { recordingId, startMs: segmentStartMs, endMs: segmentEndMs };\n    if (meaningfulTranscript(provisionalText)) {\n      await appendAnswerTurn({\n        questionId: previousQuestionId,\n        speakerId: previousSpeakerId,\n        text: provisionalText,\n        source: systemSpeechCapability.mode === 'local' ? 'system-local-boundary-draft' : 'system-boundary-draft',\n        rawTranscript: provisionalText,\n        durationSeconds,\n        audioRef\n      });\n      logRuntimeEvent('system_boundary_live_committed', {\n        questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true, textLength: provisionalText.length\n      });\n      return;\n    }\n    await appendAudioOnlyTurn({\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,\n      durationSeconds,\n      audioRef,\n      source: 'audio-system-boundary-pending',\n      rawTranscript: null\n    });\n    logRuntimeEvent('system_boundary_live_missing', {\n      questionId: previousQuestionId, speakerId: previousSpeakerId, boundary: true\n    });\n  };\n"""
if old not in s: raise SystemExit('V41.7 boundary commit block not found')
s = s.replace(old, new, 1)

old = """async function recoverBoundaryTurnsWithSystem(captureId) {\n  const pending = Object.values(session?.responses || {}).flatMap(response => response.turns || []).filter(turn =>\n    turn.audioRef?.recordingId === captureId && turn.source === 'audio-system-boundary-pending'\n  );\n  if (!pending.length) return;\n  if (!supportsSystemAudioTrackRecognition() || systemSpeechCapability.mode === 'unavailable') {\n    logRuntimeEvent('system_boundary_recovery_deferred', { captureId, count: pending.length, reason: 'audio-track-unsupported' });\n    return;\n  }\n  for (const turn of pending) await retranscribeTurnWithSystem(turn, null, 'boundary-recovery');\n}\n\n"""
if old not in s: raise SystemExit('V41.7 automatic boundary recovery function not found')
s = s.replace(old, '', 1)

old = """    if (audioStored) await recoverBoundaryTurnsWithSystem(captureId);\n"""
if old not in s: raise SystemExit('V41.7 automatic recovery call not found')
s = s.replace(old, "    if (audioStored) logRuntimeEvent('boundary_audio_ready', { captureId });\n", 1)

app_path.write_text(s)

for name in ['offline-interview/index.html', 'offline-interview/sw.js']:
    p = Path(name)
    p.write_text(p.read_text().replace('41.7', '41.8'))

contract = Path('offline-interview/test-runtime-contract.mjs')
t = contract.read_text().replace('41\\.7', '41\\.8').replace('41.7', '41.8')
t = t.replace("assert.match(app, /audio-system-boundary-pending/);\nassert.match(app, /recoverBoundaryTurnsWithSystem\\(captureId\\)/);\nassert.match(app, /'boundary-recovery'/);\n", "assert.match(app, /audio-system-boundary-pending/);\n")
anchor = "assert.match(app, /const audioReady = Boolean\\(turn\\.audioRef\\?\\.recordingId\\) && !isRecording\\(\\) && !captureFinalizing/);\n"
extra = """\n// V41.8: live system text is committed immediately; saved-audio retranscription is recovery, never a critical-path prerequisite.\nassert.match(app, /system-boundary-draft/);\nassert.match(app, /system_boundary_live_committed/);\nassert.match(app, /system_boundary_live_missing/);\nassert.match(app, /boundary_audio_ready/);\nassert.doesNotMatch(app, /recoverBoundaryTurnsWithSystem/);\nassert.doesNotMatch(app, /await retranscribeTurnWithSystem\\(turn, null, 'boundary-recovery'\\)/);\n"""
if anchor not in t: raise SystemExit('runtime contract anchor not found')
t = t.replace(anchor, anchor + extra, 1)
contract.write_text(t)

questionnaire = {
  "schema": "offline-interview.interview-spec.v1",
  "version": "1.0",
  "id": "test-ux-v41-8-live-first",
  "title": "Test V41.8 — transcription live sans retraitement obligatoire",
  "context": "Qualification humaine exact-head avant toute promotion.",
  "objective": "Vérifier que la transcription système déjà produite apparaît immédiatement et s'accumule, sans retranscription audio automatique sur le chemin critique.",
  "language": "fr-FR",
  "estimatedDurationMinutes": 6,
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Testeur", "role": "interviewee"}
  ],
  "sections": [{
    "id": "S1", "title": "Qualification V41.8", "questions": [
      {"id": "Q1", "label": "Préflight exact-head", "text": "Avant tout test, ouvrez Diagnostic et vérifiez exactement 2026-09-07.interview-runtime-v41.8. Si une autre version apparaît, arrêtez immédiatement et répondez INVALID_TEST_TARGET.", "intent": "Empêcher un test sur la mauvaise version.", "estimatedMinutes": 1, "required": True, "audience": ["P2"], "followUps": []},
      {"id": "Q2", "label": "Transcription live accumulée", "text": "Dans une seule captation, faites parler Testeur puis Interviewer puis Testeur. Après chaque changement de personne, vérifiez que le texte système déjà visible apparaît rapidement dans la liste des prises, sans attendre un retraitement de l'audio enregistré. Dites si l'interface reste fluide pendant les changements.", "intent": "La transcription live est le chemin principal et s'accumule au fil de l'entretien.", "estimatedMinutes": 2, "required": True, "audience": ["P1", "P2"], "followUps": []},
      {"id": "Q3", "label": "Récupération seulement si nécessaire", "text": "Si une prise reste sans texte, vérifiez qu'elle reste visible avec son audio. Après l'arrêt, utilisez la retranscription système uniquement sur cette prise manquante. Une prise qui possède déjà du texte ne doit pas être automatiquement retraitée depuis son audio.", "intent": "La retranscription d'audio sauvegardé est un mécanisme de récupération, pas une étape obligatoire.", "estimatedMinutes": 2, "required": True, "audience": ["P2"], "followUps": []},
      {"id": "Q4", "label": "Téléphone fail-closed", "text": "Sur téléphone, vérifiez qu'une prise sans texte reste visible et réécoutable, sans Whisper automatique et sans retraitement obligatoire de l'audio.", "intent": "Conserver l'intégrité mobile sans bloquer le flux d'entretien.", "estimatedMinutes": 1, "required": True, "audience": ["P2"], "followUps": []}
    ]
  }]
}
Path('offline-interview/test-interviews/interview-test-ux-v41-8.json').write_text(json.dumps(questionnaire, ensure_ascii=False, indent=2) + '\n')

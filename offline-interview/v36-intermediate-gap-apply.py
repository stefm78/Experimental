from pathlib import Path
p = Path('offline-interview/app.js')
s = p.read_text(encoding='utf-8')
old = """    const text = cleanText(settled?.text || cut.text);\n    if (!meaningfulTranscript(text)) return;\n    await appendAnswerTurn({\n      questionId: previousQuestionId,"""
new = """    const text = cleanText(settled?.text || cut.text);\n    if (!meaningfulTranscript(text)) {\n      registerCaptureGap(\n        previousQuestionId,\n        previousSpeakerId,\n        'Aucun texte reconnu pour ce passage au changement de personne. Répétez ce passage.'\n      );\n      return;\n    }\n    await appendAnswerTurn({\n      questionId: previousQuestionId,"""
if s.count(old) != 1:
    raise SystemExit(f'intermediate gap anchor count={s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('V36 intermediate gap patch applied')

from pathlib import Path

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
styles_path = root / 'offline-interview' / 'styles.css'
sw_path = root / 'offline-interview' / 'sw.js'

app = app_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')
styles = styles_path.read_text(encoding='utf-8')
sw = sw_path.read_text(encoding='utf-8')

# Runtime/cache identity.
assert "2026-09-04.interview-runtime-v33" in app
app = app.replace("2026-09-04.interview-runtime-v33", "2026-09-04.interview-runtime-v34", 1)
assert 'href="./styles.css?v=33"' in index
index = index.replace('href="./styles.css?v=33"', 'href="./styles.css?v=34"', 1)
assert './app.js?v=33' in index
index = index.replace('./app.js?v=33', './app.js?v=34', 1)
assert "const VERSION = 'offline-interview-v33';" in sw
sw = sw.replace("const VERSION = 'offline-interview-v33';", "const VERSION = 'offline-interview-v34';", 1)
assert "'./styles.css?v=33', './app.js?v=33'" in sw
sw = sw.replace("'./styles.css?v=33', './app.js?v=33'", "'./styles.css?v=34', './app.js?v=34'", 1)

# Field feedback: the top ON AIR pill must not change width when the speaker changes.
old_top = """  if (ui.topOnAirSpeaker && recording) {\n    const speaker = participantById(recordingSpeakerId);\n    ui.topOnAirSpeaker.textContent = speaker ? '· ' + speaker.name : '';\n  }\n"""
new_top = """  // Speaker identity already lives in the capture dock and active speaker button.\n  // Keep the global ON AIR pill intentionally static to avoid visual flicker.\n  if (ui.topOnAirSpeaker) ui.topOnAirSpeaker.textContent = '';\n"""
assert old_top in app
app = app.replace(old_top, new_top, 1)

# Field feedback: clicking the default participant name should let typing replace it directly.
old_name = """    name.value = participant.name;\n    name.setAttribute('aria-label', `Nom de ${participant.id}`);\n    name.addEventListener('change', async () => {\n"""
new_name = """    name.value = participant.name;\n    name.setAttribute('aria-label', `Nom de ${participant.id}`);\n    const selectDefaultParticipantName = () => {\n      if (name.value === 'Nouveau participant') requestAnimationFrame(() => name.select());\n    };\n    name.addEventListener('focus', selectDefaultParticipantName);\n    name.addEventListener('click', selectDefaultParticipantName);\n    name.addEventListener('change', async () => {\n"""
assert old_name in app
app = app.replace(old_name, new_name, 1)

marker = '/* V34 — field polish after V33 qualification. */'
assert marker not in styles
styles += r'''

/* V34 — field polish after V33 qualification. */
/* Keep the global recording indicator stable; speaker identity remains in the capture dock. */
.top-on-air span:last-child{display:none!important}

/* Short responses should behave like compact transcript rows, not large form fields. */
.conversation-section{margin:8px 0 10px!important}
.conversation-section>h3{margin:0 0 7px!important;font-size:.86rem!important;color:#64748b!important}
.turns-list{gap:6px!important}
.turn-card{padding:8px 9px!important;border-radius:11px!important}
.turn-head{gap:6px!important;margin-bottom:4px!important}
.turn-card .turn-text{
  min-height:34px!important;
  padding:7px 9px!important;
  line-height:1.35!important;
}
.turn-meta-inline{font-size:.7rem!important;color:#94a3b8!important;white-space:nowrap}

/* A long prompt may scroll inside its own text area, but it must not consume the interview. */
.question.question-long,
.question.question-very-long{
  max-height:min(24dvh,230px)!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding-right:8px!important;
}
.question-sticky{max-height:min(42dvh,390px)!important}

@media(max-width:979px){
  .question-sticky{max-height:min(40dvh,340px)!important}
  .question.question-long,
  .question.question-very-long{max-height:min(21dvh,190px)!important}
}

@media(max-width:640px){
  .question-sticky{max-height:min(38dvh,300px)!important}
  .question.question-long,
  .question.question-very-long{
    max-height:min(18dvh,155px)!important;
    font-size:1.08rem!important;
    line-height:1.28!important;
  }
  .turn-card{padding:7px 8px!important}
  .turn-card .turn-text{min-height:32px!important;padding:6px 8px!important;line-height:1.3!important}
}
'''

app_path.write_text(app, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
styles_path.write_text(styles, encoding='utf-8')
sw_path.write_text(sw, encoding='utf-8')

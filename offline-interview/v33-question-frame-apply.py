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

assert "2026-09-04.interview-runtime-v32" in app
app = app.replace("2026-09-04.interview-runtime-v32", "2026-09-04.interview-runtime-v33", 1)

old = "  show(ui.captureQuestionContext, active);\n  show(ui.topOnAir, recording && !captureHandoffPending);"
new = "  show(ui.captureQuestionContext, false);\n  show(ui.topOnAir, recording && !captureHandoffPending);"
assert old in app
app = app.replace(old, new, 1)

needle = "  const differs = Boolean(recording && viewed?.question?.id && viewed.question.id !== recordingQuestionId);\n"
assert needle in app
app = app.replace(needle, needle + "\n  // The context row is useful only when the interviewer can transfer capture.\n  show(ui.captureQuestionContext, differs);\n", 1)

assert './styles.css' in index
index = index.replace('href="./styles.css"', 'href="./styles.css?v=33"', 1)
assert './app.js?v=32' in index
index = index.replace('./app.js?v=32', './app.js?v=33', 1)

assert "const VERSION = 'offline-interview-v32';" in sw
sw = sw.replace("const VERSION = 'offline-interview-v32';", "const VERSION = 'offline-interview-v33';", 1)
assert "'./styles.css', './app.js?v=32'" in sw
sw = sw.replace("'./styles.css', './app.js?v=32'", "'./styles.css?v=33', './app.js?v=33'", 1)

marker = '/* V33 — stable question frame + conversation-only scroll. */'
assert marker not in styles
styles += r'''

/* V33 — stable question frame + conversation-only scroll. */
/*
   Field rule: a new speaker turn may move the conversation, never the question.
   The footer remains a natural-height sibling. The conversation is the only
   region that follows newly appended turns automatically.
*/
.interview-main{
  display:flex!important;
  flex-direction:column!important;
  min-height:0!important;
  overflow:hidden!important;
}
.interview-workspace-scroll{
  flex:1 1 auto!important;
  min-height:0!important;
  display:flex!important;
  flex-direction:column!important;
  overflow:hidden!important;
  padding-right:0!important;
}
.question-sticky{
  flex:0 0 auto!important;
  position:relative!important;
  top:auto!important;
  max-height:min(46dvh,440px)!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  border-bottom:1px solid #edf1f5!important;
}
.conversation-scroll{
  flex:1 1 0!important;
  min-height:0!important;
  max-height:none!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain;
  scroll-behavior:smooth;
}
.capture-dock{
  flex:0 0 auto!important;
  align-self:stretch!important;
  min-height:0!important;
}

/* Three complete lines are easier to read than the 1.5–2.5 line V32 window. */
.live-transcript{
  height:calc(4.35em + 20px)!important;
  min-height:calc(4.35em + 20px)!important;
  max-height:calc(4.35em + 20px)!important;
  overflow-y:auto!important;
}

/* Participant roles are authoring metadata, not an in-interview narrow-screen control. */
.mobile-participants-panel .participant-id,
.mobile-participants-panel .participant-row select{
  display:none!important;
}
.mobile-participants-panel .participant-row{
  grid-template-columns:minmax(0,1fr) 38px!important;
}
.mobile-participants-panel .participant-row input{
  grid-column:1/2!important;
  grid-row:1!important;
}
.mobile-participants-panel .participant-row .icon-button{
  grid-column:2/3!important;
  grid-row:1!important;
}

/* The compact question selector already replaces Previous / Next. */
@media(max-width:979px){
  .interview-nav-actions{display:none!important}
  .compact-interview-nav{
    position:sticky!important;
    top:0!important;
    z-index:8!important;
    background:#fff!important;
  }
  .question-sticky{max-height:min(48dvh,400px)!important}
}

/* On very narrow screens keep only the controls needed during the interview. */
@media(max-width:640px){
  .question-header>div:first-child{display:none!important}
  .mobile-only-metrics,
  .question-progress-mobile{display:none!important}
  .question-header{padding-bottom:2px!important}
  .interview-clock{width:100%!important;justify-content:space-between!important;gap:5px!important}
  .question-sticky{max-height:min(47dvh,360px)!important}
  .question{margin-top:12px!important}
  .live-transcript{
    height:calc(4.35em + 16px)!important;
    min-height:calc(4.35em + 16px)!important;
    max-height:calc(4.35em + 16px)!important;
  }
}
'''

app_path.write_text(app, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
styles_path.write_text(styles, encoding='utf-8')
sw_path.write_text(sw, encoding='utf-8')

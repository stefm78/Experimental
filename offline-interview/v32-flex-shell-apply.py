from pathlib import Path

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
style_path = root / 'offline-interview' / 'styles.css'
sw_path = root / 'offline-interview' / 'sw.js'


def once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

app = app_path.read_text(encoding='utf-8')
app = once(app, "const BUILD_ID = '2026-09-04.interview-runtime-v31';", "const BUILD_ID = '2026-09-04.interview-runtime-v32';", 'build id')
app = app.replace("register('./sw.js?v=31'", "register('./sw.js?v=32'")
app = app.replace("'actif · v31'", "'actif · v32'")
app = app.replace("'installé · v31'", "'installé · v32'")
app_path.write_text(app, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
index = once(index, '<script type="module" src="./app.js?v=31"></script>', '<script type="module" src="./app.js?v=32"></script>', 'app cache query')
index_path.write_text(index, encoding='utf-8')

styles = style_path.read_text(encoding='utf-8')
styles += r'''

/* V32 — deterministic flex shell: one scrollable workspace + non-growing capture footer. */
.interview-main{
  display:flex!important;
  flex-direction:column!important;
  height:100%!important;
  min-height:0!important;
  padding:0!important;
  overflow:hidden!important;
}
.interview-workspace-scroll{
  flex:1 1 auto!important;
  min-height:0!important;
  overflow-y:auto!important;
  overflow-x:hidden!important;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding:0 4px 0 0;
}
.capture-dock{
  flex:0 0 auto!important;
  align-self:stretch!important;
  height:auto!important;
  min-height:0!important;
  margin:0!important;
  overflow:hidden!important;
  border-radius:0 0 18px 18px!important;
  box-shadow:0 -6px 18px rgba(15,23,42,.06)!important;
}
.capture-dock .live-transcript-slot{min-height:0!important;margin-bottom:5px!important}
.live-transcript{min-height:42px!important;max-height:64px!important;overflow-y:auto!important}
/* Current question ownership is already visible in navigation. Keep this row only when a transfer is actionable. */
.capture-question-context:not(:has(.move-capture:not(.hidden))){display:none!important}
.capture-state-row{margin-bottom:6px!important}
.capture-dock .speaker-button{min-height:46px!important}

@media(max-width:979px){
  .interview-layout{height:calc(100dvh - 16px)!important;overflow:hidden!important}
  .interview-main{height:100%!important;padding:0!important}
  .interview-workspace-scroll{padding:8px 10px 0!important}
  /* display:contents removes the old sticky-parent boundary so compact navigation sticks to the workspace itself. */
  .question-sticky{display:contents!important}
  .compact-interview-nav{
    display:grid!important;
    position:sticky!important;
    top:0!important;
    z-index:30!important;
    background:rgba(255,255,255,.985)!important;
    padding:7px 0 8px!important;
    margin:0 0 8px!important;
    border-bottom:1px solid #edf1f5!important;
  }
  .capture-dock{padding:9px 10px 10px!important;border-radius:0 0 14px 14px!important}
  .live-transcript{min-height:40px!important;max-height:50px!important}
}

@media(max-width:640px){
  /* The compact selector already names the active question; remove duplicated section/question labels. */
  .question-header>div:first-child{display:none!important}
  .question-header{display:block!important;padding:5px 0 2px!important}
  .interview-clock{justify-content:space-between!important;gap:6px!important;flex-wrap:nowrap!important}
  .interview-clock-copy #sessionRemainingText,
  .interview-clock-copy span[aria-hidden="true"]{display:none!important}
  .mobile-only-metrics{margin:5px 0 3px!important}
  .time-progress.mobile-only-metrics{margin-bottom:4px!important}
  .question-progress-mobile{margin:0 0 4px!important}
  .compact-interview-nav{grid-template-columns:1fr!important;padding-top:5px!important}
  .question{margin:12px 0 8px!important}
  .capture-dock{padding:8px!important}
  .live-transcript{min-height:2.55em!important;max-height:2.55em!important;line-height:1.35!important}
  .capture-state-row{margin-bottom:5px!important}
  .speaker-buttons{gap:5px!important}
  .speaker-button{min-height:44px!important;padding:7px 5px!important}
}
'''
style_path.write_text(styles, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = once(sw, "const VERSION = 'offline-interview-v31';", "const VERSION = 'offline-interview-v32';", 'sw version')
sw = once(sw, "'./', './index.html', './styles.css', './app.js?v=31', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=32', './system-stt.js',", 'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V32 flex shell hardening applied')

from pathlib import Path
import re

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

# Runtime identity + compact selector state only. Capture semantics remain V29/V30.
app = app_path.read_text(encoding='utf-8')
app = once(app, "const BUILD_ID = '2026-09-04.interview-runtime-v30';", "const BUILD_ID = '2026-09-04.interview-runtime-v31';", 'build id')
app = once(
    app,
    "      const answered = questionHasAnswer(entry.question.id);\n      option.textContent = `${index + 1}. ${questionNavLabel(entry.question)}${answered ? ' ✓' : ''}`;",
    "      const answered = questionHasAnswer(entry.question.id);\n      const recordingTarget = Boolean(isRecording() && recordingQuestionId === entry.question.id);\n      const finalizingTarget = Boolean(captureFinalizing && recordingQuestionId === entry.question.id);\n      const stateSuffix = recordingTarget ? ' · ON AIR' : finalizingTarget ? ' · TRAITEMENT' : answered ? ' ✓' : '';\n      option.textContent = `${index + 1}. ${questionNavLabel(entry.question)}${stateSuffix}`;",
    'compact question state')
app = app.replace("register('./sw.js?v=30'", "register('./sw.js?v=31'")
app = app.replace("'actif · v30'", "'actif · v31'")
app = app.replace("'installé · v30'", "'installé · v31'")
app_path.write_text(app, encoding='utf-8')

# Rebuild the interview main region around ONE scroll owner.
index = index_path.read_text(encoding='utf-8')
main_start = '      <section class="interview-main">\n'
index = once(index, main_start, main_start + '        <div class="interview-workspace-scroll">\n', 'workspace open')

capture_match = re.search(r'\n        <section id="captureDock" class="capture-dock".*?\n        </section>\n', index, flags=re.S)
if not capture_match:
    raise RuntimeError('capture dock block not found')
capture = capture_match.group(0)
index = index[:capture_match.start()] + '\n' + index[capture_match.end():]

end_marker = '        </div>\n\n      </section>\n    </section>\n    <section id="doneView"'
replacement = '        </div>\n        </div>\n' + capture + '\n      </section>\n    </section>\n    <section id="doneView"'
index = once(index, end_marker, replacement, 'workspace close and footer capture')
index = once(index, '<script type="module" src="./app.js?v=30"></script>', '<script type="module" src="./app.js?v=31"></script>', 'app cache query')
index_path.write_text(index, encoding='utf-8')

styles = style_path.read_text(encoding='utf-8')
styles += r'''

/* V31 — one scroll owner + structural capture footer. */
.interview-mode{height:100dvh;overflow:hidden}
.interview-mode .shell{height:100dvh!important;min-height:0!important;overflow:hidden!important}
.interview-layout{height:calc(100dvh - 24px);min-height:0;overflow:hidden;align-items:stretch!important}
.interview-main{height:100%;min-height:0!important;display:grid!important;grid-template-rows:minmax(0,1fr) auto!important;overflow:hidden!important}
.interview-workspace-scroll{min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding-right:4px}
.question-sticky{position:static!important;top:auto!important;z-index:auto!important;max-height:none!important;overflow:visible!important;background:#fff!important}
.question.question-long,.question.question-very-long{max-height:none!important;overflow:visible!important;padding-right:0!important}
.conversation-scroll{min-height:0!important;max-height:none!important;overflow:visible!important}
.capture-dock{position:static!important;left:auto!important;right:auto!important;bottom:auto!important;z-index:auto!important;margin:10px 0 0!important;max-height:none!important;overflow:visible!important;box-shadow:0 -8px 20px rgba(15,23,42,.06)!important}
.capture-dock .speaker-help{display:none!important}
.live-transcript{max-height:72px!important;min-height:48px!important;overflow-y:auto!important}
.question-sidebar{max-height:none!important;height:100%;overflow-y:auto;position:static!important;top:auto!important}

@media(max-width:979px){
  .interview-mode .shell{padding:8px!important}
  .interview-layout{height:calc(100dvh - 16px)!important;display:block!important}
  .question-sidebar{display:none!important}
  .interview-main{height:100%!important;padding:14px 14px 10px!important}
  .compact-interview-nav{display:grid!important;position:sticky;top:0;z-index:6;background:rgba(255,255,255,.98);padding:6px 0 8px;margin:4px 0 6px;border-bottom:1px solid #edf1f5}
  .question{font-size:clamp(1.28rem,3.8vw,1.72rem)!important;line-height:1.3!important;margin:16px 0 9px!important}
  .live-transcript{max-height:54px!important;min-height:42px!important}
  .conversation-section{margin:12px 0!important}
  .manual-entry{margin:12px 0!important}
  .interview-nav-actions{position:static!important;margin-top:12px!important}
}

@media(max-width:640px){
  .interview-main{padding:10px 10px 8px!important}
  .question-header{display:grid!important;grid-template-columns:1fr!important;gap:6px!important}
  .interview-clock{justify-content:space-between;flex-wrap:wrap}
  .compact-interview-nav{grid-template-columns:1fr!important}
  .question{font-size:1.22rem!important;line-height:1.28!important}
  .capture-dock{padding:9px!important;margin-top:6px!important}
  .live-transcript{max-height:2.9em!important;min-height:2.9em!important;line-height:1.45!important}
  .speaker-buttons{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important}
  .speaker-button{min-width:0!important;padding:9px 6px!important;white-space:normal!important;line-height:1.12!important}
  .capture-state-row{gap:6px!important}
  .timer{font-size:1.1rem!important}
}
'''
style_path.write_text(styles, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = once(sw, "const VERSION = 'offline-interview-v30';", "const VERSION = 'offline-interview-v31';", 'sw version')
sw = once(sw, "'./', './index.html', './styles.css', './app.js?v=30', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=31', './system-stt.js',", 'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V31 single-scroll shell patch applied')

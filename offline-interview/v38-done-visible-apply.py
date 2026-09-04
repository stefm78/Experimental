from pathlib import Path

root = Path(__file__).resolve().parent

app = root / 'app.js'
s = app.read_text(encoding='utf-8')
s = s.replace("const BUILD_ID = '2026-09-04.interview-runtime-v37';", "const BUILD_ID = '2026-09-04.interview-runtime-v38';")
needle = "function finishInterview() {\n  setView('done');\n"
replacement = "function finishInterview() {\n  setView('done');\n  requestAnimationFrame(() => {\n    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });\n    try { ui.doneView?.focus({ preventScroll: true }); } catch {}\n  });\n"
if needle not in s:
    raise SystemExit('finishInterview anchor not found')
s = s.replace(needle, replacement, 1)
app.write_text(s, encoding='utf-8')

index = root / 'index.html'
s = index.read_text(encoding='utf-8')
s = s.replace('./styles.css?v=37', './styles.css?v=38')
s = s.replace('./app.js?v=37', './app.js?v=38')
s = s.replace('<section id="doneView" class="done-panel hidden">', '<section id="doneView" class="done-panel hidden" tabindex="-1">')
index.write_text(s, encoding='utf-8')

styles = root / 'styles.css'
s = styles.read_text(encoding='utf-8')
s = s.replace('.done-mode{background:#f4f6f9}', '.done-mode{background:#f4f6f9;min-height:100dvh;height:auto!important;overflow-x:hidden;overflow-y:auto!important}')
s = s.replace('.done-mode .shell{width:min(760px,100%);min-height:100vh;display:grid;align-content:center;padding:24px}', '.done-mode .shell{width:min(760px,100%);min-height:100dvh;height:auto!important;overflow:visible!important;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:24px}')
s = s.replace('.done-panel{background:#fff;border:1px solid #dfe5ee;border-radius:22px;padding:clamp(28px,5vw,46px);box-shadow:0 18px 44px rgba(30,52,84,.08);text-align:center}', '.done-panel{width:100%;margin-block:auto;flex:0 0 auto;background:#fff;border:1px solid #dfe5ee;border-radius:22px;padding:clamp(28px,5vw,46px);box-shadow:0 18px 44px rgba(30,52,84,.08);text-align:center}')
styles.write_text(s, encoding='utf-8')

sw = root / 'sw.js'
s = sw.read_text(encoding='utf-8')
s = s.replace("const VERSION = 'offline-interview-v37';", "const VERSION = 'offline-interview-v38';")
s = s.replace("'./styles.css?v=37', './app.js?v=37'", "'./styles.css?v=38', './app.js?v=38'")
sw.write_text(s, encoding='utf-8')

# Structural invariants for the blocker fixed in V38.
checks = {
    'app build': "interview-runtime-v38" in app.read_text(encoding='utf-8'),
    'scroll reset': "window.scrollTo({ top: 0, left: 0, behavior: 'auto' })" in app.read_text(encoding='utf-8'),
    'done focus target': 'id="doneView" class="done-panel hidden" tabindex="-1"' in index.read_text(encoding='utf-8'),
    'done body scrollable': 'overflow-y:auto!important' in styles.read_text(encoding='utf-8'),
    'done shell flex': 'display:flex;flex-direction:column' in styles.read_text(encoding='utf-8'),
    'done panel auto margin': 'margin-block:auto' in styles.read_text(encoding='utf-8'),
    'cache v38': "offline-interview-v38" in sw.read_text(encoding='utf-8'),
}
failed = [k for k, ok in checks.items() if not ok]
if failed:
    raise SystemExit('V38 invariant failure: ' + ', '.join(failed))
print('V38 patch applied:', ', '.join(checks))

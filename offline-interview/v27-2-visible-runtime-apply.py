from pathlib import Path

root = Path(__file__).resolve().parents[1]
app_path = root / 'offline-interview' / 'app.js'
index_path = root / 'offline-interview' / 'index.html'
sw_path = root / 'offline-interview' / 'sw.js'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, got {count}')
    return text.replace(old, new, 1)

app = app_path.read_text(encoding='utf-8')
app = replace_once(app,
    "const BUILD_ID = '2026-09-03.interview-runtime-v27-1';",
    "const BUILD_ID = '2026-09-04.interview-runtime-v27-2';",
    'build id')
app = replace_once(app,
    "  swStatus: $('swStatus'), storageStatus: $('storageStatus'), modelStatus: $('modelStatus'), progressBlock: $('progressBlock'), progressLabel: $('progressLabel'), progressValue: $('progressValue'), modelProgress: $('modelProgress'), setupError: $('setupError'),",
    "  swStatus: $('swStatus'), storageStatus: $('storageStatus'), modelStatus: $('modelStatus'), runtimeVersion: $('runtimeVersion'), progressBlock: $('progressBlock'), progressLabel: $('progressLabel'), progressValue: $('progressValue'), modelProgress: $('modelProgress'), setupError: $('setupError'),",
    'ui runtimeVersion')
app = replace_once(app,
    "async function init() {\n  ui.diagBuild.textContent = BUILD_ID;",
    "async function init() {\n  ui.diagBuild.textContent = BUILD_ID;\n  if (ui.runtimeVersion) ui.runtimeVersion.textContent = BUILD_ID;",
    'init runtime display')
app = replace_once(app, "register('./sw.js?v=27-1'", "register('./sw.js?v=27-2'", 'sw registration')
app = replace_once(app, "'actif · v27.1'", "'actif · v27.2'", 'sw active label')
app = replace_once(app, "'installé · v27.1'", "'installé · v27.2'", 'sw installed label')
app_path.write_text(app, encoding='utf-8')

index = index_path.read_text(encoding='utf-8')
index = replace_once(index,
    '<span>Application <strong id="swStatus">Vérification…</strong></span>\n          <span>Stockage <strong id="storageStatus">Vérification…</strong></span>',
    '<span>Application <strong id="swStatus">Vérification…</strong></span>\n          <span>Runtime <strong id="runtimeVersion">Vérification…</strong></span>\n          <span>Stockage <strong id="storageStatus">Vérification…</strong></span>',
    'runtime version row')
index = replace_once(index, '<script type="module" src="./app.js?v=27-1"></script>', '<script type="module" src="./app.js?v=27-2"></script>', 'app query')
index_path.write_text(index, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = replace_once(sw, "const VERSION = 'offline-interview-v27-1';", "const VERSION = 'offline-interview-v27-2';", 'sw version')
sw = replace_once(sw, "'./', './index.html', './styles.css', './app.js?v=27-1', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=27-2', './system-stt.js',", 'sw app query')
sw_path.write_text(sw, encoding='utf-8')

print('V27.2 visible runtime patch applied')

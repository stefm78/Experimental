from pathlib import Path

root = Path(__file__).resolve().parent
app = root / 'app.js'
s = app.read_text(encoding='utf-8')
old = "  if (captureFinalizing || recordingCompletionPromise) {\n    pendingInterviewCompletion = true;\n    try {"
new = "  if (captureFinalizing || recordingCompletionPromise) {\n    try {"
if old not in s:
    raise SystemExit('capture-finalizing branch anchor not found')
s = s.replace(old, new, 1)
app.write_text(s, encoding='utf-8')

test = root / 'test-completion-path-v39.mjs'
s = test.read_text(encoding='utf-8')
anchor = "assert.match(app, /pendingInterviewCompletion && !nextSpeakerId/);\n"
addition = anchor + "assert.doesNotMatch(app, /if \\(captureFinalizing \\|\\| recordingCompletionPromise\\) \\{\\s+pendingInterviewCompletion = true;/);\n"
if anchor not in s:
    raise SystemExit('completion regression anchor not found')
s = s.replace(anchor, addition, 1)
test.write_text(s, encoding='utf-8')

print('V39 single-finalize repair applied')

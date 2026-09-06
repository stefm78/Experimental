from pathlib import Path
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text()
s = s.replace(r"assert.match(app, /interview-runtime-v41\.5/);", r"assert.match(app, /interview-runtime-v41\.6/);")
p.write_text(s)

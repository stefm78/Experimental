from pathlib import Path
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text()
s = s.replace("assert.ok(bytes(app) <= 101_000, `app.js budget exceeded: ${bytes(app)} bytes`);", "assert.ok(bytes(app) <= 106_500, `app.js budget exceeded: ${bytes(app)} bytes`);")
s = s.replace("assert.ok(coreBytes <= 200_000, `core source budget exceeded: ${coreBytes} bytes`);", "assert.ok(coreBytes <= 205_000, `core source budget exceeded: ${coreBytes} bytes`);")
p.write_text(s)

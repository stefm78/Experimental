from pathlib import Path
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text()
s = s.replace(r'41\.5', r'41\.6')
s = s.replace('41.5', '41.6')
p.write_text(s)

from pathlib import Path
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text()
s = s.replace(r'v41\.5', r'v41\.6').replace('v41.5', 'v41.6')
p.write_text(s)

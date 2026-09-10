import fs from 'node:fs';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
assert.ok(html.includes("new URL('../beta-v41-23/', window.location.href)"), 'beta-current must target field-qualified V41.23');
assert.ok(html.includes('target.search = window.location.search'), 'beta-current must preserve query string');
assert.ok(html.includes('target.hash = window.location.hash'), 'beta-current must preserve direct-link hash');
assert.ok(html.includes('window.location.replace(target.href)'), 'beta-current must replace history entry');
console.log('Offline Interview beta-current alias contract PASS');

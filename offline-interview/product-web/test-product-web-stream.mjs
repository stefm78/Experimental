import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const status = json('offline-interview/product-web/status.json');
const shell = read('offline-interview/beta/index.html');
const v4123 = read('offline-interview/beta-v41-23/index.html');
const stream = read('offline-interview/product-web/PRODUCT_WEB_STREAM_V1.md');

assert.equal(status.productBaseline.surface, 'offline-interview/beta-v41-23');
assert.equal(status.nativeProductUi, 'FORBIDDEN_DUPLICATION');
assert.equal(status.gates.WEB_PRODUCT_READY, 'HOLD_W1_PHYSICAL_REQUALIFICATION');
assert.match(v4123, /Offline Interview — Beta V41\.23/);

for (const token of [
  'id="questionSidebar"',
  'id="questionNav"',
  'id="mobileQuestionSelect"',
  'id="followUpsPanel"',
  'id="captureDock"',
  'id="doneView"',
  'id="reviewBtn"'
]) assert.ok(shell.includes(token), `Product baseline lost Web UX surface ${token}`);

assert.match(stream, /does not own:/i);
assert.match(stream, /No WER threshold belongs to W1/);
assert.match(stream, /same Web product rather than replace it/i);

console.log('PASS Product Web Stream V1: V41.23 is protected product UX baseline and ASR quality is an independent gate.');

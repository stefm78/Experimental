import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const status = json('offline-interview/product-web/status.json');
const contract = json('offline-interview/architecture/transcription-engine-contract.v1.json');
const shell = read('offline-interview/beta/index.html');
const v4123 = read('offline-interview/beta-v41-23/index.html');
const stream = read('offline-interview/product-web/PRODUCT_WEB_STREAM_V1.md');

assert.equal(status.productBaseline.surface, 'offline-interview/beta-v41-23');
assert.equal(status.sharedContract, 'offline-interview.transcription-engine-contract.v1');
assert.equal(status.audioAuthority, 'PRODUCT_WEB_CAPTURE');
assert.equal(status.gates.WEB_PRODUCT_READY, 'PHYSICAL_CORE_PASS_TRANSCRIPTION_INDEPENDENT');
assert.equal(status.gates.TRANSCRIPTION_INTEGRATION_READY, 'CANDIDATE_AUTOMATED');
assert.equal(status.gates.TRANSCRIPTION_PROVIDER_QUALIFIED, 'HOLD_PROVIDER_DECISION_BENCHMARK');
assert.equal(contract.audio.owner, 'PRODUCT');
assert.equal(contract.audio.engineNeverOwnsAudio, true);
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
assert.match(stream, /valid audio answer remains an answer/i);
assert.match(stream, /Product-owned audio must survive provider failure/i);
assert.match(stream, /provider text is draft/i);
assert.doesNotMatch(stream, /No WER threshold belongs to W1/);

console.log('PASS Product Web Stream V1: V41.23 owns Product/audio; transcription provider quality and provider execution are independent responsibilities.');

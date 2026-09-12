import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const v4123Index = read('offline-interview/beta-v41-23/index.html');
const v4123Build = read('offline-interview/beta-v41-23/build-runtime.mjs');
const v4123Test = read('offline-interview/beta-v41-23/test-product-coherence.mjs');
const webShell = read('offline-interview/beta/index.html');
const split = read('offline-interview/architecture/PRODUCT_SPEECH_SPLIT_V2.md');
const contract = json('offline-interview/architecture/speech-capability-contract.v1.json');

assert.match(v4123Index, /Offline Interview — Beta V41\.23/);
assert.match(v4123Build, /V41\.23 product-coherent runtime generated/);
assert.match(v4123Test, /Offline Interview V41\.23 product coherence contract PASS/);

for (const token of [
  'id="questionSidebar"',
  'id="questionNav"',
  'id="mobileQuestionSelect"',
  'id="questionIntentDetails"',
  'id="followUpsPanel"',
  'id="captureDock"',
  'id="doneView"',
  'id="exportJsonBtn"',
  'id="reviewBtn"'
]) assert.ok(webShell.includes(token), `missing protected Web product surface: ${token}`);

assert.equal(contract.schema, 'offline-interview.speech-capability-contract.v1');
assert.equal(contract.runtimeModes.standaloneWeb.productSurface, 'offline-interview/beta-v41-23');
assert.equal(contract.runtimeModes.androidHost.productSurface, 'SAME_WEB_PRODUCT');
assert.equal(contract.audio.semanticOwner, 'PRODUCT');
assert.equal(contract.audio.asrFailureCannotInvalidateRecordedAudio, true);
assert.equal(contract.audio.recordingMustRemainRetranscribable, true);

for (const forbidden of [
  'advance_question',
  'change_active_question_without_product_command',
  'finalize_human_authoritative_text',
  'create_or_delete_participant',
  'create_or_delete_follow_up',
  'complete_interview'
]) assert.ok(contract.authorities.capability.forbidden.includes(forbidden), `missing capability prohibition: ${forbidden}`);

for (const event of ['TRANSCRIPT_PARTIAL','TRANSCRIPT_FINAL','AUDIO_REFERENCE','AUDIO_HEALTH','ERROR']) {
  assert.ok(contract.events.includes(event), `missing capability event: ${event}`);
}

assert.match(split, /exactly two active streams/i);
assert.match(split, /STREAM PRODUCT \/ WEB APP/);
assert.match(split, /STREAM NATIVE SPEECH CAPABILITY/);
assert.match(split, /Shared boundary — not a third stream/);
assert.match(split, /thin native host/i);

console.log('PASS corrected Offline Interview split: V41.23 Web product protected; native speech is capability-only; shared contract preserves product authority.');

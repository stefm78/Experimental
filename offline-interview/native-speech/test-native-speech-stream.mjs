import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const status = json('offline-interview/native-speech/status.json');
const contract = json('offline-interview/architecture/speech-capability-contract.v1.json');
const stream = read('offline-interview/native-speech/NATIVE_SPEECH_CAPABILITY_V1.md');

assert.equal(status.productSurface, 'offline-interview/beta-v41-23');
assert.equal(status.gates.NATIVE_CAPABILITY_READY, 'HOLD_N1_HOST_BRIDGE_FEASIBILITY');
assert.equal(status.providerEvidence.androidSystemDefault, 'DRAFT_ONLY_PIVOT_CONFIRMED');
assert.equal(contract.runtimeModes.androidHost.productSurface, 'SAME_WEB_PRODUCT');
assert.equal(contract.runtimeModes.androidHost.bridgeMustRejectUntrustedContent, true);
assert.ok(contract.authorities.capability.forbidden.includes('advance_question'));
assert.ok(contract.authorities.capability.forbidden.includes('finalize_human_authoritative_text'));

for (const token of [
  'questionnaire setup',
  'question navigation',
  'participants',
  'question intent/follow-ups',
  'human-final transcript authority',
  'product export UX'
]) assert.match(stream, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

assert.match(stream, /Do not begin another system-default ASR tuning cycle/);
assert.match(stream, /trusted native host\/bridge spike/i);
assert.match(stream, /ASR_PROVIDER_QUALIFIED.*independent/s);

console.log('PASS Native Speech Capability V1: native/device mechanisms are isolated from Web product authority and next gate is a bounded host/bridge spike.');

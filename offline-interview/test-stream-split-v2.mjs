import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));

const v4123Index = read('offline-interview/beta-v41-23/index.html');
const v4123Build = read('offline-interview/beta-v41-23/build-runtime.mjs');
const v4123Test = read('offline-interview/beta-v41-23/test-product-coherence.mjs');
const webShell = read('offline-interview/beta/index.html');
const split = read('offline-interview/architecture/PRODUCT_SPEECH_SPLIT_V2.md');
const contract = json('offline-interview/architecture/transcription-engine-contract.v1.json');

assert.match(v4123Index, /Offline Interview — Beta V41\.23/);
assert.match(v4123Build, /V41\.23 product-coherent runtime generated/);
assert.match(v4123Build, /transcription-engine\.js/);
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

assert.equal(contract.schema, 'offline-interview.transcription-engine-contract.v1');
assert.equal(contract.audio.owner, 'PRODUCT');
assert.equal(contract.audio.engineNeverOwnsAudio, true);
assert.equal(contract.audio.transcriptionFailureCannotInvalidateRecordedAudio, true);
assert.equal(contract.audio.sameAudioMustRemainRetranscribable, true);
assert.equal(contract.humanAuthority.providerTextRole, 'DRAFT');
assert.equal(contract.humanAuthority.humanEditedTextCannotBeSilentlyOverwritten, true);

for (const forbidden of [
  'advance_question',
  'change_active_question',
  'create_or_delete_participant',
  'create_or_delete_follow_up',
  'complete_interview',
  'finalize_human_authoritative_text',
  'delete_or_invalidate_audio_asset'
]) assert.ok(contract.authorities.engine.forbidden.includes(forbidden), `missing engine prohibition: ${forbidden}`);

for (const command of ['GET_TRANSCRIPTION_CAPABILITIES','TRANSCRIBE_FINAL','START_LIVE_DRAFT','STOP_LIVE_DRAFT','CANCEL_TRANSCRIPTION']) {
  assert.ok(contract.commands.includes(command), `missing transcription command: ${command}`);
}
for (const event of ['TRANSCRIPTION_STATUS','TRANSCRIPT_PARTIAL','TRANSCRIPT_FINAL','TRANSCRIPTION_ERROR','PROVIDER_DIAGNOSTIC']) {
  assert.ok(contract.events.includes(event), `missing transcription event: ${event}`);
}

assert.match(split, /exactly two streams/i);
assert.match(split, /STREAM PRODUCT \/ WEB APP/);
assert.match(split, /STREAM TRANSCRIPTION ENGINE/);
assert.match(split, /Shared boundary — not a third stream/);
assert.doesNotMatch(split, /STREAM NATIVE SPEECH CAPABILITY\n/);

console.log('PASS Offline Interview split: V41.23 Product owns interview/audio; Transcription Engine owns AUDIO -> TEXT; provider failure cannot destroy Product state.');

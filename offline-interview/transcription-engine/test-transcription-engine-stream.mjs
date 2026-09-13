import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = p => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));

const contract = json('offline-interview/architecture/transcription-engine-contract.v1.json');
const catalog = json('offline-interview/transcription-engine/provider-catalog.json');
const status = json('offline-interview/transcription-engine/status.json');
const systemStt = read('offline-interview/beta/system-stt.js');

assert.equal(contract.schema, 'offline-interview.transcription-engine-contract.v1');
assert.equal(contract.audio.owner, 'PRODUCT');
assert.equal(contract.audio.engineNeverOwnsAudio, true);
assert.equal(contract.audio.transcriptionFailureCannotInvalidateRecordedAudio, true);
assert.equal(contract.identity.mismatchedTurnResultMustBeRejected, true);
assert.equal(contract.humanAuthority.providerTextRole, 'DRAFT');
assert.equal(contract.humanAuthority.humanEditedTextCannotBeSilentlyOverwritten, true);
assert.equal(contract.humanAuthority.humanLockCannotBeSilentlyOverwritten, true);

for (const forbidden of ['advance_question','change_active_question','create_or_delete_participant','create_or_delete_follow_up','complete_interview','finalize_human_authoritative_text','delete_or_invalidate_audio_asset']) {
  assert.ok(contract.authorities.engine.forbidden.includes(forbidden), `missing engine prohibition: ${forbidden}`);
}
for (const statusName of ['NOT_REQUESTED','PENDING','DRAFT','FINAL','FAILED','UNAVAILABLE']) {
  assert.ok(contract.status.transcription.includes(statusName), `missing transcription status ${statusName}`);
}

const browser = catalog.providers.find(p => p.id === 'browser-system-live');
assert.equal(browser.role, 'LIVE_DRAFT_ONLY');
assert.equal(browser.recordedAudioReplay, false);
const vosk = catalog.providers.find(p => p.id === 'vosk-pcm');
assert.equal(vosk.role, 'REPLAYABLE_DURABLE_CANDIDATE');
assert.equal(vosk.recordedAudioReplay, true);
const whisper = catalog.providers.find(p => p.id === 'whisper-sherpa-pcm');
assert.equal(whisper.role, 'REPLAYABLE_DURABLE_CANDIDATE');

assert.match(systemStt, /export async function detectSystemSpeech/);
assert.match(systemStt, /export function createSystemSpeechSession/);
assert.equal(status.gates.TRANSCRIPTION_PROVIDER_QUALIFIED, 'HOLD_PROVIDER_DECISION_BENCHMARK');
assert.equal(status.gates.WEB_PRODUCT_READY, 'INDEPENDENT_PRODUCT_GATE');

console.log('PASS Transcription Engine stream: AUDIO -> TEXT responsibility isolated; Product audio/human authority protected; replayable-provider gate remains independent.');

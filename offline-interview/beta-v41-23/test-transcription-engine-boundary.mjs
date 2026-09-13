import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'build-runtime.mjs')], { stdio: 'inherit' });

class MockRecognition {
  constructor() { MockRecognition.instance = this; }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}

globalThis.window = { SpeechRecognition: MockRecognition };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const engineUrl = pathToFileURL(path.join(here, 'transcription-engine.js')).href + '?contract-test=1';
const engine = await import(engineUrl);

const caps = await engine.getTranscriptionCapabilities('fr-FR');
assert.equal(caps.providerId, 'browser-system-live');
assert.equal(caps.role, 'LIVE_DRAFT_ONLY');
assert.equal(caps.liveDraft, true);
assert.equal(caps.recordedAudioReplay, false);

const audioAsset = { recordingId: 'rec-1', startMs: 0, endMs: 12000 };
const unavailable = await engine.transcribeFinal({ sessionId: 's1', turnId: 't1', audioAsset });
assert.equal(unavailable.status, 'UNAVAILABLE');
assert.equal(unavailable.audioAsset.recordingId, 'rec-1');
assert.equal(unavailable.turnId, 't1');

const baseTurn = { sessionId: 's1', id: 't1', text: '', humanEdited: false, humanLock: false };
const wrong = engine.applyProviderText(baseTurn, { sessionId: 's1', turnId: 'other', providerId: 'p', text: 'mauvais tour', status: 'DRAFT' });
assert.equal(wrong.applied, false);
assert.equal(wrong.reason, 'scope-mismatch');

const applied = engine.applyProviderText(baseTurn, { sessionId: 's1', turnId: 't1', providerId: 'p', text: 'texte fournisseur', status: 'DRAFT' });
assert.equal(applied.applied, true);
assert.equal(applied.turn.text, 'texte fournisseur');
assert.equal(applied.turn.transcriptionStatus, 'DRAFT');

const human = engine.applyProviderText({ ...baseTurn, humanEdited: true, text: 'texte humain' }, { sessionId: 's1', turnId: 't1', providerId: 'p', text: 'écrasement interdit', status: 'DRAFT' });
assert.equal(human.applied, false);
assert.equal(human.reason, 'human-authority');
assert.equal(human.turn.text, 'texte humain');

const session = engine.createSystemSpeechSession({ mode: 'standard', lang: 'fr-FR' });
assert.ok(session, 'system live-draft provider must be connected behind the engine port');
assert.equal(session.start(), true);
session.stop();

console.log('PASS transcription engine boundary: live provider connected, saved-audio failure explicit, turn scope isolated, human truth protected.');

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};

class MockRecognition {
  static instance = null;
  constructor() {
    MockRecognition.instance = this;
    this.lang = 'fr-FR';
    this.continuous = true;
    this.interimResults = true;
    this.maxAlternatives = 1;
  }
  start() { this.onstart?.(); }
  stop() {}
  abort() {}
  emit(results, resultIndex = 0) {
    this.onresult?.({ resultIndex, results });
  }
}

globalThis.window = { SpeechRecognition: MockRecognition };

const { createSystemSpeechSession } = await import('./system-stt.js?boundary-test=1');

const asResult = (text, isFinal = false) => ({ 0: { transcript: text }, isFinal });
const session = createSystemSpeechSession({ mode: 'local', lang: 'fr-FR' });
assert.ok(session, 'system speech session should be created');
assert.equal(session.start(), true);
const recognition = MockRecognition.instance;

// Speaker A is still interim when the click occurs.
recognition.emit([asResult('bonjour testeur', false)]);
const first = session.takeSegment({ settleTimeoutMs: 1000 });
assert.equal(first.text, 'bonjour testeur');
assert.equal(first.pendingCount, 1);

// Chromium delivers A's missing tail only after the click, then starts speaker B on a new index.
recognition.emit([
  asResult('bonjour testeur volcan', true),
  asResult('bonjour participant', false)
], 0);
const firstSettled = await first.settled;
assert.equal(firstSettled.text, 'bonjour testeur volcan');
assert.equal(firstSettled.timedOut, false);
assert.equal(session.snapshot().text, 'bonjour participant');
assert.ok(!session.snapshot().text.includes('volcan'), 'late A tail must not leak into B');

// Repeat in the opposite direction to prove the ownership rule is reusable.
const second = session.takeSegment({ settleTimeoutMs: 1000 });
assert.equal(second.text, 'bonjour participant');
assert.equal(second.pendingCount, 1);
recognition.emit([
  asResult('bonjour testeur volcan', true),
  asResult('bonjour participant rivière', true),
  asResult('retour testeur', false)
], 1);
const secondSettled = await second.settled;
assert.equal(secondSettled.text, 'bonjour participant rivière');
assert.equal(session.snapshot().text, 'retour testeur');
assert.ok(!session.snapshot().text.includes('rivière'), 'late B tail must not leak back into A');

const calibration = session.calibration();
assert.ok(calibration.sampleCount >= 2, 'successful handoffs should feed local calibration');
assert.ok(calibration.timeoutMs >= 650 && calibration.timeoutMs <= 2200);

console.log('PASS system-stt adaptive semantic boundary ownership');

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
    this.startCount = 0;
  }
  start() { this.startCount += 1; this.onstart?.(); }
  stop() { this.stopCalled = true; }
  abort() { this.abortCalled = true; this.onend?.(); }
  emit(results, resultIndex = 0) { this.onresult?.({ resultIndex, results }); }
  end() { this.onend?.(); }
}

globalThis.window = { SpeechRecognition: MockRecognition };
const { createSystemSpeechSession } = await import('./system-stt.js?hard-cut-test=1');
const asResult = (text, isFinal = false) => ({ 0: { transcript: text }, isFinal });

const session = createSystemSpeechSession({ mode: 'standard', lang: 'fr-FR' });
assert.ok(session);
assert.equal(session.start(), true);
const recognition = MockRecognition.instance;

// Speaker A is still interim at the click.
recognition.emit([asResult('la phrase du testeur se', false)]);
const cut = session.cutSegment();
assert.ok(cut, 'hard cut must start');
assert.equal(recognition.stopCalled, true, 'hard cut must stop the current recognition session');

// Critical field case: Chrome emits the missing tail AFTER the click as a NEW result index.
// V28 could not own this correctly because that index did not exist at click time.
recognition.emit([
  asResult('la phrase du testeur se', true),
  asResult('termine par volcan', true)
], 1);
recognition.end();

const settled = await cut.settled;
assert.equal(settled.text, 'la phrase du testeur se termine par volcan');
const ready = await cut.ready;
assert.equal(ready.ready, true);
assert.ok(recognition.startCount >= 2, 'recognition must restart for the next speaker');

// New speaker starts from a fresh recognition namespace: no old tail can leak.
recognition.emit([asResult('la phrase du participant commence ici', false)]);
assert.equal(session.snapshot().text, 'la phrase du participant commence ici');
assert.ok(!session.snapshot().text.includes('volcan'));

// Repeat once to prove the cut is reusable.
const cut2 = session.cutSegment();
recognition.emit([
  asResult('la phrase du participant commence ici', true),
  asResult('et finit par rivière', true)
], 1);
recognition.end();
const settled2 = await cut2.settled;
assert.equal(settled2.text, 'la phrase du participant commence ici et finit par rivière');
await cut2.ready;
recognition.emit([asResult('retour propre au testeur', false)]);
assert.equal(session.snapshot().text, 'retour propre au testeur');
assert.ok(!session.snapshot().text.includes('rivière'));

const calibration = session.calibration();
assert.ok(calibration.hardCut.sampleCount >= 2, 'hard-cut restart timings must feed automatic calibration');
console.log('PASS system-stt hard recognition handoff');

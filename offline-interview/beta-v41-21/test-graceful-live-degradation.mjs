import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const shim = fs.readFileSync(new URL('./speech-network-failfast.js', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('./product-policy.js', import.meta.url), 'utf8');
const decision = fs.readFileSync(new URL('./DECISION.md', import.meta.url), 'utf8');

for (const token of [
  "./speech-network-failfast.js?v=41.21",
  "../beta/app.js?v=41.15",
  "./product-policy.js?v=41.21",
  'Beta V41.21'
]) {
  if (!html.includes(token)) throw new Error(`missing V41.21 shell token: ${token}`);
}

if (html.indexOf('speech-network-failfast.js') > html.indexOf('../beta/app.js')) {
  throw new Error('network fail-fast shim must load before the product runtime');
}

for (const token of [
  "event?.error !== 'network'",
  'blockedAfterNetworkFailure = true',
  'SpeechRecognition disabled for this page after a network failure',
  'offline-interview-stt-degraded'
]) {
  if (!shim.includes(token)) throw new Error(`missing fail-fast token: ${token}`);
}

for (const token of [
  '.turn-retranscribe-button',
  'saved-audio-unqualified',
  'Transcription en direct indisponible pour cette prise',
  "error.classList.remove('error')",
  "error.classList.add('capture-integrity-alert')"
]) {
  if (!policy.includes(token)) throw new Error(`missing graceful policy token: ${token}`);
}

for (const forbidden of ['setInterval(', 'qualityRetranscription', 'automaticQuality', 'whisper-base', 'pipeline(']) {
  if (shim.includes(forbidden) || policy.includes(forbidden)) throw new Error(`unexpected machinery in V41.21: ${forbidden}`);
}

if (!decision.includes('Remain on the main product path')) throw new Error('missing main-path decision');
if (!decision.includes('Production/root is unchanged')) throw new Error('missing production guard');

console.log('Offline Interview V41.21 graceful LIVE degradation contract PASS');

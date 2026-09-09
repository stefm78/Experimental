import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('./simple-product-policy.js', import.meta.url), 'utf8');
const decision = fs.readFileSync(new URL('./REINTEGRATION_DECISION.md', import.meta.url), 'utf8');

for (const token of [
  "../beta/app.js?v=41.15",
  "./simple-product-policy.js?v=41.20",
  'Beta V41.20'
]) {
  if (!html.includes(token)) throw new Error(`missing V41.20 shell token: ${token}`);
}

for (const forbidden of [
  'quality-controller.js',
  'beta-v41-17',
  'beta-v41-18',
  'beta-v41-19'
]) {
  if (html.includes(forbidden)) throw new Error(`forbidden secondary-quality import: ${forbidden}`);
}

for (const token of [
  '.turn-retranscribe-button',
  'button.hidden = true',
  'saved-audio-unqualified',
  'LIVE-first'
]) {
  if (!policy.includes(token)) throw new Error(`missing simple policy token: ${token}`);
}

for (const forbidden of ['setInterval(', 'qualityRetranscription', 'automaticQuality', 'PASS_STRICT']) {
  if (policy.includes(forbidden)) throw new Error(`unexpected quality machinery in simple policy: ${forbidden}`);
}

if (!decision.includes('Exit the STT mechanism exploration loop')) throw new Error('missing trajectory decision');
if (!decision.includes('No production promotion is authorized')) throw new Error('missing promotion guard');

console.log('Offline Interview V41.20 simple-live reintegration contract PASS');

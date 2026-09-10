import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'build-runtime.mjs')], { stdio: 'inherit' });

const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const policy = fs.readFileSync(path.join(here, 'product-policy.js'), 'utf8');
const failfast = fs.readFileSync(path.join(here, 'speech-network-failfast.js'), 'utf8');
const sw = fs.readFileSync(path.join(here, 'sw.js'), 'utf8');

for (const token of [
  "2026-09-10.interview-runtime-v41.22",
  'function turnHasAnswerEvidence(turn)',
  'recordingAudioUsable(ref.recordingId)',
]) if (!app.includes(token)) throw new Error(`missing V41.22 runtime token: ${token}`);

const evidenceUses = (app.match(/turnHasAnswerEvidence\(t\)/g) || []).length;
if (evidenceUses !== 3) throw new Error(`expected 3 answer-evidence consumers, got ${evidenceUses}`);
if (app.includes("t.type === 'answer' && cleanText(t.text)")) throw new Error('text-only answer semantics remain in V41.22 runtime');

for (const token of ['./app.js?v=41.22', './speech-network-failfast.js?v=41.22', './product-policy.js?v=41.22', './shell.html', './styles.css?v=41.22']) {
  if (!html.includes(token)) throw new Error(`missing V41.22 local boot asset: ${token}`);
}
for (const forbidden of ['../beta/app.js', '../beta/index.html', '../beta/styles.css']) {
  if (html.includes(forbidden)) throw new Error(`V41.22 boot still depends on shared beta surface: ${forbidden}`);
}

const requiredRuntimeFiles = [
  'app.js', 'shell.html', 'system-stt.js', 'audio-window.js', 'direct-interview-link.js',
  'whisper-quality.js', 'sw.js', 'interview.json', 'manifest.webmanifest', 'icon.svg',
  'styles.css', 'INTERVIEW_FORMAT.md', 'INTERVIEW_AUTHORING_KIT.md', 'interview-spec.schema.json'
];
for (const name of requiredRuntimeFiles) {
  if (!fs.existsSync(path.join(here, name))) throw new Error(`missing generated V41.22 runtime dependency: ${name}`);
}
for (const importPath of ['./system-stt.js', './audio-window.js', './direct-interview-link.js', './whisper-quality.js']) {
  if (!app.includes(`from '${importPath}'`)) throw new Error(`unexpected V41.22 module dependency shape: ${importPath}`);
}
if (!sw.includes("const VERSION = 'offline-interview-v41.22';")) throw new Error('V41.22 service worker cache namespace not isolated');
if (!sw.includes("'./direct-interview-link.js'")) throw new Error('V41.22 service worker does not cache direct interview dependency');

if (!policy.includes('audio authoritative; LIVE best-effort; answer evidence includes valid audio')) throw new Error('missing V41.22 product policy');
if (!failfast.includes('blockedAfterNetworkFailure = true')) throw new Error('validated network fail-stop behavior not carried forward');

const evidence = (turn, validAudio = new Set()) => {
  if (!turn || turn.type !== 'answer') return false;
  if (String(turn.text || '').trim()) return true;
  const ref = turn.audioRef;
  return Boolean(ref?.recordingId) && Number(ref.endMs) > Number(ref.startMs) && validAudio.has(ref.recordingId);
};
const valid = new Set(['r1']);
if (!evidence({ type:'answer', text:'bonjour', audioRef:null }, valid)) throw new Error('text answer must count');
if (!evidence({ type:'answer', text:'', audioRef:{ recordingId:'r1', startMs:0, endMs:5529 } }, valid)) throw new Error('valid audio-only answer must count');
if (evidence({ type:'answer', text:'', audioRef:{ recordingId:'bad', startMs:0, endMs:5529 } }, valid)) throw new Error('invalid audio must not count');
if (evidence({ type:'answer', text:'', audioRef:null }, valid)) throw new Error('empty answer without audio must not count');

console.log('Offline Interview V41.22 self-contained boot + core stabilization contract PASS');

// While V41.23 is the immediate successor candidate, keep its qualification coupled to
// the existing workflow step so deployment cannot publish it without its own contract.
const successorTest = path.resolve(here, '../beta-v41-23/test-product-coherence.mjs');
if (fs.existsSync(successorTest)) execFileSync(process.execPath, [successorTest], { stdio: 'inherit' });

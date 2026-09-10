import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'build-runtime.mjs')], { stdio: 'inherit' });

const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const shell = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
const styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');
const failfast = fs.readFileSync(path.join(here, 'speech-network-failfast.js'), 'utf8');
const sw = fs.readFileSync(path.join(here, 'sw.js'), 'utf8');

for (const token of [
  "2026-09-10.interview-runtime-v41.23",
  'function turnHasAnswerEvidence(turn)',
  'recordingAudioUsable(ref.recordingId)',
  'transcriptionFallback: null',
  'Transcription en direct indisponible pour cette prise',
]) if (!app.includes(token)) throw new Error(`missing V41.23 runtime token: ${token}`);

if (app.includes("transcriptionFallback: 'whisper-local'")) throw new Error('obsolete Whisper fallback provenance remains');
if (shell.includes('Préparer Whisper de secours')) throw new Error('obsolete Whisper preparation CTA remains visible');
if (!shell.includes('transcrite en direct lorsque le navigateur le permet')) throw new Error('privacy/transcription copy is not best-effort accurate');
if (!styles.includes('.turn-retranscribe-button{display:none!important}')) throw new Error('unqualified saved-audio action remains visible');
if (!failfast.includes('blockedAfterNetworkFailure = true')) throw new Error('network fail-stop lost');
if (!sw.includes("offline-interview-v41.23")) throw new Error('V41.23 service-worker namespace missing');
for (const token of ['./shell.html','./app.js?v=41.23','./speech-network-failfast.js?v=41.23']) {
  if (!html.includes(token)) throw new Error(`missing V41.23 local boot token: ${token}`);
}
for (const file of ['system-stt.js','audio-window.js','direct-interview-link.js','whisper-quality.js','interview.json','manifest.webmanifest','icon.svg','styles.css','sw.js']) {
  if (!fs.existsSync(path.join(here, file))) throw new Error(`missing V41.23 local dependency: ${file}`);
}

console.log('Offline Interview V41.23 product coherence contract PASS');

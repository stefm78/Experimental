import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
const shell = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
const styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');

for (const token of [
  "2026-09-10.interview-runtime-v41.23",
  'ui.startBtn.addEventListener',
  'ui.freeStartBtn?.addEventListener',
  'resumeInterview',
  'resolveDirectInterviewLink',
  'replayTurnAudio',
  'completeInterview',
  'exportTxt',
  'exportJson',
  'turnHasAnswerEvidence',
  'transcriptionFallback: null',
]) assert.ok(app.includes(token), `missing product-readiness contract token: ${token}`);

assert.ok(styles.includes('.turn-retranscribe-button{display:none!important}'), 'saved-audio retranscription must remain outside qualified product surface');
assert.ok(shell.includes('La voix est transcrite en direct lorsque le navigateur le permet.'), 'setup copy must describe LIVE as browser-dependent');
assert.ok(!shell.includes('Préparer Whisper de secours'), 'obsolete Whisper CTA must not be visible');
assert.ok(!shell.includes('La voix est transcrite automatiquement.'), 'setup must not promise universal automatic transcription');

console.log('Offline Interview V41.23 product-readiness contract PASS');

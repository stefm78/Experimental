import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const beta = path.resolve(here, '../beta');
const sourcePath = path.join(beta, 'app.js');
const outputPath = path.join(here, 'app.js');
let source = fs.readFileSync(sourcePath, 'utf8');

const replaceExactly = (needle, replacement, expectedCount, label) => {
  const count = source.split(needle).length - 1;
  if (count !== expectedCount) throw new Error(`${label}: expected ${expectedCount} occurrence(s), got ${count}`);
  source = source.split(needle).join(replacement);
};

replaceExactly(
  "const BUILD_ID = '2026-09-08.interview-runtime-v41.15';",
  "const BUILD_ID = '2026-09-10.interview-runtime-v41.22';",
  1,
  'build identity'
);

replaceExactly(
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }",
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }\nfunction turnHasAnswerEvidence(turn) {\n  if (!turn || turn.type !== 'answer') return false;\n  if (cleanText(turn.text)) return true;\n  const ref = turn.audioRef;\n  return Boolean(ref?.recordingId) && Number(ref.endMs) > Number(ref.startMs) && recordingAudioUsable(ref.recordingId);\n}",
  1,
  'answer evidence predicate'
);

replaceExactly(
  "t.type === 'answer' && cleanText(t.text)",
  "turnHasAnswerEvidence(t)",
  3,
  'answer evidence consumers'
);

fs.writeFileSync(outputPath, source);

// V41.22 is a self-contained deployment surface. The app module keeps relative imports,
// so every runtime dependency it resolves must exist beside app.js at deploy time.
const copyFiles = [
  'system-stt.js',
  'audio-window.js',
  'direct-interview-link.js',
  'whisper-quality.js',
  'interview.json',
  'manifest.webmanifest',
  'icon.svg',
  'styles.css',
  'INTERVIEW_FORMAT.md',
  'INTERVIEW_AUTHORING_KIT.md',
  'interview-spec.schema.json'
];
for (const name of copyFiles) fs.copyFileSync(path.join(beta, name), path.join(here, name));

// Keep the visual shell local as well. It is parsed for <main class="shell"> only;
// its own scripts are never executed by the V41.22 bootstrap.
fs.copyFileSync(path.join(beta, 'index.html'), path.join(here, 'shell.html'));

// Give V41.22 its own service-worker scope and cache namespace rather than registering
// the V41.15 worker against a directory whose assets do not exist.
let sw = fs.readFileSync(path.join(beta, 'sw.js'), 'utf8');
sw = sw.replace("const VERSION = 'offline-interview-v41.15';", "const VERSION = 'offline-interview-v41.22';");
sw = sw.replace("'./', './index.html', './styles.css?v=41.15', './app.js?v=41.15', './system-stt.js', './audio-window.js', './whisper-quality.js',", "'./', './index.html', './shell.html', './styles.css?v=41.22', './app.js?v=41.22', './system-stt.js', './audio-window.js', './direct-interview-link.js', './whisper-quality.js',");
fs.writeFileSync(path.join(here, 'sw.js'), sw);

console.log(`V41.22 self-contained runtime generated: ${outputPath}`);

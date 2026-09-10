import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../beta/app.js');
const outputPath = path.resolve(here, './app.js');
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
console.log(`V41.22 runtime generated: ${outputPath}`);

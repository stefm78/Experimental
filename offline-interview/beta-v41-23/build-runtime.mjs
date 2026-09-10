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
  "const BUILD_ID = '2026-09-10.interview-runtime-v41.23';",
  1,
  'build identity'
);

replaceExactly(
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }",
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }\nfunction turnHasAnswerEvidence(turn) {\n  if (!turn || turn.type !== 'answer') return false;\n  if (cleanText(turn.text)) return true;\n  const ref = turn.audioRef;\n  return Boolean(ref?.recordingId) && Number(ref.endMs) > Number(ref.startMs) && recordingAudioUsable(ref.recordingId);\n}",
  1,
  'answer evidence predicate'
);
replaceExactly("t.type === 'answer' && cleanText(t.text)", "turnHasAnswerEvidence(t)", 3, 'answer evidence consumers');

// Product truth: saved-audio browser retranscription is not a qualified fallback.
replaceExactly("transcriptionFallback: 'whisper-local',", "transcriptionFallback: null,", 1, 'export provenance fallback');
replaceExactly(
  "La transcription système n’a rien renvoyé. L’audio est conservé : vous pourrez le réécouter et relancer la transcription système après l’entretien.",
  "Transcription en direct indisponible pour cette prise. L’audio a bien été enregistré : vous pouvez continuer l’entretien et le réécouter.",
  1,
  'calm live degradation copy'
);
replaceExactly("Système local · Whisper uniquement manuel", "Système local", 1, 'local status copy');
replaceExactly("Audio seul · Whisper manuel prêt", "Audio seul · transcription en direct indisponible", 1, 'audio-only status copy');
replaceExactly("Système indisponible · aucun Whisper automatique", "Transcription en direct indisponible", 1, 'diagnostic status copy');

fs.writeFileSync(outputPath, source);

const copyFiles = [
  'system-stt.js', 'audio-window.js', 'direct-interview-link.js', 'whisper-quality.js',
  'interview.json', 'manifest.webmanifest', 'icon.svg', 'styles.css',
  'INTERVIEW_FORMAT.md', 'INTERVIEW_AUTHORING_KIT.md', 'interview-spec.schema.json'
];
for (const name of copyFiles) fs.copyFileSync(path.join(beta, name), path.join(here, name));

let shell = fs.readFileSync(path.join(beta, 'index.html'), 'utf8');
shell = shell.replace(
  'La voix est transcrite automatiquement. Le texte et l’audio de la session restent localement dans ce navigateur ; l’audio peut être supprimé depuis l’écran de fin.',
  'La voix est transcrite en direct lorsque le navigateur le permet. L’audio de la session reste localement dans ce navigateur et peut être réécouté ou supprimé depuis l’écran de fin.'
);
shell = shell.replace(
  '<button id="prepareBtn" class="ghost small">Préparer Whisper de secours</button>',
  '<button id="prepareBtn" class="ghost small" hidden aria-hidden="true">Préparer le moteur local</button>'
);
fs.writeFileSync(path.join(here, 'shell.html'), shell);

let styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');
styles += '\n/* V41.23: saved-audio browser retranscription is intentionally outside the qualified product surface. */\n.turn-retranscribe-button{display:none!important}\n';
fs.writeFileSync(path.join(here, 'styles.css'), styles);

let sw = fs.readFileSync(path.join(beta, 'sw.js'), 'utf8');
sw = sw.replace("const VERSION = 'offline-interview-v41.15';", "const VERSION = 'offline-interview-v41.23';");
sw = sw.replace("'./', './index.html', './styles.css?v=41.15', './app.js?v=41.15', './system-stt.js', './audio-window.js', './whisper-quality.js',", "'./', './index.html', './shell.html', './styles.css?v=41.23', './app.js?v=41.23', './system-stt.js', './audio-window.js', './direct-interview-link.js', './whisper-quality.js',");
fs.writeFileSync(path.join(here, 'sw.js'), sw);

console.log(`V41.23 product-coherent runtime generated: ${outputPath}`);

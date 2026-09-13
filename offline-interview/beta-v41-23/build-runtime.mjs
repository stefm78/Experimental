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
  "import { detectSystemSpeech, createSystemSpeechSession } from './system-stt.js';",
  "import { detectSystemSpeech, createSystemSpeechSession } from './transcription-engine.js';",
  1,
  'transcription engine port'
);

replaceExactly(
  "const BUILD_ID = '2026-09-08.interview-runtime-v41.15';",
  "const BUILD_ID = '2026-09-13.interview-runtime-v41.23-android-host-native-draft1-candidate';",
  1,
  'build identity'
);

replaceExactly(
  "let recordingQuestionId = null;\nlet queuedSpeakerId = null;",
  "let recordingQuestionId = null;\nlet recordingTurnId = null;\nlet queuedSpeakerId = null;",
  1,
  'pre-capture Product turn identity'
);

replaceExactly(
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }",
  "function recordingAudioUsable(recordingId) { return Boolean(recordingId) && recordingIntegrity(recordingId)?.status !== 'invalid'; }\nfunction turnHasAnswerEvidence(turn) {\n  if (!turn || turn.type !== 'answer') return false;\n  if (cleanText(turn.text)) return true;\n  const ref = turn.audioRef;\n  return Boolean(ref?.recordingId) && Number(ref.endMs) > Number(ref.startMs) && recordingAudioUsable(ref.recordingId);\n}",
  1,
  'answer evidence predicate'
);
replaceExactly("t.type === 'answer' && cleanText(t.text)", "turnHasAnswerEvidence(t)", 3, 'answer evidence consumers');

replaceExactly(
  "function createTurn({ type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, audioRef = null, followUpId = null, followUpKind = null }) {",
  "function createTurn({ turnId = null, type = 'answer', speakerId, text, source = 'keyboard', rawTranscript = null, durationSeconds = 0, audioRef = null, followUpId = null, followUpKind = null }) {",
  1,
  'turn id input'
);
replaceExactly(
  "  return {\n    id: uuid('turn'),\n    type,",
  "  return {\n    id: turnId || uuid('turn'),\n    sessionId: session?.id || null,\n    type,",
  1,
  'Product-owned turn id'
);
replaceExactly(
  "    rawTranscript: rawTranscript == null ? null : String(rawTranscript),\n    durationSeconds:",
  "    rawTranscript: rawTranscript == null ? null : String(rawTranscript),\n    transcriptionStatus: type === 'answer' ? (cleanText(text) ? (/system|speech|whisper|android-native/.test(source || '') ? 'DRAFT' : 'NOT_REQUESTED') : (audioRef?.recordingId ? 'UNAVAILABLE' : 'NOT_REQUESTED')) : null,\n    transcriptionProviderId: source === 'android-native-draft' ? 'ANDROID_SYSTEM_DEFAULT_V3_DRAFT' : (/system/.test(source || '') ? 'browser-system-live' : null),\n    durationSeconds:",
  1,
  'turn transcription state'
);

replaceExactly(
  "async function appendAnswerTurn({ questionId, speakerId, text, source, rawTranscript = null, durationSeconds = 0, audioRef = null }) {",
  "async function appendAnswerTurn({ turnId = null, questionId, speakerId, text, source, rawTranscript = null, durationSeconds = 0, audioRef = null }) {",
  1,
  'append answer turn identity'
);
replaceExactly(
  "  if (last && last.speakerId === speakerId) {",
  "  if (last && last.speakerId === speakerId && (!turnId || last.id === turnId)) {",
  1,
  'prevent cross-turn draft deduplication'
);
replaceExactly(
  "  response.turns.push(createTurn({\n    type: 'answer',",
  "  response.turns.push(createTurn({\n    turnId,\n    type: 'answer',",
  1,
  'persist answer turn identity'
);
replaceExactly(
  "async function appendAudioOnlyTurn({ questionId, speakerId, durationSeconds = 0, audioRef = null, source = 'audio-system-pending', rawTranscript = null }) {",
  "async function appendAudioOnlyTurn({ turnId = null, questionId, speakerId, durationSeconds = 0, audioRef = null, source = 'audio-system-pending', rawTranscript = null }) {",
  1,
  'audio-only turn identity'
);
replaceExactly(
  "response.turns.push(createTurn({ type: 'answer', speakerId, text: '', source, rawTranscript, durationSeconds, audioRef }));",
  "response.turns.push(createTurn({ turnId, type: 'answer', speakerId, text: '', source, rawTranscript, durationSeconds, audioRef }));",
  1,
  'persist audio-only turn identity'
);

replaceExactly(
  "    recordingSpeakerId = speakerId;\n    recordingQuestionId = questionId;\n    recordingCaptureId = uuid('capture');",
  "    recordingSpeakerId = speakerId;\n    recordingQuestionId = questionId;\n    recordingTurnId = uuid('turn');\n    recordingCaptureId = uuid('capture');",
  1,
  'create turn before capture/provider start'
);
replaceExactly(
  "    systemSpeechSession = createSystemSpeechSession({\n      lang: interview?.language || 'fr-FR',",
  "    systemSpeechSession = createSystemSpeechSession({\n      sessionId: session?.id,\n      turnId: recordingTurnId,\n      lang: interview?.language || 'fr-FR',",
  1,
  'scope provider start with Product identity'
);

replaceExactly(
  "  const speakerId = recordingSpeakerId;\n  const questionId = recordingQuestionId;\n  const durationSeconds = composerDurationSeconds;",
  "  const speakerId = recordingSpeakerId;\n  const questionId = recordingQuestionId;\n  const turnId = recordingTurnId;\n  recordingTurnId = null;\n  const durationSeconds = composerDurationSeconds;",
  1,
  'capture finalized turn identity'
);
replaceExactly(
  "      await appendAnswerTurn({\n        questionId,\n        speakerId,\n        text,",
  "      await appendAnswerTurn({\n        turnId,\n        questionId,\n        speakerId,\n        text,",
  1,
  'final transcript keeps capture turn id'
);
replaceExactly(
  "      await appendAudioOnlyTurn({\n        questionId,\n        speakerId,",
  "      await appendAudioOnlyTurn({\n        turnId,\n        questionId,\n        speakerId,",
  1,
  'audio-only answer keeps capture turn id'
);

replaceExactly(
  "  const previousSpeakerId = recordingSpeakerId;\n  const previousQuestionId = recordingQuestionId;\n  const recordingId = recordingCaptureId;",
  "  const previousSpeakerId = recordingSpeakerId;\n  const previousQuestionId = recordingQuestionId;\n  const previousTurnId = recordingTurnId;\n  const nextTurnId = uuid('turn');\n  const recordingId = recordingCaptureId;",
  1,
  'semantic boundary turn identities'
);
replaceExactly(
  "  const cut = systemSpeechSession.takeSegment();",
  "  const cut = systemSpeechSession.takeSegment({ sessionId: session?.id, turnId: nextTurnId });",
  1,
  'browser boundary receives next Product scope'
);
replaceExactly(
  "  recordingSpeakerId = nextSpeakerId;\n  recordingQuestionId = nextQuestionId;",
  "  recordingSpeakerId = nextSpeakerId;\n  recordingQuestionId = nextQuestionId;\n  recordingTurnId = nextTurnId;",
  1,
  'advance Product turn identity at boundary'
);
replaceExactly(
  "      await appendAnswerTurn({\n        questionId: previousQuestionId,\n        speakerId: previousSpeakerId,",
  "      await appendAnswerTurn({\n        turnId: previousTurnId,\n        questionId: previousQuestionId,\n        speakerId: previousSpeakerId,",
  1,
  'boundary transcript keeps previous turn id'
);
replaceExactly(
  "    await appendAudioOnlyTurn({\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,",
  "    await appendAudioOnlyTurn({\n      turnId: previousTurnId,\n      questionId: previousQuestionId,\n      speakerId: previousSpeakerId,",
  1,
  'boundary audio keeps previous turn id'
);

replaceExactly(
  "function systemSpeechLabel() {\n  if (systemSpeechCapability.mode === 'local') return 'Système local';",
  "function systemSpeechLabel() {\n  if (systemSpeechCapability.mode === 'android-native-draft') return 'Android natif · brouillon';\n  if (systemSpeechCapability.mode === 'local') return 'Système local';",
  1,
  'Android provider label'
);
replaceExactly(
  "function refreshSttStatus() {\n  if (systemSpeechCapability.mode === 'local') {",
  "function refreshSttStatus() {\n  if (systemSpeechCapability.mode === 'android-native-draft') {\n    ui.modelStatus.textContent = 'Automatique · Android natif (brouillon)';\n    if (ui.diagStt) ui.diagStt.textContent = 'ANDROID_SYSTEM_DEFAULT_V3_DRAFT · LIVE_DRAFT_ONLY';\n    return;\n  }\n  if (systemSpeechCapability.mode === 'local') {",
  1,
  'Android provider status'
);
replaceExactly(
  "    let source = systemSnapshot.mode === 'local' ? 'system-local' : 'system';",
  "    let source = systemSnapshot.mode === 'android-native-draft' ? 'android-native-draft' : (systemSnapshot.mode === 'local' ? 'system-local' : 'system');",
  1,
  'turn provider source'
);

replaceExactly(
  "          rawTranscript: turn.rawTranscript,\n          durationSeconds:",
  "          rawTranscript: turn.rawTranscript,\n          transcriptionStatus: turn.transcriptionStatus || null,\n          transcriptionProviderId: turn.transcriptionProviderId || null,\n          durationSeconds:",
  1,
  'export transcription state'
);

// Product truth: saved-audio replay is not yet a qualified fallback for either live provider.
replaceExactly("transcriptionDefault: 'system',", "transcriptionDefault: 'transcription-engine-live-draft',", 1, 'export provenance provider port');
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
  'La voix est transcrite en direct lorsque le navigateur le permet. Dans l’APK Android, le brouillon utilise le moteur natif Android. L’audio de la session reste sous l’autorité du produit.'
);
shell = shell.replace(
  '<button id="prepareBtn" class="ghost small">Préparer Whisper de secours</button>',
  '<button id="prepareBtn" class="ghost small" hidden aria-hidden="true">Préparer le moteur local</button>'
);
fs.writeFileSync(path.join(here, 'shell.html'), shell);

let styles = fs.readFileSync(path.join(here, 'styles.css'), 'utf8');
styles += '\n/* V41.23 host candidate: saved-audio retranscription remains outside the qualified surface. */\n.turn-retranscribe-button{display:none!important}\n';
fs.writeFileSync(path.join(here, 'styles.css'), styles);

let sw = fs.readFileSync(path.join(beta, 'sw.js'), 'utf8');
sw = sw.replace("const VERSION = 'offline-interview-v41.15';", "const VERSION = 'offline-interview-v41.23-android-host-native-draft1';");
sw = sw.replace("'./', './index.html', './styles.css?v=41.15', './app.js?v=41.15', './system-stt.js', './audio-window.js', './whisper-quality.js',", "'./', './index.html', './shell.html', './styles.css?v=41.23', './app.js?v=41.23', './transcription-engine.js', './system-stt.js', './audio-window.js', './direct-interview-link.js', './whisper-quality.js',");
fs.writeFileSync(path.join(here, 'sw.js'), sw);

console.log(`V41.23 Android-host candidate runtime generated: ${outputPath}`);

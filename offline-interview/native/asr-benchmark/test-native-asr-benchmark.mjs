import fs from 'node:fs';
import assert from 'node:assert/strict';
import { score, normalizeForWer } from './score-native-asr.mjs';

const corpus = JSON.parse(fs.readFileSync(new URL('./fr-FR-v1.json', import.meta.url), 'utf8'));
const repo = new URL('../../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, repo), 'utf8');
const activity = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkActivity.kt');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');

assert.equal(corpus.schema, 'offline-interview.native-asr-benchmark-corpus.v1');
assert.equal(corpus.id, 'fr-FR-v1');
assert.equal(corpus.language, 'fr-FR');
assert.equal(corpus.status, 'FROZEN');
assert.equal(corpus.passages.length, 6);
assert.deepEqual(corpus.passages.map(p => p.level), [1,2,3,4,5,6]);
assert.deepEqual(corpus.passages.map(p => p.category), [
  'french_everyday','numbers_dates','proper_nouns','technical_vocabulary','complex_speech','product_stress'
]);
const wordCount = corpus.passages.reduce((n,p)=>n+normalizeForWer(p.reference,corpus).split(' ').length,0);
assert.ok(wordCount >= 250 && wordCount <= 350, `frozen corpus should be 250-350 normalized words, got ${wordCount}`);

const perfect = {passages: corpus.passages.map(p=>({id:p.id,hypothesis:p.reference,finalCount:1,errorCode:null}))};
const perfectScore = score(corpus, perfect);
assert.equal(perfectScore.aggregate.verdict, 'PASS_NATIVE_ASR');
assert.equal(perfectScore.aggregate.globalWer, 0);
assert.equal(perfectScore.aggregate.criticalEntityAccuracy, 1);

const failed = {passages: corpus.passages.map(p=>({id:p.id,hypothesis:'',finalCount:0,errorCode:7}))};
const failedScore = score(corpus, failed);
assert.equal(failedScore.aggregate.verdict, 'FAIL_NATIVE_ASR');
assert.equal(failedScore.aggregate.completedFinalPassages, 0);

assert.equal(
  normalizeForWer('Le rendez-vous est le dix-sept septembre deux mille vingt-six à quatorze heures trente-cinq.', corpus),
  normalizeForWer('Le rendez-vous est le 17 septembre 2026 à 14 h 35.', corpus),
  'number/date aliases must normalize equivalent spoken/surface forms'
);

assert.match(manifest, /\.NativeAsrBenchmarkActivity/);
assert.match(manifest, /00 Native ASR Benchmark/);
assert.match(gradle, /versionCode\s*=\s*15/);
assert.match(gradle, /0\.6\.0-native-asr-benchmark-tactical/);
assert.match(gradle, /assets\.srcDir\("\.\.\/\.\.\/asr-benchmark"\)/);
assert.doesNotMatch(gradle, /vosk|sherpa|whisper/i, 'native benchmark must not embed alternate ASR engines');
assert.match(activity, /SpeechRecognizer\.createSpeechRecognizer/);
assert.match(activity, /RecognizerIntent\.LANGUAGE_MODEL_FREE_FORM/);
assert.match(activity, /EXTRA_LANGUAGE/);
assert.match(activity, /EXTRA_PARTIAL_RESULTS/);
assert.match(activity, /SpeechRecognizer\.isOnDeviceRecognitionAvailable/);
assert.match(activity, /ANDROID_SYSTEM_DEFAULT/);
assert.match(activity, /offline-interview\.native-asr-benchmark-result\.v1/);
assert.doesNotMatch(activity, /EXTRA_AUDIO_SOURCE/,
  'native acceptance benchmark must use the system microphone path, never injected AudioRecord');
assert.doesNotMatch(activity, /EXTRA_PREFER_OFFLINE/,
  'primary system-default benchmark must not force offline preference');
assert.doesNotMatch(activity, /com\.alphacephei|sherpa|whisper/i,
  'native benchmark runtime must not invoke embedded engines');

console.log(`PASS native ASR acceptance benchmark: frozen ${corpus.id}, ${wordCount} words, platform-neutral scorer, system-default Android microphone path.`);

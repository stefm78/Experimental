import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeForWerV2, scoreV2 } from './score-native-asr-v2.mjs';

const corpus = JSON.parse(fs.readFileSync(new URL('./fr-FR-v1.json', import.meta.url), 'utf8'));
const policy = JSON.parse(fs.readFileSync(new URL('./fr-FR-v1-scoring-v2.json', import.meta.url), 'utf8'));
const repo = new URL('../../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, repo), 'utf8');
const activity = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkV2Activity.kt');
const v1Activity = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkActivity.kt');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');

assert.equal(corpus.schema, 'offline-interview.native-asr-benchmark-corpus.v1');
assert.equal(corpus.id, 'fr-FR-v1');
assert.equal(corpus.language, 'fr-FR');
assert.equal(corpus.status, 'FROZEN');
assert.equal(corpus.passages.length, 6);
assert.equal(policy.schema, 'offline-interview.native-asr-benchmark-scoring-policy.v2');
assert.equal(policy.corpusId, corpus.id);
assert.equal(policy.id, 'fr-FR-v1-scoring-v2');
assert.deepEqual(corpus.passages.map(p => p.level), [1,2,3,4,5,6]);
assert.deepEqual(corpus.passages.map(p => p.category), [
  'french_everyday','numbers_dates','proper_nouns','technical_vocabulary','complex_speech','product_stress'
]);
const wordCount = corpus.passages.reduce((n,p)=>n+normalizeForWerV2(p.reference,corpus,policy).split(' ').length,0);
assert.ok(wordCount >= 250 && wordCount <= 350, `frozen corpus should remain 250-350 normalized words, got ${wordCount}`);

const perfect = {passages: corpus.passages.map(p=>({id:p.id,hypothesis:p.reference,finalCount:1,errorCode:null,userFinished:true}))};
const perfectScore = scoreV2(corpus, policy, perfect);
assert.equal(perfectScore.aggregate.verdict, 'PASS_NATIVE_ASR');
assert.equal(perfectScore.aggregate.globalWer, 0);
assert.equal(perfectScore.aggregate.criticalEntityAccuracy, 1);
assert.equal(perfectScore.aggregate.semanticContradictions, 0);

const failed = {passages: corpus.passages.map(p=>({id:p.id,hypothesis:'',finalCount:0,errorCode:7,userFinished:true}))};
const failedScore = scoreV2(corpus, policy, failed);
assert.equal(failedScore.aggregate.verdict, 'FAIL_NATIVE_ASR');
assert.equal(failedScore.aggregate.completedFinalPassages, 0);

for (const [a,b] of [
  ['14 heures 35','14h35'],
  ['2 480 euros','2480 €'],
  ['20 pour cent','20%'],
  ['douze jours','12 jours'],
  ['7 416','7416'],
  ['9 heures 10','9h10'],
  ['128 gigaoctets','128 Go'],
  ['deux GPU','2 GPU']
]) {
  assert.equal(normalizeForWerV2(a,corpus,policy), normalizeForWerV2(b,corpus,policy), `surface-equivalent forms should normalize equally: ${a} / ${b}`);
}

const contradiction = {passages: corpus.passages.map(p=>({
  id:p.id,
  hypothesis:p.id==='L6_PRODUCT_STRESS' ? p.reference.replace("en cas d’indisponibilité","en cas de disponibilité") : p.reference,
  finalCount:1,
  errorCode:null,
  userFinished:true
}))};
const contradictionScore = scoreV2(corpus, policy, contradiction);
assert.equal(contradictionScore.aggregate.semanticContradictions, 1);
assert.notEqual(contradictionScore.aggregate.verdict, 'PASS_NATIVE_ASR');

assert.match(manifest, /\.NativeAsrBenchmarkV2Activity/);
assert.match(manifest, /00 Native ASR Benchmark v2/);
assert.match(gradle, /versionCode\s*=\s*16/);
assert.match(gradle, /0\.6\.1-native-asr-benchmark-v2-tactical/);
assert.match(gradle, /assets\.srcDir\("\.\.\/\.\.\/asr-benchmark"\)/);
assert.doesNotMatch(gradle, /vosk|sherpa|whisper/i, 'native benchmark must not embed alternate ASR engines');
assert.match(activity, /SpeechRecognizer\.createSpeechRecognizer/);
assert.match(activity, /RecognizerIntent\.LANGUAGE_MODEL_FREE_FORM/);
assert.match(activity, /EXTRA_LANGUAGE/);
assert.match(activity, /EXTRA_PARTIAL_RESULTS/);
assert.match(activity, /EXTRA_SEGMENTED_SESSION/);
assert.match(activity, /EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS/);
assert.match(activity, /EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS/);
assert.match(activity, /J'ai fini ce texte/);
assert.match(activity, /requestUserFinish/);
assert.match(activity, /scheduleRearm/);
assert.match(activity, /appendFinalText/);
assert.match(activity, /providerEarlyFinalHandling/);
assert.match(activity, /APPEND_AND_AUTO_REARM/);
assert.match(activity, /offline-interview\.native-asr-benchmark-result\.v2/);
assert.match(activity, /fr-FR-v1-scoring-v2/);
assert.match(activity, /semanticContradictions/);
assert.doesNotMatch(activity, /putExtra\(RecognizerIntent\.EXTRA_AUDIO_SOURCE/,
  'native acceptance benchmark must use the system microphone path, never injected AudioRecord');
assert.doesNotMatch(activity, /putExtra\(RecognizerIntent\.EXTRA_PREFER_OFFLINE/,
  'primary system-default benchmark must not force offline preference');
assert.doesNotMatch(activity, /com\.alphacephei|sherpa|whisper/i,
  'native benchmark runtime must not invoke embedded engines');

const onResultsSlice = activity.slice(activity.indexOf('override fun onResults'), activity.indexOf('override fun onError'));
assert.match(onResultsSlice, /scheduleRearm/);
assert.doesNotMatch(onResultsSlice, /advance\(/, 'provider finalization must never advance to the next text');
const finishRequestSlice = activity.slice(activity.indexOf('private fun requestUserFinish'), activity.indexOf('override fun onPartialResults'));
assert.match(finishRequestSlice, /userFinishedRequested\s*=\s*true/,
  'only the explicit user finish action establishes normal completion authority');
assert.match(finishRequestSlice, /recognizer\?\.stopListening\(\)/,
  'stopListening is reserved for explicit user completion');
const scoreSlice = activity.slice(activity.indexOf('private fun scoreCurrent'), activity.indexOf('private fun advance'));
assert.match(scoreSlice, /userFinished\s*=\s*userFinishedRequested/,
  'exported passage result must preserve whether completion was user-confirmed');
assert.match(v1Activity, /offline-interview\.native-asr-benchmark-result\.v1/, 'v0.6.0 physical evidence implementation should remain preserved in history/source');

console.log(`PASS native ASR benchmark v2: frozen ${corpus.id}, ${wordCount} words, user-controlled completion, auto-rearm endpointing resilience, normalized surface equivalents and semantic contradiction gate.`);

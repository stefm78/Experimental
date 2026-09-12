import fs from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeForWerV3, scoreV3 } from './score-native-asr-v3.mjs';

const corpus = JSON.parse(fs.readFileSync(new URL('./fr-FR-v1.json', import.meta.url), 'utf8'));
const policy = JSON.parse(fs.readFileSync(new URL('./fr-FR-v1-scoring-v3.json', import.meta.url), 'utf8'));
const repo = new URL('../../../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, repo), 'utf8');
const activity = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkV3Activity.kt');
const accumulator = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/RecognitionSessionAccumulator.kt');
const unitTest = read('offline-interview/native/android-stt-poc-v1/app/src/test/java/com/stefm78/offlineinterview/nativepoc/RecognitionSessionAccumulatorTest.kt');
const v2Activity = read('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/NativeAsrBenchmarkV2Activity.kt');
const manifest = read('offline-interview/native/android-stt-poc-v1/app/src/main/AndroidManifest.xml');
const gradle = read('offline-interview/native/android-stt-poc-v1/app/build.gradle.kts');

assert.equal(corpus.schema, 'offline-interview.native-asr-benchmark-corpus.v1');
assert.equal(corpus.id, 'fr-FR-v1');
assert.equal(corpus.language, 'fr-FR');
assert.equal(corpus.status, 'FROZEN');
assert.equal(corpus.passages.length, 6);
assert.equal(policy.schema, 'offline-interview.native-asr-benchmark-scoring-policy.v3');
assert.equal(policy.basePolicyId, 'fr-FR-v1-scoring-v2');
assert.equal(policy.corpusId, corpus.id);
assert.equal(policy.id, 'fr-FR-v1-scoring-v3');
assert.deepEqual(corpus.passages.map(p => p.level), [1,2,3,4,5,6]);
const wordCount = corpus.passages.reduce((n,p)=>n+normalizeForWerV3(p.reference,corpus,policy).split(' ').length,0);
assert.ok(wordCount >= 250 && wordCount <= 350, `frozen corpus should remain 250-350 normalized words, got ${wordCount}`);

// T9 — perfect transcript => PASS_NATIVE_ASR.
const perfect = {passages: corpus.passages.map(p=>({id:p.id,hypothesis:p.reference,errorCode:null,userFinished:true}))};
const perfectScore = scoreV3(corpus, policy, perfect);
assert.equal(perfectScore.aggregate.verdict, 'PASS_NATIVE_ASR');
assert.equal(perfectScore.aggregate.globalWer, 0);
assert.equal(perfectScore.aggregate.criticalEntityAccuracy, 1);
assert.equal(perfectScore.aggregate.criticalMeaningMissing, 0);
assert.equal(perfectScore.aggregate.criticalMeaningContradicted, 0);
assert.equal(perfectScore.aggregate.allCoverageAtLeast95, true);

// T7 — missing critical meaning must block PASS.
const missing = {passages: corpus.passages.map(p=>({
  id:p.id,
  hypothesis:p.id==='L5_COMPLEX' ? p.reference.replace(' alors qu’une dépendance distante reste indisponible','') : p.reference,
  errorCode:null,
  userFinished:true
}))};
const missingScore = scoreV3(corpus, policy, missing);
assert.equal(missingScore.aggregate.criticalMeaningMissing, 1);
assert.notEqual(missingScore.aggregate.verdict, 'PASS_NATIVE_ASR');
assert.notEqual(missingScore.aggregate.verdict, 'PASS_WITH_LIMITATIONS');

// T8 — contradicted critical meaning must block PASS.
const contradiction = {passages: corpus.passages.map(p=>({
  id:p.id,
  hypothesis:p.id==='L6_PRODUCT_STRESS' ? p.reference.replace("en cas d’indisponibilité","en cas de disponibilité") : p.reference,
  errorCode:null,
  userFinished:true
}))};
const contradictionScore = scoreV3(corpus, policy, contradiction);
assert.equal(contradictionScore.aggregate.criticalMeaningContradicted, 1);
assert.notEqual(contradictionScore.aggregate.verdict, 'PASS_NATIVE_ASR');
assert.notEqual(contradictionScore.aggregate.verdict, 'PASS_WITH_LIMITATIONS');

for (const [a,b] of [
  ['14 heures 35','14h35'], ['2 480 euros','2480 €'], ['20 pour cent','20%'],
  ['douze jours','12 jours'], ['7 416','7416'], ['9 heures 10','9h10'],
  ['128 gigaoctets','128 Go'], ['deux GPU','2 GPU']
]) assert.equal(normalizeForWerV3(a,corpus,policy), normalizeForWerV3(b,corpus,policy), `surface-equivalent forms should normalize equally: ${a} / ${b}`);

assert.match(manifest, /\.NativeAsrBenchmarkV3Activity/);
assert.match(manifest, /00 Native ASR Benchmark v3/);
assert.match(gradle, /versionCode\s*=\s*17/);
assert.match(gradle, /0\.6\.2-native-asr-lossless-stitching-v3-tactical/);
assert.match(gradle, /testImplementation\("junit:junit:4\.13\.2"\)/);
assert.match(activity, /SpeechRecognizer\.createSpeechRecognizer/);
assert.match(activity, /RecognitionSessionAccumulator/);
assert.match(activity, /USER_FINISH_GRACE_MS/);
assert.match(activity, /PASSAGE_WATCHDOG_MS\s*=\s*180_000L/);
assert.match(activity, /COMMIT_FINAL_OR_PARTIAL_FALLBACK_THEN_AUTO_REARM/);
assert.match(activity, /criticalMeaningMissing/);
assert.match(activity, /criticalMeaningContradicted/);
assert.match(activity, /PIVOT_NATIVE_ENGINE/);
assert.match(activity, /sessions/);
assert.match(activity, /totalRestartGapMs/);
assert.match(accumulator, /PARTIAL_BOUNDARY_FALLBACK/);
assert.match(accumulator, /USER_FINISH_PARTIAL_FALLBACK/);
assert.match(accumulator, /overlapTokensRemoved/);
assert.match(accumulator, /containsContiguous/);
assert.doesNotMatch(activity, /ERROR_REARM_LIMIT|MAX_AUTO_REARMS/, 'normal provider endpointing must never end a passage by rearm count');
assert.doesNotMatch(activity, /putExtra\(RecognizerIntent\.EXTRA_AUDIO_SOURCE/);
assert.doesNotMatch(activity, /putExtra\(RecognizerIntent\.EXTRA_PREFER_OFFLINE/);
assert.doesNotMatch(gradle, /vosk|sherpa|whisper/i, 'T10: no alternate ASR engine dependency is allowed in v3');
assert.doesNotMatch(activity, /com\.alphacephei|sherpa|whisper/i, 'T10: runtime remains Android native only');

// T1-T6 are executed against the actual Kotlin accumulator in Gradle unit tests.
for (const testName of [
  'providerFinalCommitsNormally',
  'recoverableErrorPreservesLastPartial',
  'overlapIsDeduplicatedAcrossSessions',
  'moreThanEightProviderBoundariesRemainSupported',
  'userFinishUsesProviderFinalWhenItArrives',
  'userFinishFallsBackToLastPartialWhenNoFinalArrives'
]) assert.match(unitTest, new RegExp(testName));

assert.match(v2Activity, /offline-interview\.native-asr-benchmark-result\.v2/, 'physically tested v2 source must remain preserved');

console.log(`PASS native ASR benchmark v3 contract: frozen ${corpus.id}, lossless inter-session stitching, no rearm-count authority, tri-state critical meaning, deterministic T1-T10 coverage.`);

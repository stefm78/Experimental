import fs from 'node:fs';
import assert from 'node:assert/strict';

const status = JSON.parse(fs.readFileSync('offline-interview/speech-engine/status.json', 'utf8'));
const contract = fs.readFileSync('offline-interview/native/android-stt-poc-v1/app/src/main/java/com/stefm78/offlineinterview/nativepoc/SpeechEngineContract.kt', 'utf8');
const trajectory = fs.readFileSync('offline-interview/speech-engine/SPEECH_ENGINE_STREAM_V1.md', 'utf8');

assert.equal(status.schema, 'offline-interview.speech-engine-stream-status.v1');
assert.equal(status.stream, 'SPEECH_ENGINE');
assert.equal(status.sharedContract, 'offline-interview.speech-engine-contract.v1');
assert.equal(status.productMutationAuthority, false);
assert.equal(status.currentDecision, 'PIVOT_NATIVE_ENGINE');

const native = status.nativeSystemDefault;
assert.equal(native.role, 'SYSTEM_NATIVE_DRAFT');
assert.equal(native.longFormDurableAuthority, 'DISQUALIFIED_ON_TESTED_PROVIDER_DEVICE');
assert.equal(native.evidence.pr, 100);
assert.equal(native.evidence.corpus, 'fr-FR-v1');
assert.equal(native.evidence.completedPassages, 6);
assert.equal(native.evidence.blockingErrors, 0);
assert.equal(native.evidence.lowCoveragePassages, 4);
assert.equal(native.evidence.criticalMeaningPresent, 1);
assert.equal(native.evidence.criticalMeaningTotal, 2);
assert.equal(native.evidence.verdict, 'PIVOT_NATIVE_ENGINE');
assert.ok(native.evidence.globalWer > 0.13 && native.evidence.globalWer < 0.14);

const providers = new Map(status.candidateEvidence.map(p => [p.provider, p]));
assert.equal(providers.get('VOSK_ANDROID').class, 'PCM_DURABLE_PROVIDER');
assert.equal(providers.get('WHISPER_SHERPA_ONNX').class, 'PCM_DURABLE_PROVIDER');
assert.equal(providers.get('ANDROID_EXPLICIT_ON_DEVICE').class, 'SYSTEM_NATIVE_DRAFT');
assert.equal(status.nextGate.id, 'S1_PROVIDER_DECISION_BENCHMARK');
assert.equal(status.nextGate.newHumanRecordingPreferred, false);
assert.equal(status.nextGate.productIntegrationAllowed, false);

assert.match(contract, /offline-interview\.speech-engine-contract\.v1/);
assert.match(contract, /SYSTEM_MICROPHONE/);
assert.match(contract, /PCM16_PUSH/);
assert.match(contract, /DRAFT/);
assert.match(contract, /DURABLE_PROVIDER/);
assert.match(contract, /fun offerPcm/);
assert.match(trajectory, /Product Stream then performs a fresh integration solve/);
assert.match(trajectory, /Stop native-system timing\/rearm iteration/);

console.log('PASS Speech Engine Stream v1: provider responsibility isolated, v3 pivot preserved, PCM-durable candidates retained, product mutation forbidden.');

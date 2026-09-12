import assert from 'node:assert/strict';
import { analyzeCompositeQualification } from './tools/analyze-h6-composite-qualification.mjs';

function fixture({
  runtime = 'h7',
  finals = 0,
  segments = 0,
  error5 = false,
  error11 = false,
  fallback = 0,
  degraded = false,
  dropped = 0,
  answered = 5
} = {}) {
  const sessions = [];
  for (let i = 1; i <= 5; i++) {
    const q = `Q0${i}`;
    sessions.push({
      questionId: q,
      attempt: 0,
      partialCount: 3,
      finalCount: i <= finals ? 1 : 0,
      segmentCount: i > finals && i <= finals + segments ? 1 : 0,
      droppedPcmChunks: i === 1 ? dropped : 0,
      queueHighWaterMark: i === 1 ? 37 : 5,
      providerError: error5 ? 5 : (error11 ? 11 : null),
      finalizationRequestedAtMs: i * 1000,
      finalizationCompletedAtMs: i * 1000 + 400,
      finalizationOutcome: i <= finals ? 'provider_final' : (i <= finals + segments ? 'provider_segment' : 'segmented_eof_timeout_partial_fallback')
    });
  }
  const h7 = runtime === 'h7';
  return {
    provenance: { appBuild: h7 ? 'android-native-0.4.6-h7-segmented-tactical' : 'android-native-0.4.5-h6-tactical' },
    session: { id: 'fixture', completion: { answeredQuestions: answered, totalQuestions: 5 } },
    sections: [],
    nativeCapture: {
      schema: h7 ? 'offline-interview.android-native-runtime.v7.0' : 'offline-interview.android-native-runtime.v6.0',
      pcmBytes: 640000,
      sttDegraded: degraded,
      droppedSttPcmChunks: dropped,
      segmentedSessionMode: h7 ? 'EXTRA_SEGMENTED_SESSION=EXTRA_AUDIO_SOURCE' : undefined,
      finalizationMethod: h7 ? 'segmented_pipe_eof_no_stopListening' : 'pipe_eof_no_stopListening',
      finalizationGraceMs: h7 ? 1500 : 900,
      providerCooldownMs: 250,
      sttQueueCapacityChunks: h7 ? 128 : 32,
      finalizationFallbackCount: fallback,
      turnBoundaries: [0,1,2,3,4].map((_, i) => ({ questionId: `Q0${i + 1}`, atMs: i * 5000 })),
      sttSessions: sessions
    }
  };
}

const pass = analyzeCompositeQualification(fixture({ finals: 2, segments: 2, fallback: 1 }));
assert.equal(pass.recommendedVerdict, 'PASS_SYSTEM_STT_SEGMENTED');
assert.equal(pass.automaticGateResults.runtimeStability, 'PASS');
assert.equal(pass.automaticGateResults.providerDurableResults, 'PASS');
assert.equal(pass.automaticGateResults.segmentedSessionRestored, 'PASS');

const holdPartial = analyzeCompositeQualification(fixture({ finals: 0, segments: 1, fallback: 4 }));
assert.equal(holdPartial.recommendedVerdict, 'HOLD');
assert.equal(holdPartial.automaticGateResults.providerDurableResults, 'HOLD');

const failStrategy = analyzeCompositeQualification(fixture({ finals: 0, segments: 0, fallback: 5 }));
assert.equal(failStrategy.recommendedVerdict, 'FAIL_STRATEGY');
assert.ok(failStrategy.reasonCodes.includes('SEGMENTED_SYSTEM_STT_ZERO_DURABLE_RESULTS'));
assert.ok(failStrategy.reasonCodes.includes('PIVOT_TO_EMBEDDED_ASR_WITH_MASTER_WAV_AUTHORITY'));

// H6 zero-final evidence must remain HOLD because the segmented-session semantic was missing.
const h6Hold = analyzeCompositeQualification(fixture({ runtime: 'h6', finals: 0, segments: 0, fallback: 5 }));
assert.equal(h6Hold.recommendedVerdict, 'HOLD');
assert.ok(h6Hold.reasonCodes.includes('SEGMENTED_SESSION_REGRESSION_REPAIR_REQUIRED'));
assert.equal(h6Hold.automaticGateResults.segmentedSessionRestored, 'NOT_PRESENT');

// STT PCM delivery is independent from master WAV/runtime stability.
const deliveryHold = analyzeCompositeQualification(fixture({ finals: 3, fallback: 2, dropped: 53 }));
assert.equal(deliveryHold.automaticGateResults.runtimeStability, 'PASS');
assert.equal(deliveryHold.automaticGateResults.masterAudioContinuity, 'PASS');
assert.equal(deliveryHold.automaticGateResults.sttPcmDelivery, 'FAIL');
assert.equal(deliveryHold.recommendedVerdict, 'HOLD');

const masterFail = fixture({ finals: 4, fallback: 1 });
masterFail.nativeCapture.pcmBytes = 0;
const masterFailResult = analyzeCompositeQualification(masterFail);
assert.equal(masterFailResult.automaticGateResults.runtimeStability, 'FAIL');
assert.equal(masterFailResult.automaticGateResults.masterAudioContinuity, 'FAIL');

console.log('PASS composite physical qualification analyzer: H6 HOLD, H7 PASS/HOLD/FAIL_STRATEGY, split master-audio vs STT-delivery gates.');

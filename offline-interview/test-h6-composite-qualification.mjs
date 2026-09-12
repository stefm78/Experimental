import assert from 'node:assert/strict';
import { analyzeCompositeQualification } from './tools/analyze-h6-composite-qualification.mjs';

function fixture({ finals = 0, error5 = false, error11 = false, fallback = 0, degraded = false, dropped = 0, answered = 5 } = {}) {
  const sessions = [];
  for (let i = 1; i <= 5; i++) {
    const q = `Q0${i}`;
    sessions.push({
      questionId: q,
      attempt: 0,
      partialCount: 3,
      finalCount: i <= finals ? 1 : 0,
      segmentCount: 0,
      droppedPcmChunks: 0,
      providerError: error5 ? 5 : (error11 ? 11 : null),
      finalizationRequestedAtMs: i * 1000,
      finalizationCompletedAtMs: i * 1000 + 400,
      finalizationOutcome: i <= finals ? 'provider_final' : 'eof_timeout_partial_fallback'
    });
  }
  return {
    provenance: { appBuild: 'android-native-0.4.5-h6-tactical' },
    session: { id: 'fixture', completion: { answeredQuestions: answered, totalQuestions: 5 } },
    sections: [],
    nativeCapture: {
      schema: 'offline-interview.android-native-runtime.v6.0',
      pcmBytes: 640000,
      sttDegraded: degraded,
      droppedSttPcmChunks: dropped,
      finalizationMethod: 'pipe_eof_no_stopListening',
      finalizationGraceMs: 900,
      providerCooldownMs: 250,
      finalizationFallbackCount: fallback,
      turnBoundaries: [0,1,2,3,4].map((_, i) => ({ questionId: `Q0${i + 1}`, atMs: i * 5000 })),
      sttSessions: sessions
    }
  };
}

const pass = analyzeCompositeQualification(fixture({ finals: 4, fallback: 1 }));
assert.equal(pass.recommendedVerdict, 'PASS');
assert.equal(pass.automaticGateResults.stability, 'PASS');
assert.equal(pass.automaticGateResults.providerFinalization, 'PASS');

const hold = analyzeCompositeQualification(fixture({ finals: 1, fallback: 4 }));
assert.equal(hold.recommendedVerdict, 'HOLD');
assert.equal(hold.automaticGateResults.providerFinalization, 'HOLD');

const failStrategy = analyzeCompositeQualification(fixture({ finals: 0, error11: true, fallback: 5 }));
assert.equal(failStrategy.recommendedVerdict, 'FAIL_STRATEGY');
assert.ok(failStrategy.reasonCodes.includes('ZERO_PROVIDER_FINALS_OR_SEGMENTS'));

const stabilityFail = analyzeCompositeQualification(fixture({ finals: 4, dropped: 1 }));
assert.equal(stabilityFail.automaticGateResults.stability, 'FAIL');
assert.equal(stabilityFail.automaticGateResults.pcmDelivery, 'FAIL');

console.log('PASS H6 composite physical qualification analyzer: PASS/HOLD/FAIL_STRATEGY and stability gates.');

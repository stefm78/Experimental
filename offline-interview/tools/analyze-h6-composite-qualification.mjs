#!/usr/bin/env node
import fs from 'node:fs';

export function analyzeCompositeQualification(result) {
  const nc = result?.nativeCapture || {};
  const sessions = Array.isArray(nc.sttSessions) ? nc.sttSessions : [];
  const boundaries = Array.isArray(nc.turnBoundaries) ? nc.turnBoundaries : [];
  const completion = result?.session?.completion || {};
  const answered = Number(completion.answeredQuestions || 0);
  const total = Number(completion.totalQuestions || 0);

  const byQuestion = new Map();
  for (const s of sessions) {
    const q = s.questionId || 'UNKNOWN';
    if (!byQuestion.has(q)) byQuestion.set(q, []);
    byQuestion.get(q).push(s);
  }

  const perTurnMetrics = [...byQuestion.entries()].map(([questionId, ss]) => {
    const finalCount = ss.reduce((n, s) => n + Number(s.finalCount || 0), 0);
    const segmentCount = ss.reduce((n, s) => n + Number(s.segmentCount || 0), 0);
    const partialCount = ss.reduce((n, s) => n + Number(s.partialCount || 0), 0);
    const droppedPcmChunks = ss.reduce((n, s) => n + Number(s.droppedPcmChunks || 0), 0);
    const errors = ss.map(s => s.providerError).filter(v => Number.isInteger(v));
    const retryCount = Math.max(0, ss.length - 1);
    const finalization = ss.findLast?.(s => s.finalizationRequestedAtMs != null) || [...ss].reverse().find(s => s.finalizationRequestedAtMs != null);
    const finalizationLatencyMs = finalization?.finalizationCompletedAtMs != null && finalization?.finalizationRequestedAtMs != null
      ? Number(finalization.finalizationCompletedAtMs) - Number(finalization.finalizationRequestedAtMs)
      : null;
    return {
      questionId,
      attempts: ss.length,
      retryCount,
      partialCount,
      finalCount,
      segmentCount,
      durableProviderResult: finalCount + segmentCount > 0,
      errors,
      error5: errors.includes(5),
      error8: errors.includes(8),
      error11: errors.includes(11),
      droppedPcmChunks,
      finalizationOutcome: finalization?.finalizationOutcome ?? null,
      finalizationLatencyMs,
      draftSource: findDraftSource(result, questionId)
    };
  });

  const finalOrSegmentTurns = perTurnMetrics.filter(x => x.durableProviderResult).length;
  const error5Turns = perTurnMetrics.filter(x => x.error5).length;
  const error8Turns = perTurnMetrics.filter(x => x.error8).length;
  const error11Turns = perTurnMetrics.filter(x => x.error11).length;
  const retriedTurns = perTurnMetrics.filter(x => x.retryCount > 0).length;
  const allQuestionsRepresented = total > 0 && perTurnMetrics.length >= total;
  const audioHealthy = Number(nc.pcmBytes || 0) > 0 && Number(nc.droppedSttPcmChunks || 0) === 0;
  const completionHealthy = total > 0 && answered === total;
  const stabilityHealthy = completionHealthy && audioHealthy && nc.sttDegraded === false;
  const systematicFinalizationFailure = total > 0 && finalOrSegmentTurns === 0;
  const systematicProviderErrors = total > 0 && (error5Turns >= Math.max(2, total - 1) || error11Turns >= Math.max(2, total - 1));

  const providerLifecycleMetrics = {
    questionCount: total,
    observedQuestionCount: perTurnMetrics.length,
    boundaries: boundaries.length,
    retriedTurns,
    error5Turns,
    error8Turns,
    error11Turns,
    droppedSttPcmChunks: Number(nc.droppedSttPcmChunks || 0),
    sttDegraded: Boolean(nc.sttDegraded)
  };

  const finalizationMetrics = {
    method: nc.finalizationMethod ?? null,
    graceMs: nc.finalizationGraceMs ?? null,
    providerCooldownMs: nc.providerCooldownMs ?? null,
    fallbackCount: Number(nc.finalizationFallbackCount || 0),
    durableProviderTurns: finalOrSegmentTurns,
    durableProviderRatio: total > 0 ? finalOrSegmentTurns / total : 0,
    perTurnLatencyMs: Object.fromEntries(perTurnMetrics.map(x => [x.questionId, x.finalizationLatencyMs]))
  };

  const reasonCodes = [];
  let recommendedVerdict = 'HOLD';
  if (!completionHealthy) reasonCodes.push('INCOMPLETE_QUESTIONS');
  if (!audioHealthy) reasonCodes.push('AUDIO_OR_PCM_DROP_FAILURE');
  if (nc.sttDegraded === true) reasonCodes.push('STT_DEGRADED');
  if (error5Turns > 0) reasonCodes.push('ERROR5_PRESENT');
  if (error8Turns > 0) reasonCodes.push('ERROR8_PRESENT');
  if (error11Turns > 0) reasonCodes.push('ERROR11_PRESENT');
  if (systematicFinalizationFailure) reasonCodes.push('ZERO_PROVIDER_FINALS_OR_SEGMENTS');
  if (Number(nc.finalizationFallbackCount || 0) === total && total > 0) reasonCodes.push('ALL_TURNS_FALLBACK');

  if (stabilityHealthy && finalOrSegmentTurns >= Math.ceil(total / 2) && error5Turns === 0 && error11Turns <= 1) {
    recommendedVerdict = 'PASS';
    reasonCodes.push('H6_MATERIAL_PROVIDER_FINALIZATION_SUCCESS');
  } else if (stabilityHealthy && systematicFinalizationFailure && systematicProviderErrors) {
    recommendedVerdict = 'FAIL_STRATEGY';
    reasonCodes.push('SPEECHRECOGNIZER_EXTRA_AUDIO_SOURCE_NOT_JUSTIFIED_FOR_FURTHER_INCREMENTAL_PATCHING');
  } else if (stabilityHealthy && finalOrSegmentTurns > 0) {
    recommendedVerdict = 'HOLD';
    reasonCodes.push('PARTIAL_PROVIDER_FINALIZATION_IMPROVEMENT');
  } else if (stabilityHealthy && systematicFinalizationFailure) {
    recommendedVerdict = 'HOLD';
    reasonCodes.push('EOF_FINALIZATION_NOT_YET_PROVEN');
  }

  return {
    schema: 'offline-interview.composite-physical-qualification.v1',
    candidateBuild: result?.provenance?.appBuild ?? nc.appVersion ?? null,
    qualificationRunId: result?.session?.id ?? null,
    sourceRuntimeSchema: nc.schema ?? null,
    perTurnMetrics,
    providerLifecycleMetrics,
    finalizationMetrics,
    automaticGateResults: {
      stability: stabilityHealthy ? 'PASS' : 'FAIL',
      audioContinuity: Number(nc.pcmBytes || 0) > 0 ? 'PASS' : 'FAIL',
      pcmDelivery: Number(nc.droppedSttPcmChunks || 0) === 0 ? 'PASS' : 'FAIL',
      completion: completionHealthy ? 'PASS' : 'FAIL',
      routingObservability: allQuestionsRepresented ? 'PASS' : 'HOLD',
      providerFinalization: finalOrSegmentTurns >= Math.ceil(Math.max(1, total) / 2) ? 'PASS' : (finalOrSegmentTurns > 0 ? 'HOLD' : 'FAIL'),
      boundaryProviderHealth: error11Turns <= 1 && error8Turns === 0 ? 'PASS' : 'HOLD',
      strategyDecision: recommendedVerdict
    },
    recommendedVerdict,
    reasonCodes,
    humanAction: 'One normal five-question interview only; export the result JSON and analyze it with this tool.'
  };
}

function findDraftSource(result, questionId) {
  for (const section of result?.sections || []) {
    for (const question of section?.questions || []) {
      if (question?.id === questionId) return question?.turns?.[0]?.draftSource ?? null;
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node offline-interview/tools/analyze-h6-composite-qualification.mjs <result.json>');
    process.exit(2);
  }
  const result = JSON.parse(fs.readFileSync(path, 'utf8'));
  process.stdout.write(`${JSON.stringify(analyzeCompositeQualification(result), null, 2)}\n`);
}

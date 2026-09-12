import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase, wordEdits, cer } from './score-native-asr.mjs';

function uniqueReplacements(corpus, policy) {
  const rows = [];
  const pushAlias = (canonical, variants = []) => {
    const c = normalizeBase(canonical);
    for (const variant of variants) {
      const v = normalizeBase(variant);
      if (v && c && v !== c) rows.push([v, c]);
    }
  };
  for (const a of corpus.scoring?.aliases || []) pushAlias(a.canonical, a.variants);
  for (const p of corpus.passages || []) for (const e of p.entities || []) pushAlias(e.canonical, e.variants);
  for (const a of policy.surfaceAliases || []) pushAlias(a.canonical, a.variants);
  const seen = new Set();
  return rows
    .sort((a, b) => b[0].length - a[0].length)
    .filter(([v, c]) => {
      const key = `${v}=>${c}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeForWerV2(raw, corpus, policy) {
  let value = ` ${normalizeBase(raw)} `;
  for (const [variant, canonical] of uniqueReplacements(corpus, policy)) {
    const needle = ` ${variant} `;
    const replacement = ` ${canonical} `;
    value = value.split(needle).join(replacement);
  }
  return value.trim().replace(/\s+/g, ' ');
}

function containsNormalized(raw, variant) {
  return (` ${normalizeBase(raw)} `).includes(` ${normalizeBase(variant)} `);
}

function equivalentEntityHit(raw, entity, corpus, policy) {
  if ((entity.variants || []).some(v => containsNormalized(raw, v))) return true;
  const hyp = ` ${normalizeForWerV2(raw, corpus, policy)} `;
  const canonical = ` ${normalizeForWerV2(entity.canonical, corpus, policy)} `;
  return hyp.includes(canonical);
}

function semanticForPassage(passageId, hypothesisRaw, policy) {
  const checks = (policy.criticalMeaningChecks || []).filter(c => c.passageId === passageId);
  let hits = 0;
  let contradictions = 0;
  const details = checks.map(c => {
    const hit = (c.expectedVariants || []).some(v => containsNormalized(hypothesisRaw, v));
    const contradiction = (c.contradictionVariants || []).some(v => containsNormalized(hypothesisRaw, v));
    if (hit) hits++;
    if (contradiction) contradictions++;
    return { id: c.id, hit, contradiction };
  });
  return { hits, total: checks.length, contradictions, details };
}

export function scoreV2(corpus, policy, hypotheses) {
  if (policy.corpusId !== corpus.id) throw new Error(`policy corpus ${policy.corpusId} != ${corpus.id}`);
  const byId = new Map((hypotheses.passages || []).map(p => [p.id, p]));
  const passages = (corpus.passages || []).map(p => {
    const h = byId.get(p.id) || {};
    const hypothesisRaw = h.hypothesis ?? h.hypothesisRaw ?? '';
    const referenceNormalized = normalizeForWerV2(p.reference, corpus, policy);
    const hypothesisNormalized = normalizeForWerV2(hypothesisRaw, corpus, policy);
    const edits = wordEdits(referenceNormalized, hypothesisNormalized);
    const entities = {};
    for (const e of p.entities || []) {
      const slot = entities[e.category] ||= { hits: 0, total: 0 };
      slot.total++;
      if (equivalentEntityHit(hypothesisRaw, e, corpus, policy)) slot.hits++;
    }
    for (const v of Object.values(entities)) v.accuracy = v.total ? v.hits / v.total : null;
    const semantic = semanticForPassage(p.id, hypothesisRaw, policy);
    const refWords = referenceNormalized ? referenceNormalized.split(' ').length : 0;
    const hypWords = hypothesisNormalized ? hypothesisNormalized.split(' ').length : 0;
    return {
      id: p.id,
      category: p.category,
      referenceRaw: p.reference,
      hypothesisRaw,
      referenceNormalized,
      hypothesisNormalized,
      wer: edits,
      cer: cer(referenceNormalized, hypothesisNormalized),
      entityScores: entities,
      semantic,
      userFinished: h.userFinished ?? true,
      sessionCount: h.sessionCount ?? null,
      autoRearmCount: h.autoRearmCount ?? null,
      prematureEndpointCount: h.prematureEndpointCount ?? null,
      finalCount: h.finalCount ?? 1,
      errorCode: h.errorCode ?? null,
      wordCoverageRatio: refWords ? Math.min(1, hypWords / refWords) : 1
    };
  });

  const sums = passages.reduce((a, p) => ({
    s: a.s + p.wer.substitutions,
    d: a.d + p.wer.deletions,
    i: a.i + p.wer.insertions,
    n: a.n + p.wer.referenceWords
  }), { s: 0, d: 0, i: 0, n: 0 });
  const globalWer = sums.n ? (sums.s + sums.d + sums.i) / sums.n : 0;

  const entityPairs = [];
  for (const p of corpus.passages || []) {
    const h = byId.get(p.id)?.hypothesis ?? byId.get(p.id)?.hypothesisRaw ?? '';
    for (const e of p.entities || []) entityPairs.push(equivalentEntityHit(h, e, corpus, policy));
  }
  const criticalEntityAccuracy = entityPairs.length ? entityPairs.filter(Boolean).length / entityPairs.length : 1;
  const semanticHits = passages.reduce((n, p) => n + p.semantic.hits, 0);
  const semanticTotal = passages.reduce((n, p) => n + p.semantic.total, 0);
  const semanticContradictions = passages.reduce((n, p) => n + p.semantic.contradictions, 0);
  const criticalMeaningAccuracy = semanticTotal ? semanticHits / semanticTotal : 1;
  const completedFinalPassages = passages.filter(p => p.userFinished && p.finalCount > 0 && p.errorCode == null).length;
  const userConfirmedPassages = passages.filter(p => p.userFinished).length;
  const completionRatio = passages.length ? completedFinalPassages / passages.length : 0;
  const blockingErrors = passages.filter(p => p.errorCode != null).length;
  const everydayWer = passages.find(p => p.category === 'french_everyday')?.wer.value ?? 1;
  const noContradiction = semanticContradictions === 0;
  const allUserConfirmed = userConfirmedPassages === passages.length;

  const verdict = allUserConfirmed && completionRatio === 1 && blockingErrors === 0 && globalWer <= 0.10 && criticalEntityAccuracy >= 0.90 && everydayWer <= 0.08 && noContradiction
    ? 'PASS_NATIVE_ASR'
    : allUserConfirmed && completionRatio === 1 && blockingErrors === 0 && globalWer <= 0.15 && criticalEntityAccuracy >= 0.80 && noContradiction
      ? 'PASS_WITH_LIMITATIONS'
      : completionRatio >= 0.80 ? 'HOLD_NATIVE_ASR' : 'FAIL_NATIVE_ASR';

  return {
    schema: 'offline-interview.native-asr-benchmark-score.v2',
    corpusId: corpus.id,
    scoringPolicyId: policy.id,
    passages,
    aggregate: {
      completedFinalPassages,
      userConfirmedPassages,
      totalPassages: passages.length,
      completionRatio,
      globalWer,
      criticalEntityAccuracy,
      criticalMeaningAccuracy,
      semanticContradictions,
      everydayWer,
      blockingErrors,
      verdict
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [corpusPath, policyPath, hypothesesPath] = process.argv.slice(2);
  if (!corpusPath || !policyPath || !hypothesesPath) {
    console.error('Usage: node score-native-asr-v2.mjs <corpus.json> <policy.json> <hypotheses.json>');
    process.exit(2);
  }
  const corpus = JSON.parse(fs.readFileSync(path.resolve(corpusPath), 'utf8'));
  const policy = JSON.parse(fs.readFileSync(path.resolve(policyPath), 'utf8'));
  const hypotheses = JSON.parse(fs.readFileSync(path.resolve(hypothesesPath), 'utf8'));
  console.log(JSON.stringify(scoreV2(corpus, policy, hypotheses), null, 2));
}

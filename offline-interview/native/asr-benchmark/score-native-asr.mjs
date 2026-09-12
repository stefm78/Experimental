import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function normalizeBase(raw = '') {
  return raw.toLocaleLowerCase('fr-FR')
    .replaceAll('’', "'")
    .replaceAll('-', ' ')
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}

export function normalizeForWer(raw, corpus) {
  let value = normalizeBase(raw);
  const replacements = (corpus.scoring?.aliases || [])
    .flatMap(a => (a.variants || []).map(v => [normalizeBase(v), normalizeBase(a.canonical)]))
    .sort((a, b) => b[0].length - a[0].length);
  for (const [variant, canonical] of replacements) {
    if (variant) value = value.split(variant).join(canonical);
  }
  return value.trim().replace(/\s+/g, ' ');
}

export function wordEdits(ref, hyp) {
  const r = ref ? ref.split(' ') : [];
  const h = hyp ? hyp.split(' ') : [];
  const mk = (cost=0,s=0,d=0,i=0) => ({cost,s,d,i});
  const dp = Array.from({length:r.length+1}, () => Array.from({length:h.length+1}, () => mk()));
  for (let x=1;x<=r.length;x++) dp[x][0]=mk(x,0,x,0);
  for (let y=1;y<=h.length;y++) dp[0][y]=mk(y,0,0,y);
  for (let x=1;x<=r.length;x++) for (let y=1;y<=h.length;y++) {
    if (r[x-1]===h[y-1]) dp[x][y]=dp[x-1][y-1];
    else {
      const a=dp[x-1][y-1], b=dp[x-1][y], c=dp[x][y-1];
      const choices=[mk(a.cost+1,a.s+1,a.d,a.i),mk(b.cost+1,b.s,b.d+1,b.i),mk(c.cost+1,c.s,c.d,c.i+1)];
      choices.sort((u,v)=>u.cost-v.cost || u.i-v.i || u.d-v.d);
      dp[x][y]=choices[0];
    }
  }
  const c=dp[r.length][h.length];
  return {substitutions:c.s,deletions:c.d,insertions:c.i,referenceWords:r.length,value:r.length?(c.s+c.d+c.i)/r.length:0};
}

export function cer(ref, hyp) {
  const r=ref.replaceAll(' ',''); const h=hyp.replaceAll(' ','');
  if (!r.length) return h.length?1:0;
  let prev=Array.from({length:h.length+1},(_,i)=>i);
  for (let i=1;i<=r.length;i++) {
    const cur=Array(h.length+1).fill(0); cur[0]=i;
    for (let j=1;j<=h.length;j++) cur[j]=Math.min(prev[j-1]+(r[i-1]===h[j-1]?0:1),prev[j]+1,cur[j-1]+1);
    prev=cur;
  }
  return prev[h.length]/r.length;
}

function containsVariant(raw, variant) {
  return (` ${normalizeBase(raw)} `).includes(` ${normalizeBase(variant)} `);
}

export function score(corpus, hypotheses) {
  const byId=new Map((hypotheses.passages||[]).map(p=>[p.id,p]));
  const passages=(corpus.passages||[]).map(p=>{
    const h=byId.get(p.id)||{};
    const hypothesisRaw=h.hypothesis||'';
    const referenceNormalized=normalizeForWer(p.reference,corpus);
    const hypothesisNormalized=normalizeForWer(hypothesisRaw,corpus);
    const edits=wordEdits(referenceNormalized,hypothesisNormalized);
    const entities={};
    for (const e of p.entities||[]) {
      const slot=entities[e.category] ||= {hits:0,total:0};
      slot.total++;
      if ((e.variants||[]).some(v=>containsVariant(hypothesisRaw,v))) slot.hits++;
    }
    for (const v of Object.values(entities)) v.accuracy=v.total?v.hits/v.total:null;
    return {id:p.id,category:p.category,referenceRaw:p.reference,hypothesisRaw,referenceNormalized,hypothesisNormalized,wer:edits,cer:cer(referenceNormalized,hypothesisNormalized),entityScores:entities,finalCount:h.finalCount??1,errorCode:h.errorCode??null};
  });
  const sums=passages.reduce((a,p)=>({s:a.s+p.wer.substitutions,d:a.d+p.wer.deletions,i:a.i+p.wer.insertions,n:a.n+p.wer.referenceWords}),{s:0,d:0,i:0,n:0});
  const globalWer=sums.n?(sums.s+sums.d+sums.i)/sums.n:0;
  const entityPairs=[];
  for (const p of corpus.passages||[]) {
    const h=byId.get(p.id)?.hypothesis||'';
    for (const e of p.entities||[]) entityPairs.push((e.variants||[]).some(v=>containsVariant(h,v)));
  }
  const criticalEntityAccuracy=entityPairs.length?entityPairs.filter(Boolean).length/entityPairs.length:1;
  const completedFinalPassages=passages.filter(p=>p.finalCount>0 && p.errorCode==null).length;
  const completionRatio=passages.length?completedFinalPassages/passages.length:0;
  const blockingErrors=passages.filter(p=>p.errorCode!=null).length;
  const everydayWer=passages.find(p=>p.category==='french_everyday')?.wer.value ?? 1;
  const verdict=completionRatio===1 && blockingErrors===0 && globalWer<=0.10 && criticalEntityAccuracy>=0.90 && everydayWer<=0.08
    ? 'PASS_NATIVE_ASR'
    : completionRatio===1 && blockingErrors===0 && globalWer<=0.15 && criticalEntityAccuracy>=0.80
      ? 'PASS_WITH_LIMITATIONS'
      : completionRatio>=0.80 ? 'HOLD_NATIVE_ASR' : 'FAIL_NATIVE_ASR';
  return {schema:'offline-interview.native-asr-benchmark-score.v1',corpusId:corpus.id,passages,aggregate:{completedFinalPassages,totalPassages:passages.length,globalWer,criticalEntityAccuracy,everydayWer,blockingErrors,verdict}};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [corpusPath,hypothesesPath]=process.argv.slice(2);
  if (!corpusPath || !hypothesesPath) {
    console.error('Usage: node score-native-asr.mjs <corpus.json> <hypotheses.json>');
    process.exit(2);
  }
  const corpus=JSON.parse(fs.readFileSync(path.resolve(corpusPath),'utf8'));
  const hypotheses=JSON.parse(fs.readFileSync(path.resolve(hypothesesPath),'utf8'));
  console.log(JSON.stringify(score(corpus,hypotheses),null,2));
}

export function assessWhisperTranscript(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const tokens = text.toLocaleLowerCase('fr').match(/\p{L}[\p{L}\p{M}'’-]*/gu) || [];
  if (tokens.length < 12) return { ok: true, reason: null };
  const counts = new Map();
  let maxRun = 1, run = 1;
  for (let i = 0; i < tokens.length; i++) {
    counts.set(tokens[i], (counts.get(tokens[i]) || 0) + 1);
    if (i) { run = tokens[i] === tokens[i - 1] ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  }
  const dominant = Math.max(...counts.values()) / tokens.length;
  const diversity = counts.size / tokens.length;
  if (maxRun >= 6) return { ok: false, reason: 'repeated-token-run' };
  if (tokens.length >= 20 && dominant >= 0.35) return { ok: false, reason: 'dominant-token' };
  if (tokens.length >= 30 && diversity < 0.18) return { ok: false, reason: 'low-lexical-diversity' };
  return { ok: true, reason: null };
}

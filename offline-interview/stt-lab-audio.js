export const SAMPLE_RATE = 16000;

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const prev = new Array(b.length + 1);
  const cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

export function scoreTranscript(reference, hypothesis) {
  const r = normalizeText(reference);
  const h = normalizeText(hypothesis);
  const rw = r.split(' ').filter(Boolean);
  const hw = h.split(' ').filter(Boolean);
  const rc = [...r.replace(/\s/g, '')];
  const hc = [...h.replace(/\s/g, '')];
  const wd = levenshtein(rw, hw);
  const cd = levenshtein(rc, hc);
  return {
    wer: rw.length ? wd / rw.length : null,
    cer: rc.length ? cd / rc.length : null,
    wordDistance: wd,
    charDistance: cd,
    referenceWords: rw.length,
    hypothesisWords: hw.length,
    wordRatio: rw.length ? hw.length / rw.length : null
  };
}

function rms(samples, start, end) {
  let sum = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i] || 0;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)))];
}

export function compactWithVad(samples) {
  const frame = Math.round(SAMPLE_RATE * 0.02);
  const hop = Math.round(SAMPLE_RATE * 0.01);
  const levels = [];
  for (let pos = 0; pos < samples.length; pos += hop) {
    levels.push(rms(samples, pos, Math.min(samples.length, pos + frame)));
  }

  const noise = percentile(levels, 0.2);
  const peak = Math.max(...levels, 0);
  const threshold = Math.max(0.0035, noise * 2.5, peak * 0.055);
  const active = levels.map(v => v >= threshold);
  const pad = Math.round(0.20 / (hop / SAMPLE_RATE));
  const padded = new Array(active.length).fill(false);

  for (let i = 0; i < active.length; i++) {
    if (!active[i]) continue;
    for (let j = Math.max(0, i - pad); j <= Math.min(active.length - 1, i + pad); j++) padded[j] = true;
  }

  const segments = [];
  let start = null;
  for (let i = 0; i <= padded.length; i++) {
    const on = i < padded.length ? padded[i] : false;
    if (on && start == null) start = i;
    if (!on && start != null) {
      const a = Math.max(0, start * hop);
      const b = Math.min(samples.length, i * hop + frame);
      if (b - a >= SAMPLE_RATE * 0.10) segments.push([a, b]);
      start = null;
    }
  }

  if (!segments.length) {
    return { samples: new Float32Array(samples), stats: { threshold, noise, peak, segments: 0, keptRatio: 1 } };
  }

  const gap = Math.round(SAMPLE_RATE * 0.10);
  const size = segments.reduce((n, [a, b]) => n + b - a, 0) + gap * Math.max(0, segments.length - 1);
  const out = new Float32Array(size);
  let offset = 0;

  for (let i = 0; i < segments.length; i++) {
    const [a, b] = segments[i];
    out.set(samples.subarray(a, b), offset);
    offset += b - a;
    if (i < segments.length - 1) offset += gap;
  }

  return {
    samples: out,
    stats: {
      threshold, noise, peak, segments: segments.length,
      originalSeconds: samples.length / SAMPLE_RATE,
      outputSeconds: out.length / SAMPLE_RATE,
      keptRatio: out.length / samples.length
    }
  };
}

// Simplified WSOLA/SOLA: advances faster through the source while aligning
// overlapping windows by local correlation. Pitch is preserved much better
// than simple resampling/playbackRate and is sufficient for benchmark use.
export function wsola(samples, speed) {
  if (Math.abs(speed - 1) < 0.001) return new Float32Array(samples);

  const frame = 640;
  const overlap = 320;
  const synthHop = frame - overlap;
  const analysisHop = synthHop * speed;
  const search = 160;
  const target = Math.max(frame, Math.round(samples.length / speed));
  const out = new Float32Array(target + frame);
  out.set(samples.subarray(0, Math.min(frame, samples.length)), 0);

  let inPos = analysisHop;
  let outPos = synthHop;

  while (outPos + frame < out.length && inPos + frame < samples.length) {
    const expected = Math.round(inPos);
    const lo = Math.max(0, expected - search);
    const hi = Math.min(samples.length - frame - 1, expected + search);
    let best = Math.max(lo, Math.min(hi, expected));
    let bestScore = -Infinity;

    for (let cand = lo; cand <= hi; cand += 4) {
      let dot = 0, ea = 1e-12, eb = 1e-12;
      for (let i = 0; i < overlap; i += 2) {
        const a = out[outPos + i];
        const b = samples[cand + i];
        dot += a * b; ea += a * a; eb += b * b;
      }
      const score = dot / Math.sqrt(ea * eb);
      if (score > bestScore) { bestScore = score; best = cand; }
    }

    for (let i = 0; i < overlap; i++) {
      const mix = i / overlap;
      out[outPos + i] = out[outPos + i] * (1 - mix) + samples[best + i] * mix;
    }
    const tail = Math.min(frame - overlap, out.length - outPos - overlap, samples.length - best - overlap);
    out.set(samples.subarray(best + overlap, best + overlap + tail), outPos + overlap);
    outPos += synthHop;
    inPos += analysisHop;
  }

  return out.slice(0, target);
}

export function buildTransforms(samples) {
  const vad = compactWithVad(samples);
  return {
    raw: { label: 'Brut', samples: new Float32Array(samples), meta: { speed: 1, vad: false } },
    vad: { label: 'VAD compact', samples: vad.samples, meta: { speed: 1, vad: true, vadStats: vad.stats } },
    speed115: { label: 'WSOLA 1,15×', samples: wsola(samples, 1.15), meta: { speed: 1.15, vad: false } },
    speed125: { label: 'WSOLA 1,25×', samples: wsola(samples, 1.25), meta: { speed: 1.25, vad: false } },
    vadSpeed115: { label: 'VAD + WSOLA 1,15×', samples: wsola(vad.samples, 1.15), meta: { speed: 1.15, vad: true, vadStats: vad.stats } }
  };
}

export async function blobTo16kMono(blob) {
  const data = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(data.slice(0));
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE)), SAMPLE_RATE);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    return new Float32Array(rendered.getChannelData(0));
  } finally {
    await ctx.close();
  }
}

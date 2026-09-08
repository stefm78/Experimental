import { SAMPLE_RATE } from './stt-lab-audio.js?v=4';

const MESPEAK_COMMIT = '078d6597254776c151c67f73434c91be034a9fdc';
const MESPEAK_BASE = `https://cdn.jsdelivr.net/gh/btopro/mespeak@${MESPEAK_COMMIT}`;
const MESPEAK_SCRIPT = `${MESPEAK_BASE}/mespeak.js`;
const MESPEAK_CONFIG = `${MESPEAK_BASE}/mespeak_config.json`;
const MESPEAK_FR = `${MESPEAK_BASE}/voices/fr.json`;

const SHORT = "Le mardi quatorze octobre, nous avons lancé un projet à Saint-Germain-en-Laye avec quinze personnes. L'objectif était de préparer trois démonstrations pour une équipe technique et commerciale. J'ai rencontré deux difficultés principales : le bruit dans la salle et les changements de dernière minute. Malgré cela, la réunion s'est terminée à dix-sept heures trente, et nous avons décidé de poursuivre le projet la semaine suivante.";

const LONG_SEGMENTS = [
  "Le mardi quatorze octobre, nous avons lancé un projet à Saint-Germain-en-Laye avec quinze personnes. L'objectif était de préparer trois démonstrations pour une équipe technique et commerciale. J'ai rencontré deux difficultés principales : le bruit dans la salle et les changements de dernière minute.",
  "Après une courte pause, nous avons repris la discussion avec l'équipe. Trois décisions ont été prises : simplifier la démonstration, préparer une copie hors ligne des documents et organiser une nouvelle réunion le jeudi suivant à neuf heures trente.",
  "Malgré les difficultés, la réunion s'est terminée à dix-sept heures trente. Nous avons décidé de poursuivre le projet la semaine suivante et de vérifier chaque étape avec les équipes techniques et commerciales avant la prochaine présentation.",
  "Le mardi quatorze octobre, nous avons lancé un projet à Saint-Germain-en-Laye avec quinze personnes. L'objectif était de préparer trois démonstrations pour une équipe technique et commerciale. J'ai rencontré deux difficultés principales : le bruit dans la salle et les changements de dernière minute.",
  "Après une courte pause, nous avons repris la discussion avec l'équipe. Trois décisions ont été prises : simplifier la démonstration, préparer une copie hors ligne des documents et organiser une nouvelle réunion le jeudi suivant à neuf heures trente."
];

export const FIXTURES = {
  shortClean: {
    id: 'short-clean-v1',
    label: 'Canonique · qualité · ~25 s',
    description: 'Parole synthétique française propre. Compare la qualité pure et la latence.',
    referenceText: SHORT,
    kind: 'short-clean'
  },
  longSilence: {
    id: 'long-silence-v1',
    label: 'Canonique · long + silences · ~90 s',
    description: 'Plusieurs segments séparés par des silences exacts. Mesure chunking, débit et VAD.',
    referenceText: LONG_SEGMENTS.join(' '),
    kind: 'long-silence'
  },
  shortNoisy: {
    id: 'short-noisy-v1',
    label: 'Canonique · bruité · ~25 s',
    description: 'Même contenu que le fixture court avec bruit déterministe. Mesure la robustesse.',
    referenceText: SHORT,
    kind: 'short-noisy'
  }
};

let mespeakPromise = null;

function timeoutError(stage, ms) {
  return new Error(`${stage} : timeout après ${Math.round(ms / 1000)} s`);
}

function loadScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (window.meSpeak) return resolve();
    const existing = [...document.scripts].find(s => s.src === src);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(timeoutError('script meSpeak', timeoutMs));
    }, timeoutMs);

    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.meSpeak ? resolve() : reject(new Error('script chargé mais global meSpeak absent'));
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Chargement meSpeak impossible: ${src}`));
    };

    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = done;
    script.onerror = fail;
    document.head.appendChild(script);
  });
}

function waitUntil(test, stage, timeoutMs = 12000, intervalMs = 50) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      let ready = false;
      try { ready = Boolean(test()); } catch {}
      if (ready) return resolve();
      if (performance.now() - started >= timeoutMs) return reject(timeoutError(stage, timeoutMs));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function loadConfig(meSpeak) {
  if (meSpeak.isConfigLoaded?.()) return;
  // meSpeak 1.x loadConfig() does NOT document a completion callback.
  // Trigger the async XHR, then poll the public isConfigLoaded() state.
  meSpeak.loadConfig(MESPEAK_CONFIG);
  await waitUntil(() => meSpeak.isConfigLoaded?.(), 'configuration meSpeak');
}

function loadVoice(meSpeak, timeoutMs = 12000) {
  if (meSpeak.isVoiceLoaded?.('fr')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(timeoutError('voix française meSpeak', timeoutMs));
    }, timeoutMs);

    try {
      meSpeak.loadVoice(MESPEAK_FR, (ok, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ok ? resolve(message) : reject(new Error(`voix française meSpeak : ${message || 'échec'}`));
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function ensureMespeak(onStage = () => {}) {
  if (!mespeakPromise) {
    mespeakPromise = (async () => {
      onStage('Fixture 1/4 · chargement du script meSpeak…');
      await loadScript(MESPEAK_SCRIPT);
      const meSpeak = window.meSpeak;
      if (!meSpeak) throw new Error('meSpeak global absent');

      onStage('Fixture 2/4 · chargement de la configuration…');
      await loadConfig(meSpeak);

      onStage('Fixture 3/4 · chargement de la voix française…');
      await loadVoice(meSpeak);

      meSpeak.setDefaultVoice('fr');
      onStage('Fixture 4/4 · synthétiseur prêt');
      return meSpeak;
    })().catch(error => {
      mespeakPromise = null;
      throw error;
    });
  }
  return mespeakPromise;
}

function readAscii(view, offset, length) {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

function wavToMonoFloat32(buffer) {
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new Error('Fixture WAV invalide');
  }

  let offset = 12;
  let audioFormat = 1, channels = 1, sampleRate = 22050, bits = 16;
  let dataOffset = -1, dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      audioFormat = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      dataOffset = body;
      dataSize = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (audioFormat !== 1 || ![8, 16].includes(bits) || dataOffset < 0) {
    throw new Error(`Fixture WAV non supporté: format=${audioFormat}, bits=${bits}`);
  }

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataSize / (channels * bytesPerSample));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const pos = dataOffset + (i * channels + c) * bytesPerSample;
      // PCM WAV 8-bit is unsigned; PCM WAV 16-bit is signed little-endian.
      sum += bits === 8
        ? (view.getUint8(pos) - 128) / 128
        : view.getInt16(pos, true) / 32768;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate, bits };
}

function resampleLinear(samples, inputRate, outputRate = SAMPLE_RATE) {
  if (inputRate === outputRate) return new Float32Array(samples);
  const length = Math.max(1, Math.round(samples.length * outputRate / inputRate));
  const out = new Float32Array(length);
  const ratio = inputRate / outputRate;
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(samples.length - 1, a + 1);
    const t = pos - a;
    out[i] = samples[a] * (1 - t) + samples[b] * t;
  }
  return out;
}

async function synthesize(text, onStage = () => {}) {
  const meSpeak = await ensureMespeak(onStage);
  // Yield one browser task so the last visible stage can paint before the
  // synchronous eSpeak compilation/synthesis work starts.
  await new Promise(resolve => setTimeout(resolve, 0));
  const started = performance.now();
  const wav = meSpeak.speak(text, {
    rawdata: true,
    voice: 'fr',
    speed: 145,
    pitch: 50,
    amplitude: 100,
    wordgap: 0
  });
  if (!wav) throw new Error('meSpeak n’a produit aucun audio');
  onStage(`Synthèse terminée en ${((performance.now() - started) / 1000).toFixed(1)} s`);
  const buffer = wav instanceof ArrayBuffer ? wav : wav.buffer.slice(wav.byteOffset || 0, (wav.byteOffset || 0) + wav.byteLength);
  const decoded = wavToMonoFloat32(buffer);
  return resampleLinear(decoded.samples, decoded.sampleRate, SAMPLE_RATE);
}

function concat(parts) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

function addDeterministicNoise(samples) {
  const out = new Float32Array(samples.length);
  let state = 0x51f15e3d;
  let prev = 0;
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const amp = Math.max(0.004, peak * 0.055);

  for (let i = 0; i < samples.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const white = (state / 4294967296) * 2 - 1;
    prev = 0.92 * prev + 0.08 * white;
    out[i] = Math.max(-1, Math.min(1, samples[i] + prev * amp));
  }
  return out;
}

function int16Bytes(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, v < 0 ? Math.round(v * 32768) : Math.round(v * 32767), true);
  }
  return bytes;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function buildFixture(key, onStage = () => {}) {
  const spec = FIXTURES[key];
  if (!spec) throw new Error(`Fixture inconnu: ${key}`);

  onStage('Chargement du synthétiseur canonique…');

  let samples;
  if (key === 'shortClean') {
    onStage('Synthèse du fixture court…');
    samples = await synthesize(SHORT, onStage);
  } else if (key === 'longSilence') {
    const parts = [];
    for (let i = 0; i < LONG_SEGMENTS.length; i++) {
      onStage(`Synthèse segment ${i + 1}/${LONG_SEGMENTS.length}…`);
      parts.push(await synthesize(LONG_SEGMENTS[i], onStage));
      if (i < LONG_SEGMENTS.length - 1) parts.push(silence(3));
    }
    samples = concat(parts);
  } else if (key === 'shortNoisy') {
    onStage('Synthèse du fixture bruité…');
    samples = addDeterministicNoise(await synthesize(SHORT, onStage));
  }

  onStage('Calcul de l’empreinte du fixture…');
  const pcmBytes = int16Bytes(samples);
  const sha256 = await sha256Hex(pcmBytes);

  return {
    ...spec,
    generator: {
      engine: 'meSpeak/eSpeak',
      sourceCommit: MESPEAK_COMMIT,
      voice: 'fr',
      speed: 145,
      pitch: 50,
      sampleRate: SAMPLE_RATE
    },
    samples,
    durationSeconds: samples.length / SAMPLE_RATE,
    sha256
  };
}

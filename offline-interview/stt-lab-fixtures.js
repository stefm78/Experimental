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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find(s => s.src === src);
    if (existing && window.meSpeak) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Chargement meSpeak impossible: ${src}`));
    document.head.appendChild(script);
  });
}

function loadMespeakResource(fn, url) {
  return new Promise((resolve, reject) => {
    fn(url, (ok, message) => ok ? resolve(message) : reject(new Error(String(message || 'resource load failed'))));
  });
}

async function ensureMespeak() {
  if (!mespeakPromise) {
    mespeakPromise = (async () => {
      await loadScript(MESPEAK_SCRIPT);
      if (!window.meSpeak) throw new Error('meSpeak global absent');
      if (!window.meSpeak.isConfigLoaded()) {
        await loadMespeakResource(window.meSpeak.loadConfig.bind(window.meSpeak), MESPEAK_CONFIG);
      }
      if (!window.meSpeak.isVoiceLoaded('fr')) {
        await loadMespeakResource(window.meSpeak.loadVoice.bind(window.meSpeak), MESPEAK_FR);
      }
      window.meSpeak.setDefaultVoice('fr');
      return window.meSpeak;
    })();
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

  if (audioFormat !== 1 || bits !== 16 || dataOffset < 0) {
    throw new Error(`Fixture WAV non supporté: format=${audioFormat}, bits=${bits}`);
  }

  const frames = Math.floor(dataSize / (channels * 2));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += view.getInt16(dataOffset + (i * channels + c) * 2, true) / 32768;
    }
    out[i] = sum / channels;
  }
  return { samples: out, sampleRate };
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

async function synthesize(text) {
  const meSpeak = await ensureMespeak();
  const wav = meSpeak.speak(text, {
    rawdata: true,
    voice: 'fr',
    speed: 145,
    pitch: 50,
    amplitude: 100,
    wordgap: 0
  });
  if (!wav) throw new Error('meSpeak n’a produit aucun audio');
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
    samples = await synthesize(SHORT);
  } else if (key === 'longSilence') {
    const parts = [];
    for (let i = 0; i < LONG_SEGMENTS.length; i++) {
      onStage(`Synthèse segment ${i + 1}/${LONG_SEGMENTS.length}…`);
      parts.push(await synthesize(LONG_SEGMENTS[i]));
      if (i < LONG_SEGMENTS.length - 1) parts.push(silence(3));
    }
    samples = concat(parts);
  } else if (key === 'shortNoisy') {
    onStage('Synthèse du fixture bruité…');
    samples = addDeterministicNoise(await synthesize(SHORT));
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

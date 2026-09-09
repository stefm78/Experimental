import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

const $ = id => document.getElementById(id);
const log = (kind, data = {}) => {
  const row = { at: new Date().toISOString(), kind, ...data };
  $('details').textContent += JSON.stringify(row) + '\n';
};

let transcriber = null;
let loading = null;

async function getTranscriber() {
  if (transcriber) return transcriber;
  if (loading) return loading;
  const device = navigator.gpu ? 'webgpu' : 'wasm';
  const startedAt = performance.now();
  $('localStatus').textContent = 'Premier chargement du modèle…';
  $('localStatus').className = '';
  log('local_model_load_start', { engine: 'whisper-base', device });
  loading = pipeline('automatic-speech-recognition', 'onnx-community/whisper-base', { device })
    .then(pipe => {
      transcriber = pipe;
      log('local_model_load_end', { engine: 'whisper-base', device, latencyMs: Math.round(performance.now() - startedAt) });
      return pipe;
    })
    .catch(err => {
      loading = null;
      throw err;
    });
  return loading;
}

async function transcribeLocal() {
  const blob = window.simpleSttLab?.getBlob?.();
  if (!blob) {
    $('localStatus').textContent = 'Aucun audio à transcrire.';
    $('localStatus').className = 'bad';
    return;
  }
  $('localTranscribe').disabled = true;
  $('localText').value = '';
  try {
    const pipe = await getTranscriber();
    $('localStatus').textContent = 'Transcription locale en cours…';
    const startedAt = performance.now();
    const url = URL.createObjectURL(blob);
    try {
      const output = await pipe(url, { language: 'french', task: 'transcribe' });
      const text = String(output?.text || '').trim();
      $('localText').value = text;
      $('localStatus').textContent = text ? 'Transcription locale terminée.' : 'Aucun texte obtenu.';
      $('localStatus').className = text ? 'ok' : 'bad';
      log('local_transcription_end', {
        engine: 'whisper-base',
        device: navigator.gpu ? 'webgpu' : 'wasm',
        latencyMs: Math.round(performance.now() - startedAt),
        text
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    $('localStatus').textContent = 'Échec de la transcription locale.';
    $('localStatus').className = 'bad';
    log('local_transcription_error', { engine: 'whisper-base', message: String(err?.message || err), name: err?.name || '' });
  } finally {
    $('localTranscribe').disabled = false;
  }
}

$('localTranscribe').addEventListener('click', transcribeLocal);
window.addEventListener('simple-stt-reset', () => {
  $('localText').value = '';
  $('localStatus').textContent = 'En attente d’un enregistrement.';
  $('localStatus').className = '';
  $('localTranscribe').disabled = true;
});
window.addEventListener('simple-stt-recording-ready', () => {
  $('localTranscribe').disabled = false;
});

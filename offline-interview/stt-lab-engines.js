export const TRANSFORMERS_VERSION = '4.2.0';
export const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

const MODEL_IDS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small'
};

export const ENGINES = {
  tinyQ8Wasm: { key: 'tinyQ8Wasm', model: 'tiny', dtype: 'q8', device: 'wasm', label: 'Tiny q8 · WASM' },
  baseQ4Wasm: { key: 'baseQ4Wasm', model: 'base', dtype: 'q4', device: 'wasm', label: 'Base q4 · WASM' },
  baseQ8Wasm: { key: 'baseQ8Wasm', model: 'base', dtype: 'q8', device: 'wasm', label: 'Base q8 · WASM' },
  smallQ4Wasm: { key: 'smallQ4Wasm', model: 'small', dtype: 'q4', device: 'wasm', label: 'Small q4 · WASM' },
  smallQ8Wasm: { key: 'smallQ8Wasm', model: 'small', dtype: 'q8', device: 'wasm', label: 'Small q8 · WASM' },
  baseQ4Gpu: { key: 'baseQ4Gpu', model: 'base', dtype: 'q4', device: 'webgpu', label: 'Base q4 · WebGPU' },
  baseFp16Gpu: { key: 'baseFp16Gpu', model: 'base', dtype: 'fp16', device: 'webgpu', label: 'Base fp16 · WebGPU', requiresFp16: true },
  smallQ4Gpu: { key: 'smallQ4Gpu', model: 'small', dtype: 'q4', device: 'webgpu', label: 'Small q4 · WebGPU' },
  smallFp16Gpu: { key: 'smallFp16Gpu', model: 'small', dtype: 'fp16', device: 'webgpu', label: 'Small fp16 · WebGPU', requiresFp16: true }
};

function e(id, pack, engineKey, transformKey, decode, label) {
  return { id, pack, engineKey, transformKey, decode, label };
}

export const EXPERIMENTS = [
  e('base-q4-raw', 'essential', 'baseQ4Wasm', 'raw', 'greedy', 'Base q4 · brut'),
  e('base-q8-raw', 'essential', 'baseQ8Wasm', 'raw', 'greedy', 'Base q8 · brut'),
  e('small-q4-raw', 'essential', 'smallQ4Wasm', 'raw', 'greedy', 'Small q4 · brut'),
  e('small-q8-raw', 'essential', 'smallQ8Wasm', 'raw', 'greedy', 'Small q8 · brut'),
  e('base-q8-vad', 'essential', 'baseQ8Wasm', 'vad', 'greedy', 'Base q8 · VAD'),
  e('small-q8-vad', 'essential', 'smallQ8Wasm', 'vad', 'greedy', 'Small q8 · VAD'),

  e('base-q8-direct', 'deep', 'baseQ8Wasm', 'raw', 'direct', 'Base q8 · direct sans chunk'),
  e('base-q8-guard', 'deep', 'baseQ8Wasm', 'raw', 'guarded', 'Base q8 · anti-répétition'),
  e('base-q8-beam3', 'deep', 'baseQ8Wasm', 'raw', 'beam3', 'Base q8 · beam-3'),
  e('small-q8-speed115', 'deep', 'smallQ8Wasm', 'speed115', 'greedy', 'Small q8 · WSOLA 1,15×'),
  e('small-q8-speed125', 'deep', 'smallQ8Wasm', 'speed125', 'greedy', 'Small q8 · WSOLA 1,25×'),
  e('small-q8-vad-speed115', 'deep', 'smallQ8Wasm', 'vadSpeed115', 'greedy', 'Small q8 · VAD + 1,15×'),
  e('base-q4-webgpu', 'deep', 'baseQ4Gpu', 'raw', 'greedy', 'Base q4 · WebGPU'),
  e('base-fp16-webgpu', 'deep', 'baseFp16Gpu', 'raw', 'greedy', 'Base fp16 · WebGPU'),

  e('tiny-q8-guard', 'exhaustive', 'tinyQ8Wasm', 'raw', 'guarded', 'Tiny q8 · anti-répétition'),
  e('small-q8-beam3', 'exhaustive', 'smallQ8Wasm', 'raw', 'beam3', 'Small q8 · beam-3'),
  e('small-q4-webgpu', 'exhaustive', 'smallQ4Gpu', 'raw', 'greedy', 'Small q4 · WebGPU'),
  e('small-fp16-webgpu', 'exhaustive', 'smallFp16Gpu', 'raw', 'greedy', 'Small fp16 · WebGPU'),
  e('base-fp16-webgpu-vad', 'exhaustive', 'baseFp16Gpu', 'vad', 'greedy', 'Base fp16 · WebGPU · VAD'),
  e('small-fp16-webgpu-vad', 'exhaustive', 'smallFp16Gpu', 'vad', 'greedy', 'Small fp16 · WebGPU · VAD')
];

const PACK_ORDER = { essential: 0, deep: 1, exhaustive: 2 };

export function experimentsForPack(pack) {
  return EXPERIMENTS.filter(x => PACK_ORDER[x.pack] <= PACK_ORDER[pack]);
}

export function availability(item, webgpuInfo) {
  const spec = ENGINES[item.engineKey];
  if (spec.device === 'webgpu' && !webgpuInfo.available) return { ok: false, reason: 'WebGPU indisponible' };
  if (spec.requiresFp16 && !webgpuInfo.shaderF16) return { ok: false, reason: 'shader-f16 indisponible' };
  return { ok: true, reason: null };
}

export function decodeOptions(kind, seconds) {
  const common = { language: 'french', task: 'transcribe' };
  if (kind === 'direct') return { ...common, chunk_length_s: 0 };

  const chunked = { ...common, chunk_length_s: 30, stride_length_s: 5 };
  const cap = Math.max(80, Math.ceil(seconds * 8));

  if (kind === 'guarded') {
    return { ...chunked, max_new_tokens: cap, no_repeat_ngram_size: 3, repetition_penalty: 1.05 };
  }
  if (kind === 'beam3') {
    return { ...chunked, num_beams: 3, early_stopping: true, max_new_tokens: cap };
  }
  return chunked;
}

let modulePromise = null;

async function getModule() {
  if (!modulePromise) {
    modulePromise = import(TRANSFORMERS_URL).then(mod => {
      mod.env.useBrowserCache = true;
      mod.env.useWasmCache = true;
      mod.env.allowRemoteModels = true;
      if (mod.env.backends?.onnx?.wasm) mod.env.backends.onnx.wasm.numThreads = 1;
      return mod;
    });
  }
  return modulePromise;
}

export async function loadEngine(spec, onProgress) {
  const {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    AutomaticSpeechRecognitionPipeline
  } = await getModule();

  const modelId = MODEL_IDS[spec.model];
  const opts = { progress_callback: x => onProgress?.(x) };
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, opts);
  const processor = await AutoProcessor.from_pretrained(modelId, opts);

  if (!processor?.feature_extractor) throw new Error('feature_extractor absent');

  const model = await WhisperForConditionalGeneration.from_pretrained(modelId, {
    device: spec.device,
    dtype: spec.dtype,
    progress_callback: x => onProgress?.(x)
  });

  const probe = await processor(new Float32Array(1600));
  if (!probe?.input_features) {
    await model.dispose?.();
    throw new Error('processor probe sans input_features');
  }

  return new AutomaticSpeechRecognitionPipeline({
    task: 'automatic-speech-recognition',
    model,
    tokenizer,
    processor
  });
}

export function modelIdFor(spec) {
  return MODEL_IDS[spec.model];
}

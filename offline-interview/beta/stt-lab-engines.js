export const TRANSFORMERS_VERSION = '4.2.0';
export const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

const MODELS = {
  baseLegacy: 'onnx-community/whisper-base',
  smallLegacy: 'onnx-community/whisper-small',
  baseV4: 'onnx-community/whisper-base-ONNX',
  smallV4: 'onnx-community/whisper-small-ONNX'
};

function engine(key, modelId, dtype, device, label, extra = {}) {
  return {
    key,
    modelId,
    dtype,
    device,
    label,
    graphOptimizationLevel: 'basic',
    ...extra
  };
}

export const ENGINES = {
  // v4-era ONNX exports. These are the primary candidates.
  baseV4Q8Wasm: engine(
    'baseV4Q8Wasm',
    MODELS.baseV4,
    { encoder_model: 'q8', decoder_model_merged: 'q8' },
    'wasm',
    'Base ONNX · q8/q8 · WASM'
  ),
  smallV4Q8Wasm: engine(
    'smallV4Q8Wasm',
    MODELS.smallV4,
    { encoder_model: 'q8', decoder_model_merged: 'q8' },
    'wasm',
    'Small ONNX · q8/q8 · WASM'
  ),
  baseV4Fp32Wasm: engine(
    'baseV4Fp32Wasm',
    MODELS.baseV4,
    { encoder_model: 'fp32', decoder_model_merged: 'fp32' },
    'wasm',
    'Base ONNX · fp32/fp32 · WASM'
  ),
  baseV4Int8Wasm: engine(
    'baseV4Int8Wasm',
    MODELS.baseV4,
    { encoder_model: 'int8', decoder_model_merged: 'int8' },
    'wasm',
    'Base ONNX · int8/int8 · WASM'
  ),
  baseV4Uint8Wasm: engine(
    'baseV4Uint8Wasm',
    MODELS.baseV4,
    { encoder_model: 'uint8', decoder_model_merged: 'uint8' },
    'wasm',
    'Base ONNX · uint8/uint8 · WASM'
  ),
  smallV4Int8Wasm: engine(
    'smallV4Int8Wasm',
    MODELS.smallV4,
    { encoder_model: 'int8', decoder_model_merged: 'int8' },
    'wasm',
    'Small ONNX · int8/int8 · WASM'
  ),
  smallV4Uint8Wasm: engine(
    'smallV4Uint8Wasm',
    MODELS.smallV4,
    { encoder_model: 'uint8', decoder_model_merged: 'uint8' },
    'wasm',
    'Small ONNX · uint8/uint8 · WASM'
  ),
  baseLegacyQ4Wasm: engine(
    'baseLegacyQ4Wasm',
    MODELS.baseLegacy,
    { encoder_model: 'q4', decoder_model_merged: 'q4' },
    'wasm',
    'Base legacy · q4/q4 · WASM'
  ),
  smallLegacyQ4Wasm: engine(
    'smallLegacyQ4Wasm',
    MODELS.smallLegacy,
    { encoder_model: 'q4', decoder_model_merged: 'q4' },
    'wasm',
    'Small legacy · q4/q4 · WASM'
  ),
  baseV4Q8WasmAggressive: engine(
    'baseV4Q8WasmAggressive',
    MODELS.baseV4,
    { encoder_model: 'q8', decoder_model_merged: 'q8' },
    'wasm',
    'Base ONNX · q8/q8 · WASM · ORT all',
    { graphOptimizationLevel: 'all', expectedControl: true }
  ),

  // Known practical WebGPU profile for Whisper: accurate encoder + compact decoder.
  baseV4HybridGpu: engine(
    'baseV4HybridGpu',
    MODELS.baseV4,
    { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    'webgpu',
    'Base ONNX · fp32/q4 · WebGPU'
  ),
  smallV4HybridGpu: engine(
    'smallV4HybridGpu',
    MODELS.smallV4,
    { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    'webgpu',
    'Small ONNX · fp32/q4 · WebGPU'
  ),

  // Newer compact WebGPU exports. q4f16 is specifically useful on shader-f16 hardware.
  baseV4CompactGpu: engine(
    'baseV4CompactGpu',
    MODELS.baseV4,
    { encoder_model: 'fp16', decoder_model_merged: 'q4f16' },
    'webgpu',
    'Base ONNX · fp16/q4f16 · WebGPU',
    { requiresFp16: true }
  ),
  smallV4CompactGpu: engine(
    'smallV4CompactGpu',
    MODELS.smallV4,
    { encoder_model: 'fp16', decoder_model_merged: 'q4f16' },
    'webgpu',
    'Small ONNX · fp16/q4f16 · WebGPU',
    { requiresFp16: true }
  ),
  baseV4Fp16Gpu: engine(
    'baseV4Fp16Gpu',
    MODELS.baseV4,
    { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
    'webgpu',
    'Base ONNX · fp16/fp16 · WebGPU',
    { requiresFp16: true }
  ),
  smallV4Fp16Gpu: engine(
    'smallV4Fp16Gpu',
    MODELS.smallV4,
    { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
    'webgpu',
    'Small ONNX · fp16/fp16 · WebGPU',
    { requiresFp16: true }
  ),

  // Legacy controls: useful only to determine whether the new export is the fix.
  baseLegacyHybridGpu: engine(
    'baseLegacyHybridGpu',
    MODELS.baseLegacy,
    { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    'webgpu',
    'Base legacy · fp32/q4 · WebGPU',
    { legacy: true }
  ),
  smallLegacyHybridGpu: engine(
    'smallLegacyHybridGpu',
    MODELS.smallLegacy,
    { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    'webgpu',
    'Small legacy · fp32/q4 · WebGPU',
    { legacy: true }
  )
};

function e(id, pack, engineKey, transformKey, decode, label) {
  return { id, pack, engineKey, transformKey, decode, label };
}

export const EXPERIMENTS = [
  // Essential: useful cross-device candidates only.
  e('base-v4-q8-wasm-raw', 'essential', 'baseV4Q8Wasm', 'raw', 'greedy', 'Base ONNX q8 WASM · brut'),
  e('base-v4-int8-wasm-raw', 'essential', 'baseV4Int8Wasm', 'raw', 'greedy', 'Base ONNX int8 WASM · brut'),
  e('base-v4-fp32-wasm-raw', 'essential', 'baseV4Fp32Wasm', 'raw', 'greedy', 'Base ONNX fp32 WASM · brut'),
  e('base-v4-hybrid-gpu-raw', 'essential', 'baseV4HybridGpu', 'raw', 'greedy', 'Base ONNX fp32/q4 WebGPU · brut'),
  e('small-legacy-q4-wasm-raw', 'essential', 'smallLegacyQ4Wasm', 'raw', 'greedy', 'Small legacy q4 WASM · brut'),
  e('small-legacy-hybrid-gpu-raw', 'essential', 'smallLegacyHybridGpu', 'raw', 'greedy', 'Small legacy fp32/q4 WebGPU · brut'),

  // Deep: preprocessing and decoding on engines that actually run.
  e('base-v4-q8-wasm-vad', 'deep', 'baseV4Q8Wasm', 'vad', 'greedy', 'Base ONNX q8 WASM · VAD'),
  e('base-v4-q8-wasm-direct', 'deep', 'baseV4Q8Wasm', 'raw', 'direct', 'Base ONNX q8 WASM · direct'),
  e('base-v4-q8-wasm-guard', 'deep', 'baseV4Q8Wasm', 'raw', 'guarded', 'Base ONNX q8 WASM · anti-répétition'),
  e('base-v4-q8-wasm-beam3', 'deep', 'baseV4Q8Wasm', 'raw', 'beam3', 'Base ONNX q8 WASM · beam-3'),
  e('base-v4-int8-wasm-vad', 'deep', 'baseV4Int8Wasm', 'vad', 'greedy', 'Base ONNX int8 WASM · VAD'),
  e('base-v4-hybrid-gpu-vad', 'deep', 'baseV4HybridGpu', 'vad', 'greedy', 'Base ONNX fp32/q4 WebGPU · VAD'),
  e('small-legacy-q4-wasm-vad', 'deep', 'smallLegacyQ4Wasm', 'vad', 'greedy', 'Small legacy q4 WASM · VAD'),
  e('small-legacy-q4-wasm-speed115', 'deep', 'smallLegacyQ4Wasm', 'speed115', 'greedy', 'Small legacy q4 WASM · WSOLA 1,15×'),
  e('small-legacy-q4-wasm-speed125', 'deep', 'smallLegacyQ4Wasm', 'speed125', 'greedy', 'Small legacy q4 WASM · WSOLA 1,25×'),
  e('small-legacy-q4-wasm-vad-speed115', 'deep', 'smallLegacyQ4Wasm', 'vadSpeed115', 'greedy', 'Small legacy q4 WASM · VAD + 1,15×'),

  // Exhaustive: secondary quantization, legacy comparison and ORT control.
  e('base-v4-uint8-wasm-raw', 'exhaustive', 'baseV4Uint8Wasm', 'raw', 'greedy', 'Base ONNX uint8 WASM · brut'),
  e('base-legacy-q4-wasm-raw', 'exhaustive', 'baseLegacyQ4Wasm', 'raw', 'greedy', 'Base legacy q4 WASM · brut'),
  e('base-legacy-hybrid-gpu-raw', 'exhaustive', 'baseLegacyHybridGpu', 'raw', 'greedy', 'Base legacy fp32/q4 WebGPU · brut'),
  e('base-v4-compact-gpu-raw', 'exhaustive', 'baseV4CompactGpu', 'raw', 'greedy', 'Base ONNX fp16/q4f16 WebGPU · contrôle'),
  e('base-v4-fp16-gpu-raw', 'exhaustive', 'baseV4Fp16Gpu', 'raw', 'greedy', 'Base ONNX fp16 WebGPU · contrôle'),
  e('base-v4-q8-wasm-ort-all-control', 'exhaustive', 'baseV4Q8WasmAggressive', 'raw', 'greedy', 'Base ONNX q8 WASM · ORT all · contrôle')
]

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

  const opts = { progress_callback: x => onProgress?.(x) };
  const tokenizer = await AutoTokenizer.from_pretrained(spec.modelId, opts);
  const processor = await AutoProcessor.from_pretrained(spec.modelId, opts);
  if (!processor?.feature_extractor) throw new Error('feature_extractor absent');

  const model = await WhisperForConditionalGeneration.from_pretrained(spec.modelId, {
    device: spec.device,
    dtype: spec.dtype,
    session_options: {
      graphOptimizationLevel: spec.graphOptimizationLevel
    },
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
  return spec.modelId;
}

export function dtypeLabel(spec) {
  return typeof spec.dtype === 'string'
    ? spec.dtype
    : Object.entries(spec.dtype).map(([k, v]) => `${k}=${v}`).join(',');
}

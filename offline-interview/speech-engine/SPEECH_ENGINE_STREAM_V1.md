# Offline Interview — Speech Engine Stream v1

Status: ACTIVE EXPERIMENT STREAM / NO PRODUCT PROMOTION
Shared boundary: `offline-interview.speech-engine-contract.v1`

## Mission

Qualify the best transcription provider for Offline Interview independently of application-product development.

The stream is responsible for transcription quality and provider behavior. It is not responsible for interview UX, persistence, media controls or product lifecycle.

## Evidence carried forward

### Android system/default recognizer

The frozen `fr-FR-v1` v3 physical benchmark on Samsung SM-S911B / Android 16 completed 6/6 passages after lossless inter-session stitching, with no blocking errors, but finished at:
- global normalized WER ~13.57%;
- critical entity accuracy 80%;
- four passages below 95% word coverage;
- one of two critical-meaning checks missing;
- verdict `PIVOT_NATIVE_ENGINE`.

This closes timing/rearm/stitching micro-iteration for system-default long-form authority. It does **not** forbid use as a provisional product draft provider.

Historical evidence: PR #98 -> #99 -> #100.

### Embedded PCM architecture

PR #96 proved an embedded Vosk provider could consume product-owned PCM/WAV offline without blocking capture. The architecture gate passed; quality remained a separate question.

PR #97 established a dual-provider benchmark direction (Vosk + Whisper/sherpa) and replayable qualification-bundle concept. It remains experimental evidence, not a product integration design.

## Provider classes

### SYSTEM_NATIVE_DRAFT

Examples:
- Android `SpeechRecognizer.createSpeechRecognizer()`;
- Android `createOnDeviceSpeechRecognizer()` when used through system microphone lifecycle.

Can support immediate UX draft text. Not eligible for durable/replayable authority unless the provider can be proven against product-owned audio without speech loss.

### PCM_DURABLE_PROVIDER

Consumes product-owned PCM/WAV through `PCM16_PUSH` or replay input.

Eligible for durable qualification because the same audio can be replayed across providers and versions.

Candidates already evidenced:
- Vosk Android;
- Whisper via sherpa-onnx.

## S1 next experiment — provider decision benchmark

Do not ask the user to repeatedly read new text merely to compare providers.

The next benchmark should prefer one product-owned master WAV/corpus and replay the same signal through competing PCM-capable engines. Where explicit Android on-device SpeechRecognizer cannot consume the same PCM through a supported, proven path, treat it as a separate draft-provider control rather than pretending the comparison is acoustically identical.

Required comparison dimensions:
- normalized WER / CER;
- word coverage;
- critical entities;
- critical meaning (`PRESENT_CORRECT`, `MISSING`, `CONTRADICTED`);
- latency / real-time factor;
- streaming capability;
- offline/network requirement;
- CPU/RAM/storage/APK impact;
- deterministic replayability;
- failure isolation from master audio.

## Decision policy

A provider can become `ASR_PROVIDER_QUALIFIED` only when its target role is explicit.

For durable long-form role, minimum expectations remain:
- no product-audio loss attributable to provider lifecycle;
- replay from product-owned audio;
- complete passage/turn coverage;
- no missing/contradicted critical meaning in the qualification corpus;
- quality materially sufficient for product use, measured on the same reference corpus/audio where possible.

Do not select a provider merely because its APK is small or because it is native to the OS.

Do not select a heavier provider merely because its benchmark WER is marginally better if latency, memory, battery or packaging cost is disproportionate to product value.

## Product handoff

When this stream qualifies a provider, hand off only:
- provider identity/version/model identity;
- exact capability descriptor;
- adapter behavior required by `SpeechEngineContract v1`;
- measured quality/resource evidence;
- product integration constraints;
- rollback/fallback behavior.

Product Stream then performs a fresh integration solve from its current protected baseline.

## Stop conditions

- Stop native-system timing/rearm iteration after the v3 `PIVOT_NATIVE_ENGINE` evidence.
- Continue provider comparison only while it can materially change the provider decision.
- Stop and hand off when one provider is sufficiently qualified for the desired role or when product requirements materially change the gate.

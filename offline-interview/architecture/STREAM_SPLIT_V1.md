# Offline Interview — Two-Stream Architecture v1

Status: FOUNDATION / NOT A PRODUCT PROMOTION
Base: H4 physical-stability head `9bf655d92468cb6c9d34b51ccd1100c5d2c1adcf`

## Decision

Offline Interview advances through exactly two delivery streams with one shared boundary contract.

1. **STREAM PRODUCT** owns the application and the authoritative user session.
2. **STREAM SPEECH ENGINE** owns transcription providers, benchmarks and provider qualification.

`SpeechEngineContract v1` is a boundary shared by both streams. It is not a third stream and it owns no product state.

## Non-negotiable invariants

### Product owns audio and user state

The product is the authority for:
- microphone permission and interview lifecycle;
- one continuous master `AudioRecord -> PCM/WAV` capture where supported by the product runtime;
- question/turn boundaries and timestamps;
- local persistence, resume/recovery and export;
- user edits and `human_lock`;
- final product result schema.

No speech provider may become the authority for whether audio existed or for the user's final edited text.

### Speech is replaceable

A speech provider may produce PARTIAL, FINAL and ERROR events, but the application must remain usable when transcription is unavailable or degraded.

Provider output is classified as one of:
- `DRAFT`: convenience text, never authoritative over audio or a human lock;
- `DURABLE_PROVIDER`: replayable provider output produced from product-owned PCM/WAV;
- `HUMAN_LOCK`: final user-controlled text; this is a product authority, not a speech-engine authority.

### Native Android is a provisional draft provider

The Android system recognizer may remain available for immediate draft UX. Its output is not a durable long-form authority unless a future qualification proves replayable, lossless behavior from product-owned audio.

The physical v3 benchmark decision `PIVOT_NATIVE_ENGINE` therefore does not block Product Stream progress.

### Product maturity and ASR maturity are independent

Required state dimensions:
- `APP_BETA_READY`: application reliability/usability gate;
- `ASR_PROVIDER_QUALIFIED`: provider quality/replay gate;
- `PRODUCT_QUALIFIED`: release gate that combines the required product and provider levels.

`APP_BETA_READY=PASS` is allowed while `ASR_PROVIDER_QUALIFIED=HOLD`.

## STREAM PRODUCT responsibility

Owns:
- interview/questionnaire loading and navigation;
- recording lifecycle and master audio durability;
- boundaries, persistence and recovery;
- interruption behavior;
- Bluetooth/media-session controls when applicable;
- screen-lock controls when applicable;
- transcript presentation/editing and human lock;
- diagnostics, export and install/update behavior;
- product acceptance tests and physical product gates.

Does **not** own:
- WER/CER research;
- provider model selection;
- model packaging experiments;
- provider-vs-provider benchmark logic.

The first Product Stream increment may keep the physically stable H4 transcription behavior as a provisional `SYSTEM_NATIVE_DRAFT` while product concerns advance.

## STREAM SPEECH ENGINE responsibility

Owns:
- `fr-FR-v1` benchmark corpus and scoring evolution under corpus-version rules;
- native Android default/on-device provider evaluation;
- embedded/replayable provider evaluation (Vosk, Whisper/sherpa and successors);
- WER/CER, critical entities and critical-meaning gates;
- latency, real-time factor, CPU/RAM/storage/APK impact;
- streaming/offline/network capability evidence;
- replay benchmarks against the same captured audio;
- provider recommendation and qualification packets.

Does **not** own:
- interview navigation;
- product persistence UX;
- resume/kill recovery;
- product media controls;
- final user text authority.

A Speech Engine Lab APK may exist, but it is a measurement harness, not the product.

## Shared contract boundary

The application supplies a turn context and, for PCM-capable engines, product-owned PCM chunks or a replayable audio reference. The provider returns transcript events and declares its capabilities.

Two input modes are intentionally distinct:
- `SYSTEM_MICROPHONE`: provider controls its own microphone path; suitable for provisional draft UX only unless separately qualified.
- `PCM16_PUSH`: provider consumes product-owned PCM; eligible for durable/replayable qualification.

The contract must not force `SpeechRecognizer` injected-audio semantics onto all providers.

## Branch genealogy

Protected historical evidence remains unchanged:
- Product/stability lineage: PR #90 -> PR #91 -> PR #92 / H4.
- Native long-form qualification lineage: PR #98 -> #99 -> #100.
- Embedded provider lineage: PR #96 -> #97.

This foundation starts from exact H4 head and does not merge any experiment branch into the product.

## Integration rule

`EXPERIMENT_PASS != INTEGRATION_DESIGN_PASS`.

When Speech Stream qualifies a provider, Product Stream re-enters solve from its current protected product baseline and integrates only the minimum provider adapter required by the shared contract. Prototype architecture is not copied wholesale.

## Near-term trajectory

### Product Stream P1

Goal: produce a recognizable Offline Interview alpha/beta application without waiting for a final ASR choice.

Preserve H4 audio stability and productization surfaces. Reclassify the current native recognizer as draft-only. Establish independent product gates and a product backlog for persistence/resume, interruptions, Bluetooth/media controls, UX and export.

### Speech Stream S1

Goal: establish the provider lane and replayable benchmark contract independently of product UX.

Carry forward the v3 `PIVOT_NATIVE_ENGINE` finding, preserve the frozen benchmark corpus, and compare native on-device and PCM-capable providers without product-stream mutations.

## Stop conditions

Stop Product Stream only for a product safety/data-loss defect, not because ASR quality is below target.

Stop Speech Stream provider iteration when a provider is qualified for the intended product role or when a new human/product requirement materially changes the provider gate.

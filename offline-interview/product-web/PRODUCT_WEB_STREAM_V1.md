# STREAM PRODUCT / WEB APP V1

Status: CANDIDATE

## Baseline

Product surface: `offline-interview/beta-v41-23`.

Repository baseline at split: `main` `4ca38681475282e58d9145c62e894c056528473e`.

The Web shell is the Offline Interview product: setup, participants, desktop/mobile question navigation, question intent, follow-ups, conversation/manual entry, capture dock, review and export.

A 2026-09-13 physical run established the current causal boundary: the interview completed, Web audio was finalized/decoded/validated with no capture gaps, while browser system transcription returned no text. Product/audio readiness and transcription readiness are therefore independent.

## Ownership

This stream owns:

- product UX and information architecture;
- questionnaire loading and authoring-facing behavior;
- interview/question state and navigation;
- participants and follow-ups;
- current Web audio capture lifecycle and product-owned `audioRef` identity while that path remains healthy;
- transcript display, manual correction and human truth;
- review/export UX;
- browser persistence/PWA/offline behavior;
- product accessibility and product acceptance.

It consumes `offline-interview.transcription-engine-contract.v1` and does not select or benchmark ASR engines.

## Non-ownership

This stream does not own:

- provider selection or model internals;
- provider WER/CER benchmarking;
- Android SpeechRecognizer lifecycle;
- Vosk/Whisper/sherpa implementation details;
- provider retry policy beyond Product-visible status/actions.

## Product / transcription invariants

- a valid audio answer remains an answer even if transcription is unavailable;
- Product-owned audio must survive provider failure;
- provider text is draft until human acceptance;
- human-edited or human-locked text cannot be silently overwritten;
- provider identity mismatch must never attach text to another turn;
- the same recorded audio must remain eligible for later retranscription by a replayable provider.

## Current gates

`WEB_PRODUCT_READY = PHYSICAL_CORE_PASS_TRANSCRIPTION_INDEPENDENT`

`TRANSCRIPTION_INTEGRATION_READY = CANDIDATE_AUTOMATED`

`TRANSCRIPTION_PROVIDER_QUALIFIED = HOLD_PROVIDER_DECISION_BENCHMARK`

The next human gate is intentionally short: one spoken answer in V41.23, verify audio persists, verify transcription success or explicit unavailability is attached to the same turn, and verify provider failure never loses the answer/audio.

## Next product work after integration gate

Product work can continue on persistence/resume, interruption-safe UX, stronger review/editing and export ergonomics without waiting for final provider qualification.

# STREAM NATIVE SPEECH CAPABILITY V1

Status: CANDIDATE

## Mission

Provide Android/device speech and audio capabilities to the existing Web product without becoming a second product application.

## Evidence baseline

Repository baseline at split: `main` `4ca38681475282e58d9145c62e894c056528473e`.

Carry forward as evidence, not automatic integration:

- H4 and successors: native capture/SpeechRecognizer lifecycle evidence;
- #96: embedded Vosk PCM architecture evidence;
- #97: replayable Vosk/Whisper comparison direction;
- #98/#99/#100: system-default Android benchmark evidence and stop condition against more timing/rearm micro-tuning.

## Ownership

This stream owns:

- Android microphone permissions/lifecycle;
- physical AudioRecord/PCM/WAV implementation for native-host mode;
- audio health and native device diagnostics;
- audio focus/interruption mechanics requiring Android APIs;
- SpeechRecognizer adapters;
- alternative ASR providers and provider benchmarks;
- latency/resource/offline measurements;
- lab/test APKs;
- a minimal trusted native host/bridge spike when required.

## Non-ownership

This stream must not implement or redesign:

- questionnaire setup;
- question navigation;
- participants;
- question intent/follow-ups;
- conversation/review UI;
- human-final transcript authority;
- product export UX.

Those remain Product Web responsibilities.

## Contract

The only shared boundary is `offline-interview.speech-capability-contract.v1`.

Native providers receive product-owned session/turn identifiers and return capability/audio/transcript/diagnostic events. Provider `FINAL` means provider-final only; it is never equivalent to human-final product truth.

## N1 gate — host/bridge feasibility

Do not begin another system-default ASR tuning cycle.

The next native integration experiment is a bounded host/bridge proof. It should establish, with the smallest implementation possible:

1. the V41.23 Web assets can be hosted as trusted local content;
2. the Web side can request `GET_CAPABILITIES`;
3. native returns `CAPABILITIES` through the contract;
4. one bounded capture-state command/event round trip works without native code changing the active question;
5. bridge exposure is restricted to trusted content;
6. failure of the native capability leaves the Web interview state intact.

Prefer Android WebView local asset loading with a restricted bridge over duplicating product screens. Do not grant bridge access to arbitrary remote pages.

A full production Android wrapper is not implied by N1. N1 is a feasibility/contract gate.

## ASR gate remains separate

`ASR_PROVIDER_QUALIFIED` is independent from `NATIVE_CAPABILITY_READY`.

System-native transcription may remain a draft provider while PCM-capable engines are compared using the same recorded audio where technically possible.

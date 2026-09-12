# STREAM PRODUCT / WEB APP V1

Status: CANDIDATE

## Baseline

Product surface: `offline-interview/beta-v41-23`.

Repository baseline at split: `main` `4ca38681475282e58d9145c62e894c056528473e`.

The shared Web shell already provides the real Offline Interview product experience: setup, participants, desktop/mobile question navigation, question intent, follow-ups, conversation/manual entry, capture dock, review and export. V41.23 wraps that surface in the current product-coherent runtime.

## Ownership

This stream owns:

- product UX and information architecture;
- questionnaire loading and authoring-facing behavior;
- interview/question state and navigation;
- participants and follow-ups;
- transcript display, manual correction and human truth;
- review/export UX;
- browser persistence/PWA/offline behavior;
- product accessibility and product acceptance.

It consumes `offline-interview.speech-capability-contract.v1` but does not choose or benchmark ASR engines.

## Non-ownership

This stream does not own:

- Android AudioRecord implementation;
- SpeechRecognizer lifecycle;
- Vosk/Whisper/sherpa provider internals;
- native audio focus/device integration;
- provider WER/CER benchmarking.

## W1 gate — Web product requalification

Before new product features, physically re-establish the V41.23 baseline on the intended browser/mobile surfaces.

PASS requires:

- setup loads;
- questionnaire navigation works from sidebar and compact/mobile navigation;
- question intent and follow-ups remain usable;
- capture interaction does not lose interview state when live transcription is unavailable;
- manual entry/review remains usable;
- interview can finish and export JSON/TXT;
- no product-blocking console/runtime failure;
- the Web/PWA surface remains usable without any native host.

No WER threshold belongs to W1.

## Next product work after W1

Product work can then proceed on persistence/resume, interruption-safe UX, stronger review/editing, export ergonomics and other product priorities without waiting for `ASR_PROVIDER_QUALIFIED`.

An Android host, when introduced, must host this same Web product rather than replace it with a second product UI.

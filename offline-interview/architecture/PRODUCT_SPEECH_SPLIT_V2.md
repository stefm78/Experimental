# Offline Interview — Product / Native Speech split V2

Status: CANDIDATE FOUNDATION

## Correction

The previous split incorrectly treated the Android H4 runtime as the Product application. The repository evidence shows that the product experience already exists as the Web/PWA runtime under `offline-interview/beta-v41-23`, generated from the richer shared Web shell in `offline-interview/beta`.

The corrected trajectory has exactly two active streams.

## STREAM PRODUCT / WEB APP

Baseline surface: `offline-interview/beta-v41-23`.

Owns product semantics and UX:

- setup/questionnaire loading;
- participants;
- question navigation on desktop/mobile;
- question intent and follow-ups;
- interview state and progression;
- conversation/review/correction surfaces;
- end-of-interview export;
- Web/PWA persistence/offline/accessibility;
- human-authoritative text state;
- product acceptance.

The Product stream may consume transcript/audio capability events but no capability provider may navigate the interview or finalize human truth.

## STREAM NATIVE SPEECH CAPABILITY

Owns device/platform mechanisms:

- Android microphone permission/lifecycle;
- continuous PCM/WAV capture implementation in a native host;
- audio integrity, audio focus and platform interruption handling;
- ASR adapters/providers and provider qualification;
- latency/resource/device diagnostics;
- lab APKs;
- a thin Android host/bridge only when needed to expose native capabilities to the Web product.

Does not own questionnaire UX, navigation, participants, follow-ups, final review/export UX or product truth.

## Shared boundary — not a third stream

`offline-interview.speech-capability-contract.v1` is the only shared interface.

Product owns semantic session/turn identities and commands. Capability implementations return state, audio references, transcript suggestions and diagnostics.

Physical audio storage may live behind the capability implementation, but the provider cannot silently discard audio because ASR failed. Recorded audio must remain replayable/retranscribable independently of the current ASR provider.

## Runtime topology

### Standalone browser/PWA

V41.23 continues to run with browser-backed capture/STT behavior. ASR is best-effort and does not define product readiness.

### Android

Preferred integration direction is a thin native host for the same Web product, not a second Android product UI.

A host proof must establish:

1. trusted local Web product assets boot;
2. capability discovery round-trip works;
3. at least one bounded native command/event round-trip works;
4. native code cannot mutate question navigation directly;
5. bridge is exposed only to trusted content;
6. browser/PWA mode remains independent.

No full wrapper is authorized merely by this architecture document; the first host work is a bounded feasibility spike.

## Independent gates

- `WEB_PRODUCT_READY`: Web application product behavior is qualified independently of final ASR quality.
- `NATIVE_CAPABILITY_READY`: Android capability adapter/bridge and audio integrity are qualified independently of provider WER.
- `ASR_PROVIDER_QUALIFIED`: one provider separately satisfies quality/performance/offline requirements.
- `ANDROID_PRODUCT_INTEGRATION_READY`: same Web product plus native capability host passes integrated physical validation.

## Historical evidence treatment

- V41.23: protected Web product baseline.
- Android H4/H5/H6/H7: native capability / SpeechRecognizer engineering evidence, not Product UX baseline.
- #96 Vosk: embedded PCM architecture evidence.
- #97 Vosk/Whisper: replay/provider comparison evidence.
- #98/#99/#100: system-default Android benchmark evidence; final direction remains pivot away from more timing/rearm micro-tuning.
- #101/#102: superseded split framing once corrected successor PRs are established.

## Anti-coupling rules

- Product PRs must not introduce/benchmark ASR models.
- Native Speech PRs must not redesign or duplicate Web product UX.
- A provider PASS is not permission to copy prototype architecture into Product; integration gets a fresh solve against the current Product baseline.
- Product remains usable when ASR is unavailable; audio/text recovery semantics must degrade explicitly rather than destroying interview state.

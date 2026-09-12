# /AUDIT /SOLVE /BUILD — Offline Interview two-stream correction V2

## Mission

Correct the Offline Interview trajectory after re-establishing that the real product experience is the Web/PWA application under `offline-interview/beta-v41-23`, not the Android H4 laboratory/runtime.

Repository: `stefm78/Experimental`.

Authoritative repository baseline for this correction: `main` at `4ca38681475282e58d9145c62e894c056528473e` unless a fresh read proves it changed before mutation.

Do not merge historical experimental PRs merely to simplify lineage. Preserve their evidence.

## 1. Reconstruct before mutation

Audit exact Git state and current PR state. In particular, verify:

- Web product candidate `offline-interview/beta-v41-23` and its product-coherence test;
- shared `offline-interview/beta` shell/runtime from which V41.23 is generated;
- Android native H4 and later ASR evidence;
- PR #101 and #102 created by the previous split;
- native benchmark evidence #96/#97/#98/#99/#100.

Treat statements in this prompt as continuity hints, not authority.

## 2. Correct product identity

The Product Stream is the Web/PWA application.

Its protected UX/product baseline is V41.23. It owns:

- setup and questionnaire loading;
- rich question presentation;
- sidebar/mobile question navigation;
- participants;
- question intent and planned/ad-hoc follow-ups;
- interview lifecycle and product state;
- manual turns and transcript review/correction;
- `human_lock` / human-authored truth semantics where applicable;
- end-of-interview review and export;
- PWA/offline behavior, browser persistence and accessibility;
- product acceptance.

Do not rebuild these surfaces natively merely because Android capabilities are needed.

## 3. Native/Speech responsibility

The sibling Native Speech Capability Stream owns device-specific capabilities, not product UX:

- Android microphone permissions and lifecycle;
- authoritative physical audio capture implementation when running in a native host;
- continuous PCM/WAV integrity;
- audio focus/interruption behavior that requires Android APIs;
- SpeechRecognizer and alternative ASR providers;
- provider benchmarking and qualification;
- device diagnostics and resource/latency measurements;
- a laboratory/test APK and, only when justified, a thin Android host for the Web product.

It must not own questionnaire navigation, question presentation, participants, follow-ups, review UI, export UX or product truth.

## 4. Exactly two streams

Create exactly two active streams:

1. `PRODUCT / WEB APP`
2. `NATIVE SPEECH CAPABILITY`

The capability contract between them is a shared boundary, not a third stream.

Supersede the previous framing in which H4 was treated as the Product application. Do not destroy its evidence.

## 5. Shared contract

Create a language-neutral `offline-interview.speech-capability-contract.v1`.

The contract must keep semantic product authority in the Web app while allowing a capability provider to implement audio/STT.

At minimum model:

### Product -> capability commands

- `GET_CAPABILITIES`
- `START_CAPTURE(sessionId, turnId, language)`
- `SET_ACTIVE_TURN(turnId)`
- `PAUSE_CAPTURE`
- `RESUME_CAPTURE`
- `STOP_CAPTURE`
- `REQUEST_DIAGNOSTIC`

### Capability -> product events

- `CAPABILITIES`
- `CAPTURE_STATE`
- `AUDIO_HEALTH`
- `TRANSCRIPT_PARTIAL`
- `TRANSCRIPT_FINAL`
- `AUDIO_REFERENCE`
- `DIAGNOSTIC`
- `ERROR`

Required invariants:

- capability events can suggest transcript text but cannot finalize human truth;
- capability layer cannot advance/change the current question;
- capability layer cannot create/delete participants or follow-ups;
- capability layer cannot end the interview except by reporting a fatal capability failure;
- product owns `sessionId` and `turnId` semantics;
- physical audio bytes may be stored by the native capability, but their lifecycle and reference are controlled by product commands/state;
- ASR failure must not erase the audio asset or invalidate the interview;
- a recording can be retranscribed by another provider later.

## 6. Runtime modes

Support the same Web product through adapters:

### Standalone Web/PWA

Use current browser capabilities and existing V41.23 behavior. Browser ASR remains best-effort.

### Android native host

Do not create a second product UX. Prefer a thin host of the Web application with a narrowly scoped bridge to native capabilities.

Before committing to a full wrapper, prove a minimal spike:

- V41.23 assets can boot in the host;
- Web product can query capabilities;
- one command/event round trip works;
- no native code controls question navigation;
- bridge is restricted to trusted local/origin content;
- standalone browser mode remains functional.

Use a safe local WebView asset-loading mechanism rather than granting an unrestricted bridge to arbitrary remote content.

## 7. Speech provider trajectory

Do not reopen system-default SpeechRecognizer micro-tuning.

Carry forward evidence:

- system-default native is useful as `DRAFT` but not qualified as durable long-form authority;
- explicit Android on-device remains a bounded control candidate;
- Vosk/Whisper/sherpa or other PCM providers may compete as durable providers;
- comparisons should prefer the same product-owned WAV/PCM input when technically possible.

Provider qualification remains independent of Product Stream progress.

## 8. Gates

Keep gates independent:

`WEB_PRODUCT_READY`
- V41.23 core UX/regression tests pass;
- normal interview navigation/presentation/export works;
- no dependency on final ASR quality.

`NATIVE_CAPABILITY_READY`
- native capture/bridge contract works;
- audio remains healthy if ASR fails;
- no product authority leak into native code.

`ASR_PROVIDER_QUALIFIED`
- provider passes the separate quality/latency/offline criteria.

`ANDROID_PRODUCT_INTEGRATION_READY`
- Web product + native capability bridge pass an integrated physical test.

Do not collapse these gates.

## 9. Git trajectory

Create a small shared foundation from current `main`, containing only the corrected architecture, language-neutral contract and tests.

Then branch exactly two successors from that foundation:

- `offline-interview-product-web-v1`
- `offline-interview-native-speech-capability-v1`

Open two draft PRs against `main`.

The Product PR must not mutate Android native runtime/ASR implementation.
The Native Speech PR must not mutate V41.23 product UX.

Mark PR #101 and #102 as superseded by this corrected split once both successor PRs exist and their basic CI/contract tests pass. Do not merge them.

## 10. First increments

### Product Web P1

Preserve V41.23 behavior and add only the minimum stream declaration/tests needed to make it the explicit product baseline.

Do not redesign the UI in this increment.

### Native Speech N1

Preserve ASR evidence and define the native capability adapter/host spike boundary.

Do not implement another ASR timing iteration.

If proportionate, build only the smallest host/bridge spike needed to prove feasibility; otherwise stop at a mechanically testable contract and explicit next build plan.

## 11. Acceptance

PASS for this trajectory correction requires:

- evidence that V41.23 is recognized as Product baseline;
- exactly two active streams;
- one language-neutral shared capability contract;
- Product and Native ownership boundaries mechanically testable;
- #101/#102 clearly superseded, not merged;
- new Product and Native PRs based from the same corrected foundation;
- no Vosk/Whisper/native experimental implementation copied into Product;
- no Web product UX copied into the native Speech stream;
- CI/contracts green or a precisely identified non-product blocker;
- explicit next physical gate for each stream.

Advance autonomously until the next real human/physical gate. Do not ask for information available in GitHub.
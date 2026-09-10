# Research notes — mobile system dictation strategy

## Findings

### Android keyboard dictation
Google documents that Gboard voice typing can be used in most places where text can be entered. The user focuses a text field and taps the microphone on the keyboard. Advanced voice typing on supported Pixel devices can keep the microphone active for multiple messages and performs much of the dictation on-device.

This is a promising *user-mediated text entry* path, but it is not a Web API controlled by the page. A web application should therefore present a normal focusable text field and instructions, not assume it can start the keyboard microphone programmatically.

### Android microphone coexistence risk
Android's audio-input sharing policy is the main architectural risk. Android documents that two ordinary applications cannot simultaneously receive microphone audio; depending on priority, one capture can be silenced. Privileged assistants/accessibility services are special cases. Therefore the fact that Gboard/system dictation works inside a text field does not prove that a browser MediaRecorder can keep receiving valid master audio at the same time.

This is why coexistence must be field-tested on representative Android devices rather than inferred from keyboard behavior.

### iPhone/iPad dictation
Apple documents that Dictation can insert text anywhere the user can type. In many languages requests are processed on-device, and typing and dictation can be used together. As on Android, this is an OS keyboard feature controlled by the user. A web page can receive the resulting text through its focused input, but should not treat the dictation control itself as a browser API.

A separate iPhone coexistence test is still required because simultaneous microphone/audio-session behavior must not be assumed from Android results.

### Native speech APIs
If Offline Interview eventually becomes a native or hybrid application, both platforms provide first-party speech-recognition APIs: Android `SpeechRecognizer` (including an on-device recognizer factory where available) and Apple's Speech framework (`SFSpeechRecognizer`, including requests for prerecorded audio files or live buffers). These are application APIs, not capabilities that a normal PWA can directly substitute for keyboard dictation.

Android explicitly warns that its general SpeechRecognizer API is not intended for continuous recognition because implementations may stream audio remotely and continuous use can consume battery/bandwidth. This makes it a poor reason, by itself, to abandon the audio-authoritative architecture.

## Architecture options after the fail-fast tests

1. **OS dictation as optional mobile text accelerator.** Lowest integration cost and potentially excellent UX, but user-mediated and only acceptable if master-audio coexistence passes per platform/device family.
2. **Current audio-authoritative browser capture + best-effort LIVE STT.** Remains the safest qualified baseline when transcription is unavailable or unreliable.
3. **Independent asynchronous backend transcription.** Best candidate for automatic true parallelism because it does not require a second browser SpeechRecognition session; adds privacy, network, cost, retry and server infrastructure considerations.
4. **Native/hybrid mobile shell using platform speech APIs.** Highest implementation cost but materially greater control over platform speech services, permissions, background work and audio-session handling; relevant only if browser/PWA constraints become product-limiting.
5. **Post-turn near-line transcription.** Continue recording one immutable master stream; process just-closed turn windows when the live recognizer is idle. Lower architectural risk than concurrency but not true simultaneous transcription.

## Recommended sequence

Run the isolated system-dictation coexistence experiment first on Android because the current product work is temporarily centered there. If it passes technically and playback confirms no audio loss, test the same harness on iPhone. Only after those results should product UX be changed. If Android fails, do not spend product complexity on keyboard dictation; move directly to an independent backend/native discriminator if automatic parallel transcription remains a requirement.

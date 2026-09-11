# Offline Interview — Android Native STT POC v1

Status: EXPERIMENTAL / NOT PROMOTED

## Decision

The browser/Voice Access route is closed as the primary product architecture. The replacement architecture is a native Android shell where the application owns the microphone exactly once.

Primary candidate:

`AudioRecord -> PCM fan-out -> WAV master + Android SpeechRecognizer(on-device, EXTRA_AUDIO_SOURCE)`

Fallback candidate:

`AudioRecord -> PCM fan-out -> WAV master + embedded ASR engine (sherpa-onnx / Vosk / whisper.cpp-class engine)`

The UI never owns the microphone and the STT layer never owns canonical human text.

## Why this architecture

Android API 33 adds `RecognizerIntent.EXTRA_AUDIO_SOURCE`: an already-opened audio source can be supplied to the recognizer using a `ParcelFileDescriptor`. Together with `EXTRA_SEGMENTED_SESSION`, the session can consume the app-provided audio until the source is closed. This creates a direct path to single-capture audio ownership instead of two independent microphone consumers.

`SpeechRecognizer.createOnDeviceSpeechRecognizer()` exists from API 31. API 33 adds `checkRecognitionSupport()` / `RecognitionSupport` and model/language support discovery. The provider remains device-dependent, so this path must be field-qualified and cannot be treated as universally supported.

The Android `SpeechRecognizer` documentation explicitly says the traditional API is not intended for indefinite continuous recognition. The POC therefore tests the newer injected-audio segmented-session path rather than assuming classic repeated microphone sessions are product-safe.

## POC scope

- Android 13 / API 33 minimum.
- Native `AudioRecord`, 16 kHz mono PCM16.
- One authoritative microphone capture.
- Same PCM bytes written to:
  1. a WAV master file;
  2. a pipe supplied to Android `SpeechRecognizer` with `EXTRA_AUDIO_SOURCE`.
- `EXTRA_SEGMENTED_SESSION = EXTRA_AUDIO_SOURCE`.
- French free-form on-device recognition.
- Partial/final/segment transcript events.
- Three question boundaries timestamped against the capture session.
- Read-only transcript UI: no `EditText`, no soft keyboard, no browser focus problem.
- Human validation snapshots canonical text; later STT updates only the draft and never overwrite the human-validated value.
- JSON export includes audio authority, WAV path, PCM byte count, turn boundaries, transcript events, and canonical/draft state.

## Qualification questions

1. Does the installed on-device provider actually honor `EXTRA_AUDIO_SOURCE`?
2. Does the WAV remain continuous and intelligible while STT consumes the same PCM?
3. Are partial/segment results returned with acceptable latency in French?
4. Does the provider keep the segmented session alive across several minutes and question boundaries?
5. If the provider closes the pipe or errors, does the WAV master continue unaffected?
6. Are transcript events assignable to turns from capture timestamps without UI focus/routing errors?

## Verdict model

- `GO_SYSTEM_STT`: injected on-device `SpeechRecognizer` works continuously enough and the WAV master remains intact.
- `HOLD_PROVIDER_VARIABILITY`: architecture works but provider/device support is inconsistent; add embedded ASR fallback.
- `REJECT_SYSTEM_STT`: provider does not honor injected audio or session behavior is unsuitable; keep the same native capture architecture and replace only the STT provider with embedded ASR.
- `FAIL_MASTER_CAPTURE`: master WAV is interrupted/corrupted. This blocks the architecture.

## Architecture boundary

The important product commitment is not Android `SpeechRecognizer` itself. It is the single native capture pipeline and the separation of authorities:

- **Audio authority**: app-owned PCM/WAV master.
- **Realtime STT draft**: replaceable provider output.
- **Turn routing**: timestamps / turn boundaries, not focused text fields.
- **Canonical transcript**: human-confirmed text wins permanently over later STT.
- **Post-processing**: may later use an embedded or backend recognizer against the same master without changing capture semantics.

## iOS portability

The same high-level architecture maps naturally to iOS: AVAudioEngine/audio buffers can feed both the recording path and `SFSpeechAudioBufferRecognitionRequest`; Apple also exposes partial results and an on-device requirement when supported. The implementations differ, but the authority model can remain common.

## Build

Open this directory in Android Studio or run Gradle with Android SDK 36 installed. The POC has no WebView and no external ASR dependency.

The next human gate is a physical Android test. Do not integrate into the qualified beta before that result.

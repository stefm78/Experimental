# Offline Interview — Android Voice Access coexistence prototype v1

## Objective

Qualify whether Android Voice Access can supply user-visible transcript text into an ordinary browser textarea while Offline Interview keeps a continuous master microphone recording intact.

This is an isolated experiment. It does not modify the qualified beta/runtime.

## Why this candidate

Google documents Voice Access as an Android accessibility feature that can control the device and edit text by voice, including commands such as starting text editing and typing words or phrases. French is supported.

Android's audio-input sharing documentation gives AccessibilityService a special coexistence rule: when the accessibility service UI is on top, both that service and an ordinary app can receive audio input. This makes Voice Access materially more promising than launching two browser SpeechRecognition instances, which already failed fast on the tested Android stack.

The browser cannot prove that the OS service currently listening is specifically Voice Access. Therefore the prototype combines machine telemetry with one explicit human attestation that Voice Access was actually used.

## Test protocol

Use the same Android phone and browser for A and B.

### A — baseline

1. Enable Android Voice Access under Settings > Accessibility > Voice Access.
2. Open this page.
3. Press `Démarrer A`.
4. Select `Réponse A` with Voice Access, say `Commencer la modification`, and dictate `alpha bravo test voice access`.
5. Press `Terminer A`.

A proves only that Voice Access can insert text into this web field without a competing browser capture.

### B — coexistence

1. Press `Démarrer B` and speak normally for about five seconds.
2. Press `Début Voice Access`.
3. Select `Réponse B`, start editing with Voice Access, and dictate continuously for 10–15 seconds.
4. Press `Fin Voice Access` and keep speaking for about five seconds.
5. Press `Arrêter B`.
6. Replay the complete audio and confirm that speech is intelligible before, during, and after the Voice Access window.
7. Confirm that Voice Access, not keyboard typing, supplied the B text.
8. Calculate the verdict and copy the JSON.

## Evidence collected

- browser/user agent and secure-context state;
- baseline and coexistence text plus browser input/composition events;
- master `MediaStreamTrack` `mute`, `unmute`, and `ended` events;
- MediaRecorder errors, bytes and MIME type;
- effective audio track settings where available;
- continuous RMS audio-energy samples split into before/during/after windows;
- audio playback artifact for human intelligibility review;
- explicit human confirmation that Voice Access generated B text;
- final coded verdict.

## Verdict semantics

- `INCONCLUSIVE_VOICE_ACCESS_BASELINE`: A failed; coexistence cannot be inferred.
- `HOLD_VOICE_ACCESS_CONFIRMATION_REQUIRED`: text exists but Voice Access use was not attested.
- `FAIL_FAST_VOICE_ACCESS_BLOCKED_DURING_CAPTURE`: Voice Access works in A but not while master capture is active.
- `FAIL_FAST_MASTER_CAPTURE_INTERRUPTED`: microphone track or recorder was interrupted.
- `FAIL_FAST_MASTER_AUDIO_ENERGY_GAP`: audio energy is not present across all three windows.
- `HUMAN_AUDIO_REVIEW_REQUIRED`: telemetry is positive but replay has not been qualified.
- `PASS_CANDIDATE_ANDROID_VOICE_ACCESS`: A and B insert text, Voice Access use is confirmed, capture stays intact, energy exists before/during/after, and human replay confirms continuous intelligible speech.

A PASS_CANDIDATE is platform/device/browser evidence, not a universal Android guarantee.

## Product implication if PASS_CANDIDATE

Do not immediately replace the current STT path. The next product prototype should treat:

- master audio as authoritative and continuous;
- system voice input as an optional mobile transcript-assist lane;
- text inserted by Voice Access as editable user text with explicit provenance;
- Web Speech as optional/best-effort rather than a competing mandatory microphone consumer;
- Voice Access activation as a voluntary user setup step, never silently enabled by the page.

## iOS follow-on

Apple Voice Control is the closest conceptual counterpart to Android Voice Access: it supports voice-driven UI control and text dictation/editing. iOS must be qualified independently because Android's documented AccessibilityService audio-sharing rule cannot be assumed to apply to Safari/iOS.

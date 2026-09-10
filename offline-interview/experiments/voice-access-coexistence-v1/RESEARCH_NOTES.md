# Research notes — Android Voice Access / iOS Voice Control

Date: 2026-09-10

## Android Voice Access

Primary Google documentation: Voice Access can control Android by voice and edit text. In editable fields it supports commands equivalent to `Start editing`, `Type [word or phrase]`, direct phrase dictation while the cursor is in the field, and `Stop editing`. French is supported.

Relevant official sources:
- https://support.google.com/accessibility/android/answer/6151854?hl=fr
- https://support.google.com/accessibility/android/answer/6151848?hl=fr

Voice Access is materially different from TalkBack. TalkBack is primarily a screen reader; it also supports voice commands, but requiring TalkBack would impose a screen-reader interaction model on users who do not need it. Voice Access is the better product candidate for hands-free control and text entry.

## Android audio-input coexistence

Android documents explicit audio-input sharing rules. For `AccessibilityService + ordinary app`, if the service UI is on top, both the accessibility service and the ordinary app receive audio input. This makes an accessibility-service-based voice-control lane architecturally distinct from two ordinary browser SpeechRecognition consumers.

Official source:
- https://developer.android.com/media/platform/sharing-audio-input

Important limitation: the browser cannot introspect whether Voice Access is the active accessibility service or prove its exact OS-level audio path. Therefore the experiment must combine telemetry with user attestation and replay of the master recording.

## Relationship to prior Offline Interview evidence

The tested Android dual-browser-SpeechRecognition architecture already failed fast: requesting the background recognizer caused the LIVE recognizer to abort within a few milliseconds. Voice Access is therefore being evaluated as a different system-level path, not as another Web Speech instance.

The prior keyboard-dictation coexistence experiment produced audio levels before/during/after without microphone mute/end/error, but no dictated text was captured, so it was correctly treated as inconclusive rather than as a pass.

## iOS counterpart

Apple Voice Control is the closest conceptual counterpart to Android Voice Access: system-level voice navigation plus dictation/editing. VoiceOver is primarily the screen reader, analogous to TalkBack. Standard Apple Dictation is analogous to keyboard dictation.

Relevant official Apple sources:
- https://support.apple.com/guide/iphone/use-voice-control-iph2c21a3c88/ios
- https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/ios

No Android-style AccessibilityService audio-sharing guarantee should be projected onto iOS. Safari/PWA + Voice Control coexistence must be tested independently.

## Architecture ranking after research

1. Android Voice Access + browser master audio — highest-priority fail-fast candidate for system voice input.
2. iOS Voice Control + browser master audio — analogous follow-on candidate, independently qualified.
3. Keyboard dictation — simpler UX, but microphone coexistence remains experimentally unresolved on the current Android evidence.
4. Independent asynchronous backend transcription — strongest automatic fallback if system voice input is unacceptable or unreliable.
5. Two simultaneous browser Web Speech recognizers — closed on the tested Android stack by FAIL_FAST evidence.

## Product constraints

Any future integration should preserve:
- continuous immutable master audio;
- no hard recorder splits from speaker changes;
- text is secondary to audio evidence;
- user edits are never silently overwritten;
- system accessibility features are opt-in and cannot be silently activated by JavaScript;
- prototype evidence is device/browser-specific until broadened by a qualification matrix.

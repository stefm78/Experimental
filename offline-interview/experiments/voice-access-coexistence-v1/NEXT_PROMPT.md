# Autonomous continuation prompt — Android Voice Access qualification

/research /audit /solve /build

Operate autonomously until the next genuine human-only gate.

## Objective

Determine whether Android Voice Access can become a viable optional mobile transcription-assist lane for Offline Interview while preserving the existing continuous master-audio authority model.

## Active evidence and constraints

- Dual simultaneous browser `SpeechRecognition` has failed fast on the tested Android stack and must not be reopened as the same architecture.
- The keyboard-dictation coexistence experiment showed apparently continuous master-audio telemetry but did not prove that system dictation actually inserted text.
- Android Voice Access can edit text by voice and is a different OS accessibility path.
- Android documents special microphone-sharing behavior for `AccessibilityService + ordinary app`; do not treat that as proof for this exact browser/device combination.
- Production and qualified beta runtimes must remain untouched until experimental evidence warrants a product change.
- Master audio remains continuous, immutable and authoritative. Never sacrifice audio integrity for transcript convenience.

## Execution

1. Revalidate governance and repository HEAD before any governed mutation.
2. Keep all work isolated under `offline-interview/experiments/voice-access-coexistence-v1/` unless a later explicit product-integration gate is reached.
3. Use the prototype to collect an A/B result on Android:
   - A: Voice Access inserts text with browser recording off.
   - B: Voice Access inserts text while browser `getUserMedia + MediaRecorder` remains continuously active.
4. Require machine evidence for track mute/end, recorder errors, non-empty recording, and audio energy before/during/after.
5. Require human confirmation that Voice Access actually generated B text and replay confirms intelligible speech continuously across the Voice Access interval.
6. Classify strictly as PASS_CANDIDATE / HOLD / INCONCLUSIVE / FAIL_FAST using the prototype's coded verdicts.
7. If FAIL_FAST, persist the evidence, close this architecture for the tested stack, and move to the next materially different candidate rather than tuning endlessly.
8. If PASS_CANDIDATE, persist the exact device/browser evidence and build the smallest product-like Android UX prototype that treats Voice Access as an optional assist lane, with explicit provenance and no changes to the master recorder.
9. Before product integration, qualify at least one additional Android browser/device configuration if available and assess activation friction/accessibility UX.
10. Only after Android evidence is strong, create an independently qualified iOS Voice Control experiment; do not project Android microphone-sharing rules to iOS.

## Stop condition

Stop only at a genuine human gate: the user must run the real Android Voice Access interaction and return the generated JSON plus the replay judgment. Do not fabricate that evidence.

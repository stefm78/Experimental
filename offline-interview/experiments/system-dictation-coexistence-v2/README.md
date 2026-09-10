# System dictation coexistence v2 — A/B fail-fast

Purpose: resolve the ambiguity left by the first Android/Edge field run.

The first run showed a technically intact master audio capture during the declared dictation window, but `dictatedText` stayed empty. That means capture continuity looked promising, yet system dictation itself was not proven.

V2 separates the two questions:

- **A — dictation-only baseline:** recorder OFF. The user focuses the textarea and uses the microphone from the system keyboard. If no text is inserted here, the test environment/instructions/keyboard path is not qualified and no coexistence conclusion is allowed.
- **B — recorder + dictation:** recorder ON continuously. The same keyboard dictation is used while `getUserMedia` + `MediaRecorder` remain active. The harness records input events, track mute/end, recorder errors, audio energy before/during/after, and produces a replayable master audio file.

## Decision matrix

- A FAIL => `INCONCLUSIVE_BASELINE_FAIL`
- A PASS + B no text => `FAIL_FAST_DICTATION_BLOCKED_DURING_CAPTURE`
- B text + master track mute/end/error => `FAIL_FAST_MASTER_CAPTURE_DAMAGED`
- B text + master audio energy collapse during dictation => `FAIL_FAST_MASTER_AUDIO_SILENT_DURING_DICTATION`
- A PASS + B PASS + intact technical capture but audio not human-reviewed => `HUMAN_AUDIO_REVIEW_REQUIRED`
- A PASS + B PASS + intact capture + audible master before/during/after => `PASS_CANDIDATE`

No product runtime is modified by this experiment. A PASS_CANDIDATE only qualifies system keyboard dictation as an optional mobile text-entry accelerator; it does not make it automatic and does not replace the audio-authoritative master recording.

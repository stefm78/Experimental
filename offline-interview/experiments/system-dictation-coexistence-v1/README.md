# System dictation coexistence — mobile fail-fast experiment

Goal: test whether the mobile operating system's keyboard dictation can be used as a low-friction transcription input while Offline Interview keeps an independent continuous master audio recording alive.

This is intentionally isolated from production and beta runtime code.

## Hypothesis

On Android and iPhone, a focused text field can receive OS/keyboard dictation. If that dictation can coexist with a browser `getUserMedia` + `MediaRecorder` capture without muting, ending, or corrupting the browser audio track, it may be a useful mobile UX path.

The experiment does **not** attempt to programmatically start system dictation. The user must invoke the microphone exposed by the system keyboard. This is a deliberate constraint: keyboard dictation is a user-owned OS capability, not a Web API controlled by the page.

## Protocol

1. Start continuous browser audio recording.
2. Speak normally for a few seconds.
3. Tap **Marquer début dictée**, then use the microphone on the system keyboard and dictate a distinctive sentence for roughly 8–12 seconds.
4. Stop system dictation, tap **Marquer fin dictée**, and keep speaking normally for another few seconds.
5. Stop browser recording.
6. Verify three independent signals:
   - dictated text arrived in the text area;
   - browser recorder and audio track stayed alive without `mute`, `ended`, or recorder error;
   - playback contains audible speech before, during, and after the dictation window.
7. Copy/export the JSON evidence if needed.

## Decision

- `PASS_CANDIDATE`: system dictation inserts text and browser master audio remains continuous and audible through the dictation interval.
- `FAIL_FAST`: invoking system dictation causes browser capture to stop, mute, go silent, error, or lose material audio.
- `INCONCLUSIVE`: dictation is unavailable, not exposed by the selected keyboard/language, or technical telemetry is insufficient; playback remains the final integrity check.

## Product implications

A PASS would justify testing a mobile-specific interaction where OS dictation is offered as an **optional text-entry accelerator**, while the master audio remains authoritative. It would not provide automatic background transcription and it would not replace the saved audio record.

A FAIL closes the keyboard-dictation-plus-continuous-recording path on that device/OS combination. The remaining credible route for true simultaneous transcription is an independent backend/native process fed from completed immutable audio spans.

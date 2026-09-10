# Live Transcribe coexistence V1

Purpose: determine whether Android Live Transcribe can keep producing real-time transcription while the Offline Interview browser page records one continuous master audio stream.

This is an isolated experiment. It does not modify the qualified Offline Interview beta/runtime.

## Protocol

1. Enable/open Android Live Transcribe and make sure it has microphone permission.
2. Return to this page and start the master recorder.
3. Speak for 30–60 seconds.
4. While the master recorder is still running, use the Android shortcut to view Live Transcribe and verify that fresh spoken words continue to appear. Return to the test page and press the marker button while recording remains active.
5. Continue speaking for several seconds, then stop the master recorder.
6. Replay the full audio and attest whether it is continuous before/during/after Live Transcribe activity.
7. Compute and copy the JSON verdict.

## Interpretation

`PASS_CANDIDATE_ANDROID_LIVE_TRANSCRIBE_COEXISTENCE` means coexistence was observed on the tested device/browser: Live Transcribe produced text while the browser master recorder remained intact and human replay confirmed continuity. It does **not** prove that Live Transcribe exposes a supported API for importing its transcript into the web application.

`FAIL_LIVE_TRANSCRIBE_NOT_CONCURRENT` means the user did not observe real-time Live Transcribe output during the master recording. `FAIL_MASTER_AUDIO_INTEGRITY` means browser capture was interrupted or materially broken.

Official Android documentation says two ordinary applications cannot both capture microphone input simultaneously, while privileged/accessibility scenarios can have different sharing behavior. Live Transcribe's exact runtime treatment is therefore empirical here rather than assumed.
# Android Voice Access coexistence v2

## Why this follow-up exists

The first Android Voice Access field test produced a strong positive result for microphone coexistence:

- Voice Access was explicitly confirmed as the system input method used.
- The master MediaRecorder stream had no `mute`, `ended` or recorder error.
- Audio energy remained present before/during/after the declared Voice Access window.
- Human replay confirmed speech was audible before/during/after.
- Voice Access ultimately inserted 239 characters into the answer field.

However, the first text insertion event in phase B occurred at `t=281273`, after the master recording had already stopped at `t=279156` (about 2.1 s later). Therefore v1 proves **coexistence of listening/capture**, but does not yet prove that text becomes available while the master recording remains active.

This v2 experiment closes that evidence gap.

## Question

Can Android Voice Access both listen and **commit text into the web field while the master MediaRecorder is still recording**, without damaging the master audio?

## Protocol

1. Activate Android Voice Access before opening the experiment.
2. Run baseline A without master recording and verify Voice Access inserts text.
3. Run B and keep the master recording active.
4. Start the Voice Access window and dictate the requested phrase.
5. **Do not stop the master recording yet.** Wait until the text visibly appears in the field.
6. Press **Text appeared** immediately when it is visible. The harness also timestamps the first browser input event automatically.
7. Continue speaking for several seconds, then stop the master recording.
8. Replay the audio and confirm continuity.
9. Calculate and copy the verdict JSON.

## PASS criteria

`PASS_CANDIDATE_ANDROID_VOICE_ACCESS_REALTIME_COMMIT` requires all of:

- baseline A proves Voice Access text insertion;
- Voice Access is human-confirmed as the input mechanism;
- B receives text while MediaRecorder state is still `recording`;
- master capture has no mute/end/error;
- audio energy remains present during the Voice Access interval;
- the human replay gate confirms speech is audible before/during/after.

## Other outcomes

- `PASS_CANDIDATE_ANDROID_VOICE_ACCESS_DEFERRED_COMMIT`: coexistence is good but the text commits only after capture ends or cannot be proven to commit while recording.
- `FAIL_FAST_MASTER_CAPTURE_INTERRUPTED`: Voice Access damages the master stream.
- `FAIL_FAST_MASTER_AUDIO_ENERGY_GAP`: the master stays nominally alive but loses meaningful audio energy.
- `INCONCLUSIVE_*`: baseline or human evidence is insufficient.

No production or qualified beta Offline Interview runtime is modified by this experiment.
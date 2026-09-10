# Voice Access field pilot v1

## Goal

Move beyond single-window coexistence and test a product-like three-turn interview on Android while preserving the Offline Interview architectural invariant: one continuous browser master audio recording remains authoritative.

Voice Access is treated only as an optional system text-entry lane. The page does not start, stop, own or automate Voice Access.

## Why this is the next discriminator

The preceding V2 test established on one Android/Edge device that Voice Access can insert text while MediaRecorder is still recording, with no observed track mute/end/error, non-zero audio energy during the Voice Access window, and human-confirmed audio continuity.

The remaining high-value uncertainty is not microphone coexistence anymore. It is whether the mechanism survives realistic interview cadence across multiple turns without text loss, overwrite, cross-question routing errors or master-audio interruption.

## Test protocol

1. Enable Android Voice Access before starting.
2. Start the field pilot. One MediaRecorder starts and remains active for the entire three-question session.
3. For each question, use the optional `Marquer début Voice Access` marker, dictate into the focused answer field, and wait for the text to appear.
4. Move to the next question only after the current text is visible.
5. Finish after question 3. The recorder stops only once, after the whole session.
6. Replay the master recording and confirm that audio is continuous and intelligible.
7. Confirm each response stayed attached to the correct question.
8. Calculate the verdict and copy the JSON.

## PASS candidate criteria

`PASS_CANDIDATE_ANDROID_VOICE_ACCESS_FIELD_PILOT` requires all of the following:

- exactly three completed turns;
- each turn contains non-empty text;
- each turn's first non-empty input occurred while MediaRecorder was in `recording` state;
- the three texts are distinct enough to detect accidental overwrite/routing reuse;
- no MediaStreamTrack mute/end and no MediaRecorder error;
- a non-empty master audio blob exists;
- human replay confirms continuous audio;
- human review confirms correct question-to-answer routing.

## Scope boundary

A PASS does not make Voice Access a universal Android STT engine. It qualifies one product-like system-assisted path on the tested device/browser combination. A separate second-environment qualification is still required before considering beta integration.

No production or qualified beta runtime is modified by this experiment.
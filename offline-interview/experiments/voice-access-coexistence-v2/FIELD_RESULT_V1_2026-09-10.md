# Android Voice Access field result — 2026-09-10

## Source

User-run Android field test using Microsoft Edge Android / Chromium 152.

## Reported verdict from v1 harness

`PASS_CANDIDATE_ANDROID_VOICE_ACCESS`

## Strong evidence

- Voice Access baseline A inserted 165 characters.
- Voice Access was explicitly confirmed by the tester as the mechanism used.
- Phase B ultimately inserted 239 characters.
- Master capture reported no track mute, no track end, and no MediaRecorder error.
- Master recording produced 536,953 bytes of `audio/webm;codecs=opus`.
- Audio RMS remained materially present in all three windows:
  - before mean `0.0259181494`
  - during mean `0.0270415242`
  - after mean `0.0308119232`
- Human replay confirmed speech audible before, during and after Voice Access.

These observations materially support **microphone coexistence** on the tested Android/Edge configuration.

## Critical timing observation

The field log also reveals an important limitation that the v1 verdict did not distinguish:

- Voice Access window start: `265453`
- Voice Access window end: `272273`
- stop requested: `279096`
- recording stopped: `279156`
- first non-empty B `beforeinput`: `281273`
- first non-empty B `input`: `281283`

The browser therefore observed the 239-character text insertion about **2.1 seconds after the master recording stopped**. The v1 test proves that Voice Access could listen while the browser continued to capture good master audio, but it does **not** prove that Voice Access commits text to the field while MediaRecorder remains active.

## Corrected interpretation

Qualified result:

`PASS_CANDIDATE_ANDROID_VOICE_ACCESS_COEXISTENCE_WITH_DEFERRED_TEXT_COMMIT_OBSERVED`

This is stronger than the earlier Gboard result because both the system voice mechanism and master-audio continuity are explicitly proven, but weaker than a true realtime text-commit qualification.

## Next discriminator

Run v2 while deliberately keeping MediaRecorder active until the Voice Access text is visibly committed. Timestamp the first non-empty input event and require it to occur before `recordingStoppedAt` with recorder state `recording` for a realtime-commit PASS.
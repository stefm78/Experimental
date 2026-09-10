# Android Edge system-dictation coexistence — field result 2026-09-10

## Input

User agent: Android mobile Edge 152 / Chromium 152.

Observed capture result:

- dictatedText: empty
- master capture trackMuted: false
- master capture trackEnded: false
- recorderError: false
- before mean level: 0.12687
- during mean level: 0.12741
- after mean level: 0.09390
- recorded blob: 469598 bytes, audio/webm;codecs=opus

## Interpretation

The master browser audio capture remained technically alive and showed non-zero acoustic energy before, during and after the declared dictation window. That is positive evidence against an obvious microphone takeover, mute, track termination or recorder failure.

However, dictatedText remained empty. Therefore the test did not prove that system keyboard dictation actually ran and inserted text while browser recording was active. The coexistence hypothesis cannot be promoted from this run.

## Verdict

**INCONCLUSIVE_POSITIVE_CAPTURE**

Positive sub-result: no detected damage to master audio capture during the marked window.

Missing proof: successful OS/keyboard dictation during that same window.

## Next discriminator

Run an A/B experiment on the same device/browser:

A. Dictation-only baseline, recorder OFF. Confirm the system keyboard microphone can insert a distinctive sentence into the textarea and capture input events.
B. Recorder + dictation, recorder ON. Repeat the same operation while master audio capture is active.

Interpretation:

- A fails => the environment/instructions/keyboard path is not usable; do not blame audio coexistence.
- A passes and B fails to insert text => recording and system dictation conflict or browser/OS suppresses the dictation path.
- A passes and B passes, with uninterrupted master audio and non-zero levels => PASS_CANDIDATE for system dictation as an optional mobile text-entry accelerator.
- B inserts text but master audio is muted/silent/discontinuous => FAIL_FAST because audio authority is violated.

Do not modify Offline Interview product runtime until B is a qualified PASS_CANDIDATE.

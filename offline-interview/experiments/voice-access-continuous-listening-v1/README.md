# Voice Access continuous listening v1

## Decision being tested

Can Android Voice Access remain in listening mode for an entire Offline Interview session while the web app navigates between questions and focuses the active answer field, with no manual Voice Access reactivation between turns?

## Android prerequisites

- Voice Access installed and enabled.
- Voice Access listening started before the session.
- `Cancel on touch` / `Annuler au toucher`: OFF.
- `Time out after no speech` / `Expiration après silence`: OFF.
- Do not touch the Voice Access shortcut after starting the test.

These settings cannot be changed by the web app. They are explicit user-controlled preconditions.

## Protocol

1. Configure the two Voice Access settings above.
2. Start Voice Access listening.
3. Open the experiment and start the session.
4. Dictate a distinct answer for each of five questions.
5. Use the app's Next/Previous buttons normally. Change speaker at least once.
6. Never restart or pause Voice Access during the session.
7. Stop the interview, replay the master audio, and confirm the three human attestations.
8. Calculate the verdict and copy the JSON.

## PASS gate

`PASS_CANDIDATE_ANDROID_VOICE_ACCESS_CONTINUOUS_LISTENING` requires one intact MediaRecorder master, five distinct non-empty answers committed while MediaRecorder is recording, human-confirmed correct routing, human-confirmed continuous audio, and explicit confirmation that Voice Access was not reactivated between session start and stop.

## Research basis

Google's current Voice Access documentation exposes user-controlled listening behavior, including a setting allowing touch interaction without stopping Voice Access and an optional 30-second no-speech timeout. Voice Access start/stop is user-controlled; this experiment does not claim the webpage can control it.
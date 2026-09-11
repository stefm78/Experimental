# Voice Access product integration v2

Purpose: close the ambiguity exposed by v1 field evidence without touching the qualified beta/runtime.

## Why v2 exists

V1 proved continuous master capture and real-time Voice Access commits, but the human run did not complete mandatory keyboard-lock/audio-only/back-navigation scenarios and reported routing/export incorrect. One input landed 704 ms after a turn transition. The v1 implementation also counted any new-turn input within 1200 ms as a late mutation, which cannot distinguish a valid fast response from a stale commit.

V2 therefore changes the *test harness*, not the qualified product:

- 6 guided scenarios instead of 8 loosely enforced scenarios;
- each transition is gated by scenario completion;
- navigation requires a 700 ms physical pointer hold, preventing ordinary Voice Access synthetic clicks from advancing the test;
- every transition enters a 1200 ms quarantine during which the answer field is disabled and no new field is focused;
- any attempted input during quarantine is recorded separately;
- human-locked and audio-only turns become protected read-only states;
- the navigation-back scenario is explicitly controlled and recorded;
- verdict distinguishes technical routing evidence from human routing/export confirmation.

## Pass criteria

`PASS_CANDIDATE_VOICE_ACCESS_PRODUCT_INTEGRATION_V2` requires:

1. one intact continuous MediaRecorder master;
2. all six required scenarios completed;
3. Voice Access text committed while recorder state is `recording` on T1, T2 and T6;
4. T2 uses Participant B;
5. T3 is human-locked and remains unchanged;
6. T4 completes controlled back/return navigation;
7. T5 is audio-only with empty text;
8. no input is observed during transition quarantine;
9. human confirms continuous audio, correct routing and coherent export.

Scope is limited to the exact tested browser/device/environment. Voice Access remains user-controlled and optional; master audio remains authoritative.
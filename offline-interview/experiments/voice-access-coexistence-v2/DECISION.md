# Decision — Android Voice Access after first field test

## Current state

**GO for continued isolated qualification. NO GO for product integration yet.**

The first Android field run demonstrates a materially promising architecture:

- Voice Access itself was proven in baseline and during the product-like scenario.
- Browser master audio remained intact and audibly continuous while Voice Access was being used.
- Android's documented accessibility-service audio-sharing behavior is directionally consistent with the observed result.

The remaining uncertainty is not microphone coexistence. It is **text-commit timing**.

In the captured run, Voice Access text was committed to the browser after MediaRecorder stopped. The next test must therefore keep MediaRecorder running until the text appears and prove or disprove in-recording commit.

## Product consequence if v2 passes realtime commit

Candidate architecture:

`continuous master audio -> canonical turn spans -> optional Android Voice Access input -> textarea/input events -> system-voice transcript provenance`

Voice Access text remains secondary evidence; master audio stays authoritative. Human edits must always win over later system text.

## Product consequence if v2 only passes deferred commit

The architecture can still be useful, but it must be modeled as delayed transcription:

`continuous master audio -> turn closes -> Voice Access result may settle asynchronously -> transcript status becomes stable -> user may review/edit`

The UI must never imply true LIVE transcription in that case.

## Gate

The only next required human action is the Android v2 field run.
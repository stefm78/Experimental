# H4 physical qualification — 2026-09-11

## Verdict

**PASS — stability / routing gate**

H4 is accepted as the current Android stability baseline. This does **not** yet qualify transcription quality.

## Evidence authority

Physical Android result JSON supplied by the human tester:

- schema: `offline-interview.interview-result.v1`
- session: `17101e07-f6d9-4470-9a60-9e2ca49c41ef`
- build: `android-native-0.4.3-h4-tactical`
- runtime schema: `offline-interview.android-native-runtime.v4.3`

Observed machine evidence:

- completed: `true`
- answeredQuestions: `5`
- totalQuestions: `5`
- unansweredQuestions: `0`
- authoritative WAV: `single_AudioRecord_PCM_to_WAV`
- PCM bytes: `612480`
- audio duration: `19140 ms`
- `sttDegraded=false`
- `droppedSttPcmChunks=0`
- Q01-Q05 each have one STT session
- providerError: `null` for every session
- lateEventCount: `0` for every session
- no ANR was reported during this H4 run

This satisfies the H4 physical gate defined in PR #92: no ANR, continuous WAV, correct per-question routing, 5/5 when speech is supplied, and no unrecovered provider error.

## New quality finding

All five sessions report:

- `finalCount=0`
- `segmentCount=0`
- `timedPartCount=0`

All five exported answers use `draftSource=partial_snapshot_at_turn_close` rather than a provider final result.

The resulting text is often linguistically poor. Without a human ground-truth transcript or the WAV bytes, word-error-rate cannot be honestly computed. Therefore:

- stability/routing: **PASS**
- provider-finalization quality: **FAIL / NOT ACHIEVED**
- transcription accuracy: **HOLD — ground truth unavailable**

## Architectural constraint for H5

H5 must preserve H4 exactly on the properties that passed:

1. one authoritative `AudioRecord`;
2. continuous master WAV;
3. no blocking STT pipe write on the master capture thread;
4. bounded STT PCM queue / isolated feeder;
5. per-question routing by STT session identity;
6. no UI wait on STT feeder or provider completion;
7. bounded recovery for transient provider errors;
8. human-lock precedence.

H5 should target only turn finalization / text quality and must not reopen the H4 stability architecture.

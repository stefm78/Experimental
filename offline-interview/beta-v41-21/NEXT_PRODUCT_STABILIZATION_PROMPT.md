# Next autonomous mission — Product stabilization after V41.21

/research /audit /solve /build

Continue Offline Interview from the qualified V41.21 beta baseline. Do not reopen the STT engine exploration unless new evidence invalidates the established browser split.

## Evidence to preserve

- Edge: audio capture, decode, replay, speaker windows and completion are healthy; browser LIVE SpeechRecognition can fail with `network`; V41.21 successfully fail-stops the prior restart storm after the first network failure.
- Chrome: recent field controls established healthy audio and usable LIVE transcription across speaker boundaries; V41.21 must remain transparent on this positive path.
- saved-audio Web Speech is not qualified cross-browser and remains out of the main product path.
- Whisper/local QUALITY experimentation remains separate and must not be copied into the product without a new explicit qualification decision.

## Objective

Move from STT stabilization to product-state correctness. Correct the smallest material inconsistency now exposed by the audio-authoritative degraded path: a question with valid captured answer audio can be marked `status: answered` while the completion summary still reports it as unanswered because the current completion metric requires non-empty transcript text.

## Required behavior

1. An answer counts as addressed when it has either:
   - non-empty answer text; or
   - a valid persisted audio reference/window for an answer turn.
2. Do not synthesize or insert placeholder transcript text merely to satisfy progress/completion counting.
3. Preserve distinctions between:
   - transcript available;
   - audio-only answer;
   - genuinely unanswered question.
4. Keep export JSON internally coherent: question status and completion counts must use the same answer-presence semantic.
5. Keep visible progress summaries coherent with the export semantic.
6. Preserve audio-authoritative storage, replay, speaker boundaries, Edge fail-stop and Chrome LIVE.
7. Do not add retries, queues, background quality lanes, provider abstractions, saved-audio browser STT, Whisper integration or service workers.
8. Do not mutate production/root.

## Implementation discipline

Do not stack another DOM-only policy shim if the defect belongs to core answer/progress/export semantics. Re-enter `/solve` from the protected baseline and choose the minimum maintainable integration. If a dedicated V41.22 runtime snapshot is necessary to avoid retroactively changing older beta wrappers, prefer that over silently changing V41.20/V41.21 behavior.

Add a regression fixture/test covering:

- one audio-only answer -> addressed/answered;
- one text answer -> addressed/answered;
- no text and no audio -> unanswered;
- mixed speaker turns preserve counts;
- no fabricated transcript text.

Publish a separate V41.22 beta candidate and stop at one short Edge + Chrome smoke only after CI and Pages deployment succeed.

If the implementation would require disproportionate runtime duplication or architecture growth, stop before mutation and document the cheaper maintainable alternative rather than introducing another repair layer.

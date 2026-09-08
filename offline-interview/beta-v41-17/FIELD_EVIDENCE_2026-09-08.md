# V41.17 field evidence — 2026-09-08

Source: user field interview export `free-interview-1788888341131-5858b658-1968-47b1-a4bd-e68aa39f6fa6.json` plus direct human observations.

## Accepted observations

- Speaker/audio replay boundary: perceived as correctly aligned in the latest field exercise; preserve unless contradicted by new evidence.
- Manual retry UX defect: a successful retry must clear a previous warning state and render `✓` rather than leaving `!`.
- Whisper fallback: too inconsistent and slow to remain the preferred post-hoc quality path.
- System live transcription: useful for immediate interview UX but can be incomplete or missing on some turns.
- Quality processing should be decoupled from the live interview so the interviewer never waits for it.
- Pause/resume control needs unambiguous labeling and must remain distinct from replay controls.

## Candidate response

V41.17 introduces a two-lane model: immediate live system STT plus a non-blocking saved-audio system quality pass when capture is idle. Background results are stored separately, human edits are protected, automatic retries are bounded, and the retry control has an explicit success-state repair.

## Remaining human gate

Validate responsiveness, retry `! -> ✓`, quality improvement over Whisper on representative French turns, and preservation of human edits before any promotion.

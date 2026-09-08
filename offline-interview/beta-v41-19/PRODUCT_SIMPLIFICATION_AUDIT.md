# Offline Interview V41.19 — Product simplification audit

## Field evidence driving the change

- Audio durability is considered preserved.
- Speaker boundaries are currently field-acceptable and must not be reworked without contradictory listening evidence.
- Live SpeechRecognition remains useful as the immediate interview transcript.
- Strict concurrency probe: Chrome PASS_STRICT (68 LIVE results after BACKGROUND start, 44 BACKGROUND results, ~14192 ms).
- Strict concurrency probe: Edge FAIL_FAST because LIVE is interrupted/errored under concurrency.
- V41.18 Edge field observation: near-line automatic quality reached `2/2` with `aucun texte système`, creating visible failure noise without user value.

## Baseline comparison

V26/V27 UX work established the product model that should remain the baseline:

- browsing questions must not silently move ownership;
- speaker/question transfer must remain explicit;
- ON AIR is the dominant recording cue;
- the long live transcript should remain usable;
- avoid broad layout redesign and avoid extra pressure-time ambiguity.

V41.17/V41.18 added useful technical capabilities but also added product-visible quality machinery: a persistent quality status banner, retries, and broad eligibility for automatic reprocessing. These mechanisms solve engineering questions but are not themselves user goals.

## Material regressions identified

1. Secondary-engine failures became visible in the primary interview UX.
2. Automatic quality processing was too broad: a turn could be retried even when its live text was already usable.
3. Repeating the same automatic system-audio-track attempt after an empty result added work without new evidence.
4. Browser concurrency policy became a visible concept when it should remain an internal optimization.
5. The system optimized transcription machinery rather than the interviewer's flow.

## V41.19 contract

The interview experience must remain simple even when every secondary quality mechanism fails.

### Preserve

- continuous durable audio and canonical audioRef windows;
- live transcription as immediate UX;
- explicit speaker/question actions;
- manual replay/retranscription controls;
- human-edit protection;
- strict local concurrency capability proof as an internal optimization.

### Remove from normal UX

- persistent quality-lane status banner;
- visible automatic retry counters;
- secondary-engine error messages during the interview;
- automatic retries of the same failed secondary path.

### Automatic quality is selective

A turn is automatically considered only when:

- live text is empty; or
- the environment has a fresh PASS_STRICT concurrency proof and a >=5 s turn has fewer than 10 transcript characters.

A normal non-empty live transcript is not automatically reprocessed.

### Failure policy

- exactly one automatic secondary attempt per suspicious turn;
- any automatic secondary failure disables automatic quality for the remainder of the session;
- the failure is recorded only in runtime diagnostics;
- the live transcript and interview continue unchanged;
- manual retranscription remains available.

### Browser behavior

No browser name is hard-coded.

- fresh exact-user-agent PASS_STRICT proof: suspicious completed turns may be processed concurrently while recording;
- otherwise: only empty-live turns may be processed when recording is idle;
- failure immediately collapses to live + saved audio + manual recovery.

## Human gate

The candidate is acceptable only if a normal interviewer can ignore the entire quality subsystem:

1. conduct several turns without any quality banners or blocking states;
2. confirm ordinary usable live turns are not automatically reprocessed;
3. on Edge, confirm a secondary empty result does not alter or alarm the primary UX;
4. on Chrome with PASS_STRICT, confirm a deliberately empty/very-short suspicious turn can be improved in the background without visible interruption;
5. confirm manual replay/retranscription and human edits still behave normally.

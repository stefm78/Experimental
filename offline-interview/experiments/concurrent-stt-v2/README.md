# Concurrent STT V2 — strict overlap proof

Purpose: qualify true temporal concurrency before changing Offline Interview.

V1 could return PASS if LIVE produced text before BACKGROUND started. V2 closes that false-positive path.

## PASS_STRICT requires all of the following

- LIVE recognition starts;
- BACKGROUND recognition starts from a saved audio MediaStreamTrack;
- BACKGROUND produces at least one result;
- LIVE produces at least one result after the BACKGROUND `onstart` event;
- LIVE does not error or end during that overlap;
- BACKGROUND does not error.

## FAIL_FAST

- LIVE errors or ends after BACKGROUND has started;
- BACKGROUND errors while concurrent;
- the page/browser becomes materially unresponsive.

## INCONCLUSIVE

- `start(audioTrack)` is unavailable/refused;
- both sessions start but one lane produces no evidence; repeat once while speaking continuously.

This harness is isolated under `experiments/` and does not modify production or beta interview runtimes.

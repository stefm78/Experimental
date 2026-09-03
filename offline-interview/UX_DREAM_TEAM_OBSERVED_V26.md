# UX Dream Team — Observed Interview Round v26

Date: 2026-09-03  
Input evidence: completed V25 field interview, 8/8 questions answered, 595 active seconds.

## What V25 proved

V25 resolved the product-model disagreement from V24:

- browsing questions can remain independent from the recording owner;
- the recording stays attached to the original question while the interviewer inspects others;
- the bottom capture bar makes that ownership visible;
- the explicit retarget action is understood and judged useful;
- participant names without visible role labels are sufficient;
- participant deletion provenance remains correct.

The remaining issues are now narrow and technical/visual rather than architectural.

## Field findings

### 1. Speaker switching no longer loses words, but carries too much history

The rapid-switch test showed a new failure mode:

- prior recognizer history was copied into later speaker turns;
- words were therefore not necessarily lost, but were attributed to the wrong speaker;
- each new semantic segment could contain an accumulated prefix from the previous one.

Root cause: the browser SpeechRecognition session is cumulative. V24/V25 reset the app-level segment buffer, but not the browser result history indexes.

### 2. Microphone cue is oversized

The ON AIR treatment itself is judged good.

The field feedback explicitly rejects the large breathing red circle around the microphone:
- the circle takes too much visual space;
- the microphone itself should carry the emphasis;
- ON AIR should remain the dominant state label.

### 3. Live transcript growth works

The long-answer test confirms:
- the transcript expands upward;
- the latest words remain visible;
- speaker buttons remain stable.

No further layout change is justified here.

## Dream Team arbitration

### Steve — Product / UX

Keep V25 product model unchanged.

Accepted only:
- remove the oversized microphone circle;
- keep ON AIR badge emphasis;
- do not add another visual recording indicator.

### Field Interviewer

Keep:
- stable recording owner while browsing;
- explicit retarget action in capture bar;
- global ON AIR context.

Priority:
- fix speaker attribution history before any further visual optimization.

### Conversational Capture

Replace the previous coarse semantic reset with result-index boundary tracking:

- keep one SpeechRecognition session running;
- snapshot browser result indexes at each semantic boundary;
- after a speaker/question switch, only accept text appended after that snapshot;
- if an existing result is merely rewritten/punctuated, do not treat it as new speech;
- preserve text across browser-driven recognition restarts without reintroducing previous segment history.

### Reliability / Provenance

Hard gate for V26:
- no new speaker turn may contain the previous speaker's complete recognizer prefix solely because of cumulative SpeechRecognition history.

## V26 changes

1. **SpeechRecognition segmenter rewritten**
   - recognition remains continuous;
   - current browser result indexes are tracked;
   - each speaker/question boundary snapshots the current index state;
   - subsequent text is calculated as the delta after that boundary;
   - accumulated browser history is no longer copied wholesale into later turns;
   - browser auto-restarts preserve the current semantic segment through a carry buffer.

2. **Mic visual corrected**
   - oversized red breathing circle removed;
   - microphone remains visible as the recording icon;
   - ON AIR badge retains the subtle pulse and red emphasis.

3. **No product-model change**
   - browsing remains independent from recording ownership;
   - explicit retarget remains in the capture bar;
   - top/sidebar/bottom ON AIR cues remain;
   - names-only participant UI remains.

## V26 test gates

1. Start recording on Q1, browse Q2/Q3:
   - Q1 remains owner;
   - no automatic retarget.

2. Use explicit retarget to Q2:
   - old text remains on Q1;
   - only subsequent text appears on Q2.

3. Rapid speaker boundary test using unique word groups:
   - each speaker turn must contain only its own current group;
   - no previous full prefix should repeat into later turns.

4. Repeat with a numeric 1→20 sequence:
   - note missing numbers separately from misattribution.

5. Visual ON AIR:
   - mic is visible;
   - no oversized breathing circle;
   - ON AIR remains obvious.

6. Long live transcript:
   - expansion remains stable;
   - controls remain anchored.

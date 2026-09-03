# UX Dream Team — Observed Interview Round v25

Date: 2026-09-03  
Input evidence: completed V24 UX interview export, 9/9 questions answered, 796 active seconds.

## What the V24 field test proved

V24 fixed several previous defects:
- participant history now survives deletion: Titi is preserved in export metadata with name and removal timestamp;
- the destructive Home / Finish path is now protected by confirmation;
- zero-duration ghost duplicates were not reproduced in this run;
- the live transcript is judged clean and auto-scrolls correctly;
- speaker switching feels materially faster than before.

The run also produced one decisive product correction:

> Browsing questions must remain completely independent from the question that owns the active recording.

The automatic-retarget model introduced in V24 is therefore rejected.

## Dream Team arbitration

### Steve — Product / UX

Accepted:
- restore one stable recording owner;
- keep question browsing free and non-destructive;
- make the retarget action explicit only when needed;
- place that action in the bottom capture bar where the interviewer is already acting;
- remove visible participant role labels from the normal interface.

Rejected:
- automatic reassignment of recording just because the interviewer clicked another question;
- another navigation mode or modal transfer workflow.

### Field Interviewer

Accepted:
- while recording Q1, browsing Q2/Q3 must not alter where speech is stored;
- when another question is displayed, the capture bar must clearly say that recording is still attached to Q1;
- the interviewer must be able to explicitly continue the recording on the viewed question with one contextual action.

### HCI

Accepted:
- add a global ON AIR cue near the interview clock so recording remains visible even when attention is on another part of the screen;
- enlarge the microphone cue again;
- keep the active question and the recording-owner question visually distinct.

### Conversational Capture

Accepted:
- preserve continuous system STT across speaker changes;
- preserve the current live transcript behavior;
- enlarge the transcript area dynamically, up to roughly one third of the viewport, while keeping speaker buttons anchored.

### Reliability / Provenance

Confirmed PASS from V24:
- deleted participant identity preserved;
- no punctuation-only ghost turn reproduced;
- no zero-duration duplicate reproduced;
- turn speaker metadata remains intact in export.

Still under observation:
- first words / first numbers may be missed by system recognition at the start of a capture;
- fast speaker boundaries are improved but not yet declared lossless.

## V25 changes

1. **Stable recording ownership**
   - browsing another question no longer moves the active recording;
   - ON AIR remains on the original question in the left navigator.

2. **Explicit retarget in the capture bar**
   - while viewing a different question during ON AIR, the bottom bar says:
     - “L’enregistrement reste sur …”
   - one contextual action appears:
     - “Continuer sur <question> →”
   - activating it creates the semantic boundary and continues capture on the viewed question.

3. **Global ON AIR**
   - a red ON AIR indicator with the active speaker is shown near the main interview clock.

4. **Participant simplification**
   - role selectors are hidden from the normal setup/interview UI;
   - names remain the visible identity;
   - role metadata remains in the contract/export for downstream AI.

5. **Larger capture affordance**
   - recording microphone materially enlarged;
   - ON AIR treatment reinforced;
   - live transcript can grow upward to about one third of the viewport before scrolling.

## Hard gates for V25 test

The associated V25 field test must verify:

1. start Q1, browse Q2 and Q3 while speaking:
   - all speech remains attached to Q1;
   - ON AIR remains on Q1.

2. while viewing Q2:
   - bottom capture bar clearly states Q1 still owns recording;
   - one explicit retarget action is available;
   - using it moves only subsequent speech to Q2.

3. ON AIR:
   - visible in sidebar;
   - visible in bottom capture bar;
   - visible in top header.

4. speaker handoff:
   - replay rapid 1→20 word-number test;
   - note any missing or misattributed boundary content.

5. participant display:
   - names only in normal UI;
   - role metadata still present in exported JSON.

6. live transcript:
   - grows upward during a long answer;
   - latest words remain visible;
   - speaker controls do not shift.

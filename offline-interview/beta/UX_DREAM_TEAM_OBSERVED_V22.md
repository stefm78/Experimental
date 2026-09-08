# UX Dream Team — Observed Interview Round v22

Date: 2026-09-03  
Input evidence: completed v21 UX interview export, 9/9 questions answered, 651 active seconds.

## What the real interview changed

The real interview exposed issues that heuristic review alone did not fully surface:

- the setup page still had too many titles and technical labels;
- the "En ligne" badge was ambiguous and looked like a recording state;
- participant IDs P1/P2/P3 had no user value;
- the interview duration existed but was not immediately legible enough;
- technical wording such as "transcription système" distracted from the interviewing task;
- the live transcript was below the speaker controls and made the control bar feel unstable;
- "Qui parle ?" duplicated the meaning of the speaker buttons;
- recording state needed a stronger "ON AIR" signal;
- most importantly, changing the viewed question stopped the recording, creating interviewer stress;
- the sidebar did not identify which question still owned an active recording when browsing elsewhere;
- one near-duplicate zero-duration turn appeared in the real export.

## Dream Team arbitration

Steve / Product:
- remove setup chrome that does not change a user decision;
- make the actual interview title and estimated duration the entry point;
- remove participant technical IDs from the visual product;
- keep technical details collapsed.

Field Interviewer:
- allow unrestricted question browsing while somebody is still speaking;
- preserve the active recording against the question where it started;
- show that recording target in the left navigation;
- make speaker buttons larger and stable.

HCI:
- do not use "En ligne" as a primary state;
- remove redundant "Qui parle ?";
- keep live transcription above controls so controls do not shift vertically;
- express elapsed interview time as plain language.

Conversational Capture:
- use explicit ON AIR state plus red treatment, timer and active speaker;
- speaker change remains one click;
- retain the same recording question across speaker switches even if the interviewer is browsing another question.

Reliability:
- add capture-instance guard against duplicate finalization;
- add near-duplicate protection for immediately repeated system turns;
- keep turn attribution bound to recordingQuestionId, not viewed question.

## Accepted changes

1. Setup page
   - global app header hidden;
   - interview title becomes the main heading;
   - duration shown immediately beside the interview type;
   - P1/P2/P3 labels visually removed;
   - technical diagnostics hidden from the normal setup surface;
   - transcription wording simplified.

2. Interview page
   - live transcript reserved above speaker controls;
   - speaker buttons span the available width;
   - redundant "Qui parle ?" removed;
   - explicit "● ON AIR" recording state;
   - elapsed/remaining interview time rewritten in plain language;
   - navigation no longer stops an active recording;
   - recording stays attached to its original question while the interviewer browses;
   - sidebar marks that question with ON AIR;
   - speaker changes during browsing remain attached to the same recording question.

3. Reliability hardening
   - each capture has a unique capture instance guard;
   - near-identical immediate duplicate turns are merged/rejected.

## Product rule after v22

While someone is speaking, the interviewer must be able to:
- change speaker with one click;
- browse any question without interrupting recording;
- always see which question owns the live recording;
- understand ON AIR state without reading technical text.

No additional visible control is introduced to achieve this.

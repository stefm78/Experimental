# UX Dream Team Optimization — Interview Runtime v21

Date: 2026-09-03  
Baseline: `offline-interview v20`  
Method: iterative Dream Team review, weighted scoring, cross-challenge, Steve arbitration, bounded changes per iteration.

## Evidence from the real run

The supplied v20 result demonstrates that the capture mechanics are now operational: 10 structured turns were persisted across three participants (Marine, Stéphane and Paulo), with distinct speaker attribution and automatic switching. The session lasted 294 active seconds. This confirms that v21 can focus on visual hierarchy and operational flow without redesigning the provenance model.

The screenshots exposed three UX problems that the previous heuristic review had underestimated:

1. the setup page still reads like a product/admin screen rather than a quick preparation step;
2. the interview page still contains legacy capture affordances and insufficiently explicit recording feedback;
3. the completion page spreads a very small number of actions across too much space.

## Dream Team

| Member | Weight | Primary lens |
|---|---:|---|
| Steve — Product / UX | 25% | ruthless simplification, hierarchy, product coherence |
| Field Interviewer | 20% | eye contact, speaker changes, question flow, recovery |
| HCI / Cognitive Ergonomics | 20% | cognitive load, predictability, immediate feedback |
| Conversational Capture | 15% | capture start/stop, speaker attribution, recording confidence |
| Accessibility | 10% | readability, target size, non-color feedback, keyboard |
| Reliability / Provenance | 10% | correct turns, speaker identity, persistence, export coherence |

Final arbitrator: **Steve**, subject to reliability and accessibility hard gates.

## Scoring

These are expert heuristic scores, not measured usability-study scores.

| State | Steve | Field | HCI | Capture | Accessibility | Reliability | Weighted | Complexity penalty | Final |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v20 observed baseline | 72 | 76 | 73 | 85 | 78 | 96 | 78.0 | -6 | **72.0** |
| Iteration 1 — setup | 82 | 79 | 83 | 85 | 82 | 96 | 83.5 | -4 | **79.5** |
| Iteration 2 — interview | 91 | 94 | 91 | 96 | 87 | 96 | 92.5 | -2 | **90.5** |
| Iteration 3 — completion | 94 | 95 | 93 | 96 | 89 | 96 | 94.0 | -1 | **93.0** |

Stop threshold: 92 with no hard-gate failure. Final: **93.0**.

## Iteration 1 — Setup page

### Independent challenges

**Steve**
- too much product machinery before the user can begin;
- technical status cards compete with the primary task;
- the context occupies too much vertical attention.

**Field interviewer**
- participants and the Start action are the only frequent controls;
- questionnaire loading should be available but not dominate;
- previous-session recovery is useful but secondary.

**HCI**
- preparation, technical status and privacy were mixed in the same hierarchy;
- too many equally weighted blocks make scanning slower.

### Arbitration

Accepted:
- two-column preparation layout on desktop: interview brief + participants;
- technical/privacy information collapsed into one secondary disclosure;
- AI authoring handoff kept but visually demoted;
- one dominant primary action: **Commencer l’entretien**.

Rejected:
- a separate configuration wizard;
- forcing Whisper preparation before the interview;
- a persistent STT lab card.

## Iteration 2 — Interview page

### Independent challenges

**Conversational Capture**
- a visible “Parler” control is redundant when speaker buttons already start capture;
- recording state must be unmistakable;
- live recognition feedback should be visible without opening a text editor.

**Field interviewer**
- question navigation belongs first in the left column;
- participant editing is secondary and should not displace the interview structure;
- capture must remain fixed while the conversation scrolls.

**Accessibility**
- recording cannot rely on color alone;
- active recording needs explicit text, timer and button state.

### Arbitration

Accepted:
- remove the legacy record/stop buttons completely;
- speaker buttons are the only normal capture entry point;
- recording state uses all of: explicit `ENREGISTREMENT` label, pulsing dot, timer, strong dock treatment and active-speaker state;
- live interim transcript appears in the capture dock;
- switching speaker remains one click and automatically commits the previous turn;
- participant editing moves below question navigation.

Steve rejected:
- a second microphone button;
- a modal recording overlay;
- automatic diarization;
- a permanent waveform;
- always-visible technical STT details.

## Iteration 3 — Completion page

### Independent challenges

**Steve**
- the completion page contains three equivalent visual calls to action even though JSON export is the primary product outcome;
- the large application header and diagnostics are irrelevant after completion.

**HCI**
- summary information should be structured rather than embedded in one sentence;
- secondary actions should remain available without competing with export.

### Arbitration

Accepted:
- centered completion panel;
- three compact stats: questions, turns, active time;
- JSON export as primary action;
- text export as secondary action;
- review and new session as quiet tertiary actions;
- hide global chrome and diagnostics in completion mode.

## Hard gates

- Speaker attribution: **PASS**
- Turn persistence/export: **PASS**
- Capture has explicit non-color recording state: **PASS**
- Speaker switching remains one-click: **PASS**
- Question navigation remains directly accessible: **PASS**
- Manual correction remains available: **PASS**
- Keyboard stop/navigation paths retained: **PASS**

## Final product rule

During the interview, the interviewer should normally perform only three meaningful actions:

1. choose the question;
2. click the person who is speaking;
3. optionally use a follow-up.

Everything else is automatic, collapsed, or secondary.

## Stop decision

The Dream Team stops at v21 with a heuristic score of **93.0 / 100**. Further speculative visual changes are more likely to introduce new chrome than to reduce cognitive load.

The next round should be triggered by observed use of v21, especially:
- whether the recording state is visible enough without being distracting;
- whether the capture dock obscures content on smaller screens;
- whether the setup page allows a first-time user to start without explanation;
- whether JSON export remains the obvious completion action.

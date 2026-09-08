# UX Dream Team Optimization — Interview Runtime v20

Date: 2026-09-03  
Baseline: `offline-interview v19`  
Method: iterative expert heuristic review, independent scoring, cross-challenge, Steve arbitration, maximum three major UX changes per iteration.

> Important: these are expert heuristic scores, not measured usability-study scores. The observed v19 export was used as a technical reality check for speaker attribution and turn persistence.

## Dream Team

| Member | Weight | Primary evaluation lens |
|---|---:|---|
| Steve — Product / UX | 25% | obviousness, hierarchy, interface disappearance, overall coherence |
| Field Interviewer | 20% | eye contact, flow, question navigation, speaker switching, recovery |
| HCI / Cognitive Ergonomics | 20% | cognitive load, predictability, feedback, error prevention |
| Conversational Capture | 15% | capture start/stop, speaker switching, STT tolerance |
| Accessibility | 10% | readability, target size, keyboard, non-color feedback, zoom |
| Reliability / Provenance | 10% | speaker attribution, persistence, export coherence, deterministic switching |

Final arbitrator: **Steve**, subject to non-negotiable reliability/accessibility gates.

## Scoring progression

| State | Steve | Field | HCI | Capture | Accessibility | Reliability | Weighted | Complexity penalty | Final |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v19 baseline | 58 | 62 | 61 | 78 | 72 | 96 | 67.6 | -7 | **60.6** |
| Iteration 1 | 78 | 80 | 79 | 82 | 78 | 96 | 81.0 | -4 | **77.0** |
| Iteration 2 | 87 | 89 | 86 | 91 | 82 | 96 | 88.2 | -2 | **86.2** |
| Iteration 3 | 91 | 92 | 90 | 92 | 86 | 96 | 91.2 | -1 | **90.2** |

Target stop score: **90**.

## Baseline diagnosis

The v19 behavior is technically much stronger than earlier versions: speaker buttons drive capture, speaker changes create separate turns, and speaker attribution is bound at recording start. The remaining weakness is mainly visual and cognitive.

The main interview screen still exposes too much product machinery at once: application chrome, duplicate progress indicators, participant editing, question intent, speaker instructions, transcript editing controls, capture status, manual entry, relances, previous/next navigation, diagnostics.

The Field Interviewer and HCI reviews converged on the same issue: the interviewer is still being asked to operate an application instead of simply conducting a conversation.

## Iteration 1 — Structural simplification

### Strong recommendations

1. **Make interview mode a dedicated workspace.**
   - Hide the global page header and diagnostics during an active interview.
   - Use the full viewport.
   - Keep the interview structure persistently on the left and the current conversation on the right.

2. **Move all secondary information out of the primary visual path.**
   - Participants move into a collapsed sidebar tool.
   - Question intent becomes collapsed.
   - Relances remain collapsed.
   - Desktop duplicate progress indicators disappear; time/progress remain in the sidebar.

3. **Make capture persistent rather than another block in the page flow.**
   - Speaker-driven capture becomes a sticky dock at the bottom.
   - The conversation can scroll independently above it.

### Steve arbitration

Accepted all three. The gain in interview flow outweighs the small increase in layout specialization between mobile and desktop.

## Iteration 2 — Conversation-first capture

### Strong recommendations

1. **Remove icon-heavy button semantics.**
   - Speaker buttons display the participant name as the primary information.
   - Recording state is expressed by button state plus explicit live text, not by icon alone.

2. **Make the transcript read like a conversation, not a form.**
   - Turn cards become visually quiet.
   - Speaker correction remains available but secondary.
   - Transcript text remains directly editable with minimal chrome.
   - Voice/source metadata is de-emphasized.

3. **After a captured turn, keep the interviewer in flow.**
   - Persist automatically.
   - Scroll the newest turn into view.
   - No secondary “Add turn” action after voice capture.

### Steve arbitration

Accepted. Reliability retained the right to keep speaker correction available even though it adds a small amount of interface.

## Iteration 3 — Navigation and time at a glance

### Strong recommendations

1. **Make the left structure sufficient on its own.**
   - Show answered count and elapsed / estimated duration in the sidebar.
   - Add a small time-progress indicator.
   - Keep Pause immediately available but visually secondary.

2. **Do not truncate meaning out of navigation.**
   - If no explicit short label exists, show the real question text over multiple lines rather than an arbitrary 46-character truncation.
   - Preserve the complete question as a tooltip.

3. **Add invisible efficiency shortcuts without adding visual controls.**
   - Alt + arrow keys navigate questions.
   - Escape stops active recording.
   - Mouse/touch remains the primary interaction.

### Steve arbitration

Accepted. Search, filters, section dashboards and extra status badges were rejected as unnecessary for the expected interview sizes.

## Hard gates

- **Speaker attribution:** PASS on the observed v19 test path; distinct P1/P2 turns are materialized in the export.
- **Capture persistence:** PASS on the observed test path; turns are exported with speaker IDs and text.
- **Primary action obviousness:** PASS by heuristic review in v20; the dominant action is selecting who speaks.
- **Critical hidden knowledge:** PASS; speaker selection, question navigation and finishing remain discoverable.
- **Accessibility:** no hard-blocking issue introduced; controls retain labels, keyboard paths and non-color recording feedback.

These gates are not a substitute for a later real multi-user usability test.

## Rejected ideas

- Start recording merely by focusing a text field: **rejected** — accidental capture risk.
- Automatic diarization in v1: **rejected** — complexity and attribution risk.
- Always-visible technical STT state: **rejected** — does not help conduct the interview.
- Red countdown / time overrun warnings: **rejected** — creates pressure and distorts interviewing behavior.
- Full transcript editing toolbar: **rejected** — too much chrome for a secondary correction task.
- Search/filter tooling for questions: **rejected** — unnecessary for typical interview sizes.
- Separate “save/add” step after voice capture: **rejected** — breaks conversational flow.

## Final target

Desktop:

```
┌──────────────────────────┬──────────────────────────────────────────┐
│ Interview                │ SECTION                          3 / 12   │
│ 2 / 12 abordées          │                                          │
│ 6 min / ~36 min          │ What is the current question?           │
│ ─────────────            │                                          │
│                          │ ▸ Why this question?                     │
│ Section A                │ ▸ 2 follow-ups                           │
│ ✓ Question 1       3 min │                                          │
│ ● Question 2       2 min │ Speaker A                                │
│   Question 3      ~3 min │ Captured transcript...                   │
│                          │                                          │
│ Section B                │ Speaker B                                │
│   Question 4      ~3 min │ Captured transcript...                   │
│   Question 5      ~3 min │                                          │
│                          │                                          │
│ Participants             │                                          │
│                          │──────────────────────────────────────────│
│ Terminer                 │ Who speaks? [ A ] [ B ] [ Interviewer ] │
└──────────────────────────┴──────────────────────────────────────────┘
```

The target product rule is now:

> During an interview, the interface should ask the interviewer to do only three meaningful things: choose the question, choose who speaks, and optionally use a follow-up. Everything else must be automatic, secondary, or hidden until needed.

## Stop decision

Iteration 3 reaches **90.2 / 100**, clears the target score and leaves no critical Dream Team objection.

Further visible features are more likely to reduce the score than improve it. The next meaningful improvement should therefore come from **observed real interview usage**, not additional speculative UI.

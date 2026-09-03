# UX Dream Team — Observed Interview Round v23

Date: 2026-09-03  
Input evidence: completed V22 UX interview export, 8/8 questions answered, 803 active seconds.

## What the real V22 interview changed

The second observed test confirms that V22 materially improved the product, but it exposed four remaining high-value frictions:

1. **Question ownership during a live answer**
   - browsing other questions without stopping works;
   - however, the interviewer sometimes wants to deliberately move the live answer to the question currently being viewed;
   - this must be explicit, not automatic, so browsing does not silently reassign speech.

2. **ON AIR vs finalization**
   - ON AIR was still visually associated with the question while transcription/finalization was happening;
   - finalization is not recording and must have a clearly different state.

3. **Interview-time visibility**
   - the interview-level elapsed time was not sufficiently visible;
   - it belongs in the main question header, not only in the sidebar.

4. **Conversation density and control stability**
   - speaker controls must remain fixed at the bottom of the right pane;
   - the current question must remain visible while scrolling through prior turns;
   - turn metadata should be compressed into the turn header rather than consuming a separate line.

The test also exposed word loss during very rapid speaker switching. The current capture architecture is segmented at speaker boundaries. V23 therefore reduces the handoff gap by reusing the existing microphone stream and reducing the recorder-finalization wait from 450 ms to 120 ms. This is a bounded reliability improvement, not a claim of gapless diarization.

## Dream Team arbitration

### Steve — Product / UX

Accepted:
- make the right pane behave like a real application viewport rather than a long web page;
- pin the question at the top;
- pin capture controls at the bottom;
- keep only the conversation scrollable;
- move interview-level time into the main header.

Rejected:
- automatic reassignment of recording when merely browsing questions;
- another permanent control row;
- a waveform or recording dashboard.

### Field Interviewer

Accepted:
- allow an explicit **Basculer ici** action when viewing a different question during a live recording;
- everything already spoken remains attached to the previous ON AIR question;
- after the explicit transfer, subsequent speech is attached to the new question.

### HCI

Accepted:
- replace the decorative pulsing point with a microphone-oriented recording cue;
- move the animation to the actual **ON AIR** label in the question navigator;
- show **TRAITEMENT** instead of ON AIR while finalizing;
- make elapsed time readable as a macro clock.

### Conversational Capture

Accepted:
- preserve one-click speaker switching;
- reuse the microphone stream between speaker handoffs;
- reduce capture restart latency;
- keep the live transcript above stable participant buttons.

### Reliability / Provenance

Accepted:
- recording ownership remains bound to a question ID until explicit transfer;
- transfer itself creates a segment boundary, preserving prior speech on the old question;
- finalization state is distinct from live recording;
- existing duplicate-turn protection remains in place.

## V23 changes

### Question / conversation layout
- desktop right pane is now a three-row application layout:
  1. pinned question/header;
  2. scrollable conversation;
  3. pinned speaker/capture controls;
- the current question remains visible while reviewing long conversations;
- turn spacing is reduced;
- duration and timestamp are moved into the intervention header.

### Recording ownership
- browsing questions never changes recording ownership;
- when viewing another question during ON AIR, a contextual **Basculer ici** action appears;
- activating it closes the current segment on the original question and resumes with the same speaker on the viewed question.

### Recording state
- ON AIR exists only while recording is truly active;
- finalization uses a separate **TRAITEMENT** state;
- the ON AIR label itself carries the visual pulse;
- the capture dock uses a microphone cue rather than a generic dot.

### Interview timing
- a large elapsed interview clock is visible in the question header;
- approximate remaining time sits beside it;
- Pause remains directly available.

### Speaker handoff
- microphone stream is reused across queued speaker/question handoffs;
- the recorder stop delay is reduced from 450 ms to 120 ms;
- this should reduce dropped words during rapid switches, but a later continuous-capture architecture may still be required if real tests show boundary loss.

## Stop condition for this round

V23 should now be tested specifically on:
- live answer on Q3 → browse Q4 → explicit "Basculer ici" → continue speaking;
- speaker A → speaker B → speaker A with continuous counting aloud;
- verifying that ON AIR disappears as soon as recording stops and becomes TRAITEMENT during finalization;
- long question with many turns: question stays pinned, capture stays pinned, only conversation scrolls;
- interview clock remains visible and understandable throughout.

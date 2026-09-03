# UX Dream Team — Observed Interview Round v24

Date: 2026-09-03  
Input evidence: completed V23 UX interview export, 9/9 questions answered, 1209 active seconds.

## What the V23 field test proved

The V23 interview is materially usable: long conversations can be captured, participants can be added while the interview continues, speaker switching is generally perceived as natural, the pinned-question / pinned-capture layout works, and the interview clock is useful.

The field test also exposed several remaining defects that are important enough to override the previous stop decision.

### 1. The "browse vs transfer" model is too complex

The user repeatedly described the explicit "Basculer ici" action as non-intuitive and unsuitable for an interviewer under conversational pressure.

Dream Team conclusion: **remove the distinction**.

New rule:

> The question shown on screen is the question receiving new speech.

If a user clicks another question while somebody is speaking, the current segment is closed on the previous question and capture continues automatically on the newly selected question with the same speaker.

There is no transfer button and no second concept to learn.

### 2. Speaker handoff still loses boundary words

The 1–20 count test showed missing boundary content during rapid speaker switches. The segmented start/stop recognition model remains a reliability weakness.

V24 introduces a continuous-system-recognition path:
- the browser speech recognizer remains running across speaker/question boundaries;
- each click takes a semantic snapshot of the current transcript;
- the old segment is committed to the old speaker/question;
- the new speaker/question becomes active immediately;
- the MediaRecorder/microphone stream remains open;
- the old stop/restart path remains only as a fallback when no usable system transcript is available at the boundary.

This is intended to materially reduce switch gaps. It still needs a fresh field test.

### 3. Late speech events created duplicate zero-duration turns

The V23 export still contains extended duplicates with duration 0 and punctuation-only Whisper turns.

Root cause: late system-recognition events could repopulate the manual composer after a voice turn had already been committed.

V24:
- live system recognition no longer writes into the manual composer;
- the live preview is display-only;
- punctuation-only transcripts are rejected;
- duplicate matching now normalizes punctuation, case and accents before comparing immediate adjacent turns.

### 4. Removed participants lost their historical identity

The V23 test deliberately created and deleted "Titi". In the export, the historical turns survive but the deleted participant becomes P6 with null name/role.

This is a provenance defect.

V24:
- every turn stores a speaker name/role snapshot;
- the session keeps participant history even after removal;
- removed participants remain present in export metadata with active=false and removedAt;
- a participant currently speaking cannot be deleted;
- renaming/correcting a participant updates existing turn identity snapshots before later deletion.

### 5. Capture presentation is still visually over-instrumented

The field feedback asked for a more important microphone and a larger, more readable live transcript, while criticizing the permanently reserved empty strip.

V24:
- the microphone cue is materially larger;
- ON AIR itself carries the animation;
- no extra bullet is added inside the active speaker button;
- the transcript area appears only during recording/finalization;
- it grows upward so speaker controls remain anchored;
- live text auto-scrolls to the latest words.

### 6. Interview time placement needed refinement

The elapsed time is useful but the remaining estimate directly underneath looked visually odd.

V24 displays elapsed + remaining time on one line in the question header.

### 7. Finish/home during ON AIR was too destructive

The V23 test found that ending an interview while ON AIR abruptly stopped the flow.

V24:
- Home and Finish require confirmation while capture is active;
- if confirmed, the current segment is stopped and fully finalized before leaving/completing;
- the captured text is persisted before navigation.

### 8. Export language was too technical

"Exporter le résultat JSON" was judged unnecessarily technical.

V24:
- primary action: **Exporter pour une IA**
- secondary action: **Exporter une version lisible**

The actual file formats remain JSON and TXT respectively.

### 9. Interviewer/interviewee role labels are useful metadata, not primary UI

The field test questioned whether visible role labels add value.

Dream Team arbitration:
- keep role metadata in the interview contract and export because it helps downstream AI distinguish interviewer prompts from interviewee contributions;
- remove role jargon from normal turn/speaker presentation;
- participant names remain the primary visible identity.

## Hard gates for V24 test

The next test must specifically verify:

1. **Automatic question transfer**
   - start speaking on Q1;
   - click Q2 while speaking;
   - no transfer button should appear;
   - prior speech must remain on Q1;
   - subsequent speech must appear on Q2.

2. **Rapid speaker handoff**
   - count continuously 1–20 across four alternating speaker segments;
   - compare captured boundaries for missing numbers/words.

3. **No ghost duplicates**
   - stop several turns quickly;
   - verify no duration=0 extended duplicate appears later.

4. **Deleted participant provenance**
   - add a participant named Titi;
   - capture a turn;
   - stop Titi;
   - delete Titi;
   - export;
   - Titi must remain named in historical turn metadata and participant history.

5. **Protected finish**
   - while ON AIR, click Terminer;
   - cancellation must keep recording;
   - confirmation must finalize the active turn before completion.

6. **Visual live capture**
   - ON AIR/micro state must be immediately obvious;
   - latest transcript words must remain visible;
   - speaker buttons must stay stable.

# UX Dream Team — Observed Interview Round v27

Date: 2026-09-03  
Input evidence: completed V26 field interview, 8/8 questions answered, 883 active seconds.

## What V26 proved

V26 fixed the V25 cumulative SpeechRecognition-prefix failure, but the field test exposed a different boundary defect.

- browser result history is no longer copied wholesale;
- speaker changes can still receive the last words acoustically spoken before the click because SpeechRecognition results arrive late;
- the long live transcript remains usable;
- the V26 microphone treatment became too visually weak and was reported as effectively absent;
- the explicit question-transfer action is conceptually right, but its dynamic label can read like “Continuer sur transcription live”, which is ambiguous under pressure.

## Root cause arbitration

### Conversational Capture / Reliability

`SpeechRecognition.resultIndex` is an index in browser recognition history, not an acoustic timestamp. A late result can therefore be delivered after the UI speaker switch even though the audio was spoken before the switch.

Hard decision for V27:

- do not add an arbitrary debounce or 200/300/500 ms timing heuristic;
- do not return to stop/restart SpeechRecognition on every speaker switch, which previously lost first words;
- create the semantic boundary in the audio stream itself.

### Steve — Product / UX

Keep the V25/V26 product model unchanged:

- browsing questions never moves recording ownership implicitly;
- transfer remains explicit;
- ON AIR remains the dominant recording cue;
- no broad layout redesign.

Accepted visual/copy corrections only:

- restore a compact visible microphone without a breathing halo;
- label the transfer action by question number: `Basculer sur la question N →`.

## V27 implementation

1. **Audio-bounded speaker/question transitions**
   - the microphone stream stays open;
   - a new `MediaRecorder` starts on the same stream at the click boundary while the previous recorder is closed;
   - the previous audio segment is kept only in memory;
   - click-bounded segments are canonicalized with local Whisper;
   - browser SpeechRecognition remains active for the live preview;
   - if local Whisper cannot run, the bounded system transcript is retained only as a degraded fallback and the diagnostic records the failure;
   - audio is never persisted or exported.

2. **Ordering / exit safety**
   - bounded transcriptions are serialized;
   - leaving or completing the interview waits for pending bounded segments;
   - the final segment after any boundary is also canonicalized from its bounded audio.

3. **Transfer wording**
   - `Continuer sur <label>` is replaced with `Basculer sur la question N →`;
   - the detailed question label remains available as the control title.

4. **Microphone cue**
   - compact static microphone container restored;
   - no breathing circle;
   - ON AIR badge remains the animated primary signal.

## V27 hard gates

- unique-word speaker groups: no word spoken before the click may move to the next speaker solely because browser STT arrived late;
- numeric 1→20 test: distinguish recognition errors from attribution errors;
- natural conversation: no visible systematic one-fragment speaker lag;
- explicit question transfer: pre-click audio remains on the former owner; post-click audio belongs to the new owner;
- transfer control reads `Basculer sur la question N →`;
- microphone visible without large halo; ON AIR obvious;
- long live transcript remains stable.

V27 is not declared `CAPTURE RELIABILITY PASS` until the associated field test passes.

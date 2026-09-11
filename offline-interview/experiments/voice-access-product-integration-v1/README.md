# Voice Access product integration v1

Objective: qualify a product-like Android Voice Access integration without changing the qualified Offline Interview beta/runtime.

## Acquired evidence
- Android/Edge field pilot already showed 3 distinct answers committed while `MediaRecorder.state === "recording"`, with intact continuous master audio and correct human-confirmed routing.
- Live Transcribe coexistence v1 produced an intact master recording but no observed concurrent Live Transcribe text; this does not prove global incompatibility, but it does not justify prioritizing that path.

## Product invariants
- One continuous browser `MediaRecorder` master remains authoritative.
- Voice Access is optional, system-owned and user-controlled; the web app does not start/stop it.
- Text is never audio authority.
- Human-confirmed correction can be locked; later DOM input is rejected and logged.
- Audio-only answers are valid and represented explicitly.
- Question/speaker routing is turn-bound and every near-transition mutation is logged.
- No production or qualified beta code is modified by this experiment.

## Human protocol
1. Android: enable Voice Access before starting. Recommended: Cancel on touch OFF; no-speech timeout OFF.
2. Start the test and leave Voice Access listening.
3. Complete all 8 questions as instructed.
4. Q3: switch to Participant B before dictating.
5. Q4: type with keyboard, edit, then press `Confirmer correction humaine`.
6. Q5: use Back once, inspect a previous turn, return, then answer.
7. Q6: answer by voice only and press `Marquer réponse audio seule` without text.
8. Q7: dictate and navigate quickly after text appears.
9. Q8: dictate, wait for visible text, then stop immediately.
10. Replay the master audio; confirm audio continuity, routing and export coherence; calculate verdict; copy JSON.

## PASS gate
`PASS_CANDIDATE_VOICE_ACCESS_PRODUCT_INTEGRATION` requires: intact master capture, required product scenarios completed, Voice Access-target turns first committing while recorder is active, a real speaker change, no detected routing anomaly, human-confirmed continuous audio/routing/export.

Other material verdicts include `FAIL_MASTER_AUDIO_INTEGRITY`, `FAIL_TEXT_ROUTING`, `FAIL_EXPORT_COHERENCE`, and `HOLD_PRODUCT_STATE_INTEGRATION`.

This experiment may support a later human decision to add Voice Access as an optional Android beta capability; it does not itself promote or alter the qualified beta.
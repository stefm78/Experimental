# Autonomous continuation prompt

Continue the Offline Interview Voice Access qualification autonomously from the evidence in this directory.

Treat `PASS_CANDIDATE_ANDROID_VOICE_ACCESS_REALTIME_COMMIT` as established only for the tested Android/Edge environment. Do not reopen the already-closed question of whether text can appear while MediaRecorder is recording unless contradictory evidence appears.

Primary objective: qualify or falsify the product-like multi-turn path implemented in this directory. Preserve one continuous audio master, keep Voice Access optional and user-controlled, and do not modify production or the qualified beta while the field-pilot evidence remains single-environment.

After receiving field-pilot JSON:

1. Verify all three turns committed non-empty text while MediaRecorder was still recording.
2. Verify no capture mute/end/error, non-empty master blob, and human-confirmed continuous replay.
3. Verify text routing remained correct across question transitions and no previous turn was overwritten.
4. Measure per-turn commit latency and identify any material degradation across the session.
5. If PASS, persist the exact evidence and advance to a second Android environment/browser qualification or, if unavailable, build the smallest beta-integration candidate behind an explicit optional capability flag while keeping it unpromoted.
6. If HOLD/FAIL, isolate the smallest falsifying condition and build only the next discriminator required to resolve it.
7. Use branch/PR, exact-head CI and fail closed on stale repository/control-plane state.
8. Stop only at a genuine human/device gate or promotion authority gate.

Never claim Voice Access is universal Android STT, never make it the audio authority, and never claim that the web app can programmatically start or control Voice Access.
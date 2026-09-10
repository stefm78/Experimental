# Autonomous continuation prompt — Android Voice Access realtime commit

`/research /audit /solve /build`

Continue autonomously from the Android Voice Access coexistence evidence. Treat the v1 field result as proving that Voice Access can listen while the browser preserves a continuous, audible master MediaRecorder stream on the tested Android/Edge device, but do **not** overclaim realtime text availability: the first B input event in v1 occurred about 2.1 seconds after the master recorder stopped.

Objective: determine whether Voice Access can commit recognized text into the active web field **while the master MediaRecorder remains recording**, and, if so, characterize the latency and UX well enough to decide whether this can become an optional Android product lane.

Constraints/invariants:
- master audio is authoritative and must remain continuous;
- no production or qualified beta mutation until explicit product promotion decision;
- Voice Access is optional OS assistance, not a hidden dependency;
- preserve user control and accessibility semantics;
- never claim realtime commit unless browser evidence shows first non-empty input before `recordingStoppedAt` while recorder state is `recording`;
- fail fast on mute/end/recorder error or meaningful audio-energy collapse;
- require human replay confirmation before PASS;
- persist exact field evidence and timing.

Execution:
1. Run the v2 prototype on Android with Voice Access already active.
2. Prove baseline A.
3. In B, keep recording active after dictation until text visibly appears. Mark text appearance immediately, continue speaking for several seconds, then stop recording.
4. Capture first non-empty browser input timestamp, recorder state at that moment, visible-text marker, master stream health, audio levels and human replay result.
5. Classify as REALTIME_COMMIT_PASS, DEFERRED_COMMIT_PASS, FAIL_FAST or INCONCLUSIVE.
6. If REALTIME_COMMIT_PASS, autonomously design the smallest isolated product-like prototype with a question, focused answer field, master audio, Voice Access guidance, text provenance, and safe delayed-finalization handling; do not modify production/beta.
7. If DEFERRED_COMMIT_PASS, design around deferred commit rather than pretending it is live: keep capture independent, wait for stable text after the turn, and model transcript status explicitly.
8. Stop only at a genuine human/device gate or a promotion gate requiring explicit approval.
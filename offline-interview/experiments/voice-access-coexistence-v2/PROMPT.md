# Executed autonomous prompt

`/research /audit /solve /build`

Use the Android Voice Access v1 field JSON as primary evidence. Audit its timing instead of trusting the harness verdict blindly. Determine what is actually proven, identify any overclaim, research the relevant Android microphone-sharing semantics from authoritative sources, and then autonomously build the smallest next prototype that closes the remaining architectural uncertainty.

Preserve these invariants: continuous master audio is authoritative; no production or qualified beta mutation; no second browser SpeechRecognition; no claim of realtime transcription without a browser-observed text commit while MediaRecorder is still recording; human replay is required to validate audio continuity.

If the evidence shows microphone coexistence but deferred text insertion, explicitly reclassify the result, persist the evidence, instrument commit timing, and create a follow-up test where the user keeps the master recorder running until Voice Access text visibly appears. The prototype must timestamp first non-empty input, recorder state at that instant, visible-text marker, mute/end/errors, audio levels and final audio replay confirmation.

Continue autonomously through branch, implementation, documentation, pull request and CI. Merge only after exact-head CI succeeds and repository/governance state remains valid. Stop at the first genuine device/human gate and return the direct test URL plus the smallest possible protocol.
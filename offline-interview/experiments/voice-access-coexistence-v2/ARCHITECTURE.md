# Candidate Android architecture

The current candidate remains isolated pending v2 field qualification.

- Browser owns continuous master audio capture.
- Voice Access is an optional Android accessibility/system voice-input lane.
- DOM text inserted by Voice Access is secondary transcript evidence.
- Each transcript observation records provenance and timing; master audio remains authoritative.
- Human edits supersede system-inserted text.
- If Voice Access commits late, the product must expose a settling/deferred state rather than claiming LIVE text.
- No second in-browser SpeechRecognition instance is used concurrently.

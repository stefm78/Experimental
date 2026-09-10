# Autonomous execution prompt — V41.22

/research /audit /solve /build

Continue from the field-qualified V41.21 baseline and maximize useful product progress without reopening the STT engine exploration.

Objectives:

1. Build V41.22 as the first maintainable product runtime snapshot with its own build identity rather than another runtime import of V41.15.
2. Preserve audio as authoritative and LIVE SpeechRecognition as best-effort, including V41.21 fail-stop after a browser `network` error.
3. Correct answer semantics in the core runtime: a valid audio-only answer counts as answer evidence even when no transcript text exists; transcript absence must never be disguised by fabricated text.
4. Apply that single predicate consistently to progress metrics, completion/export counters, and answer status restoration paths.
5. Keep saved-audio Web Speech, Whisper quality lanes, concurrency, automatic retry, backend/provider abstractions, and production/root out of scope.
6. Add deterministic build-time isolation, CI regression coverage, publish the beta, and advance to the smallest field gate required on Edge and Chrome.
7. Stop only if a real human judgement is required; otherwise continue through PR qualification, merge and GitHub Pages deployment.

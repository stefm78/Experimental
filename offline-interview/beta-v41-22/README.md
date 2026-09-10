# Offline Interview V41.22

V41.22 is a product-stabilization beta, not a new STT experiment.

It carries forward the V41.21 field-qualified behavior: audio remains authoritative, browser LIVE transcription is best-effort, and a network failure stops further SpeechRecognition starts for the page while the interview continues on audio.

The main change is answer semantics. A valid audio-only answer now counts as answer evidence even if Edge produced no LIVE transcript. This affects progress and exported completion counters without inventing transcript text.

The V41.22 app runtime is generated deterministically at build/deploy time from the protected beta runtime and published as a local `app.js` with its own build identity. This avoids changing V41.20/V41.21 retroactively while also avoiding another runtime import of the shared V41.15 app.

Field gate: one short Edge interview plus one Chrome regression interview, then inspect the exported JSON completion counters and normal audio/LIVE behavior.

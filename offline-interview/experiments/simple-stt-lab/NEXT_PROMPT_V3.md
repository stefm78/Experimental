# NEXT PROMPT — Simple STT Lab V3

/research /audit /solve /build — continue autonomously from the Simple STT Lab V2 field evidence while keeping Offline Interview and all V41.x runtime files frozen.

Evidence to treat as decisive:
- Chrome 152: recorded audio PASS, LIVE Web Speech PASS, saved-audio Web Speech PASS in at least one simple run.
- Edge 152: recorded audio PASS, LIVE Web Speech PASS, but saved-audio Web Speech returns an empty transcript even when the full 15.06 s media is played through HTMLMediaElement.captureStream(), the audio track is live, and recognition ends only after the media ends.

Decision:
- stop trying additional browser-specific retries or feed variations for saved-audio Web Speech on Edge;
- keep LIVE Web Speech as a separate best-effort low-latency lane;
- evaluate one genuinely independent saved-audio engine in the same simple page.

Build the smallest possible independent experiment. Keep the current Simple STT Lab UX and add one manual button only: `Transcrire local (Whisper)`. Use Transformers.js in-browser with a multilingual Whisper model that is materially better than the prior tiny model; prefer `onnx-community/whisper-base` as the first trade-off. The model may be downloaded from Hugging Face/CDN, but recorded audio must remain local to the browser and must not be uploaded to a transcription service.

Requirements:
1. No queue, retry loop, provider abstraction, concurrency, service worker, backend, API key, or V41.x integration.
2. First use may download/cache the model; clearly show this in the status without exposing engineering jargon.
3. Use WebGPU when available and fall back to WASM when it is not.
4. Force French transcription (`language: french`, `task: transcribe`).
5. Keep the existing browser saved-audio button as a control, not as authority.
6. Log only: engine, device, load latency, transcription latency, result/error.
7. Do not auto-compare or auto-replace anything.
8. Validate JavaScript/contract in CI and publish the same Simple STT Lab URL.

Gate:
- one 10–15 s recording on Edge first, then Chrome control;
- compare LIVE, browser saved-audio, and local Whisper text;
- if Whisper-base is accurate enough and completes in an acceptable time on both browsers, retain it as the first independent QUALITY candidate;
- if it is too slow or still too inaccurate, do not add complexity: benchmark exactly one stronger candidate next (for example whisper-small) or move the QUALITY engine off-browser, based on measured latency/quality.

Return the evidence, exact build state and only the smallest next human test. Do not reintegrate into Offline Interview.
# NEXT MISSION — Simple STT Lab V2

/research /audit /solve /build

Continue from the September 9, 2026 field result: Chrome 152 records, transcribes LIVE, and retranscribes saved audio successfully through the current WebAudio MediaStreamDestination path; Edge 152 records and transcribes LIVE successfully but consumes the saved audio and returns no text.

Keep the experiment radically simple and keep Offline Interview/V41.x frozen.

Research the documented browser paths for SpeechRecognition.start(audioTrack). Challenge the current WebAudio delivery path rather than adding retries, queues, providers, concurrency, or fallback orchestration. Build the smallest discriminant experiment possible: keep the exact same one-page UI and replace the saved-audio feed with the direct HTMLMediaElement.captureStream() path documented by MDN, where the recorded Blob is played by an audio element, its live MediaStreamTrack is passed to SpeechRecognition.start(track), and recognition is stopped when media playback ends.

Do not auto-fallback to the previous path: the purpose is to learn whether the audio-delivery mechanism explains the Edge failure. Expose only simple status plus raw details. Preserve recording and LIVE behavior unchanged.

Validate in CI, publish through the existing Simple STT Lab URL, and stop at the smallest human gate: one 10–15 second recording and one saved-audio transcription on Edge, with Chrome as control. If Edge still returns empty while consuming the media completely, reject browser saved-audio SpeechRecognition as a viable Edge path and move the next research step to an independent STT engine rather than adding browser retries.
# Offline Interview — V41.16 calibrated/system field candidate

This is an isolated field candidate layered over the current `/beta/` runtime. It does **not** modify production root or the V41.15 beta sources.

## What changes

- replay boundaries are calibrated independently around each semantic click by searching a bounded ±420 ms PCM energy envelope for a credible local silence valley;
- the canonical `{recordingId,startMs,endMs}` remains unchanged;
- calibration is applied only when confidence >= 0.34; otherwise the canonical boundary is used unchanged;
- post-hoc transcription uses Chromium/Edge `SpeechRecognition.start(audioTrack)` first when supported;
- Whisper is no longer the primary saved-audio retranscription path and is reachable only after an explicit fallback confirmation;
- V41.15 audio-health recovery behavior remains untouched because the field evidence already passed it.

## Field gate

1. Open `/beta-v41-16/` on desktop Chrome/Edge.
2. Make one continuous recording with at least four rapid A/B switches. Use phrases ending and starting with unique words.
3. Replay every turn. PASS requires complete end-of-A and complete beginning-of-B with no cross-speaker spill.
4. Click retranscription on at least two saved turns. PASS requires the system engine to be attempted first and materially better text than V41.15 Whisper on the same speech.
5. If system transcription is unavailable/fails, verify that Whisper starts only after explicit confirmation.
6. Export the ordinary interview JSON and copy the V41.16 status line if needed. Calibration events are persisted as `audio_boundary_calibrated_v41_16` in the local session state.

This candidate is deliberately a bounded experiment. If the field gate passes, fold the mechanism into the primary beta runtime rather than retaining the iframe layer.

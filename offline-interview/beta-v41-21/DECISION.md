# Offline Interview V41.21 — product stabilization decision

## Evidence used

The September 10 field runs establish a browser split on the same V41.20 product path:

- Chrome: audio capture and decode succeed, LIVE transcription succeeds across speaker boundaries, completion succeeds with no capture gap.
- Edge: audio capture, decode and replay succeed with no capture gap, while the standard browser SpeechRecognition path repeatedly returns `network` and produces no LIVE text.

The Edge failure therefore does not invalidate the audio capture engine or the speaker timeline. It invalidates the assumption that browser LIVE SpeechRecognition is continuously available on Edge.

## Product decision

Remain on the main product path. Do not reopen saved-audio Web Speech exploration and do not copy the Whisper lab into the product.

V41.21 makes LIVE transcription explicitly best-effort while audio remains authoritative:

1. the first browser SpeechRecognition `network` failure marks LIVE STT degraded for the page;
2. automatic SpeechRecognition restarts are fail-stopped after that failure, preventing a retry storm;
3. recording, speaker boundaries, persistence, replay and export continue normally;
4. the obsolete saved-audio retranscription button remains suppressed;
5. the previous red message promising a later system retranscription is replaced by a calm, accurate audio-first status;
6. Chrome/local SpeechRecognition behavior is otherwise unchanged.

## Scope guard

This is a beta stabilization candidate. Production/root is unchanged. No QUALITY lane, backend, concurrency, retry loop, provider abstraction or Whisper reintegration is authorized by this change.

## Gate

One short Edge interview is sufficient to validate the repair:
- audio records and replays;
- one network failure does not create a repeated error storm;
- the UI shows the calm audio-first status rather than promising unavailable retranscription;
- speaker switching and completion remain usable.

Chrome requires only a regression control confirming LIVE transcription still works.

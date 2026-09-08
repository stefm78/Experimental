# Offline Interview V41.17 — Transcription Quality Lanes

## Field evidence driving this candidate

The 2026-09-08 field interview established four product signals:

1. speaker/audio boundaries are now perceived as correctly aligned and should not be destabilized without new contradictory evidence;
2. post-hoc Whisper remains too inaccurate/slow to be the default quality path;
3. a successful retry must clear the previous warning state (`!` -> `✓`);
4. transcription quality work should not block the interview experience.

## Architecture

### Lane A — LIVE / UX

- Uses the existing system SpeechRecognition session during capture.
- Provides immediate text for the interviewer.
- Never waits for a quality pass before allowing capture, speaker switches, question navigation, pause/resume, completion, or export.
- Saved audio remains the durable local ground truth.

### Lane B — QUALITY / BACKGROUND

- Runs only when the capture/finalization UI is idle, so it does not compete with the live recognition path by default.
- Uses the saved turn audio through `SpeechRecognition.start(audioTrack)` when the browser supports that capability.
- Processes one turn at a time.
- Retries automatically at most twice.
- Stores its result separately under `turn.qualityRetranscription`.
- Never overwrites human-edited text.
- Only auto-fills the visible transcript when the current turn has no text at all.
- Whisper is not an automatic quality lane; it remains an explicit/manual fallback in the underlying beta runtime.

### Why not run two SpeechRecognition sessions simultaneously by default?

The Web Speech API exposes recognition from either microphone input or an audio `MediaStreamTrack`, but browser support is limited and the API does not provide a portable concurrency contract guaranteeing two recognition sessions can run reliably at the same time. V41.17 therefore chooses non-blocking near-line processing rather than risking live capture quality. A future controlled qualification may enable true concurrent local sessions on devices that prove they support it.

## UI state contract

Manual retranscription states are:

`idle -> running -> succeeded | rejected | failed`

A new retry starts a new attempt. When a retry succeeds, the visible control must become `✓` even if the previous attempt was rejected (`!`) or failed (`×`).

## Quality state contract

`qualityRetranscription` contains at least:

- `status`: `running | succeeded | failed`;
- `attempt`;
- `engine`: `system-audio-track`;
- `mode`;
- `text` when successful;
- timestamps;
- `humanProtected` when applicable.

Runtime events record `quality_retranscription_started`, `quality_retranscription_succeeded`, and `quality_retranscription_failed`.

## Promotion gates

V41.17 remains beta until field evidence confirms:

1. no regression on speaker/audio boundary quality;
2. interview capture remains responsive while background quality work exists;
3. successful manual retry visibly transitions to `✓`;
4. background system candidates are materially more faithful than the current Whisper fallback on representative French turns;
5. human-edited text is never overwritten;
6. no repeated background retry loop or resource starvation occurs.

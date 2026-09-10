# Offline Interview V41.22 — core product stabilization

## Decision

V41.21 is the field-qualified baseline for degraded LIVE behavior. V41.22 leaves the STT exploration closed and advances the main product path.

## Core semantic correction

A question is considered answered when at least one answer turn has actual answer evidence:

- non-empty text; or
- a valid stored audio reference with a positive time window.

Audio-only evidence MUST NOT fabricate transcript text. Transcript availability remains distinct from answer presence.

## Runtime isolation

V41.22 no longer imports `../beta/app.js` directly at runtime. CI deterministically builds a V41.22-local `app.js` snapshot from the protected beta baseline and applies only the bounded core semantic edits plus a distinct V41.22 build identity. Deployment rebuilds the same snapshot before publishing.

The already field-qualified V41.21 network fail-stop behavior and calm audio-first status are carried forward unchanged in local V41.22 files.

## Excluded

No saved-audio Web Speech reintegration, Whisper quality lane, automatic retry, concurrency, backend, provider abstraction, or production/root mutation.

## Gate

One short Edge run must show: one network failure at most, audio/replay healthy, speaker boundaries healthy, completion successful, and exported completion metrics counting audio-only answer evidence. One Chrome regression run must show LIVE text still works and completion metrics remain correct.

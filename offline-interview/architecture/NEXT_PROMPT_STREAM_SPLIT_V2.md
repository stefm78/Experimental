# SUPERSEDED — Offline Interview two-stream correction V2

Status: SUPERSEDED_BY_EXECUTED_PRODUCT_TRANSCRIPTION_SPLIT_V3

The V2 prompt in this file proposed `PRODUCT / WEB APP` plus a broad `NATIVE SPEECH CAPABILITY` stream. Physical V41.23 evidence on 2026-09-13 refined the causal boundary: the Web Product completed the interview and preserved a finalized/decoded/validated audio asset with no capture gaps, while the system transcription returned no text.

The active candidate architecture is therefore narrower:

1. `STREAM PRODUCT / WEB APP`
2. `STREAM TRANSCRIPTION ENGINE`

Shared boundary: `offline-interview.transcription-engine-contract.v1`.

Product owns interview semantics, the current healthy Web capture/audio asset, `sessionId`/`turnId`/`audioRef`, review/export and human truth. Transcription Engine owns `AUDIO -> TEXT`, provider selection/execution/status, draft text and provider qualification. Provider failure cannot invalidate Product audio. Browser/system Web Speech is connected as `LIVE_DRAFT_ONLY`; replayable PCM providers remain independently qualified candidates.

Current durable work:

- Product PR: #105 (`offline-interview-product-web-v1`)
- Transcription Engine PR: #107 (`offline-interview-transcription-engine-v1`)
- Product issue: #103
- Transcription Engine issue: #104
- PR #106 is superseded and closed without merge.

The next Product gate is a short Product/Transcription integration check. The next provider gate is S1 replayable-provider decision. Do not resurrect the V2 Native Speech/host-first trajectory unless new evidence establishes an Android-specific Product need.

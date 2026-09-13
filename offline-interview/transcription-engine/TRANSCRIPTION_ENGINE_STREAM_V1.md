# STREAM TRANSCRIPTION ENGINE V1

Status: CANDIDATE

## Mission

Own exactly one product capability for Offline Interview:

`AUDIO -> TEXT`

The Product Web application remains responsible for interview semantics, navigation, participants, capture lifecycle, audio ownership, review, export and human truth.

## Physical basis

A real V41.23 session on 2026-09-13 completed with a finalized/decoded/validated Web audio asset and no capture gaps, while the browser system recognizer produced `system_boundary_live_missing` and `system_transcription_missing`. The current causal failure surface is transcription, not Product/audio capture.

## Contract

Shared boundary: `offline-interview.transcription-engine-contract.v1`.

Turn-scoped commands/events carry Product-owned `sessionId` / `turnId`. Provider results with mismatched scope are rejected. Provider text is draft. Human-edited or human-locked text cannot be silently overwritten. Provider failure cannot invalidate or delete Product-owned audio.

## Providers

- browser/system Web Speech: connected behind the V41.23 engine port as `LIVE_DRAFT_ONLY`; saved-audio replay is not qualified on the tested path;
- Android system/default: `LIVE_DRAFT_ONLY`, long-form pivot already confirmed by #98/#99/#100;
- Android explicit on-device: bounded control candidate;
- Vosk: replayable PCM candidate, architecture PASS / quality HOLD from #96;
- Whisper/sherpa PCM: replayable provider benchmark candidate from #97 / existing labs.

## Gates

`TRANSCRIPTION_INTEGRATION_READY = CANDIDATE_AUTOMATED`

Means Product can depend on a provider-neutral boundary and provider unavailability can be represented without losing audio/interview state.

`TRANSCRIPTION_PROVIDER_QUALIFIED = HOLD_PROVIDER_DECISION_BENCHMARK`

Means no replayable provider is yet selected as durable product default.

## Next

S1 is a provider-decision benchmark, not another Product refactor and not another system-default endpointing iteration. Prefer the exact same Product-owned recorded audio input for replayable PCM providers. Measure quality, coverage, critical entities/meaning, latency/RTF, offline/network behavior and device/resource cost.

A qualified provider hands back only provider identity, capabilities, evidence and the smallest adapter requirement. Product integration is then solved against the current Product baseline.

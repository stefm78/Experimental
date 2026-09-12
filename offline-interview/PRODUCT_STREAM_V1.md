# Offline Interview — Product Stream v1

Status: ACTIVE DEVELOPMENT / NOT PROMOTED
Base: stream-split foundation derived from H4 head `9bf655d92468cb6c9d34b51ccd1100c5d2c1adcf`.

## Mission

Produce a usable Offline Interview Android application without waiting for final ASR-provider qualification.

The product must preserve the user's interview and audio even when speech recognition is unavailable, degraded or later replaced.

## Current product baseline

The first Product Stream increment intentionally preserves the H4 critical audio path:
- one authoritative `AudioRecord -> WAV` master;
- blocking STT pipe writes isolated from the capture thread;
- questionnaire loading and stable question IDs;
- direct JSON interview links/files;
- transcript draft display and `human_lock` precedence;
- JSON result export;
- diagnostic export without ADB;
- tactical reinstall-only distribution until durable signing exists.

The native recognizer is now classified as `SYSTEM_NATIVE_DRAFT`. Its quality gate lives in Speech Engine Stream and does not block ordinary product work.

## Product-owned truths

1. Master audio existence and integrity.
2. Interview/question identity and boundaries.
3. Session lifecycle and persisted resume state.
4. Human edits / human lock.
5. Product export and diagnostics.

ASR output is not authoritative over any of the above.

## P1 acceptance

P1 is a product-baseline qualification, not an ASR-quality qualification.

PASS requires:
- app launches as `Offline Interview`;
- questionnaire can be loaded and navigated;
- continuous master WAV remains healthy;
- interview can complete even if STT degrades;
- transcript draft can be displayed and human-locked when available;
- final JSON is generated and saveable;
- diagnostic surface remains available;
- no ANR/crash in one normal multi-question interview;
- no answer migration between turns.

P1 does **not** require any WER threshold.

## Ordered product backlog after P1

1. **Persistence / resume** — durable session checkpoint and resume after kill/restart.
2. **Interruption policy** — phone/audio-focus interruption pauses and requires explicit user resume.
3. **Media-session controls** — lock-screen and Bluetooth play/pause/seek where product playback exists.
4. **Transcript UX** — clear draft/final/human-lock states; no provider text silently overwrites a human edit.
5. **Audio/result export** — explicit user-controlled export/share of result and master audio where appropriate.
6. **Durable signing** — in-place update path instead of tactical uninstall/reinstall.
7. **Product polish** — navigation, progress, error recovery and accessibility.

Backlog order may change only from observed product evidence; ASR provider research cannot pre-empt these product responsibilities by itself.

## Speech integration rule

The Product Stream depends only on `offline-interview.speech-engine-contract.v1`.

A newly qualified provider is integrated only after a fresh Product Stream solve from the then-current protected baseline. Provider lab implementation details are not copied wholesale.

## Independent gates

- `APP_BETA_READY`: owned here.
- `ASR_PROVIDER_QUALIFIED`: owned by Speech Engine Stream.
- `PRODUCT_QUALIFIED`: later release-level composition gate.

The expected near-term state is allowed to be:

`APP_BETA_READY=PASS`
`ASR_PROVIDER_QUALIFIED=HOLD`

That state is not a contradiction; it is the purpose of the stream split.

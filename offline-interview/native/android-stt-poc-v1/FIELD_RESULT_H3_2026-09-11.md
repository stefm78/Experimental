# Offline Interview Android H3 — physical field result — 2026-09-11

## Evidence authority

Human-provided physical Android screenshot after installing and running H3 (`0.4.2-h3-tactical`).

## Direct observations

- UI reached `Q02 · 2/5` of the bundled five-question demo interview.
- Runtime status displayed: `STT_DEGRADED Q02: error=11 — WAV continue.`
- Android subsequently displayed the system ANR dialog: `00 Offline Interview Native ne répond pas.` with `Fermer l'application` / `Attendre`.

Android `SpeechRecognizer` error code 11 is `ERROR_SERVER_DISCONNECTED` on the targeted Android API.

## H3 verdict

`FAIL_PHYSICAL_H3_ERROR_SERVER_DISCONNECTED_Q02_ANR`

H3 solved the previously observed overlapping-recognizer `ERROR_RECOGNIZER_BUSY (8)` mechanism, but the physical successor exposed a different failure mode. No merge or promotion is justified.

## Causal hypothesis bounded by code inspection

H3's authoritative capture loop writes each PCM chunk to the WAV and then performs a synchronous `FileOutputStream.write()` into the SpeechRecognizer pipe while holding the STT sink monitor. If the recognizer/provider disconnects and stops draining that pipe, the write can block. A UI transition that needs the same monitor can then block the main thread, while the single capture thread also stops advancing the WAV path. This is structurally capable of producing the observed ANR and violates the intended rule that STT backpressure must never stall authoritative audio capture.

The screenshot proves the error=11 + ANR observation. The pipe-backpressure chain is a code-supported causal hypothesis to be challenged by H4 physical evidence, not retroactively declared proven.

## H4 required properties

1. AudioRecord -> WAV write path must never execute a blocking STT pipe write.
2. STT PCM delivery must be bounded and disposable.
3. UI/main thread must never wait on STT feeder progress.
4. Provider `ERROR_SERVER_DISCONNECTED (11)` may receive at most one bounded retry while WAV continues.
5. Q01→Q05 routing remains by session identity; human lock remains authoritative.
6. Candidate remains HOLD until a fresh physical five-question result and absence of ANR.

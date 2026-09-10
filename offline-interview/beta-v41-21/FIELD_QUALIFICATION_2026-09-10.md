# Offline Interview V41.21 — Field qualification — 2026-09-10

## Scope

This record qualifies the September 10 Edge field run supplied after V41.21 deployment. It does not promote production/root and does not reopen the STT engine exploration.

## Evidence observed

Browser/runtime behavior in the supplied export:

- exactly one `speech_recognition_error` with `error: network` occurred at the start of the session;
- no subsequent SpeechRecognition network-error storm is present in the runtime event stream;
- three speaker windows were captured across two semantic boundaries;
- the master audio blob finalized successfully (`300722` bytes, `audio/webm;codecs=opus`);
- decode succeeded at `18660 ms` for a logical stop of `18413 ms`, tail `247 ms`, ratio `1.013414`;
- `captureGaps` is empty;
- replay was started successfully for all three recorded turns;
- interview completion succeeded;
- LIVE text remained unavailable on this Edge run, which is expected under the V41.21 degraded policy after the first browser STT network failure.

## Verdict

### Audio capture / persistence / replay

PASS for this Edge run.

### Speaker segmentation

PASS at the instrumentation level for this Edge run. The three windows are contiguous (`0→5529`, `5529→14312`, `14312→18413`) and no capture gaps were recorded.

### LIVE STT fail-stop behavior

PASS for the intended V41.21 policy. One `network` failure is observed and the previous repeated restart/error storm does not recur.

### LIVE transcript availability on Edge

DEGRADED / unavailable in this run. This is treated as a browser-service capability failure, not as an audio-capture failure.

## Product trajectory decision

`STT_ENGINE_EXPLORATION = CLOSED_FOR_MAIN_PATH`

The main product no longer depends on saved-audio Web Speech or automatic secondary quality machinery. Audio remains authoritative; LIVE remains best-effort. Do not reopen the browser saved-audio experiments unless new evidence materially changes the platform capability.

V41.21 is accepted as the current beta baseline for product stabilization, subject to one lightweight Chrome smoke control because Chrome LIVE is the positive path and the V41.21 network-degradation shim should remain inert there.

## Newly exposed product consistency issue

The exported completion summary reports `answeredQuestions: 0` / `unansweredQuestions: 1` when all answer turns are audio-only, while the exported question itself has `status: answered`. This follows the current runtime rule that counts a question as answered only when an answer turn contains non-empty text. For an audio-authoritative degraded mode, that semantic is inconsistent.

This is a product-state/export semantics defect, not an STT-engine defect. It should be addressed in the next product stabilization increment so that an audio-only captured answer counts as addressed without fabricating transcript text.

## Next gate

No more STT laboratory gate is required. The next bounded work item is product stabilization:

1. correct audio-only answer/progress/export semantics;
2. preserve the current V41.21 Edge fail-stop behavior;
3. preserve Chrome LIVE behavior;
4. keep production/root protected;
5. perform one short Edge + Chrome product smoke after the correction.

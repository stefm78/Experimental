# H5 — autonomous continuation prompt

Reprendre Offline Interview depuis la qualification physique H4, considérée comme autorité de stabilité.

## Facts already proved

H4 physical session `17101e07-f6d9-4470-9a60-9e2ca49c41ef` proves:

- build `android-native-0.4.3-h4-tactical`;
- runtime schema v4.3;
- completed 5/5;
- continuous authoritative WAV;
- `pcmBytes=612480`;
- `sttDegraded=false`;
- `droppedSttPcmChunks=0`;
- no provider error on Q01-Q05;
- no late events;
- no ANR reported.

Therefore H4 stability/routing gate is PASS and MUST NOT be reopened without new contradictory physical evidence.

## New problem

All five STT sessions have `finalCount=0`, `segmentCount=0`, and all exported answers are sourced from `partial_snapshot_at_turn_close`.

The next objective is not another architecture rewrite. It is to obtain a provider-durable final result per question whenever Android can produce one, while preserving every H4 stability invariant.

## Required H5 design

1. Preserve H4 AudioRecord -> WAV loop unchanged in authority and blocking behavior.
2. Never perform an STT pipe write on the master capture thread.
3. Never wait synchronously on SpeechRecognizer from the UI thread.
4. At a turn boundary, record the exact boundary immediately and switch UI/current-turn immediately.
5. Stop feeding the previous turn at that exact boundary and close/end its audio input in a way that gives SpeechRecognizer a bounded opportunity to emit `onResults` / final output.
6. Do not overlap live SpeechRecognizer ownership if that would reintroduce H2 `ERROR_RECOGNIZER_BUSY`.
7. During the bounded old-turn finalization interval, buffer the new-turn PCM using the already-qualified bounded pending PCM mechanism.
8. Retire/destroy the old recognizer after either:
   - a final callback arrives, or
   - a strict bounded finalization timeout expires.
9. Only then create the new-turn recognizer and flush the new-turn prebuffer into it.
10. The transition/finalization work must be asynchronous and cancellable. No ANR path.
11. Keep partial snapshot as a fallback only. Selection precedence:
   `human_lock > provider_final > segment_durable > partial_snapshot`.
12. Export explicit finalization telemetry per session:
   - finalizationRequestedAtMs
   - finalizationCompletedAtMs
   - finalizationOutcome = final | segment | timeout_partial_fallback | provider_error
   - finalizationLatencyMs
13. Preserve bounded transient recovery for provider errors 7/8/11.
14. Advance identity to a distinct H5 version/runtime schema.
15. Add automated structural tests proving:
   - master capture has no blocking STT write;
   - UI does not sleep/join/wait for provider finalization;
   - next-turn PCM is bounded/prebuffered during finalization;
   - old and new recognizer ownership is serialized;
   - fallback precedence is deterministic.

## Qualification

Automated gate must PASS before an APK is offered.

Physical H5 test must use five spoken answers and return result JSON. PASS for the finalization mechanism requires:

- no ANR;
- WAV continuous and `pcmBytes > 0`;
- 5/5 answers;
- no cross-question migration;
- `droppedSttPcmChunks=0` preferred, any non-zero drop is a failure for this gate;
- at least one provider final or segment durable result must be observed, unless Android demonstrably never emits one under the supplied-audio mode; if zero durable results remain, classify HOLD and do not pretend the finalization problem is solved;
- every timeout fallback is explicitly observable.

Transcription *accuracy* remains a separate gate. Do not claim accuracy improvement without a known spoken ground truth or independently transcribed WAV.

## Governance

Do not merge H4/H5 into main merely because a build exists. Preserve the physical evidence chain. If a new H5 candidate is built, stop at the next physical gate unless existing repository policy explicitly authorizes further integration.

# Android native STT POC V3 — physical-device result — 2026-09-11

## Verdict

**PASS_AUDIO_ARCHITECTURE / PASS_TURN_ROUTING_V3 / PASS_HUMAN_LOCK / OBSERVABILITY_NOTE_ERROR_5**

The installed Android APK `0.3.0` was exercised on the physical device with three application-controlled per-turn STT sessions while preserving one continuous authoritative `AudioRecord` -> WAV capture.

## Observed evidence

- schema: `offline-interview.android-native-stt-poc.v3`
- appVersion: `0.3.0`
- audioAuthority: `single_AudioRecord_PCM_to_WAV`
- routingAuthority: `stt_session_identity`
- PCM bytes: `524800`
- audio duration: `16400 ms`
- turn boundaries: T1 `0 ms`, T2 `4941 ms`, T3 `9868 ms`
- three distinct STT session IDs were created
- no `RecognitionPart` timestamp or segment/final callbacks were required

Per-turn results:

- T1 draft: `alpha ceci est ma première réponse`
- T2 draft: `bêta ceci est ma seconde réponse`
- T3 draft: `tango ceci est ma troisième réponse`
- T3 canonical: `tango ceci est ma troisième réponse`
- T3 canonical source: `human_lock`

Each draft was captured as `partial_snapshot_at_turn_close` and remained isolated to its own STT session. No whole later answer leaked into an earlier turn.

## Qualification against the V3 gate

1. Continuous master WAV with non-zero PCM: **PASS**.
2. One authoritative `AudioRecord`: **PASS**.
3. Three distinct application-owned STT sessions: **PASS**.
4. T1/T2/T3 each contain their own spoken answer: **PASS**.
5. No material cross-turn contamination: **PASS**.
6. No dependency on word timestamps: **PASS**.
7. No dependency on segment/final callbacks: **PASS**.
8. Human lock remains canonical: **PASS**.
9. Routing is auditable by session identity: **PASS**.
10. Browser beta / product runtime remained outside this isolated POC change and CI regression suite had passed before the field test: **PASS**.

## ERROR_CLIENT 5 observation

Each STT session emitted Android `SpeechRecognizer` error code `5` immediately after intentional closure:

- T1: boundary at `4941 ms`, error callback at `4950 ms` (+9 ms)
- T2: boundary at `9868 ms`, error callback at `9878 ms` (+10 ms)
- T3: interview stop around `16477 ms`, error callback at `16512 ms` (+35 ms)

Android documents code `5` as `SpeechRecognizer.ERROR_CLIENT` (client-side error). The callbacks occurred only after deliberate pipe/session teardown, after useful partial transcription had already been produced. They therefore do not invalidate the routing or audio qualification.

The current boolean `sttDegraded=true` is conservative but semantically noisy for this teardown pattern. A follow-up observability refinement should preserve the raw error while distinguishing `expected_teardown_error` from an error occurring while a session is still active.

## Decision

V3 has passed the physical-device gate for the architectural hypothesis:

`ONE CONTINUOUS AUDIORECORD/WAV + ONE STT SESSION PER TURN + SESSION-IDENTITY ROUTING`.

The V3 branch is eligible for integration into `main` once fresh CI and CAS checks pass. Further work should treat teardown error classification as an observability refinement, not as a reason to reopen turn-routing architecture.

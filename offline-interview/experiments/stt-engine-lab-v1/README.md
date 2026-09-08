# Offline Interview — STT Engine Lab V1

Purpose: requalify the audio/STT engine independently from the interview application. This lab is disposable and must not be treated as a V41.x successor.

## Frozen application boundary

Production and V41.15/V41.18/V41.19 are not modified. The lab has no questionnaire, IndexedDB recovery layer, service worker, automatic quality queue, automatic retries, or default STT concurrency.

## Test layers

A. CAPTURE — microphone stream, meter, continuous master MediaRecorder.

B. SEGMENTATION — a second MediaRecorder rotates on manual A/B boundaries while the master recorder stays running. Each finalized segment is immediately replayable.

C. LIVE STT — explicit start/stop only. No restart loop. Standard and local-if-supported modes expose raw start/audiostart/speechstart/result/error/end events.

D. SAVED-AUDIO STT — explicit per-segment buttons. `SpeechRecognition.start(audioTrack)` is invoked on a decoded segment routed through WebAudio MediaStreamDestination. Standard and local-if-supported are separate manual strategies.

E. CONCURRENCY — intentionally absent from V1. It is tested only after C and D are independently reliable.

F. FALLBACKS — intentionally not embedded yet. A fallback is admitted only after C/D evidence shows it is required and a candidate beats the current local Whisper quality/latency tradeoff.

## Important product repair

`Effacer transcription sauvegardée` removes prior saved-audio STT runs and does not set any human-protection state. The same segment can immediately be retranscribed again, indefinitely. There is no `humanEdited` lock in this laboratory.

## Edge research finding

Microsoft documents an on-device SpeechRecognition model in Edge Canary/Dev 150+ and documents `start(MediaStreamTrack)`. Stable/cloud-backed Edge may still depend on a remote recognition service; therefore network errors must be measured rather than hidden by retries.

## Human protocol (first pass)

For each browser separately:

1. Start capture; speak natural French for ~15 s; create boundary; speak another ~15 s; create boundary; speak ~10 s; stop.
2. Replay every segment. Mark capture/segmentation PASS only if words and boundaries are audibly correct.
3. Start LIVE standard and speak natural French for ~20 s. Note text quality and any raw errors. Stop explicitly.
4. On two saved segments, run standard saved-audio STT once each. Do not run concurrently with LIVE.
5. If `local` is available, repeat one saved segment in local mode; otherwise record that it is unavailable.
6. Clear one saved transcription and retranscribe it again. This must always work.
7. Export diagnostic JSON and compare Chrome vs Edge.

## Gate

Do not integrate anything into Offline Interview until capture + segmentation are PASS and the best isolated LIVE/SAVED strategy is identified independently for Chrome and Edge.
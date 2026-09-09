# Autonomous mission — STT Engine Lab V1.2

/research /audit /solve /build

Continue the fundamental Offline Interview audio/STT requalification from the two human V1.1 diagnostic exports, without modifying or reintegrating the Offline Interview application runtime.

Objectives:
1. Treat the supplied Edge 152 and Chrome 152 exports as primary evidence.
2. Reclassify A CAPTURE, B SEGMENTATION, C LIVE STT and D SAVED-AUDIO STT independently.
3. Correct laboratory instrumentation before interpreting model quality: do not concatenate interim SpeechRecognition hypotheses as separate transcript chunks.
4. Explain the observed divergence: Edge LIVE standard succeeds in the new field run but saved-audio `start(audioTrack)` repeatedly returns empty; Chrome LIVE and saved-audio succeed; Edge local fr-FR is unavailable while Chrome local is available.
5. Research current browser/API behavior only where needed, especially SpeechRecognition `start(audioTrack)`, on-device `processLocally`, model availability and media-end semantics.
6. Build the smallest reversible V1.2 lab experiment that can discriminate whether Edge saved-audio failure is caused by premature recognizer termination, initial silence, result-accounting defects, or a browser/service limitation.
7. No automatic retries, no concurrency, no service worker, no V41.x changes.
8. Instrument every saved-audio run with audio duration, leading-speech estimate, source offset, first-result latency, total latency, result count, exact errors, and whether recognition ended before the media source ended.
9. Test three explicit saved-audio strategies: raw standard track, standard track with leading silence trimmed, and local dictation if actually available.
10. Preserve unlimited manual clear/retranscribe semantics.
11. Run CI, publish the isolated lab, and stop only at the next short human Chrome/Edge test that discriminates the remaining Edge saved-audio uncertainty.

Fail fast: hypothesis -> minimal experiment -> measure -> PASS / FAIL / INCONCLUSIVE. Do not mask an API failure with retries or reintegrate anything into the product.
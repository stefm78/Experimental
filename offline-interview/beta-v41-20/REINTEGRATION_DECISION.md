# Offline Interview V41.20 — reintegration decision

## Decision

Exit the STT mechanism exploration loop for the main interview path.

The isolated Simple STT Lab has now produced a sufficiently discriminating result on Chrome 152 and Edge 152:

- microphone recording works on both;
- LIVE Web Speech transcription works on both for natural French samples;
- Chrome can transcribe saved audio through browser Web Speech in the tested environment;
- Edge consumes the entire saved audio track, keeps the recognition track live until media end, and still returns an empty transcript.

Therefore the minimum product reintegration is:

1. keep LIVE system SpeechRecognition as the only automatic transcription path;
2. keep the canonical audio recording and replay path unchanged;
3. remove V41.17/V41.18/V41.19 background quality machinery from the candidate;
4. suppress saved-audio retranscription in this candidate rather than expose a mechanism known to fail on Edge;
5. do not integrate the experimental Whisper-local lab into the product until it is separately field-qualified;
6. do not change production/root.

This follows the governed continuation reintegration invariant: experiment PASS proves the tested mechanism only; integration is independently minimized from the protected product baseline.

## Best next autonomous prompt executed

`/audit /solve /build — Exit the exploratory STT loop and re-enter the main Offline Interview product from the protected beta baseline. Preserve the UX, navigation, storage, continuous master audio, replay and speaker-boundary behavior already judged useful. Integrate only the mechanism actually proven by the Simple STT Lab: LIVE SpeechRecognition remains the sole automatic transcription path. Remove all automatic quality-lane behavior from V41.17/V41.18/V41.19 and do not copy the laboratory architecture into the product. Because Edge 152 repeatedly consumes complete saved-audio tracks and returns empty browser transcripts, suppress saved-audio browser retranscription in the reintegration candidate rather than retrying or hiding failure. Keep audio replay as the recovery/source-of-truth path. Do not integrate Whisper local yet: it remains an independent secondary candidate until field-qualified. Build a new isolated beta candidate V41.20, preserve production/root, add regression tests proving no quality controller is loaded and no saved-audio retranscription button is exposed, publish it, and stop only at a short real-interview Chrome/Edge product gate. If this product-context gate passes, the next step is stabilization/promotion work rather than more STT architecture exploration.`

## Human gate

Run one short real interview in Edge and one in Chrome, with at least two speaker changes and natural French speech.

Pass requires:

- recording/replay remains faithful;
- LIVE text appears and is usable on both browsers;
- speaker changes remain coherent;
- no background retranscription/status noise appears;
- no saved-audio retranscription button is exposed;
- export/session persistence still works.

No production promotion is authorized by this candidate alone.

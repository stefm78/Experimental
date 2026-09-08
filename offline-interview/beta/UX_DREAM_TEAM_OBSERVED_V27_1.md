# UX Dream Team — V27.1 Runtime Recovery

Date: 2026-09-03

## Decision

V27 is rejected as an interactive runtime.

Field evidence showed two independent defects:

1. **Mandatory boundary Whisper is not viable in the interactive path**
   - speaker/question boundaries triggered `whisper-local-boundary` inference;
   - one field run completed only 4/8 questions before the browser became non-responsive;
   - repeated Whisper hallucinations were observed on short bounded segments;
   - CPU/WASM work was executed in the page runtime and materially degraded interaction latency.

2. **Cache identity was inconsistent**
   - `index.html` still loaded `app.js?v=26`;
   - the V27 service worker cached `app.js?v=27`;
   - different Chrome profiles/cache states could therefore execute different resource histories.

A third presentation defect was confirmed: the microphone emoji could render as an empty glyph container depending on the browser/font stack.

## V27.1 recovery scope

V27.1 is deliberately a recovery release, not a new speaker-boundary experiment.

- remove mandatory local Whisper transcription at every speaker/question boundary;
- restore the non-blocking V26 semantic `SpeechRecognition.takeSegment()` path;
- keep the V27 explicit question-transfer wording: `Basculer sur la question N →`;
- keep the compact microphone treatment but replace the emoji glyph with inline SVG;
- align `index.html`, runtime build, service-worker registration and service-worker cache identity on V27.1;
- retain Whisper only as the existing fallback when system speech yields no usable text after a normal capture stop.

## Important limitation

The V26 late-result speaker-boundary defect is reopened by design. V27.1 prioritizes runtime usability and deterministic deployment identity over an unproven blocking correction.

Do not declare `CAPTURE_RELIABILITY_PASS` from V27.1.

The next boundary design must satisfy both constraints simultaneously:

- no main-thread or per-switch local model inference;
- no systematic late-result attribution to the next speaker.

## V27.1 recovery gates

- no Chrome `Page not responding` event during a 5–7 minute test;
- no repeated `whisper-local-boundary` sources in the export;
- no long repetitive Whisper hallucination caused by speaker switching;
- live transcript and speaker controls stay responsive through at least ten switches;
- microphone SVG is visible in both tested Chrome profiles;
- `index.html` and service worker request the same `app.js?v=27-1` resource;
- question transfer remains explicit and uses the question number.

Expected release state after machine gates: `V27_1_DEPLOYED_AWAITING_RECOVERY_FIELD_TEST`.

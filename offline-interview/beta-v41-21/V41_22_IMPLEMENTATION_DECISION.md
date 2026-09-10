# V41.22 implementation decision — product-state correctness

## Decision

Do **not** patch `offline-interview/beta/app.js` in place.

V41.20 and V41.21 deliberately import that shared V41.15 runtime. Mutating it now would silently and retroactively change historical beta behavior and would make field evidence harder to reproduce.

Do **not** add another DOM-only wrapper that fabricates answer text or rewrites exported files after the fact. The defect is in core answer-presence semantics and should be corrected at the source.

## Minimum maintainable integration

Create V41.22 with a dedicated runtime snapshot derived from the current V41.15 beta runtime, while continuing to reuse stable support modules/assets from `../beta/` where safe.

The dedicated runtime should make only these semantic changes:

1. bump runtime identity to V41.22 so exported provenance identifies the actual candidate;
2. introduce one pure predicate such as:

```js
function turnHasAnswerEvidence(turn) {
  if (!turn || turn.type !== 'answer') return false;
  if (cleanText(turn.text)) return true;
  const ref = turn.audioRef;
  return Boolean(ref?.recordingId && Number.isFinite(Number(ref.startMs)) && Number.isFinite(Number(ref.endMs)) && Number(ref.endMs) > Number(ref.startMs));
}
```

3. use that predicate consistently for:
   - question progress / addressed count;
   - completion summary `answeredQuestions` / `unansweredQuestions`;
   - exported question status fallback when response state is not already explicit;
4. never insert placeholder transcript text for audio-only turns;
5. preserve the three distinct states: text answer, audio-only answer, unanswered;
6. carry forward V41.21 network fail-stop and calm degraded-mode policy unchanged in behavior.

## Why a runtime snapshot is justified here

The current wrapper approach was useful for proving product policy with minimum blast radius. It has reached its limit: the next defect is inside state/export semantics, and field exports still report the underlying V41.15 BUILD_ID even when the V41.21 wrapper is active. A dedicated runtime restores traceable provenance and prevents future wrapper-on-wrapper repair.

This is a bounded consolidation, not an architectural expansion.

## Required regression cases

- audio-only answer window with valid `audioRef` => addressed;
- text-only answer => addressed;
- text + audio => addressed once;
- empty text + missing/invalid audioRef => unanswered;
- multiple speaker answer turns => one question addressed;
- export contains no fabricated text for audio-only turns;
- V41.21 fail-stop contract remains true;
- Chrome LIVE positive path remains untouched by the answer-presence predicate.

## Promotion boundary

V41.22 remains a separate beta candidate. Production/root must remain unchanged until a short Edge + Chrome field smoke validates it.

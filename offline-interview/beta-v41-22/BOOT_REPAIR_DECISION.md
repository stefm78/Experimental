# V41.22 boot repair — 2026-09-10

## Field symptom

The V41.22 home screen rendered, but clicking either structured interview or free interview left the page frozen on the setup view. Runtime status fields remained at their initial placeholders (for example `Vérification…` / `Détection…`).

## Root cause

V41.22 generated a local `app.js`, but that module retained relative imports such as `./system-stt.js`, `./audio-window.js`, `./direct-interview-link.js`, and `./whisper-quality.js`. Those files were not present in the V41.22 deployment directory. The module therefore failed before `init()` could attach the interview button handlers.

The same incomplete isolation also affected local runtime assets referenced by `app.js`, including `./interview.json` and `./sw.js`.

## Repair

V41.22 now builds a self-contained deployment surface at CI/deploy time:

- local `app.js` with V41.22 build identity and answer-evidence semantics;
- local JS module dependencies;
- local `interview.json`, styles, manifest, icon, schema and authoring assets;
- local `shell.html` copied from the protected beta UI baseline;
- local V41.22 service worker with a dedicated cache namespace;
- `index.html` bootstraps only local V41.22 assets.

No V41.15/V41.20/V41.21 runtime file is modified. Production/root remains unchanged.

## Regression rule

CI must fail if V41.22's index references the shared beta app/index/styles or if any generated module/runtime dependency is missing.

## Product trajectory

This is a boot-completeness repair, not a reopening of STT exploration. After deployment, the next gate is one short real interview on Edge and one Chrome control. If both launch and complete, continue product stabilization from V41.22 rather than creating another STT experiment.

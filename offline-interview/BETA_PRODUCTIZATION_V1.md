# Offline Interview — Beta Productization V1

## Purpose

This layer closes productization gaps without reopening the physically qualified audio architecture and without changing the H2 physical gate.

Base H2 commit: `f0a47f583f8acabe9d94602682904d5dc0dbea3c`.

## Product surfaces already present

- Web/PWA Offline Interview runtime under `offline-interview/` and `offline-interview/beta/`.
- Direct interview-link support in the beta surface.
- Interview contract schema `offline-interview.interview-spec.v1`.
- Product-result schema emitted by Android: `offline-interview.interview-result.v1`.
- Android native runtime preserving continuous WAV + per-question on-device STT routing.
- GitHub Pages deployment workflow.
- Android CI producing a tactical reinstall-only APK while durable signing is unavailable.

## Productization additions

### Cross-platform acceptance

`test-beta-productization.mjs` verifies in one executable gate:

- web, beta and Android bundled interview specs remain `offline-interview.interview-spec.v1`;
- stable/unique question IDs are present;
- Android visible label remains `00 Offline Interview Native`;
- H2 version identity remains versionCode 7 / `0.4.1-h2-tactical`;
- Android runtime exports v4.1 diagnostics and build provenance;
- continuous WAV and STT-session routing invariants remain represented in the runtime;
- bounded NO_MATCH recovery remains present;
- tactical and durable-signing artifact paths remain distinct;
- direct-link support remains present.

### CI acceptance

`.github/workflows/offline-interview-beta-productization.yml` runs:

1. core product runtime contract;
2. direct-interview-link contract;
3. latest web-beta coherence test;
4. cross-platform beta productization contract.

This converts previously separate assumptions into one release-oriented gate.

### Machine-readable beta state

`beta/beta-status.json` exposes the current web and Android release identities plus gates. It is intended to be consumed by a future beta landing/release surface rather than duplicating status text in multiple places.

## Gap classification

### IMPLEMENTED NOW

- Cross-platform contract gate.
- Direct-link regression gate.
- Android distribution-policy regression gate.
- Machine-readable beta status.
- Separation of productization work from PR #89 H2 physical qualification.

### DEFER_PHYSICAL_EVIDENCE

- H2 Q01 NO_MATCH recovery physical PASS.
- H2 runtime stability/freeze physical PASS.
- Final H2 promotion/merge decision.

### DEFER_EXTERNAL_DEPENDENCY

- Durable Android signing inside GitHub Actions.
- In-place Android update guarantee until durable signing is active.

### REJECT_NOT_WORTH_IT NOW

- H3 STT architecture rewrite without new physical evidence.
- New backend solely to transport interview specs/results while static JSON/direct links remain sufficient.
- Large Android refactor before a material defect requires it.

## Beta acceptance matrix

| Test | Automated now | Physical required |
| --- | --- | --- |
| Bundled interview contract | PASS gate | No |
| External/direct interview link contract | PASS gate | Android open UX still physical |
| Five stable question IDs | PASS gate | Speech capture yes |
| Result schema | Android source gate | Real output yes |
| Human lock | Existing runtime | Yes |
| NO_MATCH recovery | Source/CI gate | Yes |
| Tactical artifact policy | PASS gate | Install yes |
| Web beta coherence | PASS gate | Browser smoke optional |
| Runtime freeze diagnostics | H1 implemented | Incident-dependent |
| Durable updates | No | Blocked by signing secret setup |

## Current release verdict

Automated productization can progress independently, but distributable beta remains gated by:

1. `HOLD_PHYSICAL_H2_NO_MATCH_RECOVERY`;
2. `HOLD_DURABLE_SIGNING` for normal in-place Android updates.

Tactical uninstall/reinstall testing remains explicitly supported.

# Android Native V4 runtime hardening — H1

## Trigger

Physical V4 usage was reported as broadly functional, with one observed application freeze followed by an apparent restart.

No logcat/ANR trace was available for that incident, so its exact cause cannot be asserted retrospectively.

## Risk identified in current V4

The V4 runtime still has synchronous work on the Android main thread in several places, including JSON/document handling and final product-result rendering. In particular, the product result and detailed STT event telemetry can grow with interview duration. This is a plausible UI-pressure path and must be reduced in a subsequent bounded code change.

H1 does not pretend to prove that this was the cause of the observed restart.

## H1 hardening added now

A process-level `RuntimeHealthApplication` is installed without changing the qualified AudioRecord/STT routing architecture.

It provides:

1. **UI-stall watchdog**
   - main-loop pulse every 1 second;
   - if the pulse is delayed by >= 5 seconds, the watchdog writes `runtime-health/last-ui-stall.json`;
   - the record contains timestamp, detected lag and the Android main-thread stack.

2. **Uncaught-crash recorder**
   - the existing Android uncaught-exception handler is preserved/delegated to;
   - before delegation, the app stores `runtime-health/last-uncaught-crash.json` locally.

3. **Previous-process-exit classification**
   - on startup, Android `ApplicationExitInfo` is queried;
   - latest exit is stored as `runtime-health/previous-process-exit.json`;
   - ANR, Java/native crash, low-memory and excessive-resource exits are surfaced by a one-time toast after relaunch.

## Identity/update safety

- applicationId remains `com.stefm78.offlineinterview.nativepoc`;
- durable signing path is unchanged;
- hardening build uses `versionCode 5`, `versionName 0.4.0-h1`;
- when the durable signing secrets are configured, H1 is intended to install as an in-place update over durable V4 versionCode 4.

## Explicit limitation

H1 makes the next freeze/restart diagnosable and avoids changing the audio/STT architecture. It does **not** yet remove every possible source of UI blocking.

The next bounded optimization, after CI and one short phone run, is to move heavy result serialization/document I/O fully off the main thread and bound detailed transcript-event telemetry. That change should be qualified separately because it touches the final export path.

## Physical acceptance

1. Install H1 as an update over the durable V4 installation.
2. Run the same five-question interview once.
3. Finish and save the result JSON.
4. Keep the app open/interactive for ~30 seconds after finalization.
5. Reopen the app once.
6. PASS if no freeze/restart is observed and normal capture/export still works.
7. If a freeze/restart occurs, report the on-screen toast text after relaunch. The local health files then identify whether the incident was ANR/crash/resource-related and capture the main-thread stack for a stall.

Verdict after automation only: `HOLD_PHYSICAL_RUNTIME_HARDENING_H1` until this short device check passes.

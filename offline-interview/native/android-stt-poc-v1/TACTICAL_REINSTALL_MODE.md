# Android tactical reinstall mode

## Purpose

Temporary distribution mode while the durable Android signing key is not yet available inside GitHub Actions.

## User-visible identity

Launcher label: `00 Offline Interview Native`

Rationale: numeric prefix is more robust than punctuation for appearing near the top of Android app lists and drawers whose sorting rules may ignore symbols such as `_`.

## Install semantics

Until durable signing is active in GitHub Actions:

1. uninstall any previously installed Offline Interview Native build;
2. install the latest artifact named `offline-interview-android-native-TACTICAL-REINSTALL-ONLY`;
3. do not expect in-place update compatibility between tactical artifacts because GitHub-hosted debug signing may change between builds.

This is an explicit temporary policy, not the final distribution architecture.

## Transition to durable mode

When the four Android signing secrets become available in GitHub Actions, the workflow switches automatically to the durable signing path and publishes `offline-interview-android-native-durable-debug`.

The first durable build may require one final uninstall/reinstall if the installed tactical build carries a different certificate. After the durable build is installed, future versions signed with the same durable key can use normal Android updates.

## Current tactical build

- versionCode: 6
- versionName: `0.4.0-h1-tactical`
- applicationId remains `com.stefm78.offlineinterview.nativepoc`
- runtime hardening H1 remains enabled

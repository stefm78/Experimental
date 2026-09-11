# Android Native STT POC — installability decision

Field symptom: Android displayed `Application non installée` when installing the routing-v2 APK over an already-installed prior POC.

Decision for the next physical-device test:

- keep the Kotlin namespace unchanged (`com.stefm78.offlineinterview.nativepoc`) so code/package structure is untouched;
- publish the routing-v2 test APK with a distinct Android application ID: `com.stefm78.offlineinterview.nativepoc.v2`;
- label it `Offline Interview Native STT POC V2`;
- do not rely on upgrade compatibility with an APK signed by a different ephemeral debug key;
- preserve the existing installed V1 side-by-side for comparison;
- treat stable long-lived signing as a separate distribution hardening step after the physical-device routing gate.

This is an installability/distribution change only. Audio authority, STT pipeline, routing logic, human canonical locks, qualified browser beta, and production behavior are unchanged.

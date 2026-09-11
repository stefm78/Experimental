# Android signing migration — one-time reinstall, durable updates afterwards

## Root cause

The historical CI workflow built `assembleDebug` on fresh GitHub-hosted runners without a pinned signing key. Android debug signing therefore depended on a runner-local `debug.keystore` rather than a durable application identity.

The installed V3 APK and a later V4 APK can consequently have:

- the same `applicationId`: `com.stefm78.offlineinterview.nativepoc`;
- increasing `versionCode`;
- different signing certificates.

Android recognizes the package as an update candidate but rejects installation because an update must be signed by the same accepted signing identity (or a valid signing lineage rooted in it).

## Consequence

The private key that signed the already-installed V3 APK was not persisted by the historical workflow. It cannot be reconstructed from the APK certificate.

Therefore a signature-compatible in-place update from that installed V3 to a new durable identity is not recoverable.

**One uninstall/reinstall is required.**

This should be the last forced reinstall caused by signing identity if the durable key is preserved.

## New durable identity

The durable signing identity generated for the migration has certificate SHA-256:

`D7:C1:15:C8:D9:13:55:BF:E0:8C:B7:DE:7D:DF:CF:69:85:8A:5D:7A:9B:88:22:21:57:FA:4B:B7:3F:F0:41:85`

The private keystore MUST NOT be committed to this public repository.

Required GitHub Actions secrets:

- `ANDROID_SIGNING_KEYSTORE_B64`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

The workflow verifies the restored keystore fingerprint before producing an artifact marked as durable/distributable.

## CI safety rule

When durable signing secrets are absent:

- compilation still runs;
- the artifact is explicitly named `UNSTABLE-SIGNATURE-do-not-update`;
- it is compile-only and MUST NOT be distributed as an Android update.

When durable signing secrets are present and the fingerprint matches:

- Gradle signs the debug APK with the durable key;
- CI publishes `offline-interview-android-native-durable-debug`;
- subsequent builds signed with this same identity can update the installed application as long as Android version-code rules are respected.

## Migration procedure

1. Configure the four GitHub Actions secrets from the externally retained signing bootstrap bundle.
2. Trigger/re-run the Android workflow.
3. Verify CI reports `DISTRIBUTABLE_APK=true` and the pinned certificate SHA-256.
4. Download the resulting durable-signed APK.
5. On the phone, uninstall the historical V3/V4 debug installation signed by the lost ephemeral key.
6. Install the durable-signed APK once.
7. For later versions, install normally as an update without uninstalling, provided they are produced through the durable-signing path.

## Security

Never publish or commit the `.jks`, its base64 representation, passwords, or private-key material. Losing the durable private key means losing the ability to update installations signed with it. Exposing it allows third parties to sign apparently valid updates for this package outside controlled distribution channels.

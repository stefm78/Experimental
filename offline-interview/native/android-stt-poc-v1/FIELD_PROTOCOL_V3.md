# Android native STT POC V3 — physical-device protocol

## Purpose

Validate deterministic per-turn STT isolation while preserving one continuous authoritative `AudioRecord`/WAV capture.

## Script

1. Start capture.
2. For T1 say: `alpha je suis dans la première réponse alpha`.
3. Press **Question suivante**.
4. For T2 say: `bravo je suis dans la deuxième réponse bravo`.
5. Press **Question suivante**.
6. For T3 say: `charlie je suis dans la troisième réponse charlie`.
7. Optionally press **Valider le texte humain** on T3 to verify human-lock precedence.
8. Press **Terminer**.
9. Copy the complete JSON export.

## PASS gate

PASS requires:

- schema `offline-interview.android-native-stt-poc.v3` and app version `0.3.0`;
- one continuous master WAV with non-zero PCM bytes;
- three distinct STT session identities;
- T1 draft dominated by `alpha`, T2 by `bravo`, T3 by `charlie`;
- no whole later answer retained in an earlier turn;
- missing word timestamps or segment callbacks do not prevent turn separation;
- any STT error is reported as degraded while master audio remains intact;
- a human lock, when used, remains canonical over later STT callbacks.

A small boundary word overlap is tolerable and must remain observable. A complete answer routed to the wrong turn is FAIL.

## Return evidence

Return only the complete JSON export unless installation/build itself fails. If installation fails, return the Android installer error and relevant `adb install` output when available.

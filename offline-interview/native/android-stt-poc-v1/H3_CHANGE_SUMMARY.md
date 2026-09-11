# H3 change summary

H3 is a bounded successor to the failed H2 physical gate.

- no audio architecture change;
- authoritative `AudioRecord` / WAV remains continuous;
- STT ownership is serialized across question boundaries;
- old recognizer is cancelled/destroyed before the next recognizer is created;
- first material provider error is preserved against later expected teardown callbacks;
- NO_MATCH bounded rearm remains intact;
- productization diagnostic surface remains intact;
- version identity: `0.4.2-h3-tactical`, versionCode 8, runtime schema v4.2.

Promotion remains blocked pending the physical H3 retest.

# Research notes — Android Voice Access coexistence v2

Official Android documentation states that when an `AccessibilityService` UI is on top, the accessibility service and an ordinary application can both receive audio input. Android explicitly describes this as enabling voice control while another application performs voice/video capture. This differs from the ordinary two-app case, where only one application receives audio and the other gets silence.

Google's Voice Access documentation describes Voice Access as an Android accessibility feature that uses voice commands to navigate and edit text, supports French, and requires microphone access while active.

The first field run is consistent with these documented semantics: master browser audio stayed live and audible while Voice Access was used. The field evidence is stronger than documentation alone because it was observed on the target class of device/browser.

Open issue: text commit timing. Voice Access may buffer recognition and only inject the final text after a later event or after competing capture conditions change. The browser cannot infer system recognition progress directly, so the correct observable is the first non-empty DOM input event and the recorder state at that instant.

The v2 harness therefore treats realtime commit as a separate capability from microphone coexistence.
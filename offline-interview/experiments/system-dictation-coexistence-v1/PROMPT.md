/research /audit /solve /build

Research and qualify whether mobile OS/system keyboard dictation should become part of Offline Interview's mobile transcription strategy, starting with Android and extending the analysis to iPhone/iPad and other realistic mobile architectures.

Do not assume that because Gboard/iOS Dictation can insert text into a focused field, it can safely coexist with the browser's continuous master audio capture. Treat microphone/audio-session coexistence as an empirical gate.

Preserve these invariants:
- the continuous recorded audio remains authoritative;
- no product/beta runtime change until the experiment proves coexistence;
- system dictation is user-mediated and must not be represented as a programmable Web API;
- no human-edited text may ever be overwritten by later STT;
- privacy/network boundaries must be explicit;
- prefer fail-fast isolated experiments over broad product rewrites.

Research official Android, Google/Gboard and Apple documentation, browser/Web Speech constraints, native speech APIs, and microphone-sharing/audio-session behavior. Compare at least: OS keyboard dictation, current Web Speech LIVE, independent backend transcription, native/hybrid platform speech APIs, and near-line post-turn transcription.

Then build the smallest isolated mobile experiment that answers the highest-value unresolved question: while a browser MediaRecorder keeps the master microphone recording active, can the user invoke the system keyboard microphone, receive dictated text in a focused field, and still retain uninterrupted audible master audio before/during/after the dictation interval?

Instrument track mute/end, recorder errors, audio levels, timing markers, dictated text, local playback and copyable JSON evidence. Do not upload audio. Define PASS_CANDIDATE / FAIL_FAST / INCONCLUSIVE before the test. Start with Android; if Android passes, reuse the same harness on iPhone as the next human gate. Stop at the smallest unavoidable human test.
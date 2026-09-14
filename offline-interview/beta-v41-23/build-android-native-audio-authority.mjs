import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(here, 'build-runtime.mjs')], { stdio: 'inherit' });

const appPath = path.join(here, 'app.js');
let source = fs.readFileSync(appPath, 'utf8');

const replaceExactly = (needle, replacement, expectedCount, label) => {
  const count = source.split(needle).length - 1;
  if (count !== expectedCount) throw new Error(`${label}: expected ${expectedCount} occurrence(s), got ${count}`);
  source = source.split(needle).join(replacement);
};

replaceExactly(
  "import { detectSystemSpeech, createSystemSpeechSession } from './transcription-engine.js';",
  "import { detectSystemSpeech, createSystemSpeechSession } from './transcription-engine.js';\nimport { hasNativeAudioCapture, createNativeAudioRecorder } from './native-audio-capture.js';",
  1,
  'native audio adapter import'
);

replaceExactly(
  "const BUILD_ID = '2026-09-13.interview-runtime-v41.23-android-host-native-draft1-candidate';",
  "const BUILD_ID = '2026-09-14.interview-runtime-v41.24-android-native-audio-authority1-candidate';",
  1,
  'native audio authority build identity'
);

const webRecorderBlock = `    await ensureMicrophoneStream();
    const mimeType = preferredMimeType();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunks = [];
    masterAudioChunks = [];
    recorder.ondataavailable = event => {
      if (!event.data?.size) return;
      chunks.push(event.data);
      masterAudioChunks.push(event.data);
    };
    recorder.onstop = handleRecordingStopped;
    recorder.start();
    recordingMasterStartedAt = performance.now();`;

const authorityRecorderBlock = `    chunks = [];
    masterAudioChunks = [];
    if (hasNativeAudioCapture()) {
      recorder = createNativeAudioRecorder({ sessionId: session?.id, captureId: recordingCaptureId });
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        chunks.push(event.data);
        masterAudioChunks.push(event.data);
      };
      recorder.onstop = handleRecordingStopped;
      recorder.onerror = error => {
        setAudioHealth('DEGRADED', 'native-audio-capture');
        diagnosticError = String(error?.message || error);
        showError(ui.interviewError, \`Capture audio Android impossible : \${error?.message || error}\`);
      };
      await recorder.start();
      recordingMasterStartedAt = performance.now();
      setAudioHealth('HEALTHY', 'android-audiorecord');
      logRuntimeEvent('native_audio_capture_started', { recordingId: recordingCaptureId, captureProviderId: 'ANDROID_AUDIORECORD_WAV_V1' });
    } else {
      await ensureMicrophoneStream();
      const mimeType = preferredMimeType();
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = event => {
        if (!event.data?.size) return;
        chunks.push(event.data);
        masterAudioChunks.push(event.data);
      };
      recorder.onstop = handleRecordingStopped;
      recorder.start();
      recordingMasterStartedAt = performance.now();
    }`;
replaceExactly(webRecorderBlock, authorityRecorderBlock, 1, 'replace Web microphone with native authority inside APK');

replaceExactly(
  "async function toggleMicrophonePreview() {\n  if (isRecording() || captureFinalizing) return;",
  "async function toggleMicrophonePreview() {\n  if (hasNativeAudioCapture()) { showError(ui.interviewError, 'Dans l’APK Android, le microphone est géré nativement pendant l’entretien.'); return; }\n  if (isRecording() || captureFinalizing) return;",
  1,
  'disable Web mic preview in Android host'
);

replaceExactly(
  "  } catch (error) {\n    diagnosticError = String(error?.message || error);\n    showError(ui.interviewError, `Accès au microphone impossible : ${error.message || error}`);",
  "  } catch (error) {\n    diagnosticError = String(error?.message || error);\n    setAudioHealth('DEGRADED', hasNativeAudioCapture() ? 'native-audio-start' : 'web-audio-start');\n    showError(ui.interviewError, `Accès au microphone impossible : ${error.message || error}`);",
  1,
  'audio start failure updates health'
);

source = source.split('ANDROID_SYSTEM_DEFAULT_V3_DRAFT').join('ANDROID_SYSTEM_DEFAULT_V3_DRAFT_PCM_BRIDGE');
fs.writeFileSync(appPath, source);

let shell = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
shell = shell.replace(
  'Dans l’APK Android, le brouillon utilise le moteur natif Android. L’audio de la session reste sous l’autorité du produit.',
  'Dans l’APK Android, Android enregistre seul le microphone dans un WAV maître puis alimente le brouillon de transcription. L’interface et la vérité finale restent sous l’autorité du produit.'
);
fs.writeFileSync(path.join(here, 'shell.html'), shell);

let sw = fs.readFileSync(path.join(here, 'sw.js'), 'utf8');
sw = sw.replace('offline-interview-v41.23-android-host-native-draft1', 'offline-interview-v41.24-android-native-audio-authority1');
sw = sw.replace("'./transcription-engine.js', './system-stt.js'", "'./transcription-engine.js', './native-host-bridge.js', './native-audio-capture.js', './system-stt.js'");
fs.writeFileSync(path.join(here, 'sw.js'), sw);

console.log(`V41.24 Android native-audio-authority runtime generated: ${appPath}`);

from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
app_path = root / "offline-interview" / "app.js"
styles_path = root / "offline-interview" / "styles.css"
sw_path = root / "offline-interview" / "sw.js"
report_path = root / "offline-interview" / "UX_DREAM_TEAM_OBSERVED_V27.md"
test_path = root / "offline-interview" / "test-interviews" / "interview-test-ux-v27.json"

app = app_path.read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, got {count}")
    return text.replace(old, new, 1)

app = replace_once(
    app,
    "const BUILD_ID = '2026-09-03.interview-runtime-v26';",
    "const BUILD_ID = '2026-09-03.interview-runtime-v27';",
    "build id",
)

app = replace_once(
    app,
    "let recordingCaptureId = null;\n",
    "let recordingCaptureId = null;\nlet recordingUsesBoundedAudio = false;\nlet boundedPendingCount = 0;\nlet boundedTranscriptionQueue = Promise.resolve();\n",
    "bounded globals",
)

start = app.index("async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {")
end = app.index("\nfunction captureQuestionEntry()", start)
new_rotate = r'''async function rotateLiveSegment(nextSpeakerId, nextQuestionId) {
  if (!isRecording() || !recordingSpeakerId || !recordingQuestionId) return false;
  if (!nextSpeakerId || !nextQuestionId) return false;
  if (nextSpeakerId === recordingSpeakerId && nextQuestionId === recordingQuestionId) return true;

  const previousSpeakerId = recordingSpeakerId;
  const previousQuestionId = recordingQuestionId;
  const durationSeconds = Math.max(0, (performance.now() - startedRecordingAt) / 1000);
  const systemSnapshot = systemSpeechSession?.takeSegment?.() || { text: '', finalText: '', mode: systemSpeechCapability.mode };

  let audioPromise;
  try {
    audioPromise = rotateAudioRecorderAtBoundary();
  } catch (error) {
    diagnosticError = `Frontière audio: ${error?.message || error}`;
    return false;
  }

  // From the first semantic boundary onward, browser SpeechRecognition remains useful
  // for the live preview only. Canonical speaker/question attribution comes from the
  // audio segment physically closed at the click boundary.
  recordingUsesBoundedAudio = true;
  enqueueBoundedAudioTurn({
    audioPromise,
    questionId: previousQuestionId,
    speakerId: previousSpeakerId,
    durationSeconds,
    fallbackSnapshot: systemSnapshot
  });

  recordingSpeakerId = nextSpeakerId;
  recordingQuestionId = nextQuestionId;
  session.activeSpeakerId = nextSpeakerId;
  session.updatedAt = nowIso();
  startedRecordingAt = performance.now();
  composerDurationSeconds = 0;
  ui.timer.textContent = '00:00';
  if (ui.liveTranscriptPreview) ui.liveTranscriptPreview.textContent = '';

  renderSpeakerButtons();
  renderQuestionNav();
  updateCaptureUi();
  await persistSession();
  return true;
}
'''
app = app[:start] + new_rotate + app[end:]

app = replace_once(
    app,
    "    const targetLabel = viewed?.question?.label || ('question ' + (viewedIndex + 1));\n    ui.moveCaptureBtn.textContent = 'Continuer sur ' + targetLabel + ' →';",
    "    const targetLabel = viewed?.question?.label || questionNavLabel(viewed?.question);\n    ui.moveCaptureBtn.textContent = 'Basculer sur la question ' + (viewedIndex + 1) + ' →';\n    ui.moveCaptureBtn.title = targetLabel\n      ? `Basculer l’enregistrement sur la question ${viewedIndex + 1} · ${targetLabel}`\n      : `Basculer l’enregistrement sur la question ${viewedIndex + 1}`;",
    "transfer wording",
)

app = replace_once(
    app,
    "  if (captureFinalizing || recordingCompletionPromise) {\n    if (recordingCompletionPromise) await recordingCompletionPromise;\n  }\n  return true;",
    "  if (captureFinalizing || recordingCompletionPromise) {\n    if (recordingCompletionPromise) await recordingCompletionPromise;\n  }\n  await boundedTranscriptionQueue;\n  return true;",
    "leave waits for bounded queue",
)

helpers_anchor = "function preferredMimeType() {\n  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';\n}\n"
helpers = r'''function preferredMimeType() {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}

function rotateAudioRecorderAtBoundary() {
  if (!recorder || recorder.state === 'inactive' || !stream) throw new Error('MediaRecorder inactif');

  const previousRecorder = recorder;
  const previousChunks = chunks;
  const previousType = previousRecorder.mimeType || preferredMimeType() || 'audio/webm';
  let settled = false;
  let resolveAudio;
  let rejectAudio;
  const audioPromise = new Promise((resolve, reject) => {
    resolveAudio = resolve;
    rejectAudio = reject;
  });

  // Detach the old recorder from global mutable chunk state before creating the next
  // recorder. Its last dataavailable event must stay with the previous speaker.
  previousRecorder.ondataavailable = event => {
    if (event.data?.size) previousChunks.push(event.data);
  };
  previousRecorder.onerror = event => {
    if (settled) return;
    settled = true;
    rejectAudio(event?.error || new Error('MediaRecorder boundary error'));
  };
  previousRecorder.onstop = () => {
    if (settled) return;
    settled = true;
    resolveAudio(new Blob(previousChunks, { type: previousType }));
  };

  // Start the next recorder on the already-open microphone before closing the previous
  // one. The overlap is only the synchronous handoff and avoids a warm-up hole.
  const mimeType = preferredMimeType();
  const nextRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const nextChunks = [];
  nextRecorder.ondataavailable = event => { if (event.data?.size) nextChunks.push(event.data); };
  nextRecorder.onstop = handleRecordingStopped;
  nextRecorder.start(500);
  recorder = nextRecorder;
  chunks = nextChunks;

  try { previousRecorder.requestData(); } catch {}
  try {
    previousRecorder.stop();
  } catch (error) {
    if (!settled) {
      settled = true;
      rejectAudio(error);
    }
  }
  return audioPromise;
}

async function transcribeBoundedAudio(blob) {
  if (!blob?.size) return '';
  if (!transcriber) await prepareModel();
  const samples = await blobTo16kMono(blob);
  const result = await transcriber(samples, {
    language: 'french',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5
  });
  return cleanText(result?.text);
}

function enqueueBoundedAudioTurn({ audioPromise, questionId, speakerId, durationSeconds, fallbackSnapshot }) {
  boundedPendingCount += 1;
  const task = async () => {
    try {
      const blob = await audioPromise;
      let text = '';
      let source = 'whisper-local-boundary';
      try {
        text = await transcribeBoundedAudio(blob);
      } catch (error) {
        diagnosticError = `Whisper frontière: ${error?.message || error}`;
        text = cleanText(fallbackSnapshot?.text || fallbackSnapshot?.finalText);
        source = fallbackSnapshot?.mode === 'local'
          ? 'system-local-boundary-fallback'
          : 'system-boundary-fallback';
      }
      if (!meaningfulTranscript(text)) {
        diagnosticError = diagnosticError || 'Frontière audio sans texte exploitable';
        return;
      }
      await appendAnswerTurn({
        questionId,
        speakerId,
        text,
        source,
        rawTranscript: text,
        durationSeconds
      });
    } catch (error) {
      diagnosticError = `Finalisation frontière: ${error?.message || error}`;
      showError(ui.interviewError, 'Une prise de parole bornée n’a pas pu être transcrite.');
    }
  };
  boundedTranscriptionQueue = boundedTranscriptionQueue.then(task, task).finally(() => {
    boundedPendingCount = Math.max(0, boundedPendingCount - 1);
  });
  return boundedTranscriptionQueue;
}
'''
app = replace_once(app, helpers_anchor, helpers, "audio boundary helpers")

app = replace_once(
    app,
    "    recordingCaptureId = uuid('capture');\n    recordingCompletionPromise = new Promise(resolve => { resolveRecordingCompletion = resolve; });",
    "    recordingCaptureId = uuid('capture');\n    recordingUsesBoundedAudio = false;\n    recordingCompletionPromise = new Promise(resolve => { resolveRecordingCompletion = resolve; });",
    "start bounded reset",
)

old_transcription = r'''    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const systemSnapshot = systemSpeechSession?.snapshot() || { text: '', finalText: '', mode: systemSpeechCapability.mode };
    let text = cleanText(systemSnapshot.text);
    let source = systemSnapshot.mode === 'local' ? 'system-local' : 'system';
    let rawTranscript = systemSnapshot.finalText || text;

    if (!text) {
      show(ui.transcribing, true);
      ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'
        ? 'Transcription Whisper locale…'
        : 'Aucun texte système · secours Whisper…';
      if (!transcriber) await prepareModel();
      const samples = await blobTo16kMono(blob);
      const result = await transcriber(samples, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
      text = cleanText(result?.text);
      source = 'whisper-local';
      rawTranscript = text;
    }
'''
new_transcription = r'''    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const systemSnapshot = systemSpeechSession?.snapshot() || { text: '', finalText: '', mode: systemSpeechCapability.mode };
    let text = '';
    let source = '';
    let rawTranscript = '';

    if (recordingUsesBoundedAudio) {
      // Preserve turn order: earlier click-bounded segments are canonicalized first.
      await boundedTranscriptionQueue;
      show(ui.transcribing, true);
      ui.recordState.textContent = 'Finalisation de la frontière audio…';
      try {
        text = await transcribeBoundedAudio(blob);
        source = 'whisper-local-boundary';
        rawTranscript = text;
      } catch (error) {
        diagnosticError = `Whisper frontière finale: ${error?.message || error}`;
        text = cleanText(systemSnapshot.text);
        source = systemSnapshot.mode === 'local'
          ? 'system-local-boundary-fallback'
          : 'system-boundary-fallback';
        rawTranscript = systemSnapshot.finalText || text;
      }
    } else {
      text = cleanText(systemSnapshot.text);
      source = systemSnapshot.mode === 'local' ? 'system-local' : 'system';
      rawTranscript = systemSnapshot.finalText || text;

      if (!text) {
        show(ui.transcribing, true);
        ui.recordState.textContent = systemSpeechCapability.mode === 'unavailable'
          ? 'Transcription Whisper locale…'
          : 'Aucun texte système · secours Whisper…';
        if (!transcriber) await prepareModel();
        const samples = await blobTo16kMono(blob);
        const result = await transcriber(samples, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
        text = cleanText(result?.text);
        source = 'whisper-local';
        rawTranscript = text;
      }
    }
'''
app = replace_once(app, old_transcription, new_transcription, "final bounded transcription")

app = replace_once(
    app,
    "    recorder = null;\n    captureFinalizing = false;",
    "    recorder = null;\n    recordingUsesBoundedAudio = false;\n    captureFinalizing = false;",
    "bounded cleanup",
)

app = replace_once(app, "navigator.serviceWorker.register('./sw.js?v=23'", "navigator.serviceWorker.register('./sw.js?v=27'", "service worker url")
app = replace_once(app, "reg.active ? 'actif · v23' : 'installé · v23'", "reg.active ? 'actif · v27' : 'installé · v27'", "service worker diagnostic")

app_path.write_text(app, encoding="utf-8")

styles = styles_path.read_text(encoding="utf-8")
v27_styles = r'''

/* Observed UX v27 — microphone visible, compact, and subordinate to ON AIR */
.recording-mic{
  display:grid!important;
  place-items:center!important;
  width:38px!important;
  height:38px!important;
  min-width:38px!important;
  min-height:38px!important;
  padding:0!important;
  border:1px solid #dbe3ef!important;
  border-radius:10px!important;
  background:#f8fafc!important;
  box-shadow:none!important;
  font-size:1.15rem!important;
  line-height:1!important;
  animation:none!important;
}
.capture-dock.is-recording .recording-mic{
  background:#fff!important;
  border-color:#e7aaa4!important;
  box-shadow:none!important;
  animation:none!important;
}
.capture-dock.is-finalizing .recording-mic{
  background:#fff8e6!important;
  border-color:#ead79e!important;
  box-shadow:none!important;
  animation:none!important;
}
@media(max-width:759px){
  .recording-mic{width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;font-size:1.1rem!important}
}
'''
if "Observed UX v27 — microphone visible" not in styles:
    styles += v27_styles
styles_path.write_text(styles, encoding="utf-8")

sw = sw_path.read_text(encoding="utf-8")
sw = replace_once(sw, "const VERSION = 'offline-interview-v26';", "const VERSION = 'offline-interview-v27';", "sw version")
sw = replace_once(sw, "'./', './index.html', './styles.css', './app.js?v=26', './system-stt.js',", "'./', './index.html', './styles.css', './app.js?v=27', './system-stt.js',", "sw app cache")
sw_path.write_text(sw, encoding="utf-8")

report = """# UX Dream Team — Observed Interview Round v27

Date: 2026-09-03  
Input evidence: completed V26 field interview, 8/8 questions answered, 883 active seconds.

## What V26 proved

V26 fixed the V25 cumulative SpeechRecognition-prefix failure, but the field test exposed a different boundary defect.

- browser result history is no longer copied wholesale;
- speaker changes can still receive the last words acoustically spoken before the click because SpeechRecognition results arrive late;
- the long live transcript remains usable;
- the V26 microphone treatment became too visually weak and was reported as effectively absent;
- the explicit question-transfer action is conceptually right, but its dynamic label can read like “Continuer sur transcription live”, which is ambiguous under pressure.

## Root cause arbitration

### Conversational Capture / Reliability

`SpeechRecognition.resultIndex` is an index in browser recognition history, not an acoustic timestamp. A late result can therefore be delivered after the UI speaker switch even though the audio was spoken before the switch.

Hard decision for V27:

- do not add an arbitrary debounce or 200/300/500 ms timing heuristic;
- do not return to stop/restart SpeechRecognition on every speaker switch, which previously lost first words;
- create the semantic boundary in the audio stream itself.

### Steve — Product / UX

Keep the V25/V26 product model unchanged:

- browsing questions never moves recording ownership implicitly;
- transfer remains explicit;
- ON AIR remains the dominant recording cue;
- no broad layout redesign.

Accepted visual/copy corrections only:

- restore a compact visible microphone without a breathing halo;
- label the transfer action by question number: `Basculer sur la question N →`.

## V27 implementation

1. **Audio-bounded speaker/question transitions**
   - the microphone stream stays open;
   - a new `MediaRecorder` starts on the same stream at the click boundary while the previous recorder is closed;
   - the previous audio segment is kept only in memory;
   - click-bounded segments are canonicalized with local Whisper;
   - browser SpeechRecognition remains active for the live preview;
   - if local Whisper cannot run, the bounded system transcript is retained only as a degraded fallback and the diagnostic records the failure;
   - audio is never persisted or exported.

2. **Ordering / exit safety**
   - bounded transcriptions are serialized;
   - leaving or completing the interview waits for pending bounded segments;
   - the final segment after any boundary is also canonicalized from its bounded audio.

3. **Transfer wording**
   - `Continuer sur <label>` is replaced with `Basculer sur la question N →`;
   - the detailed question label remains available as the control title.

4. **Microphone cue**
   - compact static microphone container restored;
   - no breathing circle;
   - ON AIR badge remains the animated primary signal.

## V27 hard gates

- unique-word speaker groups: no word spoken before the click may move to the next speaker solely because browser STT arrived late;
- numeric 1→20 test: distinguish recognition errors from attribution errors;
- natural conversation: no visible systematic one-fragment speaker lag;
- explicit question transfer: pre-click audio remains on the former owner; post-click audio belongs to the new owner;
- transfer control reads `Basculer sur la question N →`;
- microphone visible without large halo; ON AIR obvious;
- long live transcript remains stable.

V27 is not declared `CAPTURE RELIABILITY PASS` until the associated field test passes.
"""
report_path.write_text(report, encoding="utf-8")

test = {
  "schema": "offline-interview.interview-spec.v1",
  "id": "test-ux-v27-audio-bounded-speaker-transitions",
  "version": "1.0",
  "title": "Test UX V27 — frontières audio et transfert explicite",
  "context": "Ce questionnaire valide la V27 après le test terrain V26. Il cible exclusivement la frontière temporelle entre locuteurs/questions, la visibilité du micro et le libellé du transfert explicite. Le modèle produit de question propriétaire reste inchangé.",
  "objective": "Vérifier que le clic de changement crée une frontière audio fiable sans décaler les derniers mots vers le locuteur suivant, tout en conservant la navigation libre, le transcript live et un ON AIR clair.",
  "language": "fr-FR",
  "tags": ["ux", "v27", "audio-boundary", "speaker-attribution", "explicit-transfer", "on-air"],
  "estimatedDurationMinutes": 13,
  "participants": [
    {"id": "P1", "name": "Interviewer", "role": "interviewer"},
    {"id": "P2", "name": "Testeur", "role": "interviewee"},
    {"id": "P3", "name": "Second participant", "role": "interviewee"}
  ],
  "sections": [
    {
      "id": "S1", "title": "Frontières de locuteurs", "questions": [
        {
          "id": "Q1", "label": "Mots uniques au clic",
          "text": "Alternez quatre fois sans pause. Testeur dit exactement « alpha bravo charlie delta echo ». Cliquez ensuite sur Second participant AVANT qu’il commence, puis il dit « foxtrot golf hotel india juliet ». Cliquez sur Testeur AVANT qu’il commence, puis il dit « kilo lima mike novembre oscar ». Cliquez sur Second participant AVANT qu’il commence, puis il dit « papa quebec romeo sierra tango ». Vérifiez que chaque groupe reste intégralement chez son locuteur.",
          "intent": "Valider que l’attribution canonique suit la frontière audio au clic et non le retard d’arrivée de SpeechRecognition.",
          "required": True, "estimatedMinutes": 3, "audience": ["P2", "P3"],
          "followUps": [{"id": "Q1-R1", "text": "Un mot prononcé avant un clic apparaît-il encore chez le locuteur sélectionné après ce clic ?", "kind": "planned"}]
        },
        {
          "id": "Q2", "label": "Décompte 1 à 20",
          "text": "Comptez sans pause : Testeur 1 à 5 ; cliquez sur Second participant puis il dit 6 à 10 ; cliquez sur Testeur puis il dit 11 à 15 ; cliquez sur Second participant puis il dit 16 à 20. Notez séparément les nombres mal reconnus et les nombres attribués au mauvais locuteur.",
          "intent": "Distinguer qualité STT et exactitude de la frontière de locuteur.",
          "required": True, "estimatedMinutes": 2, "audience": ["P2", "P3"],
          "followUps": [{"id": "Q2-R1", "text": "Quels nombres sont mal reconnus, et lesquels sont réellement attribués au mauvais locuteur ?", "kind": "planned"}]
        },
        {
          "id": "Q3", "label": "Conversation naturelle",
          "text": "Faites quatre changements de locuteur dans une conversation normale. Chaque nouveau locuteur commence seulement après son clic. Les débuts et fins de phrases appartiennent-ils maintenant à la bonne personne sans décalage systématique ?",
          "intent": "Valider la frontière dans un usage naturel après les tests artificiels.",
          "required": True, "estimatedMinutes": 2, "audience": ["P1", "P2", "P3"], "followUps": []
        }
      ]
    },
    {
      "id": "S2", "title": "Question propriétaire", "questions": [
        {
          "id": "Q4", "label": "Navigation sans transfert",
          "text": "Commencez une réponse ici, puis consultez Q5 et Q6 sans arrêter de parler. Vérifiez que cette question reste propriétaire de l’enregistrement et qu’aucun transfert silencieux ne se produit.",
          "intent": "Revalider le modèle produit stabilisé.",
          "required": True, "estimatedMinutes": 1, "audience": ["P2"], "followUps": []
        },
        {
          "id": "Q5", "label": "Basculer par numéro",
          "text": "Pendant que Q4 reste ON AIR, affichez cette question. Vérifiez que l’action dans la barre de capture dit « Basculer sur la question 5 → ». Dites une courte phrase AVANT le clic, cliquez, puis dites une autre phrase APRÈS le clic. La première doit rester sur Q4 et la seconde arriver ici.",
          "intent": "Valider à la fois la copie UX et la frontière audio du transfert entre questions.",
          "required": True, "estimatedMinutes": 2, "audience": ["P2"], "followUps": []
        }
      ]
    },
    {
      "id": "S3", "title": "État visuel et continuité", "questions": [
        {
          "id": "Q6", "label": "Micro et ON AIR",
          "text": "Pendant l’enregistrement, le microphone est-il clairement visible sans grand cercle respirant, tout en laissant le badge ON AIR être le signal principal ?",
          "intent": "Valider la correction visuelle bornée de V27.",
          "required": True, "estimatedMinutes": 1, "audience": ["P2"], "followUps": []
        },
        {
          "id": "Q7", "label": "Transcript live long",
          "text": "Parlez au moins trente secondes. Vérifiez que le transcript live reste lisible et que les commandes de locuteur ne bougent pas, y compris après au moins un changement de locuteur.",
          "intent": "Détecter une régression du live STT pendant que l’audio borné sert de canon aux transitions.",
          "required": True, "estimatedMinutes": 1, "audience": ["P2", "P3"], "followUps": []
        }
      ]
    },
    {
      "id": "S4", "title": "Verdict", "questions": [
        {
          "id": "Q8", "label": "Fiabilité de capture",
          "text": "Après ces tests, voyez-vous encore un cas où une phrase complète est reconnue mais attribuée au mauvais locuteur ou à la mauvaise question à cause du moment du clic ?",
          "intent": "Décider si V27 peut recevoir CAPTURE RELIABILITY PASS ou doit rester HOLD.",
          "required": True, "estimatedMinutes": 1, "audience": ["P2"], "followUps": []
        }
      ]
    }
  ]
}
test_path.parent.mkdir(parents=True, exist_ok=True)
test_path.write_text(json.dumps(test, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("V27 patch applied")

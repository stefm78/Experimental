from pathlib import Path
p=Path('offline-interview/app.js'); s=p.read_text()
t=Path('offline-interview/test-runtime-contract.mjs'); test=t.read_text()

def once(text, old, new, label):
    if old not in text: raise SystemExit(f'missing {label}')
    if text.count(old)!=1: raise SystemExit(f'non-unique {label}: {text.count(old)}')
    return text.replace(old,new,1)

# Keep one complete, seekable recording blob even when live STT rotates semantic segments.
s=once(s, 'let chunks = [];\nlet startedRecordingAt = 0;', 'let chunks = [];\nlet masterAudioChunks = [];\nlet startedRecordingAt = 0;', 'master chunks global')
s=once(s,
"""    chunks = [];
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };""",
"""    chunks = [];
    masterAudioChunks = [];
    recorder.ondataavailable = event => {
      if (!event.data?.size) return;
      chunks.push(event.data);
      masterAudioChunks.push(event.data);
    };""", 'dual recorder buffers')

# Capture recording id at the semantic boundary and advance the offset only after a real cut exists.
s=once(s,
"""  const segmentStartMs = recordingAudioOffsetMs;
  const segmentEndMs = segmentStartMs + durationSeconds * 1000;
  recordingAudioOffsetMs = segmentEndMs;
  const cut = systemSpeechSession.cutSegment();
  if (!cut) return false;
  recordingHadCuts = true;""",
"""  const recordingId = recordingCaptureId;
  const segmentStartMs = recordingAudioOffsetMs;
  const segmentEndMs = segmentStartMs + durationSeconds * 1000;
  const cut = systemSpeechSession.cutSegment();
  if (!cut) return false;
  recordingAudioOffsetMs = segmentEndMs;
  recordingHadCuts = true;""", 'safe segment offset')
s=once(s,
"audioRef: { recordingId: recordingCaptureId, startMs: segmentStartMs, endMs: segmentEndMs }",
"audioRef: { recordingId, startMs: segmentStartMs, endMs: segmentEndMs }",
'captured recording id')

# Persist the valid whole capture, while keeping the post-cut chunk set only for the existing fallback path.
s=once(s,
"""    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    await dbAudioPut({ id: captureId, sessionId: session.id, blob, mimeType: blob.type || 'audio/webm', createdAt: nowIso() });""",
"""    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    const masterBlob = new Blob(masterAudioChunks, { type: recorder.mimeType || 'audio/webm' });
    await dbAudioPut({ id: captureId, sessionId: session.id, blob: masterBlob, mimeType: masterBlob.type || 'audio/webm', createdAt: nowIso() });""", 'whole capture persistence')
s=once(s,
"""  } finally {
    chunks = [];
    show(ui.transcribing, false);""",
"""  } finally {
    chunks = [];
    masterAudioChunks = [];
    show(ui.transcribing, false);""", 'clear master chunks')

# Avoid orphaned local audio when the whole session is erased.
s=once(s,
"""  await dbDelete(STATE_KEY);
  session = null;""",
"""  if (session?.id) await dbAudioDeleteSession(session.id);
  await dbDelete(STATE_KEY);
  session = null;""", 'reset audio cleanup')

# Strengthen the canonical contract around the exact failure mode found by audit.
test=once(test,
"assert.match(app, /await dbAudioPut\\(\\{ id: captureId, sessionId: session\\.id, blob/);",
"assert.match(app, /masterAudioChunks = \\[\\]/);\nassert.match(app, /masterAudioChunks\\.push\\(event\\.data\\)/);\nassert.match(app, /blob: masterBlob/);\nassert.match(app, /const recordingId = recordingCaptureId/);",
'master audio contract')
test=once(test,
"assert.match(app, /audioRef: \\{ recordingId: recordingCaptureId, startMs: segmentStartMs, endMs: segmentEndMs \\}/);",
"assert.match(app, /audioRef: \\{ recordingId, startMs: segmentStartMs, endMs: segmentEndMs \\}/);",
'captured audio ref contract')
p.write_text(s); t.write_text(test)
print('V41 audio ownership repair applied')

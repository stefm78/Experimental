from pathlib import Path
p=Path('offline-interview/_v41_patch.py')
s=p.read_text()
start=s.index("# Final answer append in handleRecordingStopped")
end=s.index("# Release analyser and microphone", start)
replacement='''# Final answer append in handleRecordingStopped.\napp=once(app,\n"""        rawTranscript,\n        durationSeconds\n      });""",\n"""        rawTranscript,\n        durationSeconds,\n        audioRef: { recordingId: captureId, startMs: recordingAudioOffsetMs, endMs: recordingAudioOffsetMs + Math.max(0, durationSeconds || 0) * 1000 }\n      });""", 'final answer audio ref')\n\n'''
p.write_text(s[:start]+replacement+s[end:])
print('helper repaired')

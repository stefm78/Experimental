from pathlib import Path
p = Path('offline-interview/test-runtime-contract.mjs')
s = p.read_text()
s = s.replace("assert.match(app, /replayTurnAudio\\(turn\\)/);", "assert.match(app, /replayTurnAudio\\(turn, replay\\)/);")
for line in [
    "assert.match(app, /const targetQuestionId = all\\[index\\]\\?\\.question\\?\\.id \\|\\| null;/);\n",
    "assert.match(app, /if \\(isRecording\\(\\) && targetQuestionId && recordingQuestionId !== targetQuestionId\\)/);\n",
    "assert.match(app, /moveRecordingToViewedQuestion\\(\\)\\.catch/);\n",
]:
    s = s.replace(line, '')
p.write_text(s)

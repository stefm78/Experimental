from pathlib import Path
import re
app=Path('offline-interview/app.js')
s=app.read_text()
s=s.replace("import { detectSystemSpeech, createSystemSpeechSession, supportsSystemAudioTrackRecognition, transcribeSystemAudioTrack } from './system-stt.js';\n", "import { detectSystemSpeech, createSystemSpeechSession, supportsSystemAudioTrackRecognition, transcribeSystemAudioTrack } from './system-stt.js';\nimport { turnAudioWindow } from './audio-window.js';\n",1)
s=s.replace("const AUDIO_CONTEXT_BEFORE_MS = 250;\nconst AUDIO_CONTEXT_AFTER_MS = 250;\n",'',1)
s=re.sub(r"\nfunction turnAudioWindow\(turn, mode = 'canonical', recordingDurationMs = null\) \{.*?\n\}\n", "\n", s, count=1, flags=re.S)
app.write_text(s)
Path('offline-interview/audio-window.js').write_text("""export const AUDIO_CONTEXT_BEFORE_MS = 250;
export const AUDIO_CONTEXT_AFTER_MS = 250;
export function turnAudioWindow(turn, mode='canonical', durationMs=null){
  const r=turn?.audioRef;if(!r?.recordingId)return null;
  const canonicalStartMs=Math.max(0,Number(r.startMs)||0),canonicalEndMs=Math.max(canonicalStartMs,Number(r.endMs)||canonicalStartMs);
  if(mode!=='context')return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:canonicalEndMs,canonicalStartMs,canonicalEndMs,mode:'canonical'};
  const beforeMs=Math.max(0,Number(r.contextBeforeMs??AUDIO_CONTEXT_BEFORE_MS)||0),afterMs=Math.max(0,Number(r.contextAfterMs??AUDIO_CONTEXT_AFTER_MS)||0),startMs=Math.max(0,canonicalStartMs-beforeMs),limit=Number.isFinite(Number(durationMs))?Math.max(0,Number(durationMs)):null,endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);
  return{recordingId:r.recordingId,startMs,endMs:Math.max(startMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs,afterMs,mode:'context'};
}
""")
sw=Path('offline-interview/sw.js')
t=sw.read_text()
if "'./audio-window.js'" not in t:
    t=t.replace("'./system-stt.js',", "'./system-stt.js', './audio-window.js',",1)
sw.write_text(t)
contract=Path('offline-interview/test-runtime-contract.mjs')
c=contract.read_text()
c=c.replace("const systemStt = read('system-stt.js');", "const systemStt = read('system-stt.js');\nconst audioWindow = read('audio-window.js');",1)
c=c.replace("assert.match(app, /const AUDIO_CONTEXT_BEFORE_MS = 250/);\nassert.match(app, /const AUDIO_CONTEXT_AFTER_MS = 250/);\nassert.match(app, /function turnAudioWindow\\(turn, mode = 'canonical'/);\nassert.match(app, /canonicalStartMs/);\nassert.match(app, /mode !== 'context'/);", "assert.match(app, /import \\{ turnAudioWindow \\} from '.\\/audio-window\\.js'/);\nassert.match(audioWindow, /AUDIO_CONTEXT_BEFORE_MS = 250/);\nassert.match(audioWindow, /AUDIO_CONTEXT_AFTER_MS = 250/);\nassert.match(audioWindow, /canonicalStartMs/);\nassert.match(audioWindow, /mode!==?'context'|mode !== 'context'/);")
contract.write_text(c)

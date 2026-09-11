export const AUDIO_CONTEXT_BEFORE_MS = 250;
export const AUDIO_CONTEXT_AFTER_MS = 250;
export function turnAudioWindow(turn, mode='canonical', durationMs=null){
  const r=turn?.audioRef;if(!r?.recordingId)return null;
  const canonicalStartMs=Math.max(0,Number(r.startMs)||0),canonicalEndMs=Math.max(canonicalStartMs,Number(r.endMs)||canonicalStartMs);
  if(mode!=='context')return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:canonicalEndMs,canonicalStartMs,canonicalEndMs,mode:'canonical'};
  const beforeMs=Math.max(0,Number(r.contextBeforeMs??AUDIO_CONTEXT_BEFORE_MS)||0),afterMs=Math.max(0,Number(r.contextAfterMs??AUDIO_CONTEXT_AFTER_MS)||0),startMs=Math.max(0,canonicalStartMs-beforeMs),limit=Number.isFinite(Number(durationMs))?Math.max(0,Number(durationMs)):null,endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);
  return{recordingId:r.recordingId,startMs,endMs:Math.max(startMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs,afterMs,mode:'context'};
}

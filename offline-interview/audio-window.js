export const AUDIO_CONTEXT_BEFORE_MS = 250;
export const AUDIO_CONTEXT_AFTER_MS = 250;
export const AUDIO_RECOVERY_AFTER_MS = 250;
export function turnAudioWindow(turn, mode='canonical', durationMs=null){
  const r=turn?.audioRef;if(!r?.recordingId)return null;
  const canonicalStartMs=Math.max(0,Number(r.startMs)||0),canonicalEndMs=Math.max(canonicalStartMs,Number(r.endMs)||canonicalStartMs);
  const limit=Number.isFinite(Number(durationMs))?Math.max(0,Number(durationMs)):null;
  if(mode==='canonical')return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:canonicalEndMs,canonicalStartMs,canonicalEndMs,mode:'canonical'};
  if(mode==='recovery'){const afterMs=Math.max(0,Number(r.recoveryAfterMs??AUDIO_RECOVERY_AFTER_MS)||0),endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);return{recordingId:r.recordingId,startMs:canonicalStartMs,endMs:Math.max(canonicalStartMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs:0,afterMs,mode:'recovery'};}
  const beforeMs=Math.max(0,Number(r.contextBeforeMs??AUDIO_CONTEXT_BEFORE_MS)||0),afterMs=Math.max(0,Number(r.contextAfterMs??AUDIO_CONTEXT_AFTER_MS)||0),startMs=Math.max(0,canonicalStartMs-beforeMs),endMs=limit==null?canonicalEndMs+afterMs:Math.min(limit,canonicalEndMs+afterMs);
  return{recordingId:r.recordingId,startMs,endMs:Math.max(startMs,endMs),canonicalStartMs,canonicalEndMs,beforeMs,afterMs,mode:'context'};
}

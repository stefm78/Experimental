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


export function sliceAudioBuffer(context, decoded, startMs, endMs){
  if(!context||!decoded)throw new Error('Buffer audio invalide.');
  const rate=Number(decoded.sampleRate)||0;if(!rate)throw new Error('Fréquence audio invalide.');
  const maxFrames=Number(decoded.length)||Math.round((Number(decoded.duration)||0)*rate);
  const startFrame=Math.max(0,Math.min(maxFrames,Math.floor((Math.max(0,Number(startMs)||0)/1000)*rate)));
  const requestedEnd=Math.max(Number(startMs)||0,Number(endMs)||0);
  const endFrame=Math.max(startFrame+1,Math.min(maxFrames,Math.ceil((requestedEnd/1000)*rate)));
  const length=Math.max(1,endFrame-startFrame);
  const segment=context.createBuffer(decoded.numberOfChannels,length,rate);
  for(let channel=0;channel<decoded.numberOfChannels;channel+=1){
    segment.copyToChannel(decoded.getChannelData(channel).subarray(startFrame,endFrame),channel);
  }
  return segment;
}

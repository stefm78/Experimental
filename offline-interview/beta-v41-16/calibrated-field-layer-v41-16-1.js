import {
  detectSystemSpeech,
  supportsSystemAudioTrackRecognition,
  transcribeSystemAudioTrack
} from '../beta/system-stt.js';

const LAYER_BUILD='2026-09-08.interview-runtime-v41.16.1-calibrated-system';
const DB_NAME='offline-interview',DB_VERSION=2,STATE_KEY='current-session',SPEC_KEY='last-interview-spec';
const MAX_SHIFT_MS=420,FRAME_MS=20,HOP_MS=10,MIN_CONFIDENCE=0.34;
const iframe=document.getElementById('app'),statusBox=document.getElementById('status');
let replay=null,busy=false;

function setStatus(message,state=''){if(statusBox){const next=`V41.16.1 · ${message}`;if(statusBox.textContent!==next)statusBox.textContent=next;if(statusBox.dataset.state!==state)statusBox.dataset.state=state;}}
const nowIso=()=>new Date().toISOString();
const cleanText=v=>String(v??'').trim();
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function median(values){if(!values.length)return 0;const s=[...values].sort((a,b)=>a-b),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function flattenQuestions(spec){return(spec?.sections||[]).flatMap(section=>(section.questions||[]).map(question=>({section,question})));}
function req(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function kvGet(key){const db=await openDb();try{return await req(db.transaction('kv','readonly').objectStore('kv').get(key));}finally{db.close();}}
async function kvPut(key,value){const db=await openDb();try{await req(db.transaction('kv','readwrite').objectStore('kv').put(value,key));}finally{db.close();}}
async function audioGet(id){const db=await openDb();try{return await req(db.transaction('audio','readonly').objectStore('audio').get(id));}finally{db.close();}}

async function currentContext(doc,card){
  const[session,spec]=await Promise.all([kvGet(STATE_KEY),kvGet(SPEC_KEY)]);
  if(!session||!spec)throw new Error('Session ou questionnaire local introuvable.');
  const entry=flattenQuestions(spec)[session.currentIndex??0],questionId=entry?.question?.id;
  if(!questionId)throw new Error('Question courante introuvable.');
  const turns=session.responses?.[questionId]?.turns||[],cards=[...doc.querySelectorAll('#turnsList .turn-card')],index=cards.indexOf(card),turn=turns[index];
  if(index<0||!turn)throw new Error('Impossible d’associer cette carte à la prise de parole.');
  return{session,spec,questionId,turn,index};
}

async function decodeRecording(turn){
  const ref=turn?.audioRef;if(!ref?.recordingId)throw new Error('Référence audio absente.');
  const record=await audioGet(ref.recordingId);if(!record?.blob)throw new Error('Audio local introuvable.');
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Web Audio indisponible.');
  const context=new Context();await context.resume();
  try{const decoded=await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));return{context,decoded,record};}
  catch(error){await context.close().catch(()=>{});throw error;}
}

function rmsEnvelope(buffer,centerMs){
  const sr=buffer.sampleRate,totalMs=buffer.duration*1000,fromMs=clamp(centerMs-MAX_SHIFT_MS,0,totalMs),toMs=clamp(centerMs+MAX_SHIFT_MS,0,totalMs);
  const frameSamples=Math.max(16,Math.round(sr*FRAME_MS/1000)),hopSamples=Math.max(8,Math.round(sr*HOP_MS/1000));
  const from=Math.round(fromMs*sr/1000),to=Math.round(toMs*sr/1000),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),frames=[];
  for(let start=from;start+frameSamples<=to;start+=hopSamples){let sum=0,count=0;for(const data of channels){for(let i=start;i<start+frameSamples;i++){const s=data[i]||0;sum+=s*s;count++;}}frames.push({ms:(start+frameSamples/2)*1000/sr,rms:Math.sqrt(sum/Math.max(1,count))});}
  if(frames.length<5)return[];
  return frames.map((f,i)=>{const around=frames.slice(Math.max(0,i-1),Math.min(frames.length,i+2));return{...f,smooth:around.reduce((s,x)=>s+x.rms,0)/around.length};});
}
function calibrateBoundary(buffer,canonicalMs){
  if(!(canonicalMs>0)||canonicalMs>=buffer.duration*1000-1)return{canonicalMs,calibratedMs:canonicalMs,deltaMs:0,confidence:1,applied:false,reason:'edge'};
  const frames=rmsEnvelope(buffer,canonicalMs);if(!frames.length)return{canonicalMs,calibratedMs:canonicalMs,deltaMs:0,confidence:0,applied:false,reason:'no-envelope'};
  const baseline=median(frames.map(f=>f.smooth)),min=Math.min(...frames.map(f=>f.smooth)),floor=Math.max(1e-7,baseline),valleyDepth=clamp(1-(min/floor),0,1);
  const best=frames.map(f=>({...f,score:(f.smooth/floor)+(Math.abs(f.ms-canonicalMs)/MAX_SHIFT_MS)*0.32})).sort((a,b)=>a.score-b.score)[0];
  const delta=best.ms-canonicalMs,local=frames.filter(f=>Math.abs(f.ms-best.ms)<=60),localMean=local.reduce((s,f)=>s+f.smooth,0)/Math.max(1,local.length),silenceContrast=clamp(1-(localMean/floor),0,1),confidence=clamp(valleyDepth*0.65+silenceContrast*0.35,0,1),applied=confidence>=MIN_CONFIDENCE&&Math.abs(delta)<=MAX_SHIFT_MS;
  return{canonicalMs:Math.round(canonicalMs),calibratedMs:Math.round(applied?best.ms:canonicalMs),deltaMs:Math.round(applied?delta:0),confidence:Number(confidence.toFixed(3)),applied,reason:applied?'energy-valley':'low-confidence'};
}
function calibratedWindow(buffer,turn){
  const ref=turn.audioRef,startRaw=clamp(Number(ref.startMs)||0,0,buffer.duration*1000),endRaw=clamp(Number(ref.endMs)||startRaw,startRaw,buffer.duration*1000);
  const start=startRaw>0?calibrateBoundary(buffer,startRaw):{canonicalMs:0,calibratedMs:0,deltaMs:0,confidence:1,applied:false,reason:'edge'};
  const end=endRaw<buffer.duration*1000-5?calibrateBoundary(buffer,endRaw):{canonicalMs:Math.round(endRaw),calibratedMs:Math.round(endRaw),deltaMs:0,confidence:1,applied:false,reason:'edge'};
  let startMs=start.calibratedMs,endMs=end.calibratedMs;if(endMs<=startMs+80){startMs=startRaw;endMs=endRaw;start.applied=false;end.applied=false;}
  return{recordingId:ref.recordingId,startMs,endMs,start,end,durationMs:Math.max(80,endMs-startMs)};
}
async function persistCalibration(session,turn,win,kind){
  session.runtimeEvents=Array.isArray(session.runtimeEvents)?session.runtimeEvents:[];
  session.runtimeEvents.push({at:nowIso(),type:'audio_boundary_calibrated_v41_16',kind,turnId:turn.id,recordingId:win.recordingId,canonicalStartMs:win.start.canonicalMs,calibratedStartMs:win.startMs,startDeltaMs:win.start.deltaMs,startConfidence:win.start.confidence,canonicalEndMs:win.end.canonicalMs,calibratedEndMs:win.endMs,endDeltaMs:win.end.deltaMs,endConfidence:win.end.confidence});
  session.runtimeEvents=session.runtimeEvents.slice(-160);await kvPut(STATE_KEY,session);
}

function stopReplay(){if(!replay)return;try{replay.source.stop();}catch{}replay.context.close().catch(()=>{});replay=null;}
async function replayCalibrated(doc,card,button){
  stopReplay();const{session,turn}=await currentContext(doc,card),{context,decoded}=await decodeRecording(turn),win=calibratedWindow(decoded,turn);await persistCalibration(session,turn,win,'replay');
  const source=context.createBufferSource();source.buffer=decoded;source.connect(context.destination);source.onended=()=>{if(replay?.source===source){replay=null;context.close().catch(()=>{});button.textContent='▶';}};replay={source,context};button.textContent='■';source.start(0,win.startMs/1000,win.durationMs/1000);
  setStatus(`replay calibré ${win.start.deltaMs>=0?'+':''}${win.start.deltaMs} ms / ${win.end.deltaMs>=0?'+':''}${win.end.deltaMs} ms`,win.start.applied||win.end.applied?'ok':'warn');
}
function isolatedTrack(context,decoded,win){
  const sr=decoded.sampleRate,startFrame=Math.floor(win.startMs*sr/1000),endFrame=Math.min(decoded.length,Math.ceil(win.endMs*sr/1000)),length=Math.max(1,endFrame-startFrame),isolated=context.createBuffer(decoded.numberOfChannels,length,sr);
  for(let c=0;c<decoded.numberOfChannels;c++)isolated.copyToChannel(decoded.getChannelData(c).subarray(startFrame,endFrame),c);
  const destination=context.createMediaStreamDestination(),source=context.createBufferSource();source.buffer=isolated;source.connect(destination);const track=destination.stream.getAudioTracks()[0];if('contentHint'in track)track.contentHint='speech-recognition';return{source,track,durationMs:Math.ceil(isolated.duration*1000)};
}
function fallbackToWhisper(button){const ok=window.confirm('La retranscription système est indisponible ou a échoué. Utiliser Whisper local comme secours explicite ?');if(!ok)return;button.dataset.v4116Bypass='1';button.click();}
async function retranscribeSystem(doc,card,button){
  const capability=await detectSystemSpeech('fr-FR');if(!supportsSystemAudioTrackRecognition()||capability.mode==='unavailable'){setStatus('retranscription système indisponible sur ce navigateur','warn');fallbackToWhisper(button);return;}
  const{session,turn}=await currentContext(doc,card),{context,decoded}=await decodeRecording(turn),win=calibratedWindow(decoded,turn);await persistCalibration(session,turn,win,'system-retranscription');const{source,track,durationMs}=isolatedTrack(context,decoded,win);button.disabled=true;button.setAttribute('aria-busy','true');setStatus('retranscription système en cours…');
  try{const result=await transcribeSystemAudioTrack(track,{lang:'fr-FR',mode:capability.mode,durationMs,onStart:()=>source.start()}),text=cleanText(result?.text);if(!text)throw new Error('Le moteur système n’a renvoyé aucun texte.');const textarea=card.querySelector('textarea.turn-text');if(textarea){textarea.value=text;textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.dispatchEvent(new Event('change',{bubbles:true}));}const fresh=await kvGet(STATE_KEY);if(fresh){fresh.runtimeEvents=Array.isArray(fresh.runtimeEvents)?fresh.runtimeEvents:[];fresh.runtimeEvents.push({at:nowIso(),type:'manual_system_retranscription_v41_16_succeeded',turnId:turn.id,recordingId:win.recordingId,textLength:text.length,mode:capability.mode,calibratedStartMs:win.startMs,calibratedEndMs:win.endMs});fresh.runtimeEvents=fresh.runtimeEvents.slice(-160);await kvPut(STATE_KEY,fresh);}setStatus(`moteur système OK · ${text.length} caractères`,'ok');}
  catch(error){setStatus(`échec moteur système : ${error.message||error}`,'warn');fallbackToWhisper(button);}
  finally{try{source.stop();}catch{}try{track.stop();}catch{}await context.close().catch(()=>{});button.disabled=false;button.removeAttribute('aria-busy');}
}
function isReplayButton(button){const title=button.getAttribute('title')||'',aria=button.getAttribute('aria-label')||'';return title.startsWith('Réécouter cette prise')||title.startsWith('Arrêter cette prise')||aria.startsWith('Réécouter cette prise');}
function isRetranscribeButton(button){const title=button.getAttribute('title')||'';return /Retranscrire cet audio|Transcription rejetée|Réessayer la retranscription/i.test(title);}
async function handleClick(event){
  const button=event.target.closest?.('button');if(!button)return;if(button.dataset.v4116Bypass==='1'){delete button.dataset.v4116Bypass;return;}const card=button.closest('.turn-card');if(!card||(!isReplayButton(button)&&!isRetranscribeButton(button)))return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();if(busy)return;busy=true;try{if(isReplayButton(button))await replayCalibrated(iframe.contentDocument,card,button);else await retranscribeSystem(iframe.contentDocument,card,button);}catch(error){console.error(error);setStatus(error.message||String(error),'warn');}finally{busy=false;}
}
function attach(){
  const doc=iframe.contentDocument;if(!doc)return;doc.addEventListener('click',handleClick,true);
  const runtime=doc.getElementById('runtimeVersion');if(runtime&&runtime.textContent!=='V41.16.1 CALIBRATED/SYSTEM')runtime.textContent='V41.16.1 CALIBRATED/SYSTEM';
  const diag=doc.getElementById('diagBuild');if(diag&&diag.textContent!==LAYER_BUILD)diag.textContent=LAYER_BUILD;
  setStatus('couche réparée active · replay calibré + moteur système prioritaire','ok');
}
iframe.src='../beta/'+(location.hash||'');
iframe.addEventListener('load',attach,{once:true});

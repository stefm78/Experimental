import { detectSystemSpeech, supportsSystemAudioTrackRecognition, transcribeSystemAudioTrack } from '../beta/system-stt.js';

const BUILD='2026-09-08.interview-runtime-v41.19-calm-quality';
const DB_NAME='offline-interview';
const DB_VERSION=2;
const STATE_KEY='current-session';
const CAP_KEY='offlineInterview.concurrentStt.v1';
const POLL_MS=5000;
const MAX_PROOF_AGE_MS=7*24*60*60*1000;
let running=false;
let stopped=false;
let automaticQualityDisabled=false;
let concurrentAllowed=false;

function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function kvGet(key){const db=await openDb();try{return await req(db.transaction('kv','readonly').objectStore('kv').get(key));}finally{db.close();}}
async function kvPut(key,value){const db=await openDb();try{await req(db.transaction('kv','readwrite').objectStore('kv').put(value,key));}finally{db.close();}}
async function audioGet(id){const db=await openDb();try{return await req(db.transaction('audio','readonly').objectStore('audio').get(id));}finally{db.close();}}
function isRecording(){const onAir=document.getElementById('topOnAir');const finalizing=document.getElementById('transcribing');return Boolean(onAir&&!onAir.classList.contains('hidden'))||Boolean(finalizing&&!finalizing.classList.contains('hidden'));}
function allTurns(session){return Object.entries(session?.responses||{}).flatMap(([questionId,response])=>(response?.turns||[]).map(turn=>({questionId,turn})));}
function loadCapability(){
  try{
    const cap=JSON.parse(localStorage.getItem(CAP_KEY)||'null');if(!cap)return false;
    const age=Date.now()-Date.parse(cap.testedAt||0);
    return cap.schema==='offline-interview.concurrent-stt-capability.v1'&&cap.status==='PASS_STRICT'&&cap.userAgent===navigator.userAgent&&Number.isFinite(age)&&age>=0&&age<=MAX_PROOF_AGE_MS;
  }catch{return false;}
}
function textOf(turn){return String(turn?.text||turn?.rawTranscript||'').trim();}
function qualityReason(turn){
  if(!turn?.audioRef?.recordingId||turn.humanEdited)return null;
  const start=Number(turn.audioRef.startMs),end=Number(turn.audioRef.endMs);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
  const existing=turn.qualityRetranscription||{};if(existing.status==='succeeded'||existing.status==='running'||existing.status==='failed')return null;
  const text=textOf(turn);const duration=end-start;
  if(!text)return 'empty-live';
  if(concurrentAllowed&&duration>=5000&&text.replace(/\s+/g,' ').length<10)return 'very-short-live';
  return null;
}
async function decodeTurn(turn){
  const record=await audioGet(turn.audioRef.recordingId);if(!record?.blob)throw new Error('audio local introuvable');
  const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw new Error('Web Audio indisponible');
  const context=new Context();await context.resume();
  try{
    const decoded=await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));const sr=decoded.sampleRate;
    const startMs=Math.max(0,Number(turn.audioRef.startMs)||0);const endMs=Math.max(startMs,Math.min(decoded.duration*1000,Number(turn.audioRef.endMs)||startMs));
    const start=Math.floor(startMs*sr/1000),end=Math.max(start+1,Math.ceil(endMs*sr/1000));const isolated=context.createBuffer(decoded.numberOfChannels,end-start,sr);
    for(let c=0;c<decoded.numberOfChannels;c++)isolated.copyToChannel(decoded.getChannelData(c).subarray(start,end),c);
    const dest=context.createMediaStreamDestination();const source=context.createBufferSource();source.buffer=isolated;source.connect(dest);const track=dest.stream.getAudioTracks()[0];if('contentHint'in track)track.contentHint='speech-recognition';
    return {context,source,track,durationMs:Math.ceil(isolated.duration*1000)};
  }catch(error){await context.close().catch(()=>{});throw error;}
}
async function persist(questionId,turnId,patch,eventType){
  const session=await kvGet(STATE_KEY);if(!session)return null;const turn=(session.responses?.[questionId]?.turns||[]).find(t=>t.id===turnId);if(!turn)return null;
  turn.qualityRetranscription={...(turn.qualityRetranscription||{}),...patch};session.runtimeEvents=Array.isArray(session.runtimeEvents)?session.runtimeEvents:[];
  session.runtimeEvents.push({at:new Date().toISOString(),type:eventType,turnId,questionId,...patch});session.runtimeEvents=session.runtimeEvents.slice(-240);await kvPut(STATE_KEY,session);return turn;
}
async function runQuality({questionId,turn},capability,duringLive,reason){
  await persist(questionId,turn.id,{status:'running',attempt:1,engine:'system-audio-track',executionMode:duringLive?'concurrent':'near-line',reason,startedAt:new Date().toISOString()},'quality_retranscription_started');
  const {context,source,track,durationMs}=await decodeTurn(turn);
  try{
    const result=await transcribeSystemAudioTrack(track,{lang:'fr-FR',mode:capability.mode,durationMs,onStart:()=>source.start()});const text=String(result?.text||'').trim();
    if(!text)throw new Error('empty-secondary-result');
    const session=await kvGet(STATE_KEY);const fresh=(session?.responses?.[questionId]?.turns||[]).find(t=>t.id===turn.id);const humanProtected=Boolean(fresh?.humanEdited);
    await persist(questionId,turn.id,{status:'succeeded',attempt:1,engine:'system-audio-track',executionMode:duringLive?'concurrent':'near-line',reason,text,completedAt:new Date().toISOString(),humanProtected},'quality_retranscription_succeeded');
    if(!humanProtected&&!textOf(fresh)){
      const latest=await kvGet(STATE_KEY);const target=(latest?.responses?.[questionId]?.turns||[]).find(t=>t.id===turn.id);
      if(target&&!target.humanEdited&&!textOf(target)){target.text=text;target.rawTranscript=text;target.source='system-quality-background';target.updatedAt=new Date().toISOString();await kvPut(STATE_KEY,latest);}
    }
  }catch(error){
    const code=String(error?.message||error);
    await persist(questionId,turn.id,{status:'failed',attempt:1,engine:'system-audio-track',executionMode:duringLive?'concurrent':'near-line',reason,error:code,completedAt:new Date().toISOString()},'quality_retranscription_failed');
    automaticQualityDisabled=true;
    const session=await kvGet(STATE_KEY);if(session){session.runtimeEvents=Array.isArray(session.runtimeEvents)?session.runtimeEvents:[];session.runtimeEvents.push({at:new Date().toISOString(),type:'automatic_quality_disabled_for_session',reason:code});session.runtimeEvents=session.runtimeEvents.slice(-240);await kvPut(STATE_KEY,session);}
  }finally{try{source.stop();}catch{}try{track.stop();}catch{}await context.close().catch(()=>{});}
}
async function scheduler(){
  if(stopped||running||automaticQualityDisabled)return;
  const recording=isRecording();if(recording&&!concurrentAllowed)return;
  running=true;
  try{
    const capability=await detectSystemSpeech('fr-FR');if(!supportsSystemAudioTrackRecognition()||capability.mode==='unavailable')return;
    const session=await kvGet(STATE_KEY);if(!session)return;
    const next=allTurns(session).map(item=>({...item,reason:qualityReason(item.turn)})).find(item=>item.reason);
    if(next)await runQuality(next,capability,recording,next.reason);
  }catch{
    automaticQualityDisabled=true;
  }finally{running=false;}
}

concurrentAllowed=loadCapability();
const runtime=document.getElementById('runtimeVersion');if(runtime)runtime.textContent='V41.19 CALM QUALITY';
const diag=document.getElementById('diagBuild');if(diag)diag.textContent=BUILD;
const pause=document.getElementById('pauseBtn');if(pause){pause.title='Mettre l’entretien en pause ou le reprendre';pause.setAttribute('aria-label','Mettre l’entretien en pause ou le reprendre');}
setInterval(()=>scheduler().catch(()=>{}),POLL_MS);setTimeout(()=>scheduler().catch(()=>{}),1500);window.addEventListener('beforeunload',()=>{stopped=true;});

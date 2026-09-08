import { detectSystemSpeech, supportsSystemAudioTrackRecognition, transcribeSystemAudioTrack } from '../beta/system-stt.js';

const BUILD = '2026-09-08.interview-runtime-v41.17-quality-lanes';
const DB_NAME = 'offline-interview';
const DB_VERSION = 2;
const STATE_KEY = 'current-session';
const SPEC_KEY = 'last-interview-spec';
const POLL_MS = 4500;
const MAX_AUTO_ATTEMPTS = 2;
let running = false;
let stopped = false;
const status = document.getElementById('qualityLaneStatus');

function setStatus(text, state='ok') {
  if (!status) return;
  status.textContent = `V41.17 · ${text}`;
  status.dataset.state = state;
}
function req(r){ return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
function openDb(){ return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
async function kvGet(key){const db=await openDb();try{return await req(db.transaction('kv','readonly').objectStore('kv').get(key));}finally{db.close();}}
async function kvPut(key,value){const db=await openDb();try{await req(db.transaction('kv','readwrite').objectStore('kv').put(value,key));}finally{db.close();}}
async function audioGet(id){const db=await openDb();try{return await req(db.transaction('audio','readonly').objectStore('audio').get(id));}finally{db.close();}}
function allTurns(session){return Object.entries(session?.responses||{}).flatMap(([questionId,response])=>(response?.turns||[]).map((turn,index)=>({questionId,turn,index})));}
function flattenedQuestions(spec){return (spec?.sections||[]).flatMap(section=>(section.questions||[]).map(question=>({section,question})));}
function isRecording(){
  const onAir=document.getElementById('topOnAir');
  const finalizing=document.getElementById('transcribing');
  return Boolean(onAir && !onAir.classList.contains('hidden')) || Boolean(finalizing && !finalizing.classList.contains('hidden'));
}
function eligible(turn){
  if(!turn?.audioRef?.recordingId || turn.humanEdited) return false;
  const quality=turn.qualityRetranscription||{};
  if(quality.status==='succeeded'||quality.status==='running') return false;
  if((Number(quality.attempt)||0)>=MAX_AUTO_ATTEMPTS) return false;
  return true;
}
async function decodeTurn(turn){
  const record=await audioGet(turn.audioRef.recordingId);
  if(!record?.blob) throw new Error('audio local introuvable');
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context) throw new Error('Web Audio indisponible');
  const context=new Context();
  await context.resume();
  try{
    const decoded=await context.decodeAudioData((await record.blob.arrayBuffer()).slice(0));
    const sr=decoded.sampleRate;
    const startMs=Math.max(0,Number(turn.audioRef.startMs)||0);
    const endMs=Math.max(startMs,Math.min(decoded.duration*1000,Number(turn.audioRef.endMs)||startMs));
    const start=Math.floor(startMs*sr/1000),end=Math.max(start+1,Math.ceil(endMs*sr/1000));
    const isolated=context.createBuffer(decoded.numberOfChannels,end-start,sr);
    for(let c=0;c<decoded.numberOfChannels;c++) isolated.copyToChannel(decoded.getChannelData(c).subarray(start,end),c);
    const dest=context.createMediaStreamDestination();
    const source=context.createBufferSource();source.buffer=isolated;source.connect(dest);
    const track=dest.stream.getAudioTracks()[0];
    if('contentHint' in track) track.contentHint='speech-recognition';
    return {context,source,track,durationMs:Math.ceil(isolated.duration*1000)};
  }catch(error){await context.close().catch(()=>{});throw error;}
}
async function persistQuality(questionId, turnId, patch, eventType){
  const session=await kvGet(STATE_KEY);if(!session) return null;
  const turn=(session.responses?.[questionId]?.turns||[]).find(t=>t.id===turnId);if(!turn) return null;
  turn.qualityRetranscription={...(turn.qualityRetranscription||{}),...patch};
  session.runtimeEvents=Array.isArray(session.runtimeEvents)?session.runtimeEvents:[];
  session.runtimeEvents.push({at:new Date().toISOString(),type:eventType,turnId,questionId,...patch});
  session.runtimeEvents=session.runtimeEvents.slice(-220);
  await kvPut(STATE_KEY,session);
  return turn;
}
async function qualityPass(item,capability){
  const {questionId,turn}=item;
  const attempt=(Number(turn.qualityRetranscription?.attempt)||0)+1;
  await persistQuality(questionId,turn.id,{status:'running',attempt,engine:'system-audio-track',startedAt:new Date().toISOString()},'quality_retranscription_started');
  const {context,source,track,durationMs}=await decodeTurn(turn);
  try{
    const result=await transcribeSystemAudioTrack(track,{lang:'fr-FR',mode:capability.mode,durationMs,onStart:()=>source.start()});
    const text=String(result?.text||'').trim();
    if(!text) throw new Error('aucun texte système');
    const session=await kvGet(STATE_KEY);
    const fresh=(session?.responses?.[questionId]?.turns||[]).find(t=>t.id===turn.id);
    const protectedByHuman=Boolean(fresh?.humanEdited);
    const patch={status:'succeeded',attempt,engine:'system-audio-track',mode:capability.mode,text,completedAt:new Date().toISOString(),humanProtected:protectedByHuman};
    await persistQuality(questionId,turn.id,patch,'quality_retranscription_succeeded');
    if(!protectedByHuman && !String(fresh?.text||'').trim()) {
      const latest=await kvGet(STATE_KEY);
      const target=(latest?.responses?.[questionId]?.turns||[]).find(t=>t.id===turn.id);
      if(target && !target.humanEdited && !String(target.text||'').trim()) {
        target.text=text;target.rawTranscript=text;target.source='system-quality-background';target.updatedAt=new Date().toISOString();
        await kvPut(STATE_KEY,latest);
      }
    }
    setStatus(`qualité prête · ${text.length} caractères · live préservé`,'ok');
  } catch(error) {
    await persistQuality(questionId,turn.id,{status:'failed',attempt,engine:'system-audio-track',error:String(error?.message||error),completedAt:new Date().toISOString()},'quality_retranscription_failed');
    setStatus(`passe qualité différée (${attempt}/${MAX_AUTO_ATTEMPTS}) · ${error?.message||error}`,'warn');
  } finally {
    try{source.stop();}catch{}try{track.stop();}catch{}await context.close().catch(()=>{});
  }
}
async function scheduler(){
  if(stopped||running||isRecording()) return;
  running=true;
  try{
    const capability=await detectSystemSpeech('fr-FR');
    if(!supportsSystemAudioTrackRecognition()||capability.mode==='unavailable'){
      setStatus('live système actif · passe qualité audio-track indisponible ici','warn');return;
    }
    const session=await kvGet(STATE_KEY);if(!session) return;
    const next=allTurns(session).find(({turn})=>eligible(turn));
    if(next) await qualityPass(next,capability);
  } catch(error) {
    setStatus(`qualité en attente · ${error?.message||error}`,'warn');
  } finally {running=false;}
}
function visualState(button,state){
  const glyph=state==='succeeded'?'✓':state==='rejected'?'!':state==='failed'?'×':null;
  if(!glyph) return;
  button.innerHTML=`<span class="audio-to-text-icon" aria-hidden="true">${glyph}</span>`;
  button.title=state==='succeeded'?'Retranscription réussie — relancer si nécessaire':state==='rejected'?'Transcription rejetée — réessayer':'Échec de retranscription — réessayer';
}
async function cardTurn(card){
  const [session,spec]=await Promise.all([kvGet(STATE_KEY),kvGet(SPEC_KEY)]);if(!session||!spec) return null;
  const cards=[...document.querySelectorAll('#turnsList .turn-card')];
  const index=cards.indexOf(card);if(index<0) return null;
  const questionId=flattenedQuestions(spec)[session.currentIndex??0]?.question?.id;
  const turn=questionId?session.responses?.[questionId]?.turns?.[index]:null;
  return turn?{questionId,turn}:null;
}
async function watchRetry(button,card){
  const before=await cardTurn(card);const attempt=Number(before?.turn?.systemRetranscription?.attempt)||0;
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,700));
    const current=await cardTurn(card);const state=current?.turn?.systemRetranscription;
    if((Number(state?.attempt)||0)>attempt && ['succeeded','rejected','failed'].includes(state?.status)){
      visualState(button,state.status);
      return;
    }
  }
}
document.addEventListener('click',event=>{
  const button=event.target.closest?.('button.turn-retranscribe-button');if(!button) return;
  const card=button.closest('.turn-card');if(card) watchRetry(button,card).catch(()=>{});
},true);

const pause=document.getElementById('pauseBtn');
if(pause){pause.title='Mettre l’entretien en pause ou le reprendre';pause.setAttribute('aria-label','Mettre l’entretien en pause ou le reprendre');}
const runtime=document.getElementById('runtimeVersion');if(runtime) runtime.textContent='V41.17 QUALITY LANES';
const diag=document.getElementById('diagBuild');if(diag) diag.textContent=BUILD;
setStatus('live prioritaire · passe qualité non bloquante activée','ok');
setInterval(()=>scheduler().catch(()=>{}),POLL_MS);
setTimeout(()=>scheduler().catch(()=>{}),1200);
window.addEventListener('beforeunload',()=>{stopped=true;});

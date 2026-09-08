const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
const $=id=>document.getElementById(id);
let clipBlob=null, recorder=null, stream=null, chunks=[];
let liveRec=null,bgRec=null,bgSource=null,bgTrack=null,bgContext=null,timer=null;
const events=[];
function log(type,detail={}){const e={t:Math.round(performance.now()),type,...detail};events.push(e);$('log').textContent=events.map(x=>JSON.stringify(x)).join('\n');}
function textFromEvent(e){let s='';for(let i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0]?.transcript||'';return s.trim();}
function setVerdict(kind,msg){$('verdict').className=kind;$('verdict').textContent=msg;log('verdict',{kind,msg});}
async function cleanup(){clearTimeout(timer);try{liveRec?.abort();}catch{}try{bgRec?.abort();}catch{}try{bgSource?.stop();}catch{}try{bgTrack?.stop();}catch{}try{await bgContext?.close();}catch{}liveRec=bgRec=bgSource=bgTrack=bgContext=null;$('abort').disabled=true;$('run').disabled=!clipBlob;}
$('rec').onclick=async()=>{chunks=[];stream=await navigator.mediaDevices.getUserMedia({audio:true});recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>{clipBlob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});stream.getTracks().forEach(t=>t.stop());$('clipState').textContent=` Clip prêt (${Math.round(clipBlob.size/1024)} Ko)`;$('run').disabled=false;$('stop').disabled=true;$('rec').disabled=false;log('reference_clip_ready',{bytes:clipBlob.size,mime:clipBlob.type})};recorder.start();$('rec').disabled=true;$('stop').disabled=false;$('clipState').textContent=' Enregistrement…';log('reference_recording_started');timer=setTimeout(()=>$('stop').click(),10000)};
$('stop').onclick=()=>{clearTimeout(timer);if(recorder?.state==='recording')recorder.stop()};
$('abort').onclick=()=>cleanup();
$('run').onclick=async()=>{
 events.length=0;$('log').textContent='';$('live').textContent='';$('bg').textContent='';$('run').disabled=true;$('abort').disabled=false;
 if(!SR){setVerdict('fail','FAIL_FAST — SpeechRecognition indisponible dans ce navigateur.');return cleanup();}
 try{
  const live=new SR();live.lang='fr-FR';live.continuous=true;live.interimResults=true;liveRec=live;
  let liveStarted=false,liveEnded=false,liveErrored=false,bgStarted=false,bgEnded=false,bgErrored=false,liveText='',bgText='';
  live.onstart=()=>{liveStarted=true;log('live_start')};
  live.onresult=e=>{const t=textFromEvent(e);if(t){liveText=(liveText+' '+t).trim();$('live').textContent=liveText;log('live_result',{text:t})}};
  live.onerror=e=>{liveErrored=true;log('live_error',{error:e.error,message:e.message||''})};
  live.onend=()=>{liveEnded=true;log('live_end')};
  live.start();log('live_start_requested');
  await new Promise(r=>setTimeout(r,1200));
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw new Error('AudioContext indisponible');
  bgContext=new Ctx();await bgContext.resume();const decoded=await bgContext.decodeAudioData((await clipBlob.arrayBuffer()).slice(0));
  const dest=bgContext.createMediaStreamDestination();bgSource=bgContext.createBufferSource();bgSource.buffer=decoded;bgSource.connect(dest);bgTrack=dest.stream.getAudioTracks()[0];if('contentHint'in bgTrack)bgTrack.contentHint='speech-recognition';
  const bg=new SR();bg.lang='fr-FR';bg.continuous=false;bg.interimResults=true;bgRec=bg;
  bg.onstart=()=>{bgStarted=true;log('background_start')};
  bg.onresult=e=>{const t=textFromEvent(e);if(t){bgText=(bgText+' '+t).trim();$('bg').textContent=bgText;log('background_result',{text:t})}};
  bg.onerror=e=>{bgErrored=true;log('background_error',{error:e.error,message:e.message||''})};
  bg.onend=()=>{bgEnded=true;log('background_end')};
  try{bg.start(bgTrack);bgSource.start();log('background_start_requested',{trackKind:bgTrack.kind,durationMs:Math.round(decoded.duration*1000)})}catch(e){setVerdict('warn',`INCONCLUSIVE — ce navigateur refuse SpeechRecognition.start(audioTrack): ${e.message||e}`);return cleanup();}
  const overlapStart=performance.now();
  timer=setTimeout(async()=>{
    const overlapMs=Math.round(performance.now()-overlapStart);try{live.stop()}catch{}try{bg.stop()}catch{};
    await new Promise(r=>setTimeout(r,700));
    const bothProduced=Boolean(liveText.trim()&&bgText.trim());
    const liveSurvived=liveStarted&&!liveErrored;
    if(bothProduced&&liveSurvived&&bgStarted&&!bgErrored)setVerdict('pass',`PASS_CANDIDATE — LIVE et BACKGROUND ont produit du texte pendant une fenêtre concurrente d’environ ${overlapMs} ms.`);
    else if(liveErrored||(!liveText.trim()&&bgStarted))setVerdict('fail','FAIL_FAST — la lane LIVE a été interrompue/inefficace pendant la concurrence.');
    else if(bgErrored)setVerdict('fail','FAIL_FAST — la lane BACKGROUND échoue lorsqu’elle est lancée en parallèle.');
    else setVerdict('warn','INCONCLUSIVE — concurrence démarrée mais preuve insuffisante; refaire une fois en parlant continuellement.');
    log('summary',{liveStarted,liveEnded,liveErrored,bgStarted,bgEnded,bgErrored,liveChars:liveText.length,bgChars:bgText.length,overlapMs});
    await cleanup();
  },15000);
 }catch(e){setVerdict('fail',`FAIL_FAST — ${e.message||e}`);log('fatal',{message:String(e?.message||e)});await cleanup();}
};
log('ready',{speechRecognition:Boolean(SR),secureContext:isSecureContext,userAgent:navigator.userAgent});
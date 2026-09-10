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
  let backgroundStartRequestedAt=null,backgroundStartedAt=null,liveEndedAt=null,testStopRequestedAt=null,sourceStarted=false,verdictIssued=false;
  const issueVerdict=async(kind,msg,extra={})=>{if(verdictIssued)return;verdictIssued=true;setVerdict(kind,msg);log('summary',{liveStarted,liveEnded,liveErrored,bgStarted,bgEnded,bgErrored,liveChars:liveText.length,bgChars:bgText.length,backgroundStartRequestedAt,backgroundStartedAt,liveEndedAt,testStopRequestedAt,...extra});await cleanup();};
  live.onstart=()=>{liveStarted=true;log('live_start')};
  live.onresult=e=>{const t=textFromEvent(e);if(t){liveText=(liveText+' '+t).trim();$('live').textContent=liveText;log('live_result',{text:t})}};
  live.onerror=e=>{liveErrored=true;log('live_error',{error:e.error,message:e.message||''});if(backgroundStartRequestedAt!==null&&testStopRequestedAt===null){issueVerdict('fail',`FAIL_FAST — le lancement BACKGROUND a interrompu LIVE (${e.error||'erreur'}).`,{causalWindowMs:Math.round(performance.now()-backgroundStartRequestedAt)})}};
  live.onend=()=>{liveEnded=true;liveEndedAt=performance.now();log('live_end');if(backgroundStartRequestedAt!==null&&testStopRequestedAt===null&&!liveErrored){issueVerdict('fail','FAIL_FAST — LIVE s’est terminé pendant la fenêtre concurrente après le lancement BACKGROUND.',{causalWindowMs:Math.round(liveEndedAt-backgroundStartRequestedAt)})}};
  live.start();log('live_start_requested');
  await new Promise(r=>setTimeout(r,1200));
  if(verdictIssued)return;
  const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)throw new Error('AudioContext indisponible');
  bgContext=new Ctx();await bgContext.resume();const decoded=await bgContext.decodeAudioData((await clipBlob.arrayBuffer()).slice(0));
  const dest=bgContext.createMediaStreamDestination();bgSource=bgContext.createBufferSource();bgSource.buffer=decoded;bgSource.connect(dest);bgTrack=dest.stream.getAudioTracks()[0];if('contentHint'in bgTrack)bgTrack.contentHint='speech-recognition';
  const bg=new SR();bg.lang='fr-FR';bg.continuous=false;bg.interimResults=true;bgRec=bg;
  bg.onstart=()=>{bgStarted=true;backgroundStartedAt=performance.now();log('background_start');if(!sourceStarted){sourceStarted=true;try{bgSource.start();log('background_source_started')}catch(e){log('background_source_error',{message:String(e?.message||e)});issueVerdict('fail',`FAIL_FAST — impossible de démarrer la source audio BACKGROUND: ${e.message||e}`)}}};
  bg.onresult=e=>{const t=textFromEvent(e);if(t){bgText=(bgText+' '+t).trim();$('bg').textContent=bgText;log('background_result',{text:t})}};
  bg.onerror=e=>{bgErrored=true;log('background_error',{error:e.error,message:e.message||''});if(!verdictIssued)issueVerdict('fail',`FAIL_FAST — la lane BACKGROUND échoue en concurrence (${e.error||'erreur'}).`)};
  bg.onend=()=>{bgEnded=true;log('background_end')};
  try{backgroundStartRequestedAt=performance.now();bg.start(bgTrack);log('background_start_requested',{trackKind:bgTrack.kind,durationMs:Math.round(decoded.duration*1000)})}catch(e){return issueVerdict('warn',`INCONCLUSIVE — ce navigateur refuse SpeechRecognition.start(audioTrack): ${e.message||e}`);}
  const overlapStart=performance.now();
  timer=setTimeout(async()=>{
    if(verdictIssued)return;
    const overlapMs=Math.round(performance.now()-overlapStart);testStopRequestedAt=performance.now();try{live.stop()}catch{}try{bg.stop()}catch{};
    await new Promise(r=>setTimeout(r,700));
    const bothProduced=Boolean(liveText.trim()&&bgText.trim());
    const liveSurvived=liveStarted&&!liveErrored&&(!liveEnded||liveEndedAt>=testStopRequestedAt);
    if(bothProduced&&liveSurvived&&bgStarted&&!bgErrored)await issueVerdict('pass',`PASS_CANDIDATE — LIVE et BACKGROUND ont produit du texte pendant une fenêtre concurrente d’environ ${overlapMs} ms.`,{overlapMs});
    else if(liveErrored||(!liveText.trim()&&bgStarted)||!liveSurvived)await issueVerdict('fail','FAIL_FAST — la lane LIVE a été interrompue/inefficace pendant la concurrence.',{overlapMs});
    else if(bgErrored)await issueVerdict('fail','FAIL_FAST — la lane BACKGROUND échoue lorsqu’elle est lancée en parallèle.',{overlapMs});
    else await issueVerdict('warn','INCONCLUSIVE — concurrence démarrée mais preuve insuffisante; refaire une fois en parlant continuellement.',{overlapMs});
  },15000);
 }catch(e){setVerdict('fail',`FAIL_FAST — ${e.message||e}`);log('fatal',{message:String(e?.message||e)});await cleanup();}
};
log('ready',{speechRecognition:Boolean(SR),secureContext:isSecureContext,userAgent:navigator.userAgent});
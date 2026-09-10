const $=id=>document.getElementById(id);
const now=()=>Math.round(performance.now());
const state={
 schema:'offline-interview.voice-access-coexistence.v2',
 createdAt:new Date().toISOString(),
 userAgent:navigator.userAgent,
 platform:navigator.platform,
 secureContext:isSecureContext,
 A:{startedAt:null,endedAt:null,text:'',firstInputAt:null,inputEvents:[]},
 B:{
  recordingStartedAt:null,voiceStartAt:null,voiceEndAt:null,textSeenAt:null,recordingStoppedAt:null,
  text:'',firstInputAt:null,firstNonEmptyInputAt:null,recorderStateAtFirstNonEmptyInput:null,inputEvents:[],
  capture:{trackMuted:false,trackEnded:false,recorderError:false,state:null,bytes:0,mime:'',trackSettings:null},
  levels:{before:[],during:[],after:[]}
 },
 human:{voiceAccessActuallyUsed:false,audioAudibleBeforeDuringAfter:false},events:[],verdict:null
};
let stream=null,recorder=null,chunks=[],ctx=null,analyser=null,raf=null,blob=null;
function ev(type,detail={}){state.events.push({t:now(),type,...detail});render()}
function summarize(v){if(!v.length)return{samples:0,mean:0,max:0,p05:0};const s=[...v].sort((a,b)=>a-b);return{samples:v.length,mean:v.reduce((a,b)=>a+b,0)/v.length,max:Math.max(...v),p05:s[Math.floor((s.length-1)*.05)]||0}}
function render(){const out=JSON.parse(JSON.stringify(state));for(const k of ['before','during','after'])out.B.levels[k]=summarize(state.B.levels[k]);$('log').textContent=JSON.stringify(out,null,2)}
function trace(which,e){const t=now(),target=which==='A'?state.A:state.B;target.text=e.target.value;const item={t,type:e.type,inputType:e.inputType||null,data:e.data??null,length:e.target.value.length,isComposing:!!e.isComposing};target.inputEvents.push(item);if(e.type==='input'&&target.firstInputAt===null)target.firstInputAt=t;if(which==='B'&&e.type==='input'&&e.target.value.trim().length>0&&target.firstNonEmptyInputAt===null){target.firstNonEmptyInputAt=t;target.recorderStateAtFirstNonEmptyInput=recorder?.state||null;ev('b_first_nonempty_input',{chars:e.target.value.length,recorderState:target.recorderStateAtFirstNonEmptyInput})}render()}
['beforeinput','input','change'].forEach(type=>$('aText').addEventListener(type,e=>trace('A',e)));
['beforeinput','input','change'].forEach(type=>$('bText').addEventListener(type,e=>trace('B',e)));
$('aStart').onclick=()=>{state.A={startedAt:now(),endedAt:null,text:$('aText').value,firstInputAt:null,inputEvents:[]};$('aStart').disabled=true;$('aEnd').disabled=false;$('aText').focus();$('aStatus').textContent='A actif — utilise Voice Access dans le champ.';ev('a_started')};
$('aEnd').onclick=()=>{state.A.endedAt=now();state.A.text=$('aText').value;const ok=state.A.text.trim().length>0;$('aStatus').className='status '+(ok?'pass':'warn');$('aStatus').textContent=ok?'A PASS — Voice Access a inséré du texte.':'A INCONCLUSIVE — aucun texte observé.';$('aStart').disabled=false;$('aEnd').disabled=true;ev('a_ended',{chars:state.A.text.length})};
function levelLoop(){if(!analyser)return;const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);let sum=0;for(const x of data){const v=(x-128)/128;sum+=v*v}const rms=Math.sqrt(sum/data.length);let phase='before';if(state.B.voiceStartAt!==null&&state.B.voiceEndAt===null)phase='during';else if(state.B.voiceEndAt!==null)phase='after';state.B.levels[phase].push(rms);raf=requestAnimationFrame(levelLoop)}
async function stopGraph(){if(raf)cancelAnimationFrame(raf);raf=null;try{await ctx?.close()}catch{}ctx=analyser=null}
$('bRecord').onclick=async()=>{try{
 chunks=[];blob=null;$('bText').value='';
 state.B={recordingStartedAt:null,voiceStartAt:null,voiceEndAt:null,textSeenAt:null,recordingStoppedAt:null,text:'',firstInputAt:null,firstNonEmptyInputAt:null,recorderStateAtFirstNonEmptyInput:null,inputEvents:[],capture:{trackMuted:false,trackEnded:false,recorderError:false,state:'starting',bytes:0,mime:'',trackSettings:null},levels:{before:[],during:[],after:[]}};
 stream=await navigator.mediaDevices.getUserMedia({audio:true});const track=stream.getAudioTracks()[0];state.B.capture.trackSettings=track.getSettings?.()||null;
 track.onmute=()=>{state.B.capture.trackMuted=true;ev('track_mute')};track.onunmute=()=>ev('track_unmute');track.onended=()=>{state.B.capture.trackEnded=true;ev('track_ended')};
 recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=e=>{state.B.capture.recorderError=true;ev('recorder_error',{name:e.error?.name||'',message:e.error?.message||''})};
 recorder.onstop=async()=>{state.B.recordingStoppedAt=now();blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});state.B.capture.state='inactive';state.B.capture.bytes=blob.size;state.B.capture.mime=blob.type;stream?.getTracks().forEach(t=>t.stop());$('audio').src=URL.createObjectURL(blob);$('bRecord').disabled=false;$('bVoiceStart').disabled=true;$('bVoiceEnd').disabled=true;$('bTextSeen').disabled=true;$('bStop').disabled=true;$('bStatus').textContent=`B enregistré — ${Math.round(blob.size/1024)} Ko. Réécoute l’audio puis calcule le verdict.`;ev('recording_stopped',{bytes:blob.size,mime:blob.type});await stopGraph()};
 recorder.start(500);state.B.recordingStartedAt=now();state.B.capture.state='recording';ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();const src=ctx.createMediaStreamSource(stream);analyser=ctx.createAnalyser();analyser.fftSize=1024;src.connect(analyser);levelLoop();$('bRecord').disabled=true;$('bVoiceStart').disabled=false;$('bStop').disabled=false;$('bStatus').textContent='Enregistrement actif — parle quelques secondes, puis démarre Voice Access.';ev('recording_started',{mime:recorder.mimeType||'',settings:state.B.capture.trackSettings})
 }catch(e){state.B.capture.recorderError=true;$('bStatus').className='status fail';$('bStatus').textContent=`Échec capture : ${e.message||e}`;ev('recording_start_error',{message:String(e?.message||e)})}};
$('bVoiceStart').onclick=()=>{state.B.voiceStartAt=now();$('bVoiceStart').disabled=true;$('bVoiceEnd').disabled=false;$('bTextSeen').disabled=false;$('bText').focus();$('bStatus').textContent='Voice Access actif — dicte. Garde l’enregistrement actif jusqu’à ce que le texte apparaisse.';ev('voice_access_window_start')};
$('bTextSeen').onclick=()=>{state.B.textSeenAt=now();state.B.text=$('bText').value;$('bTextSeen').disabled=true;$('bStatus').textContent='Texte marqué comme visible. Continue à parler quelques secondes avant d’arrêter.';ev('text_seen_button',{chars:state.B.text.length,recorderState:recorder?.state||null})};
$('bVoiceEnd').onclick=()=>{state.B.voiceEndAt=now();state.B.text=$('bText').value;$('bVoiceEnd').disabled=true;$('bStatus').textContent='Fenêtre Voice Access terminée. Attends le texte s’il n’est pas encore visible; ne coupe pas l’enregistrement trop tôt.';ev('voice_access_window_end',{chars:state.B.text.length})};
$('bStop').onclick=()=>{if(recorder?.state==='recording'){state.B.capture.state='stopping';ev('stop_requested',{chars:$('bText').value.length});recorder.stop()}};
$('finalize').onclick=()=>{
 state.A.text=$('aText').value;state.B.text=$('bText').value;state.human.voiceAccessActuallyUsed=$('voiceUsed').checked;state.human.audioAudibleBeforeDuringAfter=$('audioOk').checked;
 const A=state.A.text.trim().length>0,B=state.B.text.trim().length>0,c=state.B.capture,L={before:summarize(state.B.levels.before),during:summarize(state.B.levels.during),after:summarize(state.B.levels.after)};
 const captureIntact=!c.trackMuted&&!c.trackEnded&&!c.recorderError&&c.bytes>0;const energyDuring=L.during.samples>0&&L.during.mean>0.003;
 const inputDuringRecording=state.B.firstNonEmptyInputAt!==null&&state.B.recordingStoppedAt!==null&&state.B.firstNonEmptyInputAt<state.B.recordingStoppedAt&&state.B.recorderStateAtFirstNonEmptyInput==='recording';
 const seenDuringRecording=state.B.textSeenAt!==null&&state.B.recordingStoppedAt!==null&&state.B.textSeenAt<state.B.recordingStoppedAt;
 let code,msg,cls='warn';
 if(!A){code='INCONCLUSIVE_VOICE_ACCESS_BASELINE';msg='INCONCLUSIVE — Voice Access n’est pas prouvé dans la baseline.'}
 else if(!state.human.voiceAccessActuallyUsed){code='HOLD_VOICE_ACCESS_CONFIRMATION_REQUIRED';msg='HOLD — confirme que Voice Access a réellement été utilisé.'}
 else if(!captureIntact){code='FAIL_FAST_MASTER_CAPTURE_INTERRUPTED';msg='FAIL_FAST — l’enregistrement maître a subi mute/end/error.';cls='fail'}
 else if(!energyDuring){code='FAIL_FAST_MASTER_AUDIO_ENERGY_GAP';msg='FAIL_FAST — énergie audio insuffisante pendant Voice Access.';cls='fail'}
 else if(!state.human.audioAudibleBeforeDuringAfter){code='HUMAN_AUDIO_REVIEW_REQUIRED';msg='HOLD — réécoute et confirme la continuité audio.'}
 else if(B&&captureIntact&&energyDuring&&inputDuringRecording&&seenDuringRecording){code='PASS_CANDIDATE_ANDROID_VOICE_ACCESS_REALTIME_COMMIT';msg='PASS_CANDIDATE — Voice Access insère du texte pendant que le master enregistre, sans dommage audio.';cls='pass'}
 else if(B&&captureIntact&&energyDuring){code='PASS_CANDIDATE_ANDROID_VOICE_ACCESS_DEFERRED_COMMIT';msg='PASS_CANDIDATE DEFERRED — Voice Access et le master coexistent, mais l’insertion temps réel pendant l’enregistrement n’est pas prouvée.';cls='pass'}
 else{code='INCONCLUSIVE';msg='INCONCLUSIVE — preuve insuffisante.'}
 state.verdict={code,message:msg,computedAt:now(),levels:L,captureIntact,energyDuring,inputDuringRecording,seenDuringRecording,firstNonEmptyInputAt:state.B.firstNonEmptyInputAt,recordingStoppedAt:state.B.recordingStoppedAt,commitLatencyFromVoiceStartMs:state.B.firstNonEmptyInputAt!==null&&state.B.voiceStartAt!==null?state.B.firstNonEmptyInputAt-state.B.voiceStartAt:null};$('verdict').className='status '+cls;$('verdict').textContent=msg;ev('verdict',{code});render()
};
$('copy').onclick=async()=>{render();try{await navigator.clipboard.writeText($('log').textContent);$('copy').textContent='JSON copié ✓';setTimeout(()=>$('copy').textContent='Copier JSON',1800)}catch{alert('Copie impossible : sélectionne le JSON manuellement.')}};
ev('ready');
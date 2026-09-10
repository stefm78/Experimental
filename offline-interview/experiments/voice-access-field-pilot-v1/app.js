const $=id=>document.getElementById(id);
const now=()=>Math.round(performance.now());
const questions=[
  'Présente-toi en quelques phrases et explique ce que tu testes aujourd’hui.',
  'Décris un exemple où la prise de notes automatique te ferait gagner du temps.',
  'Qu’est-ce qui te ferait confiance ou non à une transcription produite pendant un entretien ?'
];
const state={
 schema:'offline-interview.voice-access-field-pilot.v1',
 createdAt:new Date().toISOString(),
 userAgent:navigator.userAgent,
 platform:navigator.platform,
 secureContext:isSecureContext,
 session:{startedAt:null,stoppedAt:null,recorderState:null},
 capture:{trackMuted:false,trackEnded:false,recorderError:false,bytes:0,mime:'',trackSettings:null},
 turns:[],
 levels:[],
 events:[],
 human:{audioContinuous:false,routingCorrect:false},
 verdict:null
};
let stream=null,recorder=null,chunks=[],ctx=null,analyser=null,raf=null,blob=null,current=0,turnStart=null,voiceMark=null,firstInputAt=null,firstInputRecorderState=null;
function ev(type,detail={}){state.events.push({t:now(),type,...detail});render()}
function render(){const out=JSON.parse(JSON.stringify(state));$('log').textContent=JSON.stringify(out,null,2)}
function rmsLoop(){if(!analyser)return;const data=new Uint8Array(analyser.fftSize);analyser.getByteTimeDomainData(data);let sum=0;for(const x of data){const v=(x-128)/128;sum+=v*v}state.levels.push({t:now(),rms:Math.sqrt(sum/data.length),turn:current+1});raf=requestAnimationFrame(rmsLoop)}
async function stopGraph(){if(raf)cancelAnimationFrame(raf);raf=null;try{await ctx?.close()}catch{}ctx=analyser=null}
function showQuestion(){ $('qIndex').textContent=String(current+1);$('question').textContent=questions[current];$('answer').value='';turnStart=now();voiceMark=null;firstInputAt=null;firstInputRecorderState=null;$('answer').focus();$('turnStatus').textContent='Question active — dicte avec Voice Access puis attends le texte.';ev('turn_started',{turn:current+1,question:questions[current]}) }
$('answer').addEventListener('input',e=>{if(firstInputAt===null&&e.target.value.trim()){firstInputAt=now();firstInputRecorderState=recorder?.state||null;ev('turn_first_nonempty_input',{turn:current+1,chars:e.target.value.length,recorderState:firstInputRecorderState})}else{render()}});
$('answer').addEventListener('beforeinput',e=>ev('beforeinput',{turn:current+1,inputType:e.inputType||null,data:e.data??null,length:e.target.value.length}));
$('answer').addEventListener('change',e=>ev('change',{turn:current+1,length:e.target.value.length}));
$('markVoice').onclick=()=>{voiceMark=now();$('answer').focus();$('turnStatus').textContent='Voice Access marqué — dicte maintenant et attends le texte.';ev('voice_access_mark',{turn:current+1,recorderState:recorder?.state||null})};
function saveTurn(reason){const text=$('answer').value.trim();const endedAt=now();const turn={
 turn:current+1,question:questions[current],speaker:'Participant',startedAt:turnStart,endedAt,text,
 voiceAccessMarkedAt:voiceMark,firstNonEmptyInputAt:firstInputAt,recorderStateAtFirstNonEmptyInput:firstInputRecorderState,
 commitLatencyFromVoiceMarkMs:voiceMark!==null&&firstInputAt!==null?firstInputAt-voiceMark:null,
 completedBy:reason
};state.turns.push(turn);ev('turn_saved',{turn:turn.turn,chars:text.length,reason});return turn}
$('next').onclick=()=>{if(current>=questions.length-1){$('turnStatus').textContent='Dernière question : utilise « Terminer l’entretien ».';return}const t=saveTurn('next');if(!t.text){$('turnStatus').textContent='Réponse vide enregistrée — résultat final sera HOLD.'}current++;showQuestion()};
$('startSession').onclick=async()=>{try{
 chunks=[];state.turns=[];state.levels=[];state.events=[];state.capture={trackMuted:false,trackEnded:false,recorderError:false,bytes:0,mime:'',trackSettings:null};
 stream=await navigator.mediaDevices.getUserMedia({audio:true});const track=stream.getAudioTracks()[0];state.capture.trackSettings=track.getSettings?.()||null;
 track.onmute=()=>{state.capture.trackMuted=true;ev('track_mute')};track.onunmute=()=>ev('track_unmute');track.onended=()=>{state.capture.trackEnded=true;ev('track_ended')};
 recorder=new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=e=>{state.capture.recorderError=true;ev('recorder_error',{name:e.error?.name||'',message:e.error?.message||''})};
 recorder.onstop=async()=>{state.session.stoppedAt=now();state.session.recorderState='inactive';blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});state.capture.bytes=blob.size;state.capture.mime=blob.type;stream?.getTracks().forEach(t=>t.stop());$('audio').src=URL.createObjectURL(blob);$('interview').hidden=true;$('result').hidden=false;ev('recording_stopped',{bytes:blob.size,mime:blob.type});await stopGraph()};
 recorder.start(500);state.session.startedAt=now();state.session.recorderState='recording';ctx=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();const src=ctx.createMediaStreamSource(stream);analyser=ctx.createAnalyser();analyser.fftSize=1024;src.connect(analyser);rmsLoop();current=0;$('setup').hidden=true;$('interview').hidden=false;ev('recording_started',{settings:state.capture.trackSettings,mime:recorder.mimeType||''});showQuestion()
 }catch(e){$('sessionStatus').className='status fail';$('sessionStatus').textContent=`Échec capture : ${e.message||e}`;state.capture.recorderError=true;ev('recording_start_error',{message:String(e?.message||e)})}}
$('stopSession').onclick=()=>{if(recorder?.state!=='recording')return;if(state.turns.length<=current)saveTurn('stop');state.session.recorderState='stopping';ev('stop_requested',{turns:state.turns.length});recorder.stop()};
function levelStats(){const vals=state.levels.map(x=>x.rms);if(!vals.length)return{samples:0,mean:0,max:0};return{samples:vals.length,mean:vals.reduce((a,b)=>a+b,0)/vals.length,max:Math.max(...vals)}}
$('finalize').onclick=()=>{state.human.audioContinuous=$('audioOk').checked;state.human.routingCorrect=$('routingOk').checked;const c=state.capture;const captureIntact=!c.trackMuted&&!c.trackEnded&&!c.recorderError&&c.bytes>0;const three=state.turns.length===3;const allText=three&&state.turns.every(t=>t.text.length>0);const allRealtime=three&&state.turns.every(t=>t.firstNonEmptyInputAt!==null&&t.recorderStateAtFirstNonEmptyInput==='recording');const unique=three&&new Set(state.turns.map(t=>t.text)).size===3;const levels=levelStats();let code,msg,cls='warn';
 if(!captureIntact){code='FAIL_FAST_MASTER_CAPTURE_DAMAGED';msg='FAIL_FAST — le master audio a subi une anomalie.';cls='fail'}
 else if(!three||!allText){code='HOLD_INCOMPLETE_MULTI_TURN';msg='HOLD — trois réponses non vides sont nécessaires.'}
 else if(!allRealtime){code='HOLD_REALTIME_COMMIT_NOT_PROVEN_EACH_TURN';msg='HOLD — l’insertion pendant l’enregistrement n’est pas prouvée sur chaque tour.'}
 else if(!unique){code='HOLD_TEXT_ROUTING_AMBIGUOUS';msg='HOLD — les réponses ne sont pas suffisamment distinctes pour qualifier le routage.'}
 else if(!state.human.audioContinuous){code='HUMAN_AUDIO_REVIEW_REQUIRED';msg='HOLD — réécoute l’audio maître et confirme sa continuité.'}
 else if(!state.human.routingCorrect){code='HUMAN_ROUTING_REVIEW_REQUIRED';msg='HOLD — confirme que chaque texte est resté associé à la bonne question.'}
 else{code='PASS_CANDIDATE_ANDROID_VOICE_ACCESS_FIELD_PILOT';msg='PASS_CANDIDATE — Voice Access fonctionne sur trois tours avec master audio continu, commits temps réel et routage texte correct.';cls='pass'}
 state.verdict={code,message:msg,computedAt:now(),captureIntact,threeTurns:three,allTurnsNonEmpty:allText,allTurnsCommittedWhileRecording:allRealtime,distinctTexts:unique,levelStats:levels};$('verdict').className='status '+cls;$('verdict').textContent=msg;ev('verdict',{code});render()};
$('copy').onclick=async()=>{render();try{await navigator.clipboard.writeText($('log').textContent);$('copy').textContent='JSON copié ✓';setTimeout(()=>$('copy').textContent='Copier JSON',1800)}catch{alert('Copie impossible : sélectionne le JSON manuellement.')}};
ev('ready');
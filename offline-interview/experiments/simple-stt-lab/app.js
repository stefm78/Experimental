(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const $ = id => document.getElementById(id);
  const log = (kind, data = {}) => { const row = { at:new Date().toISOString(), kind, ...data }; $('details').textContent += JSON.stringify(row) + '\n'; };
  const fail = (el, msg, err) => { el.textContent = msg; el.className='bad'; if (err) log('error',{message:String(err?.message||err),name:err?.name||''}); };
  const ok = (el, msg) => { el.textContent = msg; el.className='ok'; };

  let mediaStream=null, recorder=null, chunks=[], blob=null, liveRec=null, savedRec=null, savedMedia=null, savedUrl=null;
  window.simpleSttLab = { getBlob: () => blob, log };

  async function startRecording(){
    try{
      mediaStream = await navigator.mediaDevices.getUserMedia({audio:true});
      chunks=[]; blob=null;
      recorder = new MediaRecorder(mediaStream);
      recorder.ondataavailable=e=>{ if(e.data?.size) chunks.push(e.data); };
      recorder.onstop=()=>{
        blob = new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
        $('player').src = URL.createObjectURL(blob);
        $('savedTranscribe').disabled=false;
        window.dispatchEvent(new Event('simple-stt-recording-ready'));
        ok($('audioStatus'),`Audio prêt · ${(blob.size/1024).toFixed(0)} Ko`);
        log('recording_ready',{bytes:blob.size,mime:blob.type});
        mediaStream?.getTracks().forEach(t=>t.stop()); mediaStream=null;
      };
      recorder.start(); $('recStart').disabled=true; $('recStop').disabled=false; ok($('audioStatus'),'Enregistrement en cours…'); log('recording_start');
    }catch(e){ fail($('audioStatus'),'Échec audio.',e); }
  }
  function stopRecording(){ if(recorder?.state==='recording') recorder.stop(); $('recStart').disabled=false; $('recStop').disabled=true; }

  function startLive(){
    if(!SR){ fail($('liveStatus'),'SpeechRecognition indisponible.'); return; }
    $('liveText').value='';
    const r = new SR(); liveRec=r; r.lang='fr-FR'; r.continuous=true; r.interimResults=true;
    let finals='';
    r.onstart=()=>{ ok($('liveStatus'),'LIVE en cours…'); $('liveStart').disabled=true; $('liveStop').disabled=false; log('live_start'); };
    r.onresult=e=>{ let interim=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0]?.transcript||''; if(e.results[i].isFinal) finals += t+' '; else interim += t; } $('liveText').value=(finals+interim).trim(); };
    r.onerror=e=>{ fail($('liveStatus'),`Erreur LIVE : ${e.error||'inconnue'}`); log('live_error',{error:e.error,message:e.message||''}); };
    r.onend=()=>{ if($('liveStatus').textContent==='LIVE en cours…') ok($('liveStatus'),'LIVE arrêté.'); $('liveStart').disabled=false; $('liveStop').disabled=true; log('live_end',{text:$('liveText').value}); };
    try{ r.start(); }catch(e){ fail($('liveStatus'),'Impossible de démarrer le LIVE.',e); }
  }
  function stopLive(){ try{ liveRec?.stop(); }catch{} }

  async function transcribeSaved(){
    if(!blob){ fail($('savedStatus'),'Aucun audio à transcrire.'); return; }
    if(!SR){ fail($('savedStatus'),'SpeechRecognition indisponible.'); return; }
    $('savedText').value=''; $('savedTranscribe').disabled=true; ok($('savedStatus'),'Transcription navigateur en cours…');
    try{
      if(savedUrl) URL.revokeObjectURL(savedUrl);
      savedUrl = URL.createObjectURL(blob);
      const media = new Audio(savedUrl); savedMedia=media; media.preload='auto';
      await new Promise((resolve,reject)=>{
        media.oncanplay=resolve;
        media.onerror=()=>reject(media.error || new Error('audio media load failed'));
        media.load();
      });
      if(typeof media.captureStream !== 'function') throw new Error('HTMLMediaElement.captureStream indisponible');
      const stream = media.captureStream();
      const track = stream.getAudioTracks()[0];
      if(!track) throw new Error('captureStream ne fournit aucune piste audio');

      const r = new SR(); savedRec=r; r.lang='fr-FR'; r.continuous=true; r.interimResults=false;
      let text='', recognitionEnded=false, mediaEnded=false;
      const startedAt=performance.now();
      r.onstart=()=>log('saved_recognition_start',{trackReadyState:track.readyState});
      r.onresult=e=>{ for(let i=e.resultIndex;i<e.results.length;i++) if(e.results[i].isFinal) text += (e.results[i][0]?.transcript||'')+' '; $('savedText').value=text.trim(); };
      r.onerror=e=>{ fail($('savedStatus'),`Erreur retranscription : ${e.error||'inconnue'}`); log('saved_error',{error:e.error,message:e.message||''}); };
      r.onend=()=>{
        recognitionEnded=true;
        const out=text.trim();
        if(out) ok($('savedStatus'),'Transcription navigateur terminée.'); else if(!$('savedStatus').classList.contains('bad')) fail($('savedStatus'),'Aucun texte obtenu.');
        $('savedTranscribe').disabled=false;
        log('saved_end',{latencyMs:Math.round(performance.now()-startedAt),text:out,recognitionEndedBeforeMedia:!mediaEnded});
        try{media.pause();}catch{}
      };
      media.onended=()=>{
        mediaEnded=true;
        log('saved_media_end',{currentTimeMs:Math.round(media.currentTime*1000),durationMs:Math.round(media.duration*1000)});
        if(!recognitionEnded){ try{r.stop();}catch{} }
      };

      log('saved_start',{durationMs:Math.round(media.duration*1000),delivery:'HTMLMediaElement.captureStream'});
      await media.play();
      try{ r.start(track); }catch(e){
        $('savedTranscribe').disabled=false;
        fail($('savedStatus'),'Ce navigateur refuse la retranscription de cet audio.',e);
        try{media.pause();}catch{}
      }
    }catch(e){ $('savedTranscribe').disabled=false; fail($('savedStatus'),'Échec de préparation de l’audio.',e); }
  }

  function reset(){
    try{recorder?.stop();}catch{} try{liveRec?.abort();}catch{} try{savedRec?.abort();}catch{} try{savedMedia?.pause();}catch{}
    mediaStream?.getTracks().forEach(t=>t.stop()); mediaStream=null; recorder=null; blob=null; chunks=[];
    if(savedUrl){ URL.revokeObjectURL(savedUrl); savedUrl=null; }
    if($('player').src) URL.revokeObjectURL($('player').src); $('player').removeAttribute('src'); $('player').load();
    $('liveText').value=''; $('savedText').value=''; $('details').textContent='';
    $('audioStatus').textContent='Pas d’enregistrement.'; $('audioStatus').className='';
    $('liveStatus').textContent='Inactif.'; $('liveStatus').className='';
    $('savedStatus').textContent='En attente d’un enregistrement.'; $('savedStatus').className='';
    $('recStart').disabled=false; $('recStop').disabled=true; $('liveStart').disabled=false; $('liveStop').disabled=true; $('savedTranscribe').disabled=true;
    window.dispatchEvent(new Event('simple-stt-reset'));
  }

  $('recStart').onclick=startRecording; $('recStop').onclick=stopRecording; $('liveStart').onclick=startLive; $('liveStop').onclick=stopLive; $('savedTranscribe').onclick=transcribeSaved; $('reset').onclick=reset;
  log('capabilities',{secureContext:isSecureContext,speechRecognition:Boolean(SR),captureStream:Boolean(HTMLMediaElement.prototype.captureStream),webgpu:Boolean(navigator.gpu),userAgent:navigator.userAgent});
})();
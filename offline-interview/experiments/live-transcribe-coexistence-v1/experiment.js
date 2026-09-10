(() => {
  const $ = id => document.getElementById(id);
  const now = () => Math.round(performance.now());
  const events = [];
  let stream, recorder, chunks = [], startedAt = null, stoppedAt = null, timer = null;
  let trackMuted = false, trackEnded = false, recorderError = false;
  let markAt = null;
  const level = {samples:0,sum:0,max:0,nonZero:0};
  let audioCtx, analyser, raf;

  function event(type, extra={}) { events.push({t: now(), type, ...extra}); }
  function setState() { $('state').textContent = recorder?.state || 'inactive'; }
  function startMeter(s) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(s);
    analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048; src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let ss=0; for (const v of buf) ss += v*v;
      const rms = Math.sqrt(ss/buf.length);
      level.samples++; level.sum += rms; level.max = Math.max(level.max,rms); if (rms>0.002) level.nonZero++;
      raf = requestAnimationFrame(tick);
    }; tick();
  }
  async function start() {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const track = stream.getAudioTracks()[0];
    track.addEventListener('mute',()=>{trackMuted=true;event('track_mute')});
    track.addEventListener('ended',()=>{trackEnded=true;event('track_ended')});
    recorder = new MediaRecorder(stream);
    chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size) chunks.push(e.data)};
    recorder.onerror=e=>{recorderError=true;event('recorder_error',{name:e.error?.name||'unknown'})};
    recorder.onstop=()=>{
      stoppedAt = now();
      const blob = new Blob(chunks,{type: recorder.mimeType || 'audio/webm'});
      $('audio').src = URL.createObjectURL(blob);
      $('bytes').textContent = blob.size;
      event('recording_stopped',{bytes:blob.size,mime:blob.type});
      setState();
    };
    recorder.start(1000); startedAt=now(); event('recording_started',{mime:recorder.mimeType,settings:track.getSettings()}); setState();
    $('start').disabled=true; $('stop').disabled=false;
    startMeter(stream);
    timer=setInterval(()=>{$('duration').textContent=((now()-startedAt)/1000).toFixed(1)},200);
  }
  function mark() { markAt=now(); event('live_transcribe_mark',{recorderState:recorder?.state||null}); }
  function stop() {
    if (!recorder || recorder.state==='inactive') return;
    event('stop_requested'); recorder.stop(); clearInterval(timer); cancelAnimationFrame(raf);
    stream.getTracks().forEach(t=>t.stop()); $('stop').disabled=true;
  }
  function result() {
    const bytes = Number($('bytes').textContent||0);
    const human = {liveTranscribeObserved:$('ltUsed').checked,audioContinuous:$('audioOk').checked,speechBeforeDuringAfter:$('speechAround').checked};
    const captureIntact = !trackMuted && !trackEnded && !recorderError && bytes>10000;
    const energyPresent = level.samples>0 && level.nonZero/level.samples>0.05 && level.max>0.02;
    let code='INCONCLUSIVE';
    if (!captureIntact) code='FAIL_MASTER_AUDIO_INTEGRITY';
    else if (!human.liveTranscribeObserved) code='FAIL_LIVE_TRANSCRIBE_NOT_CONCURRENT';
    else if (!human.audioContinuous || !human.speechBeforeDuringAfter) code='HUMAN_AUDIO_REVIEW_REQUIRED';
    else if (!markAt) code='HOLD_CONCURRENCY_MARK_MISSING';
    else if (!energyPresent) code='HOLD_AUDIO_ENERGY_UNPROVEN';
    else code='PASS_CANDIDATE_ANDROID_LIVE_TRANSCRIBE_COEXISTENCE';
    const out={schema:'offline-interview.live-transcribe-coexistence.v1',createdAt:new Date().toISOString(),userAgent:navigator.userAgent,platform:navigator.platform,secureContext:isSecureContext,session:{startedAt,stoppedAt,markAt},capture:{trackMuted,trackEnded,recorderError,bytes,mime:recorder?.mimeType||null},levelStats:{samples:level.samples,mean:level.samples?level.sum/level.samples:0,max:level.max,nonZeroRatio:level.samples?level.nonZero/level.samples:0},human,events,verdict:{code,captureIntact,energyPresent}};
    $('out').value=JSON.stringify(out,null,2); $('verdictText').textContent=code; return out;
  }
  $('start').onclick=()=>start().catch(e=>{event('start_error',{name:e.name,message:e.message});$('verdictText').textContent=`Erreur: ${e.name}`});
  $('mark').onclick=mark; $('stop').onclick=stop; $('verdict').onclick=result;
  $('copy').onclick=async()=>{if(!$('out').value)result(); await navigator.clipboard.writeText($('out').value)};
})();
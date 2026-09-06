export const SpeechRecognitionCtor =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export async function detectSystemSpeech(lang = 'fr-FR') {
  const result = {
    supported: Boolean(SpeechRecognitionCtor),
    mode: 'unavailable',
    localAvailability: null,
    availability: null
  };
  if (!SpeechRecognitionCtor) return result;

  if (typeof SpeechRecognitionCtor.available !== 'function') {
    result.mode = 'standard';
    return result;
  }

  try {
    result.localAvailability = await SpeechRecognitionCtor.available({
      langs: [lang],
      processLocally: true
    });
    if (result.localAvailability === 'available') {
      result.mode = 'local';
      return result;
    }
  } catch (error) {
    result.localAvailability = 'error';
    result.localError = String(error?.message || error);
  }

  try {
    result.availability = await SpeechRecognitionCtor.available({
      langs: [lang],
      processLocally: false
    });
    if (result.availability === 'available') {
      result.mode = 'standard';
      return result;
    }
  } catch (error) {
    result.availability = 'error';
    result.error = String(error?.message || error);
  }

  return result;
}

export function createSystemSpeechSession({
  lang = 'fr-FR',
  mode = 'standard',
  onText = () => {},
  onState = () => {},
  onError = () => {}
} = {}) {
  if (!SpeechRecognitionCtor || mode === 'unavailable') return null;

  const recognition = new SpeechRecognitionCtor();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  if ('processLocally' in recognition) recognition.processLocally = mode === 'local';

  let shouldRun = false;
  let resultSeen = false;
  let lastError = null;
  let restartTimer = null;
  let carryText = '';
  let hardCut = null;
  const hardCutKey = `offline-interview.stt-hard-cut.v1:${mode}:${lang}`;
  let hardCutSamples = [];
  try {
    const saved = JSON.parse(localStorage.getItem(hardCutKey) || 'null');
    if (Array.isArray(saved?.samples)) hardCutSamples = saved.samples.map(Number).filter(Number.isFinite).filter(v => v >= 0 && v <= 5000).slice(-24);
  } catch {}
  const latestResults = new Map();
  let boundaryResults = new Map();

  // V28: a result index that was still interim when the interviewer changed speaker
  // remains owned by the previous semantic segment until Chromium marks it final.
  // Late finalisation therefore cannot leak into the next speaker merely because the
  // onresult event arrived after the click.
  const heldIndexOwners = new Map();
  const activeBoundaries = new Set();
  let boundarySequence = 0;

  const calibrationKey = `offline-interview.stt-boundary-settle.v1:${mode}:${lang}`;
  let settleSamples = [];
  try {
    const saved = JSON.parse(localStorage.getItem(calibrationKey) || 'null');
    if (Array.isArray(saved?.samples)) {
      settleSamples = saved.samples.map(Number).filter(Number.isFinite).filter(v => v >= 0 && v <= 5000).slice(-24);
    }
  } catch {}

  const normalize = value => String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  const cleanJoin = (...parts) => parts
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cloneResults = source => new Map(
    [...source.entries()].map(([index, value]) => [index, { ...value }])
  );

  const suffixAfterBoundary = (currentText, baseText) => {
    const current = String(currentText || '').trim();
    const base = String(baseText || '').trim();
    if (!current) return '';
    if (!base) return current;

    const currentNorm = normalize(current);
    const baseNorm = normalize(base);
    if (!currentNorm || currentNorm === baseNorm) return '';

    if (current.startsWith(base)) return current.slice(base.length).trim();

    const currentWords = current.split(/\s+/);
    const baseWords = base.split(/\s+/);
    let prefixWords = 0;
    while (
      prefixWords < currentWords.length &&
      prefixWords < baseWords.length &&
      normalize(currentWords[prefixWords]) === normalize(baseWords[prefixWords])
    ) {
      prefixWords += 1;
    }
    if (prefixWords === baseWords.length && currentWords.length > prefixWords) {
      return currentWords.slice(prefixWords).join(' ').trim();
    }

    const maxOverlap = Math.min(baseWords.length, currentWords.length);
    for (let overlap = maxOverlap; overlap >= 2; overlap -= 1) {
      const baseTail = normalize(baseWords.slice(-overlap).join(' '));
      const currentHead = normalize(currentWords.slice(0, overlap).join(' '));
      if (baseTail && baseTail === currentHead) {
        return currentWords.slice(overlap).join(' ').trim();
      }
    }

    // Existing result indexes may append text, but never rewrite their old history.
    return '';
  };

  const segmentTextFrom = (baseResults, currentResults, carry = '') => {
    const parts = [];
    for (const index of [...currentResults.keys()].sort((a, b) => a - b)) {
      const current = currentResults.get(index);
      const base = baseResults.get(index);
      const delta = suffixAfterBoundary(current?.text, base?.text);
      if (delta) parts.push(delta);
    }
    return cleanJoin(carry, ...parts);
  };

  const segmentText = () => segmentTextFrom(boundaryResults, latestResults, carryText);

  const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
  };

  const rememberHardCut = ms => {
    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;
    hardCutSamples.push(Math.round(ms));
    hardCutSamples = hardCutSamples.slice(-24);
    try { localStorage.setItem(hardCutKey, JSON.stringify({ samples: hardCutSamples })); } catch {}
  };

  const hardCutCalibration = () => ({
    sampleCount: hardCutSamples.length,
    p50Ms: percentile(hardCutSamples, 0.50),
    p95Ms: percentile(hardCutSamples, 0.95)
  });

  const recommendedSettleTimeoutMs = () => {
    const p95 = percentile(settleSamples, 0.95);
    if (p95 == null) return 1200;
    return Math.round(Math.min(2200, Math.max(650, (p95 * 1.6) + 180)));
  };

  const rememberSettle = ms => {
    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;
    settleSamples.push(Math.round(ms));
    settleSamples = settleSamples.slice(-24);
    try { localStorage.setItem(calibrationKey, JSON.stringify({ samples: settleSamples })); } catch {}
  };

  const boundaryText = boundary => segmentTextFrom(
    boundary.baseResults,
    boundary.capturedResults,
    boundary.carryText
  );

  const resolveBoundary = (boundary, timedOut = false, reason = null) => {
    if (!boundary || boundary.resolved) return;
    boundary.resolved = true;
    boundary.timedOut = Boolean(timedOut);
    clearTimeout(boundary.timer);
    activeBoundaries.delete(boundary);
    const settleMs = Math.max(0, performance.now() - boundary.startedAt);
    if (!timedOut && boundary.initialPendingCount > 0) rememberSettle(settleMs);
    boundary.resolve({
      text: boundaryText(boundary),
      finalText: boundaryText(boundary),
      mode,
      pendingCount: boundary.initialPendingCount,
      settleMs: Math.round(settleMs),
      timedOut: Boolean(timedOut),
      reason
    });
  };

  const resolveAllBoundaries = reason => {
    for (const boundary of [...activeBoundaries]) resolveBoundary(boundary, true, reason);
    heldIndexOwners.clear();
  };

  const publish = () => {
    const text = segmentText();
    if (text) onText({ text, finalText: text, mode });
  };

  recognition.onstart = () => {
    if (hardCut?.waitingForRestart) {
      const handoffMs = Math.max(0, performance.now() - hardCut.startedAt);
      rememberHardCut(handoffMs);
      hardCut.readyResolve({ ready: true, handoffMs: Math.round(handoffMs), calibration: hardCutCalibration() });
      clearTimeout(hardCut.timer);
      hardCut = null;
    }
    onState(mode === 'local' ? 'listening-local' : 'listening');
  };
  recognition.onspeechstart = () => onState(mode === 'local' ? 'speech-local' : 'speech');
  recognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = String(event.results[i]?.[0]?.transcript || '').trim();
      if (!transcript) continue;
      const value = {
        text: transcript,
        isFinal: Boolean(event.results[i].isFinal)
      };
      latestResults.set(i, value);

      const owner = heldIndexOwners.get(i);
      if (owner) {
        owner.capturedResults.set(i, { ...value });
        // Absorb every late update into the semantic boundary so the new segment never
        // sees it as a suffix. This is the core V28 ownership rule.
        boundaryResults.set(i, { ...value });
        if (value.isFinal) {
          owner.pendingIndexes.delete(i);
          heldIndexOwners.delete(i);
          if (owner.pendingIndexes.size === 0) resolveBoundary(owner, false, 'final');
        }
      }
    }
    const text = segmentText();
    resultSeen = Boolean(text);
    publish();
  };
  recognition.onerror = event => {
    lastError = event?.error || 'speech-recognition-error';
    if (!['aborted', 'no-speech'].includes(lastError)) onError(lastError);
  };
  recognition.onend = () => {
    // A semantic hard cut deliberately ends this SpeechRecognition session. All results
    // delivered before onend — even a brand-new result index arriving after the click —
    // still belong to the previous speaker. The next speaker starts with a fresh result
    // namespace after restart.
    if (hardCut) {
      resolveAllBoundaries('hard-cut');
      const text = segmentText();
      hardCut.settledResolve({
        text, finalText: text, mode, resultSeen: Boolean(text) || resultSeen, lastError
      });
      latestResults.clear();
      boundaryResults = new Map();
      carryText = '';
      resultSeen = false;
      lastError = null;
      hardCut.waitingForRestart = true;

      if (!shouldRun) {
        hardCut.readyResolve({ ready: false, handoffMs: null, reason: 'stopped', calibration: hardCutCalibration() });
        clearTimeout(hardCut.timer);
        hardCut = null;
        return;
      }

      restartTimer = setTimeout(() => {
        if (!shouldRun || !hardCut) return;
        try {
          recognition.start();
        } catch (error) {
          hardCut.readyResolve({ ready: false, handoffMs: null, reason: String(error?.message || error), calibration: hardCutCalibration() });
          clearTimeout(hardCut.timer);
          hardCut = null;
        }
      }, 0);
      return;
    }

    // Unplanned Chromium restarts keep the same semantic speaker and may therefore carry
    // the current text into the next recognition namespace.
    resolveAllBoundaries('recognition-end');
    if (!shouldRun) return;
    const current = segmentText();
    if (current) carryText = current;
    latestResults.clear();
    boundaryResults = new Map();
    restartTimer = setTimeout(() => {
      if (!shouldRun) return;
      try { recognition.start(); } catch {}
    }, 120);
  };

  return {
    start() {
      shouldRun = true;
      try {
        recognition.start();
        return true;
      } catch (error) {
        shouldRun = false;
        lastError = String(error?.message || error);
        onError(lastError);
        return false;
      }
    },
    stop() {
      shouldRun = false;
      clearTimeout(restartTimer);
      restartTimer = null;
      resolveAllBoundaries('stop');
      try { recognition.stop(); } catch {}
    },
    abort() {
      shouldRun = false;
      clearTimeout(restartTimer);
      restartTimer = null;
      resolveAllBoundaries('abort');
      try { recognition.abort(); } catch {}
    },
    snapshot() {
      const text = segmentText();
      return {
        text,
        finalText: text,
        mode,
        resultSeen: Boolean(text) || resultSeen,
        lastError
      };
    },
    cutSegment({ timeoutMs = 1800 } = {}) {
      if (hardCut) return null;
      const initialText = segmentText();
      let settledResolve;
      let readyResolve;
      const settled = new Promise(resolve => { settledResolve = resolve; });
      const ready = new Promise(resolve => { readyResolve = resolve; });
      hardCut = {
        startedAt: performance.now(),
        settledResolve,
        readyResolve,
        waitingForRestart: false,
        timer: null
      };
      hardCut.timer = setTimeout(() => {
        if (!hardCut) return;
        try { recognition.abort(); } catch {}
      }, Math.max(700, Math.min(3000, Number(timeoutMs) || 1800)));
      try {
        recognition.stop();
      } catch (error) {
        settledResolve({ text: initialText, finalText: initialText, mode, resultSeen: Boolean(initialText) || resultSeen, lastError: String(error?.message || error) });
        readyResolve({ ready: false, handoffMs: null, reason: String(error?.message || error), calibration: hardCutCalibration() });
        clearTimeout(hardCut.timer);
        hardCut = null;
      }
      return { text: initialText, finalText: initialText, mode, settled, ready };
    },
    takeSegment({ settleTimeoutMs = null } = {}) {
      const text = segmentText();
      const baseForSegment = cloneResults(boundaryResults);
      const capturedResults = cloneResults(latestResults);
      const carryAtBoundary = carryText;
      const pendingIndexes = new Set(
        [...latestResults.entries()]
          .filter(([index, value]) => !value.isFinal && !heldIndexOwners.has(index))
          .map(([index]) => index)
      );

      // From this instant, the current recognition state is the baseline of the new
      // semantic segment. Held interim indexes are kept synchronized with this baseline
      // until they become final, preventing late-tail leakage.
      boundaryResults = cloneResults(latestResults);
      carryText = '';
      resultSeen = false;
      lastError = null;

      let settleResolve;
      const settled = new Promise(resolve => { settleResolve = resolve; });
      const boundary = {
        id: ++boundarySequence,
        baseResults: baseForSegment,
        capturedResults,
        carryText: carryAtBoundary,
        pendingIndexes,
        initialPendingCount: pendingIndexes.size,
        startedAt: performance.now(),
        timer: null,
        resolved: false,
        resolve: settleResolve
      };

      if (pendingIndexes.size === 0) {
        settleResolve({
          text,
          finalText: text,
          mode,
          pendingCount: 0,
          settleMs: 0,
          timedOut: false,
          reason: 'already-final'
        });
      } else {
        activeBoundaries.add(boundary);
        for (const index of pendingIndexes) heldIndexOwners.set(index, boundary);
        const timeoutMs = Number.isFinite(Number(settleTimeoutMs))
          ? Math.max(300, Math.min(3000, Number(settleTimeoutMs)))
          : recommendedSettleTimeoutMs();
        boundary.timer = setTimeout(() => resolveBoundary(boundary, true, 'timeout'), timeoutMs);
      }

      return {
        text,
        finalText: text,
        mode,
        resultSeen: Boolean(text) || resultSeen,
        lastError,
        pendingCount: boundary.initialPendingCount,
        settled
      };
    },
    calibration() {
      return {
        sampleCount: settleSamples.length,
        p50Ms: percentile(settleSamples, 0.50),
        p95Ms: percentile(settleSamples, 0.95),
        timeoutMs: recommendedSettleTimeoutMs(),
        hardCut: hardCutCalibration()
      };
    }
  };
}


// V41.5 — direct post-hoc recognition from a saved audio MediaStreamTrack.
// Chromium exposes SpeechRecognition.start(audioTrack) on desktop from 135 onward.
// Mobile engines do not currently expose this path, so capability is deliberately conservative.
export function supportsSystemAudioTrackRecognition() {
  const ua = navigator.userAgent || '';
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod/i.test(ua);
  const version = ua.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);
  return Boolean(SpeechRecognitionCtor && !mobile && version && Number(version[1]) >= 135);
}

export function transcribeSystemAudioTrack(audioTrack, {
  lang = 'fr-FR', mode = 'standard', durationMs = 0, onStart = () => {}
} = {}) {
  return new Promise((resolve, reject) => {
    if (!SpeechRecognitionCtor) { reject(new Error('SpeechRecognition indisponible')); return; }
    if (!audioTrack || audioTrack.kind !== 'audio' || audioTrack.readyState !== 'live') { reject(new Error('Piste audio invalide')); return; }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if ('processLocally' in recognition) recognition.processLocally = mode === 'local';
    const results = new Map();
    let settled = false;
    let stopTimer = null;
    let hardTimer = null;
    const text = () => [...results.keys()].sort((a, b) => a - b).map(i => results.get(i)).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(stopTimer); clearTimeout(hardTimer);
      try { recognition.abort(); } catch {}
      if (error) reject(error); else resolve({ text: text(), finalText: text(), mode });
    };
    recognition.onresult = event => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const value = String(event.results[i]?.[0]?.transcript || '').trim();
        if (value) results.set(i, value);
      }
    };
    recognition.onerror = event => {
      const code = event?.error || 'speech-recognition-error';
      if (code === 'no-speech') return;
      finish(new Error(code));
    };
    recognition.onend = () => finish();
    recognition.onstart = () => {
      try { onStart(); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return; }
      stopTimer = setTimeout(() => { try { recognition.stop(); } catch { finish(); } }, Math.max(800, Number(durationMs) || 0) + 700);
    };
    hardTimer = setTimeout(() => finish(new Error('Délai de retranscription système dépassé')), Math.max(8000, (Number(durationMs) || 0) + 8000));
    try { recognition.start(audioTrack); }
    catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
}

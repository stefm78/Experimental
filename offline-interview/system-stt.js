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
  if ('processLocally' in recognition) {
    recognition.processLocally = mode === 'local';
  }

  let shouldRun = false;
  let resultSeen = false;
  let lastError = null;
  let restartTimer = null;
  let carryText = '';
  const latestResults = new Map();
  let boundaryResults = new Map();

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

  const suffixAfterBoundary = (currentText, baseText) => {
    const current = String(currentText || '').trim();
    const base = String(baseText || '').trim();
    if (!current) return '';
    if (!base) return current;

    const currentNorm = normalize(current);
    const baseNorm = normalize(base);
    if (!currentNorm || currentNorm === baseNorm) return '';

    if (current.startsWith(base)) {
      return current.slice(base.length).trim();
    }

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

    // Existing result indexes are allowed to append, but not to rewrite their old history.
    return '';
  };

  const segmentText = () => {
    const parts = [];
    for (const index of [...latestResults.keys()].sort((a, b) => a - b)) {
      const current = latestResults.get(index);
      const base = boundaryResults.get(index);
      const delta = suffixAfterBoundary(current?.text, base?.text);
      if (delta) parts.push(delta);
    }
    return cleanJoin(carryText, ...parts);
  };

  const publish = () => {
    const text = segmentText();
    if (text) onText({ text, finalText: text, mode });
  };

  recognition.onstart = () => onState(mode === 'local' ? 'listening-local' : 'listening');
  recognition.onspeechstart = () => onState(mode === 'local' ? 'speech-local' : 'speech');
  recognition.onresult = event => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = String(event.results[i]?.[0]?.transcript || '').trim();
      if (!transcript) continue;
      latestResults.set(i, {
        text: transcript,
        isFinal: Boolean(event.results[i].isFinal)
      });
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
    if (!shouldRun) return;

    // Chromium restarts can reset result indexes to zero. Preserve the current semantic
    // segment as carry text before clearing index state, then resume recognition.
    const current = segmentText();
    if (current) carryText = current;
    latestResults.clear();
    boundaryResults = new Map();

    restartTimer = setTimeout(() => {
      if (!shouldRun) return;
      try {
        recognition.start();
      } catch {}
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
      try {
        recognition.stop();
      } catch {}
    },
    abort() {
      shouldRun = false;
      clearTimeout(restartTimer);
      restartTimer = null;
      try {
        recognition.abort();
      } catch {}
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
    takeSegment() {
      const text = segmentText();
      const segment = {
        text,
        finalText: text,
        mode,
        resultSeen: Boolean(text) || resultSeen,
        lastError
      };

      // Snapshot every current recognition result. Subsequent events at the same index
      // contribute only text appended after this semantic boundary.
      boundaryResults = new Map(
        [...latestResults.entries()].map(([index, value]) => [index, { ...value }])
      );
      carryText = '';
      resultSeen = false;
      lastError = null;
      return segment;
    }
  };
}


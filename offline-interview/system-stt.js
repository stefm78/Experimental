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
  let finalText = '';
  let interimText = '';
  let resultSeen = false;
  let lastError = null;
  let restartTimer = null;
  let boundaryText = '';
  let boundaryUntil = 0;

  const publish = () => {
    const text = [finalText, interimText].filter(Boolean).join(' ').trim();
    if (text) onText({ text, finalText: finalText || text, mode });
  };

  recognition.onstart = () => onState(mode === 'local' ? 'listening-local' : 'listening');
  recognition.onspeechstart = () => onState(mode === 'local' ? 'speech-local' : 'speech');
  recognition.onresult = event => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      let transcript = String(event.results[i]?.[0]?.transcript || '').trim();
      if (!transcript) continue;

      if (boundaryText && Date.now() < boundaryUntil) {
        const normalize = value => String(value || '')
          .toLocaleLowerCase()
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim();
        const previous = normalize(boundaryText);
        const candidate = normalize(transcript);
        if (candidate && previous && (previous.endsWith(candidate) || previous === candidate)) {
          continue;
        }
      } else if (Date.now() >= boundaryUntil) {
        boundaryText = '';
      }

      resultSeen = true;
      if (event.results[i].isFinal) {
        finalText = [finalText, transcript].filter(Boolean).join(' ').trim();
      } else {
        interim = [interim, transcript].filter(Boolean).join(' ').trim();
      }
    }
    interimText = interim;
    publish();
  };
  recognition.onerror = event => {
    lastError = event?.error || 'speech-recognition-error';
    if (!['aborted', 'no-speech'].includes(lastError)) onError(lastError);
  };
  recognition.onend = () => {
    if (!shouldRun) return;
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
      const text = [finalText, interimText].filter(Boolean).join(' ').trim();
      return {
        text,
        finalText: finalText || text,
        mode,
        resultSeen,
        lastError
      };
    },
    takeSegment() {
      const text = [finalText, interimText].filter(Boolean).join(' ').trim();
      const segment = {
        text,
        finalText: finalText || text,
        mode,
        resultSeen,
        lastError
      };
      boundaryText = text;
      boundaryUntil = Date.now() + 2200;
      finalText = '';
      interimText = '';
      resultSeen = false;
      lastError = null;
      return segment;
    }
  };
}

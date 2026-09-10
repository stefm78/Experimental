const NativeSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

if (NativeSpeechRecognition) {
  let blockedAfterNetworkFailure = false;
  let degradationNotified = false;

  const notifyDegraded = () => {
    if (degradationNotified) return;
    degradationNotified = true;
    window.dispatchEvent(new CustomEvent('offline-interview-stt-degraded', {
      detail: { reason: 'network' }
    }));
  };

  const WrappedSpeechRecognition = new Proxy(NativeSpeechRecognition, {
    construct(Target, args) {
      const recognition = Reflect.construct(Target, args, Target);
      const nativeStart = recognition.start.bind(recognition);

      recognition.addEventListener('error', event => {
        if (event?.error !== 'network') return;
        blockedAfterNetworkFailure = true;
        notifyDegraded();
      });

      recognition.start = (...startArgs) => {
        if (blockedAfterNetworkFailure) {
          notifyDegraded();
          throw new DOMException(
            'SpeechRecognition disabled for this page after a network failure.',
            'NetworkError'
          );
        }
        return nativeStart(...startArgs);
      };

      return recognition;
    }
  });

  window.SpeechRecognition = WrappedSpeechRecognition;
  if (window.webkitSpeechRecognition === NativeSpeechRecognition) {
    window.webkitSpeechRecognition = WrappedSpeechRecognition;
  }
}

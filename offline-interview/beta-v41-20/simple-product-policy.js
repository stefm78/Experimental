const POLICY_ID = 'offline-interview.v41.20.simple-live-reintegration';

document.documentElement.dataset.transcriptionPolicy = POLICY_ID;

function applyPolicy(root = document) {
  // V41.20 deliberately removes the unqualified saved-audio retranscription action
  // from the product surface. Audio replay and LIVE transcription remain available.
  for (const button of root.querySelectorAll?.('.turn-retranscribe-button') || []) {
    button.hidden = true;
    button.disabled = true;
    button.setAttribute('aria-hidden', 'true');
    button.dataset.v4120Suppressed = 'saved-audio-unqualified';
  }
}

applyPolicy();
const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) applyPolicy(node);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

console.info('[Offline Interview V41.20]', POLICY_ID, 'LIVE-first; automatic and manual saved-audio STT suppressed pending independent qualification.');

const ROUTER_KEY = '__offlineInterviewNativeBridgeRouterV1';
const BRIDGE_NAME = 'OfflineInterviewNative';

function bridgeObject() {
  return globalThis?.[BRIDGE_NAME] || null;
}

export function hasNativeBridge() {
  return typeof bridgeObject()?.postMessage === 'function';
}

function parseMessage(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}

function router() {
  if (globalThis[ROUTER_KEY]) return globalThis[ROUTER_KEY];
  const state = {
    listeners: new Set(),
    pending: new Map(),
    installedBridge: null
  };
  globalThis[ROUTER_KEY] = state;
  install(state);
  return state;
}

function install(state) {
  const bridge = bridgeObject();
  if (!bridge || state.installedBridge === bridge) return;
  const dispatch = event => {
    const message = parseMessage(event?.data ?? event);
    if (!message) return;
    if (message.requestId && state.pending.has(message.requestId)) {
      const pending = state.pending.get(message.requestId);
      state.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      pending.resolve(message);
    }
    for (const listener of [...state.listeners]) {
      try { listener(message); } catch (error) { console.warn('native bridge listener failed', error); }
    }
  };
  if (typeof bridge.addEventListener === 'function') bridge.addEventListener('message', dispatch);
  else bridge.onmessage = dispatch;
  state.installedBridge = bridge;
}

export function postNative(payload) {
  const state = router();
  install(state);
  const bridge = bridgeObject();
  if (!bridge || typeof bridge.postMessage !== 'function') return false;
  bridge.postMessage(JSON.stringify(payload));
  return true;
}

export function subscribeNative(listener) {
  const state = router();
  install(state);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function requestNative(type, payload = {}, timeoutMs = 1500) {
  if (!hasNativeBridge()) return Promise.resolve(null);
  const state = router();
  install(state);
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      state.pending.delete(requestId);
      resolve(null);
    }, timeoutMs);
    state.pending.set(requestId, { resolve, timer });
    if (!postNative({ type, requestId, ...payload })) {
      clearTimeout(timer);
      state.pending.delete(requestId);
      resolve(null);
    }
  });
}

from pathlib import Path
p=Path('offline-interview/app.js')
s=p.read_text()
t=Path('offline-interview/test-runtime-contract.mjs')
test=t.read_text()
idx=Path('offline-interview/index.html')
html=idx.read_text()
sw=Path('offline-interview/sw.js')
sws=sw.read_text()

def once(text, old, new, label):
    if old not in text: raise SystemExit(f'missing {label}')
    if text.count(old)!=1: raise SystemExit(f'non-unique {label}: {text.count(old)}')
    return text.replace(old,new,1)

s=once(s, "const BUILD_ID = '2026-09-06.interview-runtime-v41';", "const BUILD_ID = '2026-09-06.interview-runtime-v41.1';", 'build id')
s=once(s, "let db = null;\nlet transcriber = null;", "let db = null;\nlet dbReadyPromise = null;\nlet transcriber = null;", 'db ready state')
old="""function dbGet(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
function dbPut(key, value) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function audioStore(mode = 'readonly') { return db.transaction('audio', mode).objectStore('audio'); }
function dbAudioPut(value) {
  return new Promise((resolve, reject) => {
    const req = audioStore('readwrite').put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function dbAudioGet(id) {
  return new Promise((resolve, reject) => {
    const req = audioStore().get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
function dbAudioDeleteSession(sessionId) {
  return new Promise((resolve, reject) => {
    const store = audioStore('readwrite');
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      if (cursor.value?.sessionId === sessionId) cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
"""
new="""function ensureDb() {
  if (db) return Promise.resolve(db);
  if (!dbReadyPromise) {
    dbReadyPromise = openDb().then(connection => {
      db = connection;
      db.onversionchange = () => { try { db.close(); } catch {} db = null; dbReadyPromise = null; };
      return db;
    }).catch(error => {
      dbReadyPromise = null;
      throw error;
    });
  }
  return dbReadyPromise;
}
async function dbGet(key) {
  const connection = await ensureDb();
  return new Promise((resolve, reject) => {
    const req = connection.transaction('kv', 'readonly').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(key, value) {
  const connection = await ensureDb();
  return new Promise((resolve, reject) => {
    const req = connection.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(key) {
  const connection = await ensureDb();
  return new Promise((resolve, reject) => {
    const req = connection.transaction('kv', 'readwrite').objectStore('kv').delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function audioStore(mode = 'readonly') {
  const connection = await ensureDb();
  return connection.transaction('audio', mode).objectStore('audio');
}
async function dbAudioPut(value) {
  const store = await audioStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
async function dbAudioGet(id) {
  const store = await audioStore();
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function dbAudioDeleteSession(sessionId) {
  const store = await audioStore('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve();
      if (cursor.value?.sessionId === sessionId) cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
"""
s=once(s,old,new,'storage helpers')
s=once(s,'  db = await openDb();','  await ensureDb();','init db readiness')
html=once(html,'./styles.css?v=41','./styles.css?v=41.1','css cache version')
html=once(html,'./app.js?v=41','./app.js?v=41.1','app cache version')
sws=sws.replace('v41','v41.1')
anchor="assert.match(app, /masterAudioChunks = \\[\\]/);"
if anchor not in test: raise SystemExit('missing runtime contract anchor')
test=test.replace(anchor, "assert.match(app, /let dbReadyPromise = null/);\nassert.match(app, /function ensureDb\\(\\)/);\nassert.match(app, /const connection = await ensureDb\\(\\)/);\nassert.doesNotMatch(app, /db\\.transaction\\(/);\n"+anchor,1)
test=test.replace('runtime-contract.v41','runtime-contract.v41.1')
p.write_text(s); idx.write_text(html); sw.write_text(sws); t.write_text(test)
print('V41.1 storage readiness repair applied')

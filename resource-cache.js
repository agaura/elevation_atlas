// Compressed resources on disk, not decoded float tiles. Storage is optional:
// private browsing, quota errors, and unsupported IndexedDB fall back to network.
const budget = 128 * 1024 * 1024;
let database, writable = true;
function open() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!database) database = new Promise(resolve => {
    const request = indexedDB.open('elevation-atlas-resources', 1);
    request.onupgradeneeded = () => {
      const resources = request.result.createObjectStore('resources', {keyPath: 'key'});
      resources.createIndex('used', 'used');
      request.result.createObjectStore('meta');
    };
    request.onerror = request.onblocked = () => resolve(null);
    request.onsuccess = () => {request.result.onversionchange = () => request.result.close();resolve(request.result);};
  });
  return database;
}
export async function getResource(key) {
  try {
    const db = await open();if (!db) return null;
    return await new Promise(resolve => {
      const tx = db.transaction('resources', writable ? 'readwrite' : 'readonly'), store = tx.objectStore('resources');
      const request = store.get(key);let result = null;
      request.onsuccess = () => {
        const record = request.result;
        if (record && record.expires > Date.now()) {
          result = record.value;
          if (writable && Date.now() - record.used > 30000) store.put({...record, used: Date.now()});
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => resolve(result);
    });
  } catch {return null;}
}
export async function putResource(key, value, byteLength, maxAge = 86400000) {
  if (!writable || byteLength > budget || maxAge <= 0) return;
  try {
    const db = await open();if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(['resources', 'meta'], 'readwrite');
      const store = tx.objectStore('resources'), meta = tx.objectStore('meta');
      const old = store.get(key), total = meta.get('bytes');
      let bytes;
      total.onsuccess = () => {
        bytes = (total.result || 0) - (old.result?.bytes || 0) + byteLength;
        store.put({key, value, bytes: byteLength, used: Date.now(), expires: Date.now() + maxAge});
        const cursor = store.index('used').openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (bytes > budget && current) {
            bytes -= current.value.bytes;current.delete();current.continue();
          } else meta.put(bytes, 'bytes');
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => {writable = false;resolve();};
    });
  } catch {writable = false;}
}
export function resourceLifetime(headers) {
  const policy = headers.get('cache-control') || '';
  if (/no-store|no-cache/i.test(policy)) return 0;
  const seconds = /(?:^|,)\s*max-age=(\d+)/i.exec(policy)?.[1];
  return Math.min(86400000, seconds === undefined ? 86400000 : Number(seconds) * 1000);
}

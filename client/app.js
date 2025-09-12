import { withDB, tx } from './idb.js';

const API_BASE = (localStorage.getItem('API_BASE') || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
const netEl = document.getElementById('net');
const listEl = document.getElementById('list');
const form = document.getElementById('noteForm');
const title = document.getElementById('title');
const content = document.getElementById('content');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

function setStatus(state, extra='') {
  netEl.className = 'status ' + (state || '');
  const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : state === 'syncing' ? 'Syncing…' : 'Unknown';
  netEl.textContent = `${label} ${extra}`.trim();
}

window.addEventListener('online', () => { setStatus('online'); syncNow(); });
window.addEventListener('offline', () => setStatus('offline'));

async function render() {
  const db = await withDB();
  const t = await tx(db, ['notes'], 'readonly');
  const store = t.objectStore('notes');
  const req = store.index('updated_at').getAll();
  const notes = await new Promise((res, rej) => { req.onsuccess = () => res(req.result.reverse()); req.onerror = () => rej(req.error); });
  listEl.innerHTML = '';
  notes.forEach(n => {
    const div = document.createElement('div');
    div.className = 'note';
    div.innerHTML = `<b>${n.title}</b><span class="chip">${n.status||'synced'}</span><div>${n.content}</div><div class="meta">id=${n.id} • v${n.version||0} • ${new Date(n.updated_at).toLocaleString()}</div>`;
    listEl.appendChild(div);
  });
}

async function saveLocal(note) {
  const db = await withDB();
  const t = await tx(db, ['notes'], 'readwrite');
  await new Promise((res, rej) => { const r = t.objectStore('notes').put(note); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

async function addToOutbox(job) {
  const db = await withDB();
  const t = await tx(db, ['outbox'], 'readwrite');
  await new Promise((res, rej) => { const r = t.objectStore('outbox').put(job); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

function uuid() { return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)); }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const n = {
    id: uuid(),
    title: title.value.trim(),
    content: content.value.trim(),
    updated_at: Date.now(),
    version: 0,
    status: navigator.onLine ? 'pending' : 'pending'
  };
  if (!n.title || !n.content) return;
  await saveLocal(n);
  await addToOutbox({
    uuid: uuid(),
    intent_type: 'upsert',
    entity_type: 'note',
    entity_id: n.id,
    patch: { title: n.title, content: n.content },
    base_version: 0,
    ts: Date.now(),
    retries: 0
  });
  title.value=''; content.value='';
  await render();
  if (navigator.onLine) syncNow();
});

async function getAll(storeName) {
  const db = await withDB();
  const t = await tx(db, [storeName], 'readonly');
  return await new Promise((res, rej) => {
    const r = t.objectStore(storeName).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function deleteOutboxKey(uuid) {
  const db = await withDB();
  const t = await tx(db, ['outbox'], 'readwrite');
  await new Promise((res, rej) => { const r = t.objectStore('outbox').delete(uuid); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

async function setCursor(val) {
  const db = await withDB();
  const t = await tx(db, ['meta'], 'readwrite');
  await new Promise((res, rej) => { const r = t.objectStore('meta').put({key:'cursor', value: val}); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

async function getCursor() {
  const db = await withDB();
  const t = await tx(db, ['meta'], 'readonly');
  return await new Promise((res, rej) => { const r = t.objectStore('meta').get('cursor'); r.onsuccess = () => res(r.result?.value || ''); r.onerror = () => rej(r.error); });
}

async function applyChanges(changes) {
  for (const ch of changes) {
    if (ch.type === 'note' && (ch.op === 'upsert')) {
      await saveLocal({
        id: ch.id,
        title: ch.data.title,
        content: ch.data.content,
        updated_at: Date.parse(ch.updated_at) || Date.now(),
        version: ch.version,
        status: 'synced'
      });
    }
  }
}

let syncing = false;
async function syncNow() {
  if (syncing) return;
  try {
    syncing = true; setStatus('syncing');
    const cursor = await getCursor();
    const pullRes = await fetch(`${API_BASE}/sync?cursor=${encodeURIComponent(cursor)}`);
    if (pullRes.ok) {
      const body = await pullRes.json();
      await applyChanges(body.changes || []);
      if (body.next_cursor) await setCursor(body.next_cursor);
    }
    const jobs = await getAll('outbox');
    for (const job of jobs) {
      const res = await fetch(`${API_BASE}/mutations`, {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Idempotency-Key': job.uuid
        },
        body: JSON.stringify(job)
      });
      if (res.ok) {
        const r = await res.json();
        if (r.status === 'ok' && r.entity) {
          await saveLocal({
            id: r.entity.id,
            title: r.entity.title,
            content: r.entity.content,
            updated_at: Date.parse(r.entity.updated_at) || Date.now(),
            version: r.entity.version,
            status: 'synced'
          });
          await deleteOutboxKey(job.uuid);
        } else if (r.status === 'conflict') {
          // mark as conflict locally
          const db = await withDB();
          const t = await tx(db, ['notes'], 'readwrite');
          await new Promise((res2, rej2) => { const g = t.objectStore('notes').get(job.entity_id); g.onsuccess = () => {
            const n = g.result; n.status = 'conflict'; const p = t.objectStore('notes').put(n); p.onsuccess = () => res2(); p.onerror = () => rej2(p.error);
          }; g.onerror = () => rej2(g.error); });
        }
      }
    }
  } catch (e) {
    console.error('sync error', e);
  } finally {
    syncing = false;
    setStatus(navigator.onLine ? 'online' : 'offline');
    render();
  }
}

(async () => {
  setStatus(navigator.onLine ? 'online' : 'offline', `• API: ${API_BASE}`);
  await render();
  if (navigator.onLine) syncNow();
  setInterval(() => { if (navigator.onLine) syncNow(); }, 15000);
})();
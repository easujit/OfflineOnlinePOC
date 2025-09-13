import { withDB, tx } from './idb.js';

const API_BASE = (localStorage.getItem('API_BASE') || 'http://127.0.0.1:8000/api').replace(/\/$/, '');
const netEl = document.getElementById('net');
const listEl = document.getElementById('list');
const form = document.getElementById('noteForm');
const title = document.getElementById('title');
const content = document.getElementById('content');
const fetchFromServerBtn = document.getElementById('fetchFromServer');
const refreshBtn = document.getElementById('refreshNotes');
const clearAllBtn = document.getElementById('clearAllNotes');
const notesCountEl = document.getElementById('notesCount');

// Pagination elements
const paginationInfoEl = document.getElementById('paginationInfo');
const pageSizeSelect = document.getElementById('pageSize');
const firstPageBtn = document.getElementById('firstPage');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const lastPageBtn = document.getElementById('lastPage');
const pageNumbersEl = document.getElementById('pageNumbers');

// Pagination state
let currentPage = 1;
let totalPages = 1;
let totalNotes = 0;
let pageSize = 25;
let currentNotes = [];
let paginationMode = 'local'; // 'local' or 'server'

// Tab state
let currentTab = 'create';

// Add manual sync button
const syncButton = document.createElement('button');
syncButton.textContent = '🔄 Sync Now';
syncButton.style.cssText = 'margin-left: 10px; padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;';
syncButton.addEventListener('click', () => {
  if (navigator.onLine && !syncing) {
    syncNow();
  }
});
netEl.parentNode.insertBefore(syncButton, netEl.nextSibling);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

function setStatus(state, extra='') {
  netEl.className = 'status ' + (state || '');
  const label = state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : state === 'syncing' ? 'Syncing…' : 'Unknown';
  netEl.textContent = `${label} ${extra}`.trim();
  
  // Update sync button state
  if (syncButton) {
    syncButton.disabled = state === 'offline' || state === 'syncing';
    syncButton.textContent = state === 'syncing' ? '⏳ Syncing...' : '🔄 Sync Now';
  }
  
  // Update fetch from server button state
  if (fetchFromServerBtn) {
    fetchFromServerBtn.disabled = state === 'offline' || state === 'syncing';
  }
}

window.addEventListener('online', () => { 
  setStatus('online'); 
  syncNow(); 
});
window.addEventListener('offline', () => {
  setStatus('offline');
  syncButton.disabled = true;
});

async function render() {
  // Only render if we're on the notes tab
  if (currentTab !== 'notes') return;
  
  if (paginationMode === 'server') {
    await renderServerNotes();
  } else {
    await renderLocalNotes();
  }
}

async function renderLocalNotes() {
  const db = await withDB();
  const t = await tx(db, ['notes'], 'readonly');
  const store = t.objectStore('notes');
  const req = store.index('updated_at').getAll();
  const allNotes = await new Promise((res, rej) => { req.onsuccess = () => res(req.result.reverse()); req.onerror = () => rej(req.error); });
  
  // Calculate pagination
  totalNotes = allNotes.length;
  totalPages = Math.ceil(totalNotes / pageSize);
  currentPage = Math.min(currentPage, Math.max(1, totalPages));
  
  // Get notes for current page
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  currentNotes = allNotes.slice(startIndex, endIndex);
  
  // Update pagination UI
  updatePaginationUI();
  
  // Update notes count
  updateNotesCount(allNotes);
  
  // Render notes
  renderNotesList(currentNotes);
}

async function renderServerNotes() {
  try {
    const response = await fetch(`${API_BASE}/notes?page=${currentPage}&limit=${pageSize}`);
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    currentNotes = data.notes || [];
    totalNotes = data.pagination.total_notes;
    totalPages = data.pagination.total_pages;
    currentPage = data.pagination.current_page;
    
    // Update pagination UI
    updatePaginationUI();
    
    // Update notes count
    updateNotesCount(currentNotes);
    
    // Render notes
    renderNotesList(currentNotes);
    
  } catch (error) {
    console.error('Error fetching server notes:', error);
    listEl.innerHTML = '<div class="empty-state">Error fetching notes from server. Please try again.</div>';
  }
}

function renderNotesList(notes) {
  // Clear and render notes
  listEl.innerHTML = '';
  
  if (notes.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No notes found. Create your first note above!</div>';
    return;
  }
  
  notes.forEach(n => {
    const div = document.createElement('div');
    div.className = `note ${n.status === 'conflict' ? 'conflict' : ''}`;
    const statusChip = n.status === 'conflict' ? 
      '<span class="chip conflict">⚠️ Conflict</span>' : 
      '<span class="chip">' + (n.status||'synced') + '</span>';
    
    // Enhanced note display with better formatting
    div.innerHTML = `
      <div class="note-header">
        <b>${n.title}</b>
        ${statusChip}
      </div>
      <div class="note-content">${n.content}</div>
      <div class="meta">
        <span>ID: ${n.id}</span> • 
        <span>Version: ${n.version||0}</span> • 
        <span>Updated: ${new Date(n.updated_at).toLocaleString()}</span>
      </div>
    `;
    listEl.appendChild(div);
  });
}

function updateNotesCount(notes) {
  if (!notesCountEl) return;
  
  const total = notes.length;
  const synced = notes.filter(n => n.status === 'synced' || !n.status).length;
  const pending = notes.filter(n => n.status === 'pending').length;
  const conflicts = notes.filter(n => n.status === 'conflict').length;
  
  let countText = `Total: ${total}`;
  if (synced < total) countText += ` • Synced: ${synced}`;
  if (pending > 0) countText += ` • Pending: ${pending}`;
  if (conflicts > 0) countText += ` • Conflicts: ${conflicts}`;
  
  notesCountEl.textContent = countText;
}

function updatePaginationUI() {
  if (!paginationInfoEl) return;
  
  // Update pagination info
  paginationInfoEl.textContent = `Page ${currentPage} of ${totalPages} (${totalNotes} total notes)`;
  
  // Update button states
  firstPageBtn.disabled = currentPage <= 1;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  lastPageBtn.disabled = currentPage >= totalPages;
  
  // Update page numbers
  updatePageNumbers();
}

function updatePageNumbers() {
  if (!pageNumbersEl) return;
  
  pageNumbersEl.innerHTML = '';
  
  // Calculate which page numbers to show
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  // Adjust start page if we're near the end
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }
  
  // Add page numbers
  for (let i = startPage; i <= endPage; i++) {
    const pageBtn = document.createElement('span');
    pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
    pageBtn.textContent = i;
    pageBtn.addEventListener('click', () => goToPage(i));
    pageNumbersEl.appendChild(pageBtn);
  }
}

function goToPage(page) {
  if (page < 1 || page > totalPages || page === currentPage) return;
  
  currentPage = page;
  render();
}

function goToFirstPage() {
  goToPage(1);
}

function goToPrevPage() {
  goToPage(currentPage - 1);
}

function goToNextPage() {
  goToPage(currentPage + 1);
}

function goToLastPage() {
  goToPage(totalPages);
}

function changePageSize() {
  pageSize = parseInt(pageSizeSelect.value);
  currentPage = 1; // Reset to first page
  render();
}

// Tab functionality
function switchTab(tabName) {
  // Update current tab
  currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // Update tab panels
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  // If switching to notes tab, render notes
  if (tabName === 'notes') {
    render();
  }
}

async function fetchNotesFromServer() {
  try {
    setStatus('syncing', '• Fetching from server...');
    
    // Switch to server pagination mode
    paginationMode = 'server';
    currentPage = 1;
    
    // Fetch first page from server
    await renderServerNotes();
    
    setStatus('online', '• Fetched from server successfully');
    
  } catch (error) {
    console.error('Error fetching notes from server:', error);
    setStatus('online', '• Failed to fetch from server');
    // Switch back to local mode on error
    paginationMode = 'local';
    await render();
    throw error;
  }
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
  
  // Switch to notes tab to show the new note
  switchTab('notes');
  
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
  return await new Promise((res, rej) => { 
    const r = t.objectStore('meta').get('cursor'); 
    r.onsuccess = () => {
      const cursor = r.result?.value || '';
      // If no cursor exists, return empty string to start from beginning
      res(cursor);
    }; 
    r.onerror = () => rej(r.error); 
  });
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
    console.log('Syncing with cursor:', cursor);
    const pullRes = await fetch(`${API_BASE}/sync?cursor=${encodeURIComponent(cursor)}`);
    if (pullRes.ok) {
      const body = await pullRes.json();
      console.log('Received changes:', body.changes?.length || 0);
      await applyChanges(body.changes || []);
      if (body.next_cursor) {
        await setCursor(body.next_cursor);
        console.log('Updated cursor to:', body.next_cursor);
      }
    } else {
      console.error('Sync pull failed:', pullRes.status, pullRes.statusText);
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
    setStatus(navigator.onLine ? 'online' : 'offline', '• Sync failed');
  } finally {
    syncing = false;
    setStatus(navigator.onLine ? 'online' : 'offline');
    await render();
  }
}

(async () => {
  setStatus(navigator.onLine ? 'online' : 'offline', `• API: ${API_BASE}`);
  await render();
  if (navigator.onLine) syncNow();
  // More frequent sync for better real-time collaboration
  setInterval(() => { if (navigator.onLine) syncNow(); }, 5000);
  
  // Add event listeners for new buttons
  if (fetchFromServerBtn) {
    fetchFromServerBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        alert('You need to be online to fetch notes from server.');
        return;
      }
      
      fetchFromServerBtn.disabled = true;
      fetchFromServerBtn.textContent = '⏳ Fetching...';
      try {
        await fetchNotesFromServer();
      } catch (error) {
        alert(`Failed to fetch notes from server: ${error.message}`);
      } finally {
        fetchFromServerBtn.disabled = false;
        fetchFromServerBtn.textContent = '📥 Fetch from Server';
      }
    });
  }
  
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Refreshing...';
      try {
        // Switch back to local mode
        paginationMode = 'local';
        currentPage = 1;
        await render();
        if (navigator.onLine) {
          await syncNow();
        }
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Refresh Local';
      }
    });
  }
  
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all notes? This action cannot be undone.')) {
        try {
          const db = await withDB();
          const t = await tx(db, ['notes', 'outbox', 'meta'], 'readwrite');
          
          // Clear all notes
          await new Promise((res, rej) => {
            const req = t.objectStore('notes').clear();
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          });
          
          // Clear outbox
          await new Promise((res, rej) => {
            const req = t.objectStore('outbox').clear();
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          });
          
          // Reset cursor
          await new Promise((res, rej) => {
            const req = t.objectStore('meta').delete('cursor');
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
          });
          
          await render();
          console.log('All notes cleared successfully');
        } catch (error) {
          console.error('Error clearing notes:', error);
          alert('Error clearing notes. Please try again.');
        }
      }
    });
  }
  
  // Add pagination event listeners
  if (firstPageBtn) {
    firstPageBtn.addEventListener('click', goToFirstPage);
  }
  
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', goToPrevPage);
  }
  
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', goToNextPage);
  }
  
  if (lastPageBtn) {
    lastPageBtn.addEventListener('click', goToLastPage);
  }
  
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', changePageSize);
  }
  
  // Add tab event listeners
  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      switchTab(tabName);
    });
  });
})();
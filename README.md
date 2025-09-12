# Offline/Online Capability POC — Django/DRF

This is a Django + DRF server that matches the offline-first client (PWA) behavior:
- `/api/sync?cursor=…` returns changes since a given timestamp
- `/api/mutations` accepts a single mutation with **Idempotency-Key**

## Run

### 1) Install & migrate
```bash
cd server
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 2) Serve the client (any static server)
```bash
cd ../client
python -m http.server 5173
```
Open http://127.0.0.1:5173 in your browser.

> The client talks to `http://127.0.0.1:8000/api` by default. Override via console if needed:
```js
localStorage.setItem('API_BASE','http://127.0.0.1:8000/api'); location.reload();
```

## Demo
- Online: add notes → they sync to Django DB.
- Offline (turn Wi‑Fi off): add notes → they queue locally in IndexedDB.
- Back online: auto sync pushes queued writes; idempotency avoids duplicates.
- Conflicts: If server version advanced, mutation returns `{status:'conflict'}`; the client marks the item so you can build a merge UI later.

## Code tour
- `server/offlinepoc/settings.py` — DRF + CORS setup, SQLite DB.
- `server/notes/models.py` — `Note`, `Event` (change log), `Idempotency`.
- `server/notes/views.py` — `/sync` + `/mutations` endpoints with conflict detection and idempotency.
- `client/` — PWA with Service Worker + IndexedDB outbox and a sync loop.

# Offline/Online POC
## Run

### 1) Install & migrate
```bash
cd server
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### 2) Serve the client
```bash
cd ../client
python -m http.server 5173
```
Open http://127.0.0.1:5173 in your browser.

> The client talks to `http://127.0.0.1:8000/api` by default. Override via console if needed:
```js
localStorage.setItem('API_BASE','http://127.0.0.1:8000/api'); location.reload();
```

## Quick Testing Use cases
- Online: add notes → they sync to Backend DB.
- Offline (turn Wi‑Fi off): add notes → they queue locally in IndexedDB.
- Back online: auto sync pushes queued writes; idempotency avoids duplicates.
- Conflicts: If server version advanced, mutation returns `{status:'conflict'}`; the client marks the item.

## Advantages in Hospital Case

No downtime: App still runs during WAN outage or server reboot.

No data loss: Every action goes into IndexedDB Outbox.

No duplication: Server uses Idempotency-Key.

Graceful sync: When back online, everything reconciles.

Safe conflicts: Medical orders flagged, not overwritten.

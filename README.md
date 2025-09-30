# Dooplechat

Minimal anonymous 1:1 text & video chat (Omegle-style) with ephemeral sessions.

This repository contains a React + TypeScript frontend and a Node.js + TypeScript signaling server using WebSockets. TURN is self-hosted via coturn for NAT traversal. Redis is optional for horizontal scaling.

Quick start (dev)
1. Start the backend dev server:
```bash
cd backend
npm install
npm run dev
```

2. Start the frontend dev server:
```bash
cd frontend
npm install
npm run dev
```

Frontend dev server runs on http://localhost:5173 and proxies `/ws` and `/healthz` to localhost:8080 by default.

Run full stack with Docker Compose (single-host)
1. Build and start:
```bash
docker compose up --build
```
This expects the dockerfiles under `docker/` (provided). coturn config is under `coturn/turnserver.conf` and must be edited to set `external-ip` and `static-auth-secret` or use environment variables.

Production notes
- Generate coturn long-term credentials and configure coturn with `lt-cred-mech` or `use-auth-secret`.
- Use HTTPS (letsencrypt certbot) and put nginx/ingress in front of the frontend and backend.
- For scaling the signaling server horizontally, enable Redis and set `REDIS_URL` in the backend environment. See `backend/src/redisMatchmaking.ts` for keys/patterns.

Operator guide
- To change color palette: edit `frontend/src/styles.css` variables (search for `--bg`, `--surface`, `--accent` etc.).
- To enable verbose logs: set `LOG_LEVEL=debug` in the backend env.
- Monitoring: track active WebSocket connections, queue lengths (in-memory) and Redis queue lengths when using Redis, and coturn traffic (bytes relayed).

Testing
- Backend tests: run `cd backend && npm test` (vitest).
- Frontend: no automated e2e included in this initial drop; can be added with Playwright.

Security & privacy
- No persistent PII stored. Reports are queued in memory. To persist, wire reports to an external moderation system.

Files of interest
- `backend/src` — signaling server, matchmaking logic, and Redis-backed helpers.
- `frontend/src` — React app and UI.
- `coturn/turnserver.conf` — sample coturn config.
- `docker/` — dockerfiles for building services.
# DOOPLE Chat (Anonymous 1-on-1 Text + Video)

Version: 1.0.0  
Date: September 30, 2025

## Introduction
DOOPLE Chat is a minimal, scalable Omegle/Monkey-style web app for anonymous 1-on-1 text and video chats. It prioritizes privacy (no accounts, no database) and simple operations. All sessions are ephemeral and exist only in memory or in optional Redis for horizontal scaling. WebRTC provides direct peer media paths with a TURN fallback. Signaling is handled by a small stateless Node.js TypeScript server using WebSockets.

- **Anonymous 1:1 Random Pairing**: Text and Video modes
- **Age Gate**: Self-attestation modal blocks access on "No"
- **Ephemeral**: No persistent PII or DB
- **WebRTC**: Direct P2P when possible, TURN fallback via self-hosted coturn
- **Minimal SPA**: React + TypeScript, Vite, responsive desktop-first dark UI

## Repository Structure
```
.
├── frontend/         # React + TypeScript (Vite) SPA
├── backend/          # Node.js + TypeScript signaling + matchmaking
├── coturn/           # coturn config and setup script
├── docker/           # Dockerfiles and nginx config
├── k8s/              # Kubernetes manifests (frontend, backend, Redis, Ingress)
├── tests/            # Unit, integration, and E2E tests
├── docs/             # Extra docs and ops notes
├── .env.example      # Environment variable template
├── docker-compose.yml
└── README.md
```

## Tech Stack and Decisions
- **Frontend**: React + TypeScript, Vite build
- **Backend**: Node.js + TypeScript, `ws` for WebSocket (no Socket.io), `express` for static/health
- **TURN**: Self-hosted `coturn` with long-term credentials
- **Scaling (optional)**: Redis Pub/Sub for cross-instance signaling and matchmaking
- **Containers**: Docker + docker-compose for single-host; example Kubernetes for scale

## Color Palette (UI)
- Background: `#0F1724`
- Surface: `#111827`
- Accent 1: `#FF7A59`
- Accent 2: `#6EE7B7`
- Text main: `#E6EEF2`
- Muted text: `#9AA4AD`

These are implemented as CSS variables in `frontend`.

## Environment Variables
Create a `.env` in repo root based on `.env.example`:
```
PORT=3000
NODE_ENV=development
COTURN_HOST=localhost
COTURN_USER=your_turn_username
COTURN_PASS=your_turn_password
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
```

- `PORT`: Backend HTTP/WS port (backend serves `/ws` and health)
- `COTURN_*`: TURN server host and long-term credentials
- `REDIS_URL`: Optional; enable Redis-backed scaling by setting this
- `LOG_LEVEL`: `error|warn|info|debug` (default avoids persistence by default)

## Message Schema (Signaling Protocol)
Single WebSocket endpoint: `wss://<host>/ws`

All messages are JSON with the following shapes:
```
{ "type": "join", "mode": "text" | "video", "sessionId": "<uuid>", "interests": ["music", "sports"] }
{ "type": "leave", "sessionId": "<uuid>" }
{ "type": "offer", "to": "<peerSessionId>", "sdp": "<...>" }
{ "type": "answer", "to": "<peerSessionId>", "sdp": "<...>" }
{ "type": "ice", "to": "<peerSessionId>", "candidate": "<...>" }
{ "type": "message", "to": "<peerSessionId>", "payload": { "text": "..." } }
{ "type": "next", "sessionId": "<uuid>" }
{ "type": "report", "sessionId": "<uuid>", "reason": "<...>" }
```

Backend responses include:
```
{ "type": "waiting" }
{ "type": "paired", "peerSessionId": "<uuid>", "mode": "text|video" }
{ "type": "error", "code": "<string>", "message": "<string>" }
{ "type": "reported", "ok": true }
```

## Matchmaking and Interests (Pools)
- Maintain mode-specific FIFO queues: `waiting_text`, `waiting_video`.
- Interests are lowercase; capitalization ignored by client.
- If two or more users share one or more interests, they are matched first from a per-interest pool.
- If only one user has a given interest, hold in the interest pool briefly (~1s). If no partner arrives, move to the general queue.
- On `join`:
  - Validate `sessionId` (UUIDv4) and mode.
  - Attempt interest-pool match first; else enqueue in mode queue.
- On `next` or `leave`:
  - Remove from interest/general queue or break current pair; requeue at tail.
- Redis-backed version mirrors the queues using ephemeral keys and Pub/Sub.

### Redis Keying (scaling)
- Presence: `presence:<sessionId>` → value `{mode, interests[], ts}`, TTL 30s, refreshed by heartbeat
- Queues: `queue:<mode>` → Redis List of sessionIds (for general)
- Interest sets: `interest:<mode>:<interest>` → Redis List of sessionIds
- Pub/Sub Topics:
  - `signal:<sessionId>` for directed signaling
  - `matchmaking:events` for queue ops (join/next/leave)

## WebRTC and ICE
Frontend creates `RTCPeerConnection`:
```
{
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["turn:<your-coturn-host>:3478"], username: "<coturn-user>", credential: "<coturn-pass>" }
  ]
}
```

- Prefer direct P2P; TURN used only when necessary.
- Cleanly close peer connections on Next/Leave (stop tracks, close data channel and RTCPeerConnection).
- ICE timeout: configurable (default 20s). If not connected, show UX hint to try Next.

## Security and Privacy
- No persistent DB or PII. Default logs non-persistent; enable verbose logs only when needed.
- Rate limit per IP (e.g., 30 joins/min). Tune in backend config.
- CSRF-safe WebSocket handshake: validate `Origin`/`Host`, and `sessionId` format.
- Sanitize text before rendering (escape HTML) to prevent XSS.
- Serve over HTTPS in production; see TLS notes below.

## Setup: Local Development
Prerequisites: Node.js 18+, Docker 20+, Docker Compose 1.29+, optional Redis 6+.

1) Clone and configure:
```
cp .env.example .env
# Edit .env as needed
```

2) Start all services (frontend, backend, coturn, redis):
```
docker-compose up --build
```

3) Access:
- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8080/healthz`
- WS endpoint used by frontend: `ws://localhost:8080/ws` (dev)

## Production Deployment (Single Host)
1) Build images:
```
docker-compose -f docker-compose.yml build
```

2) Run detached:
```
docker-compose up -d
```

3) HTTPS with Let’s Encrypt (example with `certbot`):
```
sudo certbot certonly --standalone --preferred-challenges http -d yourdomain.com
# Configure reverse proxy (nginx/caddy) to serve TLS and proxy /ws to backend
```

4) TURN reachability: ensure UDP 3478 and TCP 3478/5349 exposed; secure with firewall rules.

## Kubernetes Deployment (Scale)
- Deploy `k8s/` manifests: `frontend` Deployment+Service+Ingress, `backend` Deployment+Service+Ingress, `redis` StatefulSet+Service (optional), `coturn` Deployment+Service (or external).
- Use ConfigMap/Secret for `COTURN_*`, `REDIS_URL`.
- For horizontal scaling of backend, enable Redis: set `REDIS_URL` in Deployment.
- Ingress must support WebSockets and TLS.

## Rate Limiting and Abuse Controls
- Default: 30 joins/min/IP. Adjust to your traffic.
- Optional: add IP ban lists and bot filtering on reverse proxy.

## Report Pipeline (Ephemeral)
- Client `report` closes current connection.
- Server enqueues report in in-memory queue (or Redis List when enabled).
- Operator can inspect reports via temporary admin endpoint/logs (non-persistent). For production, add a persistent moderation pipeline.

## Logging and Monitoring
- `LOG_LEVEL=info` by default. For debugging set `debug` temporarily.
- Monitor:
  - Active sessions
  - Queue lengths (general and per-interest)
  - TURN bandwidth utilization
- Suggested: use container logs and simple metrics endpoints; add Prometheus/Grafana later.

## UI/UX Flows
- Landing page: buttons for "Start Text Chat" and "Start Video Chat".
- Age modal: exact text "Are you 18 years or older? Yes / No". On "No", show block screen; on "Yes", continue.
- Waiting screen: show "Waiting for partner" and large "Next".
- Text mode: messages with timestamps, buttons: Next, Report. Use DataChannel; fallback to signaling relay for text if DataChannel not available.
- Video mode: local and remote video; buttons: Mute, Toggle Camera, Next, Report; explicit "Start Video" to request permissions.
- Translatable strings via `frontend/src/i18n/en.json`.

## Interests (Matching Pools)
- User types interests and presses Enter to add; client stores lowercase tokens.
- On join, client sends `interests: string[]` with lowercase values.
- Server attempts to match within shared interests pool first.
- If only single user in an interest pool for ~1s, move them to general queue.

## Tests and QA
- Backend unit tests: matchmaking (FIFO, interests priority), message schema validation, Redis-backed queues.
- E2E test: headless browser spins two clients; negotiates SDP/ICE; verifies DataChannel or media tracks; then tears down.
- Manual QA checklist:
  - Age modal blocks on "No"
  - Two browsers can text/video connect
  - Next re-pairs FIFO
  - Interest match prioritizes shared interests
  - Fallback text relay works when DataChannel disabled
  - ICE timeout UX

## Operating DOOPLE Chat
- Low scale: single backend + coturn on same host is fine.
- Higher scale: multiple backend replicas + Redis; ensure sticky sessions at LB if Redis disabled.
- TURN is primary ongoing cost; P2P avoids TURN traffic but restrictive NATs force relay.
- Rotate coturn credentials periodically (update Secrets/ConfigMap and roll restart).

## Enabling Redis-Backed Scaling
- Set `REDIS_URL` in `.env` or K8s Deployment to enable Redis code paths.
- Backend will publish signaling via `signal:<sessionId>` and operate queues in Redis lists.
- Health-check Redis connectivity in backend logs.

## Provisioning coturn
1) Install container or package (docker recommended).
2) Minimal config example (`coturn/turnserver.conf`):
```
listening-port=3478
fingerprint
lt-cred-mech
realm=doople.local
user=your_turn_username:your_turn_password
no-stdout-log
simple-log
```
3) Run with docker-compose service `coturn` or standalone.
4) Network: open UDP/TCP 3478; optionally TCP/UDP 5349 for TLS.
5) Replace `your_turn_username` and `your_turn_password`. For K8s, store in Secret and mount.

## Verbose Logs
- Temporarily set `LOG_LEVEL=debug` and restart backend. Avoid long-term verbose logs to preserve privacy.

## Commands Summary
- Start local stack: `docker-compose up --build`
- Run backend unit tests: `npm test` in `backend/`
- Run frontend unit tests: `npm test` in `frontend/`
- Run E2E: `npm run test:e2e` in repo root (after stack is up)

## Acceptance Criteria (Recap)
- Two local browsers can connect; video works via STUN/TURN
- FIFO matchmaking and interest-pool priority
- Age modal blocks on "No"
- No persistent DB; state in memory or Redis
- One-command local start with docker-compose

## Roadmap to Implementation
- Backend
  - WebSocket server (`/ws`) with zod-validated schema
  - In-memory queues + interest pools; Redis alternative
  - Rate limiter, CSRF-safe handshake, UUID validation
  - Health endpoints and ephemeral report buffer
- Frontend
  - SPA with landing, age modal, text/video UIs
  - WebRTC setup with ICE servers from env
  - DataChannel text + relay fallback
  - Reconnect with exponential backoff

## License and Notices
- For demo/education. Operators must provide their own moderation and comply with law. No guarantees.

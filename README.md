# wackraces

**Wacky Races Live Tracker** — real-time GPS tracking platform for race events.

## Structure

```
├── api/            # REST API + WebSocket gateway (Node.js / TypeScript / Fastify)
├── processor/      # Location processor worker (Redis consumer)
├── web/            # React + Vite PWA frontend
├── nginx/          # Nginx reverse-proxy config
├── agents/         # Four cooperative agents (build · ops · debug · orchestrator)
├── docker-compose.yml
└── .env.example
```

## Quick start (Docker — recommended)

```bash
cp .env.example .env
# Edit .env — change JWT_SECRET, JWT_REFRESH_SECRET to strong random values
docker compose up --build
```

The app will be available at **http://localhost:80** (nginx reverse proxy).

- Frontend: http://localhost:80/
- API: http://localhost:80/v1/
- Direct API (dev): http://localhost:3000/v1/

## API service (local dev)

```bash
cd api
npm install
npm run migrate   # run DB migrations
npm run dev       # start dev server on :3000
npm test          # run tests
```

## Frontend (local dev)

```bash
cd web
npm install
npm run dev       # Vite dev server on :5173 (proxies /api → localhost:3000)
npm run build     # Production build
npm run typecheck # TypeScript check
```

Set `VITE_DEFAULT_EVENT_ID` in your `.env` (or shell) to the UUID of an event you've created via the API — the live map will then track cars in that event.

## Processor (local dev)

```bash
cd processor
npm install
npm run dev
```

## API overview

Base URL: `http://localhost:3000/v1`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/register | — | Register user |
| POST | /auth/login | — | Login, get JWT |
| POST | /auth/refresh | — | Refresh access token |
| GET | /events/:slug | — | Get event by slug |
| GET | /events/:eventId/stages | — | List stages + checkpoints |
| GET | /events/:eventId/cars | — | Cars with sanitised positions |
| GET | /events/:eventId/feed | — | Paginated approved posts |
| POST | /cars/:carId/follow | JWT | Follow car |
| DELETE | /cars/:carId/follow | JWT | Unfollow car |
| POST | /location/pings/batch | JWT (PARTICIPANT+) | Upload GPS batch |
| PATCH | /cars/:carId/sharing | JWT (car member) | Update sharing mode |
| POST | /cars/:carId/posts | JWT (car member) | Create post |
| POST | /posts/:postId/reactions | JWT | Add reaction |
| DELETE | /posts/:postId/reactions/:type | JWT | Remove reaction |
| POST | /media/presign | JWT | Get presigned upload URL |
| GET | /ops/events/:id/map | JWT (ORGANIZER+) | Precise car positions |
| GET | /ops/events/:id/posts | JWT (ORGANIZER+) | Moderation queue |
| PATCH | /ops/posts/:id | JWT (ORGANIZER+) | Moderate post |
| POST | /ops/events/:id/broadcasts | JWT (ORGANIZER+) | Create broadcast |
| POST | /ops/cars/:id/checkpoint | JWT (ORGANIZER+) | Manual checkpoint |
| PATCH | /ops/cars/:id | JWT (ORGANIZER+) | Car override |
| POST | /events | JWT (ORGANIZER+) | Create event |
| PATCH | /events/:id | JWT (ORGANIZER+) | Update event |
| POST | /events/:id/stages | JWT (ORGANIZER+) | Create stage |
| POST | /stages/:id/checkpoints | JWT (ORGANIZER+) | Create checkpoint |
| POST | /events/:id/cars | JWT (ORGANIZER+) | Add car to event |
| GET | /v1/ws | WS | Real-time updates |

## WebSocket

Connect to `ws://localhost:3000/v1/ws` and send:

```json
{ "type": "SUBSCRIBE", "channels": ["public:event:<eventId>"] }
```

Organizers can additionally subscribe to `ops:event:<eventId>` channels.

## Privacy

Public location data is automatically sanitised:
- **Delay**: configurable per event (default 10 minutes)
- **Blur**: random jitter within configured radius (default ~400 m)
- **Precision**: rounded to 3 decimal places
- **PAUSED / CITY_ONLY**: no coordinates exposed

## Roles

| Role | Capabilities |
|------|-------------|
| FAN | Read public data, follow cars, react |
| PARTICIPANT | Upload pings, manage own car posts/sharing |
| ORGANIZER | Full admin: events, stages, checkpoints, moderation |
| SUPERADMIN | Platform-level ops |

---

## Agent System

The `agents/` directory contains four cooperative agents that run as a single
Docker service (`agents`) alongside the rest of the stack. Together they can
**build the application, monitor its health, and auto-debug failures**.

### Architecture

```
┌─────────────────────────────────────────┐
│              Orchestrator               │  ← coordinates all agents
│  HTTP status dashboard: :4000/status    │    heartbeat every 15 s
└────────┬──────────┬────────────┬────────┘
         │          │            │
   COMMAND       COMMAND      COMMAND
         │          │            │
  ┌──────▼──┐  ┌────▼───┐  ┌────▼────┐
  │  Build  │  │  Ops   │  │  Debug  │
  │  Agent  │  │  Agent │  │  Agent  │
  └─────────┘  └────────┘  └─────────┘
```

All agents communicate through a shared in-process **EventEmitter bus**.
When Redis is reachable the bus is also bridged to **Redis Pub/Sub** so that
agents running in separate containers can exchange messages.

### The four agents

| Agent | Role |
|-------|------|
| **Orchestrator** | Sends heartbeats, routes messages, reacts to events from the other agents, exposes a JSON status dashboard at `:4000/status` |
| **Build** | Compiles TypeScript (`npm run build`) and runs tests (`npm test`) on demand; also watches `src/` directories and auto-rebuilds after changes |
| **Ops** | Polls API `/health`, Redis `PING`, and PostgreSQL `SELECT 1` every 30 s; sends `ALERT` to the Orchestrator whenever a service transitions from healthy → unhealthy |
| **Debug** | On `ALERT`, collects service logs (Docker or local files), runs pattern-matching heuristics against ~14 known failure signatures, and produces a `DebugReport` with severity-ranked issues and suggested remediations |

### Cooperative workflow

```
Ops Agent detects API is DOWN
  → sends ALERT to Orchestrator
    → Orchestrator commands Debug Agent: ANALYZE_LOGS api
      → Debug Agent collects logs, detects "Cannot find module" (MODULE_NOT_FOUND)
        → sends DEBUG_REPORT to Orchestrator
          → Orchestrator sees build-related issue
            → commands Build Agent: BUILD api
              → Build Agent rebuilds, sends BUILD_RESULT (success=true)
                → Orchestrator commands Ops Agent: CHECK_HEALTH
                  → Ops Agent verifies recovery
```

### Running agents locally

```bash
cd agents
npm install
npm run dev    # ts-node, auto-restarts on changes
# or
npm run build && npm start
```

The agents will read the shared `.env` from the repository root.

### Running with Docker

`docker compose up` automatically starts the `agents` service. The status
dashboard is available at **http://localhost:4000/status**.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTS_API_BASE_URL` | `http://localhost:3000` | API URL used for health checks |
| `AGENTS_USE_DOCKER` | `false` | Set to `true` to collect logs via `docker compose logs` |
| `AGENTS_STATUS_PORT` | `4000` | Port for the Orchestrator status dashboard |
| `AGENTS_OPS_INTERVAL_MS` | `30000` | Health check polling interval (ms) |
| `AGENTS_HEARTBEAT_INTERVAL_MS` | `15000` | Heartbeat interval (ms) |
| `AGENTS_HEARTBEAT_TIMEOUT_SEC` | `60` | Seconds before an agent is considered dead |

All Redis / PostgreSQL connection variables (`REDIS_HOST`, `REDIS_PORT`,
`DATABASE_URL`, etc.) are shared with the other services via `.env`.


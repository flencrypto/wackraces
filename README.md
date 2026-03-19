# wackraces

**Wacky Races Live Tracker** — real-time GPS tracking platform for race events.

## Structure

```
├── api/            # REST API + WebSocket gateway (Node.js / TypeScript / Fastify)
├── processor/      # Location processor worker (Redis consumer)
├── docker-compose.yml
└── .env.example
```

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up
```

## API service (local dev)

```bash
cd api
npm install
npm run migrate   # run DB migrations
npm run dev       # start dev server on :3000
npm test          # run tests
```

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

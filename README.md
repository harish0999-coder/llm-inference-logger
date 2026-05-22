# InferLog — LLM Inference Logging & Ingestion System

A production-grade system for chatting with LLMs while capturing every inference call's metadata — latency, token usage, errors, PII-redacted previews — and surfacing it in real-time dashboards.

---

## Demo

| Screen | Description |
|---|---|
| Conversations | List, resume, cancel conversations |
| Chat | Multi-turn streaming chat with any provider |
| Dashboard | Live latency, throughput, error-rate charts |
| Logs | Full paginated inference log table |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Conversations│  │  Chat (SSE)  │  │ Dashboard / Logs     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼────────────────┼──────────────────────┼──────────────┘
          │ REST            │ EventSource (SSE)    │ REST
          ▼                 ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express Backend (Node 20 + TypeScript)                         │
│                                                                 │
│  POST /api/conversations           — create/list/cancel        │
│  POST /api/chat/:id/stream         — SSE streaming chat        │
│  POST /api/ingest/log              — external SDK ingest       │
│  POST /api/ingest/batch            — batch ingest              │
│  GET  /api/analytics/overview      — dashboard metrics         │
│  GET  /api/analytics/timeseries    — time-series data          │
│  GET  /api/analytics/logs          — paginated log table       │
│                                                                 │
│  ┌──────────────┐   ┌─────────────────────────────────────┐    │
│  │  LLM Service │   │   Ingestion Pipeline                │    │
│  │  (multi-     │   │   ● Zod validation                  │    │
│  │  provider    │   │   ● PII redaction on previews       │    │
│  │  streaming)  │   │   ● Idempotency (requestId)         │    │
│  └──────┬───────┘   └──────────────────┬────────────────── ┘   │
│         │                              │                        │
│         └──────────────┬───────────────┘                        │
│                        ▼                                        │
│              ┌──────────────────┐                               │
│              │  Prisma ORM      │                               │
│              └────────┬─────────┘                               │
└───────────────────────┼─────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
    ┌──────────┐  ┌──────────┐  ┌─────────┐
    │PostgreSQL│  │  Redis   │  │ LLM APIs│
    │(primary  │  │(pub/sub  │  │Anthropic│
    │ store)   │  │+ queue)  │  │OpenAI   │
    └──────────┘  └──────────┘  │Gemini   │
                                └─────────┘
```

### Ingestion Flow

1. **Internal path** (built-in chatbot): LLM call → `streamChat()` → SSE chunks to browser → on `done`, write `InferenceLog` row → publish Redis event.
2. **External SDK path**: Third-party app wraps LLM call with `LLMLogger.wrap()` → SDK buffers locally → flushes to `POST /api/ingest/batch` every 2 s or 10 logs, whichever comes first → backend validates (Zod), redacts PII previews, deduplicates by `requestId`, writes to DB.

### Logging Strategy

- **Synchronous write** after each streaming response completes — latency is already measured at that point.
- **Idempotent ingestion** — `requestId` (UUID v4, client-generated) is the natural deduplication key. Re-sends are safe.
- **PII redaction** applied to all `inputPreview` / `outputPreview` fields before storage. Full message content is stored separately (in `Message`) for conversation continuity; apply full redaction pipeline there in production.
- **Redis pub/sub** emits events after each log write, enabling WebSocket-based real-time dashboards without polling.

---

## Schema Design

```sql
Conversation   -- one per chat session
  id, title, provider, model, status (ACTIVE | CANCELLED | COMPLETED)

Message        -- append-only, ordered by createdAt
  id, conversationId, role (user | assistant), content, contentPreview

InferenceLog   -- one per LLM API call
  id, conversationId, requestId (unique, idempotency key)
  provider, model, status (SUCCESS | ERROR | CANCELLED | TIMEOUT)
  latencyMs, inputTokens, outputTokens, totalTokens
  requestedAt, respondedAt
  inputPreview, outputPreview  (max 250 chars, PII-redacted)
  errorCode, errorMessage
  metadata (JSONB — extensible)
```

### Design Decisions

| Decision | Rationale |
|---|---|
| Separate `Message` and `InferenceLog` | Messages are immutable conversation history; logs are operational metadata. Different access patterns (conversation replay vs. analytics aggregations). |
| `requestId` as idempotency key | SDK can retry safely on network failures without double-counting. |
| `contentPreview` VARCHAR(250) | Bounded, never unbounded text in hot analytics paths. |
| `metadata` JSONB | Future-proofing — provider-specific fields (finish reason, stop sequence, etc.) without migrations. |
| Integer micro-cents for cost | Avoids floating-point errors in financial aggregations. |
| Indexes on `requestedAt`, `provider`, `status` | Covers the analytics query patterns (time-range scans, provider breakdowns, error filtering). |

---

## Setup Instructions

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local dev)
- API key(s): Anthropic, OpenAI, and/or Gemini

### One-Command Docker Setup

```bash
git clone https://github.com/your-username/llm-inference-logger
cd llm-inference-logger

cp .env.example .env
# Edit .env and add your API keys

docker compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Health: http://localhost:3001/health

### Local Development

```bash
# 1. Start infrastructure
docker compose up postgres redis -d

# 2. Backend
cd backend
cp .env.example .env   # add your keys
npm install
npm run db:push        # create tables
npm run dev            # http://localhost:3001

# 3. Frontend
cd ../frontend
npm install
npm run dev            # http://localhost:3000
```

### Environment Variables

```bash
# backend/.env
DATABASE_URL=postgresql://llmlogger:llmlogger_secret@localhost:5432/llm_inference
REDIS_URL=redis://localhost:6379
PORT=3001
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...
```

---

## Using the External SDK

```typescript
import { LLMLogger } from './sdk/src';
import OpenAI from 'openai';

const logger = new LLMLogger({
  ingestUrl: 'http://localhost:3001/api/ingest',
  provider: 'OPENAI',
  model: 'gpt-4o',
  redactPII: true,
});

const openai = new OpenAI();
const conversationId = 'your-conversation-uuid';

// Wrap any LLM call
const result = await logger.wrap(
  conversationId,
  () => openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Hello!' }],
  }),
  {
    inputText: 'Hello!',
    extractOutput: (r) => r.choices[0]?.message?.content || '',
  }
);

// Flush remaining buffer before process exit
await logger.flush();
```

---

## Tradeoffs Made

| Area | Choice | Tradeoff |
|---|---|---|
| **Database** | PostgreSQL | Relational integrity + JSONB for flexibility. Would shard or use TimescaleDB at high volume. |
| **ORM** | Prisma | Great DX, typed queries. Slightly less flexible for complex raw SQL aggregations — mitigated with `$queryRaw`. |
| **Streaming** | SSE | Simpler than WebSockets for one-directional server→client streaming. No bidirectional needed here. |
| **Redis** | Optional (graceful degrade) | If Redis is down, logs still write to DB synchronously. Events are lost but core functionality works. |
| **PII redaction** | Regex-based on previews | Fast, zero-dependency. Production systems should use Presidio, AWS Comprehend, or Azure PII detection on the full content. |
| **Cost tracking** | Not implemented | Pricing changes frequently. Stored token counts let you compute cost on read with current pricing. |
| **Auth** | None | Out of scope for this assignment. Add JWT + API key middleware before production. |

---

## What I'd Improve With More Time

1. **Authentication** — JWT for UI, API key auth for SDK ingest endpoint with per-key rate limiting.
2. **Full PII pipeline** — Run Microsoft Presidio on `Message.content` at write time, not just previews.
3. **TimescaleDB or ClickHouse** — For >1M logs/day, replace PostgreSQL with a columnar store purpose-built for time-series analytics.
4. **WebSocket real-time dashboard** — Replace polling with Redis pub/sub → WebSocket push for live metric updates.
5. **Cost estimation** — Maintain a pricing table per (provider, model) and compute estimated cost at ingest time.
6. **Kubernetes manifests** — HPA on the backend deployment, PodDisruptionBudget, proper secrets via Vault or AWS Secrets Manager.
7. **SDK npm package** — Publish `@inferlog/sdk` with proper TypeScript types, retry with exponential backoff, and a `beforeSend` hook for custom transforms.
8. **Alerting** — Prometheus metrics endpoint on the backend + Grafana dashboard + PagerDuty alerts on error-rate spikes.
9. **Conversation search** — Full-text search on message content (pg_trgm or Meilisearch) for finding past chats.
10. **Multi-tenant** — Workspace/org isolation with row-level security in PostgreSQL.

---

## Scaling Considerations

- **Ingestion bottleneck**: The `POST /api/ingest/batch` endpoint can be decoupled from DB writes by pushing to a Kafka topic and having a consumer pool write to the DB. This allows the API to ack quickly and absorb traffic spikes.
- **Read scalability**: Analytics queries can be routed to a read replica. Materialized views on `InferenceLog` for hourly rollups eliminate expensive full-table scans.
- **SDK reliability**: The SDK buffers in memory and retries on flush failure. In high-reliability contexts, replace with a local SQLite write-ahead log so logs survive process crashes.
- **Horizontal scaling**: The Express backend is stateless (no in-memory session). Multiple replicas behind a load balancer work without coordination.

---

## Failure Handling Assumptions

- **DB unavailable at startup**: Backend logs a warning and continues — requests will fail with 503. Implement retry with backoff for production.
- **Redis unavailable**: All operations degrade gracefully. Event publishing silently fails; core chat and logging still work.
- **LLM API error**: Error is caught, an `InferenceLog` row with `status=ERROR` is written, and the SSE stream sends `{"type":"error"}` to the client.
- **SSE client disconnect**: The streaming generator continues until complete (to capture the full log), but the write to `res` is abandoned. For cost-sensitive workloads, use `req.on('close')` to abort the in-flight LLM call.
- **Duplicate SDK submissions**: `requestId` unique constraint on `InferenceLog` ensures exactly-once storage. Duplicate inserts return 200 with the existing log ID.

---

## Bonus Features Implemented

- ✅ **Multi-provider support** — Anthropic, OpenAI, Gemini with unified interface
- ✅ **Streaming responses** — SSE from backend to browser, token-by-token
- ✅ **Latency + Throughput + Error dashboards** — Recharts with time-series, histogram, pie breakdown
- ✅ **Docker Compose one-command setup** — `docker compose up --build`
- ✅ **PII redaction** — Regex pipeline on all stored previews

### Not Implemented (would add with more time)
- ⬜ Event-based architecture (Kafka/SQS)
- ⬜ Kubernetes manifests

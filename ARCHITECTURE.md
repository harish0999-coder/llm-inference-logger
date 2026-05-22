# Architecture Notes — InferLog

## 1. Ingestion Flow

```
External SDK                  InferLog Backend              PostgreSQL
────────────                  ────────────────              ──────────
LLMLogger.wrap(fn)
  → fn() runs (LLM call)
  → capture latency/tokens
  → enqueue to buffer
  → if buffer full / timer fires:
      POST /api/ingest/batch  →  Zod validation
                                 PII redaction on previews
                                 requestId dedup check
                                 INSERT InferenceLog   →   persisted
                              ←  { id, status }
  ← flush complete

Internal chatbot (SSE path):
  POST /api/chat/:id/stream
    → fetch Conversation + last 20 Messages
    → call provider SDK (Anthropic/OpenAI/Gemini) with streaming
    → for each token delta: res.write("data: {delta}\n\n")
    → on stream complete:
        INSERT Message (assistant)
        INSERT InferenceLog (latency, tokens, previews)
        Redis PUBLISH inference:events
    → res.write("data: {done}\n\n")
    → res.end()
```

**Near-real-time guarantee**: logs are written within milliseconds of the LLM responding. The SSE `done` event carries the `InferenceLog` id so the UI can correlate immediately.

---

## 2. Logging Strategy

| What is logged | Where | How |
|---|---|---|
| Full message content | `Message.content` | Stored verbatim for conversation replay |
| Message preview | `Message.contentPreview` | First 200 chars, PII-redacted |
| Request timing | `InferenceLog.requestedAt / respondedAt` | Timestamps captured before/after LLM call |
| Latency | `InferenceLog.latencyMs` | `respondedAt - requestedAt` in integer ms |
| Token usage | `InferenceLog.inputTokens / outputTokens` | Extracted from provider response |
| Input/output previews | `InferenceLog.inputPreview / outputPreview` | 200-char truncated, PII-redacted |
| Errors | `InferenceLog.errorCode / errorMessage` | Caught exceptions serialized to VARCHAR(500) |
| Provider metadata | `InferenceLog.metadata` (JSONB) | Extensible catch-all for stop reasons, etc. |

**PII Redaction pipeline** (applied to all previews at write time):
- Email addresses → `[EMAIL]`
- Phone numbers → `[PHONE]`
- SSNs → `[SSN]`
- IP addresses → `[IP]`
- Long alphanumeric tokens/API keys → `[TOKEN]`

In production: replace regex pipeline with Microsoft Presidio or AWS Comprehend for higher recall.

**Idempotency**: every log entry carries a `requestId` (UUID v4, client-generated). The DB has a `UNIQUE` constraint on this column. Duplicate submissions return the existing record — safe for SDK retries.

---

## 3. Scaling Considerations

### Current Architecture (suitable up to ~100k logs/day)

```
Browser ──► Nginx ──► Express (single instance) ──► PostgreSQL (single)
                                                 ──► Redis (pub/sub)
```

### Scaling to 1M+ logs/day

**Step 1 — Horizontal Express replicas** (stateless by design):
```
Browser ──► Nginx (load balancer) ──► Express × N ──► PostgreSQL (primary)
                                                   ──► Redis Cluster
```
Express is fully stateless (no in-memory session, no local cache), so N replicas behind a load balancer work without coordination.

**Step 2 — Decouple ingestion from DB writes**:
```
POST /api/ingest → Kafka topic "inference.logs" → Consumer pool → PostgreSQL
```
This allows the API to ack in <5ms regardless of DB pressure, absorbing traffic spikes. Dead-letter queue for failed writes.

**Step 3 — Analytics on a separate store**:
- Migrate `InferenceLog` to **TimescaleDB** or **ClickHouse** — columnar, time-series-optimised.
- Keep `Conversation` and `Message` in PostgreSQL (relational queries).
- Dual-write during migration; cut over when analytics queries hit SLA.

**Step 4 — Read replicas for dashboards**:
- Route all `GET /api/analytics/*` to a read replica.
- Materialised views for hourly rollups, refreshed every 5 minutes.

### SDK reliability at scale

Current SDK: in-memory buffer + timer flush + single retry.

For high-reliability: replace buffer with **local SQLite WAL** — logs survive process crashes. Retry with exponential backoff + jitter. Emit a Prometheus counter for `infer_log_drop_total` when flush fails after N retries.

---

## 4. Failure Handling Assumptions

| Failure | Current behaviour | Production improvement |
|---|---|---|
| **PostgreSQL down at startup** | Logs warning, server starts; all DB ops return 503 | Retry loop with backoff; liveness probe fails → Kubernetes restarts pod |
| **PostgreSQL down mid-request** | Prisma throws; caught by try/catch; 500 returned | Circuit breaker (opossum); cache reads in Redis for dashboards |
| **Redis down** | `publishEvent()` swallows error silently | Already graceful; add `REDIS_UNAVAILABLE` counter metric |
| **LLM provider error** | `InferenceLog` written with `status=ERROR`; SSE sends `{type:"error"}` | Alert if error rate > 5% over 5 minutes |
| **Client disconnects mid-stream** | Stream generator runs to completion (full log captured) | Use `req.on('close')` to abort in-flight call for cost control |
| **SDK flush fails (network)** | Single retry; logs dropped on second failure | SQLite WAL + exponential backoff; emit drop metric |
| **Duplicate SDK submission** | DB unique constraint rejects; returns 200 + existing id | Already handled correctly |
| **Malformed ingest payload** | Zod validation returns 400 with field-level errors | Rate-limit malformed requests per IP |
| **OOM on large responses** | Streamed — never fully buffered in memory | Enforce `max_tokens` cap per request |

---

## 5. Key Design Decisions (Summary)

1. **SSE over WebSockets** for streaming: one-directional, HTTP/1.1 compatible, no handshake overhead. WebSockets add complexity without benefit for this use-case.

2. **Prisma over raw SQL** for primary operations: type safety, migration tooling, readable queries. Raw SQL (`$queryRaw`) used only for analytics aggregations where Prisma's query builder is insufficient (CASE, DATE_TRUNC, CTEs).

3. **`requestId` as deduplication key** rather than server-generated: allows the SDK to be the source of truth for idempotency, enabling safe retries before the log reaches the DB.

4. **Separate `Message` and `InferenceLog` tables**: different access patterns (conversation replay reads all messages ordered; analytics aggregates logs by time/provider/status), different retention policies (messages forever, logs could be sampled/archived after 90 days), different write paths (messages via chat route only; logs via both chat route and ingest API).

5. **Redis as optional layer**: the system degrades gracefully without it. Core persistence and chat work with only PostgreSQL. Redis adds real-time event propagation for dashboards and a fast dequeue buffer for write smoothing — both nice-to-haves, not requirements.

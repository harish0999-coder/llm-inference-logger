import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { conversationsRouter } from "./routes/conversations";
import { chatRouter } from "./routes/chat";
import { ingestRouter } from "./routes/ingest";
import { analyticsRouter } from "./routes/analytics";
import { prisma } from "./utils/prisma";

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-SDK-Version"],
  })
);

// ── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// ── Body Parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api/conversations", conversationsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/analytics", analyticsRouter);

// ── Health Check ──────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "unhealthy", timestamp: new Date().toISOString() });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global Error Handler ──────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    console.log("[DB] Connected to PostgreSQL");
  } catch (err) {
    console.warn("[DB] Could not connect to PostgreSQL:", (err as Error).message);
  }

  app.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

start();

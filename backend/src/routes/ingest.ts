import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { makePreview } from "../utils/pii";

export const ingestRouter = Router();

// Schema for incoming SDK log payloads
const IngestLogSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid(),
  provider: z.enum(["ANTHROPIC", "OPENAI", "GEMINI"]),
  model: z.string(),
  status: z.enum(["SUCCESS", "ERROR", "CANCELLED", "TIMEOUT"]),
  latencyMs: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  requestedAt: z.string().datetime(),
  respondedAt: z.string().datetime().optional(),
  inputPreview: z.string().max(250).optional(),
  outputPreview: z.string().max(250).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /api/ingest/log
 * External SDK pushes inference logs here in near real-time.
 * Validates, redacts PII from previews, and persists.
 */
ingestRouter.post("/log", async (req: Request, res: Response) => {
  try {
    const body = IngestLogSchema.parse(req.body);

    // Validate conversation exists
    const conversation = await prisma.conversation.findUnique({
      where: { id: body.conversationId },
    });

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    // Idempotency: skip if requestId already logged
    const existing = await prisma.inferenceLog.findUnique({
      where: { requestId: body.requestId },
    });
    if (existing) {
      res.status(200).json({ message: "Already logged", id: existing.id });
      return;
    }

    const log = await prisma.inferenceLog.create({
      data: {
        conversationId: body.conversationId,
        requestId: body.requestId,
        provider: body.provider,
        model: body.model,
        status: body.status,
        latencyMs: body.latencyMs,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        totalTokens:
          body.inputTokens != null && body.outputTokens != null
            ? body.inputTokens + body.outputTokens
            : undefined,
        requestedAt: new Date(body.requestedAt),
        respondedAt: body.respondedAt ? new Date(body.respondedAt) : undefined,
        // Redact PII from external previews
        inputPreview: body.inputPreview
          ? makePreview(body.inputPreview)
          : undefined,
        outputPreview: body.outputPreview
          ? makePreview(body.outputPreview)
          : undefined,
        errorCode: body.errorCode,
        errorMessage: body.errorMessage,
        metadata: body.metadata,
      },
    });

    res.status(201).json({ id: log.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    console.error("[Ingest] Error:", err);
    res.status(500).json({ error: "Ingestion failed" });
  }
});

/**
 * POST /api/ingest/batch
 * Batch ingestion endpoint for SDK buffering / retry scenarios.
 */
ingestRouter.post("/batch", async (req: Request, res: Response) => {
  try {
    const { logs } = z.object({ logs: z.array(IngestLogSchema).max(100) }).parse(req.body);
    const results: Array<{ requestId: string; status: string; id?: string }> = [];

    for (const log of logs) {
      try {
        const existing = await prisma.inferenceLog.findUnique({
          where: { requestId: log.requestId },
        });
        if (existing) {
          results.push({ requestId: log.requestId, status: "duplicate", id: existing.id });
          continue;
        }

        const created = await prisma.inferenceLog.create({
          data: {
            conversationId: log.conversationId,
            requestId: log.requestId,
            provider: log.provider,
            model: log.model,
            status: log.status,
            latencyMs: log.latencyMs,
            inputTokens: log.inputTokens,
            outputTokens: log.outputTokens,
            totalTokens:
              log.inputTokens != null && log.outputTokens != null
                ? log.inputTokens + log.outputTokens
                : undefined,
            requestedAt: new Date(log.requestedAt),
            respondedAt: log.respondedAt ? new Date(log.respondedAt) : undefined,
            inputPreview: log.inputPreview ? makePreview(log.inputPreview) : undefined,
            outputPreview: log.outputPreview ? makePreview(log.outputPreview) : undefined,
            errorCode: log.errorCode,
            errorMessage: log.errorMessage,
            metadata: log.metadata,
          },
        });
        results.push({ requestId: log.requestId, status: "created", id: created.id });
      } catch {
        results.push({ requestId: log.requestId, status: "error" });
      }
    }

    res.json({ results });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "Validation failed", details: err.errors });
      return;
    }
    res.status(500).json({ error: "Batch ingestion failed" });
  }
});

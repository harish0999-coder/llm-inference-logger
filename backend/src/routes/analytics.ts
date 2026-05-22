import { Router, Request, Response } from "express";
import { prisma } from "../utils/prisma";

export const analyticsRouter = Router();

analyticsRouter.get("/overview", async (_req: Request, res: Response) => {
  try {
    const [
      totalConversations,
      totalMessages,
      totalLogs,
      avgLatency,
      errorCount,
      tokenStats,
      providerBreakdown,
      recentLogs,
      latencyBuckets,
    ] = await Promise.all([
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.inferenceLog.count(),
      prisma.inferenceLog.aggregate({
        _avg: { latencyMs: true },
        where: { status: "SUCCESS" },
      }),
      prisma.inferenceLog.count({ where: { status: "ERROR" } }),
      prisma.inferenceLog.aggregate({
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      prisma.inferenceLog.groupBy({
        by: ["provider"],
        _count: { _all: true },
        _avg: { latencyMs: true },
        orderBy: { _count: { provider: "desc" } },
      }),
      prisma.inferenceLog.findMany({
        orderBy: { requestedAt: "desc" },
        take: 20,
        select: {
          id: true,
          provider: true,
          model: true,
          status: true,
          latencyMs: true,
          inputTokens: true,
          outputTokens: true,
          requestedAt: true,
          errorCode: true,
        },
      }),
      // Latency histogram buckets
      prisma.$queryRaw<Array<{ bucket: string; count: bigint }>>`
        SELECT
          CASE
            WHEN "latencyMs" < 500 THEN '<500ms'
            WHEN "latencyMs" < 1000 THEN '500ms-1s'
            WHEN "latencyMs" < 2000 THEN '1s-2s'
            WHEN "latencyMs" < 5000 THEN '2s-5s'
            ELSE '>5s'
          END as bucket,
          COUNT(*) as count
        FROM "InferenceLog"
        WHERE status = 'SUCCESS' AND "latencyMs" IS NOT NULL
        GROUP BY bucket
        ORDER BY MIN("latencyMs")
      `,
    ]);

    const errorRate =
      totalLogs > 0 ? ((errorCount / totalLogs) * 100).toFixed(2) : "0.00";

    res.json({
      overview: {
        totalConversations,
        totalMessages,
        totalInferenceCalls: totalLogs,
        avgLatencyMs: Math.round(avgLatency._avg.latencyMs || 0),
        errorCount,
        errorRate: parseFloat(errorRate),
        totalTokensUsed: tokenStats._sum.totalTokens || 0,
        totalInputTokens: tokenStats._sum.inputTokens || 0,
        totalOutputTokens: tokenStats._sum.outputTokens || 0,
      },
      providerBreakdown: providerBreakdown.map((p: { provider: string; _count: { _all: number }; _avg: { latencyMs: number | null } }) => ({
        provider: p.provider,
        count: p._count._all,
        avgLatencyMs: Math.round(p._avg.latencyMs || 0),
      })),
      recentLogs,
      latencyBuckets: latencyBuckets.map((b: { bucket: string; count: bigint }) => ({
        bucket: b.bucket,
        count: Number(b.count),
      })),
    });
  } catch (err) {
    console.error("[Analytics] Error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Time series for latency/throughput charts
analyticsRouter.get("/timeseries", async (req: Request, res: Response) => {
  try {
    const hours = parseInt((req.query.hours as string) || "24", 10);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    type TsRow = { hour: Date; count: bigint; avg_latency: number | null; error_count: bigint };
    const data = await prisma.$queryRaw<TsRow[]>`
      SELECT
        DATE_TRUNC('hour', "requestedAt") as hour,
        COUNT(*) as count,
        AVG(CASE WHEN status = 'SUCCESS' THEN "latencyMs" END) as avg_latency,
        COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as error_count
      FROM "InferenceLog"
      WHERE "requestedAt" >= ${since}
      GROUP BY DATE_TRUNC('hour', "requestedAt")
      ORDER BY hour ASC
    `;

    res.json({
      timeseries: data.map((row: { hour: Date; count: bigint; avg_latency: number | null; error_count: bigint }) => ({
        hour: row.hour,
        count: Number(row.count),
        avgLatencyMs: row.avg_latency ? Math.round(row.avg_latency) : null,
        errorCount: Number(row.error_count),
      })),
    });
  } catch (err) {
    console.error("[Analytics] Timeseries error:", err);
    res.status(500).json({ error: "Failed to fetch timeseries" });
  }
});

analyticsRouter.get("/logs", async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || "1", 10);
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.inferenceLog.findMany({
        skip,
        take: limit,
        orderBy: { requestedAt: "desc" },
        include: {
          conversation: { select: { id: true, title: true, status: true } },
        },
      }),
      prisma.inferenceLog.count(),
    ]);

    res.json({ logs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

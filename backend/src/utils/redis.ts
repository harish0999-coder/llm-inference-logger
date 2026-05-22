import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableReadyCheck: false,
    });

    redis.on("error", (err) => {
      // Don't crash — Redis is optional (graceful degradation)
      console.warn("[Redis] Connection error (non-fatal):", err.message);
    });
  }
  return redis;
}

export const INFERENCE_LOG_QUEUE = "inference:logs";
export const EVENT_CHANNEL = "inference:events";

export async function publishEvent(event: object): Promise<void> {
  try {
    const r = getRedis();
    await r.publish(EVENT_CHANNEL, JSON.stringify(event));
  } catch {
    // Non-fatal — log only
    console.warn("[Redis] Failed to publish event");
  }
}

export async function enqueueLog(log: object): Promise<void> {
  try {
    const r = getRedis();
    await r.lpush(INFERENCE_LOG_QUEUE, JSON.stringify(log));
  } catch {
    console.warn("[Redis] Failed to enqueue log — writing directly to DB");
  }
}

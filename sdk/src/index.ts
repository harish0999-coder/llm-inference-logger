/**
 * LLM Inference Logger SDK
 * A lightweight wrapper that captures inference metadata and ships it
 * to the ingestion pipeline in near real-time.
 *
 * Usage:
 *   import { LLMLogger } from '@your-org/llm-logger-sdk';
 *
 *   const logger = new LLMLogger({
 *     ingestUrl: 'http://your-backend/api/ingest',
 *     provider: 'OPENAI',
 *     model: 'gpt-4o',
 *   });
 *
 *   const result = await logger.wrap(conversationId, openai.chat.completions.create, args);
 */

import { v4 as uuidv4 } from 'uuid';

export type Provider = 'ANTHROPIC' | 'OPENAI' | 'GEMINI';
export type RequestStatus = 'SUCCESS' | 'ERROR' | 'CANCELLED' | 'TIMEOUT';

export interface LLMLoggerConfig {
  ingestUrl: string;
  provider: Provider;
  model: string;
  /** Max time to wait before flushing buffered logs (ms). Default: 2000 */
  flushIntervalMs?: number;
  /** Max logs to buffer before forcing a flush. Default: 10 */
  maxBufferSize?: number;
  /** Enable PII redaction on previews. Default: true */
  redactPII?: boolean;
  /** SDK version sent as header */
  version?: string;
}

export interface InferenceLog {
  requestId: string;
  conversationId: string;
  provider: Provider;
  model: string;
  status: RequestStatus;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestedAt: string;
  respondedAt?: string;
  inputPreview?: string;
  outputPreview?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

const PII_REGEXES = [
  { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, rep: '[EMAIL]' },
  { re: /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g, rep: '[PHONE]' },
  { re: /\b\d{3}[-]?\d{2}[-]?\d{4}\b/g, rep: '[SSN]' },
];

function redact(text: string): string {
  let out = text;
  for (const { re, rep } of PII_REGEXES) out = out.replace(re, rep);
  return out;
}

function preview(text: string, redactPII: boolean, maxLen = 200): string {
  const t = redactPII ? redact(text) : text;
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
}

export class LLMLogger {
  private config: Required<LLMLoggerConfig>;
  private buffer: InferenceLog[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: LLMLoggerConfig) {
    this.config = {
      flushIntervalMs: 2000,
      maxBufferSize: 10,
      redactPII: true,
      version: '1.0.0',
      ...config,
    };
  }

  /**
   * Wraps any async LLM call to capture timing and tokens.
   * The wrapped function receives the same args and must return
   * an object with optional { usage: { input_tokens, output_tokens } }.
   */
  async wrap<T extends { usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } }>(
    conversationId: string,
    fn: () => Promise<T>,
    opts?: { inputText?: string; extractOutput?: (r: T) => string }
  ): Promise<T> {
    const requestId = uuidv4();
    const requestedAt = new Date();

    try {
      const result = await fn();
      const respondedAt = new Date();
      const latencyMs = respondedAt.getTime() - requestedAt.getTime();

      const inputTokens =
        result.usage?.input_tokens ?? result.usage?.prompt_tokens;
      const outputTokens =
        result.usage?.output_tokens ?? result.usage?.completion_tokens;

      const outputText = opts?.extractOutput ? opts.extractOutput(result) : undefined;

      this.enqueue({
        requestId,
        conversationId,
        provider: this.config.provider,
        model: this.config.model,
        status: 'SUCCESS',
        latencyMs,
        inputTokens,
        outputTokens,
        requestedAt: requestedAt.toISOString(),
        respondedAt: respondedAt.toISOString(),
        inputPreview: opts?.inputText
          ? preview(opts.inputText, this.config.redactPII)
          : undefined,
        outputPreview: outputText
          ? preview(outputText, this.config.redactPII)
          : undefined,
      });

      return result;
    } catch (err) {
      const respondedAt = new Date();
      const error = err as Error;

      this.enqueue({
        requestId,
        conversationId,
        provider: this.config.provider,
        model: this.config.model,
        status: 'ERROR',
        latencyMs: respondedAt.getTime() - requestedAt.getTime(),
        requestedAt: requestedAt.toISOString(),
        respondedAt: respondedAt.toISOString(),
        errorCode: 'LLM_ERROR',
        errorMessage: error.message?.slice(0, 500),
        inputPreview: opts?.inputText
          ? preview(opts.inputText, this.config.redactPII)
          : undefined,
      });

      throw err;
    }
  }

  /** Manually log an inference event */
  log(entry: Omit<InferenceLog, 'requestId'> & { requestId?: string }): void {
    this.enqueue({ requestId: uuidv4(), ...entry });
  }

  private enqueue(log: InferenceLog): void {
    this.buffer.push(log);
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.config.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    try {
      await fetch(`${this.config.ingestUrl}/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SDK-Version': this.config.version,
        },
        body: JSON.stringify({ logs: batch }),
      });
    } catch {
      // Re-enqueue on failure (simple retry)
      this.buffer.unshift(...batch);
    }
  }
}

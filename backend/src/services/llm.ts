import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../utils/prisma";
import { makePreview } from "../utils/pii";
import { publishEvent } from "../utils/redis";

export type Provider = "ANTHROPIC" | "OPENAI" | "GEMINI";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChunk {
  type: "delta" | "done" | "error";
  content?: string;
  error?: string;
  inferenceLog?: {
    id: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

function getDefaultModel(provider: Provider): string {
  switch (provider) {
    case "ANTHROPIC":
      return "claude-sonnet-4-20250514";
    case "OPENAI":
      return "gpt-4o-mini";
    case "GEMINI":
      return "gemini-1.5-flash";
    default:
      return "claude-sonnet-4-20250514";
  }
}

export async function* streamChat(
  conversationId: string,
  messages: ChatMessage[],
  provider: Provider,
  model?: string
): AsyncGenerator<StreamChunk> {
  const resolvedModel = model || getDefaultModel(provider);
  const requestId = uuidv4();
  const requestedAt = new Date();
  let fullResponse = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  try {
    if (provider === "ANTHROPIC") {
      const stream = await anthropic.messages.stream({
        model: resolvedModel,
        max_tokens: 1024,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      for await (const chunk of stream) {
        if (
          chunk.type === "content_block_delta" &&
          chunk.delta.type === "text_delta"
        ) {
          fullResponse += chunk.delta.text;
          yield { type: "delta", content: chunk.delta.text };
        }
      }

      const finalMsg = await stream.finalMessage();
      inputTokens = finalMsg.usage.input_tokens;
      outputTokens = finalMsg.usage.output_tokens;
    } else if (provider === "OPENAI") {
      const stream = await openai.chat.completions.create({
        model: resolvedModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 1024,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          yield { type: "delta", content: delta };
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }
    } else {
      // Gemini via REST (no official streaming Node SDK)
      const apiKey = process.env.GEMINI_API_KEY || "";
      const geminiMessages = messages.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: geminiMessages }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      fullResponse = text;
      inputTokens = data.usageMetadata?.promptTokenCount;
      outputTokens = data.usageMetadata?.candidatesTokenCount;

      // Simulate streaming for Gemini
      const words = text.split(" ");
      for (const word of words) {
        yield { type: "delta", content: word + " " };
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const respondedAt = new Date();
    const latencyMs = respondedAt.getTime() - requestedAt.getTime();

    // Persist inference log
    const lastUserMsg = messages[messages.length - 1]?.content || "";
    const log = await prisma.inferenceLog.create({
      data: {
        conversationId,
        requestId,
        provider,
        model: resolvedModel,
        status: "SUCCESS",
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        requestedAt,
        respondedAt,
        inputPreview: makePreview(lastUserMsg),
        outputPreview: makePreview(fullResponse),
      },
    });

    // Publish event for real-time dashboards
    await publishEvent({
      type: "INFERENCE_COMPLETE",
      conversationId,
      logId: log.id,
      provider,
      model: resolvedModel,
      latencyMs,
      inputTokens,
      outputTokens,
    });

    yield {
      type: "done",
      inferenceLog: {
        id: log.id,
        latencyMs,
        inputTokens,
        outputTokens,
        totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
      },
    };
  } catch (err) {
    const error = err as Error;
    const respondedAt = new Date();
    const latencyMs = respondedAt.getTime() - requestedAt.getTime();

    await prisma.inferenceLog.create({
      data: {
        conversationId,
        requestId,
        provider,
        model: resolvedModel,
        status: "ERROR",
        latencyMs,
        requestedAt,
        respondedAt,
        errorCode: "LLM_ERROR",
        errorMessage: error.message?.slice(0, 500),
        inputPreview: makePreview(messages[messages.length - 1]?.content || ""),
      },
    });

    yield { type: "error", error: error.message };
  }
}

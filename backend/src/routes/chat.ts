import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";
import { streamChat, Provider } from "../services/llm";
import { makePreview } from "../utils/pii";

export const chatRouter = Router();

const ChatSchema = z.object({
  message: z.string().min(1).max(10000),
});

chatRouter.post("/:conversationId/stream", async (req: Request, res: Response) => {
  try {
    const conversationId = req.params["conversationId"] as string;
    const { message } = ChatSchema.parse(req.body);

    // Fetch conversation
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 20, // Keep context window manageable
        },
      },
    });

    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    if (conversation.status === "CANCELLED") {
      res.status(400).json({ error: "Conversation has been cancelled" });
      return;
    }

    // Save user message
    const userMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: message,
        contentPreview: makePreview(message),
      },
    });

    // Build message history
    const history = conversation.messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    history.push({ role: "user", content: message });

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullAssistantContent = "";

    const send = (data: object) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ type: "start", userMessageId: userMessage.id });

    for await (const chunk of streamChat(
      conversationId,
      history,
      conversation.provider as Provider,
      conversation.model
    )) {
      if (chunk.type === "delta" && chunk.content) {
        fullAssistantContent += chunk.content;
        send({ type: "delta", content: chunk.content });
      } else if (chunk.type === "done") {
        // Save assistant message
        const assistantMessage = await prisma.message.create({
          data: {
            conversationId,
            role: "assistant",
            content: fullAssistantContent,
            contentPreview: makePreview(fullAssistantContent),
          },
        });

        // Update conversation title from first exchange if not set
        if (!conversation.title) {
          const titlePreview = message.slice(0, 60);
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { title: titlePreview },
          });
        } else {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });
        }

        send({
          type: "done",
          assistantMessageId: assistantMessage.id,
          inferenceLog: chunk.inferenceLog,
        });
      } else if (chunk.type === "error") {
        send({ type: "error", error: chunk.error });
      }
    }

    res.end();
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    console.error("[Chat] Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Internal server error" })}\n\n`);
      res.end();
    }
  }
});

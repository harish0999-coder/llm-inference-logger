import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../utils/prisma";

export const conversationsRouter = Router();

// List all conversations
conversationsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get a single conversation with messages
conversationsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ conversation });
  } catch {
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Create a new conversation
const CreateConversationSchema = z.object({
  provider: z.enum(["ANTHROPIC", "OPENAI", "GEMINI"]),
  model: z.string().optional(),
  title: z.string().optional(),
});

conversationsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = CreateConversationSchema.parse(req.body);
    const modelMap: Record<string, string> = {
      ANTHROPIC: "claude-sonnet-4-20250514",
      OPENAI: "gpt-4o-mini",
      GEMINI: "gemini-1.5-flash",
    };
    const conversation = await prisma.conversation.create({
      data: {
        provider: body.provider,
        model: body.model || modelMap[body.provider],
        title: body.title,
        status: "ACTIVE",
      },
    });
    res.status(201).json({ conversation });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.errors });
      return;
    }
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// Cancel a conversation
conversationsRouter.patch("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const conversation = await prisma.conversation.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });
    res.json({ conversation });
  } catch {
    res.status(500).json({ error: "Failed to cancel conversation" });
  }
});

// Delete a conversation
conversationsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

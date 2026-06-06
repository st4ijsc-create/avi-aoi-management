/**
 * AI Chat Router — Phase 4.3 (Manufacturing Quality Copilot)
 *
 * Full CRUD for conversations & messages + AI chat processing.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { processChat, getAvailableTools } from "../services/aiChatAssistant";
import { getDb } from "../db/connection";
import { aiChatConversations, aiChatMessages } from "../../drizzle/schema/ai";
import { eq, and, desc, sql } from "drizzle-orm";

export const aiChatRouter = router({
  // ─── Conversation CRUD ─────────────────────────────────────

  /** List conversations for current user */
  listConversations: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { conversations: [], total: 0 };
      const userId = ctx.user.id;
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      const conversations = await db
        .select()
        .from(aiChatConversations)
        .where(eq(aiChatConversations.userId, userId))
        .orderBy(desc(aiChatConversations.updatedAt))
        .limit(limit)
        .offset(offset);
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(aiChatConversations)
        .where(eq(aiChatConversations.userId, userId));
      return { conversations, total: countResult?.count ?? 0 };
    }),

  /** Get a single conversation with its messages */
  getConversation: protectedProcedure
    .input(z.object({
      id: z.number(),
      messageLimit: z.number().min(1).max(200).default(50),
      messageOffset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [conv] = await db.select().from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.id), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      const messages = await db.select().from(aiChatMessages)
        .where(eq(aiChatMessages.conversationId, input.id))
        .orderBy(aiChatMessages.createdAt)
        .limit(input.messageLimit)
        .offset(input.messageOffset);
      return { ...conv, messages };
    }),

  /** Create a new conversation */
  createConversation: protectedProcedure
    .input(z.object({
      title: z.string().max(255).optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [result] = await db.insert(aiChatConversations).values({
        userId: ctx.user.id,
        title: input.title ?? "New Conversation",
        context: input.context,
        messageCount: 0,
      }).returning();
      return result;
    }),

  /** Update conversation title or context */
  updateConversation: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().max(255).optional(),
      context: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { id, ...data } = input;
      const [result] = await db.update(aiChatConversations)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.userId, ctx.user.id)))
        .returning();
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      return result;
    }),

  /** Delete a conversation and all its messages */
  deleteConversation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      // Verify ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.id), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      // Delete messages first, then conversation
      await db.delete(aiChatMessages).where(eq(aiChatMessages.conversationId, input.id));
      await db.delete(aiChatConversations).where(eq(aiChatConversations.id, input.id));
      return { success: true };
    }),

  // ─── Message Operations ────────────────────────────────────

  /** Get messages for a conversation */
  getMessages: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      // Verify ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.conversationId), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      return db.select().from(aiChatMessages)
        .where(eq(aiChatMessages.conversationId, input.conversationId))
        .orderBy(aiChatMessages.createdAt)
        .limit(input.limit)
        .offset(input.offset);
    }),

  /** Delete a single message */
  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.number(), conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      // Verify conversation ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.conversationId), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      await db.delete(aiChatMessages).where(
        and(eq(aiChatMessages.id, input.messageId), eq(aiChatMessages.conversationId, input.conversationId))
      );
      // Update message count
      await db.update(aiChatConversations)
        .set({
          messageCount: sql`GREATEST(0, ${aiChatConversations.messageCount} - 1)`,
          updatedAt: new Date(),
        })
        .where(eq(aiChatConversations.id, input.conversationId));
      return { success: true };
    }),

  // ─── AI Chat Processing ────────────────────────────────────

  /** Send chat message and get AI response (persists to DB) */
  chat: protectedProcedure
    .input(z.object({
      conversationId: z.string().min(1),
      messages: z.array(z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z.string(),
        toolCallId: z.string().optional(),
        name: z.string().optional(),
      })).max(50),
      userMessage: z.string().min(1).max(5000),
      language: z.enum(["en", "vi"]).optional(),
      allowedTools: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await processChat(input);

      // Persist messages to DB
      const db = await getDb();
      if (db) {
        const convIdNum = parseInt(input.conversationId, 10);
        if (!isNaN(convIdNum)) {
          const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
            .where(and(eq(aiChatConversations.id, convIdNum), eq(aiChatConversations.userId, ctx.user.id)))
            .limit(1);
          if (!conv) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
          }

          // Save user message
          await db.insert(aiChatMessages).values({
            conversationId: convIdNum,
            role: "user",
            content: input.userMessage,
          });
          // Save assistant response
          await db.insert(aiChatMessages).values({
            conversationId: convIdNum,
            role: "assistant",
            content: result.reply ?? (result as any).content ?? "",
            toolCalls: (result as any).toolCalls,
            tokensUsed: (result as any).usage?.total_tokens,
          });
          // Update conversation stats
          await db.update(aiChatConversations)
            .set({
              messageCount: sql`${aiChatConversations.messageCount} + 2`,
              lastMessageAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(aiChatConversations.id, convIdNum));
        } else {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid conversationId" });
        }
      }

      return result;
    }),

  /** Save messages from SSE streaming (no AI processing — already done via stream) */
  saveStreamedMessage: protectedProcedure
    .input(z.object({
      conversationId: z.number(),
      userMessage: z.string().min(1).max(5000),
      assistantMessage: z.string().min(1),
      tokensUsed: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      // Verify ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.conversationId), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      // Save user message
      await db.insert(aiChatMessages).values({
        conversationId: input.conversationId,
        role: "user",
        content: input.userMessage,
      });
      // Save assistant response
      await db.insert(aiChatMessages).values({
        conversationId: input.conversationId,
        role: "assistant",
        content: input.assistantMessage,
        tokensUsed: input.tokensUsed,
      });
      // Update conversation stats
      await db.update(aiChatConversations)
        .set({
          messageCount: sql`${aiChatConversations.messageCount} + 2`,
          lastMessageAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiChatConversations.id, input.conversationId));
      return { success: true };
    }),

  // ─── Get Available Chat Tools ────────────────────────────────
  tools: protectedProcedure
    .query(() => {
      return getAvailableTools();
    }),
});

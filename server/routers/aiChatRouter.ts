/**
 * AI Chat Router — Phase 4.3 (Manufacturing Quality Copilot)
 *
 * Full CRUD for conversations & messages + AI chat processing.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, moduleProcedure } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
// P1 (doc 11) — unify on the RAG/KB backend. The non-stream `chat` mutation now
// routes through `answerQuestion` (the SAME pipeline `streamAnswer` uses: tool →
// RAG retrieval → LLM → extractive fallback), NOT the inferior no-RAG
// `processChat` (aiChatAssistant.ts).
//
// doc69 W0-5 item 3 — the UI tool-count footer used to read from
// `aiChatAssistant.getAvailableTools()`, a hard-coded list of the 6 tools the
// deprecated `processChat` backend knew about. That backend has been dead since P1
// (doc 11) — the real assistant runs on the `aiLocalTools` registry (~67 tools:
// read/write/client, F6/F7/P2 groups, programming copilot, etc.), so the footer was
// silently advertising a stale 1/10th of the real tool surface. `listTools()` is the
// real registry (server/services/aiLocalTools/toolRegistry.ts) — source the footer
// from it.
//
// doc69 B2 (Wave 5) — `aiChatAssistant.ts` (processChat + its 6 hard-coded SQL
// tools + getAvailableTools) has been DELETED entirely: confirmed no live caller,
// this router never imported it. The RAG path (`answerQuestion` /
// `aiLocalKnowledgeService`) is now the sole chat backend.
import { answerQuestion, type UserRole } from "../services/aiLocalKnowledgeService";
import { listTools, type ToolExecContext, type ToolLang } from "../services/aiLocalTools";
import { getDb } from "../db/connection";
import { aiChatConversations, aiChatMessages } from "../../drizzle/schema/ai";
import { eq, and, desc, sql } from "drizzle-orm";

// P1 (doc 11) — map the APP role → AI UserRole (tone/scope only; NEVER a
// permission grant — RBAC for write-tools uses the real ctx.user inside
// ToolExecContext). Mirrors client/src/lib/aiRole.ts; duplicated here because
// that module is client-side.
const APP_ROLE_TO_AI_ROLE: Record<string, UserRole> = {
  admin: "it_admin",
  supervisor: "manager",
  quality_inspector: "engineer",
  maintenance: "engineer",
  engineer: "engineer",
  operator: "worker",
  viewer: "worker",
  user: "worker",
};
function mapAppRoleToAiRole(appRole?: string | null): UserRole {
  if (!appRole) return "worker";
  return APP_ROLE_TO_AI_ROLE[appRole.toLowerCase().trim()] ?? "worker";
}

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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [conv] = await db.select().from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.id), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const { id, ...data } = input;
      const [result] = await db.update(aiChatConversations)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(aiChatConversations.id, id), eq(aiChatConversations.userId, ctx.user.id)))
        .returning();
      if (!result) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
      return result;
    }),

  /** Delete a conversation and all its messages */
  deleteConversation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      // Verify ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.id), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
      if (!conv) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      // Verify conversation ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.conversationId), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
      // P1 (doc 11) — route through the RAG/KB backend (same pipeline as the
      // streaming endpoint). This is the non-stream answer + the FE stream-error
      // fallback path, so both now get full KB retrieval + tool grounding +
      // extractive fallback instead of the old no-RAG assistant.
      //
      // History: the FE sends prior turns in `input.messages`; map them to the
      // KB service's {role:"user"|"assistant"} shape (drop system/tool turns).
      const history = input.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
        .slice(-12);

      const userRole = mapAppRoleToAiRole(ctx.user.role as string);

      // GĐ2 — exec context for write-tool RBAC uses the REAL authenticated user,
      // never the tone role. lang follows the question script, defaulting to the
      // FE-supplied language.
      const lang: ToolLang = /[一-鿿]/.test(input.userMessage)
        ? "zh"
        : /[À-ỹ]/.test(input.userMessage)
          ? "vi"
          : (input.language ?? "vi");
      const execCtx: ToolExecContext = {
        user: { id: ctx.user.id, role: String(ctx.user.role), name: ctx.user.name ?? null },
        lang,
      };

      const kb = await answerQuestion(
        input.userMessage,
        5,
        history,
        userRole,
        undefined,
        execCtx,
      );

      // Shape a backward-compatible response: callers (and the old UI) read
      // `.reply`; we also surface the RAG extras so a non-stream caller is not
      // strictly worse than the stream.
      const result = {
        reply: kb.answer,
        toolsUsed: kb.toolName ? [kb.toolName] : [],
        tokensUsed: 0,
        provider: kb.provider,
        citations: kb.citations,
        followUpSuggestions: kb.followUpSuggestions ?? [],
        structured: kb.structured,
        pendingAction: kb.pendingAction ?? null,
      };

      // Persist messages to DB
      const db = await getDb();
      if (db) {
        const convIdNum = parseInt(input.conversationId, 10);
        if (!isNaN(convIdNum)) {
          const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
            .where(and(eq(aiChatConversations.id, convIdNum), eq(aiChatConversations.userId, ctx.user.id)))
            .limit(1);
          if (!conv) {
            throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
            content: result.reply,
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
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "conversationId" }, "Invalid conversationId");
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
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      // Verify ownership
      const [conv] = await db.select({ id: aiChatConversations.id }).from(aiChatConversations)
        .where(and(eq(aiChatConversations.id, input.conversationId), eq(aiChatConversations.userId, ctx.user.id)))
        .limit(1);
      if (!conv) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "conversation" }, "Conversation not found");
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
  // doc69 W0-5 item 3 — sourced from the REAL tool registry (~67 tools), not the
  // deprecated aiChatAssistant.getAvailableTools() 6-tool stub (that whole file
  // was deleted in doc69 B2, Wave 5). See import comment.
  tools: protectedProcedure
    .query(() => {
      return listTools().map((t) => ({ name: t.name, description: t.description }));
    }),
});

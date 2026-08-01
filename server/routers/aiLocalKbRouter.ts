/**
 * AI Local Knowledge Base Router — wraps Phase 2 KB APIs
 * Integrates codebase knowledge retrieval with chat system
 */

import { router, publicProcedure, protectedProcedure, adminProcedure } from "../_core/trpc";
import { z } from "zod";
import { logger } from "../logger";

// Knowledge base endpoints configuration
const KB_API_BASE = process.env.KB_API_BASE || "http://localhost:3000";

// ─── Schema ─────────────────────────────────────────────────────

const RetrieveInputSchema = z.object({
  question: z.string().min(1, "Question required"),
  topK: z.number().int().min(1).max(20).default(5),
});

const ConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const AskInputSchema = z.object({
  question: z.string().min(1, "Question required"),
  topK: z.number().int().min(1).max(20).default(5),
  history: z.array(ConversationMessageSchema).default([]),
  userRole: z.enum(["worker", "engineer", "manager", "it_admin"]).default("engineer"),
});

const FeedbackInputSchema = z.object({
  messageId: z.string().min(1),
  question: z.string(),
  answer: z.string().optional(),
  rating: z.number().int().min(-1).max(1),
  comment: z.string().optional(),
  toolName: z.string().max(64).optional().nullable(),
});

// ─── KB API response shapes ───────────────────────────────────

interface KbHealthResponse {
  success?: boolean;
  ready: boolean;
  chunks: number;
  embeddings?: number;
  error?: string;
  // W0.2/W0.3 (doc 11) — honest health: capability + embed-provenance signals
  // surfaced by getKbHealth and passed through unchanged to the client.
  llmReady?: boolean;
  embedModel?: string | null;
  queryEmbedModel?: string;
  embedModelMatches?: boolean;
  kbBuiltAt?: string | null;
  chunkCount?: number;
  staleDays?: number | null;
}

interface KbApiResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ─── Helper: Fetch from KB API ────────────────────────────────

async function fetchKbApi<T>(endpoint: string, method: string = "GET", body?: unknown): Promise<T> {
  const url = `${KB_API_BASE}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`KB API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data as T;
  } catch (error) {
    logger.error(`[KB API] ${endpoint} failed:`, error as any);
    throw error;
  }
}

// ─── Router ─────────────────────────────────────────────────────

export const aiLocalKbRouter = router({
  /**
   * Check knowledge base health and readiness
   */
  health: publicProcedure.query(async (): Promise<KbHealthResponse> => {
    try {
      const result = await fetchKbApi<KbHealthResponse>("/api/ai/local-kb/health", "GET");
      return result;
    } catch (error: any) {
      // W0.2 (doc 11) — conservative shape on transport failure (mirrors the
      // KbHealthResponse fields the client reads so the union stays uniform).
      return {
        success: false,
        ready: false,
        chunks: 0,
        embeddings: 0,
        error: error.message,
        llmReady: false,
        embedModelMatches: true,
      };
    }
  }),

  /**
   * Retrieve codebase knowledge chunks using hybrid search
   * Input: question + optional topK
   * Output: intent, language, entities, confidence, citations, contexts
   */
  retrieve: protectedProcedure.input(RetrieveInputSchema).mutation(async ({ input }) => {
    try {
      const result = await fetchKbApi<KbApiResult>("/api/ai/local-kb/retrieve", "POST", input);
      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      } else {
        throw new Error(result.error || "Retrieval failed");
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Ask a question about the codebase
   * Uses Phase 2 hybrid retrieval + Ollama generation or extractive fallback
   * Input: question + optional topK
   * Output: answer, intent, language, entities, confidence, citations, provider, cached
   */
  ask: protectedProcedure.input(AskInputSchema).mutation(async ({ input }) => {
    try {
      const result = await fetchKbApi<KbApiResult>("/api/ai/local-kb/ask", "POST", input);
      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      } else {
        throw new Error(result.error || "Ask failed");
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        data: null,
      };
    }
  }),

  /**
   * Reload KB artifacts (admin operation)
   * Used after rebuilding the knowledge base via Phase 1 pipeline
   */
  reload: adminProcedure.mutation(async () => {
    try {
      const result = await fetchKbApi("/api/ai/local-kb/reload", "POST");
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }),

  /**
   * Submit feedback (thumbs up/down) for a KB answer
   */
  feedback: protectedProcedure.input(FeedbackInputSchema).mutation(async ({ input }) => {
    try {
      const result = await fetchKbApi("/api/ai/local-kb/feedback", "POST", input);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }),
});

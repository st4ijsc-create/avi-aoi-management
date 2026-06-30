import type express from "express";
import fs from "node:fs";
import path from "node:path";
import { sdk } from "../_core/sdk";
import {
  answerQuestion,
  getKbHealth,
  reloadKbArtifacts,
  retrieveKnowledge,
  streamAnswer,
  warmUpOllamaModels,
  type ConversationMessage,
  type UserRole,
  type KbQueryContext,
  type KbLanguage,
} from "../services/aiLocalKnowledgeService";
import type { ToolExecContext, ToolLang } from "../services/aiLocalTools";

// Stage 13.D — feedback log path. JSONL append-only for easy diffing &
// future re-ingestion into KB curation.
const FEEDBACK_LOG_PATH = path.resolve(process.cwd(), "knowledge", "feedback.jsonl");

const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set([
  "worker",
  "engineer",
  "manager",
  "it_admin",
]);

function parseHistory(raw: unknown): ConversationMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ConversationMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string" && content.trim()) {
      out.push({ role, content });
    }
  }
  return out.slice(-12);
}

function parseUserRole(raw: unknown): UserRole {
  if (typeof raw === "string" && VALID_USER_ROLES.has(raw as UserRole)) {
    return raw as UserRole;
  }
  return "engineer";
}

const VALID_UI_LANGUAGES: ReadonlySet<KbLanguage> = new Set(["vi", "en", "zh"]);

// C3a — parse the optional page context from the request body. Whitelists known
// fields, coerces types, drops unknown keys. Returns undefined when absent or
// empty so the service falls back to legacy behavior (backward-compatible).
function parseContext(raw: unknown): KbQueryContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const ctx: KbQueryContext = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  if (str(r.route)) ctx.route = str(r.route);
  if (typeof r.uiLanguage === "string" && VALID_UI_LANGUAGES.has(r.uiLanguage as KbLanguage)) {
    ctx.uiLanguage = r.uiLanguage as KbLanguage;
  }
  if (str(r.selectedMachineCode)) ctx.selectedMachineCode = str(r.selectedMachineCode);
  if (num(r.selectedMachineId) != null) ctx.selectedMachineId = num(r.selectedMachineId);
  if (str(r.selectedProductCode)) ctx.selectedProductCode = str(r.selectedProductCode);
  if (num(r.selectedProductModelId) != null) ctx.selectedProductModelId = num(r.selectedProductModelId);
  if (str(r.selectedLot)) ctx.selectedLot = str(r.selectedLot);

  return Object.keys(ctx).length > 0 ? ctx : undefined;
}

// GĐ2 — build the write-action exec context from the REAL authenticated user.
// `lang` mirrors how the SSE error branch picks a language. The user's true
// id/role drive RBAC (never the body.userRole, which only shapes tone).
function buildExecCtx(
  user: { id: number; role: string; name?: string | null },
  req: any,
  question: string,
  context?: KbQueryContext,
): ToolExecContext {
  const lang: ToolLang = /[一-鿿]/.test(question)
    ? "zh"
    : /[À-ỹ]/.test(question)
      ? "vi"
      : context?.uiLanguage ?? "vi";
  return {
    user: { id: user.id, role: String(user.role), name: user.name ?? null },
    lang,
    req: { ip: req?.ip, headers: req?.headers, socket: req?.socket },
  };
}

function chunkAnswerForStream(answer: string): string[] {
  // Split into roughly word-sized tokens so the UI sees progressive updates
  // without overwhelming the SSE channel. Keep whitespace attached to the
  // preceding token so concatenation reproduces the original text exactly.
  const matches = answer.match(/\S+\s*|\s+/g);
  return matches ?? [answer];
}

export function registerAiLocalKnowledgeRoutes(app: express.Express) {
  // Kick off Ollama warm-up so the embed + QA models are loaded before the
  // first user question (otherwise the first ask pays a cold-load penalty).
  warmUpOllamaModels();

  app.get("/api/ai/local-kb/health", async (_req, res) => {
    try {
      // W0.2/W0.3 (doc 11) — getKbHealth is now async (probes LLM loadability +
      // embed-model match). New fields spread through to the client unchanged.
      const health = await getKbHealth();
      res.json({
        success: true,
        ...health,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to get KB health",
      });
    }
  });

  app.post("/api/ai/local-kb/reload", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }

      const health = await reloadKbArtifacts();
      res.json({ success: true, health });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to reload KB artifacts",
      });
    }
  });

  app.post("/api/ai/local-kb/retrieve", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }

      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const topK = Number(req.body?.topK ?? 5);
      if (!question) {
        res.status(400).json({ success: false, error: "question is required" });
        return;
      }

      const data = await retrieveKnowledge(question, topK);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to retrieve knowledge",
      });
    }
  });

  app.post("/api/ai/local-kb/ask", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ success: false, error: "Unauthorized" });
        return;
      }

      const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
      const topK = Number(req.body?.topK ?? 5);
      if (!question) {
        res.status(400).json({ success: false, error: "question is required" });
        return;
      }

      const history = parseHistory(req.body?.history);
      const userRole = parseUserRole(req.body?.userRole);
      const context = parseContext(req.body?.context);
      const execCtx = buildExecCtx(user as any, req, question, context);
      const data = await answerQuestion(question, topK, history, userRole, context, execCtx);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to answer question",
      });
    }
  });

  // SSE streaming endpoint. Emits `meta`, optional `tool`, one or more
  // `token` events, then `done`. Falls back to chunked emission of the
  // final answer when an LLM is not available locally.
  app.post("/api/ai/local-kb/stream", async (req, res) => {
    const user = await sdk.authenticateRequest(req).catch(() => null);
    if (!user) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }

    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    const topK = Number(req.body?.topK ?? 5);
    if (!question) {
      res.status(400).json({ success: false, error: "question is required" });
      return;
    }

    const history = parseHistory(req.body?.history);
    const userRole = parseUserRole(req.body?.userRole);
    const context = parseContext(req.body?.context);
    const execCtx = buildExecCtx(user as any, req, question, context);

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    const send = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    try {
      // Real token streaming: stream the LLM output as it's generated so
      // the user sees the first words within ~1-2s instead of waiting for
      // the entire answer. `streamAnswer` runs the full pipeline (tool +
      // retrieve + LLM) and yields events in order: meta \u2192 [tool] \u2192
      // token* \u2192 done. Falls back to extractive/tool text inside the
      // generator when the LLM isn't reachable.
      let followUpSuggestions: string[] = [];
      let finalAnswer = "";
      let finalProvider: "ollama" | "extractive" | "tool" = "extractive";
      let cached = false;
      let structured: Record<string, unknown> | undefined;

      for await (const evt of streamAnswer(question, topK, history, userRole, context, execCtx)) {
        if (closed) return;
        switch (evt.type) {
          case "meta":
            send({
              type: "meta",
              intent: evt.intent,
              language: evt.language,
              confidence: evt.confidence,
              citations: evt.citations,
            });
            break;
          case "tool":
            send({
              type: "tool",
              toolName: evt.toolName,
              toolResult: evt.toolResult,
            });
            break;
          case "pending_action":
            send({
              type: "pending_action",
              toolName: evt.toolName,
              pendingAction: evt.pendingAction,
            });
            break;
          case "client_action":
            send({
              type: "client_action",
              toolName: evt.toolName,
              clientAction: evt.clientAction,
            });
            break;
          case "token":
            send({ type: "token", token: evt.token });
            break;
          case "done":
            followUpSuggestions = evt.followUpSuggestions;
            finalAnswer = evt.answer;
            finalProvider = evt.provider;
            cached = evt.cached;
            structured = evt.structured as any;
            break;
        }
      }

      if (!closed) {
        send({
          type: "done",
          provider: finalProvider,
          cached,
          followUpSuggestions,
          answer: finalAnswer,
          structured,
        });
      }
    } catch (error: any) {
      if (!closed) {
        send({
          type: "error",
          error: error?.message ?? "Stream failed",
          language: /[\u4e00-\u9fff]/.test(question)
            ? "zh"
            : /[\u00c0-\u1ef9]/.test(question)
              ? "vi"
              : context?.uiLanguage ?? "en",
        });
      }
    } finally {
      if (!closed) res.end();
    }
  });

  // Stage 13.D — user feedback (👍 / 👎) on a single answer.
  // Path matches what aiLocalKbRouter.feedback POSTs to via fetchKbApi
  // (server-to-server localhost call — no cookie forwarded, so this route
  // intentionally stays auth-free; the tRPC layer enforces session auth).
  // Persisted to knowledge/feedback.jsonl for later curation.
  app.post("/api/ai/local-kb/feedback", async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const ratingRaw = Number(body.rating);
      if (!messageId || !question) {
        res.status(400).json({ success: false, error: "messageId and question are required" });
        return;
      }
      if (!Number.isFinite(ratingRaw) || ratingRaw < -1 || ratingRaw > 1) {
        res.status(400).json({ success: false, error: "rating must be -1, 0, or 1" });
        return;
      }

      const entry = {
        ts: new Date().toISOString(),
        messageId,
        question: question.slice(0, 2000),
        answer: typeof body.answer === "string" ? body.answer.slice(0, 8000) : null,
        rating: Math.round(ratingRaw),
        comment: typeof body.comment === "string" ? body.comment.slice(0, 2000) : null,
        toolName: typeof body.toolName === "string" ? body.toolName : null,
      };

      await fs.promises.mkdir(path.dirname(FEEDBACK_LOG_PATH), { recursive: true });
      await fs.promises.appendFile(FEEDBACK_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to record feedback",
      });
    }
  });
}

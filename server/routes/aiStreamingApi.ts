/**
 * AI GGUF Streaming API — Server-Sent Events endpoints for real-time LLM inference
 *
 * Provides token-by-token streaming for text generation and chat completion
 * alongside the existing tRPC router (which only supports request/response).
 */

import type express from "express";
import { sdk } from "../_core/sdk";
import {
  generateTextStream,
  chatCompletionStream,
  isGgufAvailable,
} from "../services/aiGgufEngine";

/**
 * Register SSE streaming routes on the Express app
 */
export function registerAiStreamingRoutes(app: express.Express) {
  // ─── SSE: Text Generation Stream ────────────────────
  app.post("/api/ai/stream/generate", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const available = await isGgufAvailable();
      if (!available) {
        res.status(503).json({ error: "GGUF engine not available" });
        return;
      }

      const {
        prompt, systemPrompt, modelId,
        maxTokens, temperature, topP, topK,
        repeatPenalty, stopSequences, jsonMode, language,
      } = req.body;

      if (!prompt || typeof prompt !== "string") {
        res.status(400).json({ error: "prompt is required" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Abort GGUF generation when client disconnects
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const stream = generateTextStream(
        {
          prompt,
          systemPrompt,
          maxTokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
          topP, topK, repeatPenalty, stopSequences,
          jsonMode: jsonMode ?? false,
          language: language ?? "vi",
        },
        modelId,
        abortController.signal,
      );

      for await (const chunk of stream) {
        if (res.destroyed) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
        res.end();
      }
    }
  });

  // ─── SSE: Chat Completion Stream ────────────────────
  app.post("/api/ai/stream/chat", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const available = await isGgufAvailable();
      if (!available) {
        res.status(503).json({ error: "GGUF engine not available" });
        return;
      }

      const { messages, modelId, maxTokens, temperature, topP, topK, repeatPenalty, jsonMode } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "messages array is required" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Abort GGUF generation when client disconnects
      const abortController = new AbortController();
      req.on("close", () => abortController.abort());

      const stream = chatCompletionStream(
        {
          messages,
          maxTokens: maxTokens ?? 1024,
          temperature: temperature ?? 0.7,
          topP, topK, repeatPenalty,
          jsonMode: jsonMode ?? false,
        },
        modelId,
        abortController.signal,
      );

      for await (const chunk of stream) {
        if (res.destroyed) break;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      } else {
        res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
        res.end();
      }
    }
  });
}

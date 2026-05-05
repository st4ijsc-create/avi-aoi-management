import type express from "express";
import { sdk } from "../_core/sdk";
import {
  answerQuestion,
  getKbHealth,
  reloadKbArtifacts,
  retrieveKnowledge,
} from "../services/aiLocalKnowledgeService";

export function registerAiLocalKnowledgeRoutes(app: express.Express) {
  app.get("/api/ai/local-kb/health", async (_req, res) => {
    try {
      const health = getKbHealth();
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

      const health = reloadKbArtifacts();
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

      const data = await answerQuestion(question, topK);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error?.message ?? "Failed to answer question",
      });
    }
  });
}

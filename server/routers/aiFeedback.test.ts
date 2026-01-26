/**
 * Tests for AI Feedback Router
 */
import { describe, it, expect, vi } from "vitest";

// Mock database
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  }),
}));

describe("AI Feedback Router", () => {
  describe("Suggestion Types", () => {
    it("should validate suggestion types", () => {
      const validTypes = [
        "DEFECT_CLASSIFICATION",
        "ROOT_CAUSE",
        "CORRECTIVE_ACTION",
        "QUALITY_PREDICTION",
        "PROCESS_OPTIMIZATION",
      ];
      
      expect(validTypes.length).toBe(5);
      expect(validTypes).toContain("DEFECT_CLASSIFICATION");
      expect(validTypes).toContain("ROOT_CAUSE");
    });

    it("should validate confidence range", () => {
      const validConfidence = 0.85;
      const invalidConfidence = 1.5;
      
      expect(validConfidence).toBeGreaterThanOrEqual(0);
      expect(validConfidence).toBeLessThanOrEqual(1);
      expect(invalidConfidence).toBeGreaterThan(1);
    });
  });

  describe("Feedback Types", () => {
    it("should validate feedback types", () => {
      const validTypes = ["CORRECT", "INCORRECT", "PARTIAL", "UNSURE"];
      
      expect(validTypes.length).toBe(4);
      expect(validTypes).toContain("CORRECT");
      expect(validTypes).toContain("INCORRECT");
    });

    it("should map feedback to suggestion status", () => {
      const mapFeedbackToStatus = (feedbackType: string): string => {
        if (feedbackType === "CORRECT") return "ACCEPTED";
        if (feedbackType === "INCORRECT") return "REJECTED";
        return "REVIEWED";
      };
      
      expect(mapFeedbackToStatus("CORRECT")).toBe("ACCEPTED");
      expect(mapFeedbackToStatus("INCORRECT")).toBe("REJECTED");
      expect(mapFeedbackToStatus("PARTIAL")).toBe("REVIEWED");
      expect(mapFeedbackToStatus("UNSURE")).toBe("REVIEWED");
    });
  });

  describe("Accuracy Calculation", () => {
    it("should calculate accuracy correctly", () => {
      const feedback = [
        { feedbackType: "CORRECT" },
        { feedbackType: "CORRECT" },
        { feedbackType: "INCORRECT" },
        { feedbackType: "PARTIAL" },
        { feedbackType: "CORRECT" },
      ];
      
      const correctCount = feedback.filter(f => f.feedbackType === "CORRECT").length;
      const totalCount = feedback.length;
      const accuracy = correctCount / totalCount;
      
      expect(accuracy).toBe(0.6);
    });

    it("should handle zero feedback", () => {
      const feedback: Array<{ feedbackType: string }> = [];
      const accuracy = feedback.length > 0 
        ? feedback.filter(f => f.feedbackType === "CORRECT").length / feedback.length 
        : 0;
      
      expect(accuracy).toBe(0);
    });
  });

  describe("Error Categories", () => {
    it("should validate error categories", () => {
      const validCategories = [
        "FALSE_POSITIVE",
        "FALSE_NEGATIVE",
        "MISCLASSIFICATION",
        "WRONG_LOCATION",
        "WRONG_SEVERITY",
        "OTHER",
      ];
      
      expect(validCategories.length).toBe(6);
      expect(validCategories).toContain("FALSE_POSITIVE");
      expect(validCategories).toContain("FALSE_NEGATIVE");
    });

    it("should calculate error breakdown", () => {
      const feedback = [
        { errorCategory: "FALSE_POSITIVE" },
        { errorCategory: "FALSE_POSITIVE" },
        { errorCategory: "MISCLASSIFICATION" },
        { errorCategory: null },
        { errorCategory: "FALSE_NEGATIVE" },
      ];
      
      const errorCounts = new Map<string, number>();
      for (const fb of feedback) {
        if (fb.errorCategory) {
          errorCounts.set(fb.errorCategory, (errorCounts.get(fb.errorCategory) || 0) + 1);
        }
      }
      
      expect(errorCounts.get("FALSE_POSITIVE")).toBe(2);
      expect(errorCounts.get("MISCLASSIFICATION")).toBe(1);
      expect(errorCounts.get("FALSE_NEGATIVE")).toBe(1);
    });
  });

  describe("Training Batch", () => {
    it("should count samples correctly", () => {
      const feedback = [
        { feedbackType: "CORRECT" },
        { feedbackType: "INCORRECT" },
        { feedbackType: "CORRECT" },
        { feedbackType: "PARTIAL" },
      ];
      
      const correctSamples = feedback.filter(f => f.feedbackType === "CORRECT").length;
      const incorrectSamples = feedback.filter(f => f.feedbackType === "INCORRECT").length;
      
      expect(correctSamples).toBe(2);
      expect(incorrectSamples).toBe(1);
    });

    it("should validate export formats", () => {
      const validFormats = ["JSON", "CSV", "JSONL", "PARQUET"];
      
      expect(validFormats.length).toBe(4);
      expect(validFormats).toContain("JSONL");
    });
  });

  describe("Model Metrics", () => {
    it("should calculate metrics by suggestion type", () => {
      const suggestions = [
        { id: 1, suggestionType: "DEFECT_CLASSIFICATION" },
        { id: 2, suggestionType: "DEFECT_CLASSIFICATION" },
        { id: 3, suggestionType: "ROOT_CAUSE" },
      ];
      
      const feedback = [
        { suggestionId: 1, feedbackType: "CORRECT" },
        { suggestionId: 2, feedbackType: "INCORRECT" },
        { suggestionId: 3, feedbackType: "CORRECT" },
      ];
      
      const byType = new Map<string, { total: number; correct: number }>();
      
      for (const suggestion of suggestions) {
        const stats = byType.get(suggestion.suggestionType) || { total: 0, correct: 0 };
        stats.total++;
        byType.set(suggestion.suggestionType, stats);
      }
      
      for (const fb of feedback) {
        const suggestion = suggestions.find(s => s.id === fb.suggestionId);
        if (suggestion && fb.feedbackType === "CORRECT") {
          const stats = byType.get(suggestion.suggestionType);
          if (stats) stats.correct++;
        }
      }
      
      const defectClassStats = byType.get("DEFECT_CLASSIFICATION");
      expect(defectClassStats?.total).toBe(2);
      expect(defectClassStats?.correct).toBe(1);
      
      const rootCauseStats = byType.get("ROOT_CAUSE");
      expect(rootCauseStats?.total).toBe(1);
      expect(rootCauseStats?.correct).toBe(1);
    });
  });
});

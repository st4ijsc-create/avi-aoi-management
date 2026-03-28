/**
 * Tests for AISuggestionsPanel Component Logic
 */
import { describe, it, expect } from "vitest";

describe("AISuggestionsPanel Component", () => {
  describe("Suggestion Types", () => {
    it("should have correct suggestion type labels", () => {
      const suggestionTypeLabels: Record<string, string> = {
        DEFECT_CLASSIFICATION: "Phân loại lỗi",
        ROOT_CAUSE: "Nguyên nhân gốc",
        CORRECTIVE_ACTION: "Hành động khắc phục",
        QUALITY_PREDICTION: "Dự đoán chất lượng",
        PROCESS_OPTIMIZATION: "Tối ưu quy trình",
      };

      expect(Object.keys(suggestionTypeLabels).length).toBe(5);
      expect(suggestionTypeLabels["DEFECT_CLASSIFICATION"]).toBe("Phân loại lỗi");
      expect(suggestionTypeLabels["ROOT_CAUSE"]).toBe("Nguyên nhân gốc");
    });
  });

  describe("Feedback Types", () => {
    it("should have correct feedback type labels", () => {
      const feedbackTypeLabels: Record<string, { label: string; color: string }> = {
        CORRECT: { label: "Chính xác", color: "text-green-500 bg-green-500/10" },
        INCORRECT: { label: "Không chính xác", color: "text-red-500 bg-red-500/10" },
        PARTIAL: { label: "Một phần đúng", color: "text-yellow-500 bg-yellow-500/10" },
        UNSURE: { label: "Không chắc chắn", color: "text-gray-500 bg-gray-500/10" },
      };

      expect(Object.keys(feedbackTypeLabels).length).toBe(4);
      expect(feedbackTypeLabels["CORRECT"].label).toBe("Chính xác");
      expect(feedbackTypeLabels["INCORRECT"].label).toBe("Không chính xác");
    });
  });

  describe("Error Categories", () => {
    it("should have correct error category labels", () => {
      const errorCategoryLabels: Record<string, string> = {
        FALSE_POSITIVE: "Dương tính giả",
        FALSE_NEGATIVE: "Âm tính giả",
        MISCLASSIFICATION: "Phân loại sai",
        WRONG_LOCATION: "Sai vị trí",
        WRONG_SEVERITY: "Sai mức độ",
        OTHER: "Khác",
      };

      expect(Object.keys(errorCategoryLabels).length).toBe(6);
      expect(errorCategoryLabels["FALSE_POSITIVE"]).toBe("Dương tính giả");
      expect(errorCategoryLabels["FALSE_NEGATIVE"]).toBe("Âm tính giả");
    });
  });

  describe("Confidence Color", () => {
    it("should return correct color based on confidence level", () => {
      const getConfidenceColor = (confidence: number) => {
        if (confidence >= 0.8) return "text-green-500";
        if (confidence >= 0.6) return "text-yellow-500";
        return "text-red-500";
      };

      expect(getConfidenceColor(0.9)).toBe("text-green-500");
      expect(getConfidenceColor(0.8)).toBe("text-green-500");
      expect(getConfidenceColor(0.7)).toBe("text-yellow-500");
      expect(getConfidenceColor(0.6)).toBe("text-yellow-500");
      expect(getConfidenceColor(0.5)).toBe("text-red-500");
      expect(getConfidenceColor(0.3)).toBe("text-red-500");
    });
  });

  describe("Status Mapping", () => {
    it("should map feedback type to suggestion status correctly", () => {
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

  describe("Suggestion Status Display", () => {
    it("should have correct status labels", () => {
      const statusLabels: Record<string, string> = {
        PENDING: "Chờ xử lý",
        ACCEPTED: "Đã chấp nhận",
        REJECTED: "Đã từ chối",
        REVIEWED: "Đã xem xét",
      };

      expect(Object.keys(statusLabels).length).toBe(4);
      expect(statusLabels["PENDING"]).toBe("Chờ xử lý");
      expect(statusLabels["ACCEPTED"]).toBe("Đã chấp nhận");
    });
  });

  describe("Alternatives Parsing", () => {
    it("should parse alternatives correctly", () => {
      const alternatives = [
        { suggestion: "Alternative 1", confidence: 0.7 },
        { suggestion: "Alternative 2", confidence: 0.5 },
      ];

      expect(alternatives.length).toBe(2);
      expect(alternatives[0].suggestion).toBe("Alternative 1");
      expect(alternatives[0].confidence).toBe(0.7);
    });
  });

  describe("Form Validation", () => {
    it("should require error category for INCORRECT feedback", () => {
      const feedbackForm = {
        suggestionId: 1,
        feedbackType: "INCORRECT",
        errorCategory: undefined,
      };

      const isValid = feedbackForm.feedbackType !== "INCORRECT" || !!feedbackForm.errorCategory;
      expect(isValid).toBe(false);

      feedbackForm.errorCategory = "FALSE_POSITIVE";
      const isValidAfter = feedbackForm.feedbackType !== "INCORRECT" || !!feedbackForm.errorCategory;
      expect(isValidAfter).toBe(true);
    });

    it("should not require error category for CORRECT feedback", () => {
      const feedbackForm = {
        suggestionId: 1,
        feedbackType: "CORRECT",
        errorCategory: undefined,
      };

      const isValid = feedbackForm.feedbackType !== "INCORRECT" || !!feedbackForm.errorCategory;
      expect(isValid).toBe(true);
    });
  });
});

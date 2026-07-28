import { describe, it, expect } from "vitest";
import { canDecide } from "./pendingSuggestionLogic";

describe("canDecide — Segregation of Duties", () => {
  it("người KHÁC người đề xuất ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 7 }, 9)).toEqual({ allowed: true });
  });

  it("CHÍNH người đề xuất ⇒ KHÔNG được, nêu lý do rõ ràng", () => {
    expect(canDecide({ requestedBy: 7 }, 7)).toEqual({ allowed: false, reason: "own-request" });
  });

  it("đề xuất do auto-tune tạo (requestedBy khác user hiện tại) ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 1 }, 42)).toEqual({ allowed: true });
  });

  it("không biết user hiện tại ⇒ KHÔNG được, lý do phải là 'unknown-user' KHÔNG phải 'own-request'", () => {
    expect(canDecide({ requestedBy: 7 }, undefined)).toEqual({ allowed: false, reason: "unknown-user" });
  });
});

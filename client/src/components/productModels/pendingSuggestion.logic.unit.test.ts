import { describe, it, expect } from "vitest";
import { canDecide } from "./pendingSuggestionLogic";

describe("canDecide — Segregation of Duties", () => {
  it("người KHÁC người đề xuất + có quyền ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 7 }, 9, true)).toEqual({ allowed: true });
  });

  it("CHÍNH người đề xuất + có quyền ⇒ KHÔNG được, nêu lý do rõ ràng", () => {
    expect(canDecide({ requestedBy: 7 }, 7, true)).toEqual({ allowed: false, reason: "own-request" });
  });

  it("đề xuất do auto-tune tạo (requestedBy khác user hiện tại) + có quyền ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 1 }, 42, true)).toEqual({ allowed: true });
  });

  it("không biết user hiện tại ⇒ KHÔNG được, lý do phải là 'unknown-user' KHÔNG phải 'own-request'", () => {
    expect(canDecide({ requestedBy: 7 }, undefined, true)).toEqual({ allowed: false, reason: "unknown-user" });
  });
});

describe("canDecide — quyền duyệt ngưỡng (settings_alerts.canEdit)", () => {
  it("có quyền + khác người tạo ⇒ được quyết định", () => {
    expect(canDecide({ requestedBy: 7 }, 9, true)).toEqual({ allowed: true });
  });

  it("KHÔNG có quyền + khác người tạo ⇒ KHÔNG được, lý do 'no-permission'", () => {
    expect(canDecide({ requestedBy: 7 }, 9, false)).toEqual({ allowed: false, reason: "no-permission" });
  });

  it("KHÔNG có quyền + CHÍNH người tạo ⇒ vẫn 'no-permission' (thiếu quyền là rào chặn TRƯỚC tự-duyệt)", () => {
    expect(canDecide({ requestedBy: 7 }, 7, false)).toEqual({ allowed: false, reason: "no-permission" });
  });
});

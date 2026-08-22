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

  it("★★★ B3.2 — KHÔNG biết user VÀ KHÔNG có quyền ⇒ 'unknown-user' (thứ tự hai rào đầu bị GHIM)", () => {
    // Backlog B3 ghi: *"tổ hợp `unknown-user` + `no-permission` — nếu ai đảo hai bước đầu,
    // không test nào bắt."* Đo lại 2026-08-22: đúng vậy. Bộ test cũ có ca `unknown-user`
    // RIÊNG và ca `no-permission` RIÊNG, nhưng chưa ca nào để cả hai điều kiện cùng đúng —
    // nên đảo hai dòng `if` đầu của `canDecide` vẫn XANH toàn bộ.
    //
    // Vì sao thứ tự này quan trọng chứ không chỉ là "cho đẹp": docstring của `canDecide`
    // nói lý do phải TRUNG THỰC — "không biết bạn là ai" và "bạn không có quyền" là hai
    // câu khác nhau với hai cách xử lý khác nhau (đăng nhập lại vs. xin cấp quyền). Trả
    // sai câu là đúng cái bệnh mà cả Wave 2 sinh ra để chữa.
    expect(canDecide({ requestedBy: 7 }, undefined, false)).toEqual({
      allowed: false,
      reason: "unknown-user",
    });
  });

  it("★★★ B3.2 — cả BA điều kiện cùng sai ⇒ vẫn 'unknown-user' (rào ngoài cùng thắng)", () => {
    // Ca cực đoan: chưa biết user, không quyền, và (giả định) tự-duyệt. `requestedBy`
    // không thể khớp `undefined`, nên đây khoá đúng một điều: rào NGOÀI CÙNG luôn thắng,
    // không có tổ hợp nào lọt xuống rào trong rồi trả lý do sai.
    for (const canApprove of [true, false]) {
      expect(canDecide({ requestedBy: 7 }, undefined, canApprove), `canApprove=${canApprove}`)
        .toEqual({ allowed: false, reason: "unknown-user" });
    }
  });
});

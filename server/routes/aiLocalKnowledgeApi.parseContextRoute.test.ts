/**
 * ★★★ Đợt I / I-2 (`docs/superpowers/specs/2026-09-06-ai-local-thiet-ke-lai-toan-dien.md` §4.1,
 * audit N1 `.superpowers/sdd/2026-09-06-audit-ai-local/audit-2-backend.md`) — `parseContext` lọc
 * `context.route` trước bản vá này chỉ theo HÌNH DẠNG (chuỗi ≤200 ký tự), không theo GIÁ TRỊ. Bất
 * kỳ client đã đăng nhập nào (vai gì cũng được) gửi `context:{route:"vscode"}` sẽ tắt vòng tool,
 * ép `intent="general"`, đổi ngân sách token — dù không phải extension VSCode thật.
 *
 * ─── VÌ SAO KHÔNG PHẢI ENUM ĐÓNG NHƯ `VALID_UI_LANGUAGES` ────────────────────────────────────────
 * `route` mang HAI lớp giá trị khác nhau cùng một trường: (1) literal đặc biệt DUY NHẤT `"vscode"`
 * (đổi hành vi 5 điểm rẽ nhánh trong `aiLocalKnowledgeService.ts`); (2) đường dẫn web TỰ DO
 * (`useLocation()`, ~221 route đếm được trong `client/src/App.tsx`, dùng cho gợi ý nhẹ
 * `routeToFeatureHints` — KHÔNG khớp ⇒ `[]`, không phải lỗi). Whitelist phải bảo vệ (1) mà không
 * bóp nghẹt (2) — nếu không sẽ hỏng gợi ý cho hầu hết trang web (chỉ 8/221+ route có trong
 * `ROUTE_FEATURE_HINTS` hôm nay, nhưng danh sách đó được thiết kế để MỞ RỘNG mà không cần sửa
 * `parseContext`).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ `isValidRoute` (quay về `str(r.route)` thô) ⇒ §C ĐỎ (rác lọt qua).
 *   Thu hẹp `isValidRoute` thành enum đóng chỉ có "vscode" ⇒ §B ĐỎ (đường dẫn web thật bị chặn).
 */
import { describe, it, expect } from "vitest";
import { parseContext, isValidRoute } from "./aiLocalKnowledgeApi";

describe("§A — route \"vscode\" (literal đặc biệt) VẪN đi qua nguyên vẹn", () => {
  it("★★★ context.route:\"vscode\" ⇒ ctx.route === \"vscode\" (extension thật không bị chặn nhầm)", () => {
    const ctx = parseContext({ route: "vscode" });
    expect(ctx?.route).toBe("vscode");
  });

  it("isValidRoute(\"vscode\") === true", () => {
    expect(isValidRoute("vscode")).toBe(true);
  });
});

describe("§B — ĐỐI CHỨNG bắt buộc: đường dẫn WEB thật (bắt đầu bằng \"/\") KHÔNG bị chặn nhầm", () => {
  it("★★★ route là đường dẫn wouter thật (\"/factory-command\") ⇒ đi qua nguyên vẹn", () => {
    const ctx = parseContext({ route: "/factory-command" });
    expect(ctx?.route).toBe("/factory-command");
  });

  it("★★★ route literal cố định của AIChatPage (\"/ai-chat\") ⇒ đi qua nguyên vẹn", () => {
    const ctx = parseContext({ route: "/ai-chat" });
    expect(ctx?.route).toBe("/ai-chat");
  });

  it("★★★ route literal cố định của AICodingWorkspace (\"/ai-coding-workspace\") ⇒ đi qua nguyên vẹn", () => {
    const ctx = parseContext({ route: "/ai-coding-workspace" });
    expect(ctx?.route).toBe("/ai-coding-workspace");
  });

  it("★★ route CHƯA có trong ROUTE_FEATURE_HINTS (route ứng dụng bất kỳ, vd \"/machines/42\") vẫn đi qua — không bị coi là rác", () => {
    const ctx = parseContext({ route: "/machines/42" });
    expect(ctx?.route).toBe("/machines/42");
  });

  it("★ đường dẫn có query string (\"/oee-dashboard?line=2\") vẫn đi qua nguyên vẹn (routeToFeatureHints tự cắt query)", () => {
    const ctx = parseContext({ route: "/oee-dashboard?line=2" });
    expect(ctx?.route).toBe("/oee-dashboard?line=2");
  });

  it("★★ đối sánh CHUỖI CHÍNH XÁC — \"/vscode\" (path thật, không phải literal) vẫn được coi là web, không bị coi là literal đặc biệt", () => {
    expect(isValidRoute("/vscode")).toBe(true); // hợp lệ VÌ là đường dẫn (bắt đầu bằng "/"), không phải vì khớp literal
    const ctx = parseContext({ route: "/vscode" });
    expect(ctx?.route).toBe("/vscode");
  });
});

describe("§C — route RÁC (không phải \"vscode\", không phải đường dẫn) ⇒ rơi về undefined, KHÔNG ném lỗi", () => {
  it("★★★ \"admin\" (không bắt đầu bằng \"/\", không phải \"vscode\") ⇒ ctx.route undefined", () => {
    const ctx = parseContext({ route: "admin", uiLanguage: "vi" });
    expect(ctx?.route).toBeUndefined();
    // các trường khác trong context vẫn được giữ — route rác không chặn cả context
    expect(ctx?.uiLanguage).toBe("vi");
  });

  it("★★★ mồi SQL-injection-shaped (\"' OR 1=1\") ⇒ ctx.route undefined", () => {
    const ctx = parseContext({ route: "' OR 1=1" });
    expect(ctx?.route).toBeUndefined();
  });

  it("★★★ chuỗi 200 ký tự rác (đúng trần độ dài cũ nhưng không đúng hình dạng) ⇒ ctx.route undefined", () => {
    const rac = "x".repeat(200);
    const ctx = parseContext({ route: rac });
    expect(ctx?.route).toBeUndefined();
  });

  it("★★ đối sánh CHUỖI CHÍNH XÁC — \"VSCODE\" (hoa) không phải literal \"vscode\", không phải đường dẫn ⇒ undefined", () => {
    expect(isValidRoute("VSCODE")).toBe(false);
    const ctx = parseContext({ route: "VSCODE" });
    expect(ctx?.route).toBeUndefined();
  });

  it("★ không ném lỗi — parseContext vẫn trả về object bình thường (không throw) khi route là rác", () => {
    expect(() => parseContext({ route: "admin" })).not.toThrow();
  });

  it("★ route rác ⇒ context vẫn hợp lệ nếu còn trường khác (không rỗng toàn bộ)", () => {
    const ctx = parseContext({ route: "admin", selectedMachineCode: "M1" });
    expect(ctx).toBeDefined();
    expect(ctx?.selectedMachineCode).toBe("M1");
    expect(ctx?.route).toBeUndefined();
  });

  it("★ route rác DUY NHẤT trong payload ⇒ context rỗng ⇒ parseContext trả về undefined (giữ đúng hành vi C3a cũ: object rỗng ⇒ undefined)", () => {
    const ctx = parseContext({ route: "admin" });
    expect(ctx).toBeUndefined();
  });
});

describe("§D — route VẮNG/không phải chuỗi ⇒ hành vi cũ giữ nguyên (KHÔNG đổi)", () => {
  it("route vắng mặt ⇒ ctx.route undefined, context vẫn có thể có trường khác", () => {
    const ctx = parseContext({ uiLanguage: "en" });
    expect(ctx?.route).toBeUndefined();
    expect(ctx?.uiLanguage).toBe("en");
  });

  it("route là số (hình dạng sai ngay từ str()) ⇒ undefined", () => {
    const ctx = parseContext({ route: 123 });
    expect(ctx?.route).toBeUndefined();
  });

  it("route là chuỗi rỗng/toàn khoảng trắng ⇒ undefined (str() đã lọc trước isValidRoute)", () => {
    const ctx = parseContext({ route: "   " });
    expect(ctx?.route).toBeUndefined();
  });
});

/**
 * Cờ AI_AGENT_* trong JSON `coAiAgent` / dòng stderr "cờ AI_AGENT_* CÓ HIỆU LỰC": KHÔNG BAO GIỜ lộ một bí mật đặt nhầm vào biến.
 * Giá trị chỉ nguyên văn khi khớp KIỂU của cờ đã biết (số ^[0-9.+-]{1,12}$; bật/tắt true|false|0|1|on|off|yes|no); không khớp ⇒ "<không hợp lệ, độ dài N>";
 * tên lạ ⇒ chỉ tên. Thẻ/lượt không có cờ AI_AGENT_* ⇒ {} (không đổi).
 * ĐỘT BIẾN PHẢI BẮT: ghi nguyên văn mọi giá trị · bỏ kiểm số · bỏ kiểm bật/tắt · tên lạ vẫn ghi giá trị · độ dài sai · đổi kiểu của một cờ số sang bật/tắt.
 */
import { describe, expect, it } from "vitest";
import { coAiAgentHieuLuc, giaTriCoAnToan } from "./napEnv";

const BI_MAT = "matkhau-FAKE-xyz";

describe("giaTriCoAnToan", () => {
  it.each([
    ["AI_AGENT_SO_LUOT_TOI_DA", "60"],
    ["AI_AGENT_NEN_MOC", "0.5"],
    ["AI_AGENT_NEN_MOC", "-1"],
    ["AI_AGENT_HOUSEKEEPING_INTERVAL_MS", "600000"],
    ["AI_AGENT_THEO_VAI_TRO", "0"],
    ["AI_AGENT_CONG_KE_HOACH", "1"],
    ["AI_AGENT_HOUSEKEEPING_ENABLED", "true"],
    ["AI_AGENT_NGHI", "FALSE"],
    ["AI_AGENT_TU_DONG", "on"],
  ])("★★★ %s=%s hợp lệ theo kiểu ⇒ ghi NGUYÊN VĂN", (ten, gt) => {
    expect(giaTriCoAnToan(ten, gt)).toBe(gt);
  });
  it.each([
    ["AI_AGENT_SO_LUOT_TOI_DA", BI_MAT],
    ["AI_AGENT_NEN_MOC", "abc"],
    ["AI_AGENT_NEN_MOC", "1e3"],
    ["AI_AGENT_NEN_MOC", "1234567890123"],
    ["AI_AGENT_HOUSEKEEPING_INTERVAL_MS", "60 000"],
    ["AI_AGENT_THEO_VAI_TRO", BI_MAT],
    ["AI_AGENT_CONG_KE_HOACH", "2"],
    ["AI_AGENT_TU_DONG", "maybe"],
    ["AI_AGENT_NGHI", ""],
  ])("★★★ %s=%j sai kiểu ⇒ '<không hợp lệ, độ dài N>' và KHÔNG chứa giá trị", (ten, gt) => {
    const r = giaTriCoAnToan(ten, gt);
    expect(r).toBe(`<không hợp lệ, độ dài ${gt.length}>`);
    if (gt.length > 3) expect(r).not.toContain(gt);
  });
  it("★★★ TÊN LẠ ⇒ chỉ ghi tên: giá trị (kể cả số/bật tắt) KHÔNG lộ", () => {
    for (const gt of ["1", "0.5", "true", BI_MAT]) expect(giaTriCoAnToan("AI_AGENT_CHUA_BIET", gt)).toBe("<tên lạ, không ghi giá trị>");
  });
  it("★★ một cờ SỐ không nhận giá trị bật/tắt dạng chữ ('true') và ngược lại cờ bật/tắt không nhận '0.5'", () => {
    expect(giaTriCoAnToan("AI_AGENT_NEN_MOC", "true")).toBe("<không hợp lệ, độ dài 4>");
    expect(giaTriCoAnToan("AI_AGENT_THEO_VAI_TRO", "0.5")).toBe("<không hợp lệ, độ dài 3>");
  });
});

describe("coAiAgentHieuLuc — JSON / stderr không lộ", () => {
  it("★★★ thăm dò của kiem-dinh: AI_AGENT_SO_LUOT_TOI_DA='matkhau-FAKE-xyz' ⇒ KHÔNG xuất hiện ở bất kỳ giá trị nào", () => {
    const r = coAiAgentHieuLuc({ AI_AGENT_SO_LUOT_TOI_DA: BI_MAT, AI_AGENT_NEN_MOC: "0.5", AI_AGENT_LA_HOAC: BI_MAT });
    expect(r).toEqual({ AI_AGENT_LA_HOAC: "<tên lạ, không ghi giá trị>", AI_AGENT_NEN_MOC: "0.5", AI_AGENT_SO_LUOT_TOI_DA: `<không hợp lệ, độ dài ${BI_MAT.length}>` });
    expect(JSON.stringify(r)).not.toContain("matkhau");
    expect(JSON.stringify(r)).not.toContain("FAKE");
  });
  it("★★ tên có chữ bí mật vẫn bị loại hẳn (như cũ); biến không phải AI_AGENT_* bị bỏ", () => {
    const r = coAiAgentHieuLuc({ AI_AGENT_API_KEY: BI_MAT, AI_AGENT_PASSWORD_X: "p", DATABASE_URL: BI_MAT, AI_AGENT_NGHI: "1" });
    expect(r).toEqual({ AI_AGENT_NGHI: "1" });
  });
  it("★★ không có cờ nào ⇒ {} (không đổi byte); giá trị undefined bị bỏ; thứ tự khoá đã sắp", () => {
    expect(coAiAgentHieuLuc({})).toEqual({});
    expect(coAiAgentHieuLuc({ AI_AGENT_NGHI: undefined })).toEqual({});
    expect(Object.keys(coAiAgentHieuLuc({ AI_AGENT_NGHI: "1", AI_AGENT_HOAN_TAC: "0", AI_AGENT_CUU_TRAN: "1" }))).toEqual(["AI_AGENT_CUU_TRAN", "AI_AGENT_HOAN_TAC", "AI_AGENT_NGHI"]);
  });
});

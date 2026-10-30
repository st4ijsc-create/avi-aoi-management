/**
 * Đợt 10.2 (ext 0.4.0) — logic thuần ô chọn model + HỢP ĐỒNG regex với máy chủ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHON_MODEL_RE, duocDungOExtension, chuanHoaChon, chuanHoaDanhMuc, hauToTrangThai, modelChoAgent, xacThucChon } from "./chonModel";

describe("CHON_MODEL_RE — khớp máy chủ", () => {
  it("nguồn regex TRÙNG server/services/ai/chonModel/kieu.ts", () => {
    const src = readFileSync(resolve(__dirname, "../../../server/services/ai/chonModel/kieu.ts"), "utf8");
    const mm = /CHON_MODEL_RE\s*=\s*(\/.+\/)\s*;/.exec(src);
    expect(mm).not.toBeNull();
    expect(CHON_MODEL_RE.source).toBe(new RegExp(mm![1].slice(1, -1)).source);
  });
});

describe("chuanHoaDanhMuc", () => {
  const goc = [
    { ma: "vai-tro:code.software", loai: "vai-tro", nhan: "Lập trình", moTa: "m", trangThai: "san-sang" },
    { ma: "vai-tro:embed", loai: "vai-tro", nhan: "Nhúng", moTa: "", trangThai: "san-sang" },
    { ma: "ho-so:p1", loai: "ho-so", nhan: "P1", moTa: "", trangThai: "can-doi-khe", uocTinhDoiKheGiay: 12.6 },
    { ma: "ho-so:p1", loai: "ho-so", nhan: "trùng", moTa: "", trangThai: "san-sang" },
    { ma: "{{ x }}", loai: "ho-so", nhan: "bậy", moTa: "", trangThai: "san-sang" },
    { ma: "ho-so:p2", loai: "ho-so", nhan: "P2", moTa: "", trangThai: "lạ" },
    { ma: "auto", loai: "auto", nhan: "x", moTa: "", trangThai: "san-sang" },
    null,
    "rác",
  ];
  it("auto luôn đứng đầu; bỏ trùng / mã sai / vai không sinh chữ / phần tử hỏng; trạng thái lạ ⇒ tắt", () => {
    const dm = chuanHoaDanhMuc(goc);
    expect(dm.map((m) => m.ma)).toEqual(["auto", "vai-tro:code.software", "ho-so:p1", "ho-so:p2"]);
    expect(dm[3].trangThai).toBe("tat");
    expect(dm[2].uocTinhDoiKheGiay).toBe(12.6);
  });
  it("đầu vào không phải mảng ⇒ chỉ auto", () => {
    expect(chuanHoaDanhMuc(undefined).map((m) => m.ma)).toEqual(["auto"]);
    expect(chuanHoaDanhMuc({}).map((m) => m.ma)).toEqual(["auto"]);
  });
});

describe("★ 10.4b-E — mục ngoai trong ô extension khi máy chủ khai phục vụ chat (agent KHÔNG cần: model ngoài chỉ Hỏi)", () => {
  const e = (duocDungO?: string[]) => ({ ma: "ngoai:openai_compat:gpt-x", loai: "ngoai", nhan: "X", moTa: "", trangThai: "san-sang", ...(duocDungO ? { duocDungO } : {}) });
  it("thiếu / rỗng / không có chat (agent, luong, kiem-dinh, coding) ⇒ BỎ; có chat ⇒ giữ (khớp BE_MAT_NGOAI_DUOC_DUNG thật của máy chủ)", () => {
    for (const du of [undefined, [], ["agent"], ["luong", "kiem-dinh"], ["coding"]]) expect(chuanHoaDanhMuc([e(du)]).map((m) => m.ma), JSON.stringify(du)).toEqual(["auto"]);
    for (const du of [["chat"], ["chat", "agent", "coding"], ["luong", "kiem-dinh", "chat", "coding"]]) expect(chuanHoaDanhMuc([e(du)]).map((m) => m.ma), JSON.stringify(du)).toEqual(["auto", "ngoai:openai_compat:gpt-x"]);
  });
  it("hàm vị từ", () => {
    expect(duocDungOExtension(["chat"])).toBe(true);
    expect(duocDungOExtension(["agent"])).toBe(false);
    expect(duocDungOExtension(undefined)).toBe(false);
  });
});

describe("chuanHoaChon / xacThucChon / modelChoAgent", () => {
  const dm = chuanHoaDanhMuc([
    { ma: "ho-so:p1", loai: "ho-so", nhan: "P1", moTa: "", trangThai: "san-sang" },
    { ma: "ho-so:off", loai: "ho-so", nhan: "Off", moTa: "", trangThai: "tat" },
  ]);
  it("giá trị lạ ⇒ auto", () => {
    expect(chuanHoaChon("ho-so:p1")).toBe("ho-so:p1");
    expect(chuanHoaChon("{{ x }}")).toBe("auto");
    expect(chuanHoaChon(5)).toBe("auto");
  });
  it("mã mất / tắt ⇒ auto; còn ⇒ giữ; danh mục chưa tải ⇒ giữ", () => {
    expect(xacThucChon("ho-so:p1", dm)).toBe("ho-so:p1");
    expect(xacThucChon("ho-so:off", dm)).toBe("auto");
    expect(xacThucChon("ho-so:cu", dm)).toBe("auto");
    expect(xacThucChon("ho-so:cu", chuanHoaDanhMuc(null))).toBe("ho-so:cu");
  });
  it("Agent: chọn cụ thể ⇒ mã đó; auto/lạ ⇒ cấu hình", () => {
    expect(modelChoAgent("vai-tro:code.software", "chat")).toBe("vai-tro:code.software");
    expect(modelChoAgent("auto", "chat")).toBe("chat");
    expect(modelChoAgent(undefined, "code")).toBe("code");
    expect(modelChoAgent("{{ x }}", "chat")).toBe("chat");
  });
});

describe("hauToTrangThai", () => {
  it("sẵn sàng rỗng · tắt · đổi khe có số / chưa đo", () => {
    expect(hauToTrangThai({ trangThai: "san-sang" })).toBe("");
    expect(hauToTrangThai({ trangThai: "tat" })).toBe(" — tắt");
    expect(hauToTrangThai({ trangThai: "can-doi-khe", uocTinhDoiKheGiay: 9.4 })).toBe(" — cần đổi khe ~9 s");
    expect(hauToTrangThai({ trangThai: "can-doi-khe" })).toBe(" — cần đổi khe (chưa đo)");
  });
});

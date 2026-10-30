/** Đợt 11.4 / mục 1 — thanh trạng thái: tok/s, nhãn model, định dạng, ngưỡng cảnh báo, cập nhật từng phần. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THANH_RONG, TRAN_CANH_BAO_NGU_CANH, capNhatThanh, dinhDangThanh, huyHieuDuyet, nhanModelNgan, tinhTokPerS, tongChoDuyet } from "./thanhAgent";

describe("thanhAgent", () => {
  it("tinhTokPerS: làm tròn; ra<=0, quá ngắn (<300ms) hoặc số hỏng ⇒ undefined", () => {
    expect(tinhTokPerS(100, 2000)).toBe(50);
    expect(tinhTokPerS(100, 300)).toBe(333);
    expect(tinhTokPerS(100, 299)).toBeUndefined();
    expect(tinhTokPerS(0, 5000)).toBeUndefined();
    expect(tinhTokPerS(Number.NaN, 5000)).toBeUndefined();
    expect(tinhTokPerS(10, Number.POSITIVE_INFINITY)).toBeUndefined();
  });
  it("nhanModelNgan: ngoai → model (ncc); vai-tro/ho-so bỏ tiền tố; cắt dài", () => {
    expect(nhanModelNgan("ngoai:openai:gpt-x")).toBe("gpt-x (openai)");
    expect(nhanModelNgan("vai-tro:coding")).toBe("coding");
    expect(nhanModelNgan("ho-so:abc")).toBe("abc");
    expect(nhanModelNgan("chat")).toBe("chat");
    expect(nhanModelNgan("x".repeat(40))).toBe(`${"x".repeat(27)}…`);
    expect(nhanModelNgan("x".repeat(28))).toBe("x".repeat(28));
    expect(nhanModelNgan("x".repeat(29))).toBe(`${"x".repeat(27)}…`);
  });
  it("dinhDangThanh: trống ⇒ chỉ tên; đủ số ⇒ model · % · tok/s; ước lượng có «~»; đang chạy có spinner", () => {
    expect(dinhDangThanh(THANH_RONG).text).toBe("$(hubot) Thợ Cả");
    const d = dinhDangThanh({ model: "chat", ctxPhanTram: 42, uocLuong: false, tokPerS: 38, dangChay: false });
    expect(d.text).toBe("$(hubot) Thợ Cả · chat · 42% ngữ cảnh · 38 tok/s");
    expect(d.canhBao).toBe(false);
    expect(dinhDangThanh({ model: "chat", ctxPhanTram: 42, uocLuong: true, dangChay: true }).text).toBe("$(sync~spin) Thợ Cả · chat · ~42% ngữ cảnh");
  });
  it("cảnh báo đúng từ ngưỡng, không sớm hơn một đơn vị", () => {
    expect(dinhDangThanh({ ...THANH_RONG, ctxPhanTram: TRAN_CANH_BAO_NGU_CANH - 1 }).canhBao).toBe(false);
    const d = dinhDangThanh({ ...THANH_RONG, ctxPhanTram: TRAN_CANH_BAO_NGU_CANH });
    expect(d.canhBao).toBe(true);
    expect(d.tooltip).toContain("sắp đầy");
  });
  it("capNhatThanh: ghép từng phần, không mất trường khác", () => {
    const a = capNhatThanh(THANH_RONG, { model: "m", tokPerS: 5 });
    expect(capNhatThanh(a, { dangChay: true })).toMatchObject({ model: "m", tokPerS: 5, dangChay: true });
  });
  it("ghim văn bản: phienAgent báo thanh ở usage (số thật) + kết thúc lượt; activate đăng ký thanh", () => {
    const pa = readFileSync(join(__dirname, "..", "ui", "phienAgent.ts"), "utf8");
    expect(pa).toContain("baoThanhAgent({ ctxPhanTram: e.ctxPhanTram, uocLuong: false, tokPerS: tinhTokPerS(e.ra, Date.now() - this.batDauGoiMs) });");
    expect(pa).toContain("baoThanhAgent({ dangChay: false });");
    expect(readFileSync(join(__dirname, "..", "extension.ts"), "utf8")).toContain("dangKyThanhAgent(context);");
  });
});

describe("mục 2 — huy hiệu chờ duyệt", () => {
  it("huyHieuDuyet: <1 / hỏng ⇒ undefined; số nguyên + tooltip", () => {
    expect(huyHieuDuyet(0)).toBeUndefined();
    expect(huyHieuDuyet(Number.NaN)).toBeUndefined();
    expect(huyHieuDuyet(-2)).toBeUndefined();
    expect(huyHieuDuyet(1)).toEqual({ value: 1, tooltip: "1 thẻ duyệt đang chờ bạn" });
    expect(huyHieuDuyet(2.9)!.value).toBe(2);
  });
  it("tongChoDuyet: cộng các khung, bỏ số âm/NaN", () => {
    expect(tongChoDuyet(new Map<unknown, number>([[{}, 2], [{}, 3], [{}, -4], [{}, Number.NaN]]))).toBe(5);
    expect(tongChoDuyet(new Map())).toBe(0);
  });
  it("dinhDangThanh: có thẻ chờ ⇒ chữ «N chờ duyệt» + cảnh báo + tooltip; không có ⇒ không chữ", () => {
    const d = dinhDangThanh({ ...THANH_RONG, soChoDuyet: 3 });
    expect(d.text).toBe("$(hubot) Thợ Cả · 3 chờ duyệt");
    expect(d.canhBao).toBe(true);
    expect(d.tooltip).toContain("3 thẻ duyệt đang chờ bạn");
    expect(dinhDangThanh({ ...THANH_RONG, soChoDuyet: 0 })).toMatchObject({ text: "$(hubot) Thợ Cả", canhBao: false });
  });
  it("ghim văn bản: PhienAgent báo số chờ khi thêm VÀ khi quyết; view thanh bên nhận huy hiệu", () => {
    const pa = readFileSync(join(__dirname, "..", "ui", "phienAgent.ts"), "utf8");
    expect(pa.match(/baoChoDuyet\(this, this\.choDuyet\.size\);/g)).toHaveLength(2);
    expect(readFileSync(join(__dirname, "..", "ui", "bangChatView.ts"), "utf8")).toContain("ganViewHuyHieu(webviewView);");
  });
});

/**
 * Đợt 8.2 Task 1 — mã hoá bí mật Luồng AI (không CSDL): khứ hồi · IV khác nhau mỗi lần · sửa tag/bản mã/id ⇒ ném ·
 * thiếu/sai khoá ⇒ từ chối (fail-closed) · xoay khoá (khoá cũ theo `phienBanKhoa`) · che mọi biến thể.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bienTheBiMat, cheBiMat, cheSau, giaiMa, kiemGiaTri, maHoa, NHAN_CHE } from "./biMat";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const env1 = { AI_FLOW_KHOA_BI_MAT: k1 } as NodeJS.ProcessEnv;

describe("biMat — AES-256-GCM (Đợt 8.2)", () => {
  it("khứ hồi; IV 12 byte khác nhau mỗi lần; tag 16 byte; phienBanKhoa mặc định 1", () => {
    const a = maHoa("api-erp", "s3cr3t-giá-trị", env1);
    const b = maHoa("api-erp", "s3cr3t-giá-trị", env1);
    expect(a.iv).toHaveLength(12);
    expect(a.tag).toHaveLength(16);
    expect(a.phienBanKhoa).toBe(1);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.banMa.equals(b.banMa)).toBe(false);
    expect(a.banMa.includes(Buffer.from("s3cr3t"))).toBe(false);
    expect(giaiMa("api-erp", a, env1)).toBe("s3cr3t-giá-trị");
  });

  it("sửa tag / sửa bản mã / đổi id (AAD) / sai khoá ⇒ GIAI_MA_HONG", () => {
    const a = maHoa("x1", "gia-tri-1", env1);
    const tagSai = Buffer.from(a.tag);
    tagSai[0] ^= 1;
    expect(() => giaiMa("x1", { ...a, tag: tagSai }, env1)).toThrow(expect.objectContaining({ code: "GIAI_MA_HONG" }));
    const maSai = Buffer.from(a.banMa);
    maSai[0] ^= 1;
    expect(() => giaiMa("x1", { ...a, banMa: maSai }, env1)).toThrow(expect.objectContaining({ code: "GIAI_MA_HONG" }));
    expect(() => giaiMa("x2", a, env1)).toThrow(expect.objectContaining({ code: "GIAI_MA_HONG" }));
    expect(() => giaiMa("x1", a, { AI_FLOW_KHOA_BI_MAT: k2 } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "GIAI_MA_HONG" }));
  });

  it("thiếu khoá / khoá không đủ 32 byte ⇒ THIEU_KHOA (cả mã lẫn giải)", () => {
    const a = maHoa("x", "gia-tri-1", env1);
    for (const env of [{}, { AI_FLOW_KHOA_BI_MAT: "" }, { AI_FLOW_KHOA_BI_MAT: randomBytes(16).toString("base64") }, { AI_FLOW_KHOA_BI_MAT: "không-phải-base64" }]) {
      expect(() => maHoa("x", "gia-tri-1", env as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "THIEU_KHOA" }));
      expect(() => giaiMa("x", a, env as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "THIEU_KHOA" }));
    }
  });

  it("xoay khoá: bản mã phiên bản 1 giải bằng AI_FLOW_KHOA_BI_MAT_CU khi hiện hành là 2; thiếu khoá cũ ⇒ từ chối", () => {
    const cu = maHoa("x", "gia-tri-cu", env1);
    const env2 = { AI_FLOW_KHOA_BI_MAT: k2, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "2", AI_FLOW_KHOA_BI_MAT_CU: k1 } as NodeJS.ProcessEnv;
    expect(giaiMa("x", cu, env2)).toBe("gia-tri-cu");
    const moi = maHoa("x", "gia-tri-moi", env2);
    expect(moi.phienBanKhoa).toBe(2);
    expect(giaiMa("x", moi, env2)).toBe("gia-tri-moi");
    expect(() => giaiMa("x", cu, { AI_FLOW_KHOA_BI_MAT: k2, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "2" } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "THIEU_KHOA" }));
    expect(() => giaiMa("x", cu, { AI_FLOW_KHOA_BI_MAT: k2, AI_FLOW_KHOA_BI_MAT_PHIEN_BAN: "3", AI_FLOW_KHOA_BI_MAT_CU: k1 } as NodeJS.ProcessEnv)).toThrow(expect.objectContaining({ code: "THIEU_KHOA" }));
  });

  it("kiểm giá trị: loại lạ, quá ngắn, xuống dòng, tai-khoan thiếu ':' ⇒ KHONG_HOP_LE", () => {
    expect(() => kiemGiaTri("la", "abcdefgh")).toThrow(/loại/);
    expect(() => kiemGiaTri("token", "abc")).toThrow(/4–/);
    expect(() => kiemGiaTri("token", "abcd\r\nX-Evil: 1")).toThrow(/xuống dòng/);
    expect(() => kiemGiaTri("tai-khoan", "khongcohaicham")).toThrow(/tên:mật khẩu/);
    expect(() => kiemGiaTri("tai-khoan", "u:matkhau")).not.toThrow();
  });

  it("che: nguyên văn, base64, base64url, mã URL, mật khẩu của tai-khoan; sâu trong JSON (cả khoá)", () => {
    const v = "u-ser:p@ss/w+rd?";
    const bt = bienTheBiMat(v, "tai-khoan");
    const b64 = Buffer.from(v).toString("base64");
    const s = `A ${v} B ${b64} C ${encodeURIComponent(v)} D ${Buffer.from(v).toString("base64url")} E p@ss/w+rd?`;
    const che = cheBiMat(s, bt);
    for (const x of [v, b64, encodeURIComponent(v), "p@ss/w+rd?"]) expect(che).not.toContain(x);
    expect(che).toContain(NHAN_CHE);
    const o = cheSau({ a: [`Bearer ${v}`], [v]: 1, n: 3 }, bt);
    expect(JSON.stringify(o)).not.toContain(v);
    expect(o.n).toBe(3);
    expect(cheSau({ a: "x" }, [])).toEqual({ a: "x" });
  });
});

import { describe, expect, it } from "vitest";
import { docSoTran, dongBaoTran, gioiHanChoLuot, tinhTranLuot } from "./tranLuot";

describe("docSoTran", () => {
  it.each([
    ["30", 1, 120, 30],
    [" 7 ", 1, 120, 7],
    ["1", 1, 120, 1],
    ["120", 1, 120, 120],
    ["007", 1, 120, 7],
  ])("★★★ %s trong [%s, %s] ⇒ %s", (tho, min, max, kq) => {
    expect(docSoTran(tho, min, max)).toBe(kq);
  });
  it.each([["0"], ["121"], ["-3"], ["3.5"], ["abc"], ["30 lượt"], ["1e2"], [""], ["   "], ["12345678"], ["+30"]])("★★★ %j ngoài khoảng / không phải số nguyên ⇒ null", (tho) => {
    expect(docSoTran(tho, 1, 120)).toBeNull();
  });
  it("★★ undefined ⇒ null; biên 1000 / 400000 của token", () => {
    expect(docSoTran(undefined, 1, 5)).toBeNull();
    expect(docSoTran("999", 1000, 400_000)).toBeNull();
    expect(docSoTran("1000", 1000, 400_000)).toBe(1000);
    expect(docSoTran("400000", 1000, 400_000)).toBe(400_000);
    expect(docSoTran("400001", 1000, 400_000)).toBeNull();
  });
});

describe("tinhTranLuot — min(khoá thẻ, biến env (mặc định 30), trần cứng 120)", () => {
  it.each([
    ["thẻ 60, env chưa đặt ⇒ 30 (env mặc định chặn)", 60, {}, 30],
    ["thẻ 60, env 100 ⇒ 60", 60, { AI_AGENT_SO_LUOT_TOI_DA: "100" }, 60],
    ["thẻ 60, env 20 ⇒ 20", 60, { AI_AGENT_SO_LUOT_TOI_DA: "20" }, 20],
    ["thẻ 20, env chưa đặt ⇒ 20", 20, {}, 20],
    ["thẻ 120, env 500 (kẹp 120) ⇒ 120", 120, { AI_AGENT_SO_LUOT_TOI_DA: "500" }, 120],
    ["thẻ 120, env 120 ⇒ 120", 120, { AI_AGENT_SO_LUOT_TOI_DA: "120" }, 120],
    ["thẻ 30, env không hợp lệ ⇒ 30", 30, { AI_AGENT_SO_LUOT_TOI_DA: "abc" }, 30],
    ["thẻ 1, env 100 ⇒ 1", 1, { AI_AGENT_SO_LUOT_TOI_DA: "100" }, 1],
  ])("★★★ %s", (_t, the, env, kq) => {
    expect(tinhTranLuot({ luotModel: the }, env).luotThucDung).toBe(kq);
  });
  it("★★★ ghi đủ ba nguồn: khoá thẻ, env (đã kẹp), trần cứng", () => {
    const k = tinhTranLuot({ luotModel: 60 }, { AI_AGENT_SO_LUOT_TOI_DA: "500" });
    expect(k).toMatchObject({ donVi: "luot-goi-model", khoaThe: { luotModel: 60, phut: null, tokenRa: null }, luotEnv: 120, tranCung: 120, luotThucDung: 60, apDungTuThe: true });
  });
  it("★★ env chưa đặt ⇒ luotEnv null", () => {
    expect(tinhTranLuot({ luotModel: 10 }, {}).luotEnv).toBeNull();
  });
  it("★★★ chỉ có TRẦN PHÚT / TOKEN RA (không lượt) ⇒ luotThucDung = env hoặc 30, apDungTuThe true, KHÔNG ép số lượt", () => {
    const k = tinhTranLuot({ phut: 10 }, { AI_AGENT_SO_LUOT_TOI_DA: "50" });
    expect(k.luotThucDung).toBe(50);
    expect(k.apDungTuThe).toBe(true);
    expect(gioiHanChoLuot(k)).toEqual({ msToiDa: 600_000 });
    expect(gioiHanChoLuot(tinhTranLuot({ tokenRa: 5000 }, {}))).toEqual({ tokenRaToiDa: 5000 });
  });
  it("★★★ khoá rỗng {} ⇒ apDungTuThe false và gioiHanChoLuot undefined (không ép gì)", () => {
    const k = tinhTranLuot({}, {});
    expect(k.apDungTuThe).toBe(false);
    expect(gioiHanChoLuot(k)).toBeUndefined();
    expect(dongBaoTran(k)).toEqual([]);
  });
});

describe("gioiHanChoLuot / dongBaoTran", () => {
  it("★★★ đủ ba khoá ⇒ soLuotToiDa là số THỰC DÙNG (đã min), msToiDa = phút × 60000, tokenRaToiDa", () => {
    const k = tinhTranLuot({ luotModel: 60, phut: 25, tokenRa: 90_000 }, { AI_AGENT_SO_LUOT_TOI_DA: "45" });
    expect(gioiHanChoLuot(k)).toEqual({ soLuotToiDa: 45, msToiDa: 1_500_000, tokenRaToiDa: 90_000 });
  });
  it("★★★ dongBaoTran báo trần THẬT (đã min) và đơn vị", () => {
    const k = tinhTranLuot({ luotModel: 60, phut: 25, tokenRa: 90_000 }, { AI_AGENT_SO_LUOT_TOI_DA: "45" });
    const dong = dongBaoTran(k);
    expect(dong[0]).toContain("TRẦN LƯỢT MODEL: 45");
    expect(dong[0]).not.toContain("TRẦN LƯỢT MODEL: 60");
    expect(dong[0]).toContain("một lần gọi model");
    expect(dong).toContain("TRẦN PHÚT: 25");
    expect(dong).toContain("TRẦN TOKEN RA: 90000");
  });
});

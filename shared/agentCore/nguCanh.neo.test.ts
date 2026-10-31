/** Đợt 12 · H1.2 — `nenLichSu({neo})`: đếm bằng số thật của lượt trước + ước lượng phần thêm. */
import { describe, expect, it } from "vitest";
import { nenLichSu, uocLuongTinNhan } from "./nguCanh";
import type { TinNhan } from "./kieu";

function lichSu(n: number): TinNhan[] {
  const ds: TinNhan[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
  ];
  for (let i = 0; i < n; i++) {
    ds.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${i}` }) } }] });
    ds.push({ role: "tool", tool_call_id: `c${i}`, name: "read_file", content: "x".repeat(2800) });
  }
  return ds;
}

describe("nenLichSu neo số thật", () => {
  const NS = 10_000;
  it("không neo ⇒ như cũ từng byte", () => {
    const a = nenLichSu(lichSu(5), { nganSachToken: NS });
    const b = nenLichSu(lichSu(5), { nganSachToken: NS, neo: undefined });
    expect(b).toEqual(a);
  });
  it("★ ước lượng thuần thấp (5 cặp ≈ 5k < ngưỡng 7k) nhưng SỐ THẬT cao ⇒ nén; neo thấp ⇒ không nén", () => {
    const ds = lichSu(5);
    expect(nenLichSu(ds, { nganSachToken: NS }).soNen).toBe(0);
    const cao = nenLichSu(ds, { nganSachToken: NS, neo: { soTin: ds.length, token: 9000 } });
    expect(cao.soNen).toBeGreaterThan(0);
    expect(cao.tokenTruoc).toBe(9000);
    const thap = nenLichSu(lichSu(9), { nganSachToken: NS, neo: { soTin: 4, token: 100 } });
    expect(thap.tokenTruoc).toBe(100 + uocLuongTinNhan(lichSu(9).slice(4)));
  });
  it("tokenTruoc = số thật + ước lượng CHỈ phần sau neo", () => {
    const ds = lichSu(6);
    const phan = ds.length - 2;
    const r = nenLichSu(ds, { nganSachToken: 1_000_000, neo: { soTin: phan, token: 4321 } });
    expect(r.tokenTruoc).toBe(4321 + uocLuongTinNhan(ds.slice(phan)));
  });
  it("neo không hợp lệ (soTin 0 / quá dài / token ≤ 0 / NaN) ⇒ rơi về ước lượng thuần", () => {
    const ds = lichSu(5);
    const thuan = uocLuongTinNhan(ds);
    for (const neo of [{ soTin: 0, token: 5 }, { soTin: ds.length + 1, token: 5 }, { soTin: 3, token: 0 }, { soTin: 3, token: Number.NaN }, { soTin: 3, token: Number.POSITIVE_INFINITY }, { soTin: 3, token: -4 }]) {
      expect(nenLichSu(ds, { nganSachToken: 1_000_000, neo }).tokenTruoc, JSON.stringify(neo)).toBe(thuan);
    }
  });
  it("bất biến nén vẫn giữ (system + câu hỏi + 2 lượt cuối nguyên văn; số tin không đổi)", () => {
    const ds = lichSu(9);
    const r = nenLichSu(ds, { nganSachToken: NS, neo: { soTin: ds.length, token: 20_000 } });
    expect(r.tinNhan.length).toBe(ds.length);
    expect(r.tinNhan.slice(0, 2)).toEqual(ds.slice(0, 2));
    expect(r.tinNhan.slice(-4)).toEqual(ds.slice(-4));
  });
});

import { describe, expect, it } from "vitest";
import { kiemLuong, type KhaiBaoNut } from "./model";

const KB: Record<string, KhaiBaoNut> = {
  "kich-hoat.thu-cong": { type: "kich-hoat.thu-cong", typeVersion: 1, laKichHoat: true, congVao: [], congRa: ["main"], tacDungPhu: "thuan", lapLai: "idempotent" },
  "du-lieu.dat": { type: "du-lieu.dat", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "thuan", lapLai: "idempotent" },
  "logic.neu": { type: "logic.neu", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["dung", "sai"], tacDungPhu: "thuan", lapLai: "idempotent" },
  "tich-hop.http": { type: "tich-hop.http", typeVersion: 1, laKichHoat: false, congVao: ["main"], congRa: ["main"], tacDungPhu: "ngoai-ghi", lapLai: "atMostOnce" },
};
const dk = (t: string) => KB[t];
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, pa: string, b: string, pb = "main") => ({ from: { node: a, port: pa }, to: { node: b, port: pb } });
const luong = (nodes: unknown[], connections: unknown[]) => ({ id: "f1", name: "thu", version: 1, nodes, connections });

describe("kiemLuong (Đợt 8.0)", () => {
  it("hợp lệ; hạng = cao nhất của các node", () => {
    const kq = kiemLuong(
      luong([nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { x: "{{ $json.a + 1 }}" }), nut("h", "tich-hop.http")], [noi("t", "main", "a"), noi("a", "main", "h")]),
      dk,
    );
    expect(kq).toEqual({ ok: true, loi: [], hang: "ngoai-ghi", luongCon: [] });
  });

  it("trùng id · loại lạ · cổng lạ · không kích hoạt · nối vào kích hoạt · biểu thức sai", () => {
    expect(kiemLuong(luong([nut("t", "kich-hoat.thu-cong"), nut("t", "du-lieu.dat")], []), dk).loi.join()).toMatch(/trùng/);
    expect(kiemLuong(luong([nut("t", "kich-hoat.thu-cong"), nut("x", "la.khong-co")], []), dk).loi.join()).toMatch(/chưa đăng ký/);
    expect(kiemLuong(luong([nut("t", "kich-hoat.thu-cong"), nut("n", "logic.neu")], [noi("t", "main", "n"), noi("n", "main", "t")]), dk).loi.join()).toMatch(/không có cổng ra 'main'/);
    expect(kiemLuong(luong([nut("a", "du-lieu.dat")], []), dk).loi.join()).toMatch(/kích hoạt/);
    expect(kiemLuong(luong([nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat", { x: "{{ $json. }}" })], []), dk).loi.join()).toMatch(/biểu thức/);
    expect(kiemLuong(luong([nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat")], [noi("a", "main", "t")]), dk).loi.join()).toMatch(/không nhận nối vào|không có cổng vào/);
  });

  it("chu trình bị từ chối", () => {
    const kq = kiemLuong(
      luong([nut("t", "kich-hoat.thu-cong"), nut("a", "du-lieu.dat"), nut("b", "du-lieu.dat")], [noi("t", "main", "a"), noi("a", "main", "b"), noi("b", "main", "a")]),
      dk,
    );
    expect(kq.ok).toBe(false);
    expect(kq.loi.join()).toMatch(/chu trình/);
  });

  it("id node xấu (đường dẫn) bị zod chặn", () => {
    expect(kiemLuong(luong([nut("../x", "kich-hoat.thu-cong")], []), dk).ok).toBe(false);
  });
});

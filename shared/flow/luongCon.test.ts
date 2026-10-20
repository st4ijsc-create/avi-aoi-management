/**
 * ★★ Luồng AI Đợt 8.4 — `kiemLuong` với LUỒNG CON (thuần): hạng luồng = max(node, luồng con); id luồng con phải CỐ ĐỊNH;
 * tự gọi chính mình bị từ chối; luồng con không có phiên bản hoạt động ⇒ lỗi; vắng bộ đọc hạng (client) ⇒ chỉ kiểm cú pháp.
 */
import { describe, expect, it } from "vitest";
import { kiemLuong, luongConCuaNut, type HangTacDungPhu, type KhaiBaoNut } from "./model";

const kb = (type: string, laKichHoat = false, congRa = ["main"]): KhaiBaoNut => ({
  type, typeVersion: 1, laKichHoat, congVao: laKichHoat ? [] : ["main"], congRa, tacDungPhu: "thuan", lapLai: "idempotent",
});
const SO: Record<string, KhaiBaoNut> = {
  "kich-hoat.thu-cong": kb("kich-hoat.thu-cong", true),
  "luong.goi-con": kb("luong.goi-con"),
  "ai.agent": kb("ai.agent"),
};
const dk = (t: string) => SO[t];
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0], parameters });
const luong = (nodes: unknown[]) => ({ id: "cha", name: "cha", version: 1, nodes: [nut("t", "kich-hoat.thu-cong"), ...nodes], connections: [] });
const HANG: Record<string, HangTacDungPhu | null> = { "con-thuan": "thuan", "con-doc": "doc", "con-ghi": "ngoai-ghi", "con-ot": "ot", "chua-bat": null };
const hangLuongCon = (id: string) => (id in HANG ? HANG[id] : null);

describe("kiemLuong — luồng con (Đợt 8.4)", () => {
  it("hạng luồng = hạng cao nhất của luồng con (goi-con)", () => {
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "con-thuan" })]), dk, { hangLuongCon })).toMatchObject({ ok: true, hang: "thuan", luongCon: ["con-thuan"] });
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "con-ghi" })]), dk, { hangLuongCon })).toMatchObject({ ok: true, hang: "ngoai-ghi" });
  });

  it("hạng agent = hạng cao nhất trong các tool luồng con (kể cả node agent TẮT)", () => {
    const a = nut("a", "ai.agent", { luongCon: [{ flowId: "con-doc" }, { flowId: "con-ot" }] });
    expect(kiemLuong(luong([a]), dk, { hangLuongCon })).toMatchObject({ ok: true, hang: "ot", luongCon: ["con-doc", "con-ot"] });
    expect(kiemLuong(luong([{ ...a, disabled: true }]), dk, { hangLuongCon }).hang).toBe("ot");
  });

  it("id luồng con là BIỂU THỨC / thiếu / sai khuôn ⇒ không hợp lệ (id động lách được kiểm hạng)", () => {
    for (const p of [{ flowId: "{{ $json.f }}" }, {}, { flowId: "../x" }, { flowId: 5 }]) {
      const kq = kiemLuong(luong([nut("g", "luong.goi-con", p)]), dk, { hangLuongCon });
      expect(kq.ok, JSON.stringify(p)).toBe(false);
      expect(kq.loi.join(" ")).toMatch(/CỐ ĐỊNH/);
    }
    const kq = kiemLuong(luong([nut("a", "ai.agent", { luongCon: [{ flowId: "{{ $json.f }}" }] })]), dk, { hangLuongCon });
    expect(kq.ok).toBe(false);
    expect(kiemLuong(luong([nut("a", "ai.agent", { luongCon: "con-ghi" })]), dk, { hangLuongCon }).ok).toBe(false);
  });

  it("tự gọi chính mình ⇒ lỗi; luồng con chưa có phiên bản hoạt động ⇒ lỗi", () => {
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "cha" })]), dk, { hangLuongCon }).loi.join(" ")).toMatch(/chính nó/);
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "chua-bat" })]), dk, { hangLuongCon }).loi.join(" ")).toMatch(/chưa có phiên bản hoạt động/);
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "khong-co" })]), dk, { hangLuongCon }).ok).toBe(false);
  });

  it("vắng bộ đọc hạng (client) ⇒ hợp lệ cú pháp, hạng chỉ theo node", () => {
    expect(kiemLuong(luong([nut("g", "luong.goi-con", { flowId: "con-ghi" })]), dk)).toMatchObject({ ok: true, hang: "thuan", luongCon: ["con-ghi"] });
  });

  it("luongConCuaNut: node khác loại ⇒ rỗng", () => {
    expect(luongConCuaNut(nut("x", "du-lieu.dat", { flowId: "con-ghi" }))).toEqual({ ids: [], loi: [] });
  });
});

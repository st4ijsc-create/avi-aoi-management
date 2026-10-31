// Đợt 10.4b L4 — reducer: `xong.vetNgoai` kiểm kiểu rồi mới vào trạng thái; `ha-tu-tri` do PHIÊN có lượt ngoài khác `ha-tu-tri` do nội dung đáng ngờ.
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { TRANG_THAI_RONG, giamSuKien } from "./trangThaiAgent";
import { bocVetNgoaiLuot } from "@/lib/loiNgoai";

const chay = (es: SuKienAgent[]) => es.reduce(giamSuKien, TRANG_THAI_RONG);
const BD = { loai: "bat-dau", runId: "r1", cheDo: "hoi" } as SuKienAgent;
const xong = (vetNgoai: unknown) => ({ loai: "xong", lyDo: "hoan-thanh", vetNgoai }) as unknown as SuKienAgent;
const VET = { nhaCungCap: "openai", model: "gpt-test", tokenVao: 10, tokenRa: 5, chiPhiUocUsd: 0.5 };

describe("bocVetNgoaiLuot", () => {
  it("gói đủ ⇒ giữ; số âm / không hữu hạn / không phải số ⇒ null từng ô; chuỗi dài bị cắt", () => {
    expect(bocVetNgoaiLuot(VET)).toEqual(VET);
    expect(bocVetNgoaiLuot({ ...VET, tokenVao: -1, tokenRa: Infinity, chiPhiUocUsd: "1" })).toEqual({ ...VET, tokenVao: null, tokenRa: null, chiPhiUocUsd: null });
    const dai = bocVetNgoaiLuot({ ...VET, nhaCungCap: "a".repeat(500), model: "m".repeat(500) });
    expect(dai?.nhaCungCap).toHaveLength(64);
    expect(dai?.model).toHaveLength(160);
  });
  it("thiếu nhà cung cấp / model, hoặc không phải object ⇒ null", () => {
    for (const x of [null, undefined, 5, "x", [], { model: "m" }, { nhaCungCap: "a" }, { nhaCungCap: "", model: "m" }]) expect(bocVetNgoaiLuot(x)).toBeNull();
  });
});

describe("reducer — xong.vetNgoai", () => {
  it("có vết hợp lệ ⇒ vào ketThuc; không có ⇒ ketThuc y như cũ (không khoá vetNgoai)", () => {
    expect(chay([BD, xong(VET)]).ketThuc).toEqual({ lyDo: "hoan-thanh", vetNgoai: VET });
    const cu = chay([BD, { loai: "xong", lyDo: "hoan-thanh" } as SuKienAgent]).ketThuc!;
    expect(cu).toEqual({ lyDo: "hoan-thanh" });
    expect("vetNgoai" in cu).toBe(false);
  });
  it("gói hỏng ⇒ KHÔNG vào trạng thái", () => {
    expect("vetNgoai" in chay([BD, xong({ model: "m" })]).ketThuc!).toBe(false);
  });
});

describe("reducer — ha-tu-tri", () => {
  it("do PHIÊN có lượt ngoài ⇒ mục mang lyDo, daHaTuTri vẫn false", () => {
    const s = chay([BD, { loai: "ha-tu-tri", lyDo: "phien-co-luot-ngoai", nguon: "phien", mau: [] } as SuKienAgent]);
    expect(s.daHaTuTri).toBe(false);
    expect(s.dongThoiGian.at(-1)).toMatchObject({ kieu: "canh-bao", loaiCanhBao: "ha-tu-tri", lyDo: "phien-co-luot-ngoai" });
  });
  it("do nội dung đáng ngờ (và sự kiện cũ không có lyDo) ⇒ daHaTuTri true, mục KHÔNG mang lyDo", () => {
    for (const ev of [{ loai: "ha-tu-tri", lyDo: "noi-dung-dang-ngo", nguon: "web", mau: [] }, { loai: "ha-tu-tri", nguon: "web", mau: [] }]) {
      const s = chay([BD, ev as unknown as SuKienAgent]);
      expect(s.daHaTuTri).toBe(true);
      expect("lyDo" in (s.dongThoiGian.at(-1) as object)).toBe(false);
    }
  });
});

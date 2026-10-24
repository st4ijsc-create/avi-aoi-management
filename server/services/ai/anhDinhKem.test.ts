/**
 * ★ Đợt 9 (2026-10-24) — kiểm ảnh đính kèm + ngưỡng tài nguyên trước khi nạp sidecar thị giác (số đo: spec
 * 2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md). Cùng tệp ghim `chuyenMessageLenDay` (ảnh ⇒ mảng phần OpenAI) và ngân sách ảnh.
 */
import { describe, it, expect } from "vitest";
import { kiemAnhDataUrl, kiemDanhSachAnh, kiemTaiNguyenSidecar, mimeTheoByteDau, type AnhHopLe } from "./anhDinhKem";
import { chuyenMessageLenDay } from "../aiLlamaServerClient";
import { nganSachTuHoiThoai, TOKEN_UOC_LUONG_MOI_ANH } from "../aiGgufEngine";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)]);
const du = (b: Buffer, mime = "image/png") => `data:${mime};base64,${b.toString("base64")}`;

describe("kiemAnhDataUrl", () => {
  it("PNG/JPEG/WebP theo byte đầu; MIME chuẩn hoá theo byte, không theo tiền tố", () => {
    expect(mimeTheoByteDau(PNG)).toBe("image/png");
    expect(mimeTheoByteDau(JPG)).toBe("image/jpeg");
    expect(mimeTheoByteDau(WEBP)).toBe("image/webp");
    const r = kiemAnhDataUrl(du(JPG, "image/png")) as AnhHopLe;
    expect(r.mime).toBe("image/jpeg");
    expect(r.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });
  it("http(s) URL ⇒ ANH_SAI_DINH_DANG (không tải ⇒ không SSRF); byte lạ ⇒ ANH_SAI_DINH_DANG", () => {
    expect(kiemAnhDataUrl("https://169.254.169.254/x.png")).toMatchObject({ loi: "ANH_SAI_DINH_DANG" });
    expect(kiemAnhDataUrl(du(Buffer.from("GIF89a-------")))).toMatchObject({ loi: "ANH_SAI_DINH_DANG" });
    expect(kiemAnhDataUrl("")).toMatchObject({ loi: "ANH_SAI_DINH_DANG" });
  });
  it("vượt trần byte ⇒ ANH_QUA_LON (trần đọc từ env)", () => {
    const lon = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    expect(kiemAnhDataUrl(du(lon), { AI_ANH_MAX_MB: "1" })).toMatchObject({ loi: "ANH_QUA_LON" });
    expect((kiemAnhDataUrl(du(lon), { AI_ANH_MAX_MB: "6" }) as AnhHopLe).mime).toBe("image/png");
  });
});

describe("kiemDanhSachAnh", () => {
  const a = (byte: number) => ({ mime: "image/png", byte, dataUrl: "", buffer: Buffer.alloc(0) }) as AnhHopLe;
  it("mặc định ≤ 4 ảnh và tổng ≤ 12 MB", () => {
    expect(kiemDanhSachAnh([a(1), a(1), a(1), a(1)], {})).toBeNull();
    expect(kiemDanhSachAnh([a(1), a(1), a(1), a(1), a(1)], {})).toMatchObject({ loi: "QUA_NHIEU_ANH" });
    expect(kiemDanhSachAnh([a(5e6), a(5e6), a(5e6)], {})).toMatchObject({ loi: "ANH_QUA_LON" });
  });
});

describe("kiemTaiNguyenSidecar — ngưỡng từ số đo (11.000 MiB VRAM trống, 15 GB commit trống)", () => {
  const GiB = 1024 ** 3, MiB = 1024 ** 2;
  const vram = (trongMb: number) => async () => ({ totalBytes: 32 * GiB, usedBytes: 32 * GiB - trongMb * MiB });
  it("35B thường sẵn sàng (đo: 23.958 MiB dùng ⇒ còn 8.649) ⇒ KHÔNG đủ — bản ngưỡng 8.500 đầu tiên LỌT ca này", async () => {
    expect((await kiemTaiNguyenSidecar({ vram: vram(8649), commit: async () => 24 }, {})).du).toBe(false);
  });
  it("35B thường (đo: còn ~8.200 MiB) ⇒ KHÔNG đủ, lý do nêu số", async () => {
    const r = await kiemTaiNguyenSidecar({ vram: vram(8200), commit: async () => 24 }, {});
    expect(r.du).toBe(false);
    expect(r.lyDo).toContain("8200 MiB");
  });
  it("VRAM đủ nhưng commit trống thấp ⇒ KHÔNG đủ", async () => {
    const r = await kiemTaiNguyenSidecar({ vram: vram(12000), commit: async () => 10 }, {});
    expect(r).toMatchObject({ du: false });
    expect(r.lyDo).toContain("bộ nhớ ảo");
  });
  it("đủ cả hai ⇒ đủ; commit không đọc được (không phải Windows) ⇒ chỉ xét VRAM", async () => {
    expect((await kiemTaiNguyenSidecar({ vram: vram(11500), commit: async () => 20 }, {})).du).toBe(true);
    expect((await kiemTaiNguyenSidecar({ vram: vram(11500), commit: async () => null }, {})).du).toBe(true);
  });
  it("VRAM không đọc được ⇒ KHÔNG đủ (đóng theo mặc định)", async () => {
    expect((await kiemTaiNguyenSidecar({ vram: async () => null, commit: async () => 30 }, {})).du).toBe(false);
  });
});

describe("chuyenMessageLenDay + ngân sách ảnh", () => {
  it("user có ảnh ⇒ content = [text, image_url…]; không ảnh ⇒ chuỗi như cũ", () => {
    const r = chuyenMessageLenDay({ role: "user", content: "xem", anh: ["data:image/png;base64,AAA"] });
    expect(r.content).toEqual([{ type: "text", text: "xem" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }]);
    expect(chuyenMessageLenDay({ role: "user", content: "xem" }).content).toBe("xem");
  });
  it("ảnh trên vai khác user ⇒ NÉM (không bỏ im lặng)", () => {
    expect(() => chuyenMessageLenDay({ role: "assistant", content: "x", anh: ["data:image/png;base64,AAA"] })).toThrow(/vai user/);
  });
  it("ngân sách ngữ cảnh tính mỗi ảnh ~4.200 token", () => {
    const co = nganSachTuHoiThoai({ messages: [{ role: "user", content: "x", anh: ["a", "b"] }] }).prompt.length;
    const khong = nganSachTuHoiThoai({ messages: [{ role: "user", content: "x" }] }).prompt.length;
    expect(co - khong).toBeGreaterThanOrEqual(2 * TOKEN_UOC_LUONG_MOI_ANH * 2.8);
  });
});

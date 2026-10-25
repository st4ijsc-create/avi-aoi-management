/**
 * ★ Đợt 9 (2026-10-25, dieu-phoi) — CENSUS: lưới KHÔNG chạm :8091 / GPU thật qua hàng rào nạp in-process hay đo tươi của broker.
 * Sự cố gốc: hai lưới vram đỏ/xanh theo lượng VRAM máy đang dùng. Ca này đỏ nếu (a) `vitest.setup.ts` thôi đặt bản giả, (b) hai module
 * thôi đọc bản giả toàn cục, hoặc (c) một đường mới gọi đầu dò thật mà bỏ qua `phuThuocHienHanh()` / `docThietBiHienHanh()`.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("hàng rào nạp in-process + đo tươi broker — không chạm máy thật trong lưới", () => {
  it("vitest.setup.ts nằm trong setupFiles và đặt CẢ HAI bản giả", () => {
    expect(readFileSync("vitest.config.ts", "utf8")).toMatch(/setupFiles:\s*\[[^\]]*vitest\.setup\.ts/);
    const s = readFileSync("vitest.setup.ts", "utf8");
    expect(s).toContain('Symbol.for("avi.ai.napServerNgoai.phuThuocTest")');
    expect(s).toContain('Symbol.for("avi.vram.tickTuoi.docThietBiTest")');
  });
  it("phuThuocHienHanh() dùng bản giả: KHÔNG fetch :8091, KHÔNG đọc thiết bị thật", async () => {
    vi.resetModules();
    const fetchGia = vi.fn(async () => { throw new Error("không được gọi fetch thật"); });
    vi.stubGlobal("fetch", fetchGia);
    vi.doMock("../vram/vramProbe", () => ({ readDeviceVramUncached: vi.fn(async () => { throw new Error("không được đo GPU thật"); }) }));
    const m = await import("./napServerNgoai");
    const d = m.phuThuocHienHanh();
    expect(await d.modelServer("http://127.0.0.1:8091", 500)).toBeNull();
    expect(await d.vram()).toBeNull();
    expect(fetchGia).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.doUnmock("../vram/vramProbe");
  });
  it("AI_NAP_DO_SONG=1 ⇒ bỏ bản giả (ca đo sống tường minh)", async () => {
    const m = await import("./napServerNgoai");
    expect(m.phuThuocHienHanh({ AI_NAP_DO_SONG: "1" })).toBe(m.phuThuocMacDinh);
  });
  it("broker: tick null + lượt lớn ⇒ đọc bản giả toàn cục (thiết bị trống), không gọi đầu dò thật", async () => {
    vi.resetModules();
    const that = vi.fn(async () => { throw new Error("không được đo GPU thật"); });
    vi.doMock("../vram/vramProbe", () => ({ readDeviceVramUncached: that, readDeviceVram: that }));
    const tt = await import("../vram/vramTickTuoi");
    const t = await tt.tickChoQuyetDinh(22 * 1024 ** 3, 32 * 1024 ** 3, 100);
    expect(t?.deviceUsedBytes).toBe(0);
    expect(that).not.toHaveBeenCalled();
    vi.doUnmock("../vram/vramProbe");
  });
});

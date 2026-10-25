/**
 * ★ Đợt 9 (2026-10-25) — hàng rào nạp GGUF in-process (`napServerNgoai.ts`). Số đo gốc: 4B in-process 5.540 MiB dedicated (tệp 2.428 MiB);
 * 35B nạp lần hai trong vitest đẩy VRAM :8091 24 → 8,8 GB. Đột biến phải bắt: bỏ cổng tiến trình ⇒ §A đỏ; bỏ nhánh cùng-model ⇒ §B đỏ;
 * so cỡ TỆP thay vì dấu chân ⇒ §C "4B khi card còn 6 GB" đỏ; bỏ biên an toàn ⇒ §C "vừa khít" đỏ; coi "không đo được" là trống ⇒ §D đỏ.
 */
import { describe, it, expect, vi } from "vitest";
import { kiemNapKhiServerNgoaiSong, dauChanUocTinh, type PhuThuocNapServerNgoai } from "./napServerNgoai";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const TONG = 32_607 * MiB;
const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const M4 = "Qwen3-4B-Instruct-2507-UD-Q4_K_XL";
const CO4 = 2_546_340_960;
const dep = (o: Partial<PhuThuocNapServerNgoai> = {}) => ({
  coTep: vi.fn(async () => CO4 as number | null),
  modelServer: vi.fn(async () => M35 as string | null),
  vram: vi.fn(async () => ({ totalBytes: TONG, usedBytes: 24_000 * MiB }) as { usedBytes: number; totalBytes: number } | null),
  laMayChu: vi.fn(() => true),
  ...o,
});
const goi = (d: PhuThuocNapServerNgoai, model = M4, env: NodeJS.ProcessEnv = {}) =>
  kiemNapKhiServerNgoaiSong(model, `D:/m/${model}.gguf`, "loadGgufModel", d, env);
const ma = (p: Promise<unknown>) => p.then(() => "QUA", (e) => e.code);

describe("§A — cổng tiến trình", () => {
  it("không phải máy chủ, không cờ ⇒ NAP_IN_PROCESS_BI_TAT, không thăm dò gì", async () => {
    const d = dep({ laMayChu: vi.fn(() => false) });
    expect(await ma(goi(d))).toBe("NAP_IN_PROCESS_BI_TAT");
    expect(d.modelServer).not.toHaveBeenCalled();
    expect(d.vram).not.toHaveBeenCalled();
  });
  it("không phải máy chủ + AI_CHO_NAP_TRONG_TIEN_TRINH=1 ⇒ đi tiếp tới kiểm VRAM", async () => {
    const d = dep({ laMayChu: vi.fn(() => false) });
    expect(await ma(goi(d, M4, { AI_CHO_NAP_TRONG_TIEN_TRINH: "1" }))).toBe("QUA");
    expect(d.vram).toHaveBeenCalled();
  });
});

describe("§B — llama-server ngoài phục vụ CÙNG model ⇒ NAP_TRUNG_SERVER_NGOAI", () => {
  it("ném có mã + hướng dẫn", async () => {
    const e = await goi(dep({ coTep: vi.fn(async () => 22 * GiB) }), M35).catch((x) => x);
    expect(e.code).toBe("NAP_TRUNG_SERVER_NGOAI");
    expect(e.message).toContain("LLAMA_SERVER_ENABLED=true");
  });
});

describe("§C — dấu chân so với VRAM trống đo tươi", () => {
  it("công thức: tệp × 1,0 + 3.112 MiB ⇒ 4B ≈ 5.540 MiB (khớp số đo)", () => {
    expect(Math.round(dauChanUocTinh(CO4) / MiB)).toBe(5540);
  });
  it("cấu hình thường trú: :8091 24.000 MiB, card còn ~8,4 GB ⇒ :3000 nạp 4B QUA", async () => {
    expect(await ma(goi(dep()))).toBe("QUA");
  });
  it("tiến trình thứ hai: card còn 6 GB (một bản 4B đã nằm) ⇒ VRAM_KHONG_DU_NAP dù tệp chỉ 2,4 GB", async () => {
    const d = dep({ vram: vi.fn(async () => ({ totalBytes: TONG, usedBytes: TONG - 6 * GiB })) });
    expect(await ma(goi(d))).toBe("VRAM_KHONG_DU_NAP");
  });
  it("vừa khít dấu chân nhưng thiếu biên 1.536 MiB ⇒ từ chối; đủ biên ⇒ qua", async () => {
    const vua = (trongMb: number) => dep({ vram: vi.fn(async () => ({ totalBytes: TONG, usedBytes: TONG - trongMb * MiB })) });
    expect(await ma(goi(vua(5540 + 100)))).toBe("VRAM_KHONG_DU_NAP");
    expect(await ma(goi(vua(5540 + 1536 + 10)))).toBe("QUA");
  });
  it("model khác lớn (27B 17,6 GB) khi :8091 giữ 35B ⇒ VRAM_KHONG_DU_NAP", async () => {
    const d = dep({ coTep: vi.fn(async () => 17_612_564_704) });
    expect(await ma(goi(d, "Qwen3.6-27B-UD-Q4_K_XL"))).toBe("VRAM_KHONG_DU_NAP");
  });
});

describe("§D — không đo được VRAM", () => {
  it("server ngoài đang sống ⇒ từ chối (không đoán là trống)", async () => {
    expect(await ma(goi(dep({ vram: vi.fn(async () => null) })))).toBe("VRAM_KHONG_DU_NAP");
  });
  it("không server ngoài (máy CPU / không GPU) ⇒ qua như cũ", async () => {
    expect(await ma(goi(dep({ vram: vi.fn(async () => null), modelServer: vi.fn(async () => null) })))).toBe("QUA");
  });
  it("không có tệp thật / không có đường tệp ⇒ qua (không căn cứ), sau cổng tiến trình", async () => {
    expect(await ma(goi(dep({ coTep: vi.fn(async () => null) })))).toBe("QUA");
    expect(await ma(kiemNapKhiServerNgoaiSong(M4, undefined, "x", dep(), {}))).toBe("QUA");
  });
  it("thăm dò URL từ LLAMA_SERVER_URL, mặc định :8091, hạn 500 ms", async () => {
    const d = dep({ modelServer: vi.fn(async () => null) });
    await goi(d, M4, {});
    await goi(d, M4, { LLAMA_SERVER_URL: "http://127.0.0.1:9999" });
    expect(d.modelServer.mock.calls).toEqual([["http://127.0.0.1:8091", 500], ["http://127.0.0.1:9999", 500]]);
  });
});

describe("§E — điểm vào máy chủ đánh dấu tiến trình", () => {
  it("server/_core/index.ts gọi danhDauTienTrinhMayChu() ở thân module (không thì :3000 bị chặn nạp 4B/embedder)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/_core/index.ts", "utf8");
    expect(src).toMatch(/^danhDauTienTrinhMayChu\(\);$/m);
  });
});

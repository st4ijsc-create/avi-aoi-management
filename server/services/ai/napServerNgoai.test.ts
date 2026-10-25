/**
 * ★ Đợt 9 (2026-10-25) — hàng rào nạp in-process khi llama-server NGOÀI sống (không phụ thuộc env). Sự cố: vitest thiếu
 * LLAMA_SERVER_ENABLED nạp 35B in-process, Windows đẩy VRAM :8091 24 → 8,8 GB. Đột biến phải bắt: bỏ nhánh cùng-model ⇒ §B đỏ;
 * bỏ nhánh VRAM ⇒ §C đỏ; bỏ ngưỡng cỡ ⇒ §A (model nhỏ thăm dò) đỏ.
 */
import { describe, it, expect, vi } from "vitest";
import { kiemNapKhiServerNgoaiSong, type PhuThuocNapServerNgoai } from "./napServerNgoai";

const GiB = 1024 ** 3;
const dep = (o: Partial<PhuThuocNapServerNgoai> = {}) => ({
  coTep: vi.fn(async () => 22 * GiB),
  modelServer: vi.fn(async () => "Qwen3.6-35B-A3B-UD-Q4_K_XL" as string | null),
  vram: vi.fn(async () => ({ totalBytes: 32 * GiB, usedBytes: 25 * GiB })),
  ...o,
});
const M35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL";
const goi = (d: PhuThuocNapServerNgoai, model = M35, env: NodeJS.ProcessEnv = {}) =>
  kiemNapKhiServerNgoaiSong(model, `D:/m/${model}.gguf`, "loadGgufModel", d, env);

describe("§A — chỉ GGUF lớn mới thăm dò", () => {
  it("≤ 8 GiB ⇒ cho qua, KHÔNG thăm dò server", async () => {
    const d = dep({ coTep: vi.fn(async () => 2.5 * GiB) });
    await expect(goi(d, "Qwen3-4B-Instruct-2507-UD-Q4_K_XL")).resolves.toBeUndefined();
    expect(d.modelServer).not.toHaveBeenCalled();
  });
  it("không đọc được cỡ tệp / không có đường tệp ⇒ cho qua", async () => {
    const d = dep({ coTep: vi.fn(async () => null) });
    await expect(goi(d)).resolves.toBeUndefined();
    await expect(kiemNapKhiServerNgoaiSong(M35, undefined, "x", dep())).resolves.toBeUndefined();
  });
  it("server KHÔNG trả lời ⇒ cho qua (hành vi cũ)", async () => {
    const d = dep({ modelServer: vi.fn(async () => null) });
    await expect(goi(d)).resolves.toBeUndefined();
    expect(d.vram).not.toHaveBeenCalled();
  });
  it("thăm dò URL lấy từ LLAMA_SERVER_URL, mặc định :8091, hạn 500 ms", async () => {
    const d = dep({ modelServer: vi.fn(async () => null) });
    await goi(d, M35, {});
    await goi(d, M35, { LLAMA_SERVER_URL: "http://127.0.0.1:9999" });
    expect(d.modelServer.mock.calls).toEqual([["http://127.0.0.1:8091", 500], ["http://127.0.0.1:9999", 500]]);
  });
});

describe("§B — server đang phục vụ CÙNG model ⇒ NÉM NAP_TRUNG_SERVER_NGOAI", () => {
  it("ném có mã + hướng dẫn LLAMA_SERVER_ENABLED", async () => {
    const e = await goi(dep()).catch((x) => x);
    expect(e.code).toBe("NAP_TRUNG_SERVER_NGOAI");
    expect(e.message).toContain("LLAMA_SERVER_ENABLED=true");
  });
  it("so theo basename (có .gguf / đường dẫn vẫn khớp)", async () => {
    const d = dep({ modelServer: vi.fn(async () => M35) });
    const e = await kiemNapKhiServerNgoaiSong(`${M35}.gguf`, `D:/m/${M35}.gguf`, "x", d, {}).catch((x) => x);
    expect(e.code).toBe("NAP_TRUNG_SERVER_NGOAI");
  });
});

describe("§C — server sống, model KHÁC ⇒ theo VRAM", () => {
  const khac = (vram: PhuThuocNapServerNgoai["vram"]) => dep({ modelServer: vi.fn(async () => "Qwen3.6-27B-UD-Q4_K_XL"), vram });
  it("VRAM trống < cỡ × 1,1 ⇒ NÉM VRAM_KHONG_DU_SERVER_NGOAI", async () => {
    const e = await goi(khac(vi.fn(async () => ({ totalBytes: 32 * GiB, usedBytes: 24 * GiB })))).catch((x) => x);
    expect(e.code).toBe("VRAM_KHONG_DU_SERVER_NGOAI");
  });
  it("không đo được VRAM ⇒ NÉM (đóng theo mặc định)", async () => {
    const e = await goi(khac(vi.fn(async () => null))).catch((x) => x);
    expect(e.code).toBe("VRAM_KHONG_DU_SERVER_NGOAI");
  });
  it("VRAM đủ ⇒ cho qua", async () => {
    await expect(goi(khac(vi.fn(async () => ({ totalBytes: 80 * GiB, usedBytes: 24 * GiB }))))).resolves.toBeUndefined();
  });
});

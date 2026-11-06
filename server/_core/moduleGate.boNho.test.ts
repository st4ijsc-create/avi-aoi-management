/**
 * ★ Pha 0 P0-4 (2026-11-04) — bộ nhớ RAM 60 s của cổng giấy phép (`moduleGate`): 0 truy vấn DB khi ấm, lượt đồng thời dùng chung một lượt
 * đọc, lượt đọc lỗi KHÔNG được lưu (fail-safe allow vẫn như cũ), hết hạn / `xoaBoNhoGiayPhep` / ghi hàng giấy phép ⇒ đọc lại.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const getAllLicensesMock = vi.fn();
vi.mock("../db", () => ({ getAllLicenses: (...a: unknown[]) => getAllLicensesMock(...a) }));
vi.mock("../license/license-service", () => ({ licenseService: { loadLicenseStateCache: () => null } }));

const KHOA_ENV = ["LICENSE_MODULE_GATE_ENABLED", "LICENSE_BYPASS"] as const;
async function napCong() {
  vi.resetModules();
  for (const k of KHOA_ENV) delete process.env[k];
  process.env.LICENSE_MODULE_GATE_ENABLED = "true";
  return import("./moduleGate");
}
const sku = (mods: string[]) =>
  getAllLicensesMock.mockImplementation(async (o: { status?: string }) => (o?.status === "active" ? { licenses: [{ allowedModules: mods }] } : { licenses: [] }));

beforeEach(() => {
  getAllLicensesMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of KHOA_ENV) delete process.env[k];
});

describe("moduleGate — bộ nhớ giấy phép 60 s", () => {
  it("★★★ 135 lượt gọi ⇒ ĐÚNG 2 truy vấn (active + expired) — 0 truy vấn khi ấm; phán quyết không đổi", async () => {
    sku(["MOD_ANALYTICS"]);
    const g = await napCong();
    const kq = [];
    for (let i = 0; i < 135; i++) kq.push(await g.isModuleLicensed(i % 2 ? "MOD_AI" : "MOD_ANALYTICS"));
    expect(getAllLicensesMock).toHaveBeenCalledTimes(2);
    expect(kq.filter((x, i) => (i % 2 ? x === false : x === true))).toHaveLength(135);
  });

  it("★★ lượt ĐỒNG THỜI dùng chung một lượt đọc", async () => {
    sku(["MOD_AI"]);
    const g = await napCong();
    const kq = await Promise.all(Array.from({ length: 20 }, () => g.isModuleLicensed("MOD_AI")));
    expect(kq.every(Boolean)).toBe(true);
    expect(getAllLicensesMock).toHaveBeenCalledTimes(2);
  });

  it("★★★ hết 60 s ⇒ đọc lại (giấy phép đổi có hiệu lực); trước 60 s ⇒ giữ", async () => {
    sku(["MOD_AI"]);
    const g = await napCong();
    expect(await g.isModuleLicensed("MOD_AI")).toBe(true);
    sku(["MOD_ANALYTICS"]);
    vi.setSystemTime(Date.now() + g.TTL_GIAY_PHEP_MS - 1);
    expect(await g.isModuleLicensed("MOD_AI")).toBe(true);
    vi.setSystemTime(Date.now() + 2);
    expect(await g.isModuleLicensed("MOD_AI")).toBe(false);
    expect(g.TTL_GIAY_PHEP_MS).toBe(60_000);
  });

  it("★★★ lượt đọc NÉM ⇒ fail-safe CHO QUA như cũ VÀ không lưu (lượt sau đọc lại, thấy phán quyết thật)", async () => {
    getAllLicensesMock.mockRejectedValue(new Error("DB down"));
    const g = await napCong();
    expect(await g.isModuleLicensed("MOD_AI")).toBe(true);
    sku(["MOD_ANALYTICS"]);
    expect(await g.isModuleLicensed("MOD_AI")).toBe(false);
  });

  it("★★ xoaBoNhoGiayPhep ⇒ đọc lại ngay; middleware tRPC cũng dùng bộ nhớ", async () => {
    sku(["MOD_AI"]);
    const g = await napCong();
    const next = vi.fn(async () => "ok");
    const ctx = { user: { id: 1, role: "user" } } as never;
    await g.moduleGate("MOD_AI")({ ctx, next });
    await g.moduleGate("MOD_AI")({ ctx, next });
    expect(getAllLicensesMock).toHaveBeenCalledTimes(2);
    sku(["MOD_ANALYTICS"]);
    g.xoaBoNhoGiayPhep();
    await expect(g.moduleGate("MOD_AI")({ ctx, next })).rejects.toThrow(/MODULE_NOT_LICENSED/);
  });

  it("★ mọi hàm GHI hàng giấy phép ở db/license.ts bỏ bộ nhớ (create / update / updateByKey / delete / revoke / unrevoke)", () => {
    const src = readFileSync(join(__dirname, "..", "db", "license.ts"), "utf8");
    for (const ten of ["createLicense", "updateLicense", "updateLicenseByKey", "deleteLicense", "revokeLicense", "unrevokeLicense"]) {
      const dau = src.indexOf(`export async function ${ten}(`);
      const cuoi = src.indexOf("\nexport ", dau + 10);
      expect(src.slice(dau, cuoi === -1 ? undefined : cuoi), ten).toContain("await boBoNhoCongModule();");
    }
  });
});

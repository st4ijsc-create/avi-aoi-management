/**
 * doc 81 Đợt 5 H7 (mục 32) — đường tệp state cache giấy phép ĐỔI ĐƯỢC bằng env `LICENSE_STATE_CACHE_PATH`, CHỈ cho tiến trình
 * thử (instance đo / test): trước đây hard-code `cwd/server/license/license-state-cache.json` ⇒ một instance thử với giấy phép
 * thử GHI ĐÈ cache của repo/dev (sự cố 2026-08-19). Luật: đường TUYỆT ĐỐI, và KHÔNG BAO GIỜ có hiệu lực khi
 * NODE_ENV=production (khi đó bỏ qua + cảnh báo, dùng đường mặc định như cũ).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT = (cwd: string) => path.join(cwd, "server", "license", "license-state-cache.json");

describe("H7 — resolveLicenseStateCachePath", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => warn.mockRestore());

  it("không đặt ⇒ đường mặc định như cũ", async () => {
    const { resolveLicenseStateCachePath } = await import("./license-service");
    expect(resolveLicenseStateCachePath({}, "/repo")).toBe(DEFAULT("/repo"));
    expect(resolveLicenseStateCachePath({ LICENSE_STATE_CACHE_PATH: "  " }, "/repo")).toBe(DEFAULT("/repo"));
  });

  it("đường tuyệt đối, không production ⇒ dùng override", async () => {
    const { resolveLicenseStateCachePath } = await import("./license-service");
    const p = path.join(os.tmpdir(), "h7-cache", "state.json");
    expect(resolveLicenseStateCachePath({ LICENSE_STATE_CACHE_PATH: p, NODE_ENV: "development" }, "/repo")).toBe(path.resolve(p));
    expect(resolveLicenseStateCachePath({ LICENSE_STATE_CACHE_PATH: p }, "/repo")).toBe(path.resolve(p));
  });

  it("NODE_ENV=production ⇒ BỎ QUA override (cảnh báo), mặc định", async () => {
    const { resolveLicenseStateCachePath } = await import("./license-service");
    const p = path.join(os.tmpdir(), "h7-cache", "state.json");
    expect(resolveLicenseStateCachePath({ LICENSE_STATE_CACHE_PATH: p, NODE_ENV: "production" }, "/repo")).toBe(DEFAULT("/repo"));
    expect(warn).toHaveBeenCalled();
  });

  it("đường TƯƠNG ĐỐI ⇒ bỏ qua (cảnh báo), mặc định", async () => {
    const { resolveLicenseStateCachePath } = await import("./license-service");
    expect(resolveLicenseStateCachePath({ LICENSE_STATE_CACHE_PATH: "tmp/state.json", NODE_ENV: "test" }, "/repo")).toBe(DEFAULT("/repo"));
    expect(warn).toHaveBeenCalled();
  });
});

describe("H7 — licenseService ghi/đọc ĐÚNG đường override, KHÔNG chạm tệp của repo", () => {
  const saved = process.env.LICENSE_STATE_CACHE_PATH;
  afterEach(() => {
    if (saved === undefined) delete process.env.LICENSE_STATE_CACHE_PATH;
    else process.env.LICENSE_STATE_CACHE_PATH = saved;
    vi.resetModules();
  });

  it("save ⇒ tệp ở override; load đọc lại từ đó; tệp mặc định của repo không xuất hiện / không đổi", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "h7-lic-"));
    const p = path.join(dir, "state.json");
    const repoFile = DEFAULT(process.cwd());
    const before = fs.existsSync(repoFile) ? fs.statSync(repoFile).mtimeMs : null;
    process.env.LICENSE_STATE_CACHE_PATH = p;
    vi.resetModules();
    const mod = await import("./license-service");
    const { licenseService } = mod;
    // CẦU CHÌ: chưa chắc đường đã đổi ⇒ KHÔNG gọi save (bản trước H7 sẽ ghi đè tệp của repo — lượt RED đầu tiên đã ghi
    // nó một lần và được xoá ngay, xem báo cáo H7).
    expect(typeof mod.resolveLicenseStateCachePath).toBe("function");
    expect(mod.resolveLicenseStateCachePath(process.env, process.cwd())).toBe(path.resolve(p));
    expect(licenseService.stateCacheFilePath).toBe(path.resolve(p));
    const cache = { state: "normal", licenseKey: "H7-CACHE-PATH-PROBE", customerName: "Probe", licenseType: "standard", expiresAt: null, allowedModules: ["MOD_AI"], cachedAt: Date.now() };
    licenseService.saveLicenseStateCache(cache as never);
    expect(JSON.parse(fs.readFileSync(p, "utf8")).allowedModules).toEqual(["MOD_AI"]);
    expect(licenseService.loadLicenseStateCache()?.licenseKey).toBe("H7-CACHE-PATH-PROBE");
    const after = fs.existsSync(repoFile) ? fs.statSync(repoFile).mtimeMs : null;
    expect(after).toBe(before);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

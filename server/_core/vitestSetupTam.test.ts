/**
 * ★ 2026-11-03 (do-model, dieu-phoi duyệt) — canh THƯ MỤC TẠM của `vitest.setup.ts` / `vitest.globalSetup.ts`: không mục nào được tạo
 * thẳng dưới `os.tmpdir()`; mọi thứ nằm trong `%TEMP%/aoi-vitest/<lượt>/<pid>-…/` và bị xoá khi xong — kể cả khi tệp test ĐỎ.
 * Gốc: %TEMP% từng phình 1,28 triệu mục (2 thư mục / tệp test không xoá) ⇒ lstat(%TEMP%) 300–600 ms ⇒ test repo tạm chập chờn.
 */
import { describe, expect, inject, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import setupLuot, { TEN_GOC_TAM_LUOI } from "../../vitest.globalSetup";

const REPO = resolve(__dirname, "..", "..");
const GOC = resolve(tmpdir(), TEN_GOC_TAM_LUOI);
const duoi = (cha: string, con: string) => {
  const r = relative(cha, con);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};

describe("thư mục tạm của lưới", () => {
  it("★★★ globalSetup cấp gốc lượt DƯỚI %TEMP%/aoi-vitest; thư mục tạm của tệp này nằm trong gốc lượt", () => {
    const luot = inject("aoiTamLuot");
    expect(typeof luot).toBe("string");
    expect(dirname(luot)).toBe(GOC);
    const khoaKhe = process.env.LLAMA_WATCHDOG_PAUSE_FILE!;
    expect(duoi(luot, khoaKhe), khoaKhe).toBe(true);
    expect(existsSync(dirname(khoaKhe))).toBe(true);
    expect(existsSync(khoaKhe), "thư mục khoá khe RỖNG (không có tệp ⇒ không khoá)").toBe(false);
    const rml = process.env.ROBOT_MOTION_LOCK_PENDING_DIR!;
    expect(duoi(luot, rml), rml).toBe(true);
    expect(existsSync(rml)).toBe(true);
    // không mục nào của setup là con TRỰC TIẾP của %TEMP%
    for (const p of [dirname(khoaKhe), rml]) expect(dirname(p)).not.toBe(resolve(tmpdir()));
  });

  it("★★★ nguồn setup: không mkdtemp thẳng dưới os.tmpdir(); thư mục tạm của tệp bị xoá ở afterAll", () => {
    const src = readFileSync(join(REPO, "vitest.setup.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/mkdtemp(Sync)?\(\s*(path\.)?(resolve|join)\(\s*(os\.)?tmpdir\(\)/);
    expect(src).not.toMatch(/mkdtemp(Sync)?\(\s*(os\.)?tmpdir\(\)/);
    expect(src).toMatch(/afterAll\(\(\) => \{\s*try \{\s*rmSync\(THU_MUC_TAM_TEP, \{ recursive: true, force: true/);
    const cfg = readFileSync(join(REPO, "vitest.config.ts"), "utf8");
    expect(cfg).toContain('globalSetup: ["./vitest.globalSetup.ts"]');
  });

  it("★★ globalSetup: tạo gốc lượt mới dưới aoi-vitest, provide đúng đường, teardown xoá sạch", () => {
    let duocCap = "";
    const don = setupLuot({ provide: (_k, v) => (duocCap = v) });
    expect(dirname(duocCap)).toBe(GOC);
    expect(existsSync(duocCap)).toBe(true);
    don();
    expect(existsSync(duocCap)).toBe(false);
  });

  it("★★★ chạy THẬT một tệp test ĐỎ với %TEMP% rỗng ⇒ sau lượt, gốc %TEMP% chỉ còn aoi-vitest và nó RỖNG", () => {
    const tam = mkdtempSync(join(REPO, "node_modules", ".cache-vitest-tam-"));
    try {
      const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "server/_core/vitestSetupTam.fixture.test.ts"], {
        cwd: REPO,
        env: { ...process.env, TEMP: tam, TMP: tam, TMPDIR: tam, AOI_VITEST_TAM_DO_THU: "1", VITEST_MAX_FORKS: "1" },
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: 170_000,
      });
      const out = `${r.stdout}\n${r.stderr}`;
      expect(r.status, out.slice(-1500)).toBe(1); // tệp phụ kiện đỏ cố ý
      expect(out).toContain("đỏ cố ý (phụ kiện vitestSetupTam)");
      const goc = readdirSync(tam).filter((t) => t !== "vite" && !t.startsWith("node-compile-cache"));
      expect(goc, "gốc %TEMP% sau lượt").toEqual([TEN_GOC_TAM_LUOI]);
      expect(readdirSync(join(tam, TEN_GOC_TAM_LUOI)), "aoi-vitest sau lượt").toEqual([]);
    } finally {
      rmSync(tam, { recursive: true, force: true, maxRetries: 3 });
    }
  }, 180_000);
});

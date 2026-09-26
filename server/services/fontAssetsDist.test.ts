/**
 * Nhóm C · việc 1 — `dist/` must carry its own PDF fonts.
 *
 * MEASURED before this net existed:
 *   • `server/assets/fonts/BeVietnamPro-Regular.ttf` exists in the source tree.
 *   • `npm run build` copied NOTHING out of it — `find dist -iname "*BeVietnam*"`
 *     returned 0 files (the 20 .ttf hits under dist/ were the client's KaTeX fonts).
 *   • The only fontDirCandidates() entry that hit under the bundle was
 *     `join(process.cwd(), "server", "assets", "fonts")` — i.e. the running server
 *     read fonts out of the SOURCE TREE sitting next to dist/.
 *   • `Dockerfile:43-46` ships `dist`, `drizzle`, `scripts`, `knowledge` and NOT
 *     `server/`, and `scripts/build-secure.mjs` ships `dist-secure/` alone ⇒ on
 *     both, that last candidate resolves to a path that does not exist and
 *     `fontAssets` (fail-loud by design) kills every Vietnamese PDF export.
 *
 * So the interesting claim is NOT "the fonts exist somewhere". It is:
 *   **the build output alone is enough, with the process.cwd() fallback dead.**
 * `dist_self_sufficient` proves exactly that, by running a real esbuild bundle of
 * fontAssets.ts from a throwaway `dist/` whose cwd contains no source tree — and
 * `negative_control` proves the same probe genuinely FAILS without the copy step,
 * so a green `dist_self_sufficient` cannot be coming from some other candidate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COPY_SCRIPT = join(REPO_ROOT, "scripts", "copy-font-assets.mjs");
const SRC_FONT_DIR = join(REPO_ROOT, "server", "assets", "fonts");
const REGULAR = "BeVietnamPro-Regular.ttf";

/**
 * Entry that exercises the real loader. Bundled with the same esbuild flags the
 * `build` script uses, so `import.meta.url` — and therefore `HERE` — lands in the
 * fake dist/ exactly as it does in dist/index.js.
 */
const PROBE_SRC = `
import { getVietnameseFontBuffers, isCjkFontAvailable } from "./server/services/fontAssets";
const { regular, bold } = getVietnameseFontBuffers();
console.log(JSON.stringify({ regular: regular.length, bold: bold.length, cjk: isCjkFontAvailable() }));
`;

/** A throwaway tree: <root>/dist/probe.mjs + <root>/elsewhere (the hostile cwd). */
async function makeFakeDist(): Promise<{ root: string; distDir: string; cwd: string }> {
  const root = mkdtempSync(join(tmpdir(), "font-dist-"));
  const distDir = join(root, "dist");
  const cwd = join(root, "elsewhere");
  mkdirSync(distDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  await build({
    stdin: { contents: PROBE_SRC, resolveDir: REPO_ROOT, sourcefile: "probe.ts", loader: "ts" },
    platform: "node",
    packages: "external",
    bundle: true,
    format: "esm",
    outfile: join(distDir, "probe.mjs"),
    logLevel: "silent",
  });
  return { root, distDir, cwd };
}

/**
 * Run the probe. `cwd` is a directory with no `server/assets/fonts` beneath it, so
 * the process.cwd() fail-safe cannot rescue the run; FONT_ASSETS_DIR is stripped
 * because it is candidate #1 and would mask every other candidate (it is absent
 * from .env today — `grep -c FONT_ASSETS_DIR .env` → 0 — but a test must not
 * depend on that staying true).
 */
function runProbe(distDir: string, cwd: string): { ok: boolean; out: string } {
  const env = { ...process.env };
  delete env.FONT_ASSETS_DIR;
  try {
    const out = execFileSync(process.execPath, [join(distDir, "probe.mjs")], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}` };
  }
}

describe("dist carries its own PDF fonts (nhóm C việc 1)", () => {
  beforeAll(() => {
    // Guard the guard: without the source fonts every assertion below is vacuous.
    expect(existsSync(join(SRC_FONT_DIR, REGULAR))).toBe(true);
  });

  it("negative_control: the probe FAILS when dist has no fonts copied into it", async () => {
    const { distDir, cwd } = await makeFakeDist();
    const r = runProbe(distDir, cwd);
    expect(r.ok).toBe(false);
    expect(r.out).toContain("[fontAssets]");
    expect(r.out).toContain(REGULAR);
  }, 120_000);

  it("dist_self_sufficient: after the build's copy step the probe loads the VN font with no source tree in cwd", async () => {
    const { distDir, cwd } = await makeFakeDist();
    execFileSync(process.execPath, [COPY_SCRIPT, "--dest", join(distDir, "assets", "fonts")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const r = runProbe(distDir, cwd);
    expect(r.ok, r.out).toBe(true);
    const parsed = JSON.parse(r.out.trim()) as { regular: number; bold: number; cjk: boolean };
    // Byte-for-byte identical to the source font — not merely "some file loaded".
    expect(parsed.regular).toBe(statSync(join(SRC_FONT_DIR, REGULAR)).size);
    expect(parsed.bold).toBeGreaterThan(50_000);
  }, 120_000);

  it("build_wiring: `npm run build` invokes the font copy step", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toContain("scripts/copy-font-assets.mjs");
  });

  it("build_secure_wiring: dist-secure/ carries the assets dir too", () => {
    const src = readFileSync(join(REPO_ROOT, "scripts", "build-secure.mjs"), "utf8");
    const m = src.match(/const clientDirs\s*=\s*\[([^\]]*)\]/);
    expect(m, "clientDirs array not found in build-secure.mjs").toBeTruthy();
    expect(m![1]).toContain("'assets'");
  });

  it("copy_script_refuses_to_produce_a_fontless_dist", async () => {
    const { distDir } = await makeFakeDist();
    const emptySrc = mkdtempSync(join(tmpdir(), "font-src-empty-"));
    let failed = false;
    let output = "";
    try {
      execFileSync(
        process.execPath,
        [COPY_SCRIPT, "--src", emptySrc, "--dest", join(distDir, "assets", "fonts")],
        { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      failed = true;
      const e = err as { stdout?: string; stderr?: string };
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(failed).toBe(true);
    expect(output).toContain("required font(s) missing");
  }, 120_000);
});

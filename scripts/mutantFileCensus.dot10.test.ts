/**
 * doc 81 Đợt 10 task F2 — ruling R-10-ab: MUTANT COPIES NEVER LIVE IN THE REPO.
 *
 * The mutation runners of this đợt write each mutant as an untracked sibling copy named `<file>.m<LETTER(S)><n>[x].<ext>`
 * (e.g. `edgeConfigSource.mS2.ts`, `edgeAuthorizeCentral.mB13.ts`, `edgeGatewayRuntime.mY3.ts`) and delete it afterwards.
 * Security scans #67 / #79 / #81 / #85 / #87 each flagged such a transient mutant as if it were product code. A mutant that
 * is COMMITTED, or LEFT BEHIND in `server/` / `client/`, is worse than noise: it is a deliberately broken copy of a safety
 * path that an import, a glob or a later reader can pick up.
 *
 *   ∀ path tracked by git:                     its basename does NOT match the mutant pattern;
 *   ∀ file on disk under server/ and client/:  its basename does NOT match the mutant pattern.
 *
 * ⚠ The disk half is red WHILE a mutation runner is mid-run (its copy exists for seconds) — that is the point: at integration
 *   and at commit time nothing may be left. Re-run after the runner finishes; a file that is still there is a real leftover.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `<stem>.m<1–3 capitals><digits>[one lowercase letter].<ext…>` — the runners' naming (mS2, mB13, mY3, mF10b, mW2). */
const MUTANT_BASENAME = /\.m[A-Z]{1,3}\d+[a-z]?\.[A-Za-z0-9.]+$/;

function isMutantPath(p: string): boolean {
  return MUTANT_BASENAME.test(path.basename(p));
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite", "coverage"]);

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && isMutantPath(e.name)) out.push(path.relative(ROOT, full).replace(/\\/g, "/"));
  }
}

describe("R-10-ab — mutant copies are never tracked and never left in server/ or client/", () => {
  it("the pattern recognises the runners' names and nothing ordinary (fuse)", () => {
    for (const p of ["server/services/edge/edgeConfigSource.mS2.ts", "server/services/edge/edgeAuthorizeCentral.mB13.ts", "x/edgeExecutionAgent.mW2.ts", "a/b.mY3.test.ts", "c/d.mF10b.ts", "client/src/x.mK1.tsx"]) {
      expect(isMutantPath(p), p).toBe(true);
    }
    for (const p of ["server/services/edge/edgeConfigSource.ts", "server/x.mock.ts", "server/x.m.ts", "a/b.dot10.db.test.ts", "a/b.mjs", "a/schema.m2.ts", "a/b.mx2.ts", "a/README.md", "server/x.mS.ts"]) {
      expect(isMutantPath(p), p).toBe(false);
    }
  });

  it("∀ tracked path: not a mutant copy", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).split("\0").filter(Boolean);
    expect(tracked.length, "git ls-files returned nothing — the census would be blind").toBeGreaterThan(1000);
    const bad = tracked.filter(isMutantPath);
    expect(bad, "a mutant copy is TRACKED — remove it from the index (git rm --cached) and delete it; mutants live untracked and are removed by the runner").toEqual([]);
  });

  it("∀ file on disk under server/ and client/: not a mutant copy (left behind by a runner)", () => {
    const left: string[] = [];
    walk(path.join(ROOT, "server"), left);
    walk(path.join(ROOT, "client"), left);
    expect(left, "a mutant copy was LEFT on disk — a runner did not clean up (or is still running: re-run once it finishes)").toEqual([]);
  });
});

/**
 * A2(n) T7b-1d lượt sửa 1 (H30, dieu-phoi 09/11) — CENSUS: a step an Abort cancelled is read from its row by one constant (foeRunStore.LOI_HUY_BOI_ABORT, laHangHuyBoiAbort). Every source of those words goes through it,
 * or a cancelled row stops being read as one and a STOP behind it is lost at the press, in silence. Another `kind: "aborted"` of the engine has other words and is listed here: it is not an Abort's cancel.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { LOI_HUY_BOI_ABORT, laHangHuyBoiAbort } from "./foeRunStore";

const GOC = resolve(__dirname, "../../..");
const FOE = resolve(__dirname);
const nguon = (dir: string, out: string[] = []): string[] => {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) nguon(p, out);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.startsWith("__")) out.push(p);
  }
  return out;
};
const NOI_KHAC = [`Precondition failed for step`, `Edge claim is no longer current`];

describe("A2(n) T7b-1d — the words of an Abort's cancel have one source", () => {
  it("the literal stands once in the server's sources, at the constant", () => {
    const co = nguon(GOC).flatMap((p) => {
      const s = readFileSync(p, "utf8");
      return s.includes(LOI_HUY_BOI_ABORT) ? [relative(GOC, p).split(sep).join("/")] : [];
    });
    expect(co).toEqual(["services/orchestration/foe/foeRunStore.ts"]);
    const s = readFileSync(join(FOE, "foeRunStore.ts"), "utf8");
    expect(s.split(`"${LOI_HUY_BOI_ABORT}"`).length - 1).toBe(1);
    expect(s).toContain(`export const LOI_HUY_BOI_ABORT = "${LOI_HUY_BOI_ABORT}"`);
  });
  it('every `kind: "aborted"` of the engine: the constant, or words listed as another kind of end', () => {
    const dong = readFileSync(join(FOE, "foeEngine.ts"), "utf8").split(/\r?\n/).filter((l) => /kind: "aborted"; error|kind: "aborted", error/.test(l));
    const quaHang = dong.filter((l) => /kind: "aborted", error: LOI_HUY_BOI_ABORT\b/.test(l));
    const khac = dong.filter((l) => /kind: "aborted", error/.test(l) && !quaHang.includes(l));
    expect(quaHang.length, "ABORTED_OUTCOME and execStep").toBe(2);
    expect(khac.length).toBe(NOI_KHAC.length);
    for (const l of khac) expect(NOI_KHAC.some((x) => l.includes(x)), l).toBe(true);
  });
  it("the predicate: failed and exactly those words; the read of it is in one place of the sweep", () => {
    expect(laHangHuyBoiAbort({ status: "failed", error: LOI_HUY_BOI_ABORT })).toBe(true);
    expect(laHangHuyBoiAbort({ status: "completed", error: LOI_HUY_BOI_ABORT })).toBe(false);
    expect(laHangHuyBoiAbort({ status: "failed", error: `FOE_OUTCOME_UNKNOWN: ${LOI_HUY_BOI_ABORT}` })).toBe(false);
    expect(laHangHuyBoiAbort({ status: "failed", error: null })).toBe(false);
    expect(laHangHuyBoiAbort(undefined)).toBe(false);
    expect(readFileSync(join(FOE, "foeEngine.ts"), "utf8").split("laHangHuyBoiAbort(").length - 1).toBe(1);
  });
});

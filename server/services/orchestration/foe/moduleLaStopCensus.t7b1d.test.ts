/**
 * A2(n) T7b-1d lượt sửa 1 (H29, dieu-phoi 09/11) — CENSUS: two answers on a STOP's road that need nothing loaded: whether a command type is a stop, and whether SEC_PLATFORM is on. Each lives in a module of its own that imports
 * nothing, and is defined there only: a load that hangs or fails cannot turn a STOP into a non-STOP, and a walk with the flag off does not wait for the policy's module.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isStopCommandType } from "../../ot/loaiLenhStop";
import { secPlatformEnabled } from "../../security/secPlatformFlag";

const GOC = resolve(__dirname, "../../..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");
const nguon = (dir: string, out: string[] = []): string[] => {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten);
    if (statSync(p).isDirectory()) nguon(p, out);
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten) && !ten.startsWith("__")) out.push(p);
  }
  return out;
};
/** a comment is no code: a sentence may name the words */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("A2(n) T7b-1d — the leaf modules of a STOP's road", () => {
  for (const tep of ["services/ot/loaiLenhStop.ts", "services/security/secPlatformFlag.ts"]) {
    it(`${tep} imports nothing`, () => {
      const s = boChuThich(doc(tep));
      expect(s).not.toMatch(/\bimport\b/);
      expect(s).not.toMatch(/\brequire\(/);
    });
  }
  it("one definition of the stop types: the leaf's; the dispatcher exports it again; FOE reads the leaf", () => {
    const hai = nguon(GOC).flatMap((p) => {
      const s = boChuThich(readFileSync(p, "utf8"));
      const so = /===\s*["']stop["'][^\n;]*===\s*["']e_stop["']|===\s*["']e_stop["'][^\n;]*===\s*["']stop["']|new Set\(\[\s*["'](stop|e_stop)["']\s*,\s*["'](stop|e_stop)["']\s*\]\)/.test(s);
      return so ? [relative(GOC, p).split(sep).join("/")] : [];
    });
    expect(hai).toEqual(["services/ot/loaiLenhStop.ts"]);
    expect(doc("services/ot/commandDispatcher.ts")).toMatch(/export \{ isStopCommandType \} from "\.\/loaiLenhStop"/);
    const lop = doc("services/orchestration/foe/foeStepClass.ts");
    expect(lop).toMatch(/import \{ isStopCommandType \} from "\.\.\/\.\.\/ot\/loaiLenhStop"/);
    const than = /export async function isOtStopCommandType\(name: string\): Promise<boolean> \{([\s\S]*?)\n\}/.exec(boChuThich(lop))?.[1] ?? "";
    expect(than.trim(), "nothing loaded on the way: the leaf's answer, no other").toBe("return isStopCommandType(name);");
  });
  it("what it says: the two stop types, any case, trimmed; nothing else", () => {
    for (const t of ["stop", "e_stop", " STOP ", "E_Stop"]) expect(isStopCommandType(t)).toBe(true);
    for (const t of ["start", "abort", "reset", "", "stopp"]) expect(isStopCommandType(t)).toBe(false);
    expect(isStopCommandType(undefined as never)).toBe(false);
  });
  it("one definition of the flag: the leaf's; the policy gate exports it again; the engine reads the leaf and loads the gate only behind it", () => {
    const hai = nguon(GOC).flatMap((p) => (/\.SEC_PLATFORM\s*===/.test(boChuThich(readFileSync(p, "utf8"))) ? [relative(GOC, p).split(sep).join("/")] : []));
    expect(hai).toEqual(["services/security/secPlatformFlag.ts"]);
    expect(doc("services/security/policyGate.ts")).toMatch(/export \{ secPlatformEnabled \} from "\.\/secPlatformFlag"/);
    const e = boChuThich(doc("services/orchestration/foe/foeEngine.ts"));
    expect(e).toMatch(/import \{ secPlatformEnabled \} from "\.\.\/\.\.\/security\/secPlatformFlag"/);
    expect(e.split("await napPolicy()").length - 1, "no bare wait: each load has its bound").toBe(0);
  });
  it("the flag: on for true or 1, else off", () => {
    expect(secPlatformEnabled({ SEC_PLATFORM: "true" } as never)).toBe(true);
    expect(secPlatformEnabled({ SEC_PLATFORM: "1" } as never)).toBe(true);
    expect(secPlatformEnabled({ SEC_PLATFORM: "false" } as never)).toBe(false);
    expect(secPlatformEnabled({} as never)).toBe(false);
  });
});

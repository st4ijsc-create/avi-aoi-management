/**
 * doc 81 Đợt 11 task H — the R-10-t rule for 0377 (migration0377Guard.mjs), pure:
 *   • the revert list is EXACTLY the migrations that (re-)define a function 0377 owns (census over drizzle/);
 *   • a file of that list after 0377 is refused unless --then-0377 (migrate-standalone: or --then-0376) — unless 0377 itself
 *     runs after it in the same pass; a DB without 0377 proceeds;
 *   • fix 1 (review H-R8): the STOP functions lock the device before EVERY request lock (not only the first).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// DOT11_H_GUARD (mutation runs only): an untracked copy of the module
const { decide0377, FILE_0377, REVERTED_BY_REAPPLY_0377, reapply0377, stopLockOrderViolations, THEN_0377_FLAG } = (await import(process.env.DOT11_H_GUARD || "./migration0377Guard.mjs")) as typeof import("./migration0377Guard.mjs");

const DRIZZLE = path.resolve(__dirname, "../drizzle");
const F0374 = "0374_edge_device_ownership_and_lock_authority.sql";
const F0327 = "0327_tenant_rls_null_la_du_lieu_dung_chung.sql";
const OWNED = ["app_tenant_allows", "factory_timezone", "db_storage_timezone", "to_factory_time", "refresh_qw_caches", "ensure_measurement_samples_partition", "edge_stop_ack_edge", "edge_stop_ack_central", "edge_stop_resolve"];

describe("Đợt 11 H — 0377 guard (decision)", () => {
  it("★ fix 1 (H-R3): the revert list is EXACTLY the migrations that define a function 0377 re-creates", () => {
    const re = new RegExp(String.raw`FUNCTION\s+(?:public\.)?"?(${OWNED.join("|")})"?\s*\(`, "i");
    const defining = readdirSync(DRIZZLE)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f !== FILE_0377)
      .filter((f) => re.test(readFileSync(path.join(DRIZZLE, f), "utf8").replace(/--[^\n]*/g, "")))
      .sort();
    expect(defining.length).toBeGreaterThanOrEqual(20); // 0 ⇒ the instrument is blind
    expect(Object.keys(REVERTED_BY_REAPPLY_0377).sort()).toEqual(defining);
    expect(defining).toContain("0159_aoi_embedding_head_dataset.sql");
    for (const f of ["0149", "0151", "0152", "0155"]) expect(defining.some((x) => x.startsWith(f))).toBe(false);
  });
  it("0374 / 0327 after 0377 ⇒ refused (names what reverts and the flag); with --then-0377 ⇒ then-0377", () => {
    for (const f of [F0374, F0327]) {
      const r = decide0377({ files: [f], applied0377: true, args: ["--test-only"] });
      expect(r.action).toBe("refuse");
      expect(r.message).toMatch(/Nothing was run\. Re-run with --then-0377/);
      expect(decide0377({ files: [f], applied0377: true, args: ["--test-only", THEN_0377_FLAG] }).action).toBe("then-0377");
    }
    expect(decide0377({ files: [F0374], applied0377: true, args: [] }).message).toMatch(/edge_stop_ack_edge \/ edge_stop_ack_central \/ edge_stop_resolve/);
    expect(decide0377({ files: [F0327], applied0377: true, args: [] }).message).toMatch(/app_tenant_allows/);
  });
  it("★ fix 1 (H-R2): migrate-standalone — --then-0376 also re-appends 0377; 0377 later in the same pass ⇒ proceed", () => {
    const ms = { thenFlags: [THEN_0377_FLAG, "--then-0376"] };
    expect(decide0377({ files: [F0327], applied0377: true, args: ["--then-0376"], ...ms }).action).toBe("then-0377");
    expect(decide0377({ files: [F0327], applied0377: true, args: ["--then-0376"] }).action).toBe("refuse"); // single-file runners: only --then-0377
    expect(decide0377({ files: [F0327, "0376_pin_function_search_path.sql", FILE_0377], applied0377: true, args: [] }).action).toBe("proceed");
    expect(decide0377({ files: [FILE_0377, F0327], applied0377: true, args: [] }).action).toBe("refuse");
    expect(decide0377({ files: ["0372_edge_step_authorizations.sql", "0376_pin_function_search_path.sql"], applied0377: true, args: [] }).action).toBe("proceed");
  });
  it("a DB without 0377 ⇒ proceed", () => {
    expect(decide0377({ files: [F0374, F0327], applied0377: false, args: [] }).action).toBe("proceed");
  });
  it("reapply0377 runs the 0377 apply script on the SAME target and throws unless it exited 0", () => {
    const calls: string[][] = [];
    reapply0377("test", { spawn: ((_: string, a: string[]) => (calls.push(a), { status: 0 })) as never, log: () => undefined });
    expect(calls[0].slice(-1)).toEqual(["--test-only"]);
    expect(calls[0][0]).toMatch(/apply-migration-0377\.mjs$/);
    expect(() => reapply0377("dev", { spawn: (() => ({ status: 1 })) as never, log: () => undefined })).toThrow(/FAILED \(exit 1\)/);
    expect(() => reapply0377("prod" as never)).toThrow(/unknown target/);
  });
});

/** the CREATE … $$ … $$ text of `fn` in a migration */
function fnText(file: string, fn: string): string {
  const src = readFileSync(path.join(DRIZZLE, file), "utf8");
  const at = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  return src.slice(at, src.indexOf("END $$;", at));
}

describe("Đợt 11 H fix 1 (H-R8) — every request lock FOR UPDATE follows a device FOR SHARE", () => {
  it("★ 0377's three STOP functions: no violation; 0374's request-first bodies: violations", () => {
    for (const fn of ["edge_stop_ack_edge", "edge_stop_ack_central", "edge_stop_resolve"]) expect(stopLockOrderViolations(fnText(FILE_0377, fn)), fn).toEqual([]);
    expect(stopLockOrderViolations(fnText(F0374, "edge_stop_ack_edge")).length).toBe(2); // both branches request-first
    expect(stopLockOrderViolations(fnText(F0374, "edge_stop_ack_central")).length).toBe(1);
    expect(stopLockOrderViolations(fnText(F0374, "edge_stop_resolve")).length).toBe(1); // no device lock at all
  });
  it("★ the main branch of edge_stop_ack_edge is checked too (a request lock added before its device lock is caught)", () => {
    const t = fnText(FILE_0377, "edge_stop_ack_edge");
    const second = t.indexOf("-- 0377 lock order", t.indexOf("-- 0377 lock order") + 1);
    const mut = t.slice(0, second) + `PERFORM 1 FROM public."robot_motion_lock_requests" WHERE "id" = p_request FOR UPDATE;\n  ` + t.slice(second);
    expect(stopLockOrderViolations(mut).length).toBe(1);
  });
});

/**
 * doc 81 Đợt 11 task H — the R-10-t rule for 0377 (migration0377Guard.mjs), pure: re-applying 0374 after 0377 is refused unless
 * --then-0377; every other file proceeds; a DB without 0377 proceeds.
 */
import { describe, expect, it } from "vitest";
import { decide0377, FILE_0377, REVERTED_BY_REAPPLY_0377, reapply0377, THEN_0377_FLAG } from "./migration0377Guard.mjs";

const F0374 = "0374_edge_device_ownership_and_lock_authority.sql";

describe("Đợt 11 H — 0377 guard (decision)", () => {
  it("0374 after 0377 ⇒ refused (names the reverted functions and the flag); with --then-0377 ⇒ then-0377", () => {
    const r = decide0377({ file: F0374, applied0377: true, args: ["--test-only"] });
    expect(r.action).toBe("refuse");
    expect(r.message).toMatch(/edge_stop_ack_edge \/ edge_stop_ack_central \/ edge_stop_resolve/);
    expect(r.message).toMatch(/Nothing was run\. Re-run with --then-0377/);
    expect(decide0377({ file: F0374, applied0377: true, args: ["--test-only", THEN_0377_FLAG] })).toEqual({ action: "then-0377" });
  });
  it("0374 on a DB without 0377 ⇒ proceed; any other file ⇒ proceed", () => {
    expect(decide0377({ file: F0374, applied0377: false, args: [] })).toEqual({ action: "proceed" });
    for (const f of ["0372_edge_step_authorizations.sql", "0373_edge_report_streams_and_keys.sql", "0375_edge_robot_trust_approvals.sql", "0376_pin_function_search_path.sql", FILE_0377]) {
      expect(decide0377({ file: f, applied0377: true, args: [] })).toEqual({ action: "proceed" });
    }
    expect(Object.keys(REVERTED_BY_REAPPLY_0377)).toEqual([F0374]);
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

/**
 * doc 81 Đợt 1B Task 6 fix round 1 — the Command Audit Log tells write-ahead INTENT rows apart
 * from RESULT rows. Oracle: the ackValue shapes the dispatcher writes (fixed literals here).
 */
import { describe, it, expect } from "vitest";
import { commandLedgerRole } from "./commandLedger";

describe("commandLedgerRole", () => {
  it("intent row", () => {
    expect(commandLedgerRole({ ledger: "intent" })).toEqual({ kind: "intent" });
  });
  it("result row linked to its intent", () => {
    expect(commandLedgerRole({ ledger: "result", intentId: 41 })).toEqual({ kind: "result", intentId: 41 });
  });
  it("result row without a usable intentId", () => {
    expect(commandLedgerRole({ ledger: "result", intentId: "41" })).toEqual({ kind: "result", intentId: null });
  });
  it("rows without a ledger marker (simulated / rejected / legacy) ⇒ null", () => {
    for (const v of [null, undefined, 1, "intent", [], {}, { ledger: "other" }]) {
      expect(commandLedgerRole(v)).toBeNull();
    }
  });
});

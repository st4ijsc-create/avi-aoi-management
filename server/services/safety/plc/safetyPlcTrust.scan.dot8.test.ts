/**
 * doc 81 Đợt 8 task N fix scan (security scan on 87a061041, ruling R-8-a) — separation of duties of the safety-PLC config
 * maker-checker, as a PURE verdict (each check independently testable):
 *   • the approver differs from EVERY user who changed the config since the last approval (trust-row editor set, the last
 *     editor, and the audit trail — each alone blocks);
 *   • no approval by an invalid / system actor (id ≤ 0, non-integer);
 *   • UNKNOWN provenance (no trust row, no recorded editor, or content changed outside the router since the last recorded
 *     edit) ⇒ TWO distinct approvals of the same digest by two different admins; the first approver can never be the second.
 */
import { describe, it, expect } from "vitest";
import { approvalVerdict, type ApprovalVerdictInput } from "./safetyPlcTrust";

const D = "a".repeat(64);
const D2 = "b".repeat(64);
const known = (over: Partial<NonNullable<ApprovalVerdictInput["row"]>> = {}): NonNullable<ApprovalVerdictInput["row"]> => ({
  lastEditedBy: 1,
  editDigest: D,
  editorsSinceApproval: [1],
  firstApprovedBy: null,
  firstApprovedDigest: null,
  ...over,
});
const v = (i: Partial<ApprovalVerdictInput>) => approvalVerdict({ actorId: 9, row: known(), currentDigest: D, authoredInAudit: false, ...i });

describe("doc 81 Đợt 8 N fix scan — R-8-a separation of duties (pure verdict)", () => {
  it("known provenance, a second person ⇒ approve completes", () => {
    expect(v({})).toEqual({ ok: true, needsSecond: false });
  });

  it("★ the creator / last editor cannot approve", () => {
    expect(v({ actorId: 1 })).toEqual({ ok: false, why: "editor" });
  });

  it("★ A edits, B makes a trivial edit ⇒ A (still in the editor set) cannot approve — even with NO audit evidence", () => {
    expect(v({ actorId: 2, row: known({ lastEditedBy: 3, editorsSinceApproval: [2, 3] }), authoredInAudit: false })).toEqual({ ok: false, why: "editor" });
  });

  it("the audit trail alone blocks an author too (e.g. a trust row that lost its editor set)", () => {
    expect(v({ actorId: 2, row: known({ lastEditedBy: 3, editorsSinceApproval: [3] }), authoredInAudit: true })).toEqual({ ok: false, why: "editor" });
  });

  it("★ invalid / system actors never approve (0, negative, NaN, fractional)", () => {
    for (const actorId of [0, -1, Number.NaN, 1.5]) expect(v({ actorId }), String(actorId)).toEqual({ ok: false, why: "invalid_actor" });
  });

  it("★ legacy row (no trust row) ⇒ first approval only RECORDS (needs a second, different admin)", () => {
    expect(v({ row: null })).toEqual({ ok: true, needsSecond: true });
  });

  it("legacy row with a recorded first approval of the SAME digest: the first approver is refused; another admin completes", () => {
    const row = known({ lastEditedBy: null, editDigest: null, editorsSinceApproval: [], firstApprovedBy: 9, firstApprovedDigest: D });
    expect(v({ actorId: 9, row })).toEqual({ ok: false, why: "first_approver" });
    expect(v({ actorId: 10, row })).toEqual({ ok: true, needsSecond: false });
  });

  it("a first approval of ANOTHER digest does not count (content changed in between ⇒ starts over)", () => {
    const row = known({ lastEditedBy: null, editDigest: null, editorsSinceApproval: [], firstApprovedBy: 9, firstApprovedDigest: D2 });
    expect(v({ actorId: 10, row })).toEqual({ ok: true, needsSecond: true });
  });

  it("★ content changed OUTSIDE the router since the last recorded edit (digest ≠ editDigest) ⇒ unknown editor ⇒ two approvals", () => {
    expect(v({ row: known({ editDigest: D2 }) })).toEqual({ ok: true, needsSecond: true });
  });

  it("no recorded editor (lastEditedBy null) ⇒ two approvals", () => {
    expect(v({ row: known({ lastEditedBy: null, editorsSinceApproval: [] }) })).toEqual({ ok: true, needsSecond: true });
  });
});

describe("doc 81 Đợt 8 N fix scan — each layer alone", () => {
  it("the last editor is refused even when the editor set is empty (layer 1 alone)", () => {
    expect(v({ actorId: 1, row: known({ editorsSinceApproval: [] }) })).toEqual({ ok: false, why: "editor" });
  });

  it("trustRowApproves refuses a row whose approver edited / gave the first approval / is not a real user", async () => {
    const { trustRowApproves, plcTrustDigest } = await import("./safetyPlcTrust");
    const cfg = { id: 1, backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } }, enabled: true } as never;
    const dg = plcTrustDigest(cfg);
    const base = { approvedDigest: dg, approvedBy: 5, lastEditedBy: 3, editorsSinceApproval: [3], firstApprovedBy: null };
    expect(trustRowApproves(cfg, base)).toBe(true);
    expect(trustRowApproves(cfg, { ...base, editorsSinceApproval: [3, 5] })).toBe(false);
    expect(trustRowApproves(cfg, { ...base, firstApprovedBy: 5 })).toBe(false);
    expect(trustRowApproves(cfg, { ...base, approvedBy: 0 })).toBe(false);
    expect(trustRowApproves(cfg, { ...base, lastEditedBy: 5, editorsSinceApproval: [] })).toBe(false);
  });
});

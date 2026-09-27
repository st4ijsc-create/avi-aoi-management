/**
 * doc 81 Đợt 1B Task 6 fix round 1 — role of a command_log row in the write-ahead ledger.
 *
 * Every REAL OT write is two append-only rows: an INTENT (inserted before the device write,
 * `status='sent'`, `ackValue = { ledger: "intent" }`) and its RESULT (`ackValue = { ledger:
 * "result", intentId }`). Rows from other branches (simulated / rejected before the write /
 * legacy rows) carry no ledger marker. The Command Audit Log uses this to tell them apart.
 */
export type CommandLedgerRole =
  | { kind: "intent" }
  | { kind: "result"; intentId: number | null }
  | null;

export function commandLedgerRole(ackValue: unknown): CommandLedgerRole {
  if (!ackValue || typeof ackValue !== "object" || Array.isArray(ackValue)) return null;
  const v = ackValue as { ledger?: unknown; intentId?: unknown };
  if (v.ledger === "intent") return { kind: "intent" };
  if (v.ledger === "result") {
    return { kind: "result", intentId: typeof v.intentId === "number" && Number.isFinite(v.intentId) ? v.intentId : null };
  }
  return null;
}

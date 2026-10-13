/**
 * doc 81 Đợt 10 final fix wave — I-3 (ruling R-10-br, L-7): how the operator console reads a command answer. A STOP queued for an
 * edge node is never shown as a green "accepted":
 *   • `queued_on_edge` ⇒ pending (the owning edge executes and confirms it; the job log shows the outcome);
 *   • `queued_edge_unreachable` ⇒ warning (central cannot reach the node: its fallback STOP was attempted and a critical alert
 *     raised — the operator is told to use the hardware E-STOP if the robot still moves).
 */
export type ConsoleOutcomeTone = "simulated" | "success" | "pending" | "warning" | "error";

export function consoleOutcomeTone(res: { ok: boolean; status: string }): ConsoleOutcomeTone {
  if (res.status === "simulated") return "simulated";
  if (res.status === "queued_edge_unreachable") return "warning";
  if (res.status === "queued_on_edge") return "pending";
  return res.ok ? "success" : "error";
}

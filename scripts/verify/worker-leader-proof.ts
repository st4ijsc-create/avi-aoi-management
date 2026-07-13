/**
 * doc 48 R4 — worker leader-election PROOF (one process = one candidate).
 *
 * The module holds leadership in process-global state, so genuine mutual
 * exclusion can only be shown with SEPARATE PROCESSES. Run two copies:
 *
 *   LEADER_LABEL=A LEADER_HOLD_MS=4000 npx tsx scripts/verify/worker-leader-proof.ts   # holds 4s
 *   LEADER_LABEL=B LEADER_TIMEOUT_MS=2500 npx tsx scripts/verify/worker-leader-proof.ts # gives up at 2.5s
 *
 * Expected: exactly one prints "ACQUIRED"; the other "did NOT acquire".
 * The included runner (worker-leader-proof.run.mjs) orchestrates both cases.
 */
import "dotenv/config";
import {
  acquireWorkerLeadership,
  isWorkerLeader,
  releaseWorkerLeadership,
} from "../../server/_core/workerLeader";

async function main() {
  const label = process.env.LEADER_LABEL || "X";
  const holdMs = Number(process.env.LEADER_HOLD_MS || 3000);
  const timeoutMs = Number(process.env.LEADER_TIMEOUT_MS || 4000);
  const retryMs = Number(process.env.LEADER_RETRY_MS || 400);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await acquireWorkerLeadership({ retryMs, signal: ac.signal });
    clearTimeout(timer);
    console.log(`RESULT ${label}: ACQUIRED leadership (isLeader=${isWorkerLeader()})`);
    await new Promise((r) => setTimeout(r, holdMs)); // hold so a peer sees contention
  } catch (e) {
    console.log(`RESULT ${label}: did NOT acquire — ${(e as Error).message}`);
  } finally {
    await releaseWorkerLeadership();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("proof error:", e);
  process.exit(2);
});

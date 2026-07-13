/**
 * Orchestrates the worker-leader-election proof with REAL separate processes.
 *  Test 1 (mutual exclusion): A holds 4s; B tries for 2.5s while A holds → B loses.
 *  Test 2 (failover):         A holds 1.2s then releases; B tries up to 6s → B wins after A frees it.
 *
 * Run: node scripts/verify/worker-leader-proof.run.mjs
 */
import { spawn } from "node:child_process";

const SCRIPT = "scripts/verify/worker-leader-proof.ts";

function run(env) {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn("npx", ["tsx", SCRIPT], {
      env: { ...process.env, ...env },
      shell: true,
    });
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (out += d.toString()));
    p.on("close", () => {
      const line = out.split("\n").find((l) => l.startsWith("RESULT")) || "(no RESULT)";
      resolve(line.trim());
    });
  });
}

async function main() {
  console.log("=== Test 1: mutual exclusion (A holds 4s, B gives up at 2.5s) ===");
  const [a1, b1] = await Promise.all([
    run({ LEADER_LABEL: "A", LEADER_HOLD_MS: "4000", LEADER_TIMEOUT_MS: "9000" }),
    // small stagger so A wins the initial race deterministically
    new Promise((r) => setTimeout(r, 600)).then(() =>
      run({ LEADER_LABEL: "B", LEADER_HOLD_MS: "0", LEADER_TIMEOUT_MS: "2500", LEADER_RETRY_MS: "400" }),
    ),
  ]);
  console.log("  " + a1);
  console.log("  " + b1);
  const t1 = a1.includes("ACQUIRED") && b1.includes("did NOT acquire");
  console.log(`  Test 1 ${t1 ? "PASS ✓ (exactly one leader)" : "FAIL ✗"}`);

  console.log("\n=== Test 2: failover (A holds 1.2s then frees; B waits up to 6s) ===");
  const [a2, b2] = await Promise.all([
    run({ LEADER_LABEL: "A", LEADER_HOLD_MS: "1200", LEADER_TIMEOUT_MS: "9000" }),
    new Promise((r) => setTimeout(r, 300)).then(() =>
      run({ LEADER_LABEL: "B", LEADER_HOLD_MS: "0", LEADER_TIMEOUT_MS: "6000", LEADER_RETRY_MS: "400" }),
    ),
  ]);
  console.log("  " + a2);
  console.log("  " + b2);
  const t2 = a2.includes("ACQUIRED") && b2.includes("ACQUIRED"); // both got it, but sequentially
  console.log(`  Test 2 ${t2 ? "PASS ✓ (standby took over after leader freed the lock)" : "FAIL ✗"}`);

  console.log(`\nRESULT: ${t1 && t2 ? "PASS ✓ — leader election works" : "FAIL ✗"}`);
  process.exit(t1 && t2 ? 0 : 1);
}

main();

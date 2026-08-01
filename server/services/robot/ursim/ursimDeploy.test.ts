/**
 * I3a-1 — URSim deploy service tests (vitest). Proves the deploy-to-URSim path REUSES
 * the existing gate and opens NO socket when the gate is closed.
 *
 * Mock-backed: getDb mocked (records the program_deployments row we insert). No real
 * URSim needed. Covers:
 *   1. GATE CLOSED (flags off) → status 'simulated', simulated:true, NO socket opened,
 *      detailJson.target='ursim', sent:false — mirrors programmingService dry-run.
 *   2. GATE OPEN (URSIM_ENABLED + DPC_DEPLOY_ENABLED + HITL) but endpoint unreachable →
 *      status 'failed' with an HONEST error (no fabricated deploy).
 *   3. idempotency: a prior terminal row for the key is returned as-is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const inserted: any[] = [];
let priorRow: any = null;

vi.mock("../../../db/connection", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(priorRow ? [priorRow] : []),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        inserted.push(v);
        return { returning: () => Promise.resolve([{ id: 4242 }]) };
      },
    }),
  }),
}));

import { deployUrscriptToUrsim } from "./ursimDeployService";

beforeEach(() => {
  inserted.length = 0;
  priorRow = null;
  delete process.env.URSIM_ENABLED;
  delete process.env.DPC_DEPLOY_ENABLED;
});
afterEach(() => {
  delete process.env.URSIM_ENABLED;
  delete process.env.DPC_DEPLOY_ENABLED;
});

const req = (key: string, confirmedBy?: number) => ({
  urscript: "def prog():\nend",
  endpoint: { host: "127.0.0.1", dashboardPort: 1, scriptPort: 1, timeoutMs: 300 },
  idempotencyKey: key,
  hitl: { actionId: "a1", requestedBy: 7, confirmedBy },
});

describe("deployUrscriptToUrsim gate reuse", () => {
  it("gate CLOSED (flags off) → simulated, no socket, target=ursim", async () => {
    const res = await deployUrscriptToUrsim(req("k-off", 9)); // even with sign-off, flags off
    expect(res.status).toBe("simulated");
    expect(res.simulated).toBe(true);
    expect(res.validation).toBeUndefined(); // no socket path invoked
    expect(inserted).toHaveLength(1);
    expect(inserted[0].detailJson.target).toBe("ursim");
    expect(inserted[0].stage).toBe("staging");
    expect(inserted[0].simulated).toBe(true);
  });

  it("gate CLOSED when no HITL sign-off even with flags on", async () => {
    process.env.URSIM_ENABLED = "true";
    process.env.DPC_DEPLOY_ENABLED = "true";
    const res = await deployUrscriptToUrsim(req("k-nohitl")); // no confirmedBy
    expect(res.status).toBe("simulated");
    expect(res.simulated).toBe(true);
    expect(res.reason).toMatch(/HITL/i);
  });

  it("gate OPEN but URSim unreachable → HONEST 'failed' with error (no fabrication)", async () => {
    process.env.URSIM_ENABLED = "true";
    process.env.DPC_DEPLOY_ENABLED = "true";
    const res = await deployUrscriptToUrsim(req("k-open", 9));
    expect(res.simulated).toBe(false);
    expect(res.status).toBe("failed");
    expect(res.validation?.sent).toBe(false);
    expect(res.reason ?? res.validation?.error).toBeTruthy();
    expect(inserted[0].detailJson.target).toBe("ursim");
  });

  it("idempotency: prior terminal row returned as-is", async () => {
    priorRow = { id: 11, status: "simulated", simulated: true, idempotencyKey: "k-idem" };
    const res = await deployUrscriptToUrsim(req("k-idem", 9));
    expect(res.deploymentId).toBe(11);
    expect(res.status).toBe("simulated");
    expect(inserted).toHaveLength(0); // no new insert
  });
});

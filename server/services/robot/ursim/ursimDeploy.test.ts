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
 *   4. doc 81 Đợt 1B Task 3 fix round 1 — the request carries a `targetId`, never an endpoint:
 *      the gate-open path resolves it through the sim-target registry; unknown target / a
 *      URSIM_HOST that is a real robot ⇒ 'rejected', no socket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const inserted: any[] = [];
let priorRow: any = null;
// Hàng robots cho truy vấn đọc-chỉ của sổ đích giả lập (await thẳng .from(...)).
const deviceRows = vi.hoisted(() => ({ robots: [] as any[] }));

vi.mock("../../../db/connection", async () => {
  const schema = await import("../../../../drizzle/schema");
  return {
  getDb: async () => ({
    select: () => ({
      from: (t: unknown) =>
        Object.assign(Promise.resolve(t === schema.robots ? deviceRows.robots : []), {
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
  };
});

import { deployUrscriptToUrsim } from "./ursimDeployService";

const URSIM_ENV = ["URSIM_ENABLED", "DPC_DEPLOY_ENABLED", "URSIM_HOST", "URSIM_PRIMARY_PORT", "URSIM_DASHBOARD_PORT", "URSIM_TIMEOUT_MS"];
beforeEach(() => {
  inserted.length = 0;
  priorRow = null;
  deviceRows.robots = [];
  for (const k of URSIM_ENV) delete process.env[k];
  // Đích "default" = loopback cổng 1 (đóng) ⇒ không bao giờ có gì trả lời, không ra mạng.
  process.env.URSIM_HOST = "127.0.0.1";
  process.env.URSIM_PRIMARY_PORT = "1";
  process.env.URSIM_DASHBOARD_PORT = "1";
  process.env.URSIM_TIMEOUT_MS = "500";
});
afterEach(() => {
  for (const k of URSIM_ENV) delete process.env[k];
});

const req = (key: string, confirmedBy?: number, targetId = "default") => ({
  urscript: "def prog():\nend",
  targetId,
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

  it("fix round 1 — request KHÔNG còn nhận endpoint (kiểu), chỉ targetId", () => {
    type Req = Parameters<typeof deployUrscriptToUrsim>[0];
    // @ts-expect-error — `endpoint` không còn là trường của UrsimDeployRequest.
    const bad: Req = { ...req("k-type"), endpoint: { host: "192.0.2.10" } };
    expect(bad).toBeTruthy();
  });

  it("fix round 1 — gate OPEN + targetId không tồn tại ⇒ 'rejected', không mở socket", async () => {
    process.env.URSIM_ENABLED = "true";
    process.env.DPC_DEPLOY_ENABLED = "true";
    const res = await deployUrscriptToUrsim(req("k-unknown", 9, "ur-cell-3"));
    expect(res.status).toBe("rejected");
    expect(res.simulated).toBe(true);
    expect(res.validation).toBeUndefined();
    expect(res.reason).toMatch(/Unknown sim target/);
    expect(inserted[0].status).toBe("rejected");
  });

  it("fix round 1 — gate OPEN + URSIM_HOST trùng host một robot thật ⇒ 'rejected', không mở socket", async () => {
    process.env.URSIM_ENABLED = "true";
    process.env.DPC_DEPLOY_ENABLED = "true";
    deviceRows.robots = [{ endpoint: "127.0.0.1:30002", connectionOptions: null }];
    const res = await deployUrscriptToUrsim(req("k-real", 9));
    expect(res.status).toBe("rejected");
    expect(res.validation).toBeUndefined();
    expect(inserted[0].status).toBe("rejected");
  });

  it("idempotency: prior terminal row returned as-is", async () => {
    priorRow = { id: 11, status: "simulated", simulated: true, idempotencyKey: "k-idem" };
    const res = await deployUrscriptToUrsim(req("k-idem", 9));
    expect(res.deploymentId).toBe(11);
    expect(res.status).toBe("simulated");
    expect(inserted).toHaveLength(0); // no new insert
  });
});

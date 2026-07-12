/**
 * /api/v1/policy/* route tests — doc 44 W3-A1 (gap G3.13, spec §13.3/§13.4).
 *
 * Runs registerPolicyRoutes on a real Express app (ephemeral port, global fetch
 * — the apiV1.test.ts pattern): auth (401 / master key), dry-run evaluate
 * (standard PERMIT/DENY shape), policies listing (builtin fallback when the
 * store flag is OFF), audit 503 honesty when the DB is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// Master key validation: accept only "MASTER" in tests.
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// DB layer used by auth (api_keys/machine lookups) — none available in this test.
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async () => undefined),
}));

// DB connection used by the policy store / decision log — unavailable → honest 503 on audit.
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => null),
}));

import { registerPolicyRoutes } from "./policy";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerPolicyRoutes(router);
  app.use("/api/v1", router);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

afterEach(() => {
  delete process.env.POLICY_STORE_ENABLED;
  delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
});

const auth = { Authorization: "Bearer MASTER", "Content-Type": "application/json" };

describe("auth", () => {
  it("no key → 401 envelope", async () => {
    const res = await fetch(`${base}/policy/policies`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

describe("POST /policy/evaluate — dry-run (spec §13.4)", () => {
  it("returns the standardized DENY decision", async () => {
    const res = await fetch(`${base}/policy/evaluate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        subject: "orchestration",
        action: "skip_step",
        resource: "HANOI/ASSY/LINE1",
        context: { step: { type: "AOI" }, product: { class: 3 } },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      decision: "DENY",
      reason_code: "POLICY_DENIED",
      policy_ref: "deny-skip-aoi-class3",
      obligations: [],
    });
    expect(typeof body.data.latency_ms).toBe("number");
  });

  it("PERMIT with obligations for a require-approval rule", async () => {
    const res = await fetch(`${base}/policy/evaluate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "manual_override", context: { zone: { density: 0.9 } } }),
    });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ decision: "PERMIT", obligations: ["require_approval"] });
  });

  it("default-deny group honoured (POLICY_DEFAULT_DENY_ACTIONS)", async () => {
    process.env.POLICY_DEFAULT_DENY_ACTIONS = "ot.command.*";
    const res = await fetch(`${base}/policy/evaluate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ action: "ot.command.start", context: { role: "viewer" } }),
    });
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ decision: "DENY", reason_code: "NO_MATCHING_ALLOW_POLICY" });
  });

  it("missing action → 400", async () => {
    const res = await fetch(`${base}/policy/evaluate`, { method: "POST", headers: auth, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});

describe("GET /policy/policies", () => {
  it("store OFF → the built-in DEFAULT_POLICIES presented as source builtin", async () => {
    const res = await fetch(`${base}/policy/policies`, { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { storeEnabled: boolean; count: number; policies: Array<{ policy_id: string; source: string }> };
    };
    expect(body.data.storeEnabled).toBe(false);
    expect(body.data.count).toBe(3);
    expect(body.data.policies.every((p) => p.source === "builtin")).toBe(true);
    expect(body.data.policies.map((p) => p.policy_id)).toContain("deny-skip-aoi-class3");
  });
});

describe("GET /policy/audit", () => {
  it("db unavailable → honest 503 (never fabricated audit data)", async () => {
    const res = await fetch(`${base}/policy/audit?decision=DENY&limit=10`, { headers: auth });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("policy_audit_unavailable");
  });

  it("bad decision filter → 400", async () => {
    const res = await fetch(`${base}/policy/audit?decision=MAYBE`, { headers: auth });
    expect(res.status).toBe(400);
  });
});

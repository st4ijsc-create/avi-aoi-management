/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-f, review I1) — the owner of an API-v1-started orchestration run is the human who
 * CREATED the API key. CSDL THẬT `_test`. Engine consequences (key holder approving their own run ⇒ refused; no owner ⇒
 * ownerUnknown) are measured in foeGateApproval.dot4.test.ts; this file measures the attribution itself.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import { apiKeyOwnerUserId } from "./apiKeyOwner";

// The HTTP route POST /api/v1/orchestration/runs: only the principal (requireScope) and the engine entry are replaced —
// the route handler and the attribution are real; startRun records what it was asked to do.
const h = vi.hoisted(() => ({ principal: null as null | Record<string, unknown>, calls: [] as unknown[][] }));
vi.mock("./auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./auth")>();
  return {
    ...orig,
    requireScope: () => (req: any, _res: any, next: any) => {
      req.apiPrincipal = h.principal;
      next();
    },
  };
});
vi.mock("../../services/orchestration/foe/foeEngine", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/orchestration/foe/foeEngine")>();
  return {
    ...orig,
    startRun: async (...a: unknown[]) => {
      h.calls.push(a);
      return { ok: true, enabled: true, runId: 1, status: "queued" };
    },
  };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `D4F1K-${Date.now()}`;
let sql: ReturnType<typeof postgres>;
const ids = { u: 0, uOff: 0, k: 0, kNoCreator: 0, kOff: 0 };

describe.skipIf(!DB_URL)("doc 81 Đợt 4 fix round 1 — apiKeyOwnerUserId (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const user = (tag: string, active: boolean) =>
      one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${tag}, 'engineer', ${active}) RETURNING id`);
    ids.u = await user("u", true);
    ids.uOff = await user("off", false);
    const key = (tag: string, createdBy: number | null) =>
      one(sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}-hash`}, ${sql.json(["orchestration:write"])}, ${createdBy}) RETURNING id`);
    ids.k = await key("k", ids.u);
    ids.kNoCreator = await key("k0", null);
    ids.kOff = await key("koff", ids.uOff);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM api_keys WHERE id IN ${sql([ids.k, ids.kNoCreator, ids.kOff].filter(Boolean))}`;
    await sql`DELETE FROM users WHERE id IN ${sql([ids.u, ids.uOff].filter(Boolean))}`;
    await sql.end();
  });

  it("api-key principal ⇒ the key's creator (active); no creator / inactive creator / other principals / bad id ⇒ null", async () => {
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.k })).toBe(ids.u);
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kNoCreator })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kOff })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: 2_000_000_000 })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "master", apiKeyId: ids.k })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key" })).toBeNull();
    expect(await apiKeyOwnerUserId(undefined)).toBeNull();
  });

  it("★ R-4-f HTTP: POST /api/v1/orchestration/runs passes the key creator as ownerUserId (no creator ⇒ null)", async () => {
    const { createV1Router } = await import("./router");
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createV1Router());
    const server: Server = await new Promise((resolve) => {
      const srv = createServer(app).listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const post = () =>
        fetch(`${base}/api/v1/orchestration/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowRef: "wf-x" }) });
      h.principal = { kind: "api-key", name: "k", scopes: ["orchestration:write"], apiKeyId: ids.k, tenantScope: { mode: "global" } };
      expect((await post()).status).toBe(202);
      h.principal = { kind: "api-key", name: "k0", scopes: ["orchestration:write"], apiKeyId: ids.kNoCreator, tenantScope: { mode: "global" } };
      expect((await post()).status).toBe(202);
      expect(h.calls.map((c) => [(c[2] as { id: number }).id, (c[3] as { ownerUserId: number | null }).ownerUserId])).toEqual([
        [0, ids.u],
        [0, null],
      ]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

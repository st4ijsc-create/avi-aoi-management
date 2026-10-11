/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-f, review I1) — the owner of an API-v1-started orchestration run is the human who
 * CREATED the API key. CSDL THẬT `_test`.
 * 2026-10-12 doc 81 Đợt 9 task R1 (option A) — the owner is now the human the key is ISSUED TO (api_keys."holderUserId",
 * mig 0369; default = creator), and the route passes the AUTHENTICATED key id to startRun (recorded on the run). Engine consequences (key holder approving their own run ⇒ refused; no owner ⇒
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
const ids = { u: 0, uOff: 0, h: 0, k: 0, kNoCreator: 0, kOff: 0, kHeld: 0, kNoHolder: 0 };

describe.skipIf(!DB_URL)("doc 81 Đợt 4 fix round 1 — apiKeyOwnerUserId (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const user = (tag: string, active: boolean) =>
      one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${tag}, 'engineer', ${active}) RETURNING id`);
    ids.u = await user("u", true);
    ids.uOff = await user("off", false);
    ids.h = await user("holder", true);
    // Đợt 9 R1 — the holder defaults to the creator (apiKeyRouter.create / mig 0369 backfill); `holder` overrides it.
    const key = (tag: string, createdBy: number | null, holder: number | null = createdBy) =>
      one(sql`INSERT INTO api_keys (name, "keyHash", scopes, "createdBy", "holderUserId") VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}-hash`}, ${sql.json(["orchestration:write"])}, ${createdBy}, ${holder}) RETURNING id`);
    ids.k = await key("k", ids.u);
    ids.kNoCreator = await key("k0", null);
    ids.kOff = await key("koff", ids.uOff);
    ids.kHeld = await key("kheld", ids.u, ids.h); // created by u, ISSUED TO h
    ids.kNoHolder = await key("knoholder", ids.u, null); // a creator but no holder ⇒ owner-less
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM api_keys WHERE id IN ${sql([ids.k, ids.kNoCreator, ids.kOff, ids.kHeld, ids.kNoHolder].filter(Boolean))}`;
    await sql`DELETE FROM users WHERE id IN ${sql([ids.u, ids.uOff, ids.h].filter(Boolean))}`;
    await sql.end();
  });

  it("api-key principal ⇒ the key's HOLDER (active; Đợt 9 R1); no holder / inactive holder / other principals / bad id ⇒ null", async () => {
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.k })).toBe(ids.u);
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kHeld })).toBe(ids.h); // issued to h, NOT the creator u
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kNoHolder })).toBeNull(); // the creator is not a fallback
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kNoCreator })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: ids.kOff })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key", apiKeyId: 2_000_000_000 })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "master", apiKeyId: ids.k })).toBeNull();
    expect(await apiKeyOwnerUserId({ kind: "api-key" })).toBeNull();
    expect(await apiKeyOwnerUserId(undefined)).toBeNull();
  });

  it("★ R-4-f / Đợt 9 R1 HTTP: POST /api/v1/orchestration/runs passes the key HOLDER as ownerUserId (none ⇒ null) and the authenticated key id", async () => {
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
      h.principal = { kind: "api-key", name: "kheld", scopes: ["orchestration:write"], apiKeyId: ids.kHeld, tenantScope: { mode: "global" } };
      // a body naming another key / owner changes nothing (identity comes from the authenticated principal only)
      expect(
        (await fetch(`${base}/api/v1/orchestration/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workflowRef: "wf-x", apiKeyId: ids.k, params: { apiKeyId: ids.k, startedViaApiKeyId: ids.k } }) })).status,
      ).toBe(202);
      h.principal = { kind: "master", name: "master", scopes: ["*"], tenantScope: { mode: "global" } };
      expect((await post()).status).toBe(202);
      expect(h.calls.map((c) => [(c[2] as { id: number }).id, (c[3] as { ownerUserId: number | null }).ownerUserId])).toEqual([
        [0, ids.u],
        [0, null],
        [0, ids.h],
        [0, null],
      ]);
      // doc 81 Đợt 5 task E1 — the route marks every run it starts as API-started (server side, not from the body).
      expect(h.calls.map((c) => (c[3] as { viaApi?: boolean }).viaApi)).toEqual([true, true, true, true]);
      // doc 81 Đợt 9 R1 — the AUTHENTICATED key id (master key ⇒ none ⇒ the run stays unidentified ⇒ refused)
      expect(h.calls.map((c) => (c[3] as { apiKeyId?: number | null }).apiKeyId)).toEqual([ids.k, ids.kNoCreator, ids.kHeld, null]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

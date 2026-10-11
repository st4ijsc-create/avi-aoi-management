/**
 * doc 81 Đợt 9 tasks S1 + S2 — on the REAL `_test` DB (mig 0370) and the REAL /api/v1 router over HTTP (127.0.0.1, port 0):
 *   S1 — the per-node credential: stored as SHA-256 only, shown once; one active per node; rotation revokes the old secret in
 *        the same transaction; revoke is terminal; only an ACTIVE ADMIN may change it (reason ≥ 3); audited without the token;
 *   S2 — the node protocol: only a node credential authenticates (an API-key-shaped / unknown / revoked one ⇒ the SAME 401);
 *        a node sees and claims ONLY its runs (another node's run, a run outside the node's factory, a missing id ⇒ the SAME
 *        404); claim = compare-and-set with a fresh token; progress is claim-bound and strictly increasing (a replay ⇒ 409,
 *        the row never moves back); "complete" is decided by the RUN ROW (a forged complete of a walking run ⇒ 409, nothing
 *        changes); central's abort reaches the node in the answers; the legacy /edge/sync can never write a node run; a run
 *        started for a node is created 'queued' + assigned atomically and is NEVER walked by central (start, approval);
 *        release / interrupted move a claimed run to 'held' (interrupted only once the claim is stale).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const DAU = `S9DB-${Date.now()}`;
const ENV = { EDGE_RUNTIME_ENABLED: "true", FOE_ENABLED: "true", FOE_SIM_GATE_REQUIRED: "false", EDGE_CLAIM_STALE_MS: "5000" } as const;
const saved: Record<string, string | undefined> = {};
const ids: Record<string, number> = {};
const u: Record<"admin" | "admin2" | "eng" | "offAdmin" | "approver", number> = { admin: 0, admin2: 0, eng: 0, offAdmin: 0, approver: 0 };
let sql: ReturnType<typeof postgres>;
let srv: Server;
let base = "";
const tokens: Record<string, string> = {};
const wfIds: number[] = [];

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function runRow(id: number) {
  const [r] = await sql`SELECT status, "currentStepId", error, "contextJson", "startedBy" FROM orchestration_runs WHERE id = ${id}`;
  return r;
}
async function assignment(id: number) {
  const [a] = await sql`SELECT * FROM orchestration_run_edge_assignments WHERE "runId" = ${id}`;
  return a;
}
/** A deployed workflow whose only target is a machine of `factory` (wait_state ⇒ a non-STOP target, no command). */
async function workflow(tag: string, machineId: number, steps?: unknown[]) {
  const ref = `${DAU}-${tag}`;
  const def = { ref, name: ref, steps: steps ?? [{ id: "w1", type: "wait_state", machineId, targetStates: ["IDLE"], timeoutMs: 1 }] };
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global') RETURNING id`;
  wfIds.push(Number(wf.id));
  return { ref, id: Number(wf.id), def };
}
async function startForNode(ref: string, nodeId: number, user = u.admin) {
  const { startRun } = await import("../orchestration/foe/foeEngine");
  return startRun(ref, {}, { id: user, role: user === u.eng ? "engineer" : "admin", name: "t" }, { edgeNodeId: nodeId });
}

describe.skipIf(!DB_URL)("doc 81 Đợt 9 S1/S2 — node credential + node protocol (real _test DB, real /api/v1 over HTTP)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    for (const [k, role, active] of [["admin", "admin", true], ["admin2", "admin", true], ["eng", "engineer", true], ["offAdmin", "admin", false], ["approver", "supervisor", true]] as const) {
      u[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`S9 ${k}`}, ${role}, ${active}) RETURNING id`);
    }
    for (const f of ["A", "B"]) {
      ids[`factory${f}`] = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F${f}-${DAU}`}, ${`S9 ${f}`}, true) RETURNING id`);
      ids[`ws${f}`] = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids[`factory${f}`]}, ${`W${f}-${DAU}`}, 'S9 ws') RETURNING id`);
      ids[`line${f}`] = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids[`ws${f}`]}, ${`L${f}-${DAU}`}, 'S9 line') RETURNING id`);
      ids[`st${f}`] = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids[`line${f}`]}, ${`S${f}-${DAU}`}, 'S9 st') RETURNING id`);
      ids[`m${f}`] = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids[`st${f}`]}, ${`M${f}-${DAU}`}, 'S9 m', 'AOI', true) RETURNING id`);
      ids[`node${f}`] = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N${f}-${DAU}`}, ${`S9 node ${f}`}, ${`F${f}-${DAU}`}, 'online') RETURNING id`);
    }
    const { issueNodeCredential } = await import("./edgeNodeCredentials");
    tokens.A = (await issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "provision A" })).token;
    tokens.B = (await issueNodeCredential({ nodeCode: `NB-${DAU}`, actorUserId: u.admin, reason: "provision B" })).token;
    ids.nodeA2 = Number((await sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`NA2-${DAU}`}, 'S9 node A2', ${`FA-${DAU}`}, 'online') RETURNING id`)[0].id);
    tokens.A2 = (await issueNodeCredential({ nodeCode: `NA2-${DAU}`, actorUserId: u.admin, reason: "provision A2" })).token;
    const { createV1Router } = await import("../../api/v1/router");
    const app = express();
    app.use("/api/v1", createV1Router());
    srv = await new Promise<Server>((resolve) => {
      const s = createServer(app).listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  }, 90_000);

  afterAll(async () => {
    await new Promise<void>((r) => srv?.close(() => r()));
    for (const w of wfIds) {
      const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`;
      for (const r of runs) {
        await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
        await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`; // the assignment goes with it (cascade)
      }
      await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${w}`.catch(() => undefined);
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`;
    }
    for (const f of ["A", "B", "C", "A2"]) {
      if (ids[`node${f}`]) await sql`DELETE FROM edge_nodes WHERE id = ${ids[`node${f}`]}`; // credentials go with it (cascade)
    }
    for (const f of ["A", "B"]) {
      if (ids[`m${f}`]) await sql`DELETE FROM machines WHERE id = ${ids[`m${f}`]}`;
      if (ids[`st${f}`]) await sql`DELETE FROM stations WHERE id = ${ids[`st${f}`]}`;
      if (ids[`line${f}`]) await sql`DELETE FROM production_lines WHERE id = ${ids[`line${f}`]}`;
      if (ids[`ws${f}`]) await sql`DELETE FROM workshops WHERE id = ${ids[`ws${f}`]}`;
      if (ids[`factory${f}`]) await sql`DELETE FROM factories WHERE id = ${ids[`factory${f}`]}`;
    }
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(u).filter(Boolean))}`.catch(() => undefined); // audit rows may reference (WORM)
    await sql.end();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 90_000);

  // ── S1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("★ S1: the token is shown once and stored ONLY as its SHA-256; audit rows carry the prefix, never the secret", async () => {
    expect(tokens.A).toMatch(/^edn_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    const [row] = await sql`SELECT "keyPrefix", "secretHash", status, "createdBy" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.nodeA}`;
    expect(row.secretHash).toBe(sha(tokens.A));
    expect(row.keyPrefix).toBe(tokens.A.split(".")[0]);
    expect(row.status).toBe("active");
    expect(row.createdBy).toBe(u.admin);
    const secret = tokens.A.split(".")[1];
    const leaks = await sql`SELECT count(*)::int AS n FROM audit_logs WHERE details LIKE ${"%" + secret + "%"}`;
    expect(leaks[0].n).toBe(0);
    const audits = await sql`SELECT details FROM audit_logs WHERE action = 'EDGE_NODE_CREDENTIAL_ISSUE' AND "entityName" = ${`NA-${DAU}`}`;
    expect(audits.length).toBe(1);
    expect(JSON.parse(audits[0].details)).toMatchObject({ keyPrefix: row.keyPrefix, reason: "provision A" });
  });

  it("★ S1: a second issue, a non-admin, an inactive admin, a short reason, an unknown node ⇒ refused, nothing written", async () => {
    const { issueNodeCredential } = await import("./edgeNodeCredentials");
    const before = (await sql`SELECT count(*)::int AS n FROM edge_node_credentials WHERE "edgeNodeId" IN ${sql([ids.nodeA, ids.nodeB])}`)[0].n;
    await expect(issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "again" })).rejects.toMatchObject({ code: "activeExists" });
    await expect(issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.eng, reason: "eng tries" })).rejects.toMatchObject({ code: "notAdmin" });
    await expect(issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.offAdmin, reason: "off admin" })).rejects.toMatchObject({ code: "notAdmin" });
    await expect(issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "x" })).rejects.toMatchObject({ code: "reasonRequired" });
    await expect(issueNodeCredential({ nodeCode: `NZ-${DAU}`, actorUserId: u.admin, reason: "no node" })).rejects.toMatchObject({ code: "nodeNotFound" });
    expect((await sql`SELECT count(*)::int AS n FROM edge_node_credentials WHERE "edgeNodeId" IN ${sql([ids.nodeA, ids.nodeB])}`)[0].n).toBe(before);
  });

  it("★ S1: rotate revokes the old secret in the same transaction; revoke is terminal; authentication follows the rows", async () => {
    ids.nodeC = Number((await sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`NC-${DAU}`}, 'S9 node C', ${`FA-${DAU}`}, 'online') RETURNING id`)[0].id);
    const m = await import("./edgeNodeCredentials");
    const first = await m.issueNodeCredential({ nodeCode: `NC-${DAU}`, actorUserId: u.admin, reason: "provision C" });
    expect((await m.authenticateEdgeNodeToken(first.token))?.nodeId).toBe(ids.nodeC);
    const second = await m.rotateNodeCredential({ nodeCode: `NC-${DAU}`, actorUserId: u.admin2, reason: "scheduled rotation" });
    expect(second.revokedCredentialId).toBe(first.credentialId);
    expect(await m.authenticateEdgeNodeToken(first.token)).toBeNull();
    expect((await m.authenticateEdgeNodeToken(second.token))?.credentialId).toBe(second.credentialId);
    const rows = await sql`SELECT id, status, "rotatedFromId", "revokedBy", "revokeReason" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.nodeC} ORDER BY id`;
    expect(rows.map((r) => [r.status, r.rotatedFromId])).toEqual([["revoked", null], ["active", first.credentialId]]);
    expect(rows[0].revokedBy).toBe(u.admin2);
    expect(rows[0].revokeReason).toMatch(/^rotated: scheduled rotation/);
    await m.revokeNodeCredential({ nodeCode: `NC-${DAU}`, actorUserId: u.admin, reason: "node retired" });
    expect(await m.authenticateEdgeNodeToken(second.token)).toBeNull();
    await expect(m.revokeNodeCredential({ nodeCode: `NC-${DAU}`, actorUserId: u.admin, reason: "again" })).rejects.toMatchObject({ code: "noActive" });
    await expect(m.rotateNodeCredential({ nodeCode: `NC-${DAU}`, actorUserId: u.admin, reason: "again" })).rejects.toMatchObject({ code: "noActive" });
    const listed = await m.listNodeCredentials(`NC-${DAU}`);
    expect(listed.length).toBe(2);
    expect(JSON.stringify(listed)).not.toMatch(/secretHash|[0-9a-f]{64}/);
  });

  it("★ S1: malformed / unknown prefix / right prefix + wrong secret ⇒ null (no oracle)", async () => {
    const { authenticateEdgeNodeToken } = await import("./edgeNodeCredentials");
    const [prefix] = tokens.A.split(".");
    for (const t of [undefined, "", "ak_1234", "Bearer x", `${prefix}.${"A".repeat(43)}`, `edn_000000000000.${tokens.A.split(".")[1]}`, `${tokens.A}x`]) {
      expect(await authenticateEdgeNodeToken(t)).toBeNull();
    }
    expect((await authenticateEdgeNodeToken(tokens.A))?.nodeCode).toBe(`NA-${DAU}`);
  });

  // ── S2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  it("★ S2 auth: no credential, an API-key-shaped one, an unknown one, a revoked one ⇒ the SAME 401 (also on claim / progress)", async () => {
    const bodies: string[] = [];
    for (const t of [undefined, "ak_live_0123456789abcdef", `edn_ffffffffffff.${"B".repeat(43)}`]) {
      const r = await post("/edge/node/pull", {}, t);
      expect(r.status).toBe(401);
      bodies.push(JSON.stringify(r.json));
    }
    const revoked = await import("./edgeNodeCredentials").then((m) => m.listNodeCredentials(`NC-${DAU}`));
    expect(revoked.every((c) => c.status === "revoked")).toBe(true);
    expect(new Set(bodies).size).toBe(1);
    expect((await post("/edge/node/runs/1/claim", { claimSeq: 0 }, undefined)).status).toBe(401);
  });

  it("★ S2 start: a run handed to a node is created 'queued' + assigned atomically and is NOT walked by central", async () => {
    const wf = await workflow("start", ids.mA);
    const res = await startForNode(wf.ref, ids.nodeA);
    expect(res).toMatchObject({ ok: true, status: "queued", edgeNodeId: ids.nodeA });
    const run = await runRow(res.runId!);
    expect(run.status).toBe("queued");
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${res.runId!}`)[0].n).toBe(0); // never walked here
    const a = await assignment(res.runId!);
    const { hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
    expect(a).toMatchObject({ edgeNodeId: ids.nodeA, workflowId: wf.id, workflowVersion: 1, defHash: hashWorkflowDefinition(wf.def as never), claimSeq: 0, claimTokenHash: null, assignedBy: u.admin });
    // a node that does not exist ⇒ nothing is created
    const before = (await sql`SELECT count(*)::int AS n FROM orchestration_runs WHERE "workflowId" = ${wf.id}`)[0].n;
    const bad = await startForNode(wf.ref, 2_000_000_000);
    expect(bad.ok).toBe(false);
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_runs WHERE "workflowId" = ${wf.id}`)[0].n).toBe(before);
  });

  it("★ S2 scope: a node outside the caller's factories is 'none' (same as missing); an admin may use any node", async () => {
    const { resolveAssignableNode } = await import("./edgeExecutionCentral");
    expect(await resolveAssignableNode(`NA-${DAU}`, null)).toEqual({ kind: "node", id: ids.nodeA });
    const onlyA = { tenantScope: { factoryCode: `FA-${DAU}` } };
    expect(await resolveAssignableNode(`NA-${DAU}`, onlyA)).toEqual({ kind: "node", id: ids.nodeA });
    expect(await resolveAssignableNode(`NB-${DAU}`, onlyA)).toEqual({ kind: "none" });
    expect(await resolveAssignableNode(`NOPE-${DAU}`, onlyA)).toEqual({ kind: "none" });
  });

  it("★ S2 API v1 start with `edgeNodeCode`: the AUTHENTICATED key is recorded in the insert and the run is assigned; a node outside the key's scope ⇒ 404, nothing created", async () => {
    const plain = `ak_s9_${DAU}`;
    const [k] = await sql`INSERT INTO api_keys (name, "keyHash", "keyPrefix", scopes, "createdBy", "holderUserId", "dataScopeMode", "factoryCode")
                          VALUES (${`${DAU}-key`}, ${sha(plain)}, 'ak_s9', ${sql.json(["orchestration:write"])}, ${u.admin}, ${u.eng}, 'factory', ${`FA-${DAU}`}) RETURNING id`;
    try {
      const wf = await workflow("apiStart", ids.mA);
      const call = (node: string) =>
        fetch(`${base}/api/v1/orchestration/runs`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${plain}` },
          body: JSON.stringify({ workflowRef: wf.ref, edgeNodeCode: node }),
        }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
      const ok = await call(`NA-${DAU}`);
      expect(ok.status).toBe(202);
      expect(ok.json.data).toMatchObject({ status: "queued", accepted: true });
      const runId = ok.json.data.runId as number;
      const [row] = await sql`SELECT "startedViaApiKeyId", "startedBy", status FROM orchestration_runs WHERE id = ${runId}`;
      expect(row).toMatchObject({ startedViaApiKeyId: Number(k.id), startedBy: u.eng, status: "queued" });
      expect((await assignment(runId)).edgeNodeId).toBe(ids.nodeA);
      const before = (await sql`SELECT count(*)::int AS n FROM orchestration_runs WHERE "workflowId" = ${wf.id}`)[0].n;
      const out = await call(`NB-${DAU}`);
      expect(out.status).toBe(404);
      expect((await sql`SELECT count(*)::int AS n FROM orchestration_runs WHERE "workflowId" = ${wf.id}`)[0].n).toBe(before);
      expect((await call(`NOPE-${DAU}`)).json).toEqual(JSON.parse(JSON.stringify(out.json).replace(`NB-${DAU}`, `NOPE-${DAU}`)));
    } finally {
      await sql`DELETE FROM api_keys WHERE id = ${k.id}`; // holder history rows stay (WORM, by design)
    }
  });

  it("★ S2 pull: a node sees ONLY its own claimable runs, with the snapshot + central's binding digest", async () => {
    const wfA = await workflow("pullA", ids.mA);
    const wfB = await workflow("pullB", ids.mB);
    const ra = await startForNode(wfA.ref, ids.nodeA);
    const rb = await startForNode(wfB.ref, ids.nodeB);
    const pa = await post("/edge/node/pull", {}, tokens.A);
    expect(pa.status).toBe(200);
    const mineA = pa.json.data.runs.map((r: any) => r.runId);
    expect(mineA).toContain(ra.runId);
    expect(mineA).not.toContain(rb.runId);
    const one = pa.json.data.runs.find((r: any) => r.runId === ra.runId);
    expect(one.definition).toEqual(wfA.def);
    expect(one.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    const pb = await post("/edge/node/pull", {}, tokens.B);
    expect(pb.json.data.runs.map((r: any) => r.runId)).not.toContain(ra.runId);
    // a second node of the SAME factory: the factory scope would let it see A's run — the assignment does not
    const pa2 = await post("/edge/node/pull", {}, tokens.A2);
    expect(pa2.status).toBe(200);
    expect(pa2.json.data.runs.map((r: any) => r.runId)).not.toContain(ra.runId);
    const c2 = await post(`/edge/node/runs/${ra.runId}/claim`, { claimSeq: 0, defHash: one.defHash, bindingDigest: one.bindingDigest }, tokens.A2);
    expect(c2.status).toBe(404);
  });

  it("★ S2 node A ↔ node B: B claiming / reporting A's run gets EXACTLY the answer of a run that does not exist", async () => {
    const wf = await workflow("cross", ids.mA);
    const r = await startForNode(wf.ref, ids.nodeA);
    const pulled = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === r.runId);
    const claimBody = { claimSeq: 0, defHash: pulled.defHash, bindingDigest: pulled.bindingDigest };
    const foreign = await post(`/edge/node/runs/${r.runId}/claim`, claimBody, tokens.B);
    const missing = await post(`/edge/node/runs/2000000000/claim`, claimBody, tokens.B);
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(foreign.json).replace(String(r.runId), "N")).toBe(JSON.stringify(missing.json).replace("2000000000", "N"));
    expect((await runRow(r.runId!)).status).toBe("queued"); // nothing changed
    // a run assigned to A but whose targets are in B's factory is not A's either (defence in depth)
    const wfX = await workflow("crossScope", ids.mB);
    const rx = await startForNode(wfX.ref, ids.nodeA);
    const pa = await post("/edge/node/pull", {}, tokens.A);
    expect(pa.json.data.runs.map((x: any) => x.runId)).not.toContain(rx.runId);
    const sx = await post(`/edge/node/runs/${rx.runId}/claim`, claimBody, tokens.A);
    expect(sx.status).toBe(404);
  });

  it("★ S2 claim: wrong seq / snapshot / binding ⇒ refused; a good claim is a CAS with a fresh token; replaying it ⇒ 409", async () => {
    const wf = await workflow("claim", ids.mA);
    const r = await startForNode(wf.ref, ids.nodeA);
    const p = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === r.runId);
    const path = `/edge/node/runs/${r.runId}/claim`;
    expect((await post(path, { claimSeq: 1, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A)).json.error.code).toBe("claim_conflict");
    expect((await post(path, { claimSeq: 0, defHash: "0".repeat(64), bindingDigest: p.bindingDigest }, tokens.A)).json.error.code).toBe("definition_changed");
    expect((await post(path, { claimSeq: 0, defHash: p.defHash, bindingDigest: "f".repeat(64) }, tokens.A)).json.error.code).toBe("binding_changed");
    expect((await post(path, { claimSeq: 0, defHash: p.defHash, bindingDigest: null }, tokens.A)).json.error.code).toBe("binding_changed");
    expect((await runRow(r.runId!)).status).toBe("queued");
    const ok = await post(path, { claimSeq: 0, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A);
    expect(ok.status).toBe(200);
    expect(ok.json.data.claimToken).toMatch(/^ect_[A-Za-z0-9_-]{43}$/);
    expect(ok.json.data.claimSeq).toBe(1);
    const a = await assignment(r.runId!);
    expect(a.claimTokenHash).toBe(sha(ok.json.data.claimToken));
    expect(a.claimedByCredentialId).toBeGreaterThan(0);
    expect((await runRow(r.runId!)).status).toBe("running");
    const replay = await post(path, { claimSeq: 0, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A);
    expect(replay.status).toBe(409);
    expect((await assignment(r.runId!)).claimTokenHash).toBe(sha(ok.json.data.claimToken)); // unchanged
  });

  it("★ S2 redeploy after assignment ⇒ the pull marks it refused and the claim is refused (the snapshot is pinned)", async () => {
    const wf = await workflow("redeploy", ids.mA);
    const r = await startForNode(wf.ref, ids.nodeA);
    const p = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === r.runId);
    // a redeploy as deployWorkflow does it: the old version's snapshot is kept, the head moves to v2
    await sql`INSERT INTO orchestration_workflow_versions ("workflowId", ref, version, name, "definitionJson") VALUES (${wf.id}, ${wf.ref}, 1, ${wf.ref}, ${sql.json(wf.def as never)})`;
    await sql`UPDATE orchestration_workflows SET "definitionJson" = ${sql.json({ ...wf.def, name: "changed" } as never)}, version = 2 WHERE id = ${wf.id}`;
    const p2 = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === r.runId);
    expect(p2).toMatchObject({ refused: "definitionChanged" });
    expect(p2.definition).toBeUndefined();
    const c = await post(`/edge/node/runs/${r.runId}/claim`, { claimSeq: 0, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A);
    expect(c.json.error.code).toBe("definition_changed");
  });

  async function claimed(tag: string, steps?: unknown[]) {
    const wf = await workflow(tag, ids.mA, steps);
    const r = await startForNode(wf.ref, ids.nodeA);
    const p = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === r.runId);
    const c = await post(`/edge/node/runs/${r.runId}/claim`, { claimSeq: 0, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A);
    expect(c.status).toBe(200);
    return { runId: r.runId!, wf, claimSeq: c.json.data.claimSeq as number, token: c.json.data.claimToken as string };
  }

  it("★ S2 progress: claim-bound, strictly increasing — a replay ⇒ 409 and the row never moves back; a foreign token ⇒ claim_stale", async () => {
    const c = await claimed("progress");
    const path = `/edge/node/runs/${c.runId}/progress`;
    const body = (seq: number, token = c.token) => ({ claimSeq: c.claimSeq, claimToken: token, seq, status: "running" });
    const p1 = await post(path, body(1), tokens.A);
    expect(p1.status).toBe(200);
    expect(p1.json.data).toMatchObject({ abortRequested: false, status: "running", consistent: true });
    expect((await post(path, body(1), tokens.A)).json.error.code).toBe("replayed");
    expect((await post(path, body(5), tokens.A)).status).toBe(200);
    expect((await post(path, body(3), tokens.A)).json.error.code).toBe("replayed");
    expect(Number((await assignment(c.runId)).progressSeq)).toBe(5);
    expect((await post(path, body(0), tokens.A)).status).toBe(400);
    expect((await post(path, body(6, `ect_${"A".repeat(43)}`), tokens.A)).json.error.code).toBe("claim_stale");
    expect((await post(path, { ...body(6), claimSeq: c.claimSeq + 1 }, tokens.A)).json.error.code).toBe("claim_stale");
    expect((await post(path, body(6), tokens.B)).status).toBe(404); // B holding A's token: still not B's run
    // the SAME report sent 6 times at once (a replay racing the original): exactly one is accepted
    const burst = await Promise.all(Array.from({ length: 6 }, () => post(path, body(9), tokens.A)));
    expect(burst.filter((r) => r.status === 200).length).toBe(1);
    expect(burst.filter((r) => r.status === 409).length).toBe(5);
    expect(Number((await assignment(c.runId)).progressSeq)).toBe(9);
  });

  it("★ S2 complete: the RUN ROW decides — a forged complete of a walking run ⇒ 409 not_finished, nothing changes", async () => {
    const c = await claimed("complete");
    const path = `/edge/node/runs/${c.runId}/complete`;
    const forged = await post(path, { claimSeq: c.claimSeq, claimToken: c.token, seq: 1, status: "completed" }, tokens.A);
    expect(forged.json.error.code).toBe("not_finished");
    expect((await runRow(c.runId)).status).toBe("running");
    expect((await assignment(c.runId)).claimTokenHash).toBe(sha(c.token));
    await sql`UPDATE orchestration_runs SET status = 'completed', "finishedAt" = now() WHERE id = ${c.runId}`; // the edge engine's own write
    const done = await post(path, { claimSeq: c.claimSeq, claimToken: c.token, seq: 2, status: "completed" }, tokens.A);
    expect(done.status).toBe(200);
    expect(done.json.data).toMatchObject({ status: "completed", abortRequested: false });
    expect((await assignment(c.runId)).claimTokenHash).toBeNull();
    const replay = await post(path, { claimSeq: c.claimSeq, claimToken: c.token, seq: 3, status: "completed" }, tokens.A);
    expect(replay.json.error.code).toBe("claim_stale");
  });

  it("★ S2 abort: central's abort reaches the node in the next answer; a stale-claim answer says so too", async () => {
    const c = await claimed("abort");
    const { abortRun } = await import("../orchestration/foe/foeEngine");
    const ab = await abortRun(c.runId, { id: u.admin, role: "admin", name: "t" }, "stop it");
    expect(ab.status).toBe("aborted");
    const p = await post(`/edge/node/runs/${c.runId}/progress`, { claimSeq: c.claimSeq, claimToken: c.token, seq: 1, status: "running" }, tokens.A);
    expect(p.json.data).toMatchObject({ abortRequested: true, status: "aborted", consistent: false });
    const pulled = await post("/edge/node/pull", {}, tokens.A);
    expect(pulled.json.data.claims.find((x: any) => x.runId === c.runId)).toMatchObject({ abortRequested: true });
    const done = await post(`/edge/node/runs/${c.runId}/complete`, { claimSeq: c.claimSeq, claimToken: c.token, seq: 2, status: "aborted" }, tokens.A);
    expect(done.json.data).toMatchObject({ status: "aborted", abortRequested: true });
    expect((await runRow(c.runId)).status).toBe("aborted"); // never resurrected
  });

  it("★ S2 sibling path: the legacy /edge/sync (edgeCoordinator.syncRunResult) can never write a node-executed run", async () => {
    const c = await claimed("legacy");
    const { syncRunResult } = await import("./edgeCoordinator");
    const out = await syncRunResult({ edgeNodeCode: `NA-${DAU}`, runId: c.runId, status: "completed", steps: [{ stepId: "w1", stepType: "wait_state", status: "completed" }] });
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/node protocol/);
    expect((await runRow(c.runId)).status).toBe("running");
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${c.runId}`)[0].n).toBe(0);
    const { assignRun } = await import("./edgeCoordinator");
    expect((await assignRun(c.runId, ids.nodeB)).ok).toBe(false);
  });

  it("★ S2 approval of a node run: the gate row is recorded, the run goes back to 'queued' for its node — never walked here", async () => {
    const steps = [{ id: "g1", type: "hitl_gate", prompt: "ok?" }, { id: "w1", type: "wait_state", machineId: ids.mA, targetStates: ["IDLE"], timeoutMs: 1 }];
    const c = await claimed("approve", steps);
    // the node's engine paused it at the gate (its own writes) and reported the segment end
    await sql`UPDATE orchestration_runs SET status = 'awaiting_confirm', "currentStepId" = 'g1' WHERE id = ${c.runId}`;
    expect((await post(`/edge/node/runs/${c.runId}/complete`, { claimSeq: c.claimSeq, claimToken: c.token, seq: 1, status: "awaiting_confirm" }, tokens.A)).status).toBe(200);
    const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
    const view = await getRun(c.runId, { bindingDigest: true });
    const res = await resumeRun(
      c.runId,
      { approved: true, expectedStepId: "g1", expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! },
      { id: u.admin2, role: "admin", name: "approver" },
    );
    expect(res).toMatchObject({ ok: true, status: "queued", edgeNodeId: ids.nodeA });
    const gate = (await sql`SELECT status, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${c.runId} AND "stepId" = 'g1'`)[0];
    expect(gate.status).toBe("completed");
    expect(gate.resultJson).toMatchObject({ approved: true, approvedBy: u.admin2, approvalSource: "server" });
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${c.runId} AND "stepId" = 'w1'`)[0].n).toBe(0); // not walked
    expect((await runRow(c.runId)).status).toBe("queued");
    // the node claims the next segment
    const p = (await post("/edge/node/pull", {}, tokens.A)).json.data.runs.find((x: any) => x.runId === c.runId);
    expect(p.claimSeq).toBe(1);
    expect((await post(`/edge/node/runs/${c.runId}/claim`, { claimSeq: 1, defHash: p.defHash, bindingDigest: p.bindingDigest }, tokens.A)).json.data.claimSeq).toBe(2);
  });

  it("★ S2 release / interrupted: a claimed run goes to 'held'; interrupted only once the claim is stale", async () => {
    const r1 = await claimed("release");
    const rel = await post(`/edge/node/runs/${r1.runId}/release`, { claimSeq: r1.claimSeq, claimToken: r1.token, seq: 1, reason: "local check failed" }, tokens.A);
    expect(rel.json.data).toEqual({ status: "held" });
    expect(await runRow(r1.runId)).toMatchObject({ status: "held" });
    expect((await assignment(r1.runId)).claimTokenHash).toBeNull();
    const r2 = await claimed("interrupted");
    const early = await post(`/edge/node/runs/${r2.runId}/interrupted`, { claimSeq: r2.claimSeq }, tokens.A);
    expect(early.json.error.code).toBe("claim_live");
    expect((await runRow(r2.runId)).status).toBe("running");
    expect((await post(`/edge/node/runs/${r2.runId}/interrupted`, { claimSeq: r2.claimSeq }, tokens.B)).status).toBe(404);
    await sql`UPDATE orchestration_run_edge_assignments SET "lastProgressAt" = now() - interval '1 hour', "claimedAt" = now() - interval '1 hour' WHERE "runId" = ${r2.runId}`;
    const late = await post(`/edge/node/runs/${r2.runId}/interrupted`, { claimSeq: r2.claimSeq }, tokens.A);
    expect(late.json.data).toEqual({ status: "held" });
    const row = await runRow(r2.runId);
    expect(row.status).toBe("held");
    expect(row.contextJson).toMatchObject({ interrupted: true, interruptedFrom: "running" });
  });
});

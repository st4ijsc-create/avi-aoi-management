/**
 * R1b-2b-2a A2(o) r3 F2 (coordinator: "deploy edge + central together" is NOT accepted) — a NEW edge reporting a stale-config
 * authorisation as unused must work against an OLD central, and an OLD edge against a NEW central:
 *   • central advertises what it accepts beyond the v2 baseline as an HTTP header on every node-route answer
 *     (EDGE_CENTRAL_ACCEPTS_HEADER — never a body field: every answer schema is strict, an old edge would refuse the answer);
 *   • the edge sends `auth_unused` reason `config_stale` only when central advertised `auth_unused.config_stale`; otherwise the
 *     baseline `expired_before_use`, which an old central accepts and supersedes the same way (the safety meaning: the
 *     authorisation was NEVER used). The edge's journal keeps the true reason.
 *   • r4 (review I-1): the wire reason is chosen ONCE, when the run record is journaled — a resend after a lost answer is
 *     byte-identical even when central's capability changed meanwhile (central hashes each seq: other content ⇒ seq_conflict).
 * Real journal + reporter + shipper + client against the fake central; the OLD central validates every record with the OLD
 * strict schema (`reason: z.literal("expired_before_use")`) and refuses the whole batch on any mismatch, as the old code did.
 */
import { afterEach, describe, expect, it } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { EdgeCentralClient } from "./edgeCentralClient";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";
import { EdgeJournal } from "./edgeJournal";
import {
  EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE,
  EDGE_ANSWER_SCHEMAS,
  EDGE_CENTRAL_ACCEPTS_HEADER,
  edgeAbortStopRecordSchema,
  edgeAuthUnusedRecordSchema,
  edgeAuthUnusedWireReason,
  edgeContextRecordSchema,
  edgeLedgerRecordSchema,
  edgeRunReportRecordSchema,
  edgeStepRecordSchema,
  parseEdgeCentralAccepts,
} from "./edgeProtocol";
import { EdgeStreamShipper, createEdgeAuthUnusedReporter, createEdgeReportSink } from "./edgeStreams";

const dirs: string[] = [];
const journals: EdgeJournal[] = [];
afterEach(async () => {
  for (const j of journals.splice(0)) await j.close().catch(() => undefined);
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
});

/** the record schema of a central BEFORE A2(o) amendment 2 (the reason was a strict literal) */
const oldAuthUnused = z.strictObject({ ...edgeAuthUnusedRecordSchema.shape, reason: z.literal("expired_before_use") });
const oldRunRecord = z.discriminatedUnion("kind", [edgeStepRecordSchema, edgeContextRecordSchema, edgeAbortStopRecordSchema, edgeLedgerRecordSchema, oldAuthUnused]);

/**
 * A central's report route: records checked with `schema` (any refusal ⇒ the WHOLE batch is a 400, as central's strict body
 * parse); a seq already held with OTHER content ⇒ 409 seq_conflict for the batch (central stores each record's hash —
 * edgeReportsCentral); an accepted auth_unused supersedes its jti; the cursor rule of the kit otherwise. `stored` survives a
 * central upgrade (the same DB).
 */
function centralReport(central: FakeCentral, schema: z.ZodType, superseded: Map<string, string>, stored = new Map<string, string>()) {
  central.handlers.report = (body) => {
    for (const r of body.records as unknown[]) {
      if (!schema.safeParse(r).success) return { status: 400, code: "bad_request" };
    }
    const k = `${body.epoch}|${body.stream}`;
    const last = central.cursors.get(k) ?? 0;
    for (const r of body.records as Array<{ seq: number }>) {
      const was = stored.get(`${k}|${r.seq}`);
      if (r.seq <= last && was !== undefined && was !== JSON.stringify(r)) return { status: 409, code: "seq_conflict", details: { seq: r.seq } };
    }
    let applied = 0;
    for (const r of body.records as Array<{ seq: number; kind: string; jti?: string; reason?: string }>) {
      if (r.seq <= last + applied) continue;
      applied++;
      stored.set(`${k}|${r.seq}`, JSON.stringify(r));
      central.received.report.push(r);
      if (r.kind === "auth_unused" && !superseded.has(r.jti!)) superseded.set(r.jti!, r.reason!);
    }
    central.cursors.set(k, last + applied);
    return { status: 200, data: { ackedSeq: last + applied, applied, duplicates: 0 } };
  };
}

async function setup(kind: "old" | "new") {
  const central = new FakeCentral();
  const superseded = new Map<string, string>();
  if (kind === "old") {
    central.accepts = null; // an old central sends no header
    centralReport(central, oldRunRecord, superseded);
  } else {
    centralReport(central, edgeRunReportRecordSchema, superseded);
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-a2o-compat-"));
  dirs.push(dir);
  const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
  journals.push(journal);
  const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: central.fetchImpl, log: () => undefined });
  const shipper = new EdgeStreamShipper(journal, client, { log: () => undefined });
  const sink = createEdgeReportSink(journal); // shipped explicitly below
  const marked: Array<{ reason: string }> = [];
  const mark = journal.markAuthorizationUnused.bind(journal);
  journal.markAuthorizationUnused = async (c) => (marked.push({ reason: c.reason }), mark(c)); // what the LOCAL journal keeps
  // the agent's wiring (edgeExecutionAgent.unusedReporter): the wire reason from what central advertised, fixed when journaled
  const report = createEdgeAuthUnusedReporter(journal, sink, { centralAccepts: (t) => client.centralAccepts(t) });
  shipper.setClaim(9, 2, `ect_${"A".repeat(43)}`);
  // the agent's first exchange with central (pull) comes before any run report — the client learns what central accepts
  expect((await client.post("pull", {})).ok).toBe(true);
  return { central, superseded, journal, client, shipper, report, marked };
}
const JTI = "3b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a83";
const unused = (reason: "config_stale" | "expired_before_use", jti = JTI) => ({ runId: 9, claimSeq: 2, jti, stepId: "r2", attempt: 1, reason });

describe("A2(o) r3 F2 — a stale-config authorisation reported unused: new edge × old / new central", () => {
  it("the fake OLD central is really strict: a config_stale record refuses its WHOLE batch (what the edge must never send it)", async () => {
    const { central } = await setup("old");
    const bad = { kind: "auth_unused", seq: 1, stepId: "r2", attempt: 1, jti: JTI, reason: "config_stale", at: Date.now() };
    expect(oldRunRecord.safeParse(bad).success).toBe(false);
    expect(oldRunRecord.safeParse({ ...bad, reason: "expired_before_use" }).success).toBe(true);
    expect(await central.handlers.report!({ epoch: "e", stream: "run:9:2", records: [bad] }, 9)).toMatchObject({ status: 400 });
  });

  it("★ new edge + OLD central (no capability header): the record goes as expired_before_use — ACCEPTED, the authorisation superseded, the run stream NOT wedged; the LOCAL journal keeps config_stale", async () => {
    const { central, superseded, journal, client, shipper, report, marked } = await setup("old");
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(false);
    await journal.appendRun(9, 2, { kind: "step", stepId: "r1", stepType: "command", status: "completed", attempt: 1, startedAt: 1, finishedAt: 2, error: null, result: null, jti: null });
    expect(await report(unused("config_stale"))).toBe(true);
    expect(journal.isJtiConsumed(JTI)).toBe(true); // never usable again, whatever the wire says
    await journal.flush();
    // r4: the run record is journaled in its WIRE form (fixed for every send); the local auth.unused keeps the true reason
    expect(journal.pending("run:9:2").map((e) => (e.record as { reason?: string }).reason ?? null)).toEqual([null, "expired_before_use"]);
    expect(marked).toEqual([{ reason: "config_stale" }]);
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(journal.pending("run:9:2")).toEqual([]); // acknowledged: the stream moves on
    expect(central.received.report.filter((r) => r.kind === "auth_unused")).toMatchObject([{ jti: JTI, reason: "expired_before_use", stepId: "r2", attempt: 1 }]);
    expect(superseded.get(JTI)).toBe("expired_before_use");
    // later records on the same stream still flow (not wedged)
    await journal.appendRun(9, 2, { kind: "context", patch: { a: 1 } });
    await journal.flush();
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(central.received.report.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("★ new edge + NEW central (advertises auth_unused.config_stale): the record goes as config_stale", async () => {
    const { central, superseded, journal, client, shipper, report, marked } = await setup("new");
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(true);
    expect(await report(unused("config_stale"))).toBe(true);
    await journal.flush();
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(central.received.report).toMatchObject([{ kind: "auth_unused", jti: JTI, reason: "config_stale" }]);
    expect(superseded.get(JTI)).toBe("config_stale");
    expect(marked).toEqual([{ reason: "config_stale" }]);
  });

  it("★ r4 I-1: sent to an OLD central, the answer LOST, central upgraded (capability now advertised) ⇒ the resend is BYTE-IDENTICAL (expired_before_use) and accepted as a duplicate — never seq_conflict, the stream not wedged", async () => {
    const { central, superseded, journal, client, shipper, report } = await setup("old");
    const stored = new Map<string, string>();
    centralReport(central, oldRunRecord, superseded, stored);
    expect(await report(unused("config_stale"))).toBe(true);
    await journal.flush();
    // the old central APPLIES the batch, but its answer never reaches the edge
    const apply = central.handlers.report!;
    central.handlers.report = async (body, runId) => (await apply(body, runId), "network" as const);
    expect(await shipper.flush("run:9:2")).toBe("unavailable");
    expect(journal.pending("run:9:2")).toHaveLength(1); // not acknowledged locally
    const first = central.callsTo("report").at(-1)!.body.records[0];
    expect(first).toMatchObject({ kind: "auth_unused", jti: JTI, reason: "expired_before_use" });
    expect(superseded.get(JTI)).toBe("expired_before_use");
    // central is upgraded (same DB: the stored hashes stay) and now advertises config_stale; the edge learns it
    central.accepts = [EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE];
    centralReport(central, edgeRunReportRecordSchema, superseded, stored);
    expect((await client.post("pull", {})).ok).toBe(true);
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(true);
    // the resend carries EXACTLY the first send's record ⇒ a duplicate, acknowledged
    expect(await shipper.flush("run:9:2")).toBe("ok");
    const resent = central.callsTo("report").at(-1)!.body.records[0];
    expect(JSON.stringify(resent)).toBe(JSON.stringify(first));
    expect(journal.pending("run:9:2")).toEqual([]);
    expect(central.received.report.filter((r) => r.kind === "auth_unused")).toHaveLength(1); // applied once
    // a NEW unused authorisation after the upgrade goes as config_stale
    const J2 = "4c9f4d2f-6e8b-4d2c-8b3f-4a5e6d7c8b94";
    expect(await report(unused("config_stale", J2))).toBe(true);
    await journal.flush();
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(superseded.get(J2)).toBe("config_stale");
  });

  it("r4: without a capability source the reporter journals the baseline (fail-safe default)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-a2o-compat-"));
    dirs.push(dir);
    const journal = await EdgeJournal.open({ dir, groupCommitMs: 1 });
    journals.push(journal);
    const recs: Array<{ reason?: string }> = [];
    const sink = { run: async (_r: number, _c: number, rec: { reason?: string }) => (recs.push(rec), { seq: recs.length, durable: true }) } as never;
    expect(await createEdgeAuthUnusedReporter(journal, sink)(unused("config_stale"))).toBe(true);
    expect(await createEdgeAuthUnusedReporter(journal, sink, { centralAccepts: () => { throw new Error("x"); } })(unused("config_stale", "5d0a5e3a-7f9c-4e3d-9c4a-5b6f7e8d9ca5"))).toBe(true);
    expect(recs.map((r) => r.reason)).toEqual(["expired_before_use", "expired_before_use"]);
  });

  it("★ the capability follows central's LAST valid answer: a central rolled back to the old code (header gone) ⇒ the fallback again", async () => {
    const { central, journal, client, shipper, report } = await setup("new");
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(true);
    central.accepts = null;
    centralReport(central, oldRunRecord, new Map());
    expect((await client.post("pull", {})).ok).toBe(true);
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(false);
    expect(await report(unused("config_stale"))).toBe(true);
    await journal.flush();
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(central.received.report).toMatchObject([{ kind: "auth_unused", reason: "expired_before_use" }]);
  });

  it("before central ever answered, the client knows nothing ⇒ the fallback (fail-safe default); expired_before_use is never changed", () => {
    const client = new EdgeCentralClient({ centralUrl: "http://central.test", credential: KIT_TOKEN, requestTimeoutMs: 2_000, fetchImpl: (async () => new Response("{}")) as never, log: () => undefined });
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(false);
    expect(edgeAuthUnusedWireReason("config_stale", () => false)).toBe("expired_before_use");
    expect(edgeAuthUnusedWireReason("config_stale", (t) => t === EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe("config_stale");
    expect(edgeAuthUnusedWireReason("expired_before_use", () => false)).toBe("expired_before_use");
    expect(edgeAuthUnusedWireReason("expired_before_use", () => true)).toBe("expired_before_use");
    expect([...parseEdgeCentralAccepts(" auth_unused.config_stale , Bad Token,x".padEnd(20))]).toEqual(["auth_unused.config_stale", "x"]);
    expect(parseEdgeCentralAccepts(null).size).toBe(0);
    expect(parseEdgeCentralAccepts("a".repeat(1_001)).size).toBe(0);
  });
});

describe("A2(o) r3 F2 — the other direction: OLD edge + NEW central keeps working (additive)", () => {
  it("★ the new central still accepts the baseline reason; its answers' BODIES are unchanged (the capability is a header an old edge ignores)", async () => {
    const rec = { kind: "auth_unused", seq: 1, stepId: "r2", attempt: 1, jti: JTI, reason: "expired_before_use", at: Date.now() };
    expect(edgeRunReportRecordSchema.safeParse(rec).success).toBe(true);
    // what an OLD edge does with a new central's answer: the same strict body parse — the header is outside the body
    const central = new FakeCentral();
    const res = await central.fetchImpl("http://central.test/api/v1/edge/node/pull", { method: "POST", body: "{}", headers: {} } as never);
    // a2n — the header is a LIST now (progress.journal_stall joined it): the token is read off the list, as the edge reads it
    expect(parseEdgeCentralAccepts(res.headers.get(EDGE_CENTRAL_ACCEPTS_HEADER)).has(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(true);
    const json = (await res.json()) as { ok: boolean; data: unknown };
    expect(EDGE_ANSWER_SCHEMAS.pull.safeParse(json.data).success).toBe(true);
  });

  it("★ central's routes set the header on EVERY node-route answer (the one answer() helper), before the body is sent; no answer schema carries it", () => {
    const src = readFileSync(path.join(__dirname, "../../api/v1/edgeNodeRoutes.ts"), "utf8");
    const fn = src.slice(src.indexOf("function answer("), src.indexOf("\n}\n", src.indexOf("function answer(")));
    const set = fn.indexOf("res.setHeader(EDGE_CENTRAL_ACCEPTS_HEADER, edgeCentralAcceptsHeaderValue());");
    expect(set).toBeGreaterThan(0);
    expect(set).toBeLessThan(fn.indexOf("sendOk("));
    expect(set).toBeLessThan(fn.indexOf("sendError("));
    // every node route answers through answer() (byVersion or directly)
    const routes = [...src.matchAll(/r\.post\(\s*"\/edge\/node\/[^"]+",\s*auth,\s*wrap\(([^\n]+)/g)].map((m) => m[1]);
    expect(routes.length).toBe(14);
    for (const r of routes) expect(r, r).toMatch(/^(byVersion\(|async \(req, res\) => answer\(res,)/);
    const proto = readFileSync(path.join(__dirname, "edgeProtocol.ts"), "utf8");
    expect(proto).not.toMatch(/accepts:\s*z\./);
  });

  it("★ r4: the run store's reporter (agent) and the authorize client's (gateway) take the capability from the client; the shipper sends the journaled record AS IS", () => {
    const agent = readFileSync(path.join(__dirname, "edgeExecutionAgent.ts"), "utf8");
    expect(agent).toMatch(/createEdgeAuthUnusedReporter\(journal, sink, \{ centralAccepts: \(t\) => client\.centralAccepts\?\.\(t\) === true \}\)/);
    const gw = readFileSync(path.join(__dirname, "edgeGatewayRuntime.ts"), "utf8");
    expect(gw).toMatch(/createEdgeAuthUnusedReporter\(journal, sink, \{ centralAccepts: \(t\) => client\.centralAccepts\(t\) \}\)/);
    const streams = readFileSync(path.join(__dirname, "edgeStreams.ts"), "utf8");
    expect(streams).toContain("records: batch.map((b) => b.record as EdgeRunReportRecord) }");
  });
});

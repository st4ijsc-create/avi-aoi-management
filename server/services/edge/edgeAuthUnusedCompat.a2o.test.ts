/**
 * R1b-2b-2a A2(o) r3 F2 (coordinator: "deploy edge + central together" is NOT accepted) — a NEW edge reporting a stale-config
 * authorisation as unused must work against an OLD central, and an OLD edge against a NEW central:
 *   • central advertises what it accepts beyond the v2 baseline as an HTTP header on every node-route answer
 *     (EDGE_CENTRAL_ACCEPTS_HEADER — never a body field: every answer schema is strict, an old edge would refuse the answer);
 *   • the edge sends `auth_unused` reason `config_stale` only when central advertised `auth_unused.config_stale`; otherwise the
 *     baseline `expired_before_use`, which an old central accepts and supersedes the same way (the safety meaning: the
 *     authorisation was NEVER used). The edge's journal keeps the true reason.
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
 * parse); an accepted auth_unused supersedes its jti; the cursor rule of the kit otherwise.
 */
function centralReport(central: FakeCentral, schema: z.ZodType, superseded: Map<string, string>) {
  central.handlers.report = (body) => {
    for (const r of body.records as unknown[]) {
      if (!schema.safeParse(r).success) return { status: 400, code: "bad_request" };
    }
    const k = `${body.epoch}|${body.stream}`;
    const last = central.cursors.get(k) ?? 0;
    let applied = 0;
    for (const r of body.records as Array<{ seq: number; kind: string; jti?: string; reason?: string }>) {
      if (r.seq <= last + applied) continue;
      applied++;
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
  const report = createEdgeAuthUnusedReporter(journal, sink);
  shipper.setClaim(9, 2, `ect_${"A".repeat(43)}`);
  // the agent's first exchange with central (pull) comes before any run report — the client learns what central accepts
  expect((await client.post("pull", {})).ok).toBe(true);
  return { central, superseded, journal, client, shipper, report };
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

  it("★ new edge + OLD central (no capability header): the record goes as expired_before_use — ACCEPTED, the authorisation superseded, the run stream NOT wedged; the journal keeps config_stale", async () => {
    const { central, superseded, journal, client, shipper, report } = await setup("old");
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(false);
    await journal.appendRun(9, 2, { kind: "step", stepId: "r1", stepType: "command", status: "completed", attempt: 1, startedAt: 1, finishedAt: 2, error: null, result: null, jti: null });
    expect(await report(unused("config_stale"))).toBe(true);
    expect(journal.isJtiConsumed(JTI)).toBe(true); // never usable again, whatever the wire says
    await journal.flush();
    expect(journal.pending("run:9:2").map((e) => (e.record as { reason?: string }).reason ?? null)).toEqual([null, "config_stale"]);
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
    const { central, superseded, journal, client, shipper, report } = await setup("new");
    expect(client.centralAccepts(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE)).toBe(true);
    expect(await report(unused("config_stale"))).toBe(true);
    await journal.flush();
    expect(await shipper.flush("run:9:2")).toBe("ok");
    expect(central.received.report).toMatchObject([{ kind: "auth_unused", jti: JTI, reason: "config_stale" }]);
    expect(superseded.get(JTI)).toBe("config_stale");
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
    expect(res.headers.get(EDGE_CENTRAL_ACCEPTS_HEADER)).toBe(EDGE_ACCEPTS_AUTH_UNUSED_CONFIG_STALE);
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
});

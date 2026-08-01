/**
 * Doc 51 P1 (QĐ#7) — tests for the inspection-ingest benchmark harness core.
 *
 * The harness lives in scripts/bench (ESM, no infra); this test sits under server/
 * so vitest's include picks it up (same arrangement as benchStats.test.ts).
 *
 * WHAT IS ACTUALLY LOAD-BEARING here, and therefore what these tests pin:
 *   • the production guard        — a false negative writes junk into a live line's DB
 *   • outcome classification      — mislabelling `queued` as `ok` HIDES data loss
 *   • integrity math              — unaccountedRows/duplicateRowsInDb ARE the deliverable
 *   • gate scoring                — an unmeasured gate must NEVER read as a pass
 *   • payload shape               — must satisfy submitInspectionInputSchema, incl. the
 *                                   P0 serialNumber .trim().min(1).max(100) bound
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
// scripts/ is outside the server tree — reach it explicitly (vite resolves .mjs).
import {
  parseArgs,
  validateConfig,
  assessTarget,
  isLocalHost,
  maskUrl,
  serialFor,
  serialLikeFor,
  makeImageBase64,
  buildInspection,
  classifyOutcome,
  unwrapBody,
  buildResult,
  evaluateGates,
  renderMarkdown,
  rngForMachine,
  parsePromGauge,
  DEFAULTS,
} from "../../../scripts/bench/lib/inspection-load.mjs";

// ── a FAITHFUL local copy of the server's submitInspectionInputSchema shape ──
// (server/routers/machineApiRouters.ts:116-178). Importing the router would drag
// the whole app graph into a pure test; this asserts the CONTRACT the harness must
// satisfy — notably the doc 51 P0 serialNumber bound.
const submitInspectionShape = z
  .object({
    machineCode: z.string().optional(),
    apiKey: z.string().optional(),
    serialNumber: z.string().trim().min(1).max(100),
    productModel: z.string().optional(),
    batchNumber: z.string().optional(),
    cycleTime: z.number().optional(),
    overallResult: z.enum(["OK", "NG", "NTF"]),
    inspectionTime: z.string().optional(),
    panelId: z.string().max(100).optional(),
    boardIndex: z.number().int().min(1).optional(),
    measurements: z.array(
      z.object({
        pointId: z.string().optional(),
        pointCode: z.string().optional(),
        measuredValue: z.union([z.number(), z.string()]).optional(),
        result: z.enum(["OK", "NG", "NTF"]),
        remark: z.string().optional(),
        imageBase64: z.string().optional(),
        valueHeight: z.union([z.number(), z.string()]).optional(),
        valueArea: z.union([z.number(), z.string()]).optional(),
        valueVolume: z.union([z.number(), z.string()]).optional(),
        valueOffsetX: z.union([z.number(), z.string()]).optional(),
        valueOffsetY: z.union([z.number(), z.string()]).optional(),
        defectSeverity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      }),
    ),
  })
  .refine((d) => d.apiKey || d.machineCode, { message: "Either apiKey or machineCode must be provided" });

describe("bench harness — CLI parsing", () => {
  it("parses --k=v, --k v, kebab→camel, and booleans", () => {
    const cfg = parseArgs(["--machines=100", "--rate", "2", "--image-kb=200", "--yes", "--endpoint=trpc"]);
    expect(cfg.machines).toBe(100);
    expect(cfg.rate).toBe(2);
    expect(cfg.imageKb).toBe(200);
    expect(cfg.yes).toBe(true);
    expect(cfg.endpoint).toBe("trpc");
    expect(cfg.duration).toBe(DEFAULTS.duration); // untouched default
  });

  it("collects unknown/malformed flags instead of silently benchmarking a default", () => {
    // A typo'd --machine=500 must NOT quietly run 100 machines and be reported as 500.
    const cfg = parseArgs(["--machine=500", "--machines=abc"]);
    expect(cfg.unknown).toContain("--machine=500");
    expect(cfg.unknown.some((u: string) => u.includes("--machines=abc"))).toBe(true);
    expect(cfg.machines).toBe(DEFAULTS.machines);
  });

  it("rejects configs that cannot produce an honest measurement", () => {
    expect(validateConfig({ ...DEFAULTS, machines: 0 })).toContain("--machines must be ≥ 1");
    expect(validateConfig({ ...DEFAULTS, endpoint: "grpc" }).join()).toMatch(/--endpoint/);
    expect(validateConfig({ ...DEFAULTS, imagePoints: 50, points: 20 }).join()).toMatch(/--image-points cannot exceed/);
    expect(validateConfig({ ...DEFAULTS, dupPct: 101 }).join()).toMatch(/--dup-pct/);
    expect(validateConfig({ ...DEFAULTS })).toEqual([]);
  });
});

describe("bench harness — production guard (safety)", () => {
  it("treats loopback + RFC1918 as safe", () => {
    for (const h of ["127.0.0.1", "localhost", "::1", "10.0.0.5", "192.168.1.7", "172.16.4.2", "172.31.255.1"]) {
      expect(isLocalHost(h), h).toBe(true);
    }
  });
  it("treats public/routable hosts as NOT local", () => {
    for (const h of ["8.8.8.8", "db.acme-factory.com", "172.32.0.1", "11.0.0.1", "192.169.1.1"]) {
      expect(isLocalHost(h), h).toBe(false);
    }
  });

  it("passes a local dev target", () => {
    const v = assessTarget({
      databaseUrl: "postgresql://avi_app:pw@127.0.0.1:5434/aoi_management",
      baseUrl: "http://127.0.0.1:3000",
      nodeEnv: "development",
    });
    expect(v.risky).toBe(false);
    expect(v.reasons).toEqual([]);
  });

  it("REFUSES on NODE_ENV=production", () => {
    const v = assessTarget({ databaseUrl: "postgresql://u:p@127.0.0.1:5434/aoi_management", baseUrl: "http://127.0.0.1:3000", nodeEnv: "production" });
    expect(v.risky).toBe(true);
    expect(v.reasons.join()).toMatch(/NODE_ENV=production/);
  });

  it("REFUSES on a production-looking DB name", () => {
    for (const name of ["aoi_prod", "aoi-production", "prod", "live", "aoi_live"]) {
      const v = assessTarget({ databaseUrl: `postgresql://u:p@127.0.0.1:5434/${name}`, baseUrl: "http://127.0.0.1:3000" });
      expect(v.risky, name).toBe(true);
    }
    // ...but does not fire on a name that merely CONTAINS the letters (no false refusal)
    expect(assessTarget({ databaseUrl: "postgresql://u:p@127.0.0.1:5434/aoi_products", baseUrl: "http://127.0.0.1:3000" }).risky).toBe(false);
  });

  it("REFUSES on a remote DB host or a remote app host", () => {
    expect(assessTarget({ databaseUrl: "postgresql://u:p@db.factory.vn:5432/aoi_management", baseUrl: "http://127.0.0.1:3000" }).reasons.join())
      .toMatch(/DB host .* not loopback/);
    expect(assessTarget({ databaseUrl: "postgresql://u:p@127.0.0.1:5434/aoi_management", baseUrl: "https://aoi.factory.vn" }).reasons.join())
      .toMatch(/app host .* not loopback/);
  });

  it("masks credentials in printed URLs", () => {
    expect(maskUrl("postgresql://avi_app:s3cr3t@127.0.0.1:5434/aoi")).not.toContain("s3cr3t");
  });
});

describe("bench harness — payload generation", () => {
  it("builds a payload the SERVER schema accepts", () => {
    const p = buildInspection({
      runId: "2607161200", machineIdx: 3, machineCode: "SIM-L1-AOI-01", seq: 42,
      rng: rngForMachine(51, 3), points: 20, imageKb: 8, imagePoints: 1,
    });
    const parsed = submitInspectionShape.safeParse(p);
    expect(parsed.success, JSON.stringify((parsed as any).error?.issues?.slice(0, 3))).toBe(true);
    expect(p.measurements).toHaveLength(20);
    expect(p.measurements.filter((m: any) => m.imageBase64).length).toBe(1);
  });

  it("honours the doc 51 P0 serial bound: non-empty, trimmed, ≤100 chars", () => {
    const s = serialFor("2607161200", 99, 59);
    expect(s.trim()).toBe(s);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(100);
    expect(z.string().trim().min(1).max(100).safeParse(s).success).toBe(true);
  });

  it("REFUSES to emit a serial that would exceed the varchar(100) column", () => {
    expect(() =>
      buildInspection({ runId: "x".repeat(120), machineIdx: 1, machineCode: "M", seq: 1, rng: rngForMachine(1, 1), points: 1, imageKb: 0 }),
    ).toThrow(/exceeds the 100-char column bound/);
  });

  it("serials are unique per (machine, seq) and greppable by run", () => {
    expect(serialFor("R1", 0, 0)).not.toBe(serialFor("R1", 0, 1));
    expect(serialFor("R1", 0, 0)).not.toBe(serialFor("R1", 1, 0));
    expect(serialFor("R1", 0, 0).startsWith("BENCH-R1-")).toBe(true);
    expect(serialLikeFor("R1")).toBe("BENCH-R1-%");
    expect(serialLikeFor("all")).toBe("BENCH-%");
  });

  it("image is a real-sized JPEG-magic blob of the REQUESTED DECODED size", () => {
    const b64 = makeImageBase64(200, rngForMachine(51, 0));
    const buf = Buffer.from(b64, "base64");
    expect(buf.length).toBe(200 * 1024); // decoded bytes = what the server holds in RAM
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8); // SOI
    expect(buf[buf.length - 1]).toBe(0xd9); // EOI
    // The base64 must clear the server's >200-char "is this an image?" gate,
    // otherwise the harness would measure a path that skips image upload entirely.
    expect(b64.length).toBeGreaterThan(200);
    expect(makeImageBase64(0, rngForMachine(51, 0))).toBe("");
  });

  it("is deterministic for a given seed (a rerun replays the same load)", () => {
    const mk = () => buildInspection({ runId: "R", machineIdx: 2, machineCode: "M2", seq: 7, rng: rngForMachine(51, 2), points: 5, imageKb: 1, imagePoints: 1, inspectionTime: "2026-07-16T00:00:00.000Z" });
    expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
  });
});

describe("bench harness — outcome classification", () => {
  it("counts a store-forward ACK as `queued`, NOT ok (it is not in the DB yet)", () => {
    // This is the silent-data-loss vector: success:true but inspectionId:null.
    expect(classifyOutcome(200, { success: true, queued: true, submissionId: "abc", inspectionId: null })).toBe("queued");
  });
  it("counts a P0 idempotency short-circuit as `duplicate`", () => {
    expect(classifyOutcome(200, { success: true, inspectionId: 77, duplicate: true })).toBe("duplicate");
  });
  it("counts a real persist as `ok`", () => {
    expect(classifyOutcome(200, { success: true, inspectionId: 77 })).toBe("ok");
  });
  it("does NOT let a 200-with-success:false pass as ok (the REST proxy shape)", () => {
    expect(classifyOutcome(200, { success: false, message: "boom" })).toBe("app_error");
  });
  it("separates 429 / 503 / 5xx / 4xx / network / timeout", () => {
    expect(classifyOutcome(429, null)).toBe("http_429");
    expect(classifyOutcome(503, null)).toBe("http_503");
    expect(classifyOutcome(500, null)).toBe("http_5xx");
    expect(classifyOutcome(400, null)).toBe("http_4xx");
    expect(classifyOutcome(0, null)).toBe("network");
    expect(classifyOutcome(-1, null)).toBe("timeout");
  });
  it("unwraps the tRPC superjson envelope as well as the flat REST body", () => {
    expect(unwrapBody({ result: { data: { json: { success: true, inspectionId: 5 } } } })).toEqual({ success: true, inspectionId: 5 });
    expect(unwrapBody({ success: true, inspectionId: 5 })).toEqual({ success: true, inspectionId: 5 });
    expect(classifyOutcome(200, { result: { data: { json: { success: true, queued: true, inspectionId: null } } } })).toBe("queued");
  });
});

// ── the deliverable: integrity math ──────────────────────────────────────────
const baseArgs = (buckets: Record<string, number>, dbCounts: any) => ({
  cfg: { ...DEFAULTS, machines: 10, rate: 1, duration: 10 },
  runId: "R",
  startedAt: "2026-07-16T00:00:00.000Z",
  wallMs: 10_000,
  latencies: [10, 20, 30, 40, 50],
  buckets,
  dbCounts,
  resources: null,
  machines: { provisioned: 0, reused: 10 },
  wireBytes: 1048576,
  hardware: null,
});

describe("bench harness — integrity math (the QĐ#7 deliverable)", () => {
  it("reports ZERO loss when every ok ack has a DB row", () => {
    const r = buildResult(baseArgs({ ok: 100 }, { rows: 100, distinctSerials: 100 }));
    expect(r.integrity.unaccountedRows).toBe(0);
    expect(r.integrity.duplicateRowsInDb).toBe(0);
    expect(r.throughput.accepted).toBe(100);
  });

  it("DETECTS silent data loss: server acked ok but the row is not in the DB", () => {
    const r = buildResult(baseArgs({ ok: 100 }, { rows: 93, distinctSerials: 93 }));
    expect(r.integrity.unaccountedRows).toBe(7); // ← the whole point of re-counting from the DB
    expect(evaluateGates(r).gates.find((g: any) => g.label.includes("data loss"))!.pass).toBe(false);
  });

  it("DETECTS a P0 idempotency failure: more DB rows than distinct serials", () => {
    const r = buildResult(baseArgs({ ok: 100, duplicate: 10 }, { rows: 104, distinctSerials: 100 }));
    expect(r.integrity.duplicateRowsInDb).toBe(4); // 0272 leaked under load
    expect(evaluateGates(r).gates.find((g: any) => g.label.includes("idempotency"))!.pass).toBe(false);
  });

  it("counts queued acks as accepted-but-NOT-in-DB, never as ok", () => {
    const r = buildResult(baseArgs({ ok: 90, queued: 10 }, { rows: 90, distinctSerials: 90 }));
    expect(r.integrity.okAcks).toBe(90);
    expect(r.integrity.queuedNotInDb).toBe(10);
    expect(r.integrity.unaccountedRows).toBe(0); // 90 ok = 90 rows; the 10 queued are honestly separate
    expect(r.throughput.accepted).toBe(100);
  });

  it("does not report NEGATIVE loss when the WAL replays queued rows into the DB", () => {
    // Observed in the real smoke test: 0 ok + 4 queued, then the backfill landed all
    // 4 rows. `ok − dbRows` reported "-4 unaccounted", which reads like a defect and
    // scored a PASS on a ≤0 gate. Bounded expectation is the honest framing.
    const r = buildResult(baseArgs({ queued: 4 }, { rows: 4, distinctSerials: 4 }));
    expect(r.integrity.minExpectedRows).toBe(0);
    expect(r.integrity.maxExpectedRows).toBe(4);
    expect(r.integrity.unaccountedRows).toBe(0);
    expect(r.integrity.unexplainedExcessRows).toBe(0);
  });

  it("DETECTS rows nobody acked for (excess beyond ok+queued)", () => {
    const r = buildResult(baseArgs({ ok: 10, queued: 2 }, { rows: 20, distinctSerials: 20 }));
    expect(r.integrity.unexplainedExcessRows).toBe(8); // 20 > 10+2
    expect(evaluateGates(r).gates.find((g: any) => g.label.includes("excess"))!.pass).toBe(false);
  });

  it("loss and replay do NOT cancel out (a signed single number would hide both)", () => {
    // 8 ok but only 4 ok-rows landed (4 LOST), while 4 queued replayed in → dbRows=8.
    // A naive ok−dbRows = 0 would call this perfectly healthy.
    const r = buildResult(baseArgs({ ok: 8, queued: 4 }, { rows: 8, distinctSerials: 8 }));
    expect(r.integrity.unaccountedRows).toBe(0); // dbRows(8) ≥ minExpected(8) → no PROVABLE loss
    expect(r.integrity.minExpectedRows).toBe(8);
    expect(r.integrity.maxExpectedRows).toBe(12);
    // ...and the queued gate still refuses to call it clean while the WAL holds data.
    expect(evaluateGates(r).gates.find((g: any) => g.label.includes("store-forward backlog"))!.pass).toBe(false);
  });

  it("FAILS the run while any submission is still only in the WAL (accepted ≠ queryable)", () => {
    const r = buildResult(baseArgs({ ok: 99, queued: 1 }, { rows: 99, distinctSerials: 99 }));
    const g = evaluateGates(r);
    expect(g.pass).toBe(false);
    expect(g.gates.find((x: any) => x.label.includes("store-forward backlog"))!.pass).toBe(false);
  });

  it("computes error rate from the non-accepted buckets", () => {
    const r = buildResult(baseArgs({ ok: 90, http_429: 5, http_503: 3, timeout: 2 }, { rows: 90, distinctSerials: 90 }));
    expect(r.errorRatePct).toBe(10);
    expect(r.throughput.acceptedPct).toBe(90);
  });

  it("flags the HARNESS as the bottleneck via offeredPct (never claims a server pass)", () => {
    // 10 machines × 1/s × 10s = 100 demanded, but only 60 attempts were made.
    const r = buildResult(baseArgs({ ok: 60 }, { rows: 60, distinctSerials: 60 }));
    expect(r.throughput.offeredPct).toBe(60);
    expect(evaluateGates(r).gates.find((g: any) => g.label.includes("harness kept up"))!.pass).toBe(false);
  });

  it("marks NOT-MEASURED integrity as unmeasured — never a silent pass", () => {
    const r = buildResult(baseArgs({ ok: 100 }, null));
    expect(r.integrity.unaccountedRows).toBeNull();
    const g = evaluateGates(r);
    expect(g.gates.find((x: any) => x.label.includes("data loss"))!.pass).toBeNull();
    expect(g.pass).toBe(false); // unmeasured ⇒ NOT a pass
    expect(g.unmeasured).toBeGreaterThan(0);
  });
});

describe("bench harness — gate scoring + report", () => {
  const good = () => buildResult(baseArgs({ ok: 100 }, { rows: 100, distinctSerials: 100 }));

  it("passes a clean run against the proposed SLA", () => {
    const g = evaluateGates(good());
    expect(g.pass).toBe(true);
    expect(g.failed).toBe(0);
    expect(g.unmeasured).toBe(0);
  });

  it("fails when p95 latency exceeds the threshold", () => {
    const r = { ...good(), latencyMs: { n: 5, min: 1, max: 9000, mean: 5000, p50: 5000, p95: 8000, p99: 9000, p999: 9000 } };
    const g = evaluateGates(r as any);
    expect(g.pass).toBe(false);
    expect(g.gates.find((x: any) => x.label === "latency p95")!.pass).toBe(false);
  });

  it("renders markdown that surfaces the integrity numbers", () => {
    const r = buildResult(baseArgs({ ok: 100 }, { rows: 93, distinctSerials: 93 }));
    const md = renderMarkdown(r, evaluateGates(r));
    expect(md).toContain("Thất thoát âm thầm");
    expect(md).toContain("**7**"); // the loss is stated in the human report, not buried
    expect(md).toContain("FAIL");
  });

  it("renders KHÔNG ĐO (not measured) rather than a blank/zero when the DB was not counted", () => {
    const r = buildResult(baseArgs({ ok: 100 }, null));
    const md = renderMarkdown(r, evaluateGates(r));
    expect(md).toContain("KHÔNG ĐO");
  });
});

describe("bench harness — prometheus scrape parsing", () => {
  it("reads the app-server RSS/heap gauges", () => {
    const text = [
      "# HELP avi_aoi_process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE avi_aoi_process_resident_memory_bytes gauge",
      "avi_aoi_process_resident_memory_bytes 524288000",
      "avi_aoi_nodejs_heap_size_used_bytes 268435456",
    ].join("\n");
    expect(parsePromGauge(text, "avi_aoi_process_resident_memory_bytes")).toBe(524288000);
    expect(parsePromGauge(text, "avi_aoi_nodejs_heap_size_used_bytes")).toBe(268435456);
    expect(parsePromGauge(text, "avi_aoi_missing_metric")).toBeNull();
    expect(parsePromGauge("", "x")).toBeNull();
  });
});

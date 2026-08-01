import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Request } from "express";
import type { AddressInfo } from "net";

// V3: The default API limit is 300/min (RATE_LIMIT_PER_MINUTE), so a 100-request test was
// non-deterministic (the 101st request was still under the cap → 200, not 429). Pin the cap
// to a known 100 via env BEFORE the limiter module reads it, so the config the test drives is
// exact and wall-clock-independent (we issue exactly max+1 requests synchronously in-window).
process.env.RATE_LIMIT_PER_MINUTE = "100";
// doc 51 R6: pin the machine ingest tier to a SMALL number so exhausting it costs 6 requests
// instead of 60_000. The production default is far HIGHER than the API tier — these tests
// prove the ROUTING and the KEYING, not the shipped number (asserted separately below).
process.env.MACHINE_INGEST_RATE_MAX = "5";

const {
  createApiLimiter,
  createMachineIngestLimiter,
  apiKeyGenerator,
  hasCredentialKey,
  isMachineIngestRequest,
  MACHINE_BOOTSTRAP_PATHS,
} = await import("./_core/rateLimitConfig");

const RATE_LIMIT_MAX = 100;
const MACHINE_MAX = 5;
let server: ReturnType<express.Application["listen"]>;
let baseUrl = "";
const limiter = createApiLimiter();
const machineLimiter = createMachineIngestLimiter();

/** Minimal Request stand-in for the pure key-generator unit tests. */
const fakeReq = (over: Partial<Request> & Record<string, unknown> = {}): Request =>
  ({ headers: {}, query: {}, body: undefined, ip: "10.0.0.7", ...over }) as unknown as Request;

beforeAll(async () => {
  const app = express();
  // Mirror PRODUCTION middleware order (_core/index.ts): body parser FIRST, then the
  // machine ingest limiter, then the general /api limiter. If the parser ran after the
  // limiters, req.body would be undefined and body-credential keying could not work.
  app.use(express.json());
  app.use("/api/", machineLimiter);
  app.use("/api", limiter);

  app.get("/api/ping", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/api/machine/heartbeat", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post("/api/machine/claim", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  // Express 4 wildcard: match any procedure path under /api/trpc/ (incl. batched,
  // comma-separated names) so the limiter — not routing — decides the status.
  app.post("/api/trpc/*", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
});

/** POST a tRPC-shaped body ({ json: {...} }) — the shape the machine contract allows. */
const postTrpc = (proc: string, body: unknown) =>
  fetch(`${baseUrl}/api/trpc/${proc}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const postMachine = (path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("API rate limit policy", () => {
  it("should block the request past the configured limit in one minute window", async () => {
    let lastStatus = 0;

    // Issue exactly max+1 requests within the same 60s window. The first `max` are allowed
    // (200); the one past the cap is rejected (429). No wall-clock dependence.
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      const res = await fetch(`${baseUrl}/api/ping`);
      lastStatus = res.status;
      if (i < RATE_LIMIT_MAX) {
        expect(res.status).toBe(200);
      }
    }

    expect(lastStatus).toBe(429);
  });

  it("should not affect a different user bucket", async () => {
    limiter.resetKey("::ffff:127.0.0.1");
    limiter.resetKey("127.0.0.1");

    const res = await fetch(`${baseUrl}/api/ping`);

    expect(res.status).toBe(200);
  });
});

// ── doc 51 R6 — CASE #2/#9: mất dữ liệu do rate-limit sau NAT nhà máy ─────────

describe("credential key generator (doc 51 R6)", () => {
  it("keys two machines that send DIFFERENT apiKeys in the tRPC body to DIFFERENT buckets, even from the SAME ip", () => {
    const a = apiKeyGenerator(fakeReq({ body: { json: { apiKey: "machine-A-key" } }, ip: "203.0.113.9" }));
    const b = apiKeyGenerator(fakeReq({ body: { json: { apiKey: "machine-B-key" } }, ip: "203.0.113.9" }));

    // The pre-R6 bug: both fell through to ipKeyGenerator → ONE shared bucket.
    expect(a).not.toBe(b);
    expect(a).toMatch(/^key:/);
    expect(b).toMatch(/^key:/);
  });

  it("gives the SAME bucket whether a machine sends its key by header or by body", () => {
    const viaHeader = apiKeyGenerator(fakeReq({ headers: { "x-api-key": "same-key" } }));
    const viaBody = apiKeyGenerator(fakeReq({ body: { json: { apiKey: "same-key" } } }));
    const viaRest = apiKeyGenerator(fakeReq({ body: { apiKey: "same-key" } }));
    const viaQuery = apiKeyGenerator(fakeReq({ query: { apiKey: "same-key" } }));

    expect(viaBody).toBe(viaHeader);
    expect(viaRest).toBe(viaHeader);
    expect(viaQuery).toBe(viaHeader);
  });

  it("reads the apiKey out of a tRPC httpBatchLink envelope", () => {
    const batched = apiKeyGenerator(fakeReq({ body: { "0": { json: { apiKey: "batch-key" } } } }));
    expect(batched).toBe(apiKeyGenerator(fakeReq({ headers: { "x-api-key": "batch-key" } })));
  });

  it("falls back to a per-machine bucket for the machineCode-only weak path", () => {
    const a = apiKeyGenerator(fakeReq({ body: { json: { machineCode: "AOI-01" } }, ip: "203.0.113.9" }));
    const b = apiKeyGenerator(fakeReq({ body: { json: { machineCode: "AOI-02" } }, ip: "203.0.113.9" }));
    expect(a).toMatch(/^mcode:/);
    expect(a).not.toBe(b);
  });

  it("still falls back to the IP bucket when NO credential is present", () => {
    const key = apiKeyGenerator(fakeReq({ ip: "198.51.100.4" }));
    // Bare (un-prefixed) IP key — pre-B6 compatible (`limiter.resetKey("<ip>")`).
    expect(key).toBe("198.51.100.4");
    expect(hasCredentialKey(fakeReq({ ip: "198.51.100.4" }))).toBe(false);
  });

  it("never puts a raw credential into the bucket key", () => {
    const key = apiKeyGenerator(fakeReq({ body: { json: { apiKey: "super-secret-key" } } }));
    expect(key).not.toContain("super-secret-key");
  });

  it("does not throw on hostile/odd body shapes", () => {
    for (const body of [null, "a string", 42, [], { json: null }, { json: { apiKey: 5 } }, { apiKey: "" }]) {
      expect(() => apiKeyGenerator(fakeReq({ body: body as unknown }))).not.toThrow();
    }
  });
});

describe("machine ingest tier routing (doc 51 R6)", () => {
  it("routes the machine data plane (REST + allowlisted tRPC) to the ingest tier", () => {
    const at = (url: string) => isMachineIngestRequest(fakeReq({ originalUrl: url } as never));
    expect(at("/api/machine/submit-inspection")).toBe(true);
    expect(at("/api/machine/heartbeat")).toBe(true);
    expect(at("/api/trpc/machineApi.submitInspection")).toBe(true);
    expect(at("/api/trpc/machineApi.submitInspection?batch=1")).toBe(true);
    expect(at("/api/trpc/machineApi.uploadImage,machineApi.heartbeat?batch=1")).toBe(true);
  });

  it("keeps browser/admin traffic OFF the ingest tier", () => {
    const at = (url: string) => isMachineIngestRequest(fakeReq({ originalUrl: url } as never));
    expect(at("/api/ping")).toBe(false);
    expect(at("/api/trpc/user.list")).toBe(false);
    // machineApi ALSO exposes admin key management — it must never inherit the high tier.
    expect(at("/api/trpc/machineApi.issueKey")).toBe(false);
    expect(at("/api/trpc/machineApi.rotateKey")).toBe(false);
    // A batch may not smuggle a browser procedure in behind a machine procedure.
    expect(at("/api/trpc/machineApi.heartbeat,machineApi.issueKey?batch=1")).toBe(false);
  });

  it("keeps the UNAUTHENTICATED bootstrap endpoints on the general tier (brute-force surface)", () => {
    for (const p of MACHINE_BOOTSTRAP_PATHS) {
      expect(isMachineIngestRequest(fakeReq({ originalUrl: p } as never))).toBe(false);
    }
    expect(MACHINE_BOOTSTRAP_PATHS).toContain("/api/machine/claim");
  });
});

describe("machine ingest limiter (doc 51 R6)", () => {
  it("gives two machines behind ONE ip separate buckets, and sends Retry-After on 429", async () => {
    const drain = async (apiKey: string) => {
      let last = 0;
      for (let i = 0; i < MACHINE_MAX + 1; i++) {
        const res = await postTrpc("machineApi.submitInspection", { json: { apiKey } });
        last = res.status;
        if (i < MACHINE_MAX) expect(res.status).toBe(200);
      }
      return last;
    };

    // Machine A exhausts ITS bucket (both machines hit from 127.0.0.1 — the factory NAT).
    expect(await drain("nat-machine-A")).toBe(429);

    // Machine B — same IP, different key — must be UNAFFECTED. Pre-R6 both shared one
    // IP bucket, so B was already 429 here (~95% loss for 100 machines behind one NAT).
    const b = await postTrpc("machineApi.submitInspection", { json: { apiKey: "nat-machine-B" } });
    expect(b.status).toBe(200);

    // CASE #2: a client draining a backlog after an outage must learn how long to wait.
    const throttled = await postTrpc("machineApi.submitInspection", { json: { apiKey: "nat-machine-A" } });
    expect(throttled.status).toBe(429);
    const retryAfter = throttled.headers.get("retry-after");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("is a SEPARATE tier from the general /api limiter (exhausting one leaves the other open)", async () => {
    const apiKey = "tier-split-machine";

    // Exhaust this machine's INGEST bucket.
    for (let i = 0; i < MACHINE_MAX + 1; i++) {
      await postMachine("/api/machine/heartbeat", { apiKey });
    }
    expect((await postMachine("/api/machine/heartbeat", { apiKey })).status).toBe(429);

    // The SAME credential on a general /api route is a DIFFERENT bucket → still allowed.
    const general = await fetch(`${baseUrl}/api/ping`, { headers: { "x-api-key": apiKey } });
    expect(general.status).toBe(200);
  });

  it("is EXEMPT from the general /api limiter (no double-counting when that bucket is spent)", async () => {
    const apiKey = "exempt-machine";

    // Spend this credential's GENERAL bucket completely.
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      await fetch(`${baseUrl}/api/ping`, { headers: { "x-api-key": apiKey } });
    }
    expect((await fetch(`${baseUrl}/api/ping`, { headers: { "x-api-key": apiKey } })).status).toBe(429);

    // A machine-ingest request with the SAME credential must still pass: the general
    // limiter `skip`s machine ingest, so each request is counted by EXACTLY ONE tier.
    // Drop the `skip` and the exhausted general bucket would 429 machine ingest here.
    const ingest = await postMachine("/api/machine/heartbeat", { apiKey });
    expect(ingest.status).toBe(200);
  });

  it("does NOT hand keyless callers the high ceiling (bootstrap surface keeps 300/min)", async () => {
    // Keyless machine-ingest requests are IP-keyed; their max stays API_PER_MIN (100),
    // NOT MACHINE_INGEST_RATE_MAX (5). Past the machine cap they must STILL pass —
    // otherwise exempting /api/machine/* from the general tier would have handed an
    // anonymous attacker a large amplifier on un-authenticated machine endpoints.
    let last = 0;
    for (let i = 0; i < MACHINE_MAX + 3; i++) {
      last = (await postMachine("/api/machine/heartbeat", {})).status;
    }
    expect(last).toBe(200);
  });
});

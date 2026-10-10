/**
 * doc 81 Đợt 5 G fix 1 (ruling R-5-b, sweep) — rate-limit tier / bucket classification must see a request the way
 * Express ROUTES it: case-insensitively (`caseSensitive: false`) and with one optional trailing slash (`strict: false`).
 *
 * Before: the classifiers compared the raw path case-sensitively, so a variant Express still routes to the same handler
 * fell into the wrong class:
 *   · `POST /API/ot/ingest` + a random `Authorization: Bearer` per request — the legacy OT route never reads Bearer,
 *     but the bucket was keyed on it (fresh bucket each request) and the conflicting-credential guard was skipped
 *     ⇒ rate-limit evasion on the ingest path;
 *   · `/api/machine/CLAIM` or `/api/machine/claim/` (unauthenticated bootstrap, a brute-force target) escaped the
 *     bootstrap list and got the 60k/min machine tier (with any bogus credential) instead of 300/min.
 * Oracle: the exported classifiers/key generator + the real guard, on plain request objects; the canonical lower-case
 * path is the reference — every variant must classify exactly like it.
 */
import { describe, it, expect } from "vitest";
import {
  apiKeyGenerator,
  credentialConflictGuard,
  isLegacyOtIngestRequest,
  isMachineIngestRequest,
  isMachineRestIngestRequest,
  isOtIngestRequest,
} from "./rateLimitConfig";

const reqOf = (url: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  ({ originalUrl: url, url, headers, body, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } }) as never;

describe("R-5-b — rate-limit classification is case-insensitive like Express routing", () => {
  it("OT ingest paths: any letter case is the same tier (and still no prefix false-positive)", () => {
    for (const p of ["/API/ot/ingest", "/Api/Ot/Ingest", "/api/OT/ingest?x=1", "/API/V1/INGEST/telemetry", "/api/v1/Ingest"]) {
      expect(isOtIngestRequest(reqOf(p)), p).toBe(true);
    }
    expect(isOtIngestRequest(reqOf("/API/OT/INGESTXYZ"))).toBe(false);
    expect(isLegacyOtIngestRequest(reqOf("/API/OT/INGEST"))).toBe(true);
    expect(isLegacyOtIngestRequest(reqOf("/API/V1/INGEST/telemetry"))).toBe(false);
  });

  it("legacy /api/ot/ingest bucket ignores Bearer on EVERY case variant (no fresh bucket per random Bearer)", () => {
    const key = "mk_live_same";
    const canonical = apiKeyGenerator(reqOf("/api/ot/ingest", { "x-api-key": key, authorization: "Bearer r1" }));
    for (const [p, b] of [["/API/ot/ingest", "r2"], ["/Api/Ot/Ingest", "r3"], ["/api/OT/INGEST", "r4"]] as const) {
      expect(apiKeyGenerator(reqOf(p, { "x-api-key": key, authorization: `Bearer ${b}` })), p).toBe(canonical);
    }
  });

  it("conflicting-credential guard runs on case variants of the machine plane (400, next() not called)", () => {
    for (const p of ["/API/ot/ingest", "/Api/V1/Ingest/telemetry", "/API/MACHINE/heartbeat"]) {
      let status = 0;
      let nexted = false;
      const res = { status(c: number) { status = c; return this; }, json() { return this; } } as never;
      credentialConflictGuard(reqOf(p, { "x-api-key": "k1" }, { apiKey: "k2" }), res, () => { nexted = true; });
      expect({ p, status, nexted }).toEqual({ p, status: 400, nexted: false });
    }
  });

  it("machine bootstrap paths (claim/register/config) stay OUT of the high tier for any case and a trailing slash", () => {
    for (const p of ["/api/machine/claim", "/API/MACHINE/CLAIM", "/api/machine/Claim", "/api/machine/claim/", "/API/machine/REGISTER/", "/api/machine/config?serial=1"]) {
      expect(isMachineRestIngestRequest(reqOf(p)), p).toBe(false);
      expect(isMachineIngestRequest(reqOf(p)), p).toBe(false);
    }
    for (const p of ["/api/machine/heartbeat", "/API/Machine/heartbeat", "/api/MACHINE"]) {
      expect(isMachineRestIngestRequest(reqOf(p)), p).toBe(true);
    }
  });

  it("tRPC machine tier: the /api/trpc/ prefix is matched case-insensitively, procedure names exactly (tRPC resolves them case-sensitively)", () => {
    expect(isMachineIngestRequest(reqOf("/api/trpc/machineApi.heartbeat"))).toBe(true);
    expect(isMachineIngestRequest(reqOf("/API/TRPC/machineApi.heartbeat"))).toBe(true);
    expect(isMachineIngestRequest(reqOf("/API/TRPC/machineapi.heartbeat"))).toBe(false); // not a real procedure
    expect(isMachineIngestRequest(reqOf("/API/trpc/machineApi.heartbeat,machineApi.issueKey"))).toBe(false); // batch smuggling still refused
  });
});

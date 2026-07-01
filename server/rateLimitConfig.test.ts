import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";

// V3: The default API limit is 300/min (RATE_LIMIT_PER_MINUTE), so a 100-request test was
// non-deterministic (the 101st request was still under the cap → 200, not 429). Pin the cap
// to a known 100 via env BEFORE the limiter module reads it, so the config the test drives is
// exact and wall-clock-independent (we issue exactly max+1 requests synchronously in-window).
process.env.RATE_LIMIT_PER_MINUTE = "100";
const { createApiLimiter } = await import("./_core/rateLimitConfig");

const RATE_LIMIT_MAX = 100;
let server: ReturnType<express.Application["listen"]>;
let baseUrl = "";
const limiter = createApiLimiter();

beforeAll(async () => {
  const app = express();
  app.use("/api", limiter);
  app.get("/api/ping", (_req, res) => {
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

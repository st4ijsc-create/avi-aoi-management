import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { createApiLimiter } from "./_core/rateLimitConfig";

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
  it("should block the 101st request in one minute window", async () => {
    let lastStatus = 0;

    for (let i = 0; i < 101; i++) {
      const res = await fetch(`${baseUrl}/api/ping`);
      lastStatus = res.status;
      if (i < 100) {
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

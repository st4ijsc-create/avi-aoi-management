/**
 * doc 44 W6-4 (G5.25) — liveness / readiness probes for shadow→canary gating.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createHealthHandler, livenessProbe, readinessProbe, type ProbeHandlerDeps } from "./healthProbes";
import { __datTrangThaiSchemaR1a } from "./kiemSchemaR1a";

/** R1b-2a T12 — `/health` route THẬT (handler index.ts gắn) với ping giả khoẻ. */
async function goiHealth(deps: Omit<ProbeHandlerDeps, "pinger"> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.get("/health", createHealthHandler({ pinger: { ping: async () => ({ ok: true, ms: 1 }) } as never, ...deps }));
  const srv = app.listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/health`);
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  } finally {
    srv.close();
  }
}

describe("★ R1b-2a T12 — /health 'dang_kiem' trước lần kiểm schema đầu tiên", () => {
  afterEach(() => __datTrangThaiSchemaR1a({ kieu: "chua_kiem" }));

  it("chua_kiem (mặc định lúc tiến trình vừa lên) ⇒ 200, status ok, schemaR1a {ok:false, dang_kiem, null, chua_xong}", async () => {
    __datTrangThaiSchemaR1a({ kieu: "chua_kiem" });
    const r = await goiHealth();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("ok");
    expect(r.body.schemaR1a).toEqual({ ok: false, trangThai: "dang_kiem", thieuMigration: null, lyDo: "chua_xong" });
  });

  it("đã kiểm đủ ⇒ không có khoá schemaR1a", async () => {
    __datTrangThaiSchemaR1a({ kieu: "da_kiem", luc: "x", thieu0431: [], thieu0432: [], thieu0433: [], thieu0434: [], thieu0433Fk: [] });
    const r = await goiHealth();
    expect(r.body.status).toBe("ok");
    expect(r.body).not.toHaveProperty("schemaR1a");
  });

  it("thứ tự ưu tiên: thiếu > không kiểm được > đang kiểm (một khoá); chỉ 'thieu' làm degraded", async () => {
    const thieu = { ok: false as const, trangThai: "thieu" as const, thieuMigration: ["0433"], lyDo: "x" };
    const khong = { ok: false as const, trangThai: "chua_kiem_duoc" as const, thieuMigration: null, lyDo: "khac" as const };
    const dang = { ok: false as const, trangThai: "dang_kiem" as const, thieuMigration: null, lyDo: "chua_xong" as const };
    const a = await goiHealth({ schemaR1a: () => thieu, schemaR1aChuaKiem: () => khong, schemaR1aDangKiem: () => dang });
    expect(a.body).toMatchObject({ status: "degraded", schemaR1a: thieu });
    const b = await goiHealth({ schemaR1a: () => null, schemaR1aChuaKiem: () => khong, schemaR1aDangKiem: () => dang });
    expect(b.body).toMatchObject({ status: "ok", schemaR1a: khong });
    const c = await goiHealth({ schemaR1a: () => null, schemaR1aChuaKiem: () => null, schemaR1aDangKiem: () => dang });
    expect(c.body).toMatchObject({ status: "ok", schemaR1a: dang });
    const d = await goiHealth({ schemaR1a: () => null, schemaR1aChuaKiem: () => null, schemaR1aDangKiem: () => null });
    expect(d.body).not.toHaveProperty("schemaR1a");
  });
});

describe("G5.25 — livenessProbe", () => {
  it("always reports alive with pid + uptime", () => {
    const r = livenessProbe();
    expect(r.status).toBe("alive");
    expect(typeof r.pid).toBe("number");
    expect(r.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(typeof r.ts).toBe("string");
  });
});

describe("G5.25 — readinessProbe", () => {
  it("is ready when DB is reachable (broker up)", async () => {
    const r = await readinessProbe({ checkDb: async () => true, checkBroker: async () => true });
    expect(r.ready).toBe(true);
    expect(r.status).toBe("ready");
    expect(r.checks.db).toBe("ok");
    expect(r.checks.broker).toBe("ok");
  });

  it("is NOT ready when DB is down (hard gate)", async () => {
    const r = await readinessProbe({ checkDb: async () => false, checkBroker: async () => true });
    expect(r.ready).toBe(false);
    expect(r.status).toBe("not_ready");
    expect(r.checks.db).toBe("down");
  });

  it("stays ready when the broker is disabled (broker is not a gate)", async () => {
    const r = await readinessProbe({ checkDb: async () => true, checkBroker: async () => null });
    expect(r.ready).toBe(true);
    expect(r.checks.broker).toBe("disabled");
  });

  it("never throws — a checker error degrades to not_ready", async () => {
    const r = await readinessProbe({
      checkDb: async () => {
        throw new Error("boom");
      },
    });
    expect(r.ready).toBe(false);
    expect(r.checks.db).toBe("down");
  });
});

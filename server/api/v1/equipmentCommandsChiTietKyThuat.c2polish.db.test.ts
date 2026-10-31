/**
 * CỔNG CSDL THẬT — SCADA R1b-2b-2b A, C2 polish (điều phối 2026-11-01; review fix 4 "Observation") — REST `POST /api/v1/equipment/:id/commands`.
 *
 * Lỗ: tuyến (chỉ robot; OT ⇒ 501) trả `result.error` / `result.detail` NGUYÊN của `EquipmentCommandResult` — thông điệp driver / controller robot có thể
 * mang host:port. Luật: khoá API không bao giờ là người xem chi tiết kỹ thuật ⇒ `cheKetQuaLenh(result, false)`: `error` ⇒ MÃ, `detail` ⇒ danh sách trắng.
 *
 * THẬT: khoá API (`api_keys`, băm SHA-256, scope `equipment:command`, phạm vi `global`) qua `requireScope` thật, router `/api/v1` thật, HTTP thật, máy
 * ROBOT thật trong `_test`. Chỉ thay RANH GIỚI thiết bị: `equipmentRegistry.getAdapter(...).sendCommand` trả một kết quả mang sentinel (như controller thật
 * có thể trả) — không lệnh nào tới thiết bị. Dọn có KHẲNG ĐỊNH; không chèn id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { hashApiKey } from "./auth";
import { createV1Router } from "./router";
import { equipmentRegistry } from "../../services/equipment/equipmentAdapter";

const DB_URL = process.env.DATABASE_URL;
const DAU = `C2P-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const KHOA_THO = `c2p_${randomBytes(18).toString("hex")}`;
const SENT = "SENTINEL-10.9.8.7:5020-xyz";
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const ids: Record<string, number> = {};
const one = async (q: Promise<any[]>) => Number((await q)[0].id);
const coLo = (s: string) => /SENTINEL|10\.9\.8\.7|:5020/.test(s);

describe.skipIf(!DB_URL)("C2 polish — REST POST /api/v1/equipment/:id/commands che result.error / result.detail với khoá API (sentinel)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const code = DAU;
    ids.f = await one(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    ids.w = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.f}, ${code}, ${code}) RETURNING id`);
    ids.l = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.w}, ${code}, ${code}) RETURNING id`);
    ids.s = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.l}, ${code}, ${code}) RETURNING id`);
    ids.m = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.s}, ${code}, ${code}, 'ROBOT', true) RETURNING id`);
    ids.k = await one(sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode")
      VALUES (${`${DAU}-khoa`}, ${hashApiKey(KHOA_THO)}, ${sql.json(["equipment:command"])}, 'global') RETURNING id`);
    // RANH GIỚI thiết bị: controller trả lỗi mang host:port (sentinel) — không có lệnh nào tới thiết bị thật
    vi.spyOn(equipmentRegistry, "getAdapter").mockImplementation(
      () =>
        ({
          sendCommand: async () => ({
            ok: false,
            status: "failed",
            routedTo: "robot-dispatcher",
            error: `robot controller ${SENT} refused: connect ECONNREFUSED 10.9.8.7:5020`,
            detail: { jobId: 4242, edge: true, stop: true, reason: `ECONNREFUSED 10.9.8.7:5020 ${SENT}`, refusal: SENT, jti: "j-1", result: { raw: SENT }, motPhan: { daAp: ["a"], khongAp: ["b"] } },
          }),
        }) as never,
    );
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (!sql) return;
    try {
      await sql`DELETE FROM api_keys WHERE name LIKE ${DAU + "%"}`;
      await sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`;
      const [con] = await sql`SELECT
          (SELECT count(*)::int FROM api_keys WHERE name LIKE ${DAU + "%"}) AS api_keys,
          (SELECT count(*)::int FROM machines WHERE code LIKE ${DAU + "%"}) AS machines,
          (SELECT count(*)::int FROM factories WHERE code LIKE ${DAU + "%"}) AS factories`;
      expect(con, "hàng fixture còn sót sau khi dọn").toEqual({ api_keys: 0, machines: 0, factories: 0 });
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  const post = (khoa: string | null) =>
    fetch(`${base}/api/v1/equipment/${ids.m}/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(khoa ? { authorization: `Bearer ${khoa}` } : {}) },
      body: JSON.stringify({ command: "abort", args: { robotId: 1 }, idempotencyKey: `${DAU}-1` }),
    });

  it("đối chứng cổng: không khoá ⇒ 401 (requireScope THẬT)", async () => {
    expect((await post(null)).status).toBe(401);
  });

  it("★★★ khoá API equipment:command: thân không chứa SENTINEL / 10.9.8.7 / :5020; error = MÃ; detail = danh sách trắng (jobId, edge, stop, reason mã, motPhan đếm)", async () => {
    const r = await post(KHOA_THO);
    const text = await r.text();
    expect(r.status, text).toBe(200);
    expect(coLo(text), text).toBe(false);
    const d = JSON.parse(text).data;
    expect(d).toMatchObject({ machineId: ids.m, command: "abort", routedTo: "robot-dispatcher", status: "failed", accepted: false, error: "DRIVER_WRITE_FAILED" });
    expect(d.detail).toEqual({ jobId: 4242, edge: true, stop: true, reason: "TECHNICAL_ERROR", motPhan: { soDaAp: 1, soKhongAp: 1 } });
  });
});

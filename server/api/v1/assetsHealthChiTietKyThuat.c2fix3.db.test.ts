/**
 * CỔNG CSDL THẬT — SCADA R1b-2b-2b A, C2 fix round 3 (điều phối 2026-10-31, KD-2bA 2.1 "né đường vòng").
 *
 * Lỗ: `GET /api/v1/assets/:id/health` trả `device_adapters.lastError` THÔ (văn bản driver, có thể mang host:port) cho mọi khoá API có scope
 * `assets:read` — đúng luật 2.1 thoát qua một bề mặt phụ. Luật: khoá API KHÔNG BAO GIỜ là người xem chi tiết kỹ thuật ⇒ CÙNG bộ che với tRPC
 * `deviceAdapter.list` (`redactAdapterRow`, người xem `chiTietKyThuat: false`): `endpoint` / `connectionOptions` ⇒ null, `lastError` ⇒ MÃ đã làm sạch,
 * thêm `maLoi` + `tamKhoa`.
 *
 * KHÔNG mock gì: khoá API THẬT (hàng `api_keys`, băm SHA-256 như `hashApiKey`, scope `assets:read`, phạm vi nhà máy của chính fixture) đi qua
 * `requireScope` thật, router `/api/v1` thật, Express + HTTP thật, CSDL `_test`. Không chạm bảng WORM (chỉ dựng cây nhà máy → máy → adapter + khoá).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { hashApiKey } from "./auth";
import { createV1Router } from "./router";

const DB_URL = process.env.DATABASE_URL;
const DAU = `C2F3-${Date.now()}`;
const KHOA_THO = `c2f3_${randomBytes(18).toString("hex")}`;
const SENTINEL_LOI = "SENTINEL-10.9.8.7:5020-xyz connect ECONNREFUSED 10.9.8.7:5020";
const SENTINEL_EP = "tcp://10.9.8.7:5020";
const SENTINEL_MC_LOI = "OT_MC_TAM_KHOA: SENTINEL ghi tam khoa 10.9.8.7:5020";
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const ids: Record<string, number> = {};
const x = <T>(r: unknown): T => (r as T[])[0]!;

async function goi(path: string, khoa: string | null = KHOA_THO): Promise<{ status: number; text: string; body: any }> {
  const r = await fetch(`${base}${path}`, { headers: khoa ? { authorization: `Bearer ${khoa}` } : {} });
  const text = await r.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* không phải JSON */
  }
  return { status: r.status, text, body };
}

describe.skipIf(!DB_URL)("C2 fix 3 — GET /api/v1/assets/:id/health che chi tiết kỹ thuật adapter với khoá API (sentinel)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const code = DAU;
    const path = `${DAU.toLowerCase()}/a/l/c/e`;
    ids.f = x<{ id: number }>(await sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`).id;
    ids.w = x<{ id: number }>(await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.f}, ${code}, ${code}) RETURNING id`).id;
    ids.l = x<{ id: number }>(await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.w}, ${code}, ${code}) RETURNING id`).id;
    ids.s = x<{ id: number }>(await sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.l}, ${code}, ${code}) RETURNING id`).id;
    ids.m = x<{ id: number }>(
      await sql`INSERT INTO machines ("stationId", code, name, "machineType", isa95_path, "isActive") VALUES (${ids.s}, ${code}, ${code}, 'AOI', ${path}, true) RETURNING id`,
    ).id;
    // adapter 1: modbus đang lỗi — văn bản driver mang host:port, endpoint + host dự phòng + mật khẩu là sentinel
    ids.a1 = x<{ id: number }>(
      await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "connectionOptions", "pollIntervalMs", "isEnabled", status, "lastError", "lastErrorAt")
        VALUES (${ids.m}, ${code + "-MB"}, ${code + "-MB"}, 'modbus', ${SENTINEL_EP},
          ${sql.json({ unitId: 1, password: "SENTINEL-pw", ha: { secondaryEndpoint: "tcp://10.9.8.7:5021" } })}, 500, false, 'error', ${SENTINEL_LOI}, now()) RETURNING id`,
    ).id;
    // adapter 2: MC do TRUNG TÂM chạy (không edgeNodeId) — posture tạm khoá phải hiện cho khoá API, lỗi mang mã đã biết + host:port
    ids.a2 = x<{ id: number }>(
      await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "lastError")
        VALUES (${ids.m}, ${code + "-MC"}, ${code + "-MC"}, 'mitsubishi-mc', ${"10.9.8.7:5020"}, 500, false, 'connected', ${SENTINEL_MC_LOI}) RETURNING id`,
    ).id;
    // khoá API THẬT: scope assets:read, phạm vi = nhà máy của fixture
    ids.k = x<{ id: number }>(
      await sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode", "factoryCode")
        VALUES (${DAU + "-khoa"}, ${hashApiKey(KHOA_THO)}, ${sql.json(["assets:read"])}, 'factory', ${code}) RETURNING id`,
    ).id;
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (sql) {
      const d = async (q: Promise<unknown>) => {
        try {
          await q;
        } catch {
          /* dọn best-effort */
        }
      };
      await d(sql`DELETE FROM api_keys WHERE name LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM device_adapters WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM machines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM stations WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM production_lines WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM workshops WHERE code LIKE ${DAU + "%"}`);
      await d(sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`);
      await sql.end({ timeout: 5 });
    }
  }, 60_000);

  it("fixture: sentinel NẰM trong CSDL (đối chứng — phép đo thấy được chuỗi nếu nó rò)", async () => {
    const rows = await sql`SELECT endpoint, "lastError", "connectionOptions"::text AS co FROM device_adapters WHERE "machineId" = ${ids.m} ORDER BY id`;
    expect(JSON.stringify(rows)).toContain("SENTINEL");
    expect(JSON.stringify(rows)).toContain("10.9.8.7");
    expect(JSON.stringify(rows)).toContain(":5020");
  });

  it("đối chứng cổng: không khoá ⇒ 401 (đi qua requireScope THẬT)", async () => {
    expect((await goi(`/api/v1/assets/${ids.m}/health`, null)).status).toBe(401);
  });

  it("★★★ khoá API assets:read: thân phản hồi KHÔNG chứa SENTINEL / 10.9.8.7 / :5020; endpoint + connectionOptions null; lastError = MÃ; maLoi + tamKhoa còn", async () => {
    const r = await goi(`/api/v1/assets/${ids.m}/health`);
    expect(r.status, r.text).toBe(200);
    expect(r.text).not.toContain("SENTINEL");
    expect(r.text).not.toContain("10.9.8.7");
    expect(r.text).not.toContain(":5020");
    const ads = r.body.data.adapters as Array<Record<string, unknown>>;
    expect(ads).toHaveLength(2);
    const mb = ads.find((a) => a.id === ids.a1)!;
    const mc = ads.find((a) => a.id === ids.a2)!;
    expect(mb).toMatchObject({ code: `${DAU}-MB`, protocol: "modbus", status: "error", endpoint: null, connectionOptions: null, lastError: "ADAPTER_OFFLINE", maLoi: "ADAPTER_OFFLINE", tamKhoa: null });
    expect(mb.lastErrorAt).not.toBeNull(); // trường an toàn giữ nguyên
    expect(mc).toMatchObject({
      code: `${DAU}-MC`,
      endpoint: null,
      connectionOptions: null,
      lastError: "OT_MC_TAM_KHOA",
      maLoi: "OT_MC_TAM_KHOA",
      tamKhoa: { ma: "OT_MC_TAM_KHOA", lyDo: "errors.reason.otMcTamKhoa" },
    });
    // các trường khác của báo cáo sức khoẻ không đổi hình
    expect(r.body.data).toMatchObject({ machine_id: ids.m, presence: null });
  });
});

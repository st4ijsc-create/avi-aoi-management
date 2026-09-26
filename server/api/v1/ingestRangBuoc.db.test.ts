/**
 * doc 81 Đợt 1B Task 8 — NGHIỆM THU THẬT trên DB `_test` cho `/api/v1/ingest/*`.
 *
 * ĐO (BE3 §L4, instance :3017 trên `_test`):
 *   • khoá `mk_` của ESP32 ghi được telemetry cho `SCRW-SIM-01` (HTTP 200, dòng rơi vào máy khác);
 *   • `/api/v1/ingest/telemetry` trả 429 sau 300 req/phút (limiter trình duyệt);
 *   • `api/v1/auth.ts` nhận khoá plaintext bất kể `MACHINE_SHARED_KEY_ALLOWED`;
 *   • process-result gộp mọi lỗi (kể cả DB sập, 429) thành 400.
 *
 * Dựng ĐÚNG như production: body parser → limiter OT trên `OT_INGEST_PATHS` → limiter máy trên
 * `/api/` → limiter trình duyệt trên `/api/` (thứ tự của `_core/index.ts`, được canh bằng một khẳng
 * định trên mã nguồn ở cuối tệp) → `createV1Router()` THẬT. Khoá `mk_` cấp bằng `issueMachineKey`
 * THẬT (băm sha256 vào `api_keys`), xác thực bằng `resolvePrincipal` THẬT, ghi qua bus/tRPC THẬT.
 * Oracle độc lập với mã sản phẩm: đếm dòng bằng `SELECT` thô qua một kết nối `postgres` riêng.
 *
 * Dấu chân: mọi dòng thử mang tiền tố RUN và được xoá ở afterAll (`ot_telemetry`, `process_results`,
 * `process_idempotency_keys`, `api_keys`, machines/stations/lines/workshops/factories). Không ghi
 * `product_inspections` (WORM) — ca inspection chỉ đo đường BỊ TỪ CHỐI (không ghi gì).
 * Dấu chân CÒN LẠI từ lượt RED đầu tiên trên mã HEAD (2026-09-27): 1 hàng `product_inspections`
 * id 137300 (serial T8BMUIXU4776816-INS-X, machineId 17141) + chuỗi FK machines 17141–17143 /
 * factory 12836 — WORM, avi_app không xoá được. Payload inspection nay cố ý sai hợp đồng để không
 * lặp lại (xem ca inspection).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// ── công tắc lỗi DB cho process-result (chỉ bật trong đúng một ca) ─────────────────────────────
const h = vi.hoisted(() => ({ dbSap: false }));
vi.mock("../../services/processResultService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/processResultService")>();
  return {
    ...actual,
    recordProcessResult: async (...args: Parameters<typeof actual.recordProcessResult>) => {
      if (h.dbSap) {
        const { DbUnavailableError } = await import("../../_core/dbErrors");
        throw new DbUnavailableError();
      }
      return actual.recordProcessResult(...args);
    },
  };
});

process.env.PROCESS_RESULT_INGEST_ENABLED = "true"; // đường pilot doc 56 (máy vít) — bật như :3000 pilot
process.env.PROCESS_STORE_FORWARD_ENABLED = "false"; // đo mã HTTP trần, không để WAL nuốt lỗi tạm thời
delete process.env.MACHINE_SHARED_KEY_ALLOWED; // mặc định trong mã = "deny" (mig 0334)
delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;

const DB_URL = process.env.DATABASE_URL;
const RUN = `T8B${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const CODE_A = `${RUN}-ESP32`; // "ESP32-ENV-01"
const CODE_B = `${RUN}-SCRW`; // "SCRW-SIM-01"
const CODE_C = `${RUN}-LEG`; // máy chỉ có khoá plaintext cũ
const LEGACY_KEY = `legacy-${RUN}`;
const METRIC = `t8.${RUN}`;

let sql: ReturnType<typeof postgres>;
let server: Server;
let base = "";
const ids = { factory: 0, workshop: 0, line: 0, station: 0, a: 0, b: 0, c: 0, gw: 0 };
/** Máy dựng thêm trong từng ca (đổi mã / tombstone) — dọn ở afterAll. */
const idsThem: number[] = [];
const CODE_GW = `${RUN}-GW`; // máy IOT_GATEWAY — lỗ đã biết của /api/ot/ingest (R17)
let keyA = "";
let keyB = "";
let keyGw = "";

async function post(p: string, key: string | null, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${base}${p}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function demTelemetry(machineId: number | null, metric = METRIC): Promise<number> {
  const r =
    machineId == null
      ? await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ot_telemetry WHERE metric = ${metric} AND "machineId" IS NULL`
      : await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ot_telemetry WHERE metric = ${metric} AND "machineId" = ${machineId}`;
  return Number(r[0].n);
}
async function demTelemetryTatCa(metric = METRIC): Promise<number> {
  const r = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM ot_telemetry WHERE metric = ${metric}`;
  return Number(r[0].n);
}
async function demProcess(serial: string): Promise<Array<{ machineId: number }>> {
  return sql<{ machineId: number }[]>`SELECT "machineId" FROM process_results WHERE "serialNumber" = ${serial}`;
}

function processBody(serial: string, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    serialNumber: serial,
    stepType: "screw_tighten",
    result: "pass",
    ts: "2026-09-27T08:00:00+07:00",
    metrics: [{ name: "torque", value: 12.01, unit: "Nm" }],
    ...extra,
  };
}

describe.skipIf(!DB_URL)("doc 81 Đợt 1B Task 8 — /api/v1/ingest: khoá ↔ máy, tầng giới hạn, mã HTTP (DB _test thật)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'T8 factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'T8 ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'T8 line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'T8 station') RETURNING id`);
    ids.a = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${CODE_A}, 'T8 ESP32', 'IOT_SENSOR', true) RETURNING id`);
    ids.b = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${CODE_B}, 'T8 screwdriver', 'SCREWDRIVE', true) RETURNING id`);
    ids.c = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${CODE_C}, 'T8 legacy', 'AOI', true, ${LEGACY_KEY}) RETURNING id`);

    // Khoá mk_ THẬT, cấp bằng đúng hàm mà wizard/pilot dùng.
    const { issueMachineKey } = await import("../../services/machineAuthService");
    keyA = (await issueMachineKey({ machineId: ids.a, name: `${RUN}-A` })).plaintextKey;
    keyB = (await issueMachineKey({ machineId: ids.b, name: `${RUN}-B` })).plaintextKey;
    ids.gw = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${ids.station}, ${CODE_GW}, 'T8 gateway', 'IOT_GATEWAY', true) RETURNING id`);
    keyGw = (await issueMachineKey({ machineId: ids.gw, name: `${RUN}-GW` })).plaintextKey;

    // App dựng theo ĐÚNG thứ tự middleware của _core/index.ts.
    const rl = await import("../../_core/rateLimitConfig");
    const { createV1Router } = await import("./router");
    // Nạp TRƯỚC cây appRouter (inspection/process-result import động nó ở lượt gọi đầu): một mình
    // mất ~6 s, dưới tải 100 tệp song song vượt hạn 30 s của một ca ⇒ đỏ GIẢ (fix round 2 đo được).
    await import("../../routers");
    const app = express();
    app.use(express.json({ limit: "25mb" }));
    app.use([...rl.OT_INGEST_PATHS], rl.credentialConflictGuard, rl.createOtIngestLimiter());
    app.use("/api/", rl.credentialConflictGuard, rl.createMachineIngestLimiter());
    const apiLimiter = rl.createApiLimiter();
    app.use("/api/", apiLimiter);
    app.use("/trpc/", apiLimiter);
    // POST /api/ot/ingest — ĐÚNG handler + deps mà _core/index.ts gắn (R17).
    const { createOtIngestHandler } = await import("../../_core/otIngestRoute");
    const { authenticateMachine } = await import("../../services/machineAuthService");
    const { ingestTelemetryDetailed } = await import("../../services/telemetryBus");
    app.post("/api/ot/ingest", createOtIngestHandler({ authenticateMachine, ingestTelemetryDetailed }));
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 180_000);

  afterEach(async () => {
    h.dbSap = false;
    delete process.env.MACHINE_SHARED_KEY_ALLOWED;
    delete process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN;
    const { _resetMachineAuthState } = await import("../../services/machineAuthService");
    _resetMachineAuthState();
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!sql) return;
    const machineIds = [ids.a, ids.b, ids.c, ids.gw, ...idsThem].filter((x) => x > 0);
    await sql`DELETE FROM ot_telemetry WHERE metric LIKE ${"t8." + RUN + "%"}`;
    await sql`DELETE FROM process_results WHERE "serialNumber" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM process_idempotency_keys WHERE "machineId" = ANY(${machineIds})`;
    await sql`DELETE FROM api_keys WHERE "machineId" = ANY(${machineIds})`;
    await sql`DELETE FROM machines WHERE id = ANY(${machineIds})`;
    await sql`DELETE FROM stations WHERE id = ${ids.station}`;
    await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    await sql`DELETE FROM workshops WHERE id = ${ids.workshop}`;
    await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql.end({ timeout: 5 });
  });

  // ── 1. Ràng buộc khoá ↔ máy — telemetry ──────────────────────────────────────────────────────
  describe("telemetry", () => {
    it("★ khoá máy A ghi cho máy B qua deviceId (đúng phép đo BE3) ⇒ 403, DB KHÔNG có dòng nào", async () => {
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [{ deviceId: CODE_B, metric: METRIC, value: 1.5, protocol: "other" }],
      });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("machine_mismatch");
      expect(r.body.error.details.violations[0]).toEqual({ index: 0, field: "deviceId", value: CODE_B });
      expect(await demTelemetry(ids.b)).toBe(0);
      expect(await demTelemetryTatCa()).toBe(0);
    });

    it("★ khoá máy A ghi cho máy B qua machineId ⇒ 403, không dòng nào", async () => {
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [{ machineId: ids.b, metric: METRIC, value: 2 }],
      });
      expect(r.status).toBe(403);
      expect(await demTelemetryTatCa()).toBe(0);
    });

    it("lô trộn (1 mẫu của A + 1 mẫu mạo B) ⇒ 403 CẢ LÔ — không ghi nửa vời", async () => {
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [
          { deviceId: CODE_A, metric: METRIC, value: 3 },
          { deviceId: CODE_B, metric: METRIC, value: 4 },
        ],
      });
      expect(r.status).toBe(403);
      expect(r.body.error.details.violations).toEqual([{ index: 1, field: "deviceId", value: CODE_B }]);
      expect(await demTelemetryTatCa()).toBe(0);
    });

    it("mẫu mang machineId của A nhưng deviceId = mã máy B ⇒ 403 (chặn chiếm khoá (deviceId,metric,ts) của B)", async () => {
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [{ machineId: ids.a, deviceId: CODE_B, metric: METRIC, value: 5 }],
      });
      expect(r.status).toBe(403);
      expect(await demTelemetryTatCa()).toBe(0);
    });

    it("★ ĐƯỜNG HỢP LỆ (máy pilot ESP32): khoá A, deviceId = mã A ⇒ 202 {accepted, received}, dòng về máy A", async () => {
      const m = `${METRIC}.ok`;
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [
          { deviceId: CODE_A, metric: m, value: 31.4, unit: "C", ts: "2026-09-27T01:00:00Z" },
          { deviceId: CODE_A, metric: m, value: 31.5, unit: "C", ts: "2026-09-27T01:00:01Z" },
        ],
      });
      expect(r.status).toBe(202);
      expect(r.body).toEqual({ ok: true, data: { accepted: 2, received: 2 } });
      expect(await demTelemetry(ids.a, m)).toBe(2);
    });

    it("khoá A, không deviceId/machineId (SDK không biết mã) ⇒ 202, dòng GHIM về máy A (R16 — không còn NULL)", async () => {
      const m = `${METRIC}.bare`;
      const r = await post("/api/v1/ingest/telemetry", keyA, [{ metric: m, value: 1 }]);
      expect(r.status).toBe(202);
      expect(await demTelemetry(ids.a, m)).toBe(1);
      expect(await demTelemetry(null, m)).toBe(0);
    });

    it("★ R16 nghiêm: khoá A, deviceId KHÔNG phải mã máy nào (mã cảm biến) ⇒ 403 cả lô, không dòng nào", async () => {
      const m = `${METRIC}.sensor`;
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [{ deviceId: `${RUN}-sensor-not-a-machine`, metric: m, value: 7 }],
      });
      expect(r.status).toBe(403);
      expect(r.body.error.details.violations).toEqual([{ index: 0, field: "deviceId", value: `${RUN}-sensor-not-a-machine` }]);
      expect(await demTelemetryTatCa(m)).toBe(0);
    });

    it("★ R16 (a) ĐỔI MÃ: cache bus còn trỏ mã cũ về máy cũ R ⇒ dòng của khoá N (mã mới = mã cũ của R) VẪN về N", async () => {
      const code = `${RUN}-REN`;
      const m = `${METRIC}.rename`;
      const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
      const idR = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${code}, 'T8 rename old owner', 'IOT_SENSOR', true) RETURNING id`);
      idsThem.push(idR);
      // Gieo cache bus THẬT: một mẫu deviceId=code, không machineId ⇒ bus quy code→R và cache VĨNH VIỄN.
      const bus = await import("../../services/telemetryBus");
      bus.clearMachineIdCache();
      const seed = await bus.ingestTelemetryDetailed([
        { deviceId: code, metric: `${m}.seed`, value: 1, protocol: "other", quality: "good" } as never,
      ]);
      expect(seed.accepted).toBe(1);
      expect(await demTelemetry(idR, `${m}.seed`)).toBe(1); // cache đã trỏ code → R
      // Đổi mã R, rồi một máy MỚI N nhận đúng mã cũ đó (uq_machines_code_active cho phép).
      await sql`UPDATE machines SET code = ${code + "-old"} WHERE id = ${idR}`;
      const idN = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${code}, 'T8 rename new owner', 'IOT_SENSOR', true) RETURNING id`);
      idsThem.push(idN);
      const { issueMachineKey } = await import("../../services/machineAuthService");
      const keyN = (await issueMachineKey({ machineId: idN, name: `${RUN}-N` })).plaintextKey;

      const r = await post("/api/v1/ingest/telemetry", keyN, { samples: [{ deviceId: code, metric: m, value: 2 }] });
      expect(r.status).toBe(202);
      expect(await demTelemetry(idN, m)).toBe(1);
      expect(await demTelemetry(idR, m)).toBe(0);
    });

    it("★ R16 (b) TOMBSTONE: máy đã ngừng mang CÙNG mã (tạo trước) ⇒ dòng của khoá D vẫn về D, không về tombstone", async () => {
      const code = `${RUN}-TMB`;
      const m = `${METRIC}.tomb`;
      const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
      const idT = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${code}, 'T8 tombstone', 'IOT_SENSOR', false) RETURNING id`);
      idsThem.push(idT);
      const idD = await one(sql`
        INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
        VALUES (${ids.station}, ${code}, 'T8 live', 'IOT_SENSOR', true) RETURNING id`);
      idsThem.push(idD);
      const { issueMachineKey } = await import("../../services/machineAuthService");
      const keyD = (await issueMachineKey({ machineId: idD, name: `${RUN}-D` })).plaintextKey;
      (await import("../../services/telemetryBus")).clearMachineIdCache();

      const r = await post("/api/v1/ingest/telemetry", keyD, { samples: [{ deviceId: code, metric: m, value: 3 }] });
      expect(r.status).toBe(202);
      expect(await demTelemetry(idD, m)).toBe(1);
      expect(await demTelemetry(idT, m)).toBe(0);
    });

    it("khoá B ghi cho CHÍNH B ⇒ 202 (ràng buộc không chặn oan máy kia)", async () => {
      const m = `${METRIC}.b`;
      const r = await post("/api/v1/ingest/telemetry", keyB, { samples: [{ deviceId: CODE_B, metric: m, value: 0.81 }] });
      expect(r.status).toBe(202);
      expect(await demTelemetry(ids.b, m)).toBe(1);
    });

    it("mã trung thực: 1 mẫu ts hỏng + 1 mẫu tốt ⇒ 207 (không bao giờ 2xx 'ok' khi accepted < received)", async () => {
      const m = `${METRIC}.partial`;
      const r = await post("/api/v1/ingest/telemetry", keyA, {
        samples: [
          { deviceId: CODE_A, metric: m, value: 1, ts: "rác" },
          { deviceId: CODE_A, metric: m, value: 2, ts: "2026-09-27T02:00:00Z" },
        ],
      });
      expect(r.status).toBe(207);
      expect(r.body.ok).toBe(false);
      expect(r.body.error.details).toMatchObject({ accepted: 1, received: 2, rejected: [{ index: 0, reason: "invalid_ts" }] });
      expect(await demTelemetry(ids.a, m)).toBe(1);
    });

    it("mã trung thực: cả lô ts hỏng ⇒ 400 all_rejected", async () => {
      const r = await post("/api/v1/ingest/telemetry", keyA, { samples: [{ deviceId: CODE_A, metric: `${METRIC}.bad`, value: 1, ts: "rác" }] });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("all_rejected");
    });
  });

  // ── 1b. R17 — cùng ràng buộc ở POST /api/ot/ingest ────────────────────────────────────────
  describe("/api/ot/ingest (R17)", () => {
    const postOt = async (key: string, body: unknown) => {
      const res = await fetch(`${base}/api/ot/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    it("★ khoá mk_ của A gửi deviceId = mã B ⇒ 403, KHÔNG dòng nào", async () => {
      const m = `${METRIC}.ot.x`;
      const r = await postOt(keyA, { samples: [{ deviceId: CODE_B, metric: m, value: 1 }] });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("machine_mismatch");
      expect(await demTelemetryTatCa(m)).toBe(0);
    });

    it("khoá A gửi machineId = B ⇒ 403, không dòng nào", async () => {
      const m = `${METRIC}.ot.mid`;
      const r = await postOt(keyA, { samples: [{ machineId: ids.b, metric: m, value: 1 }] });
      expect(r.status).toBe(403);
      expect(await demTelemetryTatCa(m)).toBe(0);
    });

    it("đường hợp lệ: khoá A, deviceId = mã A ⇒ 200 như cũ, dòng về A", async () => {
      const m = `${METRIC}.ot.ok`;
      const r = await postOt(keyA, { samples: [{ deviceId: CODE_A, metric: m, value: 1 }] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, accepted: 1, received: 1, machine: CODE_A });
      expect(await demTelemetry(ids.a, m)).toBe(1);
    });

    it("LỖ ĐÃ BIẾT (ghi rõ trong mã): khoá của máy IOT_GATEWAY KHÔNG bị ràng buộc — chuyển tiếp deviceId khác vẫn 200", async () => {
      const m = `${METRIC}.ot.gw`;
      const r = await postOt(keyGw, { samples: [{ deviceId: CODE_A, metric: m, value: 1 }] });
      expect(r.status).toBe(200);
      expect(await demTelemetry(ids.a, m)).toBe(1);
    });
  });

  // ── 2. Ràng buộc — process-result & inspection ───────────────────────────────────────────────
  describe("process-result / inspection", () => {
    it("★ khoá A khai machineCode = B ⇒ 403, KHÔNG dòng process_results nào (kể cả dưới máy A)", async () => {
      const serial = `${RUN}-PR-X`;
      const r = await post("/api/v1/ingest/process-result", keyA, processBody(serial, { machineCode: CODE_B }));
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("machine_mismatch");
      expect(await demProcess(serial)).toEqual([]);
    });

    it("★ ĐƯỜNG PILOT doc 56 (máy vít): khoá B, machineCode = B ⇒ 201, dòng về máy B", async () => {
      const serial = `${RUN}-PR-OK`;
      const r = await post("/api/v1/ingest/process-result", keyB, processBody(serial, { machineCode: CODE_B, idempotencyKey: `${RUN}-idem-1` }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.ok).toBe(true);
      expect(await demProcess(serial)).toEqual([{ machineId: ids.b }]);
    });

    it("khoá B không khai machineCode ⇒ 201 (máy theo khoá)", async () => {
      const serial = `${RUN}-PR-NOCODE`;
      const r = await post("/api/v1/ingest/process-result", keyB, processBody(serial));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await demProcess(serial)).toEqual([{ machineId: ids.b }]);
    });

    it("★ DB sập giữa chừng ở process-result ⇒ 503 (gửi lại được), KHÔNG phải 400; không dòng nào", async () => {
      const serial = `${RUN}-PR-DB`;
      h.dbSap = true;
      const r = await post("/api/v1/ingest/process-result", keyB, processBody(serial));
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe("ingest_unavailable");
      expect(await demProcess(serial)).toEqual([]);
    });

    it("★ quá tần suất theo khoá ⇒ 429 + Retry-After (không phải 400)", async () => {
      process.env.MACHINE_INGEST_RATE_LIMIT_PER_MIN = "1";
      const r1 = await post("/api/v1/ingest/process-result", keyB, processBody(`${RUN}-PR-RL1`));
      expect(r1.status).toBe(201);
      const r2 = await post("/api/v1/ingest/process-result", keyB, processBody(`${RUN}-PR-RL2`));
      expect(r2.status).toBe(429);
      expect(r2.body.error.code).toBe("rate_limited");
      expect(Number(r2.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await demProcess(`${RUN}-PR-RL2`)).toEqual([]);
    });

    it("lỗi DỮ LIỆU (result ngoài từ vựng) ⇒ 400 ingest_failed", async () => {
      const r = await post("/api/v1/ingest/process-result", keyB, processBody(`${RUN}-PR-BAD`, { result: "maybe" }));
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("ingest_failed");
    });

    it("★ inspection: khoá A khai machineCode = B ⇒ 403 (không đụng submitInspection)", async () => {
      const serial = `${RUN}-INS-X`;
      // ⚠ `overallResult` CỐ Ý sai hợp đồng: `product_inspections` là WORM (mig 0279) — lượt RED đầu
      // (mã HEAD) đã GHI một hàng bo thật cho máy A với lời khai "máy B" (id 137300, không xoá được).
      // Payload hỏng làm đường KHÔNG ràng buộc dừng ở 400 (không ghi gì) thay vì 201, nên RED/đột
      // biến vẫn đỏ (400 ≠ 403) mà không để lại hàng WORM nào nữa.
      const r = await post("/api/v1/ingest/inspection", keyA, {
        machineCode: CODE_B,
        serialNumber: serial,
        productModel: `${RUN}-PM`,
        overallResult: "NOT-A-RESULT",
        measurements: [],
      });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("machine_mismatch");
      const rows = await sql`SELECT 1 FROM product_inspections WHERE "serialNumber" = ${serial}`;
      expect(rows.length).toBe(0);
    });
  });

  // ── 3. Khoá dùng chung plaintext theo MACHINE_SHARED_KEY_ALLOWED ─────────────────────────────
  describe("khoá plaintext machines.apiKey", () => {
    const body = () => ({ samples: [{ deviceId: CODE_C, metric: `${METRIC}.legacy`, value: 1 }] });

    it("★ cờ KHÔNG đặt (mặc định deny) ⇒ 401, không ghi", async () => {
      const r = await post("/api/v1/ingest/telemetry", LEGACY_KEY, body());
      expect(r.status).toBe(401);
      expect(await demTelemetryTatCa(`${METRIC}.legacy`)).toBe(0);
    });

    it("cờ = false ⇒ 401; cờ = read-only ⇒ 401 cho ingest:write (ghi bị cấm)", async () => {
      process.env.MACHINE_SHARED_KEY_ALLOWED = "false";
      expect((await post("/api/v1/ingest/telemetry", LEGACY_KEY, body())).status).toBe(401);
      process.env.MACHINE_SHARED_KEY_ALLOWED = "read-only";
      expect((await post("/api/v1/ingest/telemetry", LEGACY_KEY, body())).status).toBe(401);
      expect(await demTelemetryTatCa(`${METRIC}.legacy`)).toBe(0);
    });

    it("cờ = true (quyết định gõ ra) ⇒ 202 như cũ, và VẪN bị ràng buộc về máy của nó", async () => {
      process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
      const ok = await post("/api/v1/ingest/telemetry", LEGACY_KEY, body());
      expect(ok.status).toBe(202);
      expect(await demTelemetry(ids.c, `${METRIC}.legacy`)).toBe(1);
      const cheo = await post("/api/v1/ingest/telemetry", LEGACY_KEY, { samples: [{ deviceId: CODE_B, metric: `${METRIC}.legacy`, value: 2 }] });
      expect(cheo.status).toBe(403);
      expect(await demTelemetry(ids.b, `${METRIC}.legacy`)).toBe(0);
    });
  });

  // ── 4. Tầng giới hạn tần suất ────────────────────────────────────────────────────────────────
  describe("tầng rate-limit", () => {
    it("★ 400 request/phút từ MỘT khoá hợp lệ ⇒ KHÔNG request nào nhận 429 của limiter trình duyệt (300/phút)", async () => {
      const m = `${METRIC}.rl`;
      const statuses: number[] = [];
      const N = 400;
      const LUONG = 20;
      for (let i = 0; i < N; i += LUONG) {
        const batch = await Promise.all(
          Array.from({ length: LUONG }, (_, j) =>
            post("/api/v1/ingest/telemetry", keyA, {
              samples: [{ deviceId: CODE_A, metric: m, value: i + j, ts: new Date(Date.UTC(2026, 8, 27, 3, 0, 0, i + j)).toISOString() }],
            }).then((r) => r.status),
          ),
        );
        statuses.push(...batch);
      }
      const dem = statuses.reduce<Record<number, number>>((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {});
      expect(dem, JSON.stringify(dem)).toEqual({ 202: N });
      expect(await demTelemetry(ids.a, m)).toBe(N);
    }, 120_000);

    it("_core/index.ts gắn limiter OT trên OT_INGEST_PATHS TRƯỚC limiter trình duyệt, và /api/v1 SAU cả hai", () => {
      const src = readFileSync(path.resolve(__dirname, "../../_core/index.ts"), "utf8");
      const iOt = src.indexOf("app.use([...OT_INGEST_PATHS], credentialConflictGuard, otIngestLimiter)");
      const iApi = src.indexOf("app.use('/api/', apiLimiter)");
      const iV1 = src.indexOf('app.use("/api/v1", createV1Router())');
      expect(iOt).toBeGreaterThan(0);
      expect(iApi).toBeGreaterThan(iOt);
      expect(iV1).toBeGreaterThan(iApi);
    });
  });
});

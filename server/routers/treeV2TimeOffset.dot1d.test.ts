/**
 * server/routers/treeV2TimeOffset.dot1d.test.ts
 *
 * ★★★ doc 81 Đợt 1D Task 4 — ruling R-1D-j: cửa TRỰC TIẾP cây v2.0 (`submitInspection` →
 * `submitInspectionTreeV2`). `completedAt`/`startedAt` (cấp bo VÀ lá position/capture/component)
 * theo cờ RIÊNG `INGEST_REQUIRE_PACKAGE_TIME_OFFSET` — MẶC ĐỊNH TẮT (opt-in `true/1/yes/on`).
 *   · cờ BẬT  ⇒ chuỗi TRẦN bị TỪ CHỐI cả bo: BAD_REQUEST · INVALID_VALUE {field: completedAt|startedAt,
 *               reason: "timeOffsetRequired"} · câu chữ chứa `time_offset_required` · 0 bo.
 *   · cờ TẮT (mặc định / `false` tường minh) ⇒ hành vi cũ: trần đọc là UTC (`docGioMay`), kể cả
 *               hình dạng MẪU MÁY THẬT (`mauHopLe` — trần ở mọi cấp).
 *   · `inspectionTime` vẫn chỉ theo `INGEST_REQUIRE_TIME_OFFSET` — hai cờ độc lập.
 * Oracle ĐỘC LẬP: instant kỳ vọng viết tay theo lịch (09:00 +07:00 = 02:00Z), đọc lại bằng `to_char`.
 *
 * ⚠ WORM — `product_inspections` bị REVOKE DELETE (migration 0279): ca nhận để lại hàng bo; chỉ
 * dọn cây (không WORM) + máy khi được phép. Máy KHÔNG xoá được (FK RESTRICT từ hàng bo) ⇒ để lại.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import postgres from "postgres";
import { machineApiRouter } from "./machineApiRouters";
import type { TrpcContext } from "../_core/context";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";
import { readAppErrorMeta } from "../_core/appError";
import { requirePackageTimeOffset, requireTimeOffset } from "../utils/timeOffsetPolicy";
import * as db from "../db";

const DB_URL = process.env.DATABASE_URL;
const RUN = `TV2T${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `plain-${RUN}`;
const ISO_FMT = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

let sql: ReturnType<typeof postgres>;
let machineId = 0;
const inspectionIds: number[] = [];

function caller() {
  const ctx = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
  return machineApiRouter.createCaller(ctx);
}

type KetQuaSubmit = { success: true; inspectionId: number; duplicate?: boolean };

/** Bo cây v2.0, định danh duy nhất theo `tag`, MỌI mốc mang "Z" (ca nào cần trần tự ghi đè). */
function payload(tag: string): Record<string, any> {
  const p = mauHopLe();
  delete p.productModel;
  p.apiKey = API_KEY;
  p.productId = `${RUN}-PROD-${tag}`;
  p.serialNumber = `${RUN}-SN-${tag}`;
  p.overallResult = "OK";
  p.ntf = false;
  p.startedAt = "2026-09-03T01:59:00.000Z";
  p.completedAt = "2026-09-03T02:00:00.000Z";
  const n = { total: 1, pass: 1, ng: 0, ntf: 0 };
  p.summary = { surfaces: n, positions: n, captures: n, components: n };
  p.surfaces = [{
    name: "TOP", result: "OK", ntf: false,
    positions: [{
      positionId: "P01", positionNumber: 1, result: "OK", ntf: false,
      captures: [{
        captureId: `${RUN}-C-${tag}`, captureName: "Default", index: 0, result: "OK", ntf: false,
        startedAt: "2026-09-03T01:59:00.000Z",
        components: [{
          componentId: `${RUN}-COMP-${tag}`, componentName: "R12",
          result: "OK", ntf: false, value: "10", lowerLimit: "9", upperLimit: "11",
        }],
      }],
    }],
  }];
  return p;
}

/** Hình dạng MẪU MÁY THẬT: `mauHopLe()` nguyên các mốc TRẦN (bo), thêm mốc TRẦN ở cả ba cấp lá. */
function payloadMauThat(tag: string): Record<string, any> {
  const p = mauHopLe();
  expect(p.completedAt, "mauHopLe phải còn là chuỗi TRẦN (mẫu máy thật)").toBe("2026-08-18T09:30:14.400");
  delete p.productModel;
  p.apiKey = API_KEY;
  p.productId = `${RUN}-PROD-${tag}`;
  p.serialNumber = `${RUN}-SN-${tag}`;
  const pos = p.surfaces[0].positions[0];
  pos.startedAt = "2026-08-18T09:30:00.000";
  pos.completedAt = "2026-08-18T09:30:14.000";
  const cap = pos.captures[0];
  cap.captureId = `${RUN}-C-${tag}`;
  cap.startedAt = "2026-08-18T09:30:00.300";
  cap.completedAt = "2026-08-18T09:30:00.600";
  cap.components[0].componentId = `${RUN}-COMP-${tag}`;
  cap.components[0].startedAt = "2026-08-18T09:30:00.300";
  cap.components[0].completedAt = "2026-08-18T09:30:00.600";
  return p;
}

async function demBoTheoSerial(serial: string): Promise<number> {
  const [r] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM product_inspections WHERE "serialNumber" = ${serial}`;
  return Number(r.n);
}

async function loiKhiGui(p: Record<string, unknown>): Promise<unknown> {
  return caller().submitInspection(p).then(
    () => null,
    (e: unknown) => e,
  );
}

async function nhan(p: Record<string, unknown>): Promise<number> {
  const r = (await caller().submitInspection(p)) as KetQuaSubmit;
  expect(r.success).toBe(true);
  inspectionIds.push(r.inspectionId);
  return r.inspectionId;
}

async function headerIso(id: number): Promise<string> {
  const [h] = await sql<{ iso: string }[]>`
    SELECT to_char("inspectionTime", ${ISO_FMT}) AS iso FROM product_inspections WHERE id = ${id}`;
  return h.iso;
}

const ENV_KEYS = ["INGEST_REQUIRE_PACKAGE_TIME_OFFSET", "INGEST_REQUIRE_TIME_OFFSET", "MACHINE_SHARED_KEY_ALLOWED"] as const;
const envTruoc: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) envTruoc[k] = process.env[k];
  delete process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET; // MẶC ĐỊNH trừ khi ca tự đặt
  delete process.env.INGEST_REQUIRE_TIME_OFFSET;
  process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envTruoc[k] === undefined) delete process.env[k];
    else process.env[k] = envTruoc[k];
  }
});

describe("requirePackageTimeOffset — opt-in, MẶC ĐỊNH TẮT (R-1D-j)", () => {
  it("vắng/rỗng/rác/false/0/off/no ⇒ TẮT; chỉ true/1/yes/on (mọi hoa-thường, khoảng trắng) ⇒ BẬT", () => {
    for (const v of [undefined, "", "false", "0", "off", "no", "bat", "enabled"]) {
      expect(requirePackageTimeOffset({ INGEST_REQUIRE_PACKAGE_TIME_OFFSET: v } as NodeJS.ProcessEnv), String(v)).toBe(false);
    }
    for (const v of ["true", "1", "yes", "on", " TRUE ", "On"]) {
      expect(requirePackageTimeOffset({ INGEST_REQUIRE_PACKAGE_TIME_OFFSET: v } as NodeJS.ProcessEnv), v).toBe(true);
    }
  });

  it("hai cờ ĐỘC LẬP: INGEST_REQUIRE_TIME_OFFSET không kéo cờ gói, và ngược lại", () => {
    expect(requirePackageTimeOffset({ INGEST_REQUIRE_TIME_OFFSET: "true" } as NodeJS.ProcessEnv)).toBe(false);
    expect(requireTimeOffset({ INGEST_REQUIRE_PACKAGE_TIME_OFFSET: "false" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe.skipIf(!DB_URL)("★★★ Đợt 1D Task 4 — cây v2.0 TRỰC TIẾP: completedAt/startedAt theo INGEST_REQUIRE_PACKAGE_TIME_OFFSET", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    machineId = await db.createMachine({
      stationId: 1,
      code: `M-${RUN}`,
      name: "Đợt 1D T4 — cây v2 completedAt/startedAt theo cờ gói",
      machineType: "AOI",
      apiKey: API_KEY,
      isActive: true,
    });
  });

  afterAll(async () => {
    if (!sql) return;
    for (const id of inspectionIds) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ${id}`;
    }
    // Máy chỉ xoá được khi không bo nào tham chiếu (WORM + FK RESTRICT).
    if (machineId && inspectionIds.length === 0) await db.deleteMachine(machineId);
    await sql.end({ timeout: 5 });
  });

  // ── cờ TẮT (MẶC ĐỊNH) — hành vi cũ byte-identical ─────────────────────────────────────
  it("MẶC ĐỊNH (env VẮNG): hình dạng MẪU MÁY THẬT — trần ở bo VÀ mọi cấp lá ⇒ NHẬN, header = trần đọc là UTC", async () => {
    const id = await nhan(payloadMauThat("OFF1"));
    expect(await headerIso(id)).toBe("2026-08-18T09:30:14.400Z");
  });

  it("INGEST_REQUIRE_PACKAGE_TIME_OFFSET=false TƯỜNG MINH: trần ⇒ NHẬN y hệt mặc định", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "false";
    const id = await nhan(payloadMauThat("OFF2"));
    expect(await headerIso(id)).toBe("2026-08-18T09:30:14.400Z");
  });

  it("MẶC ĐỊNH + INGEST_REQUIRE_TIME_OFFSET mặc định BẬT: cờ của inspectionTime KHÔNG chặn completedAt trần", async () => {
    process.env.INGEST_REQUIRE_TIME_OFFSET = "true";
    const id = await nhan(payloadMauThat("OFF3"));
    expect(await headerIso(id)).toBe("2026-08-18T09:30:14.400Z");
  });

  // ── cờ BẬT — từ chối có mã ────────────────────────────────────────────────────────────
  it("cờ BẬT: completedAt cấp bo TRẦN ⇒ BAD_REQUEST INVALID_VALUE {field: completedAt}, 0 bo được ghi", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = payload("ON1");
    p.completedAt = "2026-09-03T02:00:00.000";
    const err = await loiKhiGui(p);
    expect(err, "chuỗi trần phải bị TỪ CHỐI khi cờ gói BẬT").toBeTruthy();
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "completedAt", reason: "timeOffsetRequired" },
    });
    expect(String((err as Error).message)).toContain("time_offset_required");
    expect(await demBoTheoSerial(p.serialNumber)).toBe(0);
  });

  it("cờ BẬT: startedAt cấp bo TRẦN (completedAt vắng) ⇒ từ chối, field startedAt", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = payload("ON2");
    delete p.completedAt;
    p.startedAt = "2026-09-03T01:59:00.000";
    const err = await loiKhiGui(p);
    expect(readAppErrorMeta(err)).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "startedAt", reason: "timeOffsetRequired" },
    });
    expect(await demBoTheoSerial(p.serialNumber)).toBe(0);
  });

  it("cờ BẬT: capture.startedAt cấp LÁ TRẦN (bo mang Z) ⇒ từ chối cả bo, field startedAt", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = payload("ON3");
    p.surfaces[0].positions[0].captures[0].startedAt = "2026-09-03T01:59:00.000";
    const err = await loiKhiGui(p);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(readAppErrorMeta(err)).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "startedAt", reason: "timeOffsetRequired" },
    });
    expect(String((err as Error).message)).toContain("time_offset_required");
    expect(await demBoTheoSerial(p.serialNumber)).toBe(0);
  });

  it("cờ BẬT: component.completedAt / position.completedAt cấp LÁ TRẦN ⇒ từ chối", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p1 = payload("ON4C");
    p1.surfaces[0].positions[0].captures[0].components[0].completedAt = "2026-09-03T01:59:30";
    expect(readAppErrorMeta(await loiKhiGui(p1))?.appParams).toEqual({ field: "completedAt", reason: "timeOffsetRequired" });
    const p2 = payload("ON4P");
    p2.surfaces[0].positions[0].completedAt = "2026-09-03 01:59:30";
    expect(readAppErrorMeta(await loiKhiGui(p2))?.appParams).toEqual({ field: "completedAt", reason: "timeOffsetRequired" });
    expect(await demBoTheoSerial(p1.serialNumber)).toBe(0);
    expect(await demBoTheoSerial(p2.serialNumber)).toBe(0);
  });

  it("cờ BẬT + INGEST_REQUIRE_TIME_OFFSET=false: cờ gói vẫn chặn (hai cờ độc lập)", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    process.env.INGEST_REQUIRE_TIME_OFFSET = "false";
    const p = payload("ON5");
    p.completedAt = "2026-09-03T02:00:00.000";
    expect(readAppErrorMeta(await loiKhiGui(p))?.appParams).toEqual({ field: "completedAt", reason: "timeOffsetRequired" });
    expect(await demBoTheoSerial(p.serialNumber)).toBe(0);
  });

  it("cờ BẬT: 'Z' / '+07:00' / '+0700' ở bo VÀ lá ⇒ NHẬN, header = ĐÚNG instant (09:00+07:00 = 02:00Z)", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = payload("ON6");
    p.completedAt = "2026-09-03T09:00:00.000+07:00";
    p.startedAt = "2026-09-03T08:59:00+0700";
    p.surfaces[0].positions[0].captures[0].startedAt = "2026-09-03T01:59:00.000Z";
    const id = await nhan(p);
    expect(await headerIso(id)).toBe("2026-09-03T02:00:00.000Z");
  });

  it("cờ BẬT: dạng BG-72 '… GMT+0700 (Indochina Time)' ⇒ NHẬN, header = ĐÚNG instant 02:00:00Z", async () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = payload("ON7");
    p.completedAt = "Thu Sep 03 2026 09:00:00 GMT+0700 (Indochina Time)";
    p.surfaces[0].positions[0].captures[0].startedAt = "Thu Sep 03 2026 08:59:00 GMT+0700 (Indochina Time)";
    const id = await nhan(p);
    expect(await headerIso(id)).toBe("2026-09-03T02:00:00.000Z");
  });
});

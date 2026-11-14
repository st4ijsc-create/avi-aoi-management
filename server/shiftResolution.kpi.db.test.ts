/**
 * Doc 32 Wave R1 — shift resolution + real shift_configs-driven getShiftStats /
 * getShiftReport (decision #3 = join production_sessions, NO ingest change).
 *
 * Covers:
 *  - pure TS classifiers (factory-local minutes, window match wrap-aware, fallback);
 *  - getShiftStats with 2-shift and 3-shift factory configs (deterministic via
 *    FACTORY-SPECIFIC shift_configs, which override any global seed);
 *  - factory-TZ correctness (23:30 UTC → 06:30 VN → the DAY shift, not NIGHT);
 *  - resolveShiftForInspections tiers: window (config), session-overrides-window,
 *    and hour-bucket fallback for a time in a gap between configured shifts;
 *  - getShiftReport rollup shape (window, machinesActive, yield, defectTypeCount).
 *
 * Runs against the isolated cloned test DB (vitest.setup.ts).
 *
 * ⚠ TỆP NÀY CHẠM `_test` (đuôi `.db.test.ts`): toàn bộ fixture (nhà máy / xưởng / dây chuyền / trạm / máy / model sản phẩm / shift_configs /
 *   bản ghi kiểm / production_sessions) nằm trong MỘT giao dịch drizzle mở suốt tệp và kết thúc bằng ROLLBACK (không DELETE, không TRUNCATE,
 *   không owner `aoi`). Phần thuần (classifier) nằm ở `shiftResolution.kpi.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray } from "drizzle-orm";
import * as db from "./db";
import { shiftConfigs, productionSessions, factories, machines, productModels, productInspections } from "../drizzle/schema";
import { resolveShiftForInspections } from "./db/shiftResolution";

const rangeStart = new Date("2026-03-01T00:00:00Z");
const rangeEnd = new Date("2026-03-20T00:00:00Z");

// VN = UTC+7 (no DST). 23:30Z→06:30, 02:00Z→09:00, 14:00Z→21:00, 16:00Z→23:00.
const at0630vn = new Date("2026-03-10T23:30:00Z");
const at0900vn = new Date("2026-03-10T02:00:00Z");
const at2100vn = new Date("2026-03-10T14:00:00Z");
const at1500vn = new Date("2026-03-10T08:00:00Z");
const at2300vn = new Date("2026-03-10T16:00:00Z");

// ═════════════════════════════════════════════════════════════════
// GIAO DỊCH HOÀN TÁC — mẫu server/db/statisticsScope.test.ts + aiAnalyticsMachineType.db.test.ts
// ═════════════════════════════════════════════════════════════════
// `getDb` (mock) trả về `tx` của MỘT giao dịch drizzle mở suốt tệp; hàm `db.create*` / `createProductInspection` tự mở `transaction(...)`:
// trên `tx` việc đó thành SAVEPOINT (không COMMIT giao dịch ngoài) nên ROLLBACK cuối cùng hoàn tác TẤT CẢ hàng đã chèn.
// Không DELETE, không TRUNCATE, không owner `aoi`. Không có DATABASE_URL ⇒ cả nhóm bị bỏ qua (skipIf).
const DB_URL = process.env.DATABASE_URL;
class HoanTacCuoiTep extends Error {}
const holder: { db: unknown } = { db: null };
vi.mock("./db/connection", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDb: async () => holder.db,
}));
/** id các hàng đã chèn — để chứng minh (a) ca THẬT SỰ ghi trong giao dịch, (b) sau ROLLBACK không còn hàng nào. */
const daChen: Record<string, number[]> = {};
const ghiNho = (khoa: string, id: number): number => {
  (daChen[khoa] ??= []).push(id);
  return id;
};
let phienGiaoDich: ReturnType<typeof postgres> | null = null;
let moKhoaHoanTac: () => void = () => undefined;
let giaoDichXong: Promise<void> = Promise.resolve();

async function moGiaoDichHoanTac(): Promise<void> {
  phienGiaoDich = postgres(DB_URL!, { max: 1, onnotice: () => undefined });
  const choHoanTac = new Promise<void>((xong) => {
    moKhoaHoanTac = xong;
  });
  await new Promise<void>((sanSang, thatBai) => {
    giaoDichXong = drizzle(phienGiaoDich!)
      .transaction(async (tx) => {
        holder.db = tx;
        sanSang();
        await choHoanTac;
        throw new HoanTacCuoiTep();
      })
      .then(
        () => undefined,
        (e: unknown) => {
          if (!(e instanceof HoanTacCuoiTep)) thatBai(e);
        },
      );
  });
}

beforeAll(async () => {
  if (!DB_URL) return;
  await moGiaoDichHoanTac();
}, 120_000);

afterAll(async () => {
  holder.db = null;
  moKhoaHoanTac();
  await giaoDichXong;
  if (phienGiaoDich) await phienGiaoDich.end({ timeout: 5 });
  // (b) NGOÀI giao dịch, bằng kết nối RIÊNG sau ROLLBACK: mọi hàng của chính lượt này KHÔNG còn. Đếm theo id đã chèn
  // (id từ sequence không tái dùng) nên không nhiễu bởi tệp khác chạy song song.
  if (DB_URL) {
    const ngoai = postgres(DB_URL, { max: 1, onnotice: () => undefined });
    try {
      for (const [bang, cot, ids] of [
        ["factories", "id", daChen.factoryIds],
        ["machines", "id", daChen.machineIds],
        ["product_models", "id", daChen.modelIds],
        ["shift_configs", "id", daChen.shiftIds],
        ["production_sessions", "id", daChen.sessionIds],
        ["product_inspections", "id", daChen.inspectionIds],
      ] as Array<[string, string, number[] | undefined]>) {
        if (!ids || ids.length === 0) continue;
        const n = Number((await ngoai.unsafe(`SELECT count(*)::int AS n FROM ${bang} WHERE "${cot}" = ANY($1::bigint[])`, [ids as never]))[0].n);
        expect(n, `${bang} sau ROLLBACK`).toBe(0);
      }
    } finally {
      await ngoai.end({ timeout: 5 });
    }
  }
}, 60_000);

describe.skipIf(!DB_URL)("getShiftStats / getShiftReport — real shift_configs windows", () => {
  const ts = Date.now();
  // shift_configs.code is varchar(20) — keep codes compact + unique.
  const sfx = ts.toString(36);
  let f2Code = "";
  let f2NightId = 0;
  let f2Line = "";
  let f2MachineId = 0;
  let f2Id = 0;
  let f3Id = 0;
  let fgapCode = "";
  let fgapId = 0;

  async function seedShift(over: {
    factoryId: number;
    name: string;
    code: string;
    startHour: number;
    endHour: number;
    orderIndex: number;
  }): Promise<number> {
    const raw = await db.getDb();
    const [row] = await raw!
      .insert(shiftConfigs)
      .values({
        factoryId: over.factoryId,
        name: over.name,
        code: over.code,
        startHour: over.startHour,
        startMinute: 0,
        endHour: over.endHour,
        endMinute: 0,
        orderIndex: over.orderIndex,
        isActive: true,
      })
      .returning({ id: shiftConfigs.id });
    return ghiNho("shiftIds", row.id);
  }

  async function buildFactory(prefix: string) {
    const code = `${prefix}_${ts}`;
    const factoryId = ghiNho("factoryIds", await db.createFactory({ code, name: `${prefix} factory` }));
    const workshopId = await db.createWorkshop({ factoryId, code: `${prefix}_WS_${ts}`, name: "ws" });
    const lineCode = `${prefix}_LINE_${ts}`;
    const lineId = await db.createProductionLine({ workshopId, code: lineCode, name: "line" });
    const stationId = await db.createStation({ lineId, code: `${prefix}_ST_${ts}`, name: "st", sequence: 1 });
    const machineId = ghiNho("machineIds", await db.createMachine({
      stationId,
      code: `${prefix}_M_${ts}`,
      name: "m",
      machineType: "AOI",
      apiKey: `test_${prefix}_${ts}`,
    }));
    return { code, factoryId, workshopId, lineCode, lineId, stationId, machineId };
  }

  beforeAll(async () => {
    const productModelId = ghiNho("modelIds", await db.createProductModel({ code: `PM_SHIFT_${ts}`, name: "pm", version: "1.0" }));

    // ── F2: clean 2-shift (DAY 06-18, NIGHT 18-06) covering 24h ──
    const f2 = await buildFactory("SHIFT_F2");
    f2Code = f2.code;
    f2Line = f2.lineCode;
    f2MachineId = f2.machineId;
    f2Id = f2.factoryId;
    await seedShift({ factoryId: f2.factoryId, name: "Ca ngày", code: `F2D${sfx}`, startHour: 6, endHour: 18, orderIndex: 1 });
    f2NightId = await seedShift({ factoryId: f2.factoryId, name: "Ca đêm", code: `F2N${sfx}`, startHour: 18, endHour: 6, orderIndex: 2 });

    const f2Rows: Array<[string, "OK" | "NG", Date]> = [
      [`SN_F2_A_${ts}`, "OK", at0630vn], // DAY
      [`SN_F2_B_${ts}`, "NG", at0900vn], // DAY
      [`SN_F2_C_${ts}`, "OK", at2100vn], // NIGHT
    ];
    for (const [serialNumber, overallResult, inspectionTime] of f2Rows) {
      ghiNho("inspectionIds", await db.createProductInspection({
        machineId: f2.machineId,
        productModelId,
        serialNumber,
        overallResult,
        originalResult: overallResult,
        inspectionTime,
        factoryCode: f2.code,
        lineCode: f2.lineCode,
      }));
    }

    // ── F3: 3-shift (S1 06-14, S2 14-22, S3 22-06) ──
    const f3 = await buildFactory("SHIFT_F3");
    f3Id = f3.factoryId;
    await seedShift({ factoryId: f3.factoryId, name: "Ca 1", code: `F3A${sfx}`, startHour: 6, endHour: 14, orderIndex: 1 });
    await seedShift({ factoryId: f3.factoryId, name: "Ca 2", code: `F3B${sfx}`, startHour: 14, endHour: 22, orderIndex: 2 });
    await seedShift({ factoryId: f3.factoryId, name: "Ca 3", code: `F3C${sfx}`, startHour: 22, endHour: 6, orderIndex: 3 });
    const f3Rows: Array<[string, Date]> = [
      [`SN_F3_1_${ts}`, at0900vn], // S1
      [`SN_F3_2_${ts}`, at1500vn], // S2
      [`SN_F3_3_${ts}`, at2300vn], // S3
    ];
    for (const [serialNumber, inspectionTime] of f3Rows) {
      ghiNho("inspectionIds", await db.createProductInspection({
        machineId: f3.machineId,
        productModelId,
        serialNumber,
        overallResult: "OK",
        originalResult: "OK",
        inspectionTime,
        factoryCode: f3.code,
        lineCode: f3.lineCode,
      }));
    }

    // ── F_gap: 2 shifts with a 14:00-22:00 gap (DAY 06-14, NIGHT 22-06) ──
    const fgap = await buildFactory("SHIFT_FG");
    fgapCode = fgap.code;
    fgapId = fgap.factoryId;
    await seedShift({ factoryId: fgap.factoryId, name: "Ngày", code: `FGD${sfx}`, startHour: 6, endHour: 14, orderIndex: 1 });
    await seedShift({ factoryId: fgap.factoryId, name: "Đêm", code: `FGN${sfx}`, startHour: 22, endHour: 6, orderIndex: 2 });

    // ── Session that ran the NIGHT shift but covers a 06:30 VN inspection
    //    (late overtime) — used to prove tier-1 overrides window classification. ──
    const rawDb = await db.getDb();
    const [phien] = await rawDb!
      .insert(productionSessions)
      .values({
        sessionCode: `SESS_F2_${ts}`,
        shiftConfigId: f2NightId,
        factoryId: f2.factoryId,
        workshopId: f2.workshopId,
        lineId: f2.lineId,
        operatorId: 1,
        status: "closed",
        shiftDate: new Date("2026-03-10T00:00:00Z"),
        plannedStart: new Date("2026-03-10T23:00:00Z"),
        plannedEnd: new Date("2026-03-11T01:00:00Z"),
        actualStart: new Date("2026-03-10T23:00:00Z"),
        actualEnd: new Date("2026-03-11T01:00:00Z"),
      })
      .returning({ id: productionSessions.id });
    ghiNho("sessionIds", phien.id);
  });

  it("(a) ca THẬT SỰ ghi trong giao dịch: 3 nhà máy, 3 máy, 1 model, 7 shift_configs, 1 session, 6 bản ghi kiểm (đếm qua tx, trước ROLLBACK)", async () => {
    const raw = (await db.getDb())!;
    const dem = async (bang: any, cot: any, ids: number[]) => (await raw.select().from(bang).where(inArray(cot, ids))).length;
    expect(daChen.factoryIds).toHaveLength(3);
    expect(await dem(factories, factories.id, daChen.factoryIds)).toBe(3);
    expect(await dem(machines, machines.id, daChen.machineIds)).toBe(3);
    expect(await dem(productModels, productModels.id, daChen.modelIds)).toBe(1);
    expect(await dem(shiftConfigs, shiftConfigs.id, daChen.shiftIds)).toBe(7);
    expect(await dem(productionSessions, productionSessions.id, daChen.sessionIds)).toBe(1);
    expect(await dem(productInspections, productInspections.id, daChen.inspectionIds)).toBe(6);
  });

  it("getShiftStats: 2-shift factory returns exactly its 2 configured shifts", async () => {
    const rows = await db.getShiftStats({ factoryId: f2Id, startDate: rangeStart, endDate: rangeEnd });
    const byCode = new Map(rows.map((r: any) => [r.shift, r]));
    expect(rows).toHaveLength(2);
    const day = byCode.get(`F2D${sfx}`);
    const night = byCode.get(`F2N${sfx}`);
    expect(day).toBeDefined();
    expect(night).toBeDefined();
    // 23:30 UTC (06:30 VN) landed in DAY, not NIGHT → factory-TZ correctness.
    expect(day.total).toBe(2);
    expect(day.ok).toBe(1);
    expect(day.ng).toBe(1);
    expect(day.finalYield).toBe(50); // (1 OK + 0 NTF)/2
    expect(day.shiftWindow).toBe("06:00-18:00");
    expect(night.total).toBe(1);
    expect(night.ok).toBe(1);
    expect(night.finalYield).toBe(100);
  });

  it("getShiftStats: 3-shift factory returns exactly its 3 configured shifts", async () => {
    const rows = await db.getShiftStats({ factoryId: f3Id, startDate: rangeStart, endDate: rangeEnd });
    expect(rows).toHaveLength(3);
    for (const r of rows as any[]) {
      expect(r.total).toBe(1);
      expect(String(r.shift)).toMatch(new RegExp(`^F3[ABC]${sfx}$`));
    }
  });

  it("getShiftReport: per-shift rollup with window, machinesActive, yield", async () => {
    const rows = await db.getShiftReport({ factoryId: f2Id, startDate: rangeStart, endDate: rangeEnd });
    const day = rows.find((r) => r.shift === `F2D${sfx}`)!;
    expect(day).toBeDefined();
    expect(day.shiftWindow).toBe("06:00-18:00");
    expect(day.total).toBe(2);
    expect(day.yieldPct).toBe(50);
    expect(day.machinesActive).toBe(1);
    expect(day.defectTypeCount).toBe(0); // no measurement_results seeded
    expect(day.source).toBe("config");
    // Every configured shift is present (zero-filled) even if it had no output.
    expect(rows.some((r) => r.shift === `F2N${sfx}`)).toBe(true);
  });

  it("resolveShiftForInspections: window tier classifies by shift_configs", async () => {
    const map = await resolveShiftForInspections(
      [
        { id: "a", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at0630vn },
        { id: "b", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at2100vn },
      ],
      { factoryId: f2Id, useSessions: false },
    );
    expect(map.get("a")!.code).toBe(`F2D${sfx}`);
    expect(map.get("a")!.source).toBe("config");
    expect(map.get("b")!.code).toBe(`F2N${sfx}`);
  });

  it("resolveShiftForInspections: a covering production_session overrides the window", async () => {
    const insp = { id: "s", machineId: f2MachineId, lineCode: f2Line, factoryCode: f2Code, inspectionTime: at0630vn };
    // Without sessions → window says DAY.
    const windowed = await resolveShiftForInspections([insp], { factoryId: f2Id, useSessions: false });
    expect(windowed.get("s")!.code).toBe(`F2D${sfx}`);
    // With sessions → the covering NIGHT session wins.
    const sessioned = await resolveShiftForInspections([insp], { factoryId: f2Id, useSessions: true });
    expect(sessioned.get("s")!.code).toBe(`F2N${sfx}`);
    expect(sessioned.get("s")!.source).toBe("session");
  });

  it("resolveShiftForInspections: falls back to hour buckets for a gap time", async () => {
    const map = await resolveShiftForInspections(
      [
        { id: "gap", machineId: 0, lineCode: null, factoryCode: fgapCode, inspectionTime: at2100vn }, // 21:00 VN — in the 14-22 gap
        { id: "cfg", machineId: 0, lineCode: null, factoryCode: fgapCode, inspectionTime: at0900vn }, // 09:00 VN — FGDAY
      ],
      { factoryId: fgapId, useSessions: false },
    );
    expect(map.get("gap")!.source).toBe("fallback");
    expect(map.get("gap")!.code).toBe("afternoon");
    expect(map.get("cfg")!.source).toBe("config");
    expect(map.get("cfg")!.code).toBe(`FGD${sfx}`);
  });
});

/**
 * Doc 27 W5-A (gap A5) — REAL bbox-based defect heatmap tests: phần DB-integration.
 *
 * Chạy trên CSDL `_test`: seeded bboxes land in the expected grid cells, NULL-bbox NG rows are EXCLUDED but counted (no silent drops),
 * the coordinate space is resolved honestly, and the pointDef fallback is labeled as logical (realCoordinates:false).
 * Phần bucketing thuần nằm ở `defectSpatialHeatmap.test.ts`.
 *
 * ⚠ TỆP NÀY CHẠM `_test` (đuôi `.db.test.ts`): toàn bộ fixture (nhà máy / xưởng / dây chuyền / trạm / máy / model sản phẩm / điểm đo /
 *   mã lỗi / bản ghi kiểm / measurement_results) nằm trong MỘT giao dịch drizzle mở suốt tệp và kết thúc bằng ROLLBACK (không DELETE,
 *   không TRUNCATE, không owner `aoi`). Kỳ vọng các ca giữ nguyên.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray } from "drizzle-orm";
import { computeSpatialHeatmap } from "./defectSpatialHeatmap";
import * as db from "../db";
import { getDb } from "../db/connection";
import { factories, machines, productModels, productInspections, measurementResults } from "../../drizzle/schema";

/**
 * Các ca dưới đây đo PHÉP GOM (bucketing / coordinate space), không đo phạm vi dữ liệu.
 * Vai `admin` ⇒ `getAccessFilterConditions` trả `undefined` ⇒ KHÔNG bộ lọc nào được áp
 * ⇒ hành vi y hệt trước bản vá phạm vi 2026-08-17, nên các phép đo cũ giữ nguyên nghĩa.
 * (`userId` không cần có thật: `getUserAssignmentCodes` ngắt mạch ở vai `admin` trước
 * khi chạm CSDL.) Trục phạm vi có lưới RIÊNG: `defectSpatialHeatmap.scope.db.test.ts`.
 */
const ADMIN_SCOPE = { userId: 1, userRole: "admin" } as const;


// ═════════════════════════════════════════════════════════════════
// GIAO DỊCH HOÀN TÁC — mẫu server/db/statisticsScope.test.ts + aiAnalyticsMachineType.db.test.ts
// ═════════════════════════════════════════════════════════════════
// `getDb` (mock) trả về `tx` của MỘT giao dịch drizzle mở suốt tệp; hàm `db.create*` / `createProductInspection` tự mở `transaction(...)`:
// trên `tx` việc đó thành SAVEPOINT (không COMMIT giao dịch ngoài) nên ROLLBACK cuối cùng hoàn tác TẤT CẢ hàng đã chèn.
// Không DELETE, không TRUNCATE, không owner `aoi`. Không có DATABASE_URL ⇒ cả nhóm bị bỏ qua (skipIf).
const DB_URL = process.env.DATABASE_URL;
class HoanTacCuoiTep extends Error {}
const holder: { db: unknown } = { db: null };
vi.mock("../db/connection", async (importOriginal) => ({
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
        ["defect_catalog", "id", daChen.catalogIds],
        ["product_inspections", "id", daChen.inspectionIds],
        ["measurement_results", "inspectionId", daChen.inspectionIds],
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

// ─── DB integration ─────────────────────────────────────────────────────────

describe.skipIf(!DB_URL)("computeSpatialHeatmap (DB integration)", () => {
  const ts = Date.now();
  let machineId: number;
  let productModelId: number;
  let catalogId: number;
  const windowStart = new Date("2026-04-01T00:00:00Z");
  const windowEnd = new Date("2026-04-10T00:00:00Z");

  beforeAll(async () => {
    const factoryId = ghiNho("factoryIds", await db.createFactory({ code: `TEST_FAC_HM_${ts}`, name: "Heatmap fac" }));
    const workshopId = await db.createWorkshop({ factoryId, code: `TEST_WS_HM_${ts}`, name: "Heatmap ws" });
    const lineId = await db.createProductionLine({ workshopId, code: `TEST_LINE_HM_${ts}`, name: "Heatmap line" });
    const stationId = await db.createStation({ lineId, code: `TEST_ST_HM_${ts}`, name: "Heatmap st", orderIndex: 1 });
    machineId = ghiNho("machineIds", await db.createMachine({
      stationId,
      code: `M_HM_${ts}`,
      name: "Heatmap machine",
      machineType: "AOI",
      apiKey: `test_hm_${ts}`,
    }));
    productModelId = ghiNho("modelIds", await db.createProductModel({
      code: `PROD_HM_${ts}`,
      name: "Heatmap product",
      imageWidth: 1000,
      imageHeight: 800,
    }));
    const pointDefId = await db.createMeasurementPointDef({
      productModelId,
      code: `MP_HM_${ts}`,
      name: "Heatmap point",
      measurementType: "VISUAL",
      positionX: 0,
      positionY: 0,
    });
    catalogId = ghiNho("catalogIds", await db.createDefectCatalog({
      code: `TEST_HM_BRIDGE_${ts}`,
      name: "Test bridging",
      severity: "critical",
      category: "solder",
    }));

    const inspectionId = ghiNho("inspectionIds", await db.createProductInspection({
      machineId,
      productModelId,
      serialNumber: `SN_HM_${ts}`,
      overallResult: "NG",
      originalResult: "NG",
      inspectionTime: new Date("2026-04-05T03:00:00Z"),
    }));

    await db.createMeasurementResults([
      // 3 NG WITH bbox → grid (cells derived from centers over 1000×800):
      // center (50,40)   → cell (0,0) on a 10×10 grid
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catalogId, defectBboxX: 40, defectBboxY: 30, defectBboxW: 20, defectBboxH: 20 },
      // center (55,45)   → cell (0,0)
      { inspectionId, pointDefId, result: "NG", defectCatalogId: catalogId, defectBboxX: 55, defectBboxY: 45, defectBboxW: 0, defectBboxH: 0 },
      // center (550,440) → cell (5,5)
      { inspectionId, pointDefId, result: "NG", defectBboxX: 540, defectBboxY: 430, defectBboxW: 20, defectBboxH: 20 },
      // 2 NG WITHOUT bbox → excluded, counted
      { inspectionId, pointDefId, result: "NG" },
      { inspectionId, pointDefId, result: "NG", defectBboxX: null as any, defectBboxY: null as any },
      // 1 OK row with bbox → not a defect, ignored entirely
      { inspectionId, pointDefId, result: "OK", defectBboxX: 10, defectBboxY: 10, defectBboxW: 5, defectBboxH: 5 },
    ] as any);
  });

  it("(a) ca THẬT SỰ ghi trong giao dịch: 1 nhà máy, 1 máy, 1 model, 1 mã lỗi, 1 bản ghi kiểm, 6 measurement_results (đếm qua tx, trước ROLLBACK)", async () => {
    const raw = (await getDb())!;
    const dem = async (bang: any, cot: any, ids: number[]) => (await raw.select().from(bang).where(inArray(cot, ids))).length;
    expect(await dem(factories, factories.id, daChen.factoryIds)).toBe(1);
    expect(await dem(machines, machines.id, daChen.machineIds)).toBe(1);
    expect(await dem(productModels, productModels.id, daChen.modelIds)).toBe(1);
    expect(daChen.catalogIds).toHaveLength(1);
    expect(await dem(productInspections, productInspections.id, daChen.inspectionIds)).toBe(1);
    expect(await dem(measurementResults, measurementResults.inspectionId, daChen.inspectionIds)).toBe(6);
  });

  it("aggregates real bboxes into the expected cells and counts NULL-bbox exclusions", async () => {
    const conn = await getDb();
    expect(conn).toBeTruthy();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "bbox",
      scope: ADMIN_SCOPE,
    });

    expect(r.realCoordinates).toBe(true);
    expect(r.mode).toBe("bbox");
    // Product dims stored + all bboxes fit → product_image space, 1000×800.
    expect(r.coordinateSpace).toBe("product_image");
    expect(r.boardWidth).toBe(1000);
    expect(r.boardHeight).toBe(800);

    expect(r.totalDefects).toBe(3);
    expect(r.excludedNoBbox).toBe(2);
    expect(r.excludedNoBboxPct).toBe(40); // 2 of 5 NG rows

    expect(r.grid[0][0]).toBe(2);
    expect(r.grid[5][5]).toBe(1);
    expect(r.maxDefectsInCell).toBe(2);

    const top = r.hotspots[0];
    expect(top).toMatchObject({ x: 0, y: 0, defectCount: 2, topDefectClass: `TEST_HM_BRIDGE_${ts}` });
    const second = r.hotspots[1];
    expect(second).toMatchObject({ x: 5, y: 5, defectCount: 1, topDefectClass: "UNCLASSIFIED" });
  });

  it("filters by defect class", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      defectCatalogId: catalogId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "bbox",
      scope: ADMIN_SCOPE,
    });
    expect(r.totalDefects).toBe(2); // only the two classified rows
    expect(r.grid[0][0]).toBe(2);
  });

  it("pointDef fallback is honestly labeled as logical, not spatial", async () => {
    const conn = await getDb();
    const r = await computeSpatialHeatmap(conn!, {
      startDate: windowStart,
      endDate: windowEnd,
      machineId,
      productModelId,
      gridWidth: 10,
      gridHeight: 10,
      mode: "pointDef",
      scope: ADMIN_SCOPE,
    });
    expect(r.realCoordinates).toBe(false);
    expect(r.mode).toBe("pointDef");
    expect(r.coordinateSpace).toBe("logical_point_index");
    // All 5 NG rows participate (bbox irrelevant in logical mode).
    expect(r.totalDefects).toBe(5);
    expect(r.excludedNoBbox).toBe(0);
  });
});

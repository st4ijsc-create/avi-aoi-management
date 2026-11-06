/**
 * ★★★ 2026-08-17 — NHÓM A, LƯỚI CHẠM **CSDL THẬT** cho ba bộ sinh nội dung báo cáo hẹn giờ.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO FILE NÀY BẮT BUỘC TỒN TẠI, không phải "cho chắc".
 *
 * `externalReportService.fetchOeeReportRows` nhúng hai mốc thời gian dưới dạng **đối tượng
 * `Date`**. postgres.js từ chối tham số ấy (`ERR_INVALID_ARG_TYPE`), nên báo cáo OEE **chưa bao
 * giờ chạy được trên CSDL thật** — trong khi `externalReportService.test.ts` vẫn XANH suốt, vì
 * nó giả lập `getDb`. Một cái mock có thể che một sự cố TOÀN PHẦN mà không lưới nào đỏ.
 *
 * Vì vậy MỖI loại báo cáo ở đây có ≥1 ca chạy trên CSDL thật (vitest.setup.ts đã đổi
 * DATABASE_URL sang `<db>_test` biệt lập), và ca ấy đo **CON SỐ**, không chỉ "không ném lỗi".
 *
 * Dữ liệu dựng: HAI nhà máy độc lập (A, B) — mỗi bên một xưởng/chuyền/trạm/máy, kèm bản ghi
 * kiểm + kết quả đo + hàng `oee_metrics` + `downtime_events`. Bốn tài khoản: admin, kỹ sư gán A,
 * người 0 gán, người bị TẮT. Cửa sổ đặt ở tháng 11/2026 — vùng KHÔNG có dữ liệu sẵn trong CSDL
 * test (đã đo: 0 bản ghi kiểm / 0 OEE / 0 downtime), nên mọi con số dưới đây là ĐÚNG TUYỆT ĐỐI
 * chứ không phải "lớn hơn / nhỏ hơn".
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

/**
 * ★ 2026-11-06 — DỮ LIỆU DỰNG NẰM TRONG MỘT GIAO DỊCH ROLLBACK (một kết nối duy nhất, `BEGIN` ở beforeAll,
 * `ROLLBACK` ở afterAll). Lý do: cửa sổ tháng 11/2026 từng "sạch" nay đã có dữ liệu thật của mô phỏng
 * (đo 292 thay vì 10 ở ca admin NG Visual) ⇒ phép đếm tuyệt đối của admin vỡ. Nay: (1) không để lại hàng
 * nào trong `_test` (kể cả bảng WORM `product_inspections`); (2) ca admin đếm theo ĐỘ LỆCH so với mốc
 * đo TRƯỚC khi dựng dữ liệu (cùng giao dịch), còn danh sách máy lọc theo TIỀN TỐ của chính tệp.
 * Dịch vụ gọi `getDb()` ⇒ ép trỏ vào kết nối giao dịch này (mẫu của lechGioTruyVanTho.db.test.ts).
 */
const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    getDb: async () => h.db,
    getReadDb: async () => h.db,
    getJobsDb: async () => h.db,
  };
});
import { scheduledReportService } from "./scheduledReportService";
import { generateNGVisualReport } from "./reportGenerator";

const DB_URL = process.env.DATABASE_URL;
const RUN = `NA${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Cửa sổ SẠCH (0 hàng dựng sẵn) ⇒ mọi khẳng định là con số tuyệt đối. */
const WINDOW = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-30T00:00:00Z") };
const T = new Date("2026-11-15T12:00:00.000Z");

const FAC_A = `NA-FAC-A-${RUN}`;
const FAC_B = `NA-FAC-B-${RUN}`;

let sql: ReturnType<typeof postgres>;

const ids = {
  factoryA: 0, factoryB: 0,
  workshopA: 0, workshopB: 0,
  lineA: 0, lineB: 0,
  stationA: 0, stationB: 0,
  machineA: 0, machineB: 0,
  product: 0,
  pointA: 0, pointB: 0,
  userAdmin: 0, userEngA: 0, userNoAssign: 0, userDisabled: 0,
  inspIds: [] as number[],
  resultIds: [] as number[],
};

/** Mốc nền admin đo TRƯỚC khi dựng dữ liệu của tệp. */
const nen = { totalMachines: 0, totalDowntime: 0, ngInspections: 0, ngCount: 0 };

const codeA = () => `NA-MC-A-${RUN}`;
const codeB = () => `NA-MC-B-${RUN}`;

/** Hàng lịch tối thiểu — `window` ghi đè cửa sổ suy từ `frequency` để lưới tất định. */
const reportRow = (createdBy: number, type: "oee" | "machine_health") => ({
  id: 0,
  name: `NA report ${RUN}`,
  type,
  frequency: "daily" as const,
  recipients: [] as string[],
  isEnabled: true,
  createdBy,
  createdAt: new Date(),
  window: WINDOW,
});

describe.skipIf(!DB_URL)("Nhóm A — phạm vi báo cáo hẹn giờ trên CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`BEGIN`;
    await sql`SET LOCAL TIME ZONE 'UTC'`;
    h.db = drizzle(sql);

    // Tài khoản dựng TRƯỚC để đo mốc nền của admin (dữ liệu có sẵn trong cửa sổ) trước khi dựng gì khác.
    // Bốn tài khoản người TẠO LỊCH.
    const mkUser = async (username: string, role: string, isActive = true) => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`na-${username}`}, ${username}, ${username}, ${role}, ${isActive}) RETURNING id`;
      return r.id as number;
    };
    ids.userAdmin = await mkUser(`na-admin-${RUN}`, "admin");
    ids.userEngA = await mkUser(`na-eng-a-${RUN}`, "engineer");
    ids.userNoAssign = await mkUser(`na-noassign-${RUN}`, "supervisor");
    ids.userDisabled = await mkUser(`na-disabled-${RUN}`, "engineer", false);

    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.userEngA}, ${FAC_A})`;
    // Người bị TẮT vẫn CÒN NGUYÊN gán nhà máy — đúng hình dạng nguy hiểm mà cổng phải chặn.
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.userDisabled}, ${FAC_A})`;

    const nenOee = await scheduledReportService.generateOEEReportContent(reportRow(ids.userAdmin, "oee"));
    const nenNg = await generateNGVisualReport({ startDate: WINDOW.start, endDate: WINDOW.end, actor: { id: ids.userAdmin, role: "admin" } });
    nen.totalMachines = nenOee.summary.totalMachines;
    nen.totalDowntime = nenOee.summary.totalDowntime;
    nen.ngInspections = nenNg.summary.totalInspections;
    nen.ngCount = nenNg.summary.totalNG;

    const mkHierarchy = async (facCode: string, tag: string) => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${facCode}, ${"NA factory " + tag}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${`NA-W-${tag}-${RUN}`}, 'NA workshop') RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${`NA-L-${tag}-${RUN}`}, 'NA line') RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${`NA-S-${tag}-${RUN}`}, 'NA station') RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${tag === "A" ? codeA() : codeB()}, ${"NA machine " + tag}, 'AOI') RETURNING id`;
      return { factory: f.id as number, workshop: w.id as number, line: l.id as number, station: s.id as number, machine: m.id as number };
    };

    const A = await mkHierarchy(FAC_A, "A");
    const B = await mkHierarchy(FAC_B, "B");
    ids.factoryA = A.factory; ids.workshopA = A.workshop; ids.lineA = A.line; ids.stationA = A.station; ids.machineA = A.machine;
    ids.factoryB = B.factory; ids.workshopB = B.workshop; ids.lineB = B.line; ids.stationB = B.station; ids.machineB = B.machine;

    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${`NA-P-${RUN}`}, 'NA product') RETURNING id`;
    ids.product = p.id;
    const mkPoint = async (tag: string) => {
      const [r] = await sql`
        INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
        VALUES (${ids.product}, ${`NA-PT-${tag}-${RUN}`}, ${`NA-PT-${tag}`}, 'VISUAL', 1, 1) RETURNING id`;
      return r.id as number;
    };
    ids.pointA = await mkPoint("A");
    ids.pointB = await mkPoint("B");

    // Bản ghi kiểm MANG mã tenant — chính cột mà `getAccessFilterConditions` nói tới.
    const mkInsp = async (machineId: number, factoryCode: string, overall: "OK" | "NG") => {
      const [r] = await sql`
        INSERT INTO product_inspections
          ("machineId", "productModelId", "factoryCode", "serialNumber", "overallResult", "originalResult", "inspectionTime")
        VALUES (${machineId}, ${ids.product}, ${factoryCode}, ${`SN-${RUN}-${ids.inspIds.length}`}, ${overall},
                ${overall}, ${T.toISOString()}) RETURNING id`;
      ids.inspIds.push(r.id);
      return r.id as number;
    };
    const addResult = async (inspId: number, pointDefId: number, result: "OK" | "NG") => {
      const [r] = await sql`
        INSERT INTO measurement_results ("inspectionId", "pointDefId", result)
        VALUES (${inspId}, ${pointDefId}, ${result}) RETURNING id`;
      ids.resultIds.push(r.id as number);
    };

    // Nhà máy A: 3 bản ghi kiểm × (1 NG + 1 OK) = 6 kết quả đo, 3 NG.
    for (let i = 0; i < 3; i++) {
      const insp = await mkInsp(ids.machineA, FAC_A, i === 0 ? "NG" : "OK");
      await addResult(insp, ids.pointA, "NG");
      await addResult(insp, ids.pointA, "OK");
    }
    // Nhà máy B: 2 bản ghi kiểm × (1 NG + 1 OK) = 4 kết quả đo, 2 NG.
    for (let i = 0; i < 2; i++) {
      const insp = await mkInsp(ids.machineB, FAC_B, "NG");
      await addResult(insp, ids.pointB, "NG");
      await addResult(insp, ids.pointB, "OK");
    }

    // `oee_metrics` / `downtime_events` — KHÔNG có cột tenant (đó là cả vấn đề).
    const mkOee = async (machineId: number, machineCode: string, oee: number) => {
      await sql`
        INSERT INTO oee_metrics
          ("machineId", "machineCode", timestamp, availability, performance, quality, oee,
           "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
        VALUES (${machineId}, ${machineCode}, ${T.toISOString()}, 9000, 8000, 9500, ${oee}, 480, 400, 30, 100, 95, 5)`;
    };
    await mkOee(ids.machineA, codeA(), 6800);
    await mkOee(ids.machineB, codeB(), 5000);

    const mkDowntime = async (machineId: number, machineCode: string, duration: number) => {
      await sql`
        INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime", duration)
        VALUES (${machineId}, ${machineCode}, 'breakdown', ${"NA " + machineCode}, ${T.toISOString()}, ${duration})`;
    };
    await mkDowntime(ids.machineA, codeA(), 30);
    await mkDowntime(ids.machineB, codeB(), 45);

  }, 180_000);

  afterAll(async () => {
    try {
      await sql`ROLLBACK`; // không để lại gì — kể cả hàng WORM
    } finally {
      await sql?.end();
    }
  }, 120_000);

  // ── 1. OEE ────────────────────────────────────────────────────────────────────────────────
  describe("generateOEEReportContent", () => {
    it("ÂM: kỹ sư gán nhà máy A KHÔNG lấy được máy/downtime của nhà máy B", async () => {
      const c = await scheduledReportService.generateOEEReportContent(reportRow(ids.userEngA, "oee"));

      expect(c.machineOEE.map((m) => m.machineCode)).toEqual([codeA()]);
      expect(c.machineOEE.map((m) => m.machineCode)).not.toContain(codeB());
      expect(c.summary.totalMachines).toBe(1);
      // 6800 lưu dạng ×100 ⇒ 68%.
      expect(c.machineOEE[0].oee).toBeCloseTo(68, 5);
      // Downtime: chỉ 30 phút của A, KHÔNG có 45 phút của B.
      expect(c.summary.totalDowntime).toBe(30);
      expect(c.downtimeByCategory.breakdown).toBe(30);
      expect(c.scopeApplied).toBe(true);
      expect(c.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);
    });

    it("DƯƠNG: admin vẫn lấy TOÀN BỘ hai nhà máy (chống vá quá tay)", async () => {
      const c = await scheduledReportService.generateOEEReportContent(reportRow(ids.userAdmin, "oee"));

      expect(c.machineOEE.map((m) => m.machineCode).filter((x) => x.endsWith(RUN)).sort()).toEqual([codeA(), codeB()].sort());
      expect(c.summary.totalMachines).toBe(nen.totalMachines + 2);
      expect(c.summary.totalDowntime).toBe(nen.totalDowntime + 75); // 30 + 45
      expect(c.scopeApplied).toBe(false);
      expect(c.scopeNote).toBeUndefined();
    });

    it("ÂM: người 0 gán nhà máy ⇒ TỪ CHỐI với câu 'chưa được gán nhà máy'", async () => {
      await expect(
        scheduledReportService.generateOEEReportContent(reportRow(ids.userNoAssign, "oee")),
      ).rejects.toThrow(/chưa được gán nhà máy/);
    });

    it("ÂM: tài khoản bị TẮT (còn nguyên gán) ⇒ TỪ CHỐI", async () => {
      await expect(
        scheduledReportService.generateOEEReportContent(reportRow(ids.userDisabled, "oee")),
      ).rejects.toThrow(/vô hiệu hoá/);
    });
  });

  // ── 2. Sức khoẻ máy ───────────────────────────────────────────────────────────────────────
  describe("generateMachineHealthReportContent", () => {
    it("ÂM: kỹ sư gán A thấy máy A, KHÔNG thấy máy B", async () => {
      const c = await scheduledReportService.generateMachineHealthReportContent(reportRow(ids.userEngA, "machine_health"));
      const codes = c.machineHealth.map((m) => m.machineCode);

      expect(codes).toContain(codeA());
      expect(codes).not.toContain(codeB());
      // Chỉ những máy có bản ghi kiểm TRONG PHẠM VI + TRONG CỬA SỔ mới lọt vào ⇒ đúng 1 máy.
      expect(codes).toEqual([codeA()]);
      expect(c.scopeApplied).toBe(true);
      expect(c.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);
    });

    it("DƯƠNG: admin thấy CẢ HAI máy (và cả đội máy còn lại)", async () => {
      const c = await scheduledReportService.generateMachineHealthReportContent(reportRow(ids.userAdmin, "machine_health"));
      const codes = c.machineHealth.map((m) => m.machineCode);

      expect(codes).toContain(codeA());
      expect(codes).toContain(codeB());
      expect(c.scopeApplied).toBe(false);
      expect(c.scopeNote).toBeUndefined();
    }, 60_000);

    it("ÂM: người 0 gán ⇒ TỪ CHỐI, không gửi đi một email KPI toàn số 0", async () => {
      await expect(
        scheduledReportService.generateMachineHealthReportContent(reportRow(ids.userNoAssign, "machine_health")),
      ).rejects.toThrow(/chưa được gán nhà máy/);
    });
  });

  // ── 3. NG Visual ──────────────────────────────────────────────────────────────────────────
  describe("generateNGVisualReport", () => {
    const win = { startDate: WINDOW.start, endDate: WINDOW.end };

    it("ÂM: kỹ sư gán A chỉ đếm kết quả đo của A (6 kết quả / 3 NG), không dính 4 của B", async () => {
      const d = await generateNGVisualReport({ ...win, actor: { id: ids.userEngA, role: "engineer" } });

      expect(d.summary.totalInspections).toBe(6);
      expect(d.summary.totalNG).toBe(3);
      expect(d.scopeApplied).toBe(true);
      expect(d.scopeNote).toMatch(/KHÔNG phải toàn hệ thống/);

      // ⚠⚠ Cổng chống "gán `scope = resolved` nguyên khối". Ở ĐÂY mệnh đề tenant là hàng THẬT
      // (`inArray(productInspections.factoryCode, …)`) — một đối tượng SQL drizzle mang THAM
      // CHIẾU VÒNG `PgTable → PgSerial → table`. Trong lưới giả lập, mệnh đề giả không có vòng
      // nên nó KHÔNG phát hiện được lớp lỗi này; chỉ ca chạm CSDL thật mới phát biểu được.
      expect(d).not.toHaveProperty("filter");
      expect(() => JSON.stringify(d)).not.toThrow();
    });

    it("DƯƠNG: admin đếm ĐỦ cả hai nhà máy (10 kết quả / 5 NG)", async () => {
      const d = await generateNGVisualReport({ ...win, actor: { id: ids.userAdmin, role: "admin" } });

      expect(d.summary.totalInspections).toBe(nen.ngInspections + 10);
      expect(d.summary.totalNG).toBe(nen.ngCount + 5);
      expect(d.scopeApplied).toBe(false);
      expect(d.scopeNote).toBeUndefined();
    });

    it("ÂM: người 0 gán ⇒ TỪ CHỐI với câu 'chưa được gán nhà máy'", async () => {
      await expect(
        generateNGVisualReport({ ...win, actor: { id: ids.userNoAssign, role: "supervisor" } }),
      ).rejects.toThrow(/chưa được gán nhà máy/);
    });
  });
});

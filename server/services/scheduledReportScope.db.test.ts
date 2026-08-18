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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
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

/**
 * ⚠⚠ `product_inspections` là bảng WORM: vai `avi_app` chỉ có SELECT/INSERT/UPDATE, **KHÔNG có
 * DELETE** (đo 2026-08-17 trên `aoi_management_test`). Mọi lưới trong repo đang viết
 * `DELETE FROM product_inspections` ở `afterAll` đều KHÔNG dọn được gì — và vì `product_inspections`
 * có khoá ngoại trỏ tới `machines`, hàng sót lại còn CHẶN luôn việc xoá máy/trạm/chuyền/xưởng.
 * Đó là lý do CSDL test đang có 1.669 máy "đang hoạt động".
 *
 * Ở đây dọn bằng đúng quyền được cấp: **UPDATE** đẩy hàng sót ra KHỎI cửa sổ báo cáo (đó mới là
 * thứ làm hỏng phép đếm tuyệt đối ở lần chạy sau), rồi mới thử DELETE và nuốt lỗi. Máy được TẮT
 * thay vì xoá, để `getAllMachinesOEELive` của lần chạy sau không nhặt lại.
 */
const PARKED = new Date("1990-01-01T00:00:00Z");

/** Chạy một lệnh dọn, nuốt lỗi — dùng cho các lệnh có thể bị WORM/FK chặn. */
async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* WORM hoặc FK chặn — đã có đường dọn thay thế ở trên */ }
}

describe.skipIf(!DB_URL)("Nhóm A — phạm vi báo cáo hẹn giờ trên CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    // TỰ CHỮA: đẩy mọi hàng sót của các lượt chạy TRƯỚC (kể cả lượt bị huỷ giữa chừng) ra khỏi
    // cửa sổ. Không có bước này thì phép đếm TUYỆT ĐỐI bên dưới sẽ trôi dần theo số lần chạy —
    // và một lưới trôi thì sớm muộn cũng bị nới lỏng thành `toBeGreaterThan`, tức mất khả năng
    // phát hiện rò.
    await safe(() => sql`
      UPDATE product_inspections SET "inspectionTime" = ${PARKED}, "factoryCode" = NULL
      WHERE "serialNumber" LIKE 'SN-NA%' AND "inspectionTime" >= ${WINDOW.start}`);

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
                ${overall}, ${T}) RETURNING id`;
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
        VALUES (${machineId}, ${machineCode}, ${T}, 9000, 8000, 9500, ${oee}, 480, 400, 30, 100, 95, 5)`;
    };
    await mkOee(ids.machineA, codeA(), 6800);
    await mkOee(ids.machineB, codeB(), 5000);

    const mkDowntime = async (machineId: number, machineCode: string, duration: number) => {
      await sql`
        INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime", duration)
        VALUES (${machineId}, ${machineCode}, 'breakdown', ${"NA " + machineCode}, ${T}, ${duration})`;
    };
    await mkDowntime(ids.machineA, codeA(), 30);
    await mkDowntime(ids.machineB, codeB(), 45);

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
  }, 180_000);

  afterAll(async () => {
    try {
      const users = [ids.userAdmin, ids.userEngA, ids.userNoAssign, ids.userDisabled].filter(Boolean);
      const machines = [ids.machineA, ids.machineB].filter(Boolean);
      if (users.length) await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
      if (machines.length) {
        await safe(() => sql`DELETE FROM downtime_events WHERE "machineId" IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM oee_metrics WHERE "machineId" IN ${sql(machines)}`);
      }
      if (ids.resultIds.length) await safe(() => sql`DELETE FROM measurement_results WHERE id IN ${sql(ids.resultIds)}`);
      if (ids.inspIds.length) {
        // ① ĐẨY RA KHỎI CỬA SỔ trước (UPDATE được cấp quyền) — bước THẬT SỰ giữ phép đếm sạch.
        await safe(() => sql`
          UPDATE product_inspections SET "inspectionTime" = ${PARKED}, "factoryCode" = NULL
          WHERE id IN ${sql(ids.inspIds)}`);
        // ② rồi mới thử xoá; WORM sẽ chặn, và đó là điều đã lường trước.
        await safe(() => sql`DELETE FROM product_inspections WHERE id IN ${sql(ids.inspIds)}`);
      }
      await safe(() => sql`DELETE FROM measurement_point_defs WHERE id IN ${sql([ids.pointA, ids.pointB].filter(Boolean))}`);
      if (machines.length) {
        // Hàng kiểm sót lại (WORM) giữ khoá ngoại trỏ vào máy ⇒ không xoá được. TẮT máy để lượt
        // chạy sau không nhặt lại chúng qua `getAllMachinesOEELive`.
        await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM machines WHERE id IN ${sql(machines)}`);
      }
      if (ids.product) await safe(() => sql`DELETE FROM product_models WHERE id = ${ids.product}`);
      await safe(() => sql`DELETE FROM stations WHERE id IN ${sql([ids.stationA, ids.stationB].filter(Boolean))}`);
      await safe(() => sql`DELETE FROM production_lines WHERE id IN ${sql([ids.lineA, ids.lineB].filter(Boolean))}`);
      await safe(() => sql`DELETE FROM workshops WHERE id IN ${sql([ids.workshopA, ids.workshopB].filter(Boolean))}`);
      await safe(() => sql`DELETE FROM factories WHERE id IN ${sql([ids.factoryA, ids.factoryB].filter(Boolean))}`);
      if (users.length) await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
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

      expect(c.machineOEE.map((m) => m.machineCode).sort()).toEqual([codeA(), codeB()].sort());
      expect(c.summary.totalMachines).toBe(2);
      expect(c.summary.totalDowntime).toBe(75); // 30 + 45
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

      expect(d.summary.totalInspections).toBe(10);
      expect(d.summary.totalNG).toBe(5);
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

/**
 * server/routers/stationAnalysisBucketFactoryLocal.db.test.ts
 *
 * BG-96 Important-2 (review 2026-09-03, xem `.superpowers/sdd/2026-09-03-aoi-khoi-c-gioi-han/
 * task-2-report.md`) — chứng minh bucket GIỜ của `stationAnalysisRouter.getHourlyYield` đi qua
 * GIỜ TƯỜNG NHÀ MÁY (`FACTORY_TZ`, mặc định Asia/Ho_Chi_Minh, `server/utils/factoryTime.ts`),
 * KHÔNG phải giờ UTC thô của cột `product_inspections.inspectionTime` — cột này đã là UTC THẬT
 * từ cutover Task 1 (BG-96, commit `aedd3096`).
 *
 * ── Mệnh đề canh ─────────────────────────────────────────────────────────────────────────────
 * Một hàng có `inspectionTime = 2026-09-03T20:00:00Z` (20h UTC) phải rơi vào giờ **3 sáng**
 * (03h, sang NGÀY factory kế tiếp — 20+7=27, 27-24=3) khi đọc qua `piLocalHourOfDay()`
 * (= `factoryHourOfDaySql`, server/utils/kpi.ts). Nếu bucket còn tính theo UTC thô (bản trước
 * bản vá Important-2 — `extract(hour from inspectionTime)` trần), kết quả sẽ là giờ **20**
 * (8 giờ tối) — sai NGUYÊN MỘT CA làm việc, đúng hình dạng lỗi reviewer nêu.
 *
 * DB THẬT, KHÔNG mock `../db` — cùng khuôn `thoiGianMotHeQuyChieu.db.test.ts` (Task 1).
 *
 * ── Vì sao fixture tối giản (không cần `users`/`user_factory_assignments`) ─────────────────────
 * Vai `admin` tắt hẳn việc phân giải phạm vi theo DB: `server/db/reportAggregators.ts:338`
 * (`resolveTenantFactoryScope`) — `if (!args?.userId || args.userRole === "admin") return
 * { factoryIds: null, ... }` — trả `factoryIds: null` (không lọc gì) mà KHÔNG đụng bảng `users`.
 * Nên chỉ cần dựng chuỗi factory→workshop→line→station→machine + MỘT hàng `product_inspections`.
 *
 * ── Vì sao KHÔNG kèm ca bucket theo NGÀY (`getYieldControlChart`, trường `day`) ─────────────────
 * Các thủ tục dùng `piLocalDay()` (`date_trunc`-based, KHÔNG `to_char`) trả `day` như một Date
 * dựng từ cột "timestamp without time zone", rồi router tự `String(d.day)` — cách driver Node
 * parse giá trị đó phụ thuộc TZ của TIẾN TRÌNH chạy test (quirk đã biết của node-postgres/
 * postgres.js với timestamp naive), nên so chuỗi ở ĐÂY dễ vỡ theo máy chạy CI mà không liên quan
 * gì tới đúng-sai của bản vá. `getCheckSheetData.day` dùng `factoryDayTextSql` (TO_CHAR — chuỗi
 * THẬT, không qua Date) tránh được vấn đề này, nhưng cần thêm `measurement_point_defs` +
 * `measurement_results` gắn với một hàng NG — vượt phạm vi "rẻ" mà bản vá này nhắm tới.
 * `piLocalDay` và `piLocalHourOfDay` đều gọi CHUNG một `factoryLocalTsSql` (server/utils/kpi.ts)
 * — ca GIỜ dưới đây đã chứng minh đúng cơ chế AT TIME ZONE hai lượt dùng chung cho cả hai, không
 * phải một cơ chế riêng cho ngày cần chứng minh lại. Nói rõ ở đây thay vì tự chế một ca ngày
 * fragile rồi khai nó xanh.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `SABKT${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0 };

// Vai admin — xem docblock "Vì sao fixture tối giản" ở trên. `id` không cần tồn tại trong bảng
// `users` vì nhánh admin của `resolveTenantFactoryScope` không truy vấn DB theo `userId`.
const ctxAdmin = { user: { id: 999999, role: "admin", name: "bg96-important2-admin" } } as never;

describe.skipIf(!DB_URL)("BG-96 Important-2 — getHourlyYield bucket theo giờ FACTORY-LOCAL, không UTC thô", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    // Khoá session TZ của KẾT NỐI DỰNG FIXTURE này — đảm bảo chữ số nạp vào cột naive khớp
    // ĐÚNG NGUYÊN VĂN chuỗi UTC dưới đây, bất kể server Postgres cấu hình TZ mặc định gì.
    await sql`SET TIME ZONE 'UTC'`;

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'SABKT factory') RETURNING id`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f!.id}, ${"W-" + RUN}, 'SABKT ws') RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w!.id}, ${"L-" + RUN}, 'SABKT line') RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l!.id}, ${"S-" + RUN}, 'SABKT station') RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s!.id}, ${"M-" + RUN}, 'SABKT machine', 'AOI') RETURNING id`;
    ids.factory = f!.id as number; ids.workshop = w!.id as number; ids.line = l!.id as number;
    ids.station = s!.id as number; ids.machine = m!.id as number;

    // 20:00 UTC — dưới session TZ 'UTC' vừa khoá ở trên, Postgres nạp ĐÚNG chữ số này vào cột
    // "timestamp without time zone", khớp quy ước ghi UTC THẬT hậu-cutover Task 1 (BG-96).
    await sql`
      INSERT INTO product_inspections
        ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
      VALUES (${ids.machine}, ${"SN-" + RUN}, 'OK', 'OK', '2026-09-03T20:00:00.000Z', ${"F-" + RUN})`;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    try {
      // ⚠ `product_inspections` là bảng WORM (migration 0279) — `avi_app` bị THU HỒI quyền
      // DELETE có chủ ý. Để lại CỐ Ý (cùng khuôn `thoiGianMotHeQuyChieu.db.test.ts`, Task 1) —
      // KHÔNG viết `DELETE FROM product_inspections … .catch(() => {})` (32 file test khác đã
      // đo đây là NO-OP CÂM, xem MEMORY). Xoá MỀM chuỗi phân cấp để không rò vào phép đếm của
      // suite khác — mọi bề mặt trong hệ đều lọc `isActive = true`.
      if (ids.machine) await sql`UPDATE machines SET "isActive" = false WHERE id = ${ids.machine}`;
      if (ids.station) await sql`UPDATE stations SET "isActive" = false WHERE id = ${ids.station}`;
      if (ids.line) await sql`UPDATE production_lines SET "isActive" = false WHERE id = ${ids.line}`;
      if (ids.workshop) await sql`UPDATE workshops SET "isActive" = false WHERE id = ${ids.workshop}`;
      if (ids.factory) await sql`UPDATE factories SET "isActive" = false WHERE id = ${ids.factory}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);

  it("inspectionTime=2026-09-03T20:00:00Z (UTC) ⇒ hour=3 factory-local (Asia/Ho_Chi_Minh), KHÔNG hour=20 UTC thô", async () => {
    const { stationAnalysisRouter } = await import("./stationAnalysisRouter");
    const caller = stationAnalysisRouter.createCaller(ctxAdmin);

    const rows = await caller.getHourlyYield({
      stationId: ids.station,
      // Cửa sổ 2 ngày UTC rộng rãi — Task 2 đã bỏ toFakeUtc, `startDate`/`endDate` so THẲNG
      // instant với cột (không dịch), nên không cần né giờ biên.
      startDate: new Date("2026-09-03T00:00:00.000Z"),
      endDate: new Date("2026-09-04T23:59:59.999Z"),
    });

    expect(
      rows,
      "0 hàng — hàng fixture không lọt cửa sổ (kiểm lại input.startDate/endDate so thẳng instant, BG-96 Task 2)",
    ).toHaveLength(1);
    expect(
      rows[0].hour,
      `nguyên văn hàng trả về: ${JSON.stringify(rows[0])} — 20 nghĩa là bucket đang đọc UTC thô, không qua factoryHourOfDaySql`,
    ).toBe(3);
    expect(rows[0].total).toBe(1);
  });
});

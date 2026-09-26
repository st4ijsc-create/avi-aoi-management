/**
 * ★★★ 2026-08-18 — NHÓM B #2 + #3. Lưới chạm **CSDL THẬT** cho bốn bề mặt OEE/War-Room.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO FILE NÀY BẮT BUỘC TỒN TẠI.
 *
 * Một MỆNH ĐỀ GIẢ không mang tham chiếu vòng, nên ca chạy trên `getDb` giả **không thể** phát
 * biểu được lỗi `Converting circular structure to JSON` — lỗi đã cho `dashboard.getStats` trả
 * 500 cho MỌI người dùng ngày 2026-08-17 sau một bản vá `tsc` sạch cả hai config + 220 ca xanh.
 * Cũng vậy, `Date` nhét vào truy vấn thô chỉ vỡ trên postgres.js thật (`ERR_INVALID_ARG_TYPE`),
 * và `= ANY(mảng JS)` chỉ vỡ trên Postgres thật (`42809`). Ba lớp lỗi ấy **vô hình với mock**.
 *
 * BỐN CHIỀU cho MỖI bề mặt:
 *   ÂM  — kỹ sư gán nhà máy A KHÔNG thấy nhà máy B.
 *   ÂM  — tài khoản 0 gán ⇒ 0 hàng **kèm LÝ DO** (câu chữ tránh cụm "không có dữ liệu").
 *   DƯƠNG — admin thấy TOÀN BỘ (chống vá quá tay).
 *   DƯƠNG — kỹ sư A vẫn thấy ĐỦ A, đúng CON SỐ đã dựng (chống vá quá tay theo chiều ngược).
 *
 * Dữ liệu dựng: hai nhà máy độc lập A/B, mỗi bên xưởng→chuyền→trạm→máy, kèm `daily_statistics`,
 * `machine_status_logs`, `downtime_events`, `production_orders`, `fact_inspection_hourly` và một
 * `shift_configs` riêng. Mốc thời gian đặt TRONG NGÀY HÔM NAY (War-Room chốt theo ngày hiện tại
 * nên không dùng được cửa sổ tương lai như các lưới khác), và mọi khẳng định là **theo MÃ máy /
 * TÊN chuyền của lượt chạy này** — không phải phép đếm toàn bảng — nên dữ liệu sẵn có trong CSDL
 * test không làm trôi kết quả.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getAllMachinesOEELive, getLineOEE, getLineTaktUtilization } from "./oeeService";
import { getWarRoomBriefing } from "./warRoomService";

const DB_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;

const FAC_A = `NB-FA-${RUN}`;
const FAC_B = `NB-FB-${RUN}`;
const MC_A = `NB-MC-A-${RUN}`;
const MC_B = `NB-MC-B-${RUN}`;
const LINE_A = `NB line A ${RUN}`;
const LINE_B = `NB line B ${RUN}`;
const SHIFT_CODE = `NB${RUN}`.slice(0, 20);
const SHIFT_NAME = `NB shift ${RUN}`;
/** Ca thuộc NHÀ MÁY B — làm cho cổng trên `shift_configs` QUAN SÁT ĐƯỢC từ đầu ra. */
const SHIFT_CODE_B = `NC${RUN}`.slice(0, 20);
const SHIFT_NAME_B = `NB shiftB ${RUN}`;
/** Ca THỨ HAI của nhà máy A — chỉ máy A2 (KHÔNG có ideal) sản xuất ⇒ làm cho cổng trên truy vấn
 *  `fact_inspection_hourly` theo MÁY×CA (tử số performance) quan sát được. */
const SHIFT_CODE_A2 = `ND${RUN}`.slice(0, 20);
const SHIFT_NAME_A2 = `NB shiftA2 ${RUN}`;
/** Ca TOÀN CỤC (`factoryId IS NULL`) — làm cho lối dừng-sớm của tài khoản 0 gán quan sát được. */
const SHIFT_CODE_G = `NE${RUN}`.slice(0, 20);
const SHIFT_NAME_G = `NB shiftG ${RUN}`;
const MC_A2 = `NB-MC-A2-${RUN}`;

/** Sản lượng dựng sẵn — mọi con số dưới đây suy ra từ đúng bốn hằng này. */
const A_TOTAL = 100, A_OK = 90, A_NG = 7, A_NTF = 3;
const B_TOTAL = 500, B_OK = 400, B_NG = 60, B_NTF = 40;
/** Sản lượng theo CA (fact_inspection_hourly) — cố ý KHÁC daily_statistics để không lẫn nguồn. */
const A_SHIFT_TOTAL = 11, B_SHIFT_TOTAL = 55;
const A2_SHIFT_TOTAL = 7;
/** Hàng `daily_statistics` của MÁY A nhưng mang NHÃN nhà máy B — xem chú thích ở chỗ dựng. */
const A_DRIFT_TOTAL = 1000;
const A_DOWNTIME_MIN = 30, B_DOWNTIME_MIN = 45;
const A_PLAN = 800, B_PLAN = 4000;

let sql: ReturnType<typeof postgres>;

const now = new Date();
const dayStart = (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; })();
/** Mốc NẰM TRONG ngày hôm nay và ≤ NOW (kể cả khi lượt chạy rơi vào ngay sau nửa đêm). */
const TS = new Date(Math.min(now.getTime() - 60_000, Math.max(dayStart.getTime() + 60_000, now.getTime() - 2 * 3600_000)));
const DT_END = new Date(TS.getTime() + A_DOWNTIME_MIN * 60_000);
const DT_END_B = new Date(TS.getTime() + B_DOWNTIME_MIN * 60_000);

const ids = {
  factoryA: 0, factoryB: 0, workshopA: 0, workshopB: 0,
  lineA: 0, lineB: 0, stationA: 0, stationB: 0, machineA: 0, machineB: 0,
  product: 0, shift: 0, shiftB: 0, shiftA2: 0, shiftG: 0, machineA2: 0,
  userAdmin: 0, userEngA: 0, userNoAssign: 0,
};

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* WORM / FK — có đường dọn thay thế */ }
}

const ADMIN = () => ({ userId: ids.userAdmin, userRole: "admin" });
const ENG_A = () => ({ userId: ids.userEngA, userRole: "engineer" });
const NO_ASSIGN = () => ({ userId: ids.userNoAssign, userRole: "supervisor" });

describe.skipIf(!DB_URL)("Nhóm B #2/#3 — phạm vi OEE + War-Room trên CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const mkHierarchy = async (facCode: string, tag: "A" | "B", lineName: string, mcCode: string) => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${facCode}, ${"NB factory " + tag}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${`NB-W-${tag}-${RUN}`}, 'NB workshop') RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w.id}, ${`NB-L-${tag}-${RUN}`}, ${lineName}, 100) RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${`NB-S-${tag}-${RUN}`}, 'NB station') RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${mcCode}, ${"NB machine " + tag}, 'AOI') RETURNING id`;
      return { factory: f.id as number, workshop: w.id as number, line: l.id as number, station: s.id as number, machine: m.id as number };
    };

    const A = await mkHierarchy(FAC_A, "A", LINE_A, MC_A);
    const B = await mkHierarchy(FAC_B, "B", LINE_B, MC_B);
    ids.factoryA = A.factory; ids.workshopA = A.workshop; ids.lineA = A.line; ids.stationA = A.station; ids.machineA = A.machine;
    ids.factoryB = B.factory; ids.workshopB = B.workshop; ids.lineB = B.line; ids.stationB = B.station; ids.machineB = B.machine;

    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${`NB-P-${RUN}`}, 'NB product') RETURNING id`;
    ids.product = p.id;

    // ── daily_statistics — nguồn của CẢ BA hàm oeeService. CÓ cột `factoryId` (đó là cả bản vá).
    const mkStats = async (machineId: number, factoryId: number, workshopId: number,
                           total: number, ok: number, ng: number, ntf: number) => {
      await sql`
        INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date,
          "totalCount", "okCount", "ngCount", "ntfCount", "avgCycleTime")
        VALUES (${machineId}, ${factoryId}, ${workshopId}, ${TS}, ${total}, ${ok}, ${ng}, ${ntf}, 12.5)`;
    };
    await mkStats(ids.machineA, ids.factoryA, ids.workshopA, A_TOTAL, A_OK, A_NG, A_NTF);
    await mkStats(ids.machineB, ids.factoryB, ids.workshopB, B_TOTAL, B_OK, B_NG, B_NTF);
    // ★★ HÀNG LỆCH NHÃN — máy A, nhưng hàng thống kê mang `factoryId` của nhà máy B.
    // `daily_statistics.factoryId` là cột PHI CHUẨN HOÁ (denormalized): một cỗ máy chuyển nhà máy
    // để lại đúng hình dạng này. Nó cũng là thứ làm cho cổng trên `daily_statistics` KHÔNG còn
    // thừa: nếu chỉ gác danh sách máy, hàng này vẫn chảy vào tổng của kỹ sư A. Luật ở đây là
    // NHÃN TRÊN HÀNG thắng: kỹ sư A thấy 100, admin thấy 1.100.
    await sql`
      INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date,
        "totalCount", "okCount", "ngCount", "ntfCount", "avgCycleTime")
      VALUES (${ids.machineA}, ${ids.factoryB}, ${ids.workshopB}, ${new Date(TS.getTime() - 60_000)},
              ${A_DRIFT_TOTAL}, ${A_DRIFT_TOTAL}, 0, 0, 12.5)`;

    // ★ Máy A2 — CÙNG trạm/chuyền/nhà máy A, cố ý KHÔNG có hàng `oee_metrics` (⇒ không có ideal)
    //   và KHÔNG có `daily_statistics`. Nó chỉ tồn tại để ca A2 có sản lượng mà tử số performance
    //   bằng 0 — xem ca "cổng theo MÁY×CA".
    const [m2] = await sql`INSERT INTO machines ("stationId", code, name, "machineType")
      VALUES (${ids.stationA}, ${MC_A2}, 'NB machine A2', 'AOI') RETURNING id`;
    ids.machineA2 = m2.id;

    // ── machine_status_logs — availability. KHÔNG có cột tenant ⇒ chỉ bị chặn gián tiếp qua
    //    danh sách máy (oeeService) hoặc JOIN workshops (War-Room shiftCompare); đó chính là lý
    //    do danh sách máy PHẢI bị gác, không chỉ sản lượng.
    // ★ Máy A **online**, máy B **offline** — cố ý. Nhờ vậy availability của ca là 100% khi chỉ
    //   thấy A và 50% khi thấy cả hai: cổng trên `machine_status_logs` trở nên QUAN SÁT ĐƯỢC từ
    //   đầu ra. Nếu cả hai cùng 'online' thì availability là 100% ở mọi trường hợp và một cổng bị
    //   gỡ sẽ KHÔNG làm lưới đỏ — lưới xanh vì lý do sai.
    await sql`INSERT INTO machine_status_logs ("machineId", status, timestamp) VALUES (${ids.machineA}, 'online', ${TS})`;
    await sql`INSERT INTO machine_status_logs ("machineId", status, timestamp) VALUES (${ids.machineB}, 'offline', ${TS})`;

    // ── oee_metrics — ideal cycle time.
    // ★ Cố ý đặt ideal = 86.400 s (một ngày): `performance = min(1, ideal × total / online)` khi
    //   ấy KẸP ở 1 với mọi cửa sổ trong ngày ⇒ OEE của ca chỉ còn phụ thuộc availability × quality,
    //   tức một hằng số TẤT ĐỊNH, không trôi theo giờ chạy lưới. Nhờ vậy `oee === 100` bên dưới
    //   là một khẳng định TUYỆT ĐỐI, không phải "xấp xỉ".
    for (const [mid, code] of [[ids.machineA, MC_A], [ids.machineB, MC_B]] as const) {
      await sql`
        INSERT INTO oee_metrics ("machineId", "machineCode", timestamp, availability, performance, quality, oee,
          "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
        VALUES (${mid}, ${code}, ${TS}, 9000, 8000, 9500, 6800, 480, 400, 86400, 100, 95, 5)`;
    }

    // ── downtime_events — panel topDowntime của War-Room (chặn qua JOIN workshops).
    await sql`INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime", "endTime", duration)
              VALUES (${ids.machineA}, ${MC_A}, 'breakdown', ${"NB reason A"}, ${TS}, ${DT_END}, ${A_DOWNTIME_MIN})`;
    await sql`INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime", "endTime", duration)
              VALUES (${ids.machineB}, ${MC_B}, 'breakdown', ${"NB reason B"}, ${TS}, ${DT_END_B}, ${B_DOWNTIME_MIN})`;

    // ── production_orders — panel planVsActual (CÓ cột `factoryId`).
    const mkOrder = async (tag: string, factoryId: number, workshopId: number, lineId: number, target: number) => {
      await sql`
        INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId",
          "productModelId", "targetQuantity", "plannedStartDate", "plannedEndDate")
        VALUES (${`NB-ORD-${tag}-${RUN}`}, 'NB', ${factoryId}, ${workshopId}, ${lineId}, ${ids.product},
                ${target}, ${dayStart}, ${new Date(dayStart.getTime() + 24 * 3600_000)})`;
    };
    await mkOrder("A", ids.factoryA, ids.workshopA, ids.lineA, A_PLAN);
    await mkOrder("B", ids.factoryB, ids.workshopB, ids.lineB, B_PLAN);

    // ── shift_configs + fact_inspection_hourly — panel shiftCompare (CÓ cột `factoryId`).
    //    Ca gán cho nhà máy A: admin và kỹ sư A đều thấy ĐỊNH NGHĨA ca; điều phải khác nhau là
    //    SỐ LIỆU trong ca — 11 (chỉ A) so với 66 (A+B).
    const [sh] = await sql`
      INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "orderIndex")
      VALUES (${ids.factoryA}, ${SHIFT_NAME}, ${SHIFT_CODE}, 0, 0, 23, 59, 0) RETURNING id`;
    ids.shift = sh.id;
    const [shB] = await sql`
      INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "orderIndex")
      VALUES (${ids.factoryB}, ${SHIFT_NAME_B}, ${SHIFT_CODE_B}, 0, 0, 23, 59, 0) RETURNING id`;
    ids.shiftB = shB.id;
    const [shA2] = await sql`
      INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "orderIndex")
      VALUES (${ids.factoryA}, ${SHIFT_NAME_A2}, ${SHIFT_CODE_A2}, 0, 0, 23, 59, 1) RETURNING id`;
    ids.shiftA2 = shA2.id;
    const [shG] = await sql`
      INSERT INTO shift_configs ("factoryId", name, code, "startHour", "startMinute", "endHour", "endMinute", "orderIndex")
      VALUES (NULL, ${SHIFT_NAME_G}, ${SHIFT_CODE_G}, 0, 0, 23, 59, 2) RETURNING id`;
    ids.shiftG = shG.id;
    const mkFactIn = async (shiftCode: string, machineId: number, factoryId: number, total: number) => {
      await sql`
        INSERT INTO fact_inspection_hourly ("bucketHour", "factoryId", "machineId", "productModelId",
          "shiftCode", "totalCount", "okCount", "ngCount", "ntfCount")
        VALUES (${TS}, ${factoryId}, ${machineId}, ${ids.product}, ${shiftCode}, ${total},
                ${total}, 0, 0)`;
    };
    const mkFact = (machineId: number, factoryId: number, total: number) =>
      mkFactIn(SHIFT_CODE, machineId, factoryId, total);
    await mkFact(ids.machineA, ids.factoryA, A_SHIFT_TOTAL);
    await mkFact(ids.machineB, ids.factoryB, B_SHIFT_TOTAL);
    // Ca A2: chỉ máy A2 (nhà máy A, KHÔNG ideal) và máy B (nhà máy B, CÓ ideal) sản xuất.
    await mkFactIn(SHIFT_CODE_A2, ids.machineA2, ids.factoryA, A2_SHIFT_TOTAL);
    await mkFactIn(SHIFT_CODE_A2, ids.machineB, ids.factoryB, B_SHIFT_TOTAL);

    // ── Ba tài khoản người XEM.
    const mkUser = async (username: string, role: string) => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`nb-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r.id as number;
    };
    ids.userAdmin = await mkUser(`nb-admin-${RUN}`, "admin");
    ids.userEngA = await mkUser(`nb-eng-a-${RUN}`, "engineer");
    ids.userNoAssign = await mkUser(`nb-noassign-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.userEngA}, ${FAC_A})`;
  }, 180_000);

  afterAll(async () => {
    try {
      const machines = [ids.machineA, ids.machineB, ids.machineA2].filter(Boolean);
      const users = [ids.userAdmin, ids.userEngA, ids.userNoAssign].filter(Boolean);
      if (users.length) await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
      if (machines.length) {
        await safe(() => sql`DELETE FROM fact_inspection_hourly WHERE "machineId" IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM downtime_events WHERE "machineId" IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM oee_metrics WHERE "machineId" IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM machine_status_logs WHERE "machineId" IN ${sql(machines)}`);
        await safe(() => sql`DELETE FROM daily_statistics WHERE "machineId" IN ${sql(machines)}`);
      }
      const shifts = [ids.shift, ids.shiftB, ids.shiftA2, ids.shiftG].filter(Boolean);
      if (shifts.length) await safe(() => sql`DELETE FROM shift_configs WHERE id IN ${sql(shifts)}`);
      await safe(() => sql`DELETE FROM production_orders WHERE "orderCode" LIKE ${`NB-ORD-%${RUN}`}`);
      if (machines.length) {
        // Máy được TẮT trước khi xoá: nếu FK nào đó giữ lại, lượt chạy sau vẫn không nhặt phải.
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

  // ══ 1. getAllMachinesOEELive — nền của `mqttClient.getAllOEE` ═══════════════════════════════
  describe("getAllMachinesOEELive", () => {
    it("ÂM: kỹ sư gán A thấy máy A, KHÔNG thấy máy B", async () => {
      const rows = await getAllMachinesOEELive(ENG_A());
      const codes = rows.map((r) => r.machineCode);
      expect(codes).toContain(MC_A);
      expect(codes).not.toContain(MC_B);
      expect(rows.scopeApplied).toBe(true);
      expect(rows.scopeEmptyReason).toBeNull();
    });

    it("DƯƠNG: kỹ sư A vẫn thấy ĐỦ số của A (chống vá quá tay)", async () => {
      const rows = await getAllMachinesOEELive(ENG_A());
      const a = rows.find((r) => r.machineCode === MC_A);
      expect(a).toBeDefined();
      // ★ 100, KHÔNG phải 1.100: hàng `daily_statistics` của chính máy A nhưng mang nhãn nhà
      //   máy B bị loại. Đây là ca làm cho cổng trên `daily_statistics` KHÔNG thừa.
      expect(a!.details.totalCount).toBe(A_TOTAL);
      expect(a!.details.goodCount).toBe(A_OK + A_NTF);
      expect(a!.details.rejectCount).toBe(A_NG);
      // Quality = (ok+ntf)/total = 93/100 → 93.00 (pct ×100, làm tròn 2 chữ số).
      expect(a!.quality).toBeCloseTo(93, 5);
    });

    it("DƯƠNG: admin thấy CẢ HAI nhà máy", async () => {
      const rows = await getAllMachinesOEELive(ADMIN());
      const codes = rows.map((r) => r.machineCode);
      expect(codes).toContain(MC_A);
      expect(codes).toContain(MC_B);
      expect(rows.scopeApplied).toBe(false);
      const b = rows.find((r) => r.machineCode === MC_B);
      expect(b!.details.totalCount).toBe(B_TOTAL);
      // ĐỐI CHỨNG cho ca trên: hàng lệch nhãn CÓ TỒN TẠI và admin THẤY nó (100 + 1.000).
      expect(rows.find((r) => r.machineCode === MC_A)!.details.totalCount).toBe(A_TOTAL + A_DRIFT_TOTAL);
    });

    it("ÂM: 0 gán nhà máy ⇒ 0 hàng + LÝ DO 'chưa được gán nhà máy'", async () => {
      const rows = await getAllMachinesOEELive(NO_ASSIGN());
      expect(rows).toHaveLength(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
      expect(rows.scopeMessage).toMatch(/chưa được gán nhà máy/);
      // ⚠ Câu chữ KHÔNG được chứa cụm "không có dữ liệu" — kể cả trong vế phủ định.
      expect(rows.scopeMessage).not.toMatch(/không có dữ liệu/i);
    });

    it("lối đi KHÔNG mang danh tính (tác vụ nền) vẫn thấy tất cả — hành vi cũ giữ nguyên", async () => {
      const rows = await getAllMachinesOEELive();
      const codes = rows.map((r) => r.machineCode);
      expect(codes).toContain(MC_A);
      expect(codes).toContain(MC_B);
    });
  });

  // ══ 2. getLineOEE ══════════════════════════════════════════════════════════════════════════
  describe("getLineOEE", () => {
    const window = () => ({ from: dayStart, to: new Date(now.getTime() + 60_000) });

    it("ÂM: kỹ sư A thấy chuyền A, KHÔNG thấy chuyền B", async () => {
      const rows = await getLineOEE({ ...window(), ...ENG_A() });
      const names = rows.map((r) => r.lineName);
      expect(names).toContain(LINE_A);
      expect(names).not.toContain(LINE_B);
    });

    it("DƯƠNG: kỹ sư A vẫn thấy ĐÚNG sản lượng chuyền A", async () => {
      const rows = await getLineOEE({ ...window(), ...ENG_A() });
      const a = rows.find((r) => r.lineName === LINE_A)!;
      expect(a.details.totalCount).toBe(A_TOTAL);   // KHÔNG gồm hàng lệch nhãn 1.000
      expect(a.details.rejectCount).toBe(A_NG);
    });

    it("DƯƠNG: admin thấy cả hai chuyền, chuyền B đúng số của B", async () => {
      const rows = await getLineOEE({ ...window(), ...ADMIN() });
      const names = rows.map((r) => r.lineName);
      expect(names).toContain(LINE_A);
      expect(names).toContain(LINE_B);
      expect(rows.find((r) => r.lineName === LINE_B)!.details.totalCount).toBe(B_TOTAL);
      expect(rows.find((r) => r.lineName === LINE_A)!.details.totalCount).toBe(A_TOTAL + A_DRIFT_TOTAL);
    });

    it("ÂM: 0 gán ⇒ 0 chuyền + lý do", async () => {
      const rows = await getLineOEE({ ...window(), ...NO_ASSIGN() });
      expect(rows).toHaveLength(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
      expect(rows.scopeMessage).toMatch(/chưa được gán nhà máy/);
    });

    it("ÂM: kỹ sư A chọn factoryId của B ⇒ GIAO rỗng, KHÔNG mở quyền", async () => {
      const rows = await getLineOEE({ ...window(), factoryId: ids.factoryB, ...ENG_A() });
      expect(rows).toHaveLength(0);
    });
  });

  // ══ 3. getLineTaktUtilization ══════════════════════════════════════════════════════════════
  describe("getLineTaktUtilization", () => {
    const window = () => ({ from: dayStart, to: new Date(now.getTime() + 60_000) });

    it("ÂM: kỹ sư A thấy chuyền A, KHÔNG thấy chuyền B", async () => {
      const rows = await getLineTaktUtilization({ ...window(), ...ENG_A() });
      const names = rows.map((r) => r.lineName);
      expect(names).toContain(LINE_A);
      expect(names).not.toContain(LINE_B);
    });

    it("DƯƠNG: sản lượng chuyền A đúng bằng dữ liệu dựng", async () => {
      const rows = await getLineTaktUtilization({ ...window(), ...ENG_A() });
      expect(rows.find((r) => r.lineName === LINE_A)!.producedUnits).toBe(A_TOTAL);
    });

    it("DƯƠNG: admin thấy CẢ hàng lệch nhãn của chuyền A (đối chứng cho ca trên)", async () => {
      const rows = await getLineTaktUtilization({ ...window(), ...ADMIN() });
      expect(rows.find((r) => r.lineName === LINE_A)!.producedUnits).toBe(A_TOTAL + A_DRIFT_TOTAL);
    });

    it("DƯƠNG: admin thấy cả hai", async () => {
      const rows = await getLineTaktUtilization({ ...window(), ...ADMIN() });
      const names = rows.map((r) => r.lineName);
      expect(names).toContain(LINE_A);
      expect(names).toContain(LINE_B);
    });

    it("ÂM: 0 gán ⇒ 0 chuyền + lý do", async () => {
      const rows = await getLineTaktUtilization({ ...window(), ...NO_ASSIGN() });
      expect(rows).toHaveLength(0);
      expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
    });
  });

  // ══ 4. getWarRoomBriefing — BỐN PANEL trong MỘT đáp ứng ════════════════════════════════════
  describe("getWarRoomBriefing — 4 panel", () => {
    const today = () => dayStart.toISOString();

    it("ÂM: kỹ sư A — CẢ BỐN panel đều không có dấu vết nhà máy B", async () => {
      const b = await getWarRoomBriefing({ date: today(), ...ENG_A() });

      // panel 1 — lineOee
      expect(b.lines.map((l) => l.lineName)).toContain(LINE_A);
      expect(b.lines.map((l) => l.lineName)).not.toContain(LINE_B);
      // panel 2 — planVsActual
      expect(b.planVsActual.map((p) => p.lineName)).toContain(LINE_A);
      expect(b.planVsActual.map((p) => p.lineName)).not.toContain(LINE_B);
      // panel 3 — topDowntime (nằm trong từng dòng line)
      const dtCodes = b.lines.flatMap((l) => l.topDowntime.map((d) => d.machineCode));
      expect(dtCodes).toContain(MC_A);
      expect(dtCodes).not.toContain(MC_B);
      // panel 4 — shiftCompare
      const shift = b.shiftCompare.find((s) => s.shiftLabel === SHIFT_NAME);
      expect(shift).toBeDefined();
      expect(shift!.output).toBe(A_SHIFT_TOTAL);
      // ĐỊNH NGHĨA ca của nhà máy B cũng không được lọt (cổng trên `shift_configs`).
      expect(b.shiftCompare.map((s) => s.shiftLabel)).not.toContain(SHIFT_NAME_B);
    });

    it("DƯƠNG+ÂM: availability của ca chỉ tính máy trong phạm vi (cổng machine_status_logs)", async () => {
      // Máy A online cả cửa sổ, máy B offline cả cửa sổ. Kỹ sư A ⇒ availability = 100%;
      // performance kẹp ở 1 (ideal = 86.400 s) và quality = 1 (11/11 OK) ⇒ **oee = 100 chẵn**.
      // Gỡ cổng trên `machine_status_logs` ⇒ thời gian offline của máy B (và của mọi máy nhà máy
      // khác trong CSDL test) chảy vào mẫu số ⇒ con số này KHÔNG còn là 100.
      const b = await getWarRoomBriefing({ date: today(), ...ENG_A() });
      const shift = b.shiftCompare.find((s) => s.shiftLabel === SHIFT_NAME)!;
      expect(shift.oee).toBe(100);
      expect(shift.ngRate).toBe(0);
    });

    it("ÂM: tử số performance của ca chỉ lấy máy trong phạm vi (cổng theo MÁY×CA)", async () => {
      // Ca A2: bên nhà máy A chỉ có máy A2 sản xuất, và A2 KHÔNG có ideal cycle ⇒ tử số Σ(ideal×
      // total) = 0 ⇒ performance null ⇒ **oee null** (trung thực: thiếu đầu vào, không bịa số).
      // Gỡ cổng trên truy vấn MÁY×CA ⇒ máy B (ideal 86.400 s) chảy vào tử số ⇒ performance kẹp
      // ở 1 và oee hoá thành một con số — số ấy được dựng từ dữ liệu nhà máy KHÁC.
      const b = await getWarRoomBriefing({ date: today(), ...ENG_A() });
      const s2 = b.shiftCompare.find((s) => s.shiftLabel === SHIFT_NAME_A2)!;
      expect(s2).toBeDefined();
      expect(s2.output).toBe(A2_SHIFT_TOTAL);   // sản lượng vẫn ĐÚNG và KHÔNG gồm 55 của B
      expect(s2.oee).toBeNull();
    });

    it("DƯƠNG: kỹ sư A vẫn thấy ĐỦ số của A trên cả bốn panel", async () => {
      const b = await getWarRoomBriefing({ date: today(), ...ENG_A() });
      const lineA = b.lines.find((l) => l.lineName === LINE_A)!;
      expect(lineA.output).toBe(A_TOTAL);       // KHÔNG gồm hàng lệch nhãn 1.000
      expect(lineA.planTarget).toBe(A_PLAN);
      expect(lineA.ngRate).toBeCloseTo((A_NG / A_TOTAL) * 100, 5);
      expect(lineA.topDowntime.find((d) => d.machineCode === MC_A)!.minutes).toBe(A_DOWNTIME_MIN);
      expect(b.planVsActual.find((p) => p.lineName === LINE_A)!.actual).toBe(A_TOTAL);
      expect(b.scopeApplied).toBe(true);
      expect(b.scopeEmptyReason).toBeNull();
    });

    it("DƯƠNG: admin thấy CẢ HAI nhà máy trên cả bốn panel", async () => {
      const b = await getWarRoomBriefing({ date: today(), ...ADMIN() });
      expect(b.lines.map((l) => l.lineName)).toEqual(expect.arrayContaining([LINE_A, LINE_B]));
      expect(b.planVsActual.map((p) => p.lineName)).toEqual(expect.arrayContaining([LINE_A, LINE_B]));
      const dtCodes = b.lines.flatMap((l) => l.topDowntime.map((d) => d.machineCode));
      expect(dtCodes).toEqual(expect.arrayContaining([MC_A, MC_B]));
      expect(b.shiftCompare.find((s) => s.shiftLabel === SHIFT_NAME)!.output).toBe(A_SHIFT_TOTAL + B_SHIFT_TOTAL);
      // Admin thấy CẢ định nghĩa ca của nhà máy B (chống vá quá tay ở cổng `shift_configs`).
      expect(b.shiftCompare.map((s) => s.shiftLabel)).toContain(SHIFT_NAME_B);
      expect(b.lines.find((l) => l.lineName === LINE_A)!.output).toBe(A_TOTAL + A_DRIFT_TOTAL);
      expect(b.scopeApplied).toBe(false);
    });

    it("ÂM: 0 gán ⇒ BỐN panel rỗng + LÝ DO (không phải 'không có dữ liệu')", async () => {
      const b = await getWarRoomBriefing({ date: today(), ...NO_ASSIGN() });
      expect(b.lines).toEqual([]);
      expect(b.planVsActual).toEqual([]);
      // ⚠ `shift_configs` có hàng TOÀN CỤC (`factoryId IS NULL`) — dựng sẵn một hàng như thế
      // trong lưới này. Nếu bỏ lối dừng-sớm cho phạm vi rỗng, lưới ca toàn cục sẽ hiện đầy đủ
      // với sản lượng 0, tức đúng câu "dây chuyền đang ngừng" mà bản vá đi xoá.
      expect(b.shiftCompare).toEqual([]);
      expect(b.scopeEmptyReason).toBe("no_factory_assignment");
      expect(b.scopeMessage).toMatch(/chưa được gán nhà máy/);
      expect(b.scopeMessage).not.toMatch(/không có dữ liệu/i);
    });

    it("★ đáp ứng LUÔN tuần tự hoá được — `filter` (tham chiếu vòng) không có đường lọt ra", async () => {
      for (const actor of [ENG_A(), ADMIN(), NO_ASSIGN()]) {
        const b = await getWarRoomBriefing({ date: today(), ...actor });
        expect(Object.keys(b)).not.toContain("filter");
        expect(() => JSON.stringify(b)).not.toThrow();
      }
    });
  });
});

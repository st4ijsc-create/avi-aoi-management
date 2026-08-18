/**
 * ★★★ 2026-08-18 — DẢI KPI `commandCenter.kpiSummary`: BỐN Ô CÒN LẠI trên CSDL THẬT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Lượt trước chỉ thu hẹp ô `alarms` (lưới ở `commandCenterAlertScope.db.test.ts`). File này
 * canh bốn nguồn còn lại — mỗi ô một bảng khác, một luật nối khác:
 *   `oee`   ← oeeService.getAllMachinesOEELive (+ tầng dự phòng `oee_metrics`)
 *   `wip`   ← wip_tracking
 *   `fleet` ← tasks + robots
 *   `sites` ← site_kpi_rollup   ← **KHÔNG vá được**, ca này canh chính LỜI KHAI ấy.
 *
 * **Vì sao BẮT BUỘC chạm CSDL thật.** Ba cổng mới là SQL thô lồng nhiều tầng truy vấn phụ
 * (`tasks → robots → production_lines → workshops`; `tasks → production_orders → …`). Lưới
 * giả lập `getDb` KHÔNG phát biểu được `42P01`/`42809`/sai tên cột — chỉ Postgres nói được.
 *
 * **Vì sao dựng HAI nhà máy riêng.** `aoi_management` có 3 nhà máy nhưng mọi chuyền/máy/WIP
 * đều thuộc factory 1, và chỉ tồn tại một bản gán (`SIM-FAC`). Ở đó một engineer = **không
 * bị lọc bởi dữ liệu** = chiều DƯƠNG. Chiều ÂM (A không thấy số của B) **không đo được** ở
 * đó; báo cáo một lượt dương thành "bằng chứng chặn" là đúng lớp lỗi thước-xanh-giả.
 *
 * **HÌNH DẠNG BẮT BUỘC — hàng KHÔNG NỐI ĐƯỢC và hàng NÓI DỐI.** Hai nhóm, cả hai đều phải
 * fail-closed với người bị thu hẹp và phải VẪN hiện với admin:
 *   (a) MỒ CÔI  — mọi cột liên kết NULL, hoặc trỏ vào hàng đã biến mất (không bảng nào
 *       trong bốn bảng này có khoá ngoại trên cột liên kết — đã kiểm `pg_constraint`);
 *   (b) NÓI DỐI — `tasks."factoryId"` ghi nhà máy A trong khi robot được gán thuộc nhà máy
 *       B. Nếu cổng đọc cột ghi rời thay vì đi theo liên kết, hàng này lọt sang A. Đây
 *       chính là lớp lỗi "hàng mang `factoryId` của nhà máy KHÁC" đã cắn tuần này, và nó
 *       KHÔNG có cách nào lộ ra nếu dữ liệu dựng sẵn luôn nhất quán.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { SITES_UNRESOLVABLE_SOURCE } from "../services/ecosystem/commandCenterService";

// Cùng lý do như `commandCenterAlertScope.db.test.ts`: ca đầu gánh lượt mở kết nối Postgres
// đầu tiên + đồ thị nhập của `commandCenterRouter` (twin/sceneGraph · oeeService · toàn bộ
// schema drizzle). 5.000 ms mặc định KHÔNG đủ, và một lượt đỏ vì hết giờ không nói gì về
// phạm vi — nó chỉ là tiếng ồn che mất tín hiệu thật.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `k5_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC_A = `K5FA_${RUN}`.slice(0, 50);
const FAC_B = `K5FB_${RUN}`.slice(0, 50);

// userId tổng hợp — không có khoá ngoại từ `user_factory_assignments`/`permissions` sang
// `users`, nên gieo được mà không chạm bảng `users` mà lượt khác đang dùng.
const U_ADMIN = 951001;
const U_A = 951002;
const U_B = 951003;
const U_NONE = 951004;
const ALL_USERS = [U_ADMIN, U_A, U_B, U_NONE];

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0,
  wsA: 0, wsB: 0,
  lineA: 0, lineB: 0,
  stA: 0, stB: 0,
  machA: 0, machB: 0,
  robotA: 0, robotAStation: 0, robotB: 0, robotOrphan: 0,
  woB: 0,
};

/** Tuyến/trạm/máy KHÔNG tồn tại — dùng cho hàng mồ côi dạng "trỏ vào hàng đã biến mất". */
const GONE_LINE = 2_000_100_001;
const GONE_STATION = 2_000_100_002;
const GONE_MACHINE = 2_000_100_003;
const GONE_ROBOT = 2_000_100_004;

describe.skipIf(!DB_URL)("dải KPI — bốn nguồn còn lại trên CSDL THẬT (oee · wip · fleet · sites)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    // ── Phân cấp: hai nhà máy độc lập ────────────────────────────────────────
    ids.facA = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"K5 " + FAC_A}, true) RETURNING id`);
    ids.facB = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"K5 " + FAC_B}, true) RETURNING id`);
    ids.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${FAC_A + "_WS"}, 'wsA') RETURNING id`);
    ids.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facB}, ${FAC_B + "_WS"}, 'wsB') RETURNING id`);
    ids.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsA}, ${FAC_A + "_L1"}, 'lineA') RETURNING id`);
    ids.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsB}, ${FAC_B + "_L1"}, 'lineB') RETURNING id`);
    ids.stA = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineA}, ${FAC_A + "_S1"}, 'stA') RETURNING id`);
    ids.stB = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineB}, ${FAC_B + "_S1"}, 'stB') RETURNING id`);
    ids.machA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stA}, ${FAC_A + "_M1"}, 'machA', 'AOI', true) RETURNING id`);
    ids.machB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stB}, ${FAC_B + "_M1"}, 'machB', 'AOI', true) RETURNING id`);

    // ── Ô `oee` ──────────────────────────────────────────────────────────────
    // Ba nguồn của `getAllMachinesOEELive`, gieo sao cho A và B ra HAI CON SỐ KHÁC HẲN nhau
    // và cả ba yếu tố đều phân giải được (nếu một yếu tố null thì `oee` null và luồng rơi
    // xuống TẦNG DỰ PHÒNG `oee_metrics` — ca sẽ nói về một đường khác đường mình định đo).
    //   machA: online suốt 2h            ⇒ A = 100%
    //   machB: online 1h rồi offline 1h  ⇒ A = 50%
    await sql`INSERT INTO machine_status_logs ("machineId", status, "timestamp") VALUES (${ids.machA}, 'online', NOW() - interval '2 hours')`;
    await sql`INSERT INTO machine_status_logs ("machineId", status, "timestamp") VALUES (${ids.machB}, 'online', NOW() - interval '2 hours')`;
    await sql`INSERT INTO machine_status_logs ("machineId", status, "timestamp") VALUES (${ids.machB}, 'offline', NOW() - interval '1 hour')`;
    //   machA: 100/100 tốt ⇒ Q = 100% · machB: 50/100 ⇒ Q = 50%
    await sql`INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount")
              VALUES (${ids.machA}, ${ids.facA}, ${ids.wsA}, NOW() - interval '1 hour', 100, 100, 0, 0)`;
    await sql`INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", "date", "totalCount", "okCount", "ngCount", "ntfCount")
              VALUES (${ids.machB}, ${ids.facB}, ${ids.wsB}, NOW() - interval '1 hour', 100, 50, 50, 0)`;
    //   `idealCycleTime` (giây) đọc lại từ `oee_metrics` ⇒ P = min(1, ideal×total/online).
    //   machA: 36×100/7200 = 0,5 · machB: 18×100/3600 = 0,5 ⇒ P = 50% cho cả hai.
    const mkOeeMetric = (machineId: number, code: string, ideal: number) =>
      sql`INSERT INTO oee_metrics ("machineId", "machineCode", "timestamp", availability, performance, quality, oee,
                                   "plannedTime", "runTime", "idealCycleTime", "totalCount", "goodCount", "rejectCount")
          VALUES (${machineId}, ${code}, NOW() - interval '3 hours', 0, 0, 0, 0, 0, 0, ${ideal}, 0, 0, 0)`;
    await mkOeeMetric(ids.machA, FAC_A + "_M1", 36);
    await mkOeeMetric(ids.machB, FAC_B + "_M1", 18);

    // ── Ô `wip` ──────────────────────────────────────────────────────────────
    // 3 hàng cho A · 5 cho B · 2 hàng KHÔNG NỐI ĐƯỢC (chỉ admin thấy).
    const mkWip = (tag: string, lineId: number | null, stationId: number | null, machineId: number | null) =>
      sql`INSERT INTO wip_tracking ("serialNumber", "lineId", "currentStationId", "currentMachineId", status, quantity)
          VALUES (${tag}, ${lineId}, ${stationId}, ${machineId}, 'in_process', 1)`;
    // ⚠ Ba hàng của A cố ý dùng BA hình dạng liên kết KHÁC NHAU (đủ ba cột · chỉ trạm · chỉ
    // máy). Nếu cả ba đều "đủ ba cột" thì bỏ bớt một nhánh của cổng vẫn ra đúng 3 — tức là
    // hai phần ba vị từ KHÔNG được lưới nào canh, và một lượt "vá quá tay thành chặn nhầm"
    // sẽ đi lọt. Với hình dạng này, mỗi nhánh đều gánh đúng một hàng.
    await mkWip(`${RUN}_WIPA0`, ids.lineA, ids.stA, ids.machA);
    await mkWip(`${RUN}_WIPA1`, null, ids.stA, null);
    await mkWip(`${RUN}_WIPA2`, null, null, ids.machA);
    for (let i = 0; i < 5; i++) await mkWip(`${RUN}_WIPB${i}`, ids.lineB, ids.stB, ids.machB);
    await mkWip(`${RUN}_WIPORPH_NULL`, null, null, null);
    await mkWip(`${RUN}_WIPORPH_GONE`, GONE_LINE, GONE_STATION, GONE_MACHINE);

    // ── Ô `fleet` — robots ───────────────────────────────────────────────────
    const mkRobot = (code: string, lineId: number | null, stationId: number | null, status: string) =>
      one(sql`INSERT INTO robots (code, name, vendor, endpoint, status, "lineId", "stationId")
              VALUES (${code}, ${code}, 'sim', 'tcp://127.0.0.1:1', ${status}, ${lineId}, ${stationId}) RETURNING id`);
    // Cùng lý do như WIP: A có MỘT robot nối qua `lineId` và MỘT nối qua `stationId`, nên
    // mỗi nhánh của `robotFactoryGate` đều gánh đúng một hàng.
    ids.robotA = await mkRobot(`${RUN}_RA`, ids.lineA, null, "online");
    ids.robotAStation = await mkRobot(`${RUN}_RA2`, null, ids.stA, "online");
    ids.robotB = await mkRobot(`${RUN}_RB`, ids.lineB, ids.stB, "online");
    ids.robotOrphan = await mkRobot(`${RUN}_RORPH`, null, null, "online");

    // ── Ô `fleet` — tasks ────────────────────────────────────────────────────
    // Một lệnh sản xuất trên tuyến của B, nhưng cột `factoryId` của nó ghi nhà máy A: cổng
    // phải đi theo `lineId`, không theo cột rời.
    ids.woB = await one(sql`INSERT INTO production_orders ("orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity")
                            VALUES (${RUN + "_WOB"}, 'K5', ${ids.facA}, ${ids.wsB}, ${ids.lineB}, 1, 10) RETURNING id`);
    const mkTask = (key: string, status: string, deviceId: number | null, kind: string | null, woId: number | null, factoryId: number | null) =>
      sql`INSERT INTO tasks ("taskKey", "requiredCapability", status, "assignedDeviceId", "assignedDeviceKind", "sourceWorkOrderId", "factoryId")
          VALUES (${key}, 'pick', ${status}, ${deviceId}, ${kind}, ${woId}, ${factoryId})`;
    // A: 2 pending (một qua robot, một qua cột `factoryId` khi CẢ HAI liên kết đều NULL), 0 running.
    await mkTask(`${RUN}_TA_ROBOT`, "pending", ids.robotA, "robot", null, null);
    await mkTask(`${RUN}_TA_LOOSE`, "pending", null, null, null, ids.facA);
    // B: 0 pending, 3 running — trong đó HAI hàng NÓI DỐI (`factoryId` = A).
    await mkTask(`${RUN}_TB_ROBOT`, "running", ids.robotB, "robot", null, ids.facB);
    await mkTask(`${RUN}_TB_LIE_DEVICE`, "running", ids.robotB, "robot", null, ids.facA);
    await mkTask(`${RUN}_TB_LIE_WO`, "running", null, null, ids.woB, ids.facA);
    // Không nối được: không thiết bị, không lệnh, không nhà máy ⇒ chỉ admin.
    await mkTask(`${RUN}_TORPH_NULL`, "pending", null, null, null, null);
    // Không nối được kiểu tinh vi hơn: có `assignedDeviceId` nhưng robot đã biến mất, và
    // `factoryId` ghi A. Nếu cổng tụt xuống đọc cột rời thì hàng này lọt sang A.
    await mkTask(`${RUN}_TORPH_GONEROBOT`, "pending", GONE_ROBOT, "robot", null, ids.facA);

    // ── Bản gán + quyền THẬT (đúng đường một lượt HTTP thật đi) ──────────────
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_A}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_B}, ${FAC_B})`;
    // U_NONE: CỐ Ý không có dòng nào — đó là hình dạng "0 gán".
    for (const uid of ALL_USERS) {
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView")
                VALUES (${uid}, 'machine_monitoring', 'machine_status', true)`;
    }
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM tasks WHERE "taskKey" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM production_orders WHERE "orderCode" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM robots WHERE code LIKE ${RUN + "%"}`;
    await sql`DELETE FROM wip_tracking WHERE "serialNumber" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM oee_metrics WHERE "machineId" IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM daily_statistics WHERE "machineId" IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM machine_status_logs WHERE "machineId" IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM machines WHERE id IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM stations WHERE id IN ${sql([ids.stA, ids.stB])}`;
    await sql`DELETE FROM production_lines WHERE id IN ${sql([ids.lineA, ids.lineB])}`;
    await sql`DELETE FROM workshops WHERE id IN ${sql([ids.wsA, ids.wsB])}`;
    await sql`DELETE FROM factories WHERE id IN ${sql([ids.facA, ids.facB])}`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql.end();
  });

  const kpi = async (userId: number, role: string) =>
    (await import("./commandCenterRouter")).commandCenterRouter.createCaller(ctxFor(userId, role)).kpiSummary({});

  // ══════════════════════════════════════════════════════════════════════════
  // Ô `oee` — nguồn `oeeService.getAllMachinesOEELive`
  // ══════════════════════════════════════════════════════════════════════════

  it("oee — DƯƠNG A (đúng số của MÌNH) + ÂM (máy của B không kéo trung bình của A)", async () => {
    const a = await kpi(U_A, "engineer");
    expect(a.oee.available).toBe(true);
    // machA một mình: A=100% · P=min(1, 36×100/7200)=50% · Q=100% ⇒ OEE=50%.
    // Con số này ĐỒNG THỜI là chiều dương (A thấy đủ máy của A) và chiều âm: nếu machB
    // (A=50, Q=50) lọt vào mẫu thì trung bình phải là 75/50/75 — không thể vẫn là 100/50/100.
    expect(a.oee.value).toEqual({ a: 100, p: 50, q: 100, oee: 50 });
  });

  it("oee — ÂM đối xứng: B ra con số của RIÊNG B (chứng minh không phải 'A tình cờ luôn thắng')", async () => {
    const b = await kpi(U_B, "engineer");
    expect(b.oee.available).toBe(true);
    // machB: A=50% (online 1h/2h) · P=min(1, 18×100/3600)=50% · Q=50% ⇒ OEE=12,5%.
    expect(b.oee.value).toEqual({ a: 50, p: 50, q: 50, oee: 12.5 });
  });

  it("oee — DƯƠNG admin: mẫu của admin KHÔNG bằng mẫu của A cũng không bằng của B", async () => {
    const [adm, a, b] = await Promise.all([kpi(U_ADMIN, "admin"), kpi(U_A, "engineer"), kpi(U_B, "engineer")]);
    expect(adm.oee.available).toBe(true);
    expect(adm.scopeApplied).toBe(false);
    // ⚠ KHÔNG khẳng định một giá trị CHÍNH XÁC cho admin: ô này là TRUNG BÌNH, mà trung
    // bình không đơn điệu theo tập cha — một bộ lưới khác gieo thêm máy có số liệu sẽ dời
    // nó. Cái nói được chắc chắn: mẫu của admin là tập THẬT SỰ LỚN HƠN cả hai, nên giá trị
    // của nó không trùng bên nào (ở đây trung bình của {50; 12,5} = 31,25).
    expect(adm.oee.value!.oee).not.toBe(a.oee.value!.oee);
    expect(adm.oee.value!.oee).not.toBe(b.oee.value!.oee);
    expect(adm.oee.value!.oee!).toBeGreaterThan(0);
  });

  it("oee — ÂM 0-gán: KHÔNG được bịa 0% (0% OEE là một LỜI KHAI về xưởng), phải là null trung thực + lý do", async () => {
    const r = await kpi(U_NONE, "supervisor");
    expect(r.oee.available).toBe(false);
    expect(r.oee.value).toBeNull();
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Ô `wip` — nguồn `wip_tracking` (KHÔNG có cột tenant nào)
  // ══════════════════════════════════════════════════════════════════════════

  it("wip — ÂM + DƯƠNG: A đếm ĐÚNG 3 của A, B đếm ĐÚNG 5 của B, hai hàng không-nối-được KHÔNG lọt sang ai", async () => {
    const [a, b] = await Promise.all([kpi(U_A, "engineer"), kpi(U_B, "engineer")]);
    expect(a.wip.value).toEqual({ count: 3, bottleneck: null });
    expect(b.wip.value).toEqual({ count: 5, bottleneck: null });
  });

  it("wip — DƯƠNG admin: đếm ĐỦ 3 + 5 + 2 hàng không-nối-được", async () => {
    const [adm, a, b] = await Promise.all([kpi(U_ADMIN, "admin"), kpi(U_A, "engineer"), kpi(U_B, "engineer")]);
    expect(adm.wip.available).toBe(true);
    expect(adm.wip.value!.count).toBeGreaterThanOrEqual(a.wip.value!.count + b.wip.value!.count + 2);
  });

  it("wip — ÂM 0-gán: 0 KÈM lý do (một dải KPI toàn 0 không được trông giống ca trực yên tĩnh)", async () => {
    const r = await kpi(U_NONE, "supervisor");
    expect(r.wip.value).toEqual({ count: 0, bottleneck: null });
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Ô `fleet` — nguồn `tasks` + `robots`
  // ══════════════════════════════════════════════════════════════════════════

  it("fleet — ÂM + DƯƠNG: A thấy 2 pending / 0 running / 2 robot; B thấy 0 pending / 3 running / 1 robot", async () => {
    const [a, b] = await Promise.all([kpi(U_A, "engineer"), kpi(U_B, "engineer")]);
    // A: `TA_ROBOT` (qua robot của A) + `TA_LOOSE` (cột `factoryId`, hợp lệ vì CẢ HAI liên
    // kết đều NULL). `running = 0` là chiều ÂM mạnh nhất của ca này: cả ba việc đang chạy
    // đều của B, mà HAI trong ba mang `factoryId` = nhà máy A.
    expect(a.fleet.value).toEqual({ tasksPending: 2, tasksRunning: 0, robotsOnline: 2 });
    expect(b.fleet.value).toEqual({ tasksPending: 0, tasksRunning: 3, robotsOnline: 1 });
  });

  it("fleet — ★ hàng NÓI DỐI: `tasks.\"factoryId\"` ghi nhà máy A không kéo nổi một việc của robot B sang A", async () => {
    const a = await kpi(U_A, "engineer");
    // `TB_LIE_DEVICE` (robot của B, factoryId=A) + `TB_LIE_WO` (lệnh trên tuyến B,
    // factoryId=A) + `TORPH_GONEROBOT` (robot đã biến mất, factoryId=A): ba hàng mà một
    // cổng đọc cột GHI RỜI sẽ nhận nhầm. A chỉ được có ĐÚNG 2 việc, cả hai đều pending.
    expect(a.fleet.value!.tasksRunning).toBe(0);
    expect(a.fleet.value!.tasksPending).toBe(2);
  });

  it("fleet — DƯƠNG admin: thấy cả việc/robot của A, của B, và cả hàng không-nối-được", async () => {
    const [adm, a, b] = await Promise.all([kpi(U_ADMIN, "admin"), kpi(U_A, "engineer"), kpi(U_B, "engineer")]);
    const admTasks = adm.fleet.value!.tasksPending + adm.fleet.value!.tasksRunning;
    const abTasks = a.fleet.value!.tasksPending + a.fleet.value!.tasksRunning
      + b.fleet.value!.tasksPending + b.fleet.value!.tasksRunning;
    // +2 = `TORPH_NULL` và `TORPH_GONEROBOT` — hai hàng nằm ngoài cả A lẫn B.
    expect(admTasks).toBeGreaterThanOrEqual(abTasks + 2);
    // +1 = robot mồ côi (không tuyến, không trạm).
    expect(adm.fleet.value!.robotsOnline).toBeGreaterThanOrEqual(
      a.fleet.value!.robotsOnline + b.fleet.value!.robotsOnline + 1,
    );
  });

  it("fleet — ÂM 0-gán: 0 KÈM lý do", async () => {
    const r = await kpi(U_NONE, "supervisor");
    expect(r.fleet.value).toEqual({ tasksPending: 0, tasksRunning: 0, robotsOnline: 0 });
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Ô `sites` — KHÔNG vá được; ca này canh chính LỜI KHAI
  // ══════════════════════════════════════════════════════════════════════════

  it("sites — người xem BỊ THU HẸP: fail-closed thành null TRUNG THỰC kèm lý do, KHÔNG phải `total: 0`", async () => {
    for (const [uid, role] of [[U_A, "engineer"], [U_B, "engineer"], [U_NONE, "supervisor"]] as const) {
      const r = await kpi(uid, role);
      // Vì sao KHÔNG được là `{ total: 0, … }`: số 0 ở đây là một LỜI KHAI ("liên bang có 0
      // site đang báo cáo") và nó SAI — hệ chỉ đơn giản không phân giải được hàng roll-up
      // về nhà máy. `available: false` ⇒ giao diện vẽ "—" = "chưa đo được", đúng sự thật.
      expect(r.sites.available).toBe(false);
      expect(r.sites.value).toBeNull();
      expect(r.sites.source).toBe(SITES_UNRESOLVABLE_SOURCE);
      expect(r.sites.source).toMatch(/KHÔNG phân giải được về nhà máy/);
    }
  });

  it("sites — DƯƠNG admin: KHÔNG bị chặn nhầm, vẫn đọc được roll-up như trước", async () => {
    const adm = await kpi(U_ADMIN, "admin");
    expect(adm.sites.available).toBe(true);
    expect(adm.sites.source).not.toBe(SITES_UNRESOLVABLE_SOURCE);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Toàn dải — câu rỗng + hình dạng đáp ứng
  // ══════════════════════════════════════════════════════════════════════════

  it("0-gán: câu rỗng nói về CẢ DẢI KPI và KHÔNG chứa cụm gây hiểu sai", async () => {
    const r = await kpi(U_NONE, "supervisor");
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeMessage).toContain("chưa được gán nhà máy");
    // Dải KPI có năm ô bị thu hẹp — câu chỉ nói về "danh sách báo động" là khai THIẾU.
    expect(r.scopeMessage).toMatch(/dải KPI/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có cảnh báo/i);
    expect(r.scopeMessage ?? "").not.toMatch(/yên ổn/i);
  });

  it("đáp ứng KHÔNG mang `filter` — `scope = resolved` nguyên khối giết superjson bằng `Converting circular structure to JSON`", async () => {
    const r = await kpi(U_A, "engineer");
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r).not.toHaveProperty("filter");
  });
});

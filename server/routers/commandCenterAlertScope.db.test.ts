/**
 * ★★★ 2026-08-18 — Nhóm B mục #5. Lưới CHẠM CSDL THẬT cho ba thủ tục báo động:
 * `commandCenter.recentAlerts`, `commandCenter.kpiSummary`, `alarmKpi.summary`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * **Vì sao BẮT BUỘC chạm CSDL thật.** Lưới giả lập `getDb` KHÔNG phát biểu được lỗi của
 * ĐỐI TƯỢNG THẬT. Tuần này đã đo hai lần:
 *   • một truy vấn thô nhận `Date` làm tham số ⇒ `ERR_INVALID_ARG_TYPE` — lưới mock xanh,
 *     đường thật CHƯA BAO GIỜ chạy được;
 *   • một truy vấn phụ đặt bí danh bảng ⇒ `42P01` — cùng kiểu, mock không thấy.
 * Cổng ở `commandCenterScope.ts` là SQL thô lồng ba tầng truy vấn phụ. Nếu nó sai cú pháp
 * hoặc sai cột, CHỈ Postgres nói được.
 *
 * **KHÔNG giả lập gì cả — kể cả lớp tra cứu bản gán.** Bản nháp đầu của file này giả lập
 * `accessControl.getUserAssignmentCodes`. Đó là một THƯỚC XANH GIẢ: `resolveDataScope`
 * gọi `getUserAssignmentCodes` bằng liên kết NỘI BỘ MODULE, nên `vi.mock` không chạm tới
 * nó — hai nửa của cùng một phép phân giải sẽ đọc HAI nguồn khác nhau (nhãn từ CSDL thật,
 * `factoryIds` từ mock) và lưới sẽ nói về một hệ không tồn tại. Nên ở đây gieo bản gán
 * THẬT vào `user_factory_assignments` + quyền THẬT vào `permissions`: đúng đường mà một
 * lượt HTTP thật đi.
 *
 * **Vì sao dựng nhà máy RIÊNG chứ không đo trên dữ liệu sẵn có.** CSDL sản xuất
 * (`aoi_management`) có 3 nhà máy nhưng TOÀN BỘ chuyền/máy/andon đều thuộc factory 1, và
 * chỉ tồn tại đúng một bản gán (`SIM-FAC`). Ở đó `engineer1` = **không bị lọc bởi dữ liệu**
 * — tức là chiều DƯƠNG. Chiều ÂM (A không thấy báo động của B) **không đo được** ở đó, và
 * báo cáo một lượt dương thành "bằng chứng chặn" là đúng lớp lỗi thước-xanh-giả.
 *
 * **HÌNH DẠNG BẮT BUỘC — HÀNG MỒ CÔI.** Bẫy đã cắn hai lần tuần này: lưới xanh vì dữ liệu
 * dựng sẵn thiếu hình dạng thật. `andon_events` KHÔNG có ràng buộc khoá ngoại trên
 * `lineId`/`stationId`/`machineId`, nên ba hình dạng mồ côi tồn tại được:
 *   (a) cả ba cột NULL;
 *   (b) `lineId` trỏ vào một tuyến KHÔNG tồn tại;
 *   (c) `machineId` trỏ vào một máy KHÔNG tồn tại.
 * Cả ba PHẢI fail-closed với người bị thu hẹp và PHẢI vẫn hiện với admin. Nếu không dựng
 * chúng, mọi cổng "lọc theo nhà máy" đều xanh mà vẫn rò đúng nhóm hàng nguy hiểm nhất.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// ⚠ Mặc định 5.000 ms KHÔNG đủ cho ca ĐẦU TIÊN của file này, và cái thiếu là thật chứ không
// phải "máy chậm": ca đầu gánh (a) lượt mở kết nối Postgres đầu tiên của tiến trình và (b)
// đồ thị nhập của `commandCenterRouter` (twin/sceneGraph · oeeService · aiActionInbox · toàn
// bộ schema drizzle). Chạy một mình mất ~2,5 s; chạy song song với các file khác thì vượt 5 s
// và ĐỎ — một lượt đỏ KHÔNG nói gì về phạm vi, tức là tiếng ồn che mất tín hiệu thật.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `b5_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC_A = `B5FA_${RUN}`.slice(0, 50);
const FAC_B = `B5FB_${RUN}`.slice(0, 50);

// userId tổng hợp — KHÔNG có khoá ngoại từ `user_factory_assignments`/`permissions` sang
// `users`, nên bản gán + quyền gieo được mà không phải dựng tài khoản (và không phải chạm
// vào bảng `users` mà lượt khác đang dùng).
const U_ADMIN = 950001;
const U_A = 950002;
const U_B = 950003;
const U_NONE = 950004;
const ALL_USERS = [U_ADMIN, U_A, U_B, U_NONE];

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0,
  wsA: 0, wsB: 0,
  lineA: 0, lineB: 0,
  stA: 0, stB: 0,
  machA: 0, machB: 0,
  safetyA: 0, safetyB: 0, safetyOrphan: 0,
};

const T = {
  andonA: `B5 ANDON A ${RUN}`,
  andonB: `B5 ANDON B ${RUN}`,
  orphanNull: `B5 ANDON ORPHAN-NULL ${RUN}`,
  orphanLine: `B5 ANDON ORPHAN-LINE ${RUN}`,
  orphanMachine: `B5 ANDON ORPHAN-MACHINE ${RUN}`,
};

describe.skipIf(!DB_URL)("Nhóm B #5 — phạm vi báo động trên CSDL THẬT (recentAlerts · kpiSummary · alarmKpi.summary)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.facA = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"B5 " + FAC_A}, true) RETURNING id`);
    ids.facB = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"B5 " + FAC_B}, true) RETURNING id`);
    ids.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${FAC_A + "_WS"}, 'wsA') RETURNING id`);
    ids.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facB}, ${FAC_B + "_WS"}, 'wsB') RETURNING id`);
    ids.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsA}, ${FAC_A + "_L1"}, 'lineA') RETURNING id`);
    ids.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsB}, ${FAC_B + "_L1"}, 'lineB') RETURNING id`);
    ids.stA = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineA}, ${FAC_A + "_S1"}, 'stA') RETURNING id`);
    ids.stB = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineB}, ${FAC_B + "_S1"}, 'stB') RETURNING id`);
    ids.machA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.stA}, ${FAC_A + "_M1"}, 'machA', 'AOI') RETURNING id`);
    ids.machB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${ids.stB}, ${FAC_B + "_M1"}, 'machB', 'AOI') RETURNING id`);

    // ── andon: một cho A, một cho B, ba MỒ CÔI ────────────────────────────────
    const mkAndon = (title: string, lineId: number | null, stationId: number | null, machineId: number | null) =>
      sql`INSERT INTO andon_events (state, reason, status, "lineId", "stationId", "machineId", title, "raisedAt")
          VALUES ('red', 'quality', 'raised', ${lineId}, ${stationId}, ${machineId}, ${title}, NOW())`;
    await mkAndon(T.andonA, ids.lineA, ids.stA, ids.machA);
    await mkAndon(T.andonB, ids.lineB, ids.stB, ids.machB);
    await mkAndon(T.orphanNull, null, null, null);                        // (a)
    await mkAndon(T.orphanLine, 2_000_000_001, null, null);               // (b) tuyến không tồn tại
    await mkAndon(T.orphanMachine, null, null, 2_000_000_002);            // (c) máy không tồn tại

    // ── safety: A, B, và một mồ côi (line/station/factoryId đều NULL) ─────────
    const mkSafety = async (lineId: number | null, stationId: number | null, factoryId: number | null) =>
      one(sql`INSERT INTO safety_events ("eventType", "lineId", "stationId", "factoryId", "isNearMiss", outcome)
              VALUES ('e_stop', ${lineId}, ${stationId}, ${factoryId}, false, 'logged_only') RETURNING id`);
    ids.safetyA = await mkSafety(ids.lineA, ids.stA, ids.facA);
    ids.safetyB = await mkSafety(ids.lineB, ids.stB, ids.facB);
    ids.safetyOrphan = await mkSafety(null, null, null);

    // ── Bản gán + quyền THẬT (đường mà một lượt HTTP thật đi) ─────────────────
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
    await sql`DELETE FROM andon_events WHERE title LIKE ${"B5 ANDON%" + RUN}`;
    await sql`DELETE FROM safety_events WHERE id IN ${sql([ids.safetyA, ids.safetyB, ids.safetyOrphan])}`;
    await sql`DELETE FROM machines WHERE id IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM stations WHERE id IN ${sql([ids.stA, ids.stB])}`;
    await sql`DELETE FROM production_lines WHERE id IN ${sql([ids.lineA, ids.lineB])}`;
    await sql`DELETE FROM workshops WHERE id IN ${sql([ids.wsA, ids.wsB])}`;
    await sql`DELETE FROM factories WHERE id IN ${sql([ids.facA, ids.facB])}`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql.end();
  });

  const ccCaller = async (userId: number, role: string) =>
    (await import("./commandCenterRouter")).commandCenterRouter.createCaller(ctxFor(userId, role));
  const akCaller = async (userId: number, role: string) =>
    (await import("./alarmKpiRouter")).alarmKpiRouter.createCaller(ctxFor(userId, role));

  const titlesOf = (r: { alerts: Array<{ title: string }> }) => r.alerts.map((a) => a.title);

  // ══════════════════════════════════════════════════════════════════════════
  // recentAlerts
  // ══════════════════════════════════════════════════════════════════════════

  it("DƯƠNG (admin): thấy TOÀN BỘ — A, B và cả ba hàng mồ côi. Ca này là ĐIỀU KIỆN của mọi ca âm bên dưới: nó chứng minh dữ liệu THẬT SỰ với tới được, nên mỗi lượt vắng mặt sau đó là do CỔNG chứ không do dữ liệu không tồn tại", async () => {
    const r = await (await ccCaller(U_ADMIN, "admin")).recentAlerts({ limit: 200 });
    const t = titlesOf(r);
    expect(t).toContain(T.andonA);
    expect(t).toContain(T.andonB);
    expect(t).toContain(T.orphanNull);
    expect(t).toContain(T.orphanLine);
    expect(t).toContain(T.orphanMachine);
    expect(r.scopeApplied).toBe(false);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("ÂM (A không thấy báo động của B) + DƯƠNG (A VẪN thấy đủ A) + ba hàng mồ côi FAIL-CLOSED", async () => {
    const r = await (await ccCaller(U_A, "engineer")).recentAlerts({ limit: 200 });
    const t = titlesOf(r);
    expect(t).toContain(T.andonA); // dương: không vá quá tay thành chặn tất cả
    expect(t).not.toContain(T.andonB); // âm
    expect(t).not.toContain(T.orphanNull);
    expect(t).not.toContain(T.orphanLine);
    expect(t).not.toContain(T.orphanMachine);
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("ÂM đối xứng (B không thấy của A) — chứng minh không phải 'A tình cờ luôn thắng'", async () => {
    const r = await (await ccCaller(U_B, "engineer")).recentAlerts({ limit: 200 });
    const t = titlesOf(r);
    expect(t).toContain(T.andonB);
    expect(t).not.toContain(T.andonA);
    expect(t).not.toContain(T.orphanNull);
  });

  it("ÂM (0-gán) ⇒ 0 dòng + LÝ DO, và câu rỗng KHÔNG được nói 'không có cảnh báo nào'", async () => {
    const r = await (await ccCaller(U_NONE, "supervisor")).recentAlerts({ limit: 200 });
    expect(r.alerts).toEqual([]);
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toContain("chưa được gán nhà máy");
    expect(r.scopeMessage ?? "").not.toMatch(/không có cảnh báo/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có báo động/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu/i);
  });

  it("`limit` KHÔNG được áp TRƯỚC cổng: A xin limit=1 vẫn nhận một dòng CỦA A, không phải một dòng của B rồi lọc thành rỗng", async () => {
    const r = await (await ccCaller(U_A, "engineer")).recentAlerts({ limit: 1 });
    expect(r.alerts.length).toBe(1);
    // Mọi hàng trong phạm vi A đều gắn lineA (andon A hoặc safety A).
    expect(r.alerts[0].scope.lineId).toBe(ids.lineA);
  });

  it("đáp ứng KHÔNG mang `filter` — `scope = resolved` nguyên khối sẽ giết superjson bằng `Converting circular structure to JSON`", async () => {
    const r = await (await ccCaller(U_A, "engineer")).recentAlerts({ limit: 200 });
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r).not.toHaveProperty("filter");
  });

  // ══════════════════════════════════════════════════════════════════════════
  // kpiSummary — ô `alarms`
  // ══════════════════════════════════════════════════════════════════════════

  it("kpiSummary: admin đếm ≥ A + B + 5 hàng chỉ-admin-thấy; A > 0 (dương) và không bao giờ gồm báo động của B", async () => {
    const asAdmin = await (await ccCaller(U_ADMIN, "admin")).kpiSummary({});
    const asA = await (await ccCaller(U_A, "engineer")).kpiSummary({});
    const asB = await (await ccCaller(U_B, "engineer")).kpiSummary({});

    expect(asAdmin.alarms.available).toBe(true);
    expect(asA.alarms.available).toBe(true);
    const admTotal = asAdmin.alarms.value!.total;
    const aTotal = asA.alarms.value!.total;
    const bTotal = asB.alarms.value!.total;
    // Chỉ admin thấy: 3 andon mồ côi + 1 safety mồ côi = 4 hàng nằm ngoài cả A lẫn B.
    expect(admTotal).toBeGreaterThanOrEqual(aTotal + bTotal + 4);
    expect(aTotal).toBeGreaterThan(0); // dương: A vẫn thấy của A
    expect(asA.scopeApplied).toBe(true);
    expect(() => JSON.stringify(asA)).not.toThrow();
  });

  it("kpiSummary: 0-gán ⇒ alarms = 0 KÈM lý do (một dải KPI toàn 0 không được trông giống ca trực yên tĩnh)", async () => {
    const r = await (await ccCaller(U_NONE, "supervisor")).kpiSummary({});
    expect(r.alarms.value).toEqual({ critical: 0, high: 0, total: 0 });
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage ?? "").not.toMatch(/không có cảnh báo/i);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // alarmKpi.summary — CÙNG NGUỒN `andon_events`
  // ══════════════════════════════════════════════════════════════════════════

  it("alarmKpi.summary: admin đếm cả A+B+mồ côi; A đếm ít hơn; 0-gán ⇒ 0 + lý do", async () => {
    const adm = await (await akCaller(U_ADMIN, "admin")).summary({ windowHours: 24 });
    const a = await (await akCaller(U_A, "engineer")).summary({ windowHours: 24 });
    const b = await (await akCaller(U_B, "engineer")).summary({ windowHours: 24 });
    const none = await (await akCaller(U_NONE, "supervisor")).summary({ windowHours: 24 });

    // 5 andon vừa dựng (A, B, 3 mồ côi) đều nằm trong cửa sổ 24h.
    expect(adm.sourceCounts.andon).toBeGreaterThanOrEqual(a.sourceCounts.andon + b.sourceCounts.andon + 3);
    expect(a.sourceCounts.andon).toBeGreaterThanOrEqual(1); // dương
    expect(b.sourceCounts.andon).toBeGreaterThanOrEqual(1);
    expect(none.sourceCounts.andon).toBe(0); // âm 0-gán
    expect(none.scopeEmptyReason).toBe("no_factory_assignment");
    expect(none.scopeMessage ?? "").not.toMatch(/không có cảnh báo/i);
    expect(adm.scopeApplied).toBe(false);
    expect(() => JSON.stringify(a)).not.toThrow();
  });

  it("alarmKpi.summary: bad-actor của A KHÔNG chứa máy/tuyến của B (nhãn cũng là dữ liệu rò được)", async () => {
    const a = await (await akCaller(U_A, "engineer")).summary({ windowHours: 24 });
    const actorKeys = a.badActors.map((x) => x.actorKey);
    expect(actorKeys).toContain(`machine:${ids.machA}`);
    expect(actorKeys).not.toContain(`machine:${ids.machB}`);
    expect(actorKeys).not.toContain(`line:${ids.lineB}`);
  });

  it("alarmKpi.summary: `input.lineId` của nhà máy KHÁC KHÔNG mở rộng được phạm vi (ô chọn giao diện chỉ THU HẸP — ghép bằng AND, dưới cổng)", async () => {
    const r = await (await akCaller(U_A, "engineer")).summary({ windowHours: 24, lineId: ids.lineB });
    expect(r.sourceCounts.andon).toBe(0);
  });
});

/**
 * ★★★ 2026-08-18 — LƯỚI CHO `mqttClient.getScopeLabels`, thủ tục NHẸ chở NHÃN PHẠM VI
 * qua dây cho hai màn ăn bằng MẢNG TRẦN (`/oee-dashboard`, `/machine-health`).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO THỦ TỤC NÀY TỒN TẠI (đọc trước khi định "gộp cho gọn")
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `mqttClient.getAllOEE` trả về **MẢNG**. `getAllMachinesOEELive` có đính ba ô nhãn lên mảng ấy
 * bằng `withScopeLabels`, nhưng chúng **không liệt kê được** (`enumerable: false`) nên
 * `JSON.stringify`/superjson bỏ qua — đây là lựa chọn CÓ CHỦ Ý, ghi ở docblock
 * `server/_core/accessControlLabels.ts`. Hệ quả: nhãn CHẾT ở biên tRPC.
 *
 * `/dashboard`, `/control-tower`, `/corporate-dashboard` thoát được vì trên cùng màn còn một
 * truy vấn KHÁC có mang nhãn (`dashboard.getStats`). Hai màn OEE/Health **không có cái nào** —
 * mọi truy vấn của chúng (`machine.list`, `getAllOEE`, `getAllMachineHealth`) đều trả mảng trần.
 * Nên người 0 gán nhà máy thấy 0 máy, và giao diện dịch nó thành *"chưa có dữ liệu"* — trên màn
 * OEE câu ấy đọc thành **"nhà máy không chạy"**, sai về thế giới.
 *
 * ── VÌ SAO KHÔNG ĐỔI `getAllOEE` SANG `{ machines, ...nhãn }` (lối (a) đã bị BÁC BỎ) ─────────
 * `client/src/pages/Dashboard.tsx` đọc nó qua một phép ÉP KIỂU:
 *     const q = allOEE as LiveOEERow[] | undefined;
 *     return Array.isArray(q) ? q : [];
 * Đổi hợp đồng ⇒ `Array.isArray` thành `false` ⇒ widget im lặng trả `[]` **MÃI MÃI**, và `tsc`
 * KHÔNG đỏ vì `as` đã cắt đường suy kiểu. Đó đúng là lớp "vỡ ngầm" mà hợp đồng mảng được giữ để
 * tránh. Thủ tục RIÊNG không đụng vào bất kỳ nơi gọi cũ nào.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN CHIỀU + HAI Ô CHỐNG-TRÔI
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *   ÂM   — 0 gán ⇒ `no_factory_assignment` + câu nói ĐÚNG lý do.
 *   DƯƠNG — admin ⇒ `scopeEmptyReason: null` (chống vá quá tay thành "chặn tất cả").
 *   DƯƠNG — kỹ sư CÓ gán ⇒ `scopeEmptyReason: null` dù cửa sổ 24h có rỗng hay không.
 *   ★ ĐỒNG THUẬN — nhãn của thủ tục PHẢI TRÙNG nhãn mà `getAllMachinesOEELive` tự tính.
 *   ★ QUA ĐƯỢC DÂY — `JSON` round-trip GIỮ đủ ba ô, trong khi cùng phép ấy trên MẢNG thì MẤT.
 *
 * ⚠ Ô "ĐỒNG THUẬN" là ô quan trọng nhất và là lý do thủ tục dùng ĐÚNG bộ phân giải của đường dữ
 * liệu (`resolveTenantFactoryScope`), không phải một lối tính thứ hai. Hai bộ suy độc lập canh
 * hai nửa của một câu là lớp lỗi đã cắn dự án này rồi: nhãn nói "phạm vi ổn" trong khi bộ lọc
 * đang cắt sạch, hoặc ngược lại — và KHÔNG lưới nào đỏ vì mỗi bên đều tự nhất quán.
 *
 * ⚠ Ca chạy trên CSDL THẬT: một mệnh đề giả không mang tham chiếu vòng nên không thể phát biểu
 * được lỗi `Converting circular structure to JSON` — lỗi đã cho `dashboard.getStats` trả 500 cho
 * MỌI người dùng (2026-08-17) sau một bản vá `tsc` sạch + 220 ca xanh.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getAllMachinesOEELive } from "../services/oeeService";

const DB_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;

const FAC_A = `SL-FA-${RUN}`;
const MC_A = `SL-MC-A-${RUN}`;

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = {
  factoryA: 0, workshopA: 0, lineA: 0, stationA: 0, machineA: 0,
  userAdmin: 0, userEngA: 0, userNoAssign: 0,
};

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* WORM / FK — có đường dọn thay thế */ }
}

const ADMIN = () => ({ userId: ids.userAdmin, userRole: "admin" });
const ENG_A = () => ({ userId: ids.userEngA, userRole: "engineer" });
const NO_ASSIGN = () => ({ userId: ids.userNoAssign, userRole: "supervisor" });

describe.skipIf(!DB_URL)("mqttClient.getScopeLabels — nhãn phạm vi qua được dây", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${FAC_A}, ${"SL factory A"}) RETURNING id`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${`SL-W-A-${RUN}`}, 'SL workshop') RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w.id}, ${`SL-L-A-${RUN}`}, ${`SL line A ${RUN}`}, 100) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${`SL-S-A-${RUN}`}, 'SL station') RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${MC_A}, 'SL machine A', 'AOI') RETURNING id`;
    ids.factoryA = f.id; ids.workshopA = w.id; ids.lineA = l.id; ids.stationA = s.id; ids.machineA = m.id;

    const mkUser = async (username: string, role: string) => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`sl-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r.id as number;
    };
    ids.userAdmin = await mkUser(`sl-admin-${RUN}`, "admin");
    ids.userEngA = await mkUser(`sl-eng-a-${RUN}`, "engineer");
    ids.userNoAssign = await mkUser(`sl-noassign-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.userEngA}, ${FAC_A})`;
  }, 180_000);

  afterAll(async () => {
    try {
      const users = [ids.userAdmin, ids.userEngA, ids.userNoAssign].filter(Boolean);
      if (users.length) await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
      if (ids.machineA) {
        await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id = ${ids.machineA}`);
        await safe(() => sql`DELETE FROM machines WHERE id = ${ids.machineA}`);
      }
      if (ids.stationA) await safe(() => sql`DELETE FROM stations WHERE id = ${ids.stationA}`);
      if (ids.lineA) await safe(() => sql`DELETE FROM production_lines WHERE id = ${ids.lineA}`);
      if (ids.workshopA) await safe(() => sql`DELETE FROM workshops WHERE id = ${ids.workshopA}`);
      if (ids.factoryA) await safe(() => sql`DELETE FROM factories WHERE id = ${ids.factoryA}`);
      if (users.length) await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
    } finally {
      await sql?.end();
    }
  }, 120_000);

  const caller = async (userId: number, role: string) =>
    (await import("./mqttOeeRouters")).mqttClientRouter.createCaller(ctxFor(userId, role));

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 1. BA VAI — âm một chiều, dương hai chiều.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  it("ÂM (0 gán) ⇒ mã `no_factory_assignment` + câu nói ĐÚNG lý do", async () => {
    const r = await (await caller(ids.userNoAssign, "supervisor")).getScopeLabels();
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeMessage).toBeTruthy();
    expect(r.scopeMessage).toContain("chưa được gán nhà máy");
  });

  it("★ câu ấy KHÔNG được chứa cụm 'không/chưa có dữ liệu' — kể cả ở vế PHỦ ĐỊNH", async () => {
    // Người đọc lướt chỉ bắt được cụm từ, không bắt được vế phủ định. Cùng quy tắc đã ghi ở
    // `NO_FACTORY_ASSIGNMENT_MESSAGE`; ô này canh nó TẠI ĐÚNG BỀ MẶT hai màn OEE/Health đọc.
    const r = await (await caller(ids.userNoAssign, "supervisor")).getScopeLabels();
    const msg = r.scopeMessage ?? "";
    expect(msg).not.toMatch(/không có dữ liệu/i);
    expect(msg).not.toMatch(/chưa có dữ liệu/i);
    expect(msg).not.toMatch(/không có máy/i);
    // …và cũng không được kết luận thay về thế giới vật lý.
    expect(msg).not.toMatch(/ngừng chạy(?!\.)/i);
  });

  it("DƯƠNG (admin) ⇒ KHÔNG có lý do rỗng, KHÔNG áp phạm vi (chống vá quá tay)", async () => {
    const r = await (await caller(ids.userAdmin, "admin")).getScopeLabels();
    expect(r.scopeEmptyReason).toBeNull();
    expect(r.scopeApplied).toBe(false);
    expect(r.scopeMessage).toBeNull();
  });

  it("DƯƠNG (kỹ sư CÓ gán) ⇒ có áp phạm vi nhưng KHÔNG có lý do rỗng", async () => {
    // ★ Đây là ô phân biệt "rỗng vì PHẠM VI" với "rỗng vì CỬA SỔ". Trên CSDL dev, hàng
    // `daily_statistics` mới nhất là 2026-07-16 nên cửa sổ 24h rỗng cho MỌI vai — kể cả admin.
    // Tài khoản này vì thế có thể thấy 0 máy, và VẪN PHẢI nhận `scopeEmptyReason: null`, tức
    // giao diện giữ nguyên câu "chưa có dữ liệu trong cửa sổ". Hai lý do "0 máy" cùng tồn tại
    // trên chính máy này; nếu ô này đỏ thì bản vá đã gộp chúng làm một.
    const r = await (await caller(ids.userEngA, "engineer")).getScopeLabels();
    expect(r.scopeEmptyReason).toBeNull();
    expect(r.scopeApplied).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 2. ★ ĐỒNG THUẬN với đường DỮ LIỆU — ô quan trọng nhất của file này.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  it("★ nhãn của thủ tục TRÙNG nhãn `getAllMachinesOEELive` tự tính, cho CẢ BA vai", async () => {
    const bo = [
      { ten: "admin", ctx: [ids.userAdmin, "admin"] as const, svc: ADMIN() },
      { ten: "engineer", ctx: [ids.userEngA, "engineer"] as const, svc: ENG_A() },
      { ten: "0-gán", ctx: [ids.userNoAssign, "supervisor"] as const, svc: NO_ASSIGN() },
    ];
    for (const { ten, ctx, svc } of bo) {
      const nhan = await (await caller(ctx[0], ctx[1])).getScopeLabels();
      const rows = await getAllMachinesOEELive(svc);
      expect({
        scopeApplied: rows.scopeApplied,
        scopeEmptyReason: rows.scopeEmptyReason,
        scopeMessage: rows.scopeMessage,
      }, `vai ${ten}: nhãn thủ tục lệch nhãn đường dữ liệu`).toEqual(nhan);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // 3. ★ QUA ĐƯỢC DÂY — chứng minh CHÍNH cái lý do thủ tục tồn tại.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  it("★ ba ô SỐNG SÓT qua JSON round-trip, trong khi trên MẢNG thì CHẾT", async () => {
    const nhan = await (await caller(ids.userNoAssign, "supervisor")).getScopeLabels();
    const quaDay = JSON.parse(JSON.stringify(nhan));
    expect(quaDay.scopeEmptyReason).toBe("no_factory_assignment");
    expect(quaDay.scopeApplied).toBe(true);
    expect(typeof quaDay.scopeMessage).toBe("string");

    // …và đây là chiều ĐỐI CHỨNG: cùng phép round-trip trên mảng có nhãn thì MẤT SẠCH.
    // Nếu ô này đỏ vì mảng bỗng chở được nhãn, thủ tục riêng có thể bỏ — nhưng phải đọc lại
    // `withScopeLabels` trước, vì `enumerable: false` là CỐ Ý.
    const rows = await getAllMachinesOEELive(NO_ASSIGN());
    expect(rows.scopeEmptyReason).toBe("no_factory_assignment");
    const mangQuaDay = JSON.parse(JSON.stringify(rows));
    expect(mangQuaDay.scopeEmptyReason).toBeUndefined();
  });

  it("KHÔNG rò `filter` của drizzle ra đáp ứng (tham chiếu vòng ⇒ superjson chết)", async () => {
    for (const [id, role] of [[ids.userAdmin, "admin"], [ids.userEngA, "engineer"], [ids.userNoAssign, "supervisor"]] as const) {
      const r = await (await caller(id, role)).getScopeLabels();
      expect(() => JSON.stringify(r)).not.toThrow();
      expect(Object.keys(r).sort()).toEqual(["scopeApplied", "scopeEmptyReason", "scopeMessage"]);
    }
  });
});

/**
 * ★★★ 2026-09-15 (QA lần 11, PH-23) — `commandCenter.hierarchy` THU HẸP THEO NGƯỜI XEM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * **Lỗ đã đo.** `commandCenterRouter.hierarchy` nhận phạm vi từ **`input`** — lời TỰ KHAI của
 * client — chứ không từ `ctx.user`. Đo sống ngày 2026-09-15 (`.qa-tapdoan/kiem-hierarchy.mjs`):
 * **5 vai nhận CÙNG 450.811 byte, CÙNG md5**, kể cả tài khoản **0 gán nhà máy** (mà cùng phiên
 * ấy `factory.list` trả 0 và `factoryCommand.overview` trả 0 máy cho chính người đó). Cây lộ
 * `site 1 · factory 5 · line 102 · station 1.145 · machine 1.151` kèm TÊN nhà máy và số cảnh báo.
 * Cùng lớp lỗi G113 đã vá cho `factoryCommand.overview` ngày 2026-09-10 (`e7b6afd1`) — sót đúng
 * một thủ tục, và là thủ tục NẶNG NHẤT (một `buildSceneGraph` cho MỖI nhà máy).
 *
 * **Vì sao BẮT BUỘC chạm CSDL thật** (cùng lý lẽ `commandCenterKpiScope.db.test.ts`): đường đi
 * là `resolveHierarchyScope → resolveTenantFactoryScope → resolveDataScope + getUserAssignmentCodes
 * → factories` rồi `buildSceneGraph` cho từng nhà máy còn lại. Một lưới giả lập `getDb` chỉ phát
 * biểu được về hình dạng lời gọi; nó KHÔNG nói được rằng bản gán THẬT chiếu ra đúng tập nhà máy,
 * và chính phép chiếu ấy là thứ đã thủng.
 *
 * **HÌNH DẠNG BẮT BUỘC — bốn chiều, thiếu chiều nào là thước xanh giả:**
 *   (+) A thấy ĐỦ cây của A          — chống "vá quá tay thành chặn tất cả";
 *   (−) A KHÔNG thấy một nút nào của B, và ĐỐI XỨNG: B không thấy của A (chống "A tình cờ thắng");
 *   (0) 0 gán ⇒ cây RỖNG **kèm lý do máy-đọc-được** — không phải một cây rỗng im lặng, vì
 *       "không có máy nào" và "bạn không được phép thấy máy nào" là hai lời khai khác hẳn nhau;
 *   (★) `input.scope` chỉ được **THU HẸP**: một người của A khai `factoryId`/`corporateCode` của B
 *       vẫn phải ra RỖNG. Đây là ca canh chính khuyết tật PH-23 — trước bản vá, `input` là trục
 *       phạm vi DUY NHẤT, nên nó vừa thu hẹp vừa **nới rộng** được.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// Cùng lý do như `commandCenterKpiScope.db.test.ts`: ca đầu gánh lượt mở kết nối Postgres đầu
// tiên + đồ thị nhập của `commandCenterRouter` (twin/sceneGraph · oeeService · toàn bộ schema
// drizzle), và ca "admin" phải dựng sceneGraph cho MỌI nhà máy trong CSDL test.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `h7_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC_A = `H7FA_${RUN}`.slice(0, 50);
const FAC_B = `H7FB_${RUN}`.slice(0, 50);
/** Mã công ty CHỈ của nhà máy B — dùng cho ca "`input.corporateCode` không nới được phạm vi". */
const CORP_B = `H7CB_${RUN}`.slice(0, 50);

// userId tổng hợp — không có khoá ngoại từ `user_factory_assignments`/`permissions` sang `users`,
// nên gieo được mà không chạm bảng `users` mà lượt khác đang dùng.
const U_ADMIN = 953001;
const U_A = 953002;
const U_B = 953003;
const U_NONE = 953004;
const ALL_USERS = [U_ADMIN, U_A, U_B, U_NONE];

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = { facA: 0, facB: 0, wsA: 0, wsB: 0, lineA: 0, lineB: 0, stA: 0, stB: 0, machA: 0, machB: 0 };

/** Mọi nút của cây, phẳng ra — cổng phải chặn ở MỌI độ sâu, không chỉ ở tầng nhà máy. */
function moiNut(nodes: Array<{ children?: unknown[] }> | undefined): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const di = (ns: unknown[] | undefined): void => {
    for (const n of ns ?? []) {
      const node = n as Record<string, unknown>;
      out.push(node);
      di(node.children as unknown[] | undefined);
    }
  };
  di(nodes as unknown[] | undefined);
  return out;
}

const maCua = (nodes: Array<{ children?: unknown[] }> | undefined): string[] =>
  moiNut(nodes).map((n) => String(n.code ?? ""));

describe.skipIf(!DB_URL)("PH-23 — `commandCenter.hierarchy` theo phạm vi NGƯỜI XEM, bốn chiều, CSDL thật", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    // ── Hai nhà máy ĐỘC LẬP, mỗi cái một nhánh đầy đủ tới tận máy ───────────────
    // ⚠ B mang `corporateCode` riêng: đó là trục thứ hai mà `input.scope` có thể khai để
    //   NỚI phạm vi, nên nó phải có thật trong dữ liệu thì ca (★) mới nói được điều gì.
    // `factories."corporateCode"` có KHOÁ NGOẠI THẬT tới `corporates.code` (0180,
    // `fk_factories_corporate`) — nên mã công ty phải tồn tại trước.
    await sql`INSERT INTO corporates (code, name) VALUES (${CORP_B}, ${"H7 " + CORP_B})`;
    ids.facA = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"H7 " + FAC_A}, true) RETURNING id`);
    ids.facB = await one(sql`INSERT INTO factories (code, name, "corporateCode", "isActive") VALUES (${FAC_B}, ${"H7 " + FAC_B}, ${CORP_B}, true) RETURNING id`);
    ids.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${FAC_A + "_WS"}, 'wsA') RETURNING id`);
    ids.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facB}, ${FAC_B + "_WS"}, 'wsB') RETURNING id`);
    ids.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsA}, ${FAC_A + "_L1"}, 'lineA') RETURNING id`);
    ids.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsB}, ${FAC_B + "_L1"}, 'lineB') RETURNING id`);
    ids.stA = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineA}, ${FAC_A + "_S1"}, 'stA') RETURNING id`);
    ids.stB = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.lineB}, ${FAC_B + "_S1"}, 'stB') RETURNING id`);
    ids.machA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stA}, ${FAC_A + "_M1"}, 'machA', 'AOI', true) RETURNING id`);
    ids.machB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stB}, ${FAC_B + "_M1"}, 'machB', 'AOI', true) RETURNING id`);

    // ── Bản gán + quyền THẬT (đúng đường một lượt HTTP thật đi) ─────────────────
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
    await sql`DELETE FROM machines WHERE id IN ${sql([ids.machA, ids.machB])}`;
    await sql`DELETE FROM stations WHERE id IN ${sql([ids.stA, ids.stB])}`;
    await sql`DELETE FROM production_lines WHERE id IN ${sql([ids.lineA, ids.lineB])}`;
    await sql`DELETE FROM workshops WHERE id IN ${sql([ids.wsA, ids.wsB])}`;
    await sql`DELETE FROM factories WHERE id IN ${sql([ids.facA, ids.facB])}`;
    await sql`DELETE FROM corporates WHERE code = ${CORP_B}`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql.end();
  });

  const cay = async (
    userId: number,
    role: string,
    scope?: { factoryId?: number; corporateCode?: string },
  ) =>
    (await import("./commandCenterRouter")).commandCenterRouter
      .createCaller(ctxFor(userId, role))
      .hierarchy(scope ? { scope } : {});

  // ══════════════════════════════════════════════════════════════════════════
  // (+) và (−) — hai chiều ĐỐI XỨNG
  // ══════════════════════════════════════════════════════════════════════════

  it("★★★ (+) A thấy ĐỦ cây của A · (−) KHÔNG một nút nào của B lọt vào", async () => {
    const r = await cay(U_A, "engineer");
    const ma = maCua(r.sites);
    // Chiều DƯƠNG trước: nếu bốn mã của A không có mặt thì mọi ca âm bên dưới xanh vì
    // "chặn tất cả", không vì chặn ĐÚNG.
    expect(ma).toContain(FAC_A);
    expect(ma).toContain(FAC_A + "_L1");
    expect(ma).toContain(FAC_A + "_S1");
    expect(ma).toContain(FAC_A + "_M1");
    // Chiều ÂM ở MỌI độ sâu — kể cả tên máy, thứ mà bản đo sống thấy rò ra.
    expect(ma).not.toContain(FAC_B);
    expect(ma).not.toContain(FAC_B + "_L1");
    expect(ma).not.toContain(FAC_B + "_S1");
    expect(ma).not.toContain(FAC_B + "_M1");
    expect(r.scopeApplied).toBe(true);
  });

  it("★★ ĐỐI XỨNG: B thấy cây của B và KHÔNG thấy của A (chống 'A tình cờ luôn thắng')", async () => {
    const ma = maCua((await cay(U_B, "engineer")).sites);
    expect(ma).toContain(FAC_B);
    expect(ma).toContain(FAC_B + "_M1");
    expect(ma).not.toContain(FAC_A);
    expect(ma).not.toContain(FAC_A + "_M1");
  });

  /**
   * ★ Vì sao ca admin đi qua `input.scope` thay vì gọi trần.
   *
   * `buildHierarchy` fan-out MỘT `buildSceneGraph` cho MỖI nhà máy lọt cổng, và CSDL test đang
   * mang **5.307 nhà máy** rác của mọi lượt chạy trước (đo 2026-09-15). Một lượt admin KHÔNG
   * lọc là ~48 s — chính là phép đo của PH-24, và nó biến ca này thành một phép đo về RÁC của
   * CSDL test chứ không về phạm vi. Hai lượt hẹp dưới đây nói đúng thứ cần nói và nói mạnh hơn:
   * admin VỚI CÙNG một lời tự khai `factoryId` vào được nhà máy mà người của A bị chặn
   * (`scopeApplied === false` ⇒ `resolveTenantFactoryScope` trả `null` = KHÔNG mệnh đề nào).
   */
  it("(+) admin KHÔNG bị chặn nhầm: vào được CẢ HAI nhà máy, và KHÔNG có mệnh đề phạm vi nào", async () => {
    const [admA, admB] = await Promise.all([
      cay(U_ADMIN, "admin", { factoryId: ids.facA }),
      cay(U_ADMIN, "admin", { factoryId: ids.facB }),
    ]);
    expect(maCua(admA.sites)).toContain(FAC_A);
    expect(maCua(admA.sites)).toContain(FAC_A + "_M1");
    expect(maCua(admB.sites)).toContain(FAC_B);
    expect(maCua(admB.sites)).toContain(FAC_B + "_M1");
    // `scopeApplied === false` là chiều dương THẬT của "admin không bị thu hẹp": nó nói phạm vi
    // được phân giải ra `null`, chứ không phải ra một tập tình cờ đủ rộng.
    expect(admA.scopeApplied).toBe(false);
    expect(admB.scopeApplied).toBe(false);
    expect(admA.scopeEmptyReason).toBeNull();
    // ★ ĐỐI CHỨNG cùng lời tự khai, khác danh tính: người của A bị chặn ở ĐÚNG lời gọi mà admin
    //   đi qua được ⇒ cái phân biệt là `ctx.user`, không phải `input`.
    expect(maCua((await cay(U_A, "engineer", { factoryId: ids.facB })).sites)).not.toContain(FAC_B);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (0) — 0 gán: RỖNG **kèm lý do**
  // ══════════════════════════════════════════════════════════════════════════

  it("★★★ (0) 0 gán ⇒ cây RỖNG — đây là ca mà bản đo sống thấy 450.811 byte", async () => {
    const r = await cay(U_NONE, "supervisor");
    expect(moiNut(r.sites)).toEqual([]);
    expect(maCua(r.sites)).not.toContain(FAC_A);
    expect(maCua(r.sites)).not.toContain(FAC_B);
  });

  it("★★ (0) cây rỗng phải KÈM lý do máy-đọc-được — 'không có máy nào' ≠ 'bạn không được thấy máy nào'", async () => {
    const r = await cay(U_NONE, "supervisor");
    expect(r.scopeApplied).toBe(true);
    expect(r.scopeEmptyReason).toBe("no_factory_assignment");
    expect(r.scopeMessage).toContain("chưa được gán nhà máy");
    expect(r.scopeMessage).toContain("quản trị viên");
    // Câu này đặt dưới một cây RỖNG, nên nó không được chứa cụm nào đọc thành "xưởng không
    // có thiết bị" / "xưởng đang yên ổn" — kể cả trong vế phủ định (người đọc lướt chỉ bắt
    // được cụm từ, không bắt được vế phủ định).
    expect(r.scopeMessage ?? "").not.toMatch(/không có dữ liệu/i);
    expect(r.scopeMessage ?? "").not.toMatch(/không có máy nào/i);
    expect(r.scopeMessage ?? "").not.toMatch(/yên ổn|bình thường/i);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (★) `input.scope` chỉ THU HẸP — ca canh chính PH-23
  // ══════════════════════════════════════════════════════════════════════════

  it("★★★ `input.scope.factoryId` của B KHÔNG nới được phạm vi của người thuộc A", async () => {
    const r = await cay(U_A, "engineer", { factoryId: ids.facB });
    const ma = maCua(r.sites);
    expect(ma).not.toContain(FAC_B);
    expect(ma).not.toContain(FAC_B + "_M1");
    expect(moiNut(r.sites)).toEqual([]);
  });

  it("★★★ `input.scope.corporateCode` của B KHÔNG nới được phạm vi (trục thứ hai của lời tự khai)", async () => {
    const r = await cay(U_A, "engineer", { corporateCode: CORP_B });
    const ma = maCua(r.sites);
    expect(ma).not.toContain(FAC_B);
    expect(ma).not.toContain(FAC_B + "_M1");
    expect(moiNut(r.sites)).toEqual([]);
  });

  it("★★ 0 gán + `input.scope` khai một nhà máy CÓ THẬT ⇒ VẪN rỗng (fail-closed)", async () => {
    for (const s of [{ factoryId: ids.facA }, { factoryId: ids.facB }, { corporateCode: CORP_B }]) {
      const r = await cay(U_NONE, "supervisor", s);
      expect(moiNut(r.sites), JSON.stringify(s)).toEqual([]);
    }
  });

  it("(+) `input.scope` VẪN thu hẹp được TRONG phạm vi của chính mình (chống vá quá tay)", async () => {
    const r = await cay(U_A, "engineer", { factoryId: ids.facA });
    const ma = maCua(r.sites);
    expect(ma).toContain(FAC_A);
    expect(ma).toContain(FAC_A + "_M1");
    expect(ma).not.toContain(FAC_B);
  });

  it("(+) admin VẪN dùng được `input.scope` như một bộ lọc trình bày (một nhà máy ⇒ chỉ nhà máy ấy)", async () => {
    const ma = maCua((await cay(U_ADMIN, "admin", { factoryId: ids.facB })).sites);
    expect(ma).toContain(FAC_B);
    expect(ma).not.toContain(FAC_A);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Hình dạng đáp ứng
  // ══════════════════════════════════════════════════════════════════════════

  it("đáp ứng KHÔNG mang `filter` — `scope = resolved` nguyên khối giết superjson bằng `Converting circular structure to JSON`", async () => {
    const r = await cay(U_A, "engineer");
    expect(() => JSON.stringify(r)).not.toThrow();
    expect(r).not.toHaveProperty("filter");
    expect(r).toHaveProperty("status");
  });
});

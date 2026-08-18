/**
 * ★★★ 2026-08-18 — **ÂM ĐỐI XỨNG TRÊN CSDL THẬT cho ĐỢT TRẢ NỢ 11 FILE ĐẦU BẢNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT FILE RIÊNG, KHÔNG NỐI VÀO `phamViDocPatch.db.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File kia canh **ba ca chuẩn** do chủ dự án tự xác minh và đang được một agent khác giữ; ba
 * agent cùng sửa một file trong một buổi là cách hai bản vá nuốt nhau. File này canh **đợt 185
 * mục / 11 file** và không đụng một dòng nào của file kia.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ MỖI BỀ MẶT ĐƯỢC ĐO ĐỦ **NĂM CHIỀU** — bốn chiều đầu là điều kiện để cái xanh có nghĩa
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   ÂM  ① người của A **không** thấy đối tượng của B;
 *   ÂM  ② người của B **không** thấy đối tượng của A  ← loại nốt khả năng "A tình cờ luôn thắng"
 *          (thứ tự chèn, id nhỏ hơn, sắp xếp theo tên…);
 *   DƯƠNG ③ mỗi người **CÓ** thấy đúng đối tượng của mình — bản vá không cắt quá tay;
 *   DƯƠNG ④ `admin` thấy **CẢ HAI** — vai toàn quyền giữ nguyên từng byte;
 *   ÂM  ⑤ tài khoản **0 gán nhà máy** thấy **0** — phạm vi RỖNG là kết quả ĐÚNG, không phải
 *          "quên lọc".
 *
 * ⚠ Mọi ca đi qua **`createCaller` của tRPC**, không gọi thẳng tầng `db`. Đó là điều kiện để đo
 * đúng khoảng trống đã sinh ra cả 185 lỗ: hàm dữ liệu vẫn đúng, chính **NƠI GỌI** mới là chỗ bỏ
 * rơi danh tính. Một lưới gọi `db.getStations({userId})` trực tiếp sẽ trao tận tay đúng cái mà
 * router quên trao, nên nó XANH suốt trong khi lỗ mở toang (bài học `reportExportScope.test.ts`).
 *
 * ⚠ **BỐN TRỤC PHẠM VI KHÁC NHAU** được đo, không phải bốn nơi gọi của một trục:
 *   1. **phân cấp theo ID** (`workshop`/`line`/`station`/`machine`) — `idsTrongPhamVi`;
 *   2. **bản ghi kiểm theo MÁY** (`stationAnalysis`, `productionOrder`) — chiếu qua `machineId`;
 *   3. **mã tenant** (`masterData.suppliers/materials`) — `congMaTenant`, trục CHỮ chứ không SỐ;
 *   4. **liên kết ba cột** (`mesControlTower.listWip`) — `wip_tracking` không có cột tenant nào.
 * Bốn bộ suy độc lập; một ca cho mỗi trục là điều kiện để cái xanh nói được điều gì.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;

const FAC_A = `P11-FA-${RUN}`;
const FAC_B = `P11-FB-${RUN}`;
const MC_A = `P11-MC-A-${RUN}`;
const MC_B = `P11-MC-B-${RUN}`;
const WS_A = `P11-W-A-${RUN}`;
const WS_B = `P11-W-B-${RUN}`;
const LN_A = `P11-L-A-${RUN}`;
const LN_B = `P11-L-B-${RUN}`;
const ST_A = `P11-S-A-${RUN}`;
const ST_B = `P11-S-B-${RUN}`;
const SUP_A = `P11-SUP-A-${RUN}`;
const SUP_B = `P11-SUP-B-${RUN}`;
const MAT_A = `P11-MAT-A-${RUN}`;
const MAT_B = `P11-MAT-B-${RUN}`;
const PO_A = `P11-PO-A-${RUN}`;
const PO_B = `P11-PO-B-${RUN}`;
const SN_A = `P11-SN-A-${RUN}`;
const SN_B = `P11-SN-B-${RUN}`;

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0, wsA: 0, wsB: 0, lnA: 0, lnB: 0, stA: 0, stB: 0, mcA: 0, mcB: 0,
  poA: 0, poB: 0, wipA: 0, wipB: 0, supA: 0, supB: 0, matA: 0, matB: 0, pmA: 0, pmB: 0,
  uAdmin: 0, uA: 0, uB: 0, uNone: 0,
};

async function safe(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    /* WORM / FK — có đường dọn thay thế */
  }
}

/**
 * Trích một cột thành mảng chuỗi để so sánh.
 * ⚠ `any` ở đây có chủ ý: các thủ tục được đo trả về **hình dạng hàng KHÁC NHAU** (trạm · tuyến ·
 * máy · lệnh · nhà cung cấp…), và một tham số suy kiểu chung sẽ khiến `tsc` cố hợp nhất chúng
 * thành một union rồi đỏ vì một lý do chẳng liên quan gì tới phạm vi. Ô này chỉ đọc một khoá.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ma = (rows: readonly any[], k: string): string[] => rows.map((r) => String(r[k]));

describe.skipIf(!DB_URL)("phạm vi ĐỌC — đợt 11 file, âm ĐỐI XỨNG trên CSDL thật", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL as string, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const dungNhaMay = async (n: {
      fac: string; ws: string; ln: string; st: string; mc: string;
      po: string; sn: string; sup: string; mat: string;
    }) => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${n.fac}, ${n.fac}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f!.id}, ${n.ws}, ${n.ws}) RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w!.id}, ${n.ln}, ${n.ln}, 100) RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l!.id}, ${n.st}, ${n.st}) RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s!.id}, ${n.mc}, ${n.mc}, 'AOI') RETURNING id`;
      // Bản ghi kiểm — nguồn của mọi số đo chất lượng (stationAnalysis).
      await sql`
        INSERT INTO product_inspections ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
        VALUES (${m!.id}, ${n.sn}, 'NG', 'NG', NOW() - INTERVAL '1 hour', ${n.fac})`;
      const [pm] = await sql`
        INSERT INTO product_models (code, name) VALUES (${`${n.po}-PM`}, ${`${n.po}-PM`}) RETURNING id`;
      const [po] = await sql`
        INSERT INTO production_orders ("orderCode", "lineId", "workshopId", "factoryId", "companyCode", "productModelId", "targetQuantity", status)
        VALUES (${n.po}, ${l!.id}, ${w!.id}, ${f!.id}, ${n.fac}, ${pm!.id}, 10, 'pending') RETURNING id`;
      const [wip] = await sql`
        INSERT INTO wip_tracking ("serialNumber", "lineId", "currentStationId", "currentMachineId", status)
        VALUES (${n.sn}, ${l!.id}, ${s!.id}, ${m!.id}, 'in_process') RETURNING id`;
      const [sup] = await sql`
        INSERT INTO suppliers (code, name, "factoryCode") VALUES (${n.sup}, ${n.sup}, ${n.fac}) RETURNING id`;
      const [mat] = await sql`
        INSERT INTO materials (code, name, "factoryCode") VALUES (${n.mat}, ${n.mat}, ${n.fac}) RETURNING id`;
      return {
        f: f!.id as number, w: w!.id as number, l: l!.id as number, s: s!.id as number,
        m: m!.id as number, po: po!.id as number, wip: wip!.id as number,
        sup: sup!.id as number, mat: mat!.id as number, pm: pm!.id as number,
      };
    };

    const a = await dungNhaMay({ fac: FAC_A, ws: WS_A, ln: LN_A, st: ST_A, mc: MC_A, po: PO_A, sn: SN_A, sup: SUP_A, mat: MAT_A });
    const b = await dungNhaMay({ fac: FAC_B, ws: WS_B, ln: LN_B, st: ST_B, mc: MC_B, po: PO_B, sn: SN_B, sup: SUP_B, mat: MAT_B });
    ids.facA = a.f; ids.wsA = a.w; ids.lnA = a.l; ids.stA = a.s; ids.mcA = a.m; ids.poA = a.po; ids.wipA = a.wip; ids.supA = a.sup; ids.matA = a.mat; ids.pmA = a.pm;
    ids.facB = b.f; ids.wsB = b.w; ids.lnB = b.l; ids.stB = b.s; ids.mcB = b.m; ids.poB = b.po; ids.wipB = b.wip; ids.supB = b.sup; ids.matB = b.mat; ids.pmB = b.pm;

    const mkUser = async (username: string, role: string): Promise<number> => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`p11-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r!.id as number;
    };
    ids.uAdmin = await mkUser(`p11-admin-${RUN}`, "admin");
    ids.uA = await mkUser(`p11-eng-a-${RUN}`, "engineer");
    ids.uB = await mkUser(`p11-eng-b-${RUN}`, "engineer");
    ids.uNone = await mkUser(`p11-none-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uA}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uB}, ${FAC_B})`;

    // ⚠ `masterDataRouter` đứng sau `requirePermission("masterdata","canView")`. Không cấp quyền
    // thì ba tài khoản không-admin nhận FORBIDDEN và ca sẽ "xanh" vì một lý do CHẲNG LIÊN QUAN gì
    // tới phạm vi — đúng lớp lỗi "xanh vì quét trúng 0 thứ". Cấp cho cả ba, kể cả `uNone`: ca ⑤
    // phải chứng minh 0 DÒNG vì phạm vi rỗng, không phải 0 dòng vì bị chặn ở cửa.
    for (const u of [ids.uA, ids.uB, ids.uNone]) {
      await sql`
        INSERT INTO permissions ("userId", category, "moduleName", "canView")
        VALUES (${u}, 'settings', 'masterdata', true)`;
    }

    // `getUserAssignmentCodes` có bộ nhớ đệm 30 giây theo `userId` — xoá tường minh.
    const { clearAssignmentCache } = await import("../_core/accessControl");
    clearAssignmentCache();
  }, 180_000);

  afterAll(async () => {
    try {
      const users = [ids.uAdmin, ids.uA, ids.uB, ids.uNone].filter(Boolean);
      if (users.length) {
        await safe(() => sql`DELETE FROM permissions WHERE "userId" IN ${sql(users)}`);
        await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
      }
      for (const s of [ids.supA, ids.supB]) if (s) await safe(() => sql`DELETE FROM suppliers WHERE id = ${s}`);
      for (const m of [ids.matA, ids.matB]) if (m) await safe(() => sql`DELETE FROM materials WHERE id = ${m}`);
      for (const w of [ids.wipA, ids.wipB]) if (w) await safe(() => sql`DELETE FROM wip_tracking WHERE id = ${w}`);
      for (const p of [ids.poA, ids.poB]) if (p) await safe(() => sql`DELETE FROM production_orders WHERE id = ${p}`);
      for (const p of [ids.pmA, ids.pmB]) if (p) await safe(() => sql`DELETE FROM product_models WHERE id = ${p}`);
      // ⚠⚠ `product_inspections` là bảng **WORM**: `avi_app` bị THU HỒI quyền DELETE có chủ ý
      // (migration 0224/0279). Lượt xoá dưới đây vì thế **THẤT BẠI im lặng** trên môi trường thật,
      // và khi nó thất bại thì cả chuỗi FK phía sau (machines → stations → lines → workshops →
      // factories) cũng không xoá được. Đó KHÔNG phải một lỗi để sửa ở đây — đó là chính sách
      // WORM đang làm đúng việc của nó. Nên có LỐI DỌN THỨ HAI: **xoá mềm** toàn bộ chuỗi phân
      // cấp. Mọi bề mặt trong hệ đều lọc `isActive = true`, nên hàng còn lại không lọt vào phép
      // đếm của bất kỳ suite nào khác; bỏ bước này thì mỗi lượt chạy để lại 5 hàng rác vĩnh viễn
      // và một suite khác sẽ đỏ vì một lý do chẳng liên quan gì tới nó.
      for (const s of [SN_A, SN_B]) await safe(() => sql`DELETE FROM product_inspections WHERE "serialNumber" = ${s}`);
      for (const m of [ids.mcA, ids.mcB]) if (m) await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id = ${m}`);
      for (const s of [ids.stA, ids.stB]) if (s) await safe(() => sql`UPDATE stations SET "isActive" = false WHERE id = ${s}`);
      for (const l of [ids.lnA, ids.lnB]) if (l) await safe(() => sql`UPDATE production_lines SET "isActive" = false WHERE id = ${l}`);
      for (const w of [ids.wsA, ids.wsB]) if (w) await safe(() => sql`UPDATE workshops SET "isActive" = false WHERE id = ${w}`);
      for (const f of [ids.facA, ids.facB]) if (f) await safe(() => sql`UPDATE factories SET "isActive" = false WHERE id = ${f}`);
      for (const m of [ids.mcA, ids.mcB]) if (m) {
        await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id = ${m}`);
        await safe(() => sql`DELETE FROM machines WHERE id = ${m}`);
      }
      for (const s of [ids.stA, ids.stB]) if (s) await safe(() => sql`DELETE FROM stations WHERE id = ${s}`);
      for (const l of [ids.lnA, ids.lnB]) if (l) await safe(() => sql`DELETE FROM production_lines WHERE id = ${l}`);
      for (const w of [ids.wsA, ids.wsB]) if (w) await safe(() => sql`DELETE FROM workshops WHERE id = ${w}`);
      for (const f of [ids.facA, ids.facB]) if (f) await safe(() => sql`DELETE FROM factories WHERE id = ${f}`);
      if (users.length) await safe(() => sql`DELETE FROM users WHERE id IN ${sql(users)}`);
    } finally {
      await sql?.end();
    }
  }, 120_000);

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // TRỤC ① — PHÂN CẤP THEO ID (`idsTrongPhamVi`): xưởng · tuyến · trạm · máy
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("TRỤC ① phân cấp — workshop.list · line.list · station.list", () => {
    const goi = async (r: "workshopRouter" | "lineRouter" | "stationRouter", u: number, role: string) =>
      (await import("./hierarchyRouters"))[r].createCaller(ctxFor(u, role));

    it("★ workshop.list — ÂM ①② hai chiều · DƯƠNG ③④ · ÂM ⑤ 0 gán", async () => {
      const a = ma(await (await goi("workshopRouter", ids.uA, "engineer")).list(), "code");
      const b = ma(await (await goi("workshopRouter", ids.uB, "engineer")).list(), "code");
      const ad = ma(await (await goi("workshopRouter", ids.uAdmin, "admin")).list(), "code");
      const n = await (await goi("workshopRouter", ids.uNone, "supervisor")).list();
      expect(a).not.toContain(WS_B);
      expect(b).not.toContain(WS_A);
      expect(a).toContain(WS_A);
      expect(b).toContain(WS_B);
      expect(ad).toEqual(expect.arrayContaining([WS_A, WS_B]));
      expect(n).toEqual([]);
    });

    it("★ line.list — ÂM ①② hai chiều · DƯƠNG ③④ · ÂM ⑤", async () => {
      const a = ma(await (await goi("lineRouter", ids.uA, "engineer")).list(), "code");
      const b = ma(await (await goi("lineRouter", ids.uB, "engineer")).list(), "code");
      const ad = ma(await (await goi("lineRouter", ids.uAdmin, "admin")).list(), "code");
      const n = await (await goi("lineRouter", ids.uNone, "supervisor")).list();
      expect(a).not.toContain(LN_B);
      expect(b).not.toContain(LN_A);
      expect(a).toContain(LN_A);
      expect(b).toContain(LN_B);
      expect(ad).toEqual(expect.arrayContaining([LN_A, LN_B]));
      expect(n).toEqual([]);
    });

    it("★ station.list — ÂM ①② hai chiều · DƯƠNG ③④ · ÂM ⑤", async () => {
      const a = ma(await (await goi("stationRouter", ids.uA, "engineer")).list(), "code");
      const b = ma(await (await goi("stationRouter", ids.uB, "engineer")).list(), "code");
      const ad = ma(await (await goi("stationRouter", ids.uAdmin, "admin")).list(), "code");
      const n = await (await goi("stationRouter", ids.uNone, "supervisor")).list();
      expect(a).not.toContain(ST_B);
      expect(b).not.toContain(ST_A);
      expect(a).toContain(ST_A);
      expect(b).toContain(ST_B);
      expect(ad).toEqual(expect.arrayContaining([ST_A, ST_B]));
      expect(n).toEqual([]);
    });
  });

  describe("TRỤC ① — machine.listPaged: TRANG và TỔNG phải cùng một phạm vi", () => {
    const goi = async (u: number, role: string) =>
      (await import("./hierarchyRouters")).machineRouter.createCaller(ctxFor(u, role));

    it("★★ `total` KHÔNG được là tổng của TOÀN ĐỘI khi `items` đã bị thu hẹp", async () => {
      // ⚠ Đây là ô canh đúng lớp lỗi dễ vá sót nhất: `getMachinesPaged` chạy HAI truy vấn
      // (trang + `count(*)`). Vá một mà quên hai ⇒ người dùng thấy 1 dòng nhưng "tổng 42" —
      // một phép đếm rò rỉ quy mô đội máy của mọi tenant.
      const a = await (await goi(ids.uA, "engineer")).listPaged({ limit: 200, offset: 0 });
      const b = await (await goi(ids.uB, "engineer")).listPaged({ limit: 200, offset: 0 });
      const n = await (await goi(ids.uNone, "supervisor")).listPaged({ limit: 200, offset: 0 });
      expect(ma(a.items, "code")).not.toContain(MC_B);
      expect(ma(b.items, "code")).not.toContain(MC_A);
      expect(ma(a.items, "code")).toContain(MC_A);
      expect(a.total).toBe(a.items.length);
      expect(b.total).toBe(b.items.length);
      expect(n.items).toEqual([]);
      expect(n.total).toBe(0);
    });

    it("★ machine.getById theo `id` TỰ KHAI của nhà máy kia KHÔNG mở được cửa", async () => {
      const r = await (await goi(ids.uA, "engineer")).getById({ id: ids.mcB });
      expect(r).toBeUndefined();
      // DƯƠNG: máy của chính mình vẫn đọc được (chống vá quá tay thành chặn tất cả).
      const tot = await (await goi(ids.uA, "engineer")).getById({ id: ids.mcA });
      expect((tot as { code?: string } | undefined)?.code).toBe(MC_A);
    });

    it("★ machine.registrationSummary — phép ĐẾM cũng phải nằm trong phạm vi", async () => {
      const a = await (await goi(ids.uA, "engineer")).registrationSummary();
      const ad = await (await goi(ids.uAdmin, "admin")).registrationSummary();
      const n = await (await goi(ids.uNone, "supervisor")).registrationSummary();
      expect(a.total).toBeLessThan(ad.total);
      expect(a.total).toBeGreaterThan(0);
      expect(n.total).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // TRỤC ② — BẢN GHI KIỂM THEO MÁY (bề mặt lộ NHIỀU NHẤT của đợt này)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("TRỤC ② bản ghi kiểm — stationAnalysis.getStationSummary", () => {
    const goi = async (u: number, role: string) =>
      (await import("./stationAnalysisRouter")).stationAnalysisRouter.createCaller(ctxFor(u, role));

    it("★★★ ÂM ①② — `stationId` TỰ KHAI của nhà máy kia trả `null`, KHÔNG trả tên nhà máy kia", async () => {
      // ⚠ Ô đầu trang mang **tên NHÀ MÁY**; nó được đọc TRƯỚC điểm nghẽn `getStationMachineIds`
      // nên nó cần cổng riêng. Nếu bản vá quên cổng ấy, ô này ĐỎ dù mọi con số đã bằng 0.
      expect(await (await goi(ids.uA, "engineer")).getStationSummary({ stationId: ids.stB })).toBeNull();
      expect(await (await goi(ids.uB, "engineer")).getStationSummary({ stationId: ids.stA })).toBeNull();
    });

    it("★ DƯƠNG ③④ — mỗi người vẫn đọc được trạm của mình, admin đọc được cả hai", async () => {
      const a = await (await goi(ids.uA, "engineer")).getStationSummary({ stationId: ids.stA });
      const b = await (await goi(ids.uB, "engineer")).getStationSummary({ stationId: ids.stB });
      const adA = await (await goi(ids.uAdmin, "admin")).getStationSummary({ stationId: ids.stA });
      const adB = await (await goi(ids.uAdmin, "admin")).getStationSummary({ stationId: ids.stB });
      expect((a as { station: { code: string } }).station.code).toBe(ST_A);
      expect((b as { station: { code: string } }).station.code).toBe(ST_B);
      expect((adA as { station: { code: string } }).station.code).toBe(ST_A);
      expect((adB as { station: { code: string } }).station.code).toBe(ST_B);
      // Bản ghi kiểm CÓ THẬT của chính mình vẫn được đếm — chống "vá quá tay thành 0 tất cả".
      expect((a as { totalInspections: number }).totalInspections).toBeGreaterThan(0);
    });

    it("★ ÂM ⑤ — 0 gán ⇒ `null`", async () => {
      expect(await (await goi(ids.uNone, "supervisor")).getStationSummary({ stationId: ids.stA })).toBeNull();
    });

    /**
     * ★★★ Ô này tồn tại vì một ĐỘT BIẾN đã bác bỏ ô trước nó.
     *
     * Bản đầu của bộ ca này dùng `getStationDefects` làm chiều ÂM. Phép đột biến M2 (gỡ cổng khỏi
     * `getStationMachineIds` — ĐIỂM NGHẼN của cả 16 thủ tục) chạy xong vẫn **XANH**: `getStationDefects`
     * đọc `measurement_results`, mà bộ dữ liệu dựng ở đây chỉ có `product_inspections` — nên nó trả
     * `[]` dù cổng còn hay mất. Đó là một **lượng từ TỰ THOẢ**: ô ấy không bao giờ đỏ được, và cái
     * xanh của nó không chứng minh gì.
     *
     * `getFailHistory` đọc THẲNG `product_inspections` (`overallResult = 'NG'`) và trả về
     * `barcode` = số serial, tức nó PHỤ THUỘC THẬT vào điểm nghẽn. M2 làm ô này ĐỎ.
     */
    it("★★★ ÂM ⑥ + DƯƠNG ⑦ — getFailHistory: lịch sử hỏng của trạm kia RỖNG, của mình thì KHÔNG", async () => {
      const kia = await (await goi(ids.uA, "engineer")).getFailHistory({ stationId: ids.stB });
      expect(ma(kia, "barcode")).not.toContain(SN_B);
      expect(kia).toEqual([]);
      const cuaMinh = await (await goi(ids.uA, "engineer")).getFailHistory({ stationId: ids.stA });
      expect(ma(cuaMinh, "barcode")).toContain(SN_A);
      // Chiều ② — đối xứng: người của B cũng không đọc được lịch sử hỏng của trạm A.
      const nguoc = await (await goi(ids.uB, "engineer")).getFailHistory({ stationId: ids.stA });
      expect(nguoc).toEqual([]);
    });
  });

  describe("TRỤC ② lệnh sản xuất — productionOrder.list (trục `lineId`, KHÔNG phải `factoryId`)", () => {
    const goi = async (u: number, role: string) =>
      (await import("./productionRouters")).productionOrderRouter.createCaller(ctxFor(u, role));

    it("★ ÂM ①② · DƯƠNG ③④ · ÂM ⑤", async () => {
      const a = ma(await (await goi(ids.uA, "engineer")).list(), "orderCode");
      const b = ma(await (await goi(ids.uB, "engineer")).list(), "orderCode");
      const ad = ma(await (await goi(ids.uAdmin, "admin")).list(), "orderCode");
      const n = await (await goi(ids.uNone, "supervisor")).list();
      expect(a).not.toContain(PO_B);
      expect(b).not.toContain(PO_A);
      expect(a).toContain(PO_A);
      expect(b).toContain(PO_B);
      expect(ad).toEqual(expect.arrayContaining([PO_A, PO_B]));
      expect(n).toEqual([]);
    });

    it("★ `factoryId` TỰ KHAI của nhà máy kia KHÔNG mở được cửa (cổng AND vào SAU bộ lọc)", async () => {
      const r = await (await goi(ids.uA, "engineer")).list({ factoryId: ids.facB });
      expect(ma(r, "orderCode")).not.toContain(PO_B);
      expect(r).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // TRỤC ③ — MÃ TENANT (chữ, không phải số): dữ liệu chủ
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("TRỤC ③ mã tenant — masterData.suppliers.list · materials.list", () => {
    const goi = async (r: "suppliers" | "materials", u: number, role: string) =>
      (await import("./masterDataRouter")).masterDataRouter.createCaller(ctxFor(u, role))[r];

    it("★★ suppliers.list — ÂM ①② · DƯƠNG ③④ · ÂM ⑤ (0 gán ⇒ `1 = 0`, KHÔNG phải 'không lọc')", async () => {
      const a = ma(await (await goi("suppliers", ids.uA, "engineer")).list(), "code");
      const b = ma(await (await goi("suppliers", ids.uB, "engineer")).list(), "code");
      const ad = ma(await (await goi("suppliers", ids.uAdmin, "admin")).list(), "code");
      const n = await (await goi("suppliers", ids.uNone, "supervisor")).list();
      expect(a).not.toContain(SUP_B);
      expect(b).not.toContain(SUP_A);
      expect(a).toContain(SUP_A);
      expect(b).toContain(SUP_B);
      expect(ad).toEqual(expect.arrayContaining([SUP_A, SUP_B]));
      expect(n).toEqual([]);
    });

    it("★ materials.list — cùng trục, nơi gọi khác (một luật, hai bề mặt)", async () => {
      const a = ma(await (await goi("materials", ids.uA, "engineer")).list(), "code");
      const b = ma(await (await goi("materials", ids.uB, "engineer")).list(), "code");
      expect(a).not.toContain(MAT_B);
      expect(b).not.toContain(MAT_A);
      expect(a).toContain(MAT_A);
      expect(b).toContain(MAT_B);
    });

    it("★ suppliers.get theo `id` TỰ KHAI của nhà máy kia ⇒ `null`", async () => {
      expect(await (await goi("suppliers", ids.uA, "engineer")).get({ id: ids.supB })).toBeNull();
      expect((await (await goi("suppliers", ids.uA, "engineer")).get({ id: ids.supA }))?.code).toBe(SUP_A);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // TRỤC ④ — LIÊN KẾT BA CỘT trên bảng KHÔNG có cột tenant nào (`wip_tracking`)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("TRỤC ④ không có cột tenant — mesControlTower.listWip", () => {
    const goi = async (u: number, role: string) =>
      (await import("./mesControlTowerRouter")).mesControlTowerRouter.createCaller(ctxFor(u, role));

    it("★★ ÂM ①② · DƯƠNG ③④ · ÂM ⑤ — phán quyết CHỈ bằng lineId/stationId/machineId", async () => {
      const a = ma(await (await goi(ids.uA, "engineer")).listWip(), "serialNumber");
      const b = ma(await (await goi(ids.uB, "engineer")).listWip(), "serialNumber");
      const ad = ma(await (await goi(ids.uAdmin, "admin")).listWip(), "serialNumber");
      const n = await (await goi(ids.uNone, "supervisor")).listWip();
      expect(a).not.toContain(SN_B);
      expect(b).not.toContain(SN_A);
      expect(a).toContain(SN_A);
      expect(b).toContain(SN_B);
      expect(ad).toEqual(expect.arrayContaining([SN_A, SN_B]));
      expect(n).toEqual([]);
    });

    it("★ nameLookup — BẢN ĐỒ phân cấp cũng phải thu hẹp (nó là thứ cho phép ĐOÁN id)", async () => {
      const a = await (await goi(ids.uA, "engineer")).nameLookup();
      const n = await (await goi(ids.uNone, "supervisor")).nameLookup();
      expect(ma(a.lines, "code")).not.toContain(LN_B);
      expect(ma(a.lines, "code")).toContain(LN_A);
      expect(ma(a.machines, "code")).not.toContain(MC_B);
      expect(n.lines).toEqual([]);
      expect(n.stations).toEqual([]);
      expect(n.machines).toEqual([]);
    });
  });
});

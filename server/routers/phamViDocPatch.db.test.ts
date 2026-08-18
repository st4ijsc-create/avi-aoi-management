/**
 * ★★★ 2026-08-18 — **ÂM ĐỐI XỨNG TRÊN CSDL THẬT cho ba ca chuẩn của điều tra dân số phạm vi đọc.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA LỖ ĐÃ ĐO (trước bản vá) — cả ba là **cùng MỘT hình dạng**, không phải ba sự cố riêng
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `factory.list`                  `protectedProcedure.query(async () => db.getFactories())`
 *   • `mqttClient.getAllMachineHealth` `protectedProcedure.query(async () => …db.getMachines())`
 *   • `mqttClient.getDowntimeHistory`  `.query(async ({ input }) => getDowntimeHistory(input))`
 *
 * Không thủ tục nào **nhận `ctx`**, và hệ này **không có danh tính ngầm** (RLS ở tầng CSDL nằm im —
 * `runWithTenantScope` có 0 nơi gọi sản xuất; xem `phamViDocScan.ts`). ⇒ mọi tài khoản đã đăng
 * nhập đọc được danh sách nhà máy, toàn đội máy, và 1.000 sự kiện dừng máy gần nhất của **mọi
 * tenant**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHẢI **ĐỐI XỨNG**, KHÔNG PHẢI MỘT CHIỀU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một lưới chỉ đo *"người của A không thấy dữ liệu B"* **không loại được** khả năng bản vá đã cắt
 * sạch: nếu `getMachines` trả `[]` cho mọi người thì ô ấy vẫn XANH, và tính năng đã chết mà không
 * ai biết. Nên mỗi bề mặt được đo **cả bốn** phía:
 *   ÂM  ① người của A **không** thấy đối tượng của B;
 *   ÂM  ② người của B **không** thấy đối tượng của A  ← chiều thứ hai loại nốt khả năng "A tình
 *          cờ luôn thắng" (thứ tự chèn, id nhỏ hơn, sắp xếp theo tên…);
 *   DƯƠNG ③ người của B **CÓ** thấy đúng đối tượng của B — bản vá không cắt quá tay;
 *   DƯƠNG ④ `admin` thấy **CẢ HAI** — vai toàn quyền giữ nguyên từng byte.
 * Và một chiều thứ năm: người **0 gán nhà máy** thấy **0** (phạm vi RỖNG là kết quả ĐÚNG, không
 * phải "quên lọc").
 *
 * ⚠ Ca chạy qua **createCaller của tRPC**, không gọi thẳng tầng `db`. Đó là điều kiện để đo đúng
 * khoảng trống đã sinh ra ba lỗ này: hàm dữ liệu vẫn đúng, chính **NƠI GỌI** mới là chỗ bỏ rơi
 * danh tính. Một lưới gọi `getMachines({userId})` trực tiếp sẽ trao tận tay đúng cái mà router
 * quên trao, nên nó XANH suốt trong khi lỗ mở toang — đúng bài học `reportExportScope.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`;

const FAC_A = `PV-FA-${RUN}`;
const FAC_B = `PV-FB-${RUN}`;
const MC_A = `PV-MC-A-${RUN}`;
const MC_B = `PV-MC-B-${RUN}`;

const ctxFor = (id: number, role: string) => ({ user: { id, role, name: `u${id}` } }) as never;

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0,
  wsA: 0, wsB: 0, lnA: 0, lnB: 0, stA: 0, stB: 0, mcA: 0, mcB: 0,
  dtA: 0, dtB: 0,
  uAdmin: 0, uA: 0, uB: 0, uNone: 0,
};

async function safe(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    /* WORM / FK — có đường dọn thay thế */
  }
}

describe.skipIf(!DB_URL)("phạm vi ĐỌC — ba ca chuẩn, âm ĐỐI XỨNG trên CSDL thật", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL as string, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`SET TIME ZONE 'UTC'`;

    const dungNhaMay = async (ma: string, ten: string, mcCode: string) => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${ma}, ${ten}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f!.id}, ${`${ma}-W`}, ${`${ten} ws`}) RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name, "capacityPerHour") VALUES (${w!.id}, ${`${ma}-L`}, ${`${ten} line`}, 100) RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l!.id}, ${`${ma}-S`}, ${`${ten} st`}) RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s!.id}, ${mcCode}, ${`${ten} mc`}, 'AOI') RETURNING id`;
      const [d] = await sql`
        INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime")
        VALUES (${m!.id}, ${mcCode}, 'unplanned', ${`ly do ${ma}`}, NOW() - INTERVAL '2 hours') RETURNING id`;
      return { f: f!.id as number, w: w!.id as number, l: l!.id as number, s: s!.id as number, m: m!.id as number, d: d!.id as number };
    };

    const a = await dungNhaMay(FAC_A, "PV factory A", MC_A);
    const b = await dungNhaMay(FAC_B, "PV factory B", MC_B);
    ids.facA = a.f; ids.wsA = a.w; ids.lnA = a.l; ids.stA = a.s; ids.mcA = a.m; ids.dtA = a.d;
    ids.facB = b.f; ids.wsB = b.w; ids.lnB = b.l; ids.stB = b.s; ids.mcB = b.m; ids.dtB = b.d;

    const mkUser = async (username: string, role: string): Promise<number> => {
      const [r] = await sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`pv-${username}`}, ${username}, ${username}, ${role}, true) RETURNING id`;
      return r!.id as number;
    };
    ids.uAdmin = await mkUser(`pv-admin-${RUN}`, "admin");
    ids.uA = await mkUser(`pv-eng-a-${RUN}`, "engineer");
    ids.uB = await mkUser(`pv-eng-b-${RUN}`, "engineer");
    ids.uNone = await mkUser(`pv-none-${RUN}`, "supervisor");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uA}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids.uB}, ${FAC_B})`;

    // ⚠ `getUserAssignmentCodes` có bộ nhớ đệm 30 giây theo `userId`. Bốn tài khoản vừa tạo chưa
    // từng được hỏi nên đệm rỗng — nhưng xoá tường minh để lưới không phụ thuộc vào điều đó.
    const { clearAssignmentCache } = await import("../_core/accessControl");
    clearAssignmentCache();
  }, 180_000);

  afterAll(async () => {
    try {
      const users = [ids.uAdmin, ids.uA, ids.uB, ids.uNone].filter(Boolean);
      if (users.length) await safe(() => sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(users)}`);
      for (const d of [ids.dtA, ids.dtB]) if (d) await safe(() => sql`DELETE FROM downtime_events WHERE id = ${d}`);
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

  const goiHierarchy = async (userId: number, role: string) =>
    (await import("./hierarchyRouters")).factoryRouter.createCaller(ctxFor(userId, role));
  const goiOee = async (userId: number, role: string) =>
    (await import("./mqttOeeRouters")).mqttClientRouter.createCaller(ctxFor(userId, role));

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CA CHUẨN #1 — `factory.list`
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("factory.list", () => {
    const maCua = (rows: Array<{ code: string }>): string[] => rows.map((r) => r.code);

    it("ÂM ① người của A KHÔNG thấy nhà máy B · ÂM ② người của B KHÔNG thấy nhà máy A", async () => {
      const a = maCua(await (await goiHierarchy(ids.uA, "engineer")).list());
      const b = maCua(await (await goiHierarchy(ids.uB, "engineer")).list());
      expect(a).not.toContain(FAC_B);
      expect(b).not.toContain(FAC_A);
    });

    it("DƯƠNG ③ mỗi người VẪN thấy nhà máy CỦA MÌNH (chống vá quá tay thành chặn tất cả)", async () => {
      const a = maCua(await (await goiHierarchy(ids.uA, "engineer")).list());
      const b = maCua(await (await goiHierarchy(ids.uB, "engineer")).list());
      expect(a).toContain(FAC_A);
      expect(b).toContain(FAC_B);
    });

    it("DƯƠNG ④ admin thấy CẢ HAI", async () => {
      const ad = maCua(await (await goiHierarchy(ids.uAdmin, "admin")).list());
      expect(ad).toEqual(expect.arrayContaining([FAC_A, FAC_B]));
    });

    it("ÂM ⑤ tài khoản 0 gán nhà máy thấy 0 nhà máy (phạm vi RỖNG là kết quả ĐÚNG)", async () => {
      const n = await (await goiHierarchy(ids.uNone, "supervisor")).list();
      expect(n).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CA CHUẨN #2 — `mqttClient.getAllMachineHealth`
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("mqttClient.getAllMachineHealth", () => {
    const maCua = (rows: Array<{ machineCode: string }>): string[] => rows.map((r) => r.machineCode);

    it("ÂM ①② hai chiều — A không thấy máy B, B không thấy máy A", async () => {
      const a = maCua(await (await goiOee(ids.uA, "engineer")).getAllMachineHealth());
      const b = maCua(await (await goiOee(ids.uB, "engineer")).getAllMachineHealth());
      expect(a).not.toContain(MC_B);
      expect(b).not.toContain(MC_A);
    });

    it("DƯƠNG ③ mỗi người VẪN thấy máy của mình · ④ admin thấy cả hai", async () => {
      const a = maCua(await (await goiOee(ids.uA, "engineer")).getAllMachineHealth());
      const b = maCua(await (await goiOee(ids.uB, "engineer")).getAllMachineHealth());
      const ad = maCua(await (await goiOee(ids.uAdmin, "admin")).getAllMachineHealth());
      expect(a).toContain(MC_A);
      expect(b).toContain(MC_B);
      expect(ad).toEqual(expect.arrayContaining([MC_A, MC_B]));
    });

    it("ÂM ⑤ 0 gán ⇒ 0 máy", async () => {
      const n = await (await goiOee(ids.uNone, "supervisor")).getAllMachineHealth();
      expect(n).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // BỀ MẶT #4 (cùng hình dạng, lộ nặng nhất) — `machine.list`
  // ⚠ 30+ nơi gọi ở client ăn thủ tục này. Nó dùng CHUNG nguyên thuỷ `machineIdsTrongPhamVi` với
  // `getAllMachineHealth`, nên đo cả hai là đo hai NƠI GỌI của một luật — không phải chép ca.
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("machine.list", () => {
    const goiMachine = async (userId: number, role: string) =>
      (await import("./hierarchyRouters")).machineRouter.createCaller(ctxFor(userId, role));
    const maCua = (rows: Array<{ code: string }>): string[] => rows.map((r) => r.code);

    it("ÂM ①② hai chiều · DƯƠNG ③④ · ÂM ⑤ 0 gán", async () => {
      const a = maCua(await (await goiMachine(ids.uA, "engineer")).list());
      const b = maCua(await (await goiMachine(ids.uB, "engineer")).list());
      const ad = maCua(await (await goiMachine(ids.uAdmin, "admin")).list());
      const n = await (await goiMachine(ids.uNone, "supervisor")).list();
      expect(a).not.toContain(MC_B);
      expect(b).not.toContain(MC_A);
      expect(a).toContain(MC_A);
      expect(b).toContain(MC_B);
      expect(ad).toEqual(expect.arrayContaining([MC_A, MC_B]));
      expect(n).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // CA CHUẨN #3 — `mqttClient.getDowntimeHistory`
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe("mqttClient.getDowntimeHistory", () => {
    const maCua = (rows: Array<{ machineCode: string }>): string[] => rows.map((r) => r.machineCode);

    it("ÂM ①② hai chiều — không ai đọc được sự kiện dừng máy của nhà máy kia", async () => {
      const a = maCua(await (await goiOee(ids.uA, "engineer")).getDowntimeHistory({}));
      const b = maCua(await (await goiOee(ids.uB, "engineer")).getDowntimeHistory({}));
      expect(a).not.toContain(MC_B);
      expect(b).not.toContain(MC_A);
    });

    it("DƯƠNG ③ mỗi người VẪN đọc được sự kiện của mình · ④ admin đọc được cả hai", async () => {
      const a = maCua(await (await goiOee(ids.uA, "engineer")).getDowntimeHistory({}));
      const b = maCua(await (await goiOee(ids.uB, "engineer")).getDowntimeHistory({}));
      const ad = maCua(await (await goiOee(ids.uAdmin, "admin")).getDowntimeHistory({}));
      expect(a).toContain(MC_A);
      expect(b).toContain(MC_B);
      expect(ad).toEqual(expect.arrayContaining([MC_A, MC_B]));
    });

    it("★ ÂM ⑥ `machineId` TỰ KHAI của nhà máy kia KHÔNG mở được cửa", async () => {
      // ⚠ Ô này canh đúng chỗ dễ vá sai nhất: nếu cổng phạm vi được AND vào SAU bộ lọc `machineId`
      // của người gọi mà không kiểm nhau, một `machineId` tự khai vẫn lọt. `input` là lời TỰ KHAI.
      const r = await (await goiOee(ids.uA, "engineer")).getDowntimeHistory({ machineId: ids.mcB });
      expect(r).toEqual([]);
    });

    it("ÂM ⑤ 0 gán ⇒ 0 sự kiện", async () => {
      const n = await (await goiOee(ids.uNone, "supervisor")).getDowntimeHistory({});
      expect(n).toEqual([]);
    });
  });
});

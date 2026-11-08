/**
 * dieu-phoi duyệt 08/11 — `search` và `searchKpi`: id lọc NGOÀI phạm vi và id KHÔNG TỒN TẠI phải cho phản hồi GIỐNG HỆT
 * (không lộ sự tồn tại), và id không tồn tại KHÔNG được trả dữ liệu toàn phạm vi (lỗi cũ: `if (m?.code)` im lặng bỏ bộ lọc).
 *
 * Dữ liệu dựng trong MỘT giao dịch BEGIN…ROLLBACK trên một kết nối (không để lại gì, kể cả bảng WORM), getDb mock trỏ vào
 * kết nối đó (khuôn scheduledReportScope.db.test.ts). Nhà máy A (3 lần kiểm) và B (2 lần kiểm); kỹ sư gán nhà máy A.
 * Cửa sổ ngày 2031 (không có dữ liệu thật) nên mọi con số là tuyệt đối.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return { ...actual, getDb: async () => h.db, getReadDb: async () => h.db, getJobsDb: async () => h.db };
});

import { inspectionRouter } from "./inspectionRouters";

const DB_URL = process.env.DATABASE_URL;
const RUN = `KK${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const T = new Date("2031-03-15T12:00:00.000Z");
const WIN = { startDate: new Date("2031-03-01T00:00:00Z"), endDate: new Date("2031-03-30T00:00:00Z") };
const KHONG_TON_TAI = 2_000_000_000;
let sql: ReturnType<typeof postgres>;
const ids = { facA: 0, facB: 0, lineA: 0, lineB: 0, machA: 0, machB: 0, user: 0 };

describe.skipIf(!DB_URL)("search / searchKpi — id ngoài phạm vi ≡ id không tồn tại (DB thật, giao dịch ROLLBACK)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    await sql`BEGIN`;
    await sql`SET LOCAL TIME ZONE 'UTC'`;
    h.db = drizzle(sql);
    const mk = async (tag: "A" | "B") => {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${`KK-F-${tag}-${RUN}`}, ${"KK " + tag}) RETURNING id`;
      const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${`KK-W-${tag}-${RUN}`}, 'w') RETURNING id`;
      const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${`KK-L-${tag}-${RUN}`}, 'l') RETURNING id`;
      const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${`KK-S-${tag}-${RUN}`}, 's') RETURNING id`;
      const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${`KK-M-${tag}-${RUN}`}, 'm', 'AOI') RETURNING id`;
      return { fac: f.id as number, line: l.id as number, mach: m.id as number, facCode: `KK-F-${tag}-${RUN}` };
    };
    const A = await mk("A");
    const B = await mk("B");
    Object.assign(ids, { facA: A.fac, facB: B.fac, lineA: A.line, lineB: B.line, machA: A.mach, machB: B.mach });
    const [p] = await sql`INSERT INTO product_models (code, name) VALUES (${`KK-P-${RUN}`}, 'p') RETURNING id`;
    let n = 0;
    const insp = async (machineId: number, factoryCode: string) => {
      await sql`
        INSERT INTO product_inspections ("machineId", "productModelId", "factoryCode", "serialNumber", "overallResult", "originalResult", "inspectionTime")
        VALUES (${machineId}, ${p.id}, ${factoryCode}, ${`SN-${RUN}-${n++}`}, 'OK', 'OK', ${T.toISOString()})`;
    };
    for (let i = 0; i < 3; i++) await insp(A.mach, A.facCode);
    for (let i = 0; i < 2; i++) await insp(B.mach, B.facCode);
    const [u] = await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`kk-${RUN}`}, ${`kk-${RUN}`}, 'kk', 'engineer', true) RETURNING id`;
    ids.user = u.id;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${A.facCode})`;
  }, 180_000);

  afterAll(async () => {
    try {
      await sql`ROLLBACK`;
    } finally {
      await sql?.end();
    }
  }, 120_000);

  const caller = () => inspectionRouter.createCaller({ user: { id: ids.user, role: "engineer", name: "kk", twoFactorEnabled: true } } as never);
  const kpi = (extra: Record<string, unknown>) => caller().searchKpi({ ...WIN, ...extra } as never);
  const ds = (extra: Record<string, unknown>) => caller().search({ ...WIN, ...extra } as never);

  it("nền: người gán nhà máy A thấy 3 lần kiểm (không lọc) — không thấy 2 của B", async () => {
    expect(Number((await kpi({})).total)).toBe(3);
    expect(Number((await ds({})).total)).toBe(3);
  });

  it("id hợp lệ TRONG phạm vi vẫn lọc đúng như cũ (máy A / tuyến A / nhà máy A ⇒ 3)", async () => {
    for (const f of [{ machineId: ids.machA }, { lineId: ids.lineA }, { factoryId: ids.facA }]) {
      expect(Number((await kpi(f)).total)).toBe(3);
      expect(Number((await ds(f)).total)).toBe(3);
    }
  });

  for (const [ten, khong] of [
    ["machineId", { machineId: KHONG_TON_TAI }],
    ["lineId", { lineId: KHONG_TON_TAI }],
    ["factoryId", { factoryId: KHONG_TON_TAI }],
  ] as const) {
    const idB = ten === "machineId" ? () => ids.machB : ten === "lineId" ? () => ids.lineB : () => ids.facB;
    it(`searchKpi — ${ten}: id NGOÀI phạm vi (của B) ≡ id KHÔNG TỒN TẠI (deepEqual toàn bộ), tổng 0, khác phản hồi khi không lọc`, async () => {
      const ngoai = await kpi({ [ten]: idB() });
      const khongTonTai = await kpi(khong);
      expect(khongTonTai).toEqual(ngoai); // GIỐNG HỆT
      expect(Number(khongTonTai.total)).toBe(0); // KHÔNG phải toàn phạm vi (3)
      expect(Number((await kpi({})).total)).toBe(3);
    });
    it(`search — ${ten}: id NGOÀI phạm vi (của B) ≡ id KHÔNG TỒN TẠI (deepEqual toàn bộ), danh sách rỗng, khác phản hồi khi không lọc`, async () => {
      const ngoai = await ds({ [ten]: idB() });
      const khongTonTai = await ds(khong);
      expect(khongTonTai).toEqual(ngoai);
      expect(Number(khongTonTai.total)).toBe(0);
      expect(khongTonTai.data).toEqual([]);
      expect(Number((await ds({})).total)).toBe(3);
    });
  }
});

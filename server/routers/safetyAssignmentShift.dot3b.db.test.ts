/**
 * doc 81 Đợt 3b Task 1 — CA TRÊN PHÂN CÔNG + LỌC CA PHÍA SERVER (`safety.listAssignments` / `assignOperator` /
 * `reassignOperator`) trên CSDL THẬT `_test`.
 *
 * Hợp đồng (task-1-brief + plan Review Focus #1, doc 81 §12 "Đã chốt 2026-10-06"):
 *   §1 `listAssignments` nhận `shiftConfigId` TUỲ CHỌN, lọc trong SQL (`null` = chưa gắn ca ⇒ IS NULL). Lọc TRƯỚC `limit`
 *      (ô quyết định: hàng MỚI NHẤT thuộc ca khác + `limit: 1` ⇒ vẫn ra hàng của ca được lọc — lọc sau `limit` sẽ ra RỖNG).
 *      Không truyền ca ⇒ hành vi `{status, limit}` cũ (không lọc ngầm). Phạm vi tenant/nhà máy GIỮ NGUYÊN như cũ: bộ lọc ca
 *      không thu hẹp cũng không nới ai thấy gì (thủ tục vẫn là một mục nợ trong `phamViDocBaseline.ts` — Task này không đổi).
 *   §2 `assignOperator`/`reassignOperator` nhận `shiftConfigId` TUỲ CHỌN: phải TỒN TẠI, ĐANG HOẠT ĐỘNG và TRONG PHẠM VI người
 *      gọi (ca toàn hệ thống `factoryId IS NULL` thuộc mọi phạm vi). Ngoài phạm vi ⇒ CÙNG câu "không tìm thấy" như id không
 *      tồn tại (không lộ sự tồn tại). Bỏ ca ⇒ y như trước (`shiftConfigId` NULL). Ca sai ⇒ KHÔNG ghi gì (phân công lại: phân
 *      công cũ KHÔNG bị huỷ). Cờ nhân lực TẮT ⇒ FEATURE_DISABLED như cũ, kể cả khi ca sai (thứ tự cổng không đổi).
 *
 * ★ Oracle độc lập: đọc lại bằng SQL THÔ (`postgres`), không tin giá trị router trả về.
 * ★ G43: ô bị chặn khẳng định appCode của ĐÚNG cổng (ENTITY_NOT_FOUND / INVALID_VALUE), không phải PERMISSION_DENIED.
 * ★ Bảng dùng chung với tệp chạy song song ⇒ mọi khẳng định chỉ trên hàng CỦA RIÊNG lượt này (ca/người vận hành mới tạo).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { resolvePermissionModule } from "@shared/permissions";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D3B1-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
/**
 * Người vận hành. Đợt 3b final wave (rà soát bảo mật — vượt phạm vi khi GHI): người vận hành phải là người dùng THẬT, đang
 * hoạt động, TRONG phạm vi người gọi ⇒ lượt này gieo sẵn một nhóm người dùng thuộc nhà máy TRONG; `nextOp()` lấy lần lượt.
 */
const OP_POOL: number[] = [];
let opSeq = 0;
const nextOp = () => {
  if (opSeq >= OP_POOL.length) throw new Error("hết người vận hành gieo sẵn — tăng OP_POOL_SIZE");
  return OP_POOL[opSeq++];
};
const OP_POOL_SIZE = 80;

let sql: ReturnType<typeof postgres>;
const savedWorkforce = process.env.WORKFORCE_ENABLED;

interface Fx {
  facIn: number;
  facOut: number;
  facInCode: string;
  shiftIn: number;
  shiftOut: number;
  shiftGlobal: number;
  shiftOff: number;
  shiftMissing: number;
  userScoped: number;
  userEmpty: number;
  ops: number[];
  // final wave (I2) — chuyền/trạm thật của từng nhà máy (production_lines → workshops.factoryId).
  wsIn: number;
  wsOut: number;
  lineIn: number;
  lineOut: number;
  stationOut: number;
  lineMissing: number;
  // rà soát bảo mật (ghi): trạm TRONG, người vận hành của nhà máy NGOÀI, người dùng vô hiệu, id người dùng không tồn tại
  stationIn: number;
  opOut: number;
  opInactive: number;
  opMissing: number;
}
let fx: Fx;

const one = async (q: Promise<unknown[]>) => Number(((await q)[0] as { id: number | string }).id);

async function errOf(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: err.code, appCode: err.cause?.appCode, appParams: err.cause?.appParams };
  }
}

const caller = async (ctx: object) => (await import("./safetyRouter")).safetyRouter.createCaller(ctx as never);
const asAdmin = () => caller({ user: { id: 960001, role: "admin", name: "d3b1-admin" } });
const asScoped = () => caller({ user: { id: fx.userScoped, role: "engineer", name: "d3b1-scoped" } });
const asEmpty = () => caller({ user: { id: fx.userEmpty, role: "engineer", name: "d3b1-empty" } });

async function rowsOf(operatorId: number) {
  return (await sql`
    SELECT id, "operatorId", "shiftConfigId", status FROM operator_assignments
     WHERE "operatorId" = ${operatorId} ORDER BY id`) as unknown as Array<{ id: number; operatorId: number; shiftConfigId: number | null; status: string }>;
}
/**
 * Hàng phân công gieo bằng SQL thô. Đợt 3b final wave (rà soát bảo mật): `listAssignments` nay lọc theo phạm vi nhà máy của
 * HÀNG (factoryId › chuyền › trạm) ⇒ hàng gieo mặc định thuộc nhà máy TRONG (`fx.facIn`); `where` cho phép gieo hàng nhà
 * máy khác / mồ côi.
 */
async function seedAssignment(
  operatorId: number,
  shiftConfigId: number | null,
  start: string,
  status = "planned",
  where: { factoryId?: number | null; lineId?: number | null; stationId?: number | null } = { factoryId: fx.facIn },
) {
  fx.ops.push(operatorId);
  return one(sql`
    INSERT INTO operator_assignments ("operatorId", "shiftConfigId", status, role, "assignedStart", "assignedEnd", "factoryId", "lineId", "stationId")
    VALUES (${operatorId}, ${shiftConfigId}, ${status}, 'human', ${start}::timestamp, ${start}::timestamp + interval '1 hour',
            ${where.factoryId ?? null}, ${where.lineId ?? null}, ${where.stationId ?? null})
    RETURNING id`);
}

describe.skipIf(!DB_URL)("Đợt 3b Task 1 — ca trên phân công + lọc ca phía server (CSDL THẬT _test)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const facInCode = `${DAU}-IN`;
    const facIn = await one(sql`INSERT INTO factories (code, name) VALUES (${facInCode}, ${`${DAU} trong`}) RETURNING id`);
    const facOut = await one(sql`INSERT INTO factories (code, name) VALUES (${`${DAU}-OUT`}, ${`${DAU} ngoai`}) RETURNING id`);
    const mkShift = (factoryId: number | null, code: string, active: boolean) =>
      one(sql`
        INSERT INTO shift_configs ("factoryId", name, code, "startHour", "endHour", "isActive")
        VALUES (${factoryId}, ${`${DAU} ${code}`}, ${code}, 6, 14, ${active}) RETURNING id`);
    const shiftIn = await mkShift(facIn, "D3IN", true);
    const shiftOut = await mkShift(facOut, "D3OUT", true);
    const shiftGlobal = await mkShift(null, "D3GL", true);
    const shiftOff = await mkShift(facIn, "D3OFF", false);
    const [{ max }] = (await sql`SELECT COALESCE(MAX(id), 0)::int AS max FROM shift_configs`) as unknown as Array<{ max: number }>;
    const mkUser = async (suffix: string) =>
      one(sql`
        INSERT INTO users ("openId", username, name, role, "isActive")
        VALUES (${`${DAU}-${suffix}`}, ${`${DAU}-${suffix}`}, ${`${DAU} ${suffix}`}, 'engineer', true) RETURNING id`);
    const userScoped = await mkUser("scoped");
    const userEmpty = await mkUser("empty");
    for (const uid of [userScoped, userEmpty]) {
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate")
                VALUES (${uid}, 'machine_control', ${resolvePermissionModule("machine_control")}, true, true)`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView")
                VALUES (${uid}, 'machine_monitoring', ${resolvePermissionModule("machine_monitoring")}, true)`;
    }
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${userScoped}, ${facInCode})`;
    // final wave (I2): xưởng → chuyền → trạm của mỗi nhà máy.
    const wsIn = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${facIn}, ${`${DAU}-WI`}, ${`${DAU} xuong trong`}) RETURNING id`);
    const wsOut = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${facOut}, ${`${DAU}-WO`}, ${`${DAU} xuong ngoai`}) RETURNING id`);
    const lineIn = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wsIn}, ${`${DAU}-LI`}, ${`${DAU} chuyen trong`}) RETURNING id`);
    const lineOut = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${wsOut}, ${`${DAU}-LO`}, ${`${DAU} chuyen ngoai`}) RETURNING id`);
    const stationOut = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lineOut}, ${`${DAU}-SO`}, ${`${DAU} tram ngoai`}) RETURNING id`);
    const stationIn = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lineIn}, ${`${DAU}-SI`}, ${`${DAU} tram trong`}) RETURNING id`);
    const [{ maxLine }] = (await sql`SELECT COALESCE(MAX(id), 0)::int AS "maxLine" FROM production_lines`) as unknown as Array<{ maxLine: number }>;
    // người vận hành THẬT (nhà máy TRONG) + một người của nhà máy NGOÀI + một người vô hiệu
    for (let i = 0; i < OP_POOL_SIZE; i++) {
      const id = await mkUser(`op${i}`);
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${id}, ${facInCode})`;
      OP_POOL.push(id);
    }
    const opOut = await mkUser("opOut");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${opOut}, ${`${DAU}-OUT`})`;
    const opInactive = await mkUser("opOff");
    await sql`UPDATE users SET "isActive" = false WHERE id = ${opInactive}`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${opInactive}, ${facInCode})`;
    const [{ maxUser }] = (await sql`SELECT COALESCE(MAX(id), 0)::int AS "maxUser" FROM users`) as unknown as Array<{ maxUser: number }>;
    fx = {
      facIn, facOut, facInCode, shiftIn, shiftOut, shiftGlobal, shiftOff, shiftMissing: max + 100_000, userScoped, userEmpty, ops: [],
      wsIn, wsOut, lineIn, lineOut, stationOut, lineMissing: maxLine + 100_000,
      stationIn, opOut, opInactive, opMissing: maxUser + 100_000,
    };
    process.env.WORKFORCE_ENABLED = "true";
  }, 90_000);

  afterEach(() => {
    process.env.WORKFORCE_ENABLED = "true";
  });

  afterAll(async () => {
    if (savedWorkforce === undefined) delete process.env.WORKFORCE_ENABLED;
    else process.env.WORKFORCE_ENABLED = savedWorkforce;
    if (!sql) return;
    if (fx) {
      const uids = [fx.userScoped, fx.userEmpty, ...OP_POOL, fx.opOut, fx.opInactive].filter(Boolean);
      // final wave: dọn RỘNG — mọi hàng của người vận hành / nhà máy / chuyền / trạm CỦA LƯỢT NÀY (kể cả hàng một lần chạy đột biến
      // ghi cho opOut / opInactive / opMissing mà ca không kịp đưa vào fx.ops) — không để rò sang `_test` dùng chung.
      const opIds = [...new Set([...fx.ops, ...OP_POOL, fx.opOut, fx.opInactive, fx.opMissing].filter((x) => x != null))];
      await sql`DELETE FROM operator_assignments WHERE "operatorId" = ANY(${opIds})
        OR "factoryId" = ANY(${[fx.facIn, fx.facOut]})
        OR "lineId" = ANY(${[fx.lineIn, fx.lineOut].filter(Boolean)})
        OR "stationId" = ANY(${[fx.stationIn, fx.stationOut].filter(Boolean)})`;
      await sql`DELETE FROM shift_configs WHERE id = ANY(${[fx.shiftIn, fx.shiftOut, fx.shiftGlobal, fx.shiftOff]})`;
      if (fx.stationOut) await sql`DELETE FROM stations WHERE id = ANY(${[fx.stationOut, fx.stationIn].filter(Boolean)})`;
      if (fx.lineIn) await sql`DELETE FROM production_lines WHERE id = ANY(${[fx.lineIn, fx.lineOut]})`;
      if (fx.wsIn) await sql`DELETE FROM workshops WHERE id = ANY(${[fx.wsIn, fx.wsOut]})`;
      await sql`DELETE FROM permissions WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" = ANY(${uids})`;
      await sql`DELETE FROM users WHERE id = ANY(${uids})`;
      await sql`DELETE FROM factories WHERE id = ANY(${[fx.facIn, fx.facOut]})`;
    }
    await sql.end({ timeout: 5 });
  }, 60_000);

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("§0 — dữ kiện nền", () => {
    it("bốn ca khác nhau, ca TẮT thật sự tắt, id 'không tồn tại' thật sự không có", async () => {
      expect(new Set([fx.shiftIn, fx.shiftOut, fx.shiftGlobal, fx.shiftOff]).size).toBe(4);
      const r = (await sql`SELECT id, "isActive", "factoryId" FROM shift_configs WHERE id = ANY(${[fx.shiftOff, fx.shiftMissing]})`) as unknown as Array<{ id: number; isActive: boolean }>;
      expect(r).toEqual([expect.objectContaining({ id: fx.shiftOff, isActive: false })]);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("§1 — listAssignments: lọc ca trong SQL, giữ {status, limit} khi không có ca", () => {
    let op: number;
    const ids = { gl: 0, in1: 0, in2: 0, none: 0 };
    beforeAll(async () => {
      op = nextOp();
      // Hàng MỚI NHẤT thuộc ca toàn hệ thống; hai hàng ca TRONG cũ hơn; một hàng chưa gắn ca cũ nhất.
      ids.gl = await seedAssignment(op, fx.shiftGlobal, "2099-01-04T00:00:00");
      ids.in1 = await seedAssignment(op, fx.shiftIn, "2099-01-03T00:00:00");
      ids.in2 = await seedAssignment(op, fx.shiftIn, "2099-01-02T00:00:00", "active");
      ids.none = await seedAssignment(op, null, "2099-01-01T00:00:00");
    });

    it("lọc theo một ca ⇒ ĐÚNG các hàng của ca đó (toàn bảng — ca mới tạo chỉ lượt này dùng)", async () => {
      const r = await (await asAdmin()).listAssignments({ shiftConfigId: fx.shiftIn, limit: 500 });
      expect(r.map((x) => x.id).sort()).toEqual([ids.in1, ids.in2].sort());
      expect(r.every((x) => x.shiftConfigId === fx.shiftIn)).toBe(true);
    });

    it("★ lọc TRƯỚC limit: hàng mới nhất thuộc ca khác + limit 1 ⇒ vẫn ra hàng mới nhất CỦA CA (lọc sau limit sẽ rỗng)", async () => {
      const s = await asAdmin();
      const plain = await s.listAssignments({ operatorId: op, limit: 1 });
      expect(plain.map((x) => x.id)).toEqual([ids.gl]);
      const byShift = await s.listAssignments({ operatorId: op, shiftConfigId: fx.shiftIn, limit: 1 });
      expect(byShift.map((x) => x.id)).toEqual([ids.in1]);
    });

    it("null = 'Chưa gắn ca' ⇒ IS NULL; kết hợp được với status", async () => {
      const s = await asAdmin();
      expect((await s.listAssignments({ operatorId: op, shiftConfigId: null })).map((x) => x.id)).toEqual([ids.none]);
      const allNull = await s.listAssignments({ shiftConfigId: null, limit: 50 });
      expect(allNull.length).toBeGreaterThan(0);
      expect(allNull.every((x) => x.shiftConfigId === null)).toBe(true);
      expect((await s.listAssignments({ operatorId: op, shiftConfigId: fx.shiftIn, status: "active" })).map((x) => x.id)).toEqual([ids.in2]);
    });

    it("KHÔNG có ca ⇒ như cũ: không lọc ngầm (đủ 4 hàng, mọi kiểu ca), thứ tự assignedStart giảm dần; input rỗng vẫn chạy (limit 200)", async () => {
      const s = await asAdmin();
      expect((await s.listAssignments({ operatorId: op })).map((x) => x.id)).toEqual([ids.gl, ids.in1, ids.in2, ids.none]);
      expect((await s.listAssignments({ operatorId: op, status: "planned" })).map((x) => x.id)).toEqual([ids.gl, ids.in1, ids.none]);
      const bare = await s.listAssignments();
      expect(bare.length).toBeLessThanOrEqual(200);
      const withLimit = await s.listAssignments({ status: "planned", limit: 3 });
      expect(withLimit.length).toBeLessThanOrEqual(3);
      expect(withLimit.every((x) => x.status === "planned")).toBe(true);
    });

    it("ca không hợp lệ trong input (0, âm, chữ) ⇒ BAD_REQUEST của zod, không truy vấn", async () => {
      const s = await asAdmin();
      for (const bad of [0, -1, 1.5, "2"]) {
        const e = await errOf(s.listAssignments({ shiftConfigId: bad as never }));
        expect(e?.code, String(bad)).toBe("BAD_REQUEST");
      }
    });

    it("phạm vi GIỮ NGUYÊN: bộ lọc ca không đổi ai thấy gì — người bị thu hẹp thấy ĐÚNG tập admin thấy cho cùng input", async () => {
      for (const shiftConfigId of [fx.shiftIn, null]) {
        const a = await (await asAdmin()).listAssignments({ operatorId: op, shiftConfigId });
        const b = await (await asScoped()).listAssignments({ operatorId: op, shiftConfigId });
        expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
        expect(a.length).toBeGreaterThan(0);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════════
  describe("§2 — assignOperator / reassignOperator: ca tuỳ chọn, phải tồn tại + đang hoạt động + trong phạm vi", () => {
    it("bỏ ca ⇒ như trước: tạo phân công, shiftConfigId NULL (đọc lại bằng SQL thô)", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const r = await (await asScoped()).assignOperator({ operatorId: op, lineId: fx.lineIn });
      expect(r.ok).toBe(true);
      expect(await rowsOf(op)).toEqual([expect.objectContaining({ operatorId: op, shiftConfigId: null, status: "planned" })]);
    });

    it("ca trong phạm vi (ca nhà máy được gán, ca toàn hệ thống) ⇒ ghi đúng vào operator_assignments.shiftConfigId", async () => {
      for (const shift of [fx.shiftIn, fx.shiftGlobal]) {
        const op = nextOp();
        fx.ops.push(op);
        const r = await (await asScoped()).assignOperator({ operatorId: op, shiftConfigId: shift });
        expect(r.ok).toBe(true);
        expect(r.assignment?.shiftConfigId).toBe(shift);
        expect(await rowsOf(op)).toEqual([expect.objectContaining({ shiftConfigId: shift })]);
      }
    });

    it("★ ca của nhà máy NGOÀI phạm vi ⇒ ENTITY_NOT_FOUND (cùng câu như id không tồn tại), KHÔNG ghi hàng nào", async () => {
      for (const shift of [fx.shiftOut, fx.shiftMissing]) {
        const op = nextOp();
        fx.ops.push(op);
        const e = await errOf((await asScoped()).assignOperator({ operatorId: op, shiftConfigId: shift }));
        expect(e, `ca ${shift}`).not.toBeNull();
        expect(e?.appCode).not.toBe("PERMISSION_DENIED");
        expect(e).toEqual(expect.objectContaining({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "shiftConfig" } }));
        expect(await rowsOf(op)).toEqual([]);
      }
    });

    it("phạm vi RỖNG (chưa gán nhà máy) ⇒ không người vận hành nào trong phạm vi ⇒ ENTITY_NOT_FOUND (user), không ghi (ca toàn hệ thống vẫn thấy ở §3)", async () => {
      const opNo = nextOp();
      fx.ops.push(opNo);
      for (const shiftConfigId of [fx.shiftGlobal, fx.shiftIn]) {
        const e = await errOf((await asEmpty()).assignOperator({ operatorId: opNo, shiftConfigId }));
        expect(e).toEqual(expect.objectContaining({ appCode: "ENTITY_NOT_FOUND", appParams: { entity: "user" } }));
      }
      expect(await rowsOf(opNo)).toEqual([]);
    });

    it("admin (toàn quyền) ⇒ ca nhà máy bất kỳ được; nhưng ca TẮT vẫn bị từ chối", async () => {
      const op = nextOp();
      fx.ops.push(op);
      expect((await (await asAdmin()).assignOperator({ operatorId: op, shiftConfigId: fx.shiftOut })).assignment?.shiftConfigId).toBe(fx.shiftOut);
      const opOff = nextOp();
      fx.ops.push(opOff);
      const e = await errOf((await asAdmin()).assignOperator({ operatorId: opOff, shiftConfigId: fx.shiftOff }));
      expect(e).toEqual(expect.objectContaining({
        code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "shiftConfigId", reason: "shiftInactive" },
      }));
      expect(await rowsOf(opOff)).toEqual([]);
    });

    it("ca TẮT trong phạm vi ⇒ INVALID_VALUE shiftInactive, không ghi", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const e = await errOf((await asScoped()).assignOperator({ operatorId: op, shiftConfigId: fx.shiftOff }));
      expect(e?.appCode).toBe("INVALID_VALUE");
      expect(await rowsOf(op)).toEqual([]);
    });

    it("cờ nhân lực TẮT ⇒ FEATURE_DISABLED như cũ, kể cả khi ca sai (thứ tự cổng không đổi)", async () => {
      process.env.WORKFORCE_ENABLED = "false";
      const op = nextOp();
      fx.ops.push(op);
      const e = await errOf((await asScoped()).assignOperator({ operatorId: op, shiftConfigId: fx.shiftOut }));
      expect(e?.appCode).toBe("FEATURE_DISABLED");
      const e2 = await errOf((await asScoped()).reassignOperator({ assignmentId: 1, operatorId: op, shiftConfigId: fx.shiftMissing }));
      expect(e2?.appCode).toBe("FEATURE_DISABLED");
      expect(await rowsOf(op)).toEqual([]);
    });

    it("phân công lại: ca hợp lệ ⇒ hàng mới mang ca, hàng cũ 'cancelled'; bỏ ca ⇒ hàng mới NULL (như trước)", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const s = await asScoped();
      const first = await s.assignOperator({ operatorId: op, assignedStart: new Date("2099-02-01T00:00:00Z"), assignedEnd: new Date("2099-02-01T08:00:00Z") });
      const r = await s.reassignOperator({
        assignmentId: first.assignment!.id, operatorId: op, shiftConfigId: fx.shiftIn,
        assignedStart: new Date("2099-02-02T00:00:00Z"), assignedEnd: new Date("2099-02-02T08:00:00Z"),
      });
      expect(r.assignment?.shiftConfigId).toBe(fx.shiftIn);
      const r2 = await s.reassignOperator({
        assignmentId: r.assignment!.id, operatorId: op,
        assignedStart: new Date("2099-02-03T00:00:00Z"), assignedEnd: new Date("2099-02-03T08:00:00Z"),
      });
      expect(r2.assignment?.shiftConfigId).toBeNull();
      expect((await rowsOf(op)).map((x) => [x.id, x.shiftConfigId, x.status])).toEqual([
        [first.assignment!.id, null, "cancelled"],
        [r.assignment!.id, fx.shiftIn, "cancelled"],
        [r2.assignment!.id, null, "planned"],
      ]);
    });

    it("★ phân công lại với ca ngoài phạm vi / TẮT ⇒ bị từ chối và phân công cũ KHÔNG bị huỷ, không hàng mới", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const s = await asScoped();
      const first = await s.assignOperator({ operatorId: op, assignedStart: new Date("2099-03-01T00:00:00Z"), assignedEnd: new Date("2099-03-01T08:00:00Z") });
      for (const [shift, appCode] of [[fx.shiftOut, "ENTITY_NOT_FOUND"], [fx.shiftOff, "INVALID_VALUE"]] as const) {
        const e = await errOf(s.reassignOperator({
          assignmentId: first.assignment!.id, operatorId: op, shiftConfigId: shift,
          assignedStart: new Date("2099-03-02T00:00:00Z"), assignedEnd: new Date("2099-03-02T08:00:00Z"),
        }));
        expect(e?.appCode).toBe(appCode);
      }
      expect((await rowsOf(op)).map((x) => [x.id, x.status])).toEqual([[first.assignment!.id, "planned"]]);
    });
  });
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // doc 81 Đợt 3b final wave (I2) — bộ chọn ca chỉ đưa ca NGƯỜI GỌI được gán VÀ thuộc nhà máy của chuyền/trạm đã chọn; server
  // kiểm ca ⇄ nhà máy của phân công (trước: sheet liệt kê ca mọi nhà máy, mặc định có thể chọn ca bị server từ chối).
  describe("§3 — assignableShifts: ca đang hoạt động, trong phạm vi, thuộc nhà máy của chuyền/trạm", () => {
    type Row = { id: number; factoryId: number | null; factoryName: string | null; isActive: boolean };
    const ids = (r: Row[]) => new Set(r.map((x) => x.id));
    const ours = () => [fx.shiftIn, fx.shiftOut, fx.shiftGlobal, fx.shiftOff];
    const pick = (r: Row[]) => ours().filter((id) => ids(r).has(id));

    it("người bị thu hẹp, chưa chọn chuyền ⇒ ca nhà máy được gán + ca toàn hệ thống; KHÔNG ca nhà máy khác, KHÔNG ca tắt", async () => {
      const r = (await (await asScoped()).assignableShifts({})) as Row[];
      expect(pick(r)).toEqual([fx.shiftIn, fx.shiftGlobal]);
      expect(r.every((x) => x.isActive)).toBe(true);
      expect(r.every((x) => x.factoryId == null || x.factoryId === fx.facIn)).toBe(true);
      expect(r.find((x) => x.id === fx.shiftIn)?.factoryName).toBe(`${DAU} trong`);
      expect(r.find((x) => x.id === fx.shiftGlobal)?.factoryName).toBeNull();
    });

    it("chọn chuyền ⇒ chỉ ca của nhà máy chuyền đó (+ toàn hệ thống); ★ chuyền/trạm nhà máy NGOÀI phạm vi ⇒ Y HỆT chuyền không tồn tại (không lộ chuyền đó có thật)", async () => {
      const s = await asScoped();
      expect(pick((await s.assignableShifts({ lineId: fx.lineIn })) as Row[])).toEqual([fx.shiftIn, fx.shiftGlobal]);
      const missing = await s.assignableShifts({ lineId: fx.lineMissing });
      expect(await s.assignableShifts({ lineId: fx.lineOut })).toEqual(missing);
      expect(await s.assignableShifts({ stationId: fx.stationOut })).toEqual(missing);
      expect((missing as Row[]).every((x) => x.factoryId == null || x.factoryId === fx.facIn)).toBe(true);
    });

    it("admin: chuyền / trạm của nhà máy NGOÀI ⇒ ca ngoài + toàn hệ thống, KHÔNG ca 'trong'; không chọn ⇒ mọi ca đang hoạt động", async () => {
      const s = await asAdmin();
      expect(pick((await s.assignableShifts({ lineId: fx.lineOut })) as Row[])).toEqual([fx.shiftOut, fx.shiftGlobal]);
      expect(pick((await s.assignableShifts({ stationId: fx.stationOut })) as Row[])).toEqual([fx.shiftOut, fx.shiftGlobal]);
      expect(pick((await s.assignableShifts({})) as Row[])).toEqual([fx.shiftIn, fx.shiftOut, fx.shiftGlobal]);
    });

    it("chuyền không tồn tại ⇒ như chưa chọn (không đoán nhà máy); phạm vi rỗng ⇒ chỉ ca toàn hệ thống", async () => {
      expect(pick((await (await asScoped()).assignableShifts({ lineId: fx.lineMissing })) as Row[])).toEqual([fx.shiftIn, fx.shiftGlobal]);
      const e = (await (await asEmpty()).assignableShifts({})) as Row[];
      expect(pick(e)).toEqual([fx.shiftGlobal]);
      expect(e.every((x) => x.factoryId == null)).toBe(true);
    });
  });

  describe("§4 — assign/reassign: ca phải thuộc nhà máy của phân công (chuyền › trạm › factoryId)", () => {
    const MISMATCH = { code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "shiftConfigId", reason: "shiftFactoryMismatch" } };

    it("★ ca nhà máy A trên chuyền / trạm / factoryId của nhà máy B ⇒ INVALID_VALUE shiftFactoryMismatch, KHÔNG ghi", async () => {
      const s = await asAdmin();
      for (const extra of [{ lineId: fx.lineIn }, { stationId: fx.stationOut }, { factoryId: fx.facIn }]) {
        const op = nextOp();
        fx.ops.push(op);
        const shiftConfigId = "stationId" in extra ? fx.shiftIn : fx.shiftOut;
        const e = await errOf(s.assignOperator({ operatorId: op, shiftConfigId, ...extra }));
        expect(e, JSON.stringify(extra)).toEqual(expect.objectContaining(MISMATCH));
        expect(await rowsOf(op)).toEqual([]);
      }
    });

    it("cùng nhà máy hoặc ca toàn hệ thống ⇒ ghi được (chuyền không tồn tại: xem §6 — nay bị từ chối)", async () => {
      const s = await asAdmin();
      const cases: Array<[number, { lineId?: number; stationId?: number }]> = [
        [fx.shiftOut, { lineId: fx.lineOut }],
        [fx.shiftOut, { stationId: fx.stationOut }],
        [fx.shiftGlobal, { lineId: fx.lineIn }],
        [fx.shiftIn, {}],
      ];
      for (const [shiftConfigId, extra] of cases) {
        const op = nextOp();
        fx.ops.push(op);
        const r = await s.assignOperator({ operatorId: op, shiftConfigId, ...extra });
        expect(r.assignment?.shiftConfigId, JSON.stringify(extra)).toBe(shiftConfigId);
      }
    });

    it("thứ tự cổng: ngoài phạm vi vẫn là ENTITY_NOT_FOUND (không lộ nhà máy của ca); lệch nhà máy chỉ sau khi ca trong phạm vi", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const e = await errOf((await asScoped()).assignOperator({ operatorId: op, shiftConfigId: fx.shiftOut, lineId: fx.lineIn }));
      expect(e?.appCode).toBe("ENTITY_NOT_FOUND");
      expect(await rowsOf(op)).toEqual([]);
    });

    it("★ phân công lại sang chuyền nhà máy khác mà giữ ca cũ ⇒ bị từ chối, phân công cũ KHÔNG bị huỷ", async () => {
      const op = nextOp();
      fx.ops.push(op);
      const s = await asAdmin();
      const first = await s.assignOperator({
        operatorId: op, lineId: fx.lineIn, shiftConfigId: fx.shiftIn,
        assignedStart: new Date("2099-04-01T00:00:00Z"), assignedEnd: new Date("2099-04-01T08:00:00Z"),
      });
      const e = await errOf(s.reassignOperator({
        assignmentId: first.assignment!.id, operatorId: op, lineId: fx.lineOut, shiftConfigId: fx.shiftIn,
        assignedStart: new Date("2099-04-02T00:00:00Z"), assignedEnd: new Date("2099-04-02T08:00:00Z"),
      }));
      expect(e).toEqual(expect.objectContaining(MISMATCH));
      expect((await rowsOf(op)).map((x) => [x.id, x.status])).toEqual([[first.assignment!.id, "planned"]]);
    });
  });
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // doc 81 Đợt 3b final wave — RÀ SOÁT BẢO MẬT (lộ thông tin) các thủ tục safety.* của dải này. Hợp đồng: người gọi bị thu hẹp
  // KHÔNG thấy hàng / tên / id của nhà máy khác, và ngoài phạm vi KHÔNG phân biệt được với không tồn tại (cùng mã, cùng câu,
  // không vọng id/tên của nhà máy khác).
  describe("§5 — rà soát bảo mật: ngoài phạm vi ≡ không tồn tại, không hàng nhà máy khác", () => {
    let op: number;
    const ids = { facIn: 0, lineIn: 0, facOut: 0, lineOut: 0, stationOut: 0, orphan: 0 };
    beforeAll(async () => {
      op = nextOp();
      ids.facIn = await seedAssignment(op, fx.shiftIn, "2099-05-06T00:00:00", "planned", { factoryId: fx.facIn });
      ids.lineIn = await seedAssignment(op, null, "2099-05-05T00:00:00", "planned", { lineId: fx.lineIn });
      ids.facOut = await seedAssignment(op, fx.shiftOut, "2099-05-04T00:00:00", "planned", { factoryId: fx.facOut });
      ids.lineOut = await seedAssignment(op, fx.shiftOut, "2099-05-03T00:00:00", "planned", { lineId: fx.lineOut });
      ids.stationOut = await seedAssignment(op, null, "2099-05-02T00:00:00", "planned", { stationId: fx.stationOut });
      ids.orphan = await seedAssignment(op, null, "2099-05-01T00:00:00", "planned", {});
    });

    it("★ listAssignments: người bị thu hẹp CHỈ thấy hàng nhà máy của mình (factoryId › chuyền › trạm); hàng mồ côi ẩn (fail-closed); admin thấy đủ", async () => {
      const scoped = await (await asScoped()).listAssignments({ operatorId: op });
      expect(scoped.map((x) => x.id)).toEqual([ids.facIn, ids.lineIn]);
      const admin = await (await asAdmin()).listAssignments({ operatorId: op });
      expect(admin.map((x) => x.id)).toEqual([ids.facIn, ids.lineIn, ids.facOut, ids.lineOut, ids.stationOut, ids.orphan]);
      expect(await (await asEmpty()).listAssignments({ operatorId: op })).toEqual([]);
    });

    it("★ listAssignments lọc theo ca của nhà máy KHÁC ⇒ rỗng, Y HỆT ca không tồn tại (không dò được hàng nhà máy khác qua id ca)", async () => {
      const s = await asScoped();
      const foreign = await s.listAssignments({ shiftConfigId: fx.shiftOut, limit: 500 });
      expect(foreign).toEqual([]);
      expect(foreign).toEqual(await s.listAssignments({ shiftConfigId: fx.shiftMissing, limit: 500 }));
      // không lọc ca, toàn bảng: không một hàng nào thuộc nhà máy ngoài
      const all = await s.listAssignments({ limit: 500 });
      expect(all.some((x) => [ids.facOut, ids.lineOut, ids.stationOut, ids.orphan].includes(x.id))).toBe(false);
    });

    it("★ phân công lại / xác nhận / đóng một phân công NGOÀI phạm vi ⇒ Y HỆT id không tồn tại; hàng KHÔNG đổi", async () => {
      const s = await asScoped();
      const missingId = 2_000_000_000;
      for (const target of [ids.facOut, ids.lineOut, ids.stationOut, ids.orphan]) {
        const r = await s.reassignOperator({ assignmentId: target, operatorId: nextOp() });
        const m = await s.reassignOperator({ assignmentId: missingId, operatorId: nextOp() });
        expect({ ...r, message: r.message?.replace(String(target), "#") }).toEqual({ ...m, message: m.message?.replace(String(missingId), "#") });
        expect(r.ok).toBe(false);
        for (const proc of ["confirmAssignment", "closeAssignment"] as const) {
          const e = await errOf(s[proc]({ assignmentId: target }));
          const eMissing = await errOf(s[proc]({ assignmentId: missingId }));
          expect(e, `${proc} ${target}`).toEqual(eMissing);
          expect(e?.appCode).toBe("ENTITY_NOT_FOUND");
        }
      }
      const rows = (await sql`SELECT id, status, "confirmedBy", "closedBy" FROM operator_assignments WHERE id = ANY(${[ids.facOut, ids.lineOut, ids.stationOut, ids.orphan]}) ORDER BY id`) as unknown as Array<{ status: string; confirmedBy: number | null; closedBy: number | null }>;
      expect(rows.every((x) => x.status === "planned" && x.confirmedBy == null && x.closedBy == null)).toBe(true);
    });

    it("phân công TRONG phạm vi: xác nhận / đóng / phân công lại vẫn chạy như trước", async () => {
      const s = await asScoped();
      const own = nextOp();
      fx.ops.push(own);
      const a = await s.assignOperator({ operatorId: own, lineId: fx.lineIn, assignedStart: new Date("2099-06-01T00:00:00Z"), assignedEnd: new Date("2099-06-01T08:00:00Z") });
      expect((await s.confirmAssignment({ assignmentId: a.assignment!.id })).status).toBe("active");
      const r = await s.reassignOperator({ assignmentId: a.assignment!.id, operatorId: own, lineId: fx.lineIn, assignedStart: new Date("2099-06-02T00:00:00Z"), assignedEnd: new Date("2099-06-02T08:00:00Z") });
      expect(r.ok).toBe(true);
      expect((await s.closeAssignment({ assignmentId: r.assignment!.id })).status).toBe("completed");
    });

    it("★ phân công mới của người bị thu hẹp mang nhà máy của mình (chuyền › trạm › phạm vi MỘT nhà máy) ⇒ chính họ thấy lại được; chuyền ngoài phạm vi KHÔNG được dùng làm nhà máy", async () => {
      const s = await asScoped();
      for (const extra of [{}, { lineId: fx.lineIn }, { stationId: fx.stationIn }]) {
        const o = nextOp();
        fx.ops.push(o);
        const r = await s.assignOperator({ operatorId: o, ...extra });
        const [row] = (await sql`SELECT "factoryId" FROM operator_assignments WHERE id = ${r.assignment!.id}`) as unknown as Array<{ factoryId: number | null }>;
        expect(row.factoryId, JSON.stringify(extra)).toBe(fx.facIn);
        expect((await s.listAssignments({ operatorId: o })).map((x) => x.id)).toEqual([r.assignment!.id]);
      }
    });

    it("★ lệch nhà máy: câu lỗi KHÔNG vọng id nhà máy; chuyền NGOÀI phạm vi ≡ chuyền không tồn tại (cùng lỗi, không lộ chuyền có thật)", async () => {
      const a = await asAdmin();
      const o1 = nextOp();
      fx.ops.push(o1);
      const e = (await a.assignOperator({ operatorId: o1, lineId: fx.lineIn, shiftConfigId: fx.shiftOut }).then(() => null, (x: unknown) => x)) as { message?: string } | null;
      expect(e).not.toBeNull();
      expect(e!.message).not.toMatch(new RegExp(`\\b(${fx.facIn}|${fx.facOut})\\b`));
      const s = await asScoped();
      const [o2, o3] = [nextOp(), nextOp()];
      fx.ops.push(o2, o3);
      const viaOut = await errOf(s.assignOperator({ operatorId: o2, lineId: fx.lineOut, shiftConfigId: fx.shiftIn }));
      const viaMissing = await errOf(s.assignOperator({ operatorId: o3, lineId: fx.lineMissing, shiftConfigId: fx.shiftIn }));
      expect(viaOut).toEqual(viaMissing);
      expect(viaOut?.appCode).toBe("ENTITY_NOT_FOUND");
    });

    it("★ trùng lịch: câu lỗi KHÔNG vọng id phân công của nhà máy khác", async () => {
      const s = await asScoped();
      // người vận hành `op` đã có lịch 2099-05-04 ở nhà máy NGOÀI (ids.facOut)
      const e = (await s.assignOperator({ operatorId: op, assignedStart: new Date("2099-05-04T00:10:00"), assignedEnd: new Date("2099-05-04T00:20:00") }).then(() => null, (x: unknown) => x)) as { message?: string; cause?: { appCode?: string } } | null;
      expect(e?.cause?.appCode).toBe("OPERATION_FAILED");
      expect(e!.message).not.toContain(String(ids.facOut));
      expect(e!.message).not.toMatch(/#\d+/);
    });
  });
  // ═════════════════════════════════════════════════════════════════════════════════════════════
  // doc 81 Đợt 3b final wave — RÀ SOÁT BẢO MẬT (vượt phạm vi khi GHI). Trước: assign/reassign nhận BẤT KỲ id người vận hành /
  // chuyền / trạm / nhà máy (không FK, không kiểm phạm vi) ⇒ người nhà máy A tạo được phân công trên chuyền/trạm/nhân sự nhà máy
  // B. Nay mỗi id phải TỒN TẠI và TRONG PHẠM VI (idsTrongPhamVi / resolveTenantFactoryScope); ngoài phạm vi ≡ không tồn tại.
  describe("§6 — ghi: người vận hành / chuyền / trạm / nhà máy NGOÀI phạm vi ≡ không tồn tại, không ghi", () => {
    const NF = (entity: string) => expect.objectContaining({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity } });

    it("★ người vận hành của nhà máy B / vô hiệu / không tồn tại ⇒ CÙNG ENTITY_NOT_FOUND (user), câu không vọng id; không hàng nào", async () => {
      const s = await asScoped();
      const errs = [];
      for (const operatorId of [fx.opOut, fx.opInactive, fx.opMissing]) {
        const e = await errOf(s.assignOperator({ operatorId, lineId: fx.lineIn }));
        expect(e, String(operatorId)).toEqual(NF("user"));
        errs.push(e);
        expect(await rowsOf(operatorId)).toEqual([]);
      }
      expect(errs[0]).toEqual(errs[2]);
      expect(errs[1]).toEqual(errs[2]);
      const msg = (await s.assignOperator({ operatorId: fx.opOut }).then(() => null, (x: { message?: string }) => x.message)) ?? "";
      expect(msg).not.toContain(String(fx.opOut));
    });

    it("★ chuyền / trạm / factoryId của nhà máy B ⇒ CÙNG lỗi như id không tồn tại (line / station / factory), không hàng nào", async () => {
      const s = await asScoped();
      const cases: Array<[Record<string, number>, Record<string, number>, string]> = [
        [{ lineId: fx.lineOut }, { lineId: fx.lineMissing }, "line"],
        [{ stationId: fx.stationOut }, { stationId: 2_000_000_000 }, "station"],
        [{ factoryId: fx.facOut }, { factoryId: 2_000_000_000 }, "factory"],
      ];
      for (const [foreign, missing, entity] of cases) {
        const [o1, o2] = [nextOp(), nextOp()];
        fx.ops.push(o1, o2);
        const e1 = await errOf(s.assignOperator({ operatorId: o1, ...foreign }));
        const e2 = await errOf(s.assignOperator({ operatorId: o2, ...missing }));
        expect(e1, JSON.stringify(foreign)).toEqual(NF(entity));
        expect(e1).toEqual(e2);
        expect(await rowsOf(o1)).toEqual([]);
        expect(await rowsOf(o2)).toEqual([]);
      }
    });

    it("★ phân công lại một phân công TRONG phạm vi sang người / chuyền / trạm nhà máy B ⇒ bị từ chối, hàng cũ KHÔNG bị huỷ", async () => {
      const s = await asScoped();
      const op = nextOp();
      fx.ops.push(op);
      const first = await s.assignOperator({ operatorId: op, lineId: fx.lineIn, assignedStart: new Date("2099-07-01T00:00:00Z"), assignedEnd: new Date("2099-07-01T08:00:00Z") });
      for (const [extra, entity] of [[{ operatorId: fx.opOut }, "user"], [{ operatorId: op, lineId: fx.lineOut }, "line"], [{ operatorId: op, stationId: fx.stationOut }, "station"]] as const) {
        const e = await errOf(s.reassignOperator({ assignmentId: first.assignment!.id, ...extra, assignedStart: new Date("2099-07-02T00:00:00Z"), assignedEnd: new Date("2099-07-02T08:00:00Z") }));
        expect(e, JSON.stringify(extra)).toEqual(NF(entity));
      }
      expect((await rowsOf(op)).map((x) => [x.id, x.status])).toEqual([[first.assignment!.id, "planned"]]);
      expect(await rowsOf(fx.opOut)).toEqual([]);
    });

    it("admin (không lọc) ⇒ id nhà máy B được, nhưng id KHÔNG TỒN TẠI vẫn bị từ chối (không còn hàng trỏ vào hư không)", async () => {
      const a = await asAdmin();
      const o = nextOp();
      fx.ops.push(o);
      expect((await a.assignOperator({ operatorId: fx.opOut, lineId: fx.lineOut, stationId: fx.stationOut, factoryId: fx.facOut })).ok).toBe(true);
      fx.ops.push(fx.opOut);
      expect(await errOf(a.assignOperator({ operatorId: fx.opMissing }))).toEqual(NF("user"));
      expect(await errOf(a.assignOperator({ operatorId: o, lineId: fx.lineMissing }))).toEqual(NF("line"));
      expect(await rowsOf(o)).toEqual([]);
    });
  });
});

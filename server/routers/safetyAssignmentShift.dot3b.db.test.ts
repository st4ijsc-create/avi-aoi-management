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
/** Người vận hành (không FK) — dải riêng của lượt này. */
const OP0 = 960_000_000 + Math.floor(Math.random() * 30_000_000);
let opSeq = 10;
const nextOp = () => OP0 + opSeq++;

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
async function seedAssignment(operatorId: number, shiftConfigId: number | null, start: string, status = "planned") {
  fx.ops.push(operatorId);
  return one(sql`
    INSERT INTO operator_assignments ("operatorId", "shiftConfigId", status, role, "assignedStart", "assignedEnd")
    VALUES (${operatorId}, ${shiftConfigId}, ${status}, 'human', ${start}::timestamp, ${start}::timestamp + interval '1 hour')
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
    fx = { facIn, facOut, facInCode, shiftIn, shiftOut, shiftGlobal, shiftOff, shiftMissing: max + 100_000, userScoped, userEmpty, ops: [] };
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
      const uids = [fx.userScoped, fx.userEmpty];
      if (fx.ops.length) await sql`DELETE FROM operator_assignments WHERE "operatorId" = ANY(${fx.ops})`;
      await sql`DELETE FROM shift_configs WHERE id = ANY(${[fx.shiftIn, fx.shiftOut, fx.shiftGlobal, fx.shiftOff]})`;
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
      const r = await (await asScoped()).assignOperator({ operatorId: op, lineId: 7 });
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

    it("phạm vi RỖNG (chưa gán nhà máy) ⇒ chỉ ca toàn hệ thống được; ca nhà máy ⇒ ENTITY_NOT_FOUND", async () => {
      const opOk = nextOp();
      const opNo = nextOp();
      fx.ops.push(opOk, opNo);
      expect((await (await asEmpty()).assignOperator({ operatorId: opOk, shiftConfigId: fx.shiftGlobal })).ok).toBe(true);
      const e = await errOf((await asEmpty()).assignOperator({ operatorId: opNo, shiftConfigId: fx.shiftIn }));
      expect(e?.appCode).toBe("ENTITY_NOT_FOUND");
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
});

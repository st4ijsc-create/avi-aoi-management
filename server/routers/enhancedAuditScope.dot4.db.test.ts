/**
 * doc 81 Đợt 4 Task A2 (ruling R-4-b) — hai thủ tục đọc sổ kiểm toán theo PHẠM VI. CSDL THẬT `_test`.
 *
 *   • `enhancedAudit.activityFeed` — trước: protectedProcedure KHÔNG requirePermission, KHÔNG lọc ⇒ mọi tài
 *     khoản đăng nhập đọc 20 dòng kiểm toán mới nhất của MỌI nhà máy. Nay: requirePermission("admin_system",
 *     "canView") (cùng khoá với RouteGuard của trang /audit-logs — trang DUY NHẤT gọi nó) + lọc theo phạm vi.
 *   • `enhancedAudit.masterDataList` — đã có requirePermission("masterdata","canView") nhưng KHÔNG lọc.
 * Luật (R-4-b): người không toàn quyền thấy dòng (a) do CHÍNH mình làm, hoặc (b) thực thể phân cấp
 * (factory/workshop/line/station/machine/workstation) có id ∈ idsTrongPhamVi(tầng, mình). Còn lại ẨN.
 * Admin: đầu ra GIỐNG HỆT trước — đối chiếu với ORACLE là chính câu SQL cũ (chép nguyên văn vào tệp này,
 * độc lập với mã sản phẩm).
 *
 * ⚠ audit_logs là WORM (0102/0224/0279: không ai xoá được) ⇒ dòng thử ghi với createdAt = now() và để lại như mọi
 *   dòng kiểm toán khác (retention 0349 dọn); KHÔNG ghi ngày tương lai (sẽ nằm đầu mọi luồng mãi mãi).
 *   Hàng phân cấp / người dùng / quyền / gán nhà máy do tệp tạo đều xoá ở afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

// Fault injection ONLY for the "scope cannot be resolved" case; every other case runs the real resolver.
const fault = vi.hoisted(() => ({ scopeThrows: false }));
vi.mock("../db/hierarchy", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../db/hierarchy")>();
  return {
    ...orig,
    idsTrongPhamVi: async (...a: Parameters<typeof orig.idsTrongPhamVi>) => {
      if (fault.scopeThrows) throw new Error("scope resolver down (injected)");
      return orig.idsTrongPhamVi(...a);
    },
  };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `D4A2-${Date.now()}`;
const OTHER_ACTOR = 990_842_901; // một người khác (không phải người xem)

let sql: ReturnType<typeof postgres>;
type Chain = { factoryId: number; factoryCode: string; workshopId: number; lineId: number; stationId: number; machineId: number };
let trong: Chain;
let ngoai: Chain;
const users = { scoped: 0, empty: 0, noPerm: 0 };
const rows: Record<string, number> = {};

async function chain(tag: string): Promise<Chain> {
  const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
  const factoryCode = `${DAU}-${tag}`;
  const factoryId = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${factoryCode}, ${`${DAU} ${tag}`}, true) RETURNING id`);
  const workshopId = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factoryId}, ${`${factoryCode}-W`}, 'w') RETURNING id`);
  const lineId = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${workshopId}, ${`${factoryCode}-L`}, 'l') RETURNING id`);
  const stationId = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${lineId}, ${`${factoryCode}-S`}, 's') RETURNING id`);
  const machineId = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${stationId}, ${`${factoryCode}-M`}, 'm', 'AOI') RETURNING id`);
  return { factoryId, factoryCode, workshopId, lineId, stationId, machineId };
}

async function user(tag: string, role: string): Promise<number> {
  const r = await sql`INSERT INTO users ("openId", username, name, role, "isActive")
                      VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`${DAU} ${tag}`}, ${role}, true) RETURNING id`;
  return Number(r[0].id);
}

/** One audit row, createdAt = now() − ageMs (so order is fixed: smaller age = newer). `tx` = one transaction ⇒ one now(). */
async function audit(tx: ReturnType<typeof postgres>, key: string, a: { action: string; entityType: string | null; entityId: number | null; userId: number | null; ageMs: number }) {
  const r = await tx`
    INSERT INTO audit_logs ("userId", "userName", action, "entityType", "entityId", "entityName", details, status, "createdAt")
    VALUES (${a.userId}, ${"u" + (a.userId ?? 0)}, ${a.action}, ${a.entityType}, ${a.entityId}, ${`${DAU} ${key}`},
            ${JSON.stringify({ source: "web", note: key })}, 'success', now() - ${`${a.ageMs} milliseconds`}::interval)
    RETURNING id`;
  rows[key] = Number(r[0].id);
}

/** Oracle for `source` — independent of product code: JSON text ⇒ its `source`, else "web". */
function srcOf(raw: unknown): string {
  if (raw && typeof raw === "object") return ((raw as { source?: string }).source) || "web";
  try {
    return (typeof raw === "string" && JSON.parse(raw)?.source) || "web";
  } catch {
    return "web";
  }
}

const caller = async (ctx: object) => (await import("./enhancedAuditRouter")).enhancedAuditRouter.createCaller(ctx as never);
const ADMIN = { user: { id: 954_901, role: "admin", name: "admin" } };
const as = (id: number) => ({ user: { id, role: "user", name: `u${id}` } });

describe.skipIf(!DB_URL)("doc 81 Đợt 4 Task A2 — sổ kiểm toán theo phạm vi (CSDL _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    trong = await chain("IN");
    ngoai = await chain("OUT");
    users.scoped = await user("scoped", "user");
    users.empty = await user("empty", "user");
    users.noPerm = await user("noperm", "user");
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${users.scoped}, ${trong.factoryCode})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${users.noPerm}, ${trong.factoryCode})`;
    for (const u of [users.scoped, users.empty]) {
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u}, 'admin', 'admin_system', true)`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${u}, 'settings', 'masterdata', true)`;
    }
    // r1 newest … r10 oldest. V = visible to `scoped`, H = hidden. One transaction ⇒ one now() ⇒ fixed order.
    await sql.begin(async (tx) => {
    await audit(tx, "r1", { action: "machine.update", entityType: "machine", entityId: trong.machineId, userId: OTHER_ACTOR, ageMs: 1 }); // V
    await audit(tx, "r2", { action: "machine.update", entityType: "machine", entityId: ngoai.machineId, userId: OTHER_ACTOR, ageMs: 2 }); // H
    await audit(tx, "r3", { action: "masterData.suppliers.create", entityType: "trpc_mutation", entityId: null, userId: OTHER_ACTOR, ageMs: 3 }); // H
    await audit(tx, "r4", { action: "masterData.suppliers.update", entityType: "trpc_mutation", entityId: null, userId: users.scoped, ageMs: 4 }); // V (own)
    await audit(tx, "r5", { action: "line.update", entityType: "line", entityId: trong.lineId, userId: OTHER_ACTOR, ageMs: 5 }); // V
    await audit(tx, "r6", { action: "factory.update", entityType: "factory", entityId: ngoai.factoryId, userId: OTHER_ACTOR, ageMs: 6 }); // H
    await audit(tx, "r7", { action: "station.update", entityType: "station", entityId: trong.stationId, userId: OTHER_ACTOR, ageMs: 7 }); // V
    await audit(tx, "r8", { action: "workshop.update", entityType: "workshop", entityId: trong.workshopId, userId: OTHER_ACTOR, ageMs: 8 }); // V
    await audit(tx, "r9", { action: "factory.update", entityType: "factory", entityId: trong.factoryId, userId: OTHER_ACTOR, ageMs: 9 }); // V
    await audit(tx, "r10", { action: "machine.update", entityType: "machine", entityId: trong.machineId, userId: users.empty, ageMs: 10 }); // own row of `empty`
    });
  });

  afterAll(async () => {
    if (!sql) return;
    const uids = Object.values(users).filter(Boolean);
    if (uids.length) {
      await sql`DELETE FROM permissions WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(uids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(uids)}`;
    }
    for (const c of [trong, ngoai].filter(Boolean)) {
      await sql`DELETE FROM machines WHERE id = ${c.machineId}`;
      await sql`DELETE FROM stations WHERE id = ${c.stationId}`;
      await sql`DELETE FROM production_lines WHERE id = ${c.lineId}`;
      await sql`DELETE FROM workshops WHERE id = ${c.workshopId}`;
      await sql`DELETE FROM factories WHERE id = ${c.factoryId}`;
    }
    await sql.end();
  });

  const VISIBLE = ["r1", "r4", "r5", "r7", "r8", "r9"];
  const mine = (ids: number[]) => {
    const back = new Map(Object.entries(rows).map(([k, v]) => [v, k]));
    return ids.map((id) => back.get(id)).filter((k): k is string => !!k);
  };

  // ── activityFeed ────────────────────────────────────────────────────────────────────
  it("★ activityFeed (người được gán nhà máy IN): CHỈ dòng trong phạm vi + dòng của chính mình; dòng ngoài / không phân loại được ẨN", async () => {
    const feed = await (await caller(as(users.scoped))).activityFeed({ limit: 50 });
    const ids = feed.map((r) => r.id as number);
    // Phạm vi của người này chỉ chứa cây IN mới tạo ⇒ luồng = ĐÚNG các dòng V của tệp, theo thứ tự mới → cũ.
    expect(mine(ids)).toEqual(VISIBLE.concat(["r10"])); // r10 = máy IN do người khác làm ⇒ cũng trong phạm vi
    expect(ids.length).toBe(VISIBLE.length + 1);
  });

  it("★ activityFeed: người KHÔNG được gán nhà máy (phạm vi rỗng) chỉ thấy dòng của chính mình", async () => {
    const feed = await (await caller(as(users.empty))).activityFeed({ limit: 50 });
    expect(mine(feed.map((r) => r.id as number))).toEqual(["r10"]);
    expect(feed.length).toBe(1);
  });

  it("★ activityFeed: thiếu quyền admin_system ⇒ FORBIDDEN (trước: mọi tài khoản đăng nhập)", async () => {
    await expect((await caller(as(users.noPerm))).activityFeed({ limit: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("★ activityFeed (admin): GIỐNG HỆT câu SQL cũ (oracle), kể cả dòng ngoài phạm vi và dòng không phân loại được", async () => {
    let checked = false;
    for (let i = 0; i < 6 && !checked; i++) {
      const oracle = async () =>
        (await sql`
          SELECT al.id, al.action, al."entityType", al."entityId", al."entityName", al.status, al."createdAt",
                 u."name" as "userName", al.details AS "detailsRaw"
          FROM audit_logs al LEFT JOIN users u ON u.id = al."userId"
          ORDER BY al."createdAt" DESC LIMIT ${50}`).map((r) => ({
          id: Number(r.id),
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          entityName: r.entityName,
          userName: r.userName || "System",
          status: r.status,
          source: srcOf(r.detailsRaw),
        }));
      const before = await oracle();
      const got = await (await caller(ADMIN)).activityFeed({ limit: 50 });
      const after = await oracle();
      if (JSON.stringify(before) !== JSON.stringify(after)) continue; // ghi song song chen vao giua — do lai
      expect(got.map(({ id, action, entityType, entityId, entityName, userName, status, source }) => ({ id, action, entityType, entityId, entityName, userName, status, source }))).toEqual(before);
      checked = true;
    }
    expect(checked, "audit_logs không đứng yên trong 6 lần đo").toBe(true);
  });

  it("★ phạm vi KHÔNG phân giải được (bộ phân giải ném) ⇒ fail-closed: chỉ dòng của chính mình (cả hai thủ tục)", async () => {
    fault.scopeThrows = true;
    try {
      const feed = await (await caller(as(users.scoped))).activityFeed({ limit: 50 });
      expect(mine(feed.map((r) => r.id as number))).toEqual(["r4"]);
      expect(feed.every((r) => rows.r4 === r.id || r.userName === `${DAU} scoped`)).toBe(true);
      const md = await (await caller(as(users.scoped))).masterDataList({ search: DAU, limit: 200, offset: 0 });
      expect(mine(md.items.map((x) => x.id))).toEqual(["r4"]);
      expect(md.total).toBe(1);
    } finally {
      fault.scopeThrows = false;
    }
  });

  // ── masterDataList ──────────────────────────────────────────────────────────────────
  it("★ masterDataList (người được gán IN): items + total chỉ gồm dòng trong phạm vi / của mình", async () => {
    const r = await (await caller(as(users.scoped))).masterDataList({ search: DAU, limit: 200, offset: 0 });
    expect(mine(r.items.map((x) => x.id))).toEqual(VISIBLE.concat(["r10"]));
    expect(r.total).toBe(VISIBLE.length + 1);
    const e = await (await caller(as(users.empty))).masterDataList({ search: DAU, limit: 200, offset: 0 });
    expect(mine(e.items.map((x) => x.id))).toEqual(["r10"]);
    expect(e.total).toBe(1);
  });

  it("★ masterDataList (admin): items + total GIỐNG HỆT câu SQL cũ (oracle)", async () => {
    const got = await (await caller(ADMIN)).masterDataList({ search: DAU, limit: 200, offset: 0 });
    const like = `%${DAU}%`;
    const prefixes = ["masterData.suppliers.", "masterData.customers.", "masterData.materials.", "masterData.uom.", "masterData.calendar.", "masterData.inventory.", "masterData.skills.", "masterData.tools.", "componentLibrary.", "operatorBadge.", "productModel.", "product.", "productOnboarding.", "fiducialMark.", "productMachineMapping.", "workstation.", "process.", "factory.", "workshop.", "line.", "station.", "machine.", "layout."];
    const oracle = await sql`
      SELECT al.id FROM audit_logs al
      WHERE (${sql.unsafe(prefixes.map((p) => `al."action" LIKE '${p}%'`).join(" OR "))})
        AND (al."entityName" ILIKE ${like} OR al."action" ILIKE ${like} OR al."userName" ILIKE ${like})
      ORDER BY al."createdAt" DESC LIMIT 200`;
    expect(got.items.map((x) => x.id)).toEqual(oracle.map((r) => Number(r.id)));
    expect(got.total).toBe(oracle.length);
    expect(mine(got.items.map((x) => x.id))).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
  });
});

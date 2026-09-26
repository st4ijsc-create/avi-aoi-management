/**
 * doc 80 Đợt 0 — Task 6 (FLOW-05/FLT-06, FLT-02, FLT-03, SAF-01) — fleetRouter trên CSDL THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Ba lỗ đo trên `fleetRouter.ts`/`taskAllocator.ts` (Phụ lục E §4, Phụ lục F FLOW-05):
 *   FLOW-05/FLT-06 — `allocateTask` đọc `task.status` rồi ghi KHÔNG điều kiện ⇒ hai lượt
 *     allocate cùng task đồng thời đều "thắng" (phân bổ kép). Chỉ tái hiện được trên
 *     Postgres thật (một UPDATE tại một thời điểm trên MỘT hàng — fake-db không có khoá
 *     hàng thật; bản fake-db đi kèm ở `fleet.g1.test.ts` chỉ là lưới nhanh bổ sung).
 *   FLT-02 — 10 mutation cốt lõi (create/allocate/assign/complete/rebalance/cancel/
 *     createZone/reserve/release/resolveDeadlock) không ghi actor, không có dòng
 *     `control_audit_log` nào.
 *   FLT-03 — các mutation trên nhận `taskId`/`deviceId`/`zoneId` là LỜI TỰ KHAI, không
 *     kiểm phạm vi nhà máy của thực thể được sửa (khác đường ĐỌC, đã lọc bằng
 *     `idsTrongPhamVi` + `taskFactoryGate`/`robotFactoryGate`/`zones.factoryId`).
 *
 * Hai nhà máy độc lập (A/B) + một engineer chỉ được gán A: A sửa được thực thể của A
 * (và ghi audit), A KHÔNG sửa được thực thể của B (FORBIDDEN, KHÔNG ghi gì xuống DB).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t6_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const FAC_A = `T6FA_${RUN}`.slice(0, 50);
const FAC_B = `T6FB_${RUN}`.slice(0, 50);

// userId tổng hợp — không có FK users→user_factory_assignments/permissions (cùng tiền lệ
// commandCenterKpiScope.db.test.ts), nên gieo được mà không chạm bảng `users`.
const U_ADMIN = 951101;
const U_ENG_A = 951102;
const U_ENG_B = 951103;
const ALL_USERS = [U_ADMIN, U_ENG_A, U_ENG_B];

const ctxFor = (id: number, role: string) =>
  ({ user: { id, role, name: `u${id}`, twoFactorEnabled: true } }) as any;

let sql: ReturnType<typeof postgres>;
const ids = {
  facA: 0, facB: 0,
  wsA: 0, wsB: 0,
  lineA: 0, lineB: 0,
  robotA: 0, robotB: 0,
  zoneA: 0, zoneB: 0,
};

/** Tạo một task PENDING trong một nhà máy — không gán device/work-order (đường ghi rời
 *  `tasks.factoryId` là nhánh CHÓT của `taskFactoryGate`; giữ fixture đơn giản: mọi task
 *  test ở đây phân giải qua đúng nhánh đó). */
async function mkTask(key: string, factoryId: number, status = "pending"): Promise<number> {
  const r = await sql`
    INSERT INTO tasks ("taskKey", "requiredCapability", status, priority, "factoryId")
    VALUES (${key}, 'run_job', ${status}, 3, ${factoryId}) RETURNING id`;
  return Number((r[0] as { id: number }).id);
}

async function auditRows(entityType: string, entityId: number | string, action: string) {
  return sql`
    SELECT * FROM control_audit_log
    WHERE "entityType" = ${entityType} AND "entityId" = ${String(entityId)} AND action = ${action}
    ORDER BY id DESC`;
}

describe.skipIf(!DB_URL)("fleetRouter Đợt 0 Task 6 — CAS đồng thời · actor+audit · phạm vi nhà máy khi ghi (CSDL THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    process.env.FLEET_ORCH_ENABLED = "true";
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.facA = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"T6 " + FAC_A}, true) RETURNING id`);
    ids.facB = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"T6 " + FAC_B}, true) RETURNING id`);
    ids.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facA}, ${FAC_A + "_WS"}, 'wsA') RETURNING id`);
    ids.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.facB}, ${FAC_B + "_WS"}, 'wsB') RETURNING id`);
    ids.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsA}, ${FAC_A + "_L1"}, 'lineA') RETURNING id`);
    ids.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.wsB}, ${FAC_B + "_L1"}, 'lineB') RETURNING id`);

    // robots — phạm vi qua `lineId` (robotFactoryGate), isEnabled=true + status='idle' để
    // là ứng viên hợp lệ cho allocator (loadCandidatesFromDb lọc isEnabled=true).
    ids.robotA = await one(sql`
      INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId")
      VALUES (${RUN + "_RA"}, 'robotA', 'sim', 'arm', 'tcp://127.0.0.1:1', true, 'idle', ${ids.lineA}) RETURNING id`);
    ids.robotB = await one(sql`
      INSERT INTO robots (code, name, vendor, kind, endpoint, "isEnabled", status, "lineId")
      VALUES (${RUN + "_RB"}, 'robotB', 'sim', 'arm', 'tcp://127.0.0.1:1', true, 'idle', ${ids.lineB}) RETURNING id`);

    // zones — phạm vi qua cột `factoryId` trực tiếp (bảy bảng "ghi thẳng" theo docblock đầu router).
    ids.zoneA = await one(sql`INSERT INTO zones (code, name, "maxConcurrentRobots", "factoryId") VALUES (${RUN + "_ZA"}, 'zoneA', 5, ${ids.facA}) RETURNING id`);
    ids.zoneB = await one(sql`INSERT INTO zones (code, name, "maxConcurrentRobots", "factoryId") VALUES (${RUN + "_ZB"}, 'zoneB', 5, ${ids.facB}) RETURNING id`);

    // Bản gán + quyền THẬT (đúng đường một lượt HTTP thật đi qua requirePermission/idsTrongPhamVi).
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_ENG_A}, ${FAC_A})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_ENG_B}, ${FAC_B})`;
    for (const uid of [U_ENG_A, U_ENG_B]) {
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${uid}, 'machine_monitoring', 'machine_status', true)`;
      await sql`INSERT INTO permissions ("userId", category, "moduleName", "canCreate") VALUES (${uid}, 'machine_control', 'machine_control', true)`;
    }
  });

  afterAll(async () => {
    if (!sql) return;
    // `control_audit_log` là sổ WORM (vai `avi_app` không có quyền DELETE) — không dọn,
    // cùng tiền lệ `interlockRouterMocIlk10.db.test.ts`/`programmingService.dot0.db.test.ts`.
    await sql`DELETE FROM tasks WHERE "taskKey" LIKE ${RUN + "%"}`;
    await sql`DELETE FROM zone_reservations WHERE "zoneId" IN ${sql([ids.zoneA, ids.zoneB])}`;
    await sql`DELETE FROM zones WHERE id IN ${sql([ids.zoneA, ids.zoneB])}`;
    await sql`DELETE FROM robots WHERE id IN ${sql([ids.robotA, ids.robotB])}`;
    await sql`DELETE FROM production_lines WHERE id IN ${sql([ids.lineA, ids.lineB])}`;
    await sql`DELETE FROM workshops WHERE id IN ${sql([ids.wsA, ids.wsB])}`;
    await sql`DELETE FROM factories WHERE id IN ${sql([ids.facA, ids.facB])}`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(ALL_USERS)}`;
    await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ALL_USERS)}`;
    delete process.env.FLEET_ORCH_ENABLED;
    await sql.end({ timeout: 5 });
  });

  const caller = async (userId: number, role: string) =>
    (await import("./fleetRouter")).fleetRouter.createCaller(ctxFor(userId, role));

  // ════════════════════════════════════════════════════════════════════════
  // FLOW-05/FLT-06 — CAS: hai allocate() đồng thời trên CÙNG task ⇒ gán đúng 1 lần
  // ════════════════════════════════════════════════════════════════════════
  describe("FLOW-05/FLT-06 — allocateTask CAS trên Postgres thật", () => {
    it("★★★ hai lượt allocate() song song trên CÙNG task pending ⇒ đúng 1 lượt ok:true, task gán đúng 1 lần", async () => {
      const taskId = await mkTask(`${RUN}_ALLOC_RACE`, ids.facA);
      const c = await caller(U_ADMIN, "admin");
      const [r1, r2] = await Promise.all([c.allocate({ taskId }), c.allocate({ taskId })]);
      const winners = [r1, r2].filter((r) => r.ok);
      const losers = [r1, r2].filter((r) => !r.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.message).toMatch(/conflict/i);

      const rows = await sql`SELECT status, "assignedDeviceId" FROM tasks WHERE id = ${taskId}`;
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).status).toBe("assigned");
      expect((rows[0] as any).assignedDeviceId).not.toBeNull();

      // FLT-02 — cả HAI lượt gọi (thắng lẫn thua) đều ghi audit (ghi lại NỖ LỰC, không chỉ
      // kết cục) — 2 dòng, cùng actor.
      const audited = await auditRows("fleet_task", taskId, "allocate");
      expect(audited).toHaveLength(2);
      expect(audited.every((r: any) => r.actorId === U_ADMIN)).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 + FLT-03 — allocate
  // ════════════════════════════════════════════════════════════════════════
  describe("allocate — FLT-02 (actor+audit) + FLT-03 (phạm vi nhà máy)", () => {
    it("engineer A allocate task của CHÍNH A ⇒ không FORBIDDEN, ghi audit có actor", async () => {
      const taskId = await mkTask(`${RUN}_ALLOC_OWN`, ids.facA);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.allocate({ taskId })).resolves.toBeDefined();
      const audited = await auditRows("fleet_task", taskId, "allocate");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A allocate task của NHÀ MÁY B ⇒ FORBIDDEN, task KHÔNG đổi, KHÔNG ghi audit", async () => {
      const taskId = await mkTask(`${RUN}_ALLOC_CROSS`, ids.facB);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.allocate({ taskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("pending");
      expect(await auditRows("fleet_task", taskId, "allocate")).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 + FLT-03 — assign
  // ════════════════════════════════════════════════════════════════════════
  describe("assign — FLT-02 (actor+audit) + FLT-03 (phạm vi nhà máy)", () => {
    it("engineer A assign task A → robot A (cùng nhà máy) ⇒ ok, ghi audit có actor", async () => {
      const taskId = await mkTask(`${RUN}_ASSIGN_OWN`, ids.facA);
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.assign({ taskId, deviceId: ids.robotA });
      expect(r.ok).toBe(true);
      const rows = await sql`SELECT status, "assignedDeviceId" FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("assigned");
      expect((rows[0] as any).assignedDeviceId).toBe(ids.robotA);
      const audited = await auditRows("fleet_task", taskId, "assign");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A assign TASK của B (device của A) ⇒ FORBIDDEN, task KHÔNG đổi", async () => {
      const taskId = await mkTask(`${RUN}_ASSIGN_TASK_CROSS`, ids.facB);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.assign({ taskId, deviceId: ids.robotA })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("pending");
    });

    it("engineer A assign task của A → DEVICE của B ⇒ FORBIDDEN, task KHÔNG đổi", async () => {
      const taskId = await mkTask(`${RUN}_ASSIGN_DEVICE_CROSS`, ids.facA);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.assign({ taskId, deviceId: ids.robotB })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("pending");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 + FLT-03 — completeTask / cancelTask
  // ════════════════════════════════════════════════════════════════════════
  describe("completeTask / cancelTask — FLT-02 + FLT-03", () => {
    it("engineer A completeTask của CHÍNH A ⇒ ok, ghi audit", async () => {
      const taskId = await mkTask(`${RUN}_COMPLETE_OWN`, ids.facA);
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.completeTask({ taskId, outcome: "completed" });
      expect(r.ok).toBe(true);
      const audited = await auditRows("fleet_task", taskId, "completed");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A completeTask của B ⇒ FORBIDDEN, task KHÔNG đổi", async () => {
      const taskId = await mkTask(`${RUN}_COMPLETE_CROSS`, ids.facB);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.completeTask({ taskId, outcome: "completed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("pending");
    });

    it("engineer A cancelTask của CHÍNH A ⇒ ok, ghi audit", async () => {
      const taskId = await mkTask(`${RUN}_CANCEL_OWN`, ids.facA);
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.cancelTask({ taskId, reason: "t6-test" });
      expect(r.ok).toBe(true);
      const audited = await auditRows("fleet_task", taskId, "cancel");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A cancelTask của B ⇒ FORBIDDEN, task KHÔNG đổi", async () => {
      const taskId = await mkTask(`${RUN}_CANCEL_CROSS`, ids.facB);
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.cancelTask({ taskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect((rows[0] as any).status).toBe("pending");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 + FLT-03 — rebalanceDevice
  // ════════════════════════════════════════════════════════════════════════
  describe("rebalanceDevice — FLT-02 + FLT-03", () => {
    it("engineer A rebalance robot của CHÍNH A ⇒ ok, ghi audit", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.rebalanceDevice({ deviceId: ids.robotA, reason: "t6-test" });
      expect(r.ok).toBe(true);
      const audited = await auditRows("robot", ids.robotA, "rebalance");
      expect(audited.length).toBeGreaterThanOrEqual(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A rebalance robot của B ⇒ FORBIDDEN", async () => {
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.rebalanceDevice({ deviceId: ids.robotB })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 — createTask / createZone (tạo mới — không có FLT-03, không thực thể có sẵn)
  // ════════════════════════════════════════════════════════════════════════
  describe("createTask / createZone — FLT-02 (actor+audit)", () => {
    it("createTask ghi actor + audit khi TẠO MỚI (không ghi audit khi replay idempotent)", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const key = `${RUN}_CREATE_TASK`;
      const r1 = await c.createTask({ taskKey: key, requiredCapability: "run_job", factoryId: ids.facA });
      expect(r1.created).toBe(true);
      const audited = await auditRows("fleet_task", r1.id!, "create");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);

      const r2 = await c.createTask({ taskKey: key, requiredCapability: "run_job", factoryId: ids.facA });
      expect(r2.created).toBe(false); // replay — idempotent, no new row
      expect(await auditRows("fleet_task", r1.id!, "create")).toHaveLength(1); // still exactly 1
    });

    it("createZone ghi actor + audit", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.createZone({ code: `${RUN}_ZC`, name: "zoneC", factoryId: ids.facA });
      expect(r.ok).toBe(true);
      const audited = await auditRows("zone", r.id!, "create");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
      await sql`DELETE FROM zones WHERE id = ${r.id!}`;
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 + FLT-03 — reserve / release
  // ════════════════════════════════════════════════════════════════════════
  describe("reserve / release — FLT-02 + FLT-03", () => {
    it("engineer A reserve zoneA + robotA (cùng nhà máy) ⇒ ok, ghi audit", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.reserve({ zoneId: ids.zoneA, deviceId: ids.robotA });
      expect(r.ok).toBe(true);
      const audited = await auditRows("zone_reservation", r.reservationId!, "reserve");
      expect(audited).toHaveLength(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });

    it("engineer A reserve zoneB (nhà máy khác) + robotA ⇒ FORBIDDEN", async () => {
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.reserve({ zoneId: ids.zoneB, deviceId: ids.robotA })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("engineer A reserve zoneA + robotB (nhà máy khác) ⇒ FORBIDDEN", async () => {
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.reserve({ zoneId: ids.zoneA, deviceId: ids.robotB })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("engineer A release robotA (cùng nhà máy) ⇒ ok, ghi audit", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.release({ deviceId: ids.robotA, zoneId: ids.zoneA });
      expect(r.ok).toBe(true);
      const audited = await auditRows("zone_reservation", ids.zoneA, "release");
      expect(audited.length).toBeGreaterThanOrEqual(1);
    });

    it("engineer A release robotB (nhà máy khác) ⇒ FORBIDDEN", async () => {
      const c = await caller(U_ENG_A, "engineer");
      await expect(c.release({ deviceId: ids.robotB })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // FLT-02 — resolveDeadlock (hệ thống-toàn cục, không có thực thể để chiếu phạm vi)
  // ════════════════════════════════════════════════════════════════════════
  describe("resolveDeadlock — FLT-02 (actor+audit)", () => {
    it("ghi actor + audit dù không có deadlock nào", async () => {
      const c = await caller(U_ENG_A, "engineer");
      const r = await c.resolveDeadlock();
      expect(r.ok).toBe(true);
      const audited = await auditRows("fleet_deadlock", "global", "resolve");
      expect(audited.length).toBeGreaterThanOrEqual(1);
      expect((audited[0] as any).actorId).toBe(U_ENG_A);
    });
  });
});

/**
 * doc 81 Đợt 3 Task 4 (QĐ-3a, mig 0363) — giao việc Kỹ thuật trên CSDL `_test` THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Canh năm điều của brief + Review Focus #2:
 *   §1 giao / bỏ giao / giao lại ⇒ đúng hàng phân công + 1 audit + 1 thông báo (actionUrl = link sâu) mỗi lượt;
 *   §2 phân công lặp bị chặn (CAS + chỉ mục UNIQUE … WHERE active, kể cả hai lượt ĐUA);
 *   §3 cổng: người giao cần quyền sửa/duyệt; người được giao tồn tại · đang hoạt động · XEM được trang đích;
 *   §4 ★★★ GIAO KHÔNG CẤP QUYỀN DUYỆT — đo trên CHÍNH các thủ tục duyệt: người được giao thiếu quyền ⇒ bị từ
 *      chối; tác giả tự giao cho mình ⇒ vẫn bị maker-checker/SoD chặn;
 *   §5 `pendingSummary.mine` đúng người, chỉ mục còn chờ duyệt, tên chỉ khi có quyền xem;
 *   §6 roster "Giao cho" (`permissionHeldSql`) == `checkPermission` trên từng người (cả hai chế độ scoped-admin).
 * Người dùng/thực thể gieo theo tiền tố RUN, dọn ở afterAll (audit/notification theo id mục đã gieo).
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `t4a_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

let sql: ReturnType<typeof postgres>;
const uid: Record<string, number> = {};
const created = { ecn: [] as number[], recipe: [] as number[], rule: [] as number[], changeover: [] as number[], run: [] as number[], wf: [] as number[] };
let machineId = 0;
let machineType: string | null = null;

const ctxOf = (key: string) => {
  const role = ROLES[key];
  return { user: { id: uid[key], role, name: `${RUN} ${key}`, twoFactorEnabled: key !== "engNo2fa" } } as any;
};
const ROLES: Record<string, string> = {
  supAssigner: "supervisor", // machine_control canEdit + interlock canEdit ⇒ GIAO được ECN/recipe/changeover/rule
  engViewer: "engineer", // machine_control canView ⇒ được giao, KHÔNG có canEdit/canCreate
  engViewer2: "engineer",
  userViewer: "user", // machine_control canView, vai KHÔNG có trong ecnDecisionProcedure
  engNoView: "engineer", // không quyền gì
  engInactive: "engineer", // canView nhưng isActive=false
  engCtlOnly: "engineer", // machine_control canView, KHÔNG machine_status ⇒ không mở được /product-changeover
  engAuthor: "engineer", // machine_control canEdit/canCreate + interlock canEdit — tác giả tự giao
  supAuthor: "supervisor", // tác giả ECN (vai quyết định) — tự giao
  adminA: "admin",
  monitorOnly: "operator", // chỉ machine_status ⇒ gọi được pendingSummary, KHÔNG thấy tên
  // fix 1 (R-3-e) — CÓ ĐỦ bit quyền sửa/duyệt nhưng NGOÀI sàn vai của đường sửa/duyệt thật.
  opFull: "operator",
  viewerFull: "viewer",
  userFull: "user",
  engNo2fa: "engineer", // đủ bit, vai đúng, CHƯA bật 2FA
  // doc 81 Đợt 5 H5 — roster theo nhà máy: người của nhà máy B (gán nhà máy / gán tập đoàn), người giao KHÔNG được gán nhà máy.
  engB: "engineer",
  engCorpB: "engineer",
  supNoFac: "supervisor",
  supB: "supervisor", // giao được (machine_control canCreate) — CHỈ nhà máy B
  supMulti: "supervisor", // giao được — HAI nhà máy ("nhà" + B)
  dualEng: "engineer", // H fix 1 (I1) — người được giao có CẢ HAI nhà máy ("nhà" + B)
};
const PERMS: Record<string, Array<[string, string, Partial<Record<"canView" | "canCreate" | "canEdit", boolean>>]>> = {
  supAssigner: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engViewer: [["machine_control", "machine_control", { canView: true }], ["interlock", "interlock", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engViewer2: [["machine_control", "machine_control", { canView: true }], ["interlock", "interlock", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  userViewer: [["machine_control", "machine_control", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engInactive: [["machine_control", "machine_control", { canView: true }]],
  engCtlOnly: [["machine_control", "machine_control", { canView: true }]],
  engAuthor: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  supAuthor: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  monitorOnly: [["machine_monitoring", "machine_status", { canView: true }]],
  opFull: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  viewerFull: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  userFull: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engNo2fa: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canCreate: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engB: [["machine_control", "machine_control", { canView: true }], ["interlock", "interlock", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  engCorpB: [["machine_control", "machine_control", { canView: true }], ["interlock", "interlock", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  supNoFac: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  supB: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  supMulti: [["machine_control", "machine_control", { canView: true, canCreate: true, canEdit: true }], ["interlock", "interlock", { canView: true, canEdit: true }], ["machine_monitoring", "machine_status", { canView: true }]],
  dualEng: [["machine_control", "machine_control", { canView: true }], ["interlock", "interlock", { canView: true }], ["machine_monitoring", "machine_status", { canView: true }]],
};
/**
 * doc 81 Đợt 5 H5 (mục 30) — roster "Giao cho" theo NHÀ MÁY. Mọi người gieo (trừ admin, engB/engCorpB/supNoFac) được gán nhà
 * máy "nhà" = nhà máy của máy dùng cho changeover (để các ô cũ — mục không có nhà máy ⇒ nhà máy người giao — đo đúng như
 * trước); nhà máy B (+ tập đoàn B) là nhà máy THỨ HAI của lượt này.
 */
const H5_NO_HOME = new Set(["engB", "engCorpB", "supNoFac", "supB"]);
const h5 = { homeId: 0, homeCode: "", homeCreated: false, facB: 0, corpB: "", wsB: 0, lineB: 0, stationB: 0, machineB: 0, robotMachineB: 0, robotB: 0 };

async function engineering() {
  return (await import("./engineeringAssignmentRouter")).engineeringAssignmentRouter;
}
async function as(key: string) {
  return (await engineering()).createCaller(ctxOf(key));
}

async function mkEcn(status: string, requestedBy: number, reviewedBy: number | null = null): Promise<number> {
  const key = `${RUN}_${Math.random().toString(36).slice(2, 10)}`;
  const [r] = await sql`INSERT INTO engineering_changes ("ecnKey", title, "changeType", status, "requestedBy", "reviewedBy")
    VALUES (${key}, ${"t4 " + key}, 'process', ${status}, ${requestedBy}, ${reviewedBy}) RETURNING id`;
  created.ecn.push(Number(r.id));
  return Number(r.id);
}
async function mkRecipe(createdBy: number, status = "draft"): Promise<number> {
  const code = `${RUN}_R${created.recipe.length}`;
  const [r] = await sql`INSERT INTO machine_recipes ("machineId", "machineType", code, name, version, payload, status, "createdBy")
    VALUES (NULL, ${machineType}, ${code}, ${"t4 recipe " + code}, 1, ${sql.json({ speed: 1 })}, ${status}, ${createdBy}) RETURNING id`;
  created.recipe.push(Number(r.id));
  return Number(r.id);
}
async function mkRule(createdBy: number): Promise<number> {
  const [r] = await sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", action, "createdBy", "updatedBy")
    VALUES (${`${RUN} rule ${created.rule.length}`}, 'machine', 'ng_rate', 'gt', 'alert', ${createdBy}, ${createdBy}) RETURNING id`;
  created.rule.push(Number(r.id));
  return Number(r.id);
}
async function mkChangeover(requestedBy: number): Promise<number> {
  const recipeId = await mkRecipe(requestedBy, "archived");
  const [r] = await sql`INSERT INTO changeover_requests ("machineId", "recipeId", "requestedBy", status)
    VALUES (${machineId}, ${recipeId}, ${requestedBy}, 'pending') RETURNING id`;
  created.changeover.push(Number(r.id));
  return Number(r.id);
}
// doc 81 Đợt 5 task E fix 1 (2026-10-10) — a run now belongs to a REAL workflow: orchestration has a factory scope (E2), and
// a run whose workflow row does not exist (the old fixture used workflowId -424242 — a shape the product never creates:
// deleteWorkflow cascades its runs) is visible only to an unrestricted scope. The workflow is TARGET-FREE (gates only), so
// every viewer of this suite still sees its runs exactly as before.
async function fixtureWorkflowId(): Promise<number> {
  if (created.wf.length) return created.wf[0];
  const ref = `${RUN}-wf`;
  const def = { ref, name: ref, steps: [{ id: "gate1", type: "hitl_gate", prompt: "p" }, { id: "gate2", type: "hitl_gate", prompt: "p" }] };
  const [w] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status) VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active') RETURNING id`;
  created.wf.push(Number(w.id));
  return Number(w.id);
}
async function mkRun(status = "awaiting_confirm"): Promise<number> {
  const wfId = await fixtureWorkflowId();
  const [r] = await sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "currentStepId")
    VALUES (${wfId}, ${`${RUN}-wf`}, ${status}, 'gate1') RETURNING id`;
  created.run.push(Number(r.id));
  return Number(r.id);
}

async function activeRows(type: string, id: number) {
  return sql`SELECT assignee_user_id, assigned_by, active, note FROM engineering_assignments WHERE entity_type = ${type} AND entity_id = ${id} ORDER BY id`;
}
async function auditRows(type: string, id: number) {
  return sql`SELECT action, "actorId", reason, "beforeJson", "afterJson" FROM control_audit_log
    WHERE "entityType" = 'engineering_assignment' AND "entityId" = ${`${type}:${id}`} ORDER BY id`;
}
async function notifRows(userId: number) {
  return sql`SELECT "userId", title, "actionUrl", "entityType", "entityId", metadata FROM notifications WHERE "userId" = ${userId} ORDER BY id`;
}

describe.skipIf(!DB_URL)("engineering.assign/unassign + pendingSummary.mine (CSDL _test THẬT)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const [{ d }] = await sql`SELECT current_database() AS d`;
    if (!String(d).endsWith("_test")) throw new Error(`KHÔNG chạy ngoài _test (đang ở ${d})`);
    const [{ co }] = await sql`SELECT to_regclass('public.engineering_assignments') IS NOT NULL AS co`;
    if (!co) throw new Error("bảng engineering_assignments chưa có — chạy `node scripts/apply-migration-0363.mjs --test-only`");
    for (const key of Object.keys(ROLES)) {
      const [r] = await sql`INSERT INTO users ("openId", username, name, role, "isActive", two_factor_enabled)
        VALUES (${`${RUN}-${key}`}, ${`${RUN}-${key}`}, ${`${RUN} ${key}`}, ${ROLES[key]}, ${key !== "engInactive"}, true) RETURNING id`;
      uid[key] = Number(r.id);
      for (const [category, module, bits] of PERMS[key] ?? []) {
        await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit")
          VALUES (${uid[key]}, ${category}, ${module}, ${!!bits.canView}, ${!!bits.canCreate}, ${!!bits.canEdit})`;
      }
    }
    const [m] = await sql`SELECT id, "machineType" FROM machines ORDER BY id LIMIT 1`;
    machineId = Number(m.id);
    machineType = m.machineType;
    // H5 — nhà máy "nhà" = nhà máy của máy changeover (máy → trạm → chuyền → xưởng); không có ⇒ tạo nhà máy riêng của lượt.
    const [home] = await sql`SELECT f.id, f.code FROM machines mm JOIN stations s ON s.id = mm."stationId"
      JOIN production_lines pl ON pl.id = s."lineId" JOIN workshops w ON w.id = pl."workshopId" JOIN factories f ON f.id = w."factoryId"
      WHERE mm.id = ${machineId}`;
    if (home) {
      h5.homeId = Number(home.id);
      h5.homeCode = String(home.code);
    } else {
      const [f] = await sql`INSERT INTO factories (code, name) VALUES (${`${RUN}-HOME`}, ${`${RUN} home`}) RETURNING id, code`;
      Object.assign(h5, { homeId: Number(f.id), homeCode: String(f.code), homeCreated: true });
    }
    for (const key of Object.keys(ROLES)) {
      if (ROLES[key] === "admin" || H5_NO_HOME.has(key)) continue;
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid[key]}, ${h5.homeCode})`;
    }
    h5.corpB = `${RUN}-CB`.slice(0, 50);
    await sql`INSERT INTO corporates (code, name) VALUES (${h5.corpB}, ${`${RUN} corp B`})`;
    const [fb] = await sql`INSERT INTO factories (code, name, "corporateCode") VALUES (${`${RUN}-FB`}, ${`${RUN} factory B`}, ${h5.corpB}) RETURNING id`;
    h5.facB = Number(fb.id);
    const [wb] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${h5.facB}, ${`${RUN}-WB`}, ${`${RUN} ws B`}) RETURNING id`;
    h5.wsB = Number(wb.id);
    const [lb] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${h5.wsB}, ${`${RUN}-LB`}, ${`${RUN} line B`}) RETURNING id`;
    h5.lineB = Number(lb.id);
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid.engB}, ${`${RUN}-FB`})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid.supB}, ${`${RUN}-FB`})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid.supMulti}, ${`${RUN}-FB`})`;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uid.dualEng}, ${`${RUN}-FB`})`;
    const [sb] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${h5.lineB}, ${`${RUN}-SB`}, ${`${RUN} station B`}) RETURNING id`;
    h5.stationB = Number(sb.id);
    const [mb] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${h5.stationB}, ${`${RUN}-MB`}, ${`${RUN} machine B`}, ${machineType}, true) RETURNING id`;
    h5.machineB = Number(mb.id);
    // H fix 1 (I1) — a ROBOT cell in factory B: a robot ABORT step there is a VERIFIED stop (robot stop job, R-5-j).
    const [rmb] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
      VALUES (${h5.stationB}, ${`${RUN}-RMB`}, ${`${RUN} robot cell B`}, 'ROBOT', true) RETURNING id`;
    h5.robotMachineB = Number(rmb.id);
    const [rb] = await sql`INSERT INTO robots (code, name, vendor, endpoint, "lineId") VALUES (${`${RUN}-RB`}, ${`${RUN} robot B`}, 'sim', 'sim://h5', ${h5.lineB}) RETURNING id`;
    h5.robotB = Number(rb.id);
    await sql`INSERT INTO user_corporate_assignments ("userId", "corporateCode") VALUES (${uid.engCorpB}, ${h5.corpB})`;
  });

  afterAll(async () => {
    if (!sql) return;
    const ids = Object.values(uid);
    const ent = (t: string, xs: number[]) => xs.map((x) => `${t}:${x}`);
    const auditIds = [...ent("ecn", created.ecn), ...ent("recipe", created.recipe), ...ent("interlock_rule", created.rule), ...ent("changeover", created.changeover), ...ent("orchestration_run", created.run)];
    if (auditIds.length) await sql`DELETE FROM control_audit_log WHERE "entityType" = 'engineering_assignment' AND "entityId" IN ${sql(auditIds)}`.catch(() => undefined);
    if (ids.length) {
      await sql`DELETE FROM notifications WHERE "userId" IN ${sql(ids)}`;
      // Bảng phân công: avi_app KHÔNG có DELETE (mig 0363 — chỉ ghi thêm + đổi active) ⇒ chỉ TẮT, không xoá.
      await sql`UPDATE engineering_assignments SET active = false WHERE assignee_user_id IN ${sql(ids)} AND active`;
    }
    if (created.changeover.length) await sql`DELETE FROM changeover_requests WHERE id IN ${sql(created.changeover)}`;
    if (created.run.length) await sql`DELETE FROM orchestration_runs WHERE id IN ${sql(created.run)}`;
    if (created.wf.length) await sql`DELETE FROM orchestration_workflows WHERE id IN ${sql(created.wf)}`;
    if (created.ecn.length) await sql`DELETE FROM engineering_changes WHERE id IN ${sql(created.ecn)}`;
    if (created.rule.length) await sql`DELETE FROM interlock_rules WHERE id IN ${sql(created.rule)}`.catch(() => undefined);
    if (created.recipe.length) await sql`DELETE FROM machine_recipes WHERE id IN ${sql(created.recipe)}`.catch(() => undefined);
    if (ids.length) {
      await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql(ids)}`.catch(() => undefined);
      await sql`DELETE FROM user_corporate_assignments WHERE "userId" IN ${sql(ids)}`.catch(() => undefined);
    }
    if (h5.machineB) await sql`DELETE FROM machine_recipes WHERE "machineId" = ${h5.machineB}`.catch(() => undefined);
    if (h5.machineB) await sql`DELETE FROM machines WHERE id = ${h5.machineB}`.catch(() => undefined);
    if (h5.robotMachineB) await sql`DELETE FROM machines WHERE id = ${h5.robotMachineB}`.catch(() => undefined);
    if (h5.robotB) await sql`DELETE FROM robots WHERE id = ${h5.robotB}`.catch(() => undefined);
    if (h5.stationB) await sql`DELETE FROM stations WHERE id = ${h5.stationB}`.catch(() => undefined);
    if (h5.lineB) await sql`DELETE FROM production_lines WHERE id = ${h5.lineB}`.catch(() => undefined);
    if (h5.wsB) await sql`DELETE FROM workshops WHERE id = ${h5.wsB}`.catch(() => undefined);
    if (h5.facB) await sql`DELETE FROM factories WHERE id = ${h5.facB}`.catch(() => undefined);
    if (h5.homeCreated) await sql`DELETE FROM factories WHERE id = ${h5.homeId}`.catch(() => undefined);
    if (h5.corpB) await sql`DELETE FROM corporates WHERE code = ${h5.corpB}`.catch(() => undefined);
    if (ids.length) {
      await sql`DELETE FROM permissions WHERE "userId" IN ${sql(ids)}`;
      await sql`UPDATE users SET "isActive" = false WHERE id IN ${sql(ids)}`;
      await sql`DELETE FROM users WHERE id IN ${sql(ids)}`.catch(() => undefined);
    }
    await sql.end({ timeout: 5 });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§1 giao / bỏ giao / giao lại — hàng phân công + audit + thông báo", () => {
    it("★ giao ECN chờ duyệt ⇒ 1 hàng active · 1 audit `assign` · 1 thông báo cho người được giao, actionUrl = link sâu", async () => {
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const r = await (await as("supAssigner")).assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null, note: "xem giúp" });
      expect(r).toMatchObject({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, assigneeName: `${RUN} engViewer` });
      const rows = await activeRows("ecn", ecnId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ assignee_user_id: uid.engViewer, assigned_by: uid.supAssigner, active: true, note: "xem giúp" });
      const audit = await auditRows("ecn", ecnId);
      expect(audit.map((a) => [a.action, a.actorId])).toEqual([["assign", uid.supAssigner]]);
      const n = (await notifRows(uid.engViewer)).filter((x) => x.entityId === ecnId);
      expect(n).toHaveLength(1);
      expect(n[0].actionUrl).toBe(`/engineering-changes?flyout=ecn&flyoutId=${ecnId}`);
      expect(n[0].entityType).toBe("engineering_ecn");
      expect(n[0].title).toContain("Bạn được giao");
      // doc 81 Đợt 3b final wave — khoá i18n + tham số trong metadata (client dịch bằng t(), chữ đã lưu là dự phòng).
      const [{ title: ecnTitle }] = await sql`SELECT title FROM engineering_changes WHERE id = ${ecnId}`;
      expect((n[0].metadata as any).i18n).toEqual({
        title: "notifications.assignment.assignedTitle",
        message: "notifications.assignment.assignedMessage",
        params: { label: expect.stringContaining(ecnTitle), by: `${RUN} supAssigner`, entityType: "ecn", entityId: ecnId },
      });
    });

    it("giao lại A→B (CAS đúng A) ⇒ A tắt, B active · audit [unassign, assign] · A nhận 'bỏ giao', B nhận 'được giao'", async () => {
      const ecnId = await mkEcn("in_review", uid.engAuthor, uid.supAuthor);
      const c = await as("supAssigner");
      await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: uid.engViewer });
      const rows = await activeRows("ecn", ecnId);
      expect(rows.map((x) => [x.assignee_user_id, x.active])).toEqual([[uid.engViewer, false], [uid.engViewer2, true]]);
      expect((await auditRows("ecn", ecnId)).map((a) => a.action)).toEqual(["assign", "unassign", "assign"]);
      const nA = (await notifRows(uid.engViewer)).filter((x) => x.entityId === ecnId).map((x) => (x.metadata as any).action);
      const nB = (await notifRows(uid.engViewer2)).filter((x) => x.entityId === ecnId).map((x) => (x.metadata as any).action);
      expect(nA).toEqual(["assigned", "unassigned"]);
      expect(nB).toEqual(["assigned"]);
      // fix 1 — thông báo bỏ giao (giao lại) cho người CŨ không mang tiêu đề ECN.
      const [{ title: ecnTitle }] = await sql`SELECT title FROM engineering_changes WHERE id = ${ecnId}`;
      const unassignedA = (await notifRows(uid.engViewer)).filter((x) => x.entityId === ecnId && (x.metadata as any).action === "unassigned");
      expect(unassignedA.map((x) => x.title)).toEqual([`Đã bỏ giao: ECN #${ecnId}`]);
      expect(unassignedA[0].title).not.toContain(ecnTitle);
    });

    it("bỏ giao (CAS đúng) ⇒ không còn hàng active · audit `unassign` · 1 thông báo cho người bị bỏ giao", async () => {
      const ruleId = await mkRule(uid.engAuthor);
      const c = await as("supAssigner");
      await c.assign({ entityType: "interlock_rule", entityId: ruleId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await expect(c.unassign({ entityType: "interlock_rule", entityId: ruleId, expectedAssigneeUserId: uid.engViewer2 })).rejects.toMatchObject({ code: "CONFLICT" });
      await c.unassign({ entityType: "interlock_rule", entityId: ruleId, expectedAssigneeUserId: uid.engViewer });
      expect((await activeRows("interlock_rule", ruleId)).filter((x) => x.active)).toHaveLength(0);
      expect((await auditRows("interlock_rule", ruleId)).map((a) => a.action)).toEqual(["assign", "unassign"]);
      const n = (await notifRows(uid.engViewer)).filter((x) => x.entityId === ruleId);
      expect(n.map((x) => (x.metadata as any).action)).toEqual(["assigned", "unassigned"]);
      expect(n.every((x) => x.actionUrl === `/interlock-rules?filter=pending&rule=${ruleId}`)).toBe(true);
      // fix 1 — thông báo BỎ GIAO không mang tên mục (người cũ có thể đã mất quyền xem): chỉ loại + #id.
      const [{ name }] = await sql`SELECT name FROM interlock_rules WHERE id = ${ruleId}`;
      expect(n[0].title).toContain(name);
      expect(n[1].title).not.toContain(name);
      expect(n[1].title).toBe(`Đã bỏ giao: interlock rule #${ruleId}`);
      // final wave — bản i18n của thông báo BỎ GIAO cũng KHÔNG mang tên mục (label null; client dựng "<loại> #id").
      expect((n[1].metadata as any).i18n).toEqual({
        title: "notifications.assignment.unassignedTitle",
        message: "notifications.assignment.unassignedMessage",
        params: { label: null, by: `${RUN} supAssigner`, entityType: "interlock_rule", entityId: ruleId },
      });
      expect(JSON.stringify((n[1].metadata as any).i18n)).not.toContain(name);
    });

    it("link sâu từng loại: recipe ?code=&tab=approval · changeover trang · run ?filter=pending&tab=approvals", async () => {
      const c = await as("supAssigner");
      const recipeId = await mkRecipe(uid.engAuthor);
      const coId = await mkChangeover(uid.engAuthor);
      const runId = await mkRun();
      await c.assign({ entityType: "recipe", entityId: recipeId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await c.assign({ entityType: "changeover", entityId: coId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await c.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      const n = await notifRows(uid.engViewer);
      const url = (t: string, id: number) => n.find((x) => x.entityType === `engineering_${t}` && x.entityId === id)?.actionUrl;
      const [{ code }] = await sql`SELECT code FROM machine_recipes WHERE id = ${recipeId}`;
      expect(url("recipe", recipeId)).toBe(`/recipes?code=${encodeURIComponent(code)}&tab=approval`);
      expect(url("changeover", coId)).toBe("/product-changeover");
      expect(url("orchestration_run", runId)).toBe("/orchestration-studio?filter=pending&tab=approvals");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§2 phân công lặp bị chặn", () => {
    it("giao lại CÙNG người ⇒ CONFLICT alreadyAssignedToUser; giao với expected=null khi đã có người ⇒ CONFLICT assignmentChanged", async () => {
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const c = await as("supAssigner");
      await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await expect(c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: uid.engViewer }))
        .rejects.toMatchObject({ code: "CONFLICT", cause: { appParams: { reason: "alreadyAssignedToUser" } } });
      await expect(c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "CONFLICT", cause: { appParams: { reason: "assignmentChanged" } } });
      expect((await activeRows("ecn", ecnId)).filter((x) => x.active)).toHaveLength(1);
      expect(await auditRows("ecn", ecnId)).toHaveLength(1);
    });

    it("★★ hai lượt giao ĐUA (cùng expected=null) ⇒ đúng 1 thành công + 1 CONFLICT, DB đúng 1 hàng active", async () => {
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const c = await as("supAssigner");
      const rs = await Promise.allSettled([
        c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }),
        c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null }),
      ]);
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rej = rs.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(rej).toHaveLength(1);
      expect(rej[0].reason).toMatchObject({ code: "CONFLICT" });
      expect((await activeRows("ecn", ecnId)).filter((x) => x.active)).toHaveLength(1);
      expect(await auditRows("ecn", ecnId)).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§3 cổng của người giao và người được giao", () => {
    it("người giao KHÔNG có quyền sửa/duyệt (canView) ⇒ FORBIDDEN, không ghi gì", async () => {
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      await expect((await as("engViewer")).assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await activeRows("ecn", ecnId)).toHaveLength(0);
    });

    it("người được giao: không tồn tại / vô hiệu hoá / không xem được ⇒ CÙNG MỘT lời từ chối assigneeInvalid", async () => {
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const c = await as("supAssigner");
      // fix 1 — MỘT lời từ chối cho cả ba (không dò được trạng thái tài khoản): cùng mã, cùng tham số, cùng câu.
      const ra = await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: 2_000_000_000, expectedAssigneeUserId: null }).catch((e) => e);
      const rb = await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engInactive, expectedAssigneeUserId: null }).catch((e) => e);
      const rc = await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engNoView, expectedAssigneeUserId: null }).catch((e) => e);
      for (const e of [ra, rb, rc]) {
        expect(e).toMatchObject({ code: "BAD_REQUEST", message: "Người được giao không hợp lệ.", cause: { appParams: { field: "assigneeUserId", reason: "assigneeInvalid" } } });
      }
      expect(await activeRows("ecn", ecnId)).toHaveLength(0);
    });

    it("changeover cần XEM cả trang (machine_status) lẫn hàng đợi (machine_control): chỉ machine_control ⇒ assigneeCannotView", async () => {
      const coId = await mkChangeover(uid.engAuthor);
      await expect((await as("supAssigner")).assign({ entityType: "changeover", entityId: coId, assigneeUserId: uid.engCtlOnly, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appParams: { reason: "assigneeInvalid" } } });
    });

    it("mục không chờ duyệt (ECN draft) ⇒ PRECONDITION_FAILED assignTargetNotPending · mục không tồn tại ⇒ NOT_FOUND · loại lạ ⇒ BAD_REQUEST (zod)", async () => {
      const c = await as("supAssigner");
      const draft = await mkEcn("draft", uid.engAuthor);
      await expect(c.assign({ entityType: "ecn", entityId: draft, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", cause: { appParams: { reason: "assignTargetNotPending" } } });
      await expect(c.assign({ entityType: "ecn", entityId: 2_000_000_000, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "NOT_FOUND", cause: { appParams: { entity: "ecn" } } });
      await expect(c.assign({ entityType: "standards_cr" as never, entityId: 1, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("đọc phân công: không xem được trang ⇒ FORBIDDEN; xem được ⇒ chỉ tên hiển thị (không username/email/vai)", async () => {
      await expect((await as("engNoView")).assignments({ entityType: "ecn", entityIds: [1] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      await (await as("supAssigner")).assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      const rows = await (await as("engViewer2")).assignments({ entityType: "ecn", entityIds: [ecnId] });
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0]).sort()).toEqual(["assignedAt", "assigneeName", "assigneeUserId", "entityId", "note"]);
      expect(rows[0]).toMatchObject({ entityId: ecnId, assigneeUserId: uid.engViewer, assigneeName: `${RUN} engViewer` });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§4 ★★★ GIAO KHÔNG CẤP QUYỀN DUYỆT (đo trên chính các thủ tục duyệt)", () => {
    it("ECN: người được giao vai `user` (ngoài vai quyết định) bấm duyệt ⇒ FORBIDDEN, ECN không đổi", async () => {
      const ecnId = await mkEcn("in_review", uid.engAuthor, uid.supAuthor);
      await (await as("supAssigner")).assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.userViewer, expectedAssigneeUserId: null });
      const { ecnRouter } = await import("./ecnRouter");
      await expect(ecnRouter.createCaller(ctxOf("userViewer")).transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const [row] = await sql`SELECT status, "approvedBy" FROM engineering_changes WHERE id = ${ecnId}`;
      expect(row).toMatchObject({ status: "in_review", approvedBy: null });
    });

    it("ECN: tác giả (vai quyết định) TỰ GIAO cho mình ⇒ vẫn bị SoD chặn", async () => {
      const ecnId = await mkEcn("in_review", uid.supAuthor, uid.engViewer);
      await (await as("supAuthor")).assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.supAuthor, expectedAssigneeUserId: null });
      const { ecnRouter } = await import("./ecnRouter");
      await expect(ecnRouter.createCaller(ctxOf("supAuthor")).transition({ id: ecnId, action: "approve", expectedStatus: "in_review" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const [row] = await sql`SELECT status FROM engineering_changes WHERE id = ${ecnId}`;
      expect(row.status).toBe("in_review");
    });

    it("recipe: người được giao chỉ canView ⇒ approve FORBIDDEN · tác giả tự giao ⇒ approve vẫn bị từ chối (second-approver)", async () => {
      const { machineRecipeRouter } = await import("./machineRecipeRouter");
      const r1 = await mkRecipe(uid.engAuthor);
      await (await as("supAssigner")).assign({ entityType: "recipe", entityId: r1, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await expect(machineRecipeRouter.createCaller(ctxOf("engViewer")).recipes.approve({ recipeId: r1 }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const r2 = await mkRecipe(uid.engAuthor);
      await (await as("engAuthor")).assign({ entityType: "recipe", entityId: r2, assigneeUserId: uid.engAuthor, expectedAssigneeUserId: null });
      // fix 1 — đúng lời từ chối second-approver (không phải một lỗi bất kỳ: 2FA, schema, guardrail…).
      await expect(machineRecipeRouter.createCaller(ctxOf("engAuthor")).recipes.approve({ recipeId: r2 }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", cause: { appCode: "OPERATION_FAILED", appParams: { operation: "approveRecipe" } }, message: expect.stringMatching(/Segregation of duties/) });
      const rows = await sql`SELECT id, "approvedBy" FROM machine_recipes WHERE id IN ${sql([r1, r2])}`;
      expect(rows.every((x) => x.approvedBy == null)).toBe(true);
    });

    it("interlock rule: người được giao (engineer) ⇒ approve FORBIDDEN (admin-only) · admin tác giả tự giao ⇒ SoD FORBIDDEN", async () => {
      const { interlockRouter } = await import("./interlockRouter");
      const r1 = await mkRule(uid.engAuthor);
      await (await as("supAssigner")).assign({ entityType: "interlock_rule", entityId: r1, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      const v1 = (await interlockRouter.createCaller(ctxOf("adminA")).get({ id: r1 }) as any).versionToken;
      await expect(interlockRouter.createCaller(ctxOf("engViewer")).approve({ id: r1, expectedVersion: v1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const r2 = await mkRule(uid.adminA);
      await (await as("adminA")).assign({ entityType: "interlock_rule", entityId: r2, assigneeUserId: uid.adminA, expectedAssigneeUserId: null });
      const v2 = (await interlockRouter.createCaller(ctxOf("adminA")).get({ id: r2 }) as any).versionToken;
      await expect(interlockRouter.createCaller(ctxOf("adminA")).approve({ id: r2, expectedVersion: v2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT "approvedBy" FROM interlock_rules WHERE id IN ${sql([r1, r2])}`;
      expect(rows.every((x) => x.approvedBy == null)).toBe(true);
    });

    it("changeover: người được giao chỉ canView ⇒ approve FORBIDDEN · người yêu cầu tự giao ⇒ SoD FORBIDDEN", async () => {
      const { machineRecipeRouter } = await import("./machineRecipeRouter");
      const c1 = await mkChangeover(uid.engAuthor);
      await (await as("supAssigner")).assign({ entityType: "changeover", entityId: c1, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await expect(machineRecipeRouter.createCaller(ctxOf("engViewer")).changeover.approve({ id: c1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const c2 = await mkChangeover(uid.engAuthor);
      await (await as("engAuthor")).assign({ entityType: "changeover", entityId: c2, assigneeUserId: uid.engAuthor, expectedAssigneeUserId: null });
      await expect(machineRecipeRouter.createCaller(ctxOf("engAuthor")).changeover.approve({ id: c2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const rows = await sql`SELECT status FROM changeover_requests WHERE id IN ${sql([c1, c2])}`;
      expect(rows.every((x) => x.status === "pending")).toBe(true);
    });

    it("orchestration run: người được giao chỉ canView ⇒ resumeRun FORBIDDEN, run không đổi", async () => {
      const { orchestrationRouter } = await import("./orchestrationRouter");
      const runId = await mkRun();
      await (await as("supAssigner")).assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await expect(orchestrationRouter.createCaller(ctxOf("engViewer")).resumeRun({ runId, approved: true, expectedStepId: "gate1" } as never))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      const [row] = await sql`SELECT status FROM orchestration_runs WHERE id = ${runId}`;
      expect(row.status).toBe("awaiting_confirm");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§5 pendingSummary.mine — đúng người, chỉ mục còn chờ, tên chỉ khi có quyền xem", () => {
    it("★ người được giao thấy mục của mình (đếm + tên); người khác đếm 0; mục hết chờ duyệt ⇒ rơi khỏi 'Của tôi'", async () => {
      const { oversightRouter } = await import("./oversightRouter");
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const runId = await mkRun("held");
      const c = await as("supAssigner");
      await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null });
      await c.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null });
      const mine = (await oversightRouter.createCaller(ctxOf("engViewer2")).pendingSummary()).mine;
      expect(mine.ecn.count).toBeGreaterThanOrEqual(1);
      expect(mine.ecn.samples.map((s) => s.id)).toContain(ecnId);
      expect(mine.orchestration.samples.map((s) => s.id)).toContain(runId);
      expect(mine.ecn.degraded).toBe(false);
      const other = (await oversightRouter.createCaller(ctxOf("engAuthor")).pendingSummary()).mine;
      expect(other.ecn.samples.map((s) => s.id)).not.toContain(ecnId);
      // ECN được duyệt (ngoài luồng này) ⇒ không còn "chờ duyệt" ⇒ rời "Của tôi" dù phân công vẫn active.
      const before = mine.ecn.count;
      await sql`UPDATE engineering_changes SET status = 'approved' WHERE id = ${ecnId}`;
      const after = (await oversightRouter.createCaller(ctxOf("engViewer2")).pendingSummary()).mine;
      expect(after.ecn.count).toBe(before - 1);
      expect(after.ecn.samples.map((s) => s.id)).not.toContain(ecnId);
    });

    it("★★ tên chỉ khi có quyền xem: người được giao MẤT quyền machine_control sau khi được giao ⇒ vẫn đếm, KHÔNG có tên", async () => {
      const { oversightRouter } = await import("./oversightRouter");
      const ecnId = await mkEcn("submitted", uid.engAuthor);
      const recipeId = await mkRecipe(uid.engAuthor);
      const c = await as("supAssigner");
      await c.assign({ entityType: "ecn", entityId: ecnId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await c.assign({ entityType: "recipe", entityId: recipeId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await sql`UPDATE permissions SET "canView" = false WHERE "userId" = ${uid.engViewer} AND "moduleName" = 'machine_control'`;
      try {
        const s = await oversightRouter.createCaller(ctxOf("engViewer")).pendingSummary();
        expect(s.mine.ecn.count).toBeGreaterThanOrEqual(1);
        expect(s.mine.recipes.count).toBeGreaterThanOrEqual(1);
        expect(s.mine.ecn.samples).toEqual([]);
        expect(s.mine.recipes.samples).toEqual([]);
        expect(s.mine.changeover.samples).toEqual([]);
      } finally {
        await sql`UPDATE permissions SET "canView" = true WHERE "userId" = ${uid.engViewer} AND "moduleName" = 'machine_control'`;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§7 fix 1 (R-3-e) — giao/bỏ giao đòi ĐÚNG sàn vai + 2FA của đường sửa/duyệt thật", () => {
    const counts = async (type: string, id: number) => ({
      audit: (await auditRows(type, id)).length,
      notif: (await sql`SELECT count(*)::int AS n FROM notifications WHERE "entityType" = ${"engineering_" + type} AND "entityId" = ${id}`)[0].n as number,
      rows: (await activeRows(type, id)).length,
    });
    const mkAll = async () => ({
      ecn: await mkEcn("submitted", uid.engAuthor),
      recipe: await mkRecipe(uid.engAuthor),
      interlock_rule: await mkRule(uid.engAuthor),
      changeover: await mkChangeover(uid.engAuthor),
      orchestration_run: await mkRun(),
    });

    for (const who of ["opFull", "viewerFull", "userFull"]) {
      it(`★★ ${who} (${ROLES[who]}) CÓ ĐỦ bit quyền ⇒ assign/unassign/roster FORBIDDEN cho MỌI loại; không audit, không thông báo, không hàng`, async () => {
        const ids = await mkAll();
        const c = await as(who);
        for (const [type, id] of Object.entries(ids)) {
          await expect(c.assign({ entityType: type as never, entityId: id, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }), `${who} assign ${type}`)
            .rejects.toMatchObject({ code: "FORBIDDEN" });
          await expect(c.assignableUsers({ entityType: type as never }), `${who} roster ${type}`).rejects.toMatchObject({ code: "FORBIDDEN" });
          expect(await counts(type, id), `${who} ${type}`).toEqual({ audit: 0, notif: 0, rows: 0 });
        }
        // bỏ giao một phân công hợp lệ (do supervisor giao) cũng bị chặn, không ghi gì thêm
        await (await as("supAssigner")).assign({ entityType: "ecn", entityId: ids.ecn, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
        await expect(c.unassign({ entityType: "ecn", entityId: ids.ecn, expectedAssigneeUserId: uid.engViewer })).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await counts("ecn", ids.ecn)).toEqual({ audit: 1, notif: 1, rows: 1 });
      });
    }

    it("2FA bắt buộc ⇒ engineer CHƯA bật 2FA bị chặn ở loại 'actuation'; ECN theo đúng đường quyết định ECN (không chain 2FA) ⇒ qua", async () => {
      const prev = process.env.AUTH_2FA_BAT_BUOC;
      process.env.AUTH_2FA_BAT_BUOC = "1";
      try {
        const ids = await mkAll();
        const c = await as("engNo2fa");
        for (const type of ["recipe", "interlock_rule", "changeover", "orchestration_run"] as const) {
          await expect(c.assign({ entityType: type, entityId: ids[type], assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }), type)
            .rejects.toMatchObject({ code: "FORBIDDEN", cause: { appCode: "TWO_FACTOR_NOT_SET_UP" } });
          expect(await counts(type, ids[type])).toEqual({ audit: 0, notif: 0, rows: 0 });
        }
        await expect(c.assign({ entityType: "ecn", entityId: ids.ecn, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null })).resolves.toMatchObject({ entityId: ids.ecn });
      } finally {
        if (prev === undefined) delete process.env.AUTH_2FA_BAT_BUOC;
        else process.env.AUTH_2FA_BAT_BUOC = prev;
      }
    });

    it("SERVER_ROLE_FLOORS (hằng thật của trpc/ecnRouter) == ASSIGN_ROLE_FLOORS (shared, client) — không lệch", async () => {
      const { SERVER_ROLE_FLOORS } = await import("../services/engineeringAssignment/assignGate");
      const { ASSIGN_ROLE_FLOORS } = await import("@shared/engineeringAssignment");
      for (const k of ["actuation", "ecnDecision"] as const) {
        expect([...SERVER_ROLE_FLOORS[k].roles].sort(), k).toEqual([...ASSIGN_ROLE_FLOORS[k].roles].sort());
        expect(SERVER_ROLE_FLOORS[k].twoFactor, k).toBe(ASSIGN_ROLE_FLOORS[k].twoFactor);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§8 fix 1 (R-3-f) — phân công hết hiệu lực khi mục rời chờ duyệt; quay lại chờ ⇒ KHÔNG hiện lại cho người cũ", () => {
    it("★★★ interlock: duyệt ⇒ rời 'Của tôi' + cột; sửa (về chờ duyệt) ⇒ người cũ KHÔNG thấy lại; giao lại KHÔNG CONFLICT (audit expire)", async () => {
      const { oversightRouter } = await import("./oversightRouter");
      const { interlockRouter } = await import("./interlockRouter");
      const ruleId = await mkRule(uid.engAuthor);
      const sup = await as("supAssigner");
      await sup.assign({ entityType: "interlock_rule", entityId: ruleId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      const mineIds = async (k: string) => (await oversightRouter.createCaller(ctxOf(k)).pendingSummary()).mine.interlock.samples.map((x) => x.id);
      expect(await mineIds("engViewer")).toContain(ruleId);
      expect((await sup.assignments({ entityType: "interlock_rule", entityIds: [ruleId] })).map((r) => r.assigneeUserId)).toEqual([uid.engViewer]);
      // duyệt THẬT (admin, khác tác giả) ⇒ rời chờ duyệt
      const v = ((await interlockRouter.createCaller(ctxOf("adminA")).get({ id: ruleId })) as any).versionToken;
      await interlockRouter.createCaller(ctxOf("adminA")).approve({ id: ruleId, expectedVersion: v });
      expect(await mineIds("engViewer")).not.toContain(ruleId);
      expect(await sup.assignments({ entityType: "interlock_rule", entityIds: [ruleId] })).toEqual([]);
      // sửa rule đã duyệt (ILK-01 reset duyệt) ⇒ chờ duyệt LẠI, đợt mới ⇒ người cũ KHÔNG thấy
      await interlockRouter.createCaller(ctxOf("engAuthor")).update({ id: ruleId, description: "sua sau duyet" });
      const [r] = await sql`SELECT "approvedBy" FROM interlock_rules WHERE id = ${ruleId}`;
      expect(r.approvedBy).toBeNull();
      expect(await mineIds("engViewer")).not.toContain(ruleId);
      expect(await sup.assignments({ entityType: "interlock_rule", entityIds: [ruleId] })).toEqual([]);
      // giao lại (client thấy "chưa giao" ⇒ expected=null) ⇒ thành công, KHÔNG CONFLICT; hàng cũ tắt kèm audit expire
      await sup.assign({ entityType: "interlock_rule", entityId: ruleId, assigneeUserId: uid.engViewer2, expectedAssigneeUserId: null });
      expect((await activeRows("interlock_rule", ruleId)).map((x) => [x.assignee_user_id, x.active])).toEqual([[uid.engViewer, false], [uid.engViewer2, true]]);
      expect((await auditRows("interlock_rule", ruleId)).map((a) => a.action)).toEqual(["assign", "expire", "assign"]);
      // người cũ không nhận thêm thông báo nào khi hết hạn (chỉ 'assigned' ban đầu)
      expect((await notifRows(uid.engViewer)).filter((x) => x.entityId === ruleId).map((x) => (x.metadata as any).action)).toEqual(["assigned"]);
      expect(await mineIds("engViewer2")).toContain(ruleId);
    });

    it("orchestration run sang gate SAU ⇒ đợt mới: người được giao ở gate trước KHÔNG thấy; bỏ giao hàng đã chết ⇒ CONFLICT", async () => {
      const { oversightRouter } = await import("./oversightRouter");
      const runId = await mkRun("held");
      const sup = await as("supAssigner");
      await sup.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await sql`UPDATE orchestration_runs SET "currentStepId" = 'gate2', status = 'awaiting_confirm' WHERE id = ${runId}`;
      const mine = (await oversightRouter.createCaller(ctxOf("engViewer")).pendingSummary()).mine;
      expect(mine.orchestration.samples.map((x) => x.id)).not.toContain(runId);
      await expect(sup.unassign({ entityType: "orchestration_run", entityId: runId, expectedAssigneeUserId: uid.engViewer })).rejects.toMatchObject({ code: "CONFLICT" });
      await sup.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      expect((await sup.assignments({ entityType: "orchestration_run", entityIds: [runId] })).map((x) => x.assigneeUserId)).toEqual([uid.engViewer]);
    });

    it("assignments: CHỈ id được hỏi, CHỈ phân công sống, sắp theo id mục; thiếu entityIds ⇒ BAD_REQUEST", async () => {
      const sup = await as("supAssigner");
      const a = await mkEcn("submitted", uid.engAuthor);
      const b = await mkEcn("submitted", uid.engAuthor);
      const gone = await mkEcn("submitted", uid.engAuthor);
      for (const id of [b, a, gone]) await sup.assign({ entityType: "ecn", entityId: id, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await sql`UPDATE engineering_changes SET status = 'rejected' WHERE id = ${gone}`;
      const rows = await sup.assignments({ entityType: "ecn", entityIds: [b, gone, a] });
      expect(rows.map((r) => r.entityId)).toEqual([a, b].sort((x, y) => x - y));
      expect(await sup.assignments({ entityType: "ecn", entityIds: [a] })).toHaveLength(1);
      await expect(sup.assignments({ entityType: "ecn" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§9 fix 2 — run giữ lại ĐÚNG bước cũ sau resume (rehydrate lúc khởi động / edge coordinator) là ĐỢT MỚI", () => {
    // Ghi bằng drizzle với ĐÚNG hình dạng các đường thật ghi (foeEngine claimPausedRun / setRunStatus trong
    // rehydrateInterruptedRuns; edgeCoordinator đẩy kết quả run) — cơ chế tách đợt là trigger CSDL nên nguồn ghi không quan trọng.
    const runsOf = async () => {
      const { getDb } = await import("../db/connection");
      const { orchestrationRuns } = await import("../../drizzle/schema");
      const { and, eq, inArray } = await import("drizzle-orm");
      return { d: (await getDb())!, orchestrationRuns, and, eq, inArray };
    };
    const resumeAt = async (runId: number, step: string) => {
      const { d, orchestrationRuns, and, eq, inArray } = await runsOf();
      const r = await d.update(orchestrationRuns).set({ status: "running", updatedAt: new Date() })
        .where(and(eq(orchestrationRuns.id, runId), inArray(orchestrationRuns.status, ["awaiting_confirm", "held"]), eq(orchestrationRuns.currentStepId, step)))
        .returning();
      expect(r).toHaveLength(1);
    };
    const rehydrateHold = async (runId: number) => {
      const { d, orchestrationRuns, eq } = await runsOf();
      await d.update(orchestrationRuns).set({
        status: "held",
        error: "Interrupted by server restart (was running); awaiting manual resume.",
        contextJson: { interrupted: true, interruptedFrom: "running" },
        updatedAt: new Date(),
      }).where(eq(orchestrationRuns.id, runId));
    };
    const edgeHold = async (runId: number) => {
      const { d, orchestrationRuns, eq } = await runsOf();
      const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId));
      await d.update(orchestrationRuns).set({
        status: "held",
        error: run.error,
        currentStepId: run.currentStepId,
        contextJson: run.contextJson,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        updatedAt: new Date(),
      }).where(eq(orchestrationRuns.id, runId));
    };

    for (const [name, hold] of [["rehydrateInterruptedRuns", rehydrateHold], ["edge coordinator", edgeHold]] as const) {
      it(`★★★ ${name}: giao ở gate g1 cho A → resume → giữ lại ở CHÍNH g1 ⇒ A KHÔNG thấy; giao lại KHÔNG CONFLICT`, async () => {
        const { oversightRouter } = await import("./oversightRouter");
        const runId = await mkRun("awaiting_confirm");
        const [{ currentStepId }] = await sql`SELECT "currentStepId" FROM orchestration_runs WHERE id = ${runId}`;
        expect(currentStepId).toBe("gate1");
        const sup = await as("supAssigner");
        await sup.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
        const mineA = async () => (await oversightRouter.createCaller(ctxOf("engViewer")).pendingSummary()).mine.orchestration.samples.map((x) => x.id);
        expect(await mineA()).toContain(runId);
        await resumeAt(runId, "gate1");
        await hold(runId);
        const [after] = await sql`SELECT status, "currentStepId" FROM orchestration_runs WHERE id = ${runId}`;
        expect(after).toMatchObject({ status: "held", currentStepId: "gate1" });
        expect(await mineA()).not.toContain(runId);
        expect(await sup.assignments({ entityType: "orchestration_run", entityIds: [runId] })).toEqual([]);
        await expect(sup.unassign({ entityType: "orchestration_run", entityId: runId, expectedAssigneeUserId: uid.engViewer })).rejects.toMatchObject({ code: "CONFLICT" });
        // giao lại (kể cả cho CHÍNH A) với expected=null ⇒ thành công; hàng cũ tắt kèm audit expire
        await sup.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
        expect((await auditRows("orchestration_run", runId)).map((a) => a.action)).toEqual(["assign", "expire", "assign"]);
        expect(await mineA()).toContain(runId);
      });
    }

    it("chuyển qua lại held ⇄ awaiting_confirm (không rời trạng thái chờ) KHÔNG mở đợt mới — phân công vẫn sống", async () => {
      const runId = await mkRun("held");
      const sup = await as("supAssigner");
      await sup.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      await sql`UPDATE orchestration_runs SET status = 'awaiting_confirm' WHERE id = ${runId}`;
      await sql`UPDATE orchestration_runs SET status = 'held' WHERE id = ${runId}`;
      expect((await sup.assignments({ entityType: "orchestration_run", entityIds: [runId] })).map((x) => x.assigneeUserId)).toEqual([uid.engViewer]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe("§6 roster 'Giao cho' — permissionHeldSql == checkPermission", () => {
    it("chỉ người GIAO được mới đọc roster; roster chỉ có người đang hoạt động XEM được trang, chỉ {id,name}", async () => {
      await expect((await as("engViewer")).assignableUsers({ entityType: "ecn" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      const { users: r } = await (await as("supAssigner")).assignableUsers({ entityType: "changeover" });
      const ids = new Set(r.map((x) => x.id));
      expect(Object.keys(r[0] ?? { id: 0, name: "" }).sort()).toEqual(["id", "name"]);
      // Roster có trần ROSTER_LIMIT và _test có >1000 admin ⇒ chỉ đo vế PHỦ ĐỊNH chắc chắn trên người gieo:
      for (const k of ["engNoView", "engInactive", "engCtlOnly", "monitorOnly"]) expect(ids.has(uid[k]), k).toBe(false);
    });

    for (const scoped of [false, true]) {
      it(`★ tương đương từng người (RBAC_SCOPED_ADMIN=${scoped}) trên module thật và bí danh machine_monitoring`, async () => {
        const { checkPermission, permissionHeldSql } = await import("../_core/accessControl");
        const { getDb } = await import("../db/connection");
        const { users } = await import("../../drizzle/schema");
        const { and, inArray } = await import("drizzle-orm");
        const d = (await getDb())!;
        // Thêm hai hàng biên cho admin: bị TỪ CHỐI tường minh, và hàng từ chối ĐÃ HẾT HẠN.
        await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${uid.adminA}, 'interlock', 'interlock', false)
          ON CONFLICT ("userId", "moduleName") DO UPDATE SET "canView" = false, "expiresAt" = NULL`;
        await sql`UPDATE permissions SET "expiresAt" = now() - interval '1 day' WHERE "userId" = ${uid.engViewer2} AND "moduleName" = 'interlock'`;
        const prev = process.env.RBAC_SCOPED_ADMIN;
        process.env.RBAC_SCOPED_ADMIN = scoped ? "true" : "false";
        try {
          const ids = Object.values(uid);
          for (const mod of ["machine_control", "interlock", "machine_monitoring", "machine_status"]) {
            const rows = await d.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), permissionHeldSql(users.id, users.role, mod, "canView")));
            const sqlSet = new Set(rows.map((x) => x.id));
            for (const [k, id] of Object.entries(uid)) {
              const want = await checkPermission(id, ROLES[k], mod, "canView");
              expect(sqlSet.has(id), `${mod} · ${k} (${ROLES[k]})`).toBe(want);
            }
          }
        } finally {
          if (prev === undefined) delete process.env.RBAC_SCOPED_ADMIN; else process.env.RBAC_SCOPED_ADMIN = prev;
          await sql`UPDATE permissions SET "expiresAt" = NULL WHERE "userId" = ${uid.engViewer2} AND "moduleName" = 'interlock'`;
        }
      });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // doc 81 Đợt 3 final wave (M-5) — "Của tôi" MỘT truy vấn (`fetchMineSummary`) cho kết quả BẰNG đường cũ từng loại
  // (`fetchMineCategory` ×5) trên dữ liệu thật: >5 mục một loại (đếm vs mẫu 5 mới nhất, đúng thứ tự), mục hết chờ duyệt,
  // phân công của người khác, đợt cũ (interlock duyệt rồi sửa ⇒ dòng `approve` ở control_audit_log; run sang gate khác),
  // changeover (nối máy/recipe), cả hai chế độ tên (có / không quyền xem).
  describe("§10 final wave (M-5) — pendingSummary.mine một truy vấn == năm truy vấn cũ", () => {
    it("★★ fetchMineSummary == fetchMineCategory ×5 (đếm, mẫu, thứ tự, degraded) — có tên và không tên; đúng ≤1 lượt truy vấn khi không lỗi", async () => {
      const { interlockRouter } = await import("./interlockRouter");
      const { fetchMineSummary, fetchMineCategory } = await import("../services/engineeringAssignment/assignmentService");
      const { getDb } = await import("../db/connection");
      const d = (await getDb())!;
      const sup = await as("supAssigner");
      const who = uid.engViewer2;
      const give = (entityType: any, entityId: number, assigneeUserId = who) =>
        sup.assign({ entityType, entityId, assigneeUserId, expectedAssigneeUserId: null });
      // 7 ECN chờ duyệt (> trần mẫu 5) + 1 ECN rời chờ duyệt + 1 ECN giao cho người KHÁC
      for (let i = 0; i < 7; i++) await give("ecn", await mkEcn(i % 2 ? "in_review" : "submitted", uid.engAuthor));
      const ecnDone = await mkEcn("submitted", uid.engAuthor);
      await give("ecn", ecnDone);
      await sql`UPDATE engineering_changes SET status = 'approved' WHERE id = ${ecnDone}`;
      await give("ecn", await mkEcn("submitted", uid.engAuthor), uid.engViewer);
      // recipe nháp ×2, changeover ×1
      await give("recipe", await mkRecipe(uid.engAuthor));
      await give("recipe", await mkRecipe(uid.engAuthor));
      await give("changeover", await mkChangeover(uid.engAuthor));
      // interlock: một rule còn sống; một rule ĐỢT CŨ (giao ⇒ duyệt thật ⇒ sửa về chờ duyệt — khoá đợt "0" ≠ "1")
      await give("interlock_rule", await mkRule(uid.engAuthor));
      const stale = await mkRule(uid.engAuthor);
      await give("interlock_rule", stale);
      const v = ((await interlockRouter.createCaller(ctxOf("adminA")).get({ id: stale })) as any).versionToken;
      await interlockRouter.createCaller(ctxOf("adminA")).approve({ id: stale, expectedVersion: v });
      await interlockRouter.createCaller(ctxOf("engAuthor")).update({ id: stale, description: "m5 sua sau duyet" });
      // run: một còn sống; một sang gate khác (đợt mới)
      await give("orchestration_run", await mkRun("held"));
      const runStale = await mkRun("held");
      await give("orchestration_run", runStale);
      await sql`UPDATE orchestration_runs SET "currentStepId" = 'gate2', status = 'awaiting_confirm' WHERE id = ${runStale}`;

      const TYPES = ["ecn", "recipe", "interlock_rule", "changeover", "orchestration_run"] as const;
      for (const names of [true, false]) {
        const flags = Object.fromEntries(TYPES.map((t) => [t, names])) as Record<(typeof TYPES)[number], boolean>;
        const cu = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await fetchMineCategory(d, t, who, names)] as const)));
        const spy = vi.spyOn(d, "execute");
        let moi;
        try {
          moi = await fetchMineSummary(d, who, flags);
          expect(spy, "một truy vấn duy nhất (không rơi về đường từng loại)").toHaveBeenCalledTimes(1);
        } finally {
          spy.mockRestore();
        }
        expect(moi, `showNames=${names}`).toEqual(cu);
        // dữ liệu thật đủ để phép so có nghĩa (cầu chì)
        expect(cu.ecn.count, "ECN").toBeGreaterThanOrEqual(7);
        if (names) expect(cu.ecn.samples, "trần mẫu 5").toHaveLength(5);
        for (const t of TYPES) expect(cu[t].count, t).toBeGreaterThanOrEqual(1);
        expect(cu.interlock_rule.samples.map((x: { id: number }) => x.id)).not.toContain(stale);
        expect(cu.orchestration_run.samples.map((x: { id: number }) => x.id)).not.toContain(runStale);
      }
    });

    it("truy vấn gộp lỗi ⇒ rơi về đường từng loại (fail-safe từng nhánh giữ nguyên)", async () => {
      const { fetchMineSummary, fetchMineCategory } = await import("../services/engineeringAssignment/assignmentService");
      const { getDb } = await import("../db/connection");
      const d = (await getDb())!;
      const TYPES = ["ecn", "recipe", "interlock_rule", "changeover", "orchestration_run"] as const;
      const flags = Object.fromEntries(TYPES.map((t) => [t, true])) as Record<(typeof TYPES)[number], boolean>;
      const spy = vi.spyOn(d, "execute").mockRejectedValueOnce(new Error("gia lap loi"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const moi = await fetchMineSummary(d, uid.engViewer2, flags);
        const cu = Object.fromEntries(await Promise.all(TYPES.map(async (t) => [t, await fetchMineCategory(d, t, uid.engViewer2, true)] as const)));
        expect(moi).toEqual(cu);
        expect(Object.values(moi).every((c) => c.degraded === false)).toBe(true);
      } finally {
        spy.mockRestore();
        err.mockRestore();
      }
    });
  });
  // ══════════════════════════════════════════════════════════════════════════
  describe("§11 doc 81 Đợt 4 C6 — roster tìm kiếm (search ilike có thoát), selectedId, truncated", () => {
    // Người XEM được /product-changeover (machine_status + machine_control canView), đang hoạt động, trong số người gieo.
    // doc 81 Đợt 5 H5 — roster nay theo nhà máy người giao ("nhà"): supMulti (nhà + B) có mặt; engB/engCorpB/supNoFac/supB (không ở "nhà") thì không.
    const HOP_LE = ["supAssigner", "engViewer", "engViewer2", "userViewer", "engAuthor", "supAuthor", "adminA", "opFull", "viewerFull", "userFull", "engNo2fa", "supMulti", "dualEng"];
    const roster = async (input: { search?: string; selectedId?: number }) =>
      (await as("supAssigner")).assignableUsers({ entityType: "changeover", ...input });
    const ten = (k: string) => `${RUN} ${k}`;

    it("★ không search: _test có >300 người hợp lệ ⇒ trả đúng trần 300 + truncated:true", async () => {
      const r = await roster({});
      expect(r.users).toHaveLength(300);
      expect(r.truncated).toBe(true);
    });

    it("★ search = mã lượt chạy ⇒ ĐÚNG người gieo hợp lệ (không người tắt / không quyền xem), truncated:false; không phân biệt hoa thường", async () => {
      const r = await roster({ search: RUN.toUpperCase() });
      expect(r.truncated).toBe(false);
      expect(r.users.map((u) => u.name).sort()).toEqual(HOP_LE.map(ten).sort());
      expect(Object.keys(r.users[0]).sort()).toEqual(["id", "name"]);
    });

    it("★ search THOÁT %, _, \\ (ký tự chữ, không phải ký tự đại diện)", async () => {
      // `%` cuối: không thoát ⇒ khớp mọi tên bắt đầu bằng RUN; thoát ⇒ cần chữ '%' thật ⇒ rỗng.
      expect((await roster({ search: `${RUN}%` })).users).toEqual([]);
      // `_` thay MỘT ký tự thật (ký tự sau 't4a_'): không thoát ⇒ khớp; thoát ⇒ rỗng.
      const gach = `${RUN.slice(0, 4)}_${RUN.slice(5)}`;
      expect(gach).not.toBe(RUN);
      expect((await roster({ search: gach })).users).toEqual([]);
      // `\_` : không thoát ⇒ '\' thoát '_' thành chữ '_' ⇒ khớp RUN; thoát ⇒ cần chữ '\' thật ⇒ rỗng.
      expect((await roster({ search: `${RUN.slice(0, 3)}\\${RUN.slice(3)}` })).users).toEqual([]);
      // Đối chứng: chuỗi chứa '_' THẬT của RUN vẫn khớp (thoát không làm hỏng tìm chữ '_').
      expect((await roster({ search: `${RUN} supAssigner` })).users.map((u) => u.id)).toEqual([uid.supAssigner]);
    });

    it("★ selectedId ngoài kết quả search ⇒ VẪN có trong danh sách (người hợp lệ); trong kết quả ⇒ không lặp", async () => {
      const r = await roster({ search: `${RUN} supAssigner`, selectedId: uid.engViewer });
      expect(r.users.map((u) => u.id).sort((a, b) => a - b)).toEqual([uid.supAssigner, uid.engViewer].sort((a, b) => a - b));
      const r2 = await roster({ search: `${RUN} supAssigner`, selectedId: uid.supAssigner });
      expect(r2.users.map((u) => u.id)).toEqual([uid.supAssigner]);
      // final wave G8 (group C review M3) — không search, selectedId CHẮC CHẮN nằm NGOÀI trần 300: chọn người gieo hợp lệ
      // KHÔNG có trong danh sách không-chọn (r0); điều kiện tiền đề được KHẲNG ĐỊNH (không âm thầm đo nhánh khác).
      const r0 = await roster({});
      expect(r0.truncated).toBe(true);
      const ngoaiTran = HOP_LE.filter((k) => !r0.users.some((u) => u.id === uid[k]));
      expect(ngoaiTran.length, "tiền đề: ít nhất một người gieo hợp lệ phải xếp NGOÀI trần 300").toBeGreaterThan(0);
      const k = ngoaiTran[0];
      const r3 = await roster({ selectedId: uid[k] });
      expect(r3.truncated).toBe(true);
      expect(r3.users).toHaveLength(301); // 300 + người được chọn (nhánh list.unshift)
      expect(r3.users[0]).toEqual({ id: uid[k], name: ten(k) });
      expect(r3.users.slice(1).map((u) => u.id)).toEqual(r0.users.map((u) => u.id));
    });

    it("★ selectedId KHÔNG hợp lệ (tắt / không quyền xem / không tồn tại) ⇒ KHÔNG lộ tên qua roster (fail-closed)", async () => {
      for (const k of ["engInactive", "engNoView", "engCtlOnly"]) {
        const r = await roster({ search: `${RUN} supAssigner`, selectedId: uid[k] });
        expect(r.users.map((u) => u.id), k).toEqual([uid.supAssigner]);
      }
      expect((await roster({ search: `${RUN} supAssigner`, selectedId: 2_000_000_000 })).users.map((u) => u.id)).toEqual([uid.supAssigner]);
    });

    it("search quá dài / selectedId không dương ⇒ bị từ chối ở input", async () => {
      await expect(roster({ search: "x".repeat(101) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(roster({ selectedId: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // doc 81 Đợt 5 H5 (mục 30) — roster "Giao cho" + người được giao theo NHÀ MÁY: chỉ người CÙNG ≥1 nhà máy với mục (mục
  // không có nhà máy / không gửi mục ⇒ với người giao). Admin gọi ⇒ không đổi; vai admin luôn có mặt (thấy mọi nhà máy).
  // H fix 1: R-5-m (mục ngoài phạm vi NGƯỜI GIAO ≡ không tồn tại ⇒ NOT_FOUND), I1 (MỘT luật cho roster và `assign`; run:
  // người được giao xem được MỌI đích không-DỪNG), M4 (id mục không tồn tại ⇒ NOT_FOUND ở `assign`), lời từ chối riêng
  // `assigneeOutOfScope`.
  // ORACLE: nhà máy của từng người do CHÍNH lượt này gán (user_factory_assignments / user_corporate_assignments) — độc lập
  // với mã sản phẩm; luật run so với CHÍNH `runIdVisibleTo` của E (bộ máy phạm vi của engine).
  describe("§12 doc 81 Đợt 5 H5 + H fix 1 — roster theo nhà máy (mục / người giao)", () => {
    type T = "ecn" | "interlock_rule" | "changeover" | "recipe" | "orchestration_run";
    const ids = (r: { users: Array<{ id: number }> }) => new Set(r.users.map((u) => u.id));
    const roster = async (who: string, input: { entityType: T; entityId?: number; selectedId?: number }) =>
      (await as(who)).assignableUsers({ search: RUN, ...input } as never);
    const mkEcnF = async (factoryId: number | null) => {
      const id = await mkEcn("submitted", uid.engAuthor);
      await sql`UPDATE engineering_changes SET "factoryId" = ${factoryId} WHERE id = ${id}`;
      return id;
    };
    const mkRunOn = async (suffix: string, machineIds: number[], extra: Array<Record<string, unknown>> = [], raw?: Record<string, unknown>) => {
      const ref = `${RUN}-wf${suffix}`;
      const def = raw ?? { ref, name: ref, steps: [
        ...machineIds.map((m, i) => ({ id: `c${i}`, type: "command", machineId: m, command: "start", args: {} })),
        ...extra,
        { id: "gate1", type: "hitl_gate", prompt: "p" },
      ] };
      const [w] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status) VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active') RETURNING id`;
      created.wf.push(Number(w.id));
      const [run] = await sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "currentStepId")
        VALUES (${Number(w.id)}, ${ref}, 'awaiting_confirm', 'gate1') RETURNING id`;
      created.run.push(Number(run.id));
      return Number(run.id);
    };
    const shape = (e: unknown) => {
      const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: unknown } };
      return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams, message: x.message?.replace(/\d+/g, "#") };
    };
    const MISSING = 2_000_000_000;
    const OUT_OF_SCOPE = { code: "BAD_REQUEST", cause: { appParams: { field: "assigneeUserId", reason: "assigneeOutOfScope" } } };

    it("★ ECN của nhà máy B ⇒ roster chỉ người của B (gán nhà máy HOẶC gán tập đoàn của B) + admin; người chỉ ở nhà máy 'nhà' KHÔNG có — người giao của B, và người giao HAI nhà máy (đích = nhà máy của mục)", async () => {
      const ecnB = await mkEcnF(h5.facB);
      for (const who of ["supB", "supMulti"]) {
        const r = ids(await roster(who, { entityType: "ecn", entityId: ecnB }));
        for (const k of ["engB", "engCorpB", "dualEng", "adminA"]) expect(r.has(uid[k]), `${who}: ${k}`).toBe(true);
        for (const k of ["engViewer", "engViewer2", "supAuthor", "supAssigner", "supNoFac"]) expect(r.has(uid[k]), `${who}: ${k}`).toBe(false);
      }
    });

    it("★ R-5-m: mục NGOÀI phạm vi người giao (ECN / rule / recipe của B, người giao chỉ ở 'nhà') ⇒ NOT_FOUND Y HỆT id không tồn tại — roster lẫn assign, không trả người nào, không ghi", async () => {
      const ecnB = await mkEcnF(h5.facB);
      const ruleB = await mkRule(uid.engAuthor);
      await sql`UPDATE interlock_rules SET scope = 'line', "lineId" = ${h5.lineB} WHERE id = ${ruleB}`;
      const recipeB = await mkRecipe(uid.engAuthor);
      await sql`UPDATE machine_recipes SET "machineId" = ${h5.machineB} WHERE id = ${recipeB}`;
      const c = await as("supAssigner");
      for (const [type, id] of [["ecn", ecnB], ["interlock_rule", ruleB], ["recipe", recipeB]] as const) {
        const out = await roster("supAssigner", { entityType: type, entityId: id }).catch((e) => e);
        const missing = await roster("supAssigner", { entityType: type, entityId: MISSING }).catch((e) => e);
        expect(shape(out).code, type).toBe("NOT_FOUND");
        expect(shape(out), type).toEqual(shape(missing));
        const a1 = await c.assign({ entityType: type, entityId: id, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }).catch((e) => e);
        const a2 = await c.assign({ entityType: type, entityId: MISSING, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }).catch((e) => e);
        expect(shape(a1), type).toEqual(shape(a2));
        expect(shape(a1).code, type).toBe("NOT_FOUND");
        expect(await activeRows(type, id)).toHaveLength(0);
      }
    });

    it("★ R-5-m: mục chạm HAI nhà máy (rule máy 'nhà' → máy đích ở B) ⇒ người giao chỉ ở 'nhà' nhận NOT_FOUND; người giao có cả hai thấy mục", async () => {
      const rule = await mkRule(uid.engAuthor);
      await sql`UPDATE interlock_rules SET "machineId" = ${machineId}, "targetMachineId" = ${h5.machineB} WHERE id = ${rule}`;
      const out = await roster("supAssigner", { entityType: "interlock_rule", entityId: rule }).catch((e) => e);
      expect(shape(out).code).toBe("NOT_FOUND");
      const r = ids(await roster("supMulti", { entityType: "interlock_rule", entityId: rule }));
      expect(r.has(uid.engViewer)).toBe(true); // ≥1 nhà máy chung với mục (luật H5 cho mục không phải run)
      expect(r.has(uid.engB)).toBe(true);
    });

    it("★ M4: assign một mục KHÔNG TỒN TẠI (ECN / recipe / rule / changeover) ⇒ NOT_FOUND (entity đúng loại) — kể cả khi người được giao ngoài nhà máy hay không hợp lệ", async () => {
      const c = await as("supAssigner");
      for (const type of ["ecn", "recipe", "interlock_rule", "changeover"] as const) {
        for (const assignee of [uid.engViewer, uid.engB, 2_000_000_001]) {
          const e = await c.assign({ entityType: type, entityId: MISSING, assigneeUserId: assignee, expectedAssigneeUserId: null }).catch((x) => x);
          expect(e, `${type}/${assignee}`).toMatchObject({ code: "NOT_FOUND", cause: { appCode: "ENTITY_NOT_FOUND" } });
        }
      }
    });

    it("ECN KHÔNG có nhà máy / không gửi entityId ⇒ theo nhà máy NGƯỜI GIAO ('nhà'): engViewer có, engB/engCorpB không", async () => {
      const ecn0 = await mkEcnF(null);
      for (const input of [{ entityId: ecn0 }, {}]) {
        const r = ids(await roster("supAssigner", { entityType: "ecn", ...input }));
        for (const k of ["engViewer", "engViewer2", "supAuthor", "adminA", "dualEng"]) expect(r.has(uid[k]), `${JSON.stringify(input)} ${k}`).toBe(true);
        for (const k of ["engB", "engCorpB"]) expect(r.has(uid[k]), `${JSON.stringify(input)} ${k}`).toBe(false);
      }
    });

    it("interlock rule trên CHUYỀN / recipe trên MÁY của nhà máy B (người giao của B) ⇒ người của B; người 'nhà' không", async () => {
      const ruleId = await mkRule(uid.engAuthor);
      await sql`UPDATE interlock_rules SET scope = 'line', "lineId" = ${h5.lineB} WHERE id = ${ruleId}`;
      const rid = await mkRecipe(uid.engAuthor);
      await sql`UPDATE machine_recipes SET "machineId" = ${h5.machineB} WHERE id = ${rid}`;
      for (const [type, id] of [["interlock_rule", ruleId], ["recipe", rid]] as const) {
        const r = ids(await roster("supB", { entityType: type, entityId: id }));
        expect(r.has(uid.engB), type).toBe(true);
        expect(r.has(uid.engViewer), type).toBe(false);
      }
    });

    it("người giao KHÔNG được gán nhà máy nào + mục không nhà máy ⇒ chỉ còn admin (fail-closed)", async () => {
      const ecn0 = await mkEcnF(null);
      const r = await roster("supNoFac", { entityType: "ecn", entityId: ecn0 });
      expect(r.users.map((u) => u.id)).toEqual([uid.adminA]);
    });

    it("admin GỌI ⇒ không đổi cho ECN: nhà máy B vẫn liệt kê cả người 'nhà' lẫn người của B (và người không nhà máy)", async () => {
      const ecnB = await mkEcnF(h5.facB);
      const r = ids(await roster("adminA", { entityType: "ecn", entityId: ecnB }));
      for (const k of ["engViewer", "engB", "engCorpB", "supNoFac"]) expect(r.has(uid[k]), k).toBe(true);
    });

    it("★ orchestration run chạm máy của nhà máy B: người giao của B / hai nhà máy ⇒ người của B; người giao 'nhà' (run NGOÀI phạm vi, R-5-d) ⇒ NOT_FOUND Y HỆT run không tồn tại", async () => {
      const runId = await mkRunOn("B", [h5.machineB]);
      for (const who of ["supB", "supMulti"]) {
        const r = ids(await roster(who, { entityType: "orchestration_run", entityId: runId }));
        expect(r.has(uid.engB), who).toBe(true);
        expect(r.has(uid.engViewer), who).toBe(false);
      }
      const outOfScope = await roster("supAssigner", { entityType: "orchestration_run", entityId: runId }).catch((e) => e);
      const missing = await roster("supAssigner", { entityType: "orchestration_run", entityId: MISSING }).catch((e) => e);
      expect(shape(outOfScope)).toEqual({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "workflowRun" }, message: "orchestration_run # not found" });
      expect(shape(outOfScope)).toEqual(shape(missing));
    });

    it("★★ I1 — run chạm HAI nhà máy ('nhà' + B): roster và assign dùng MỘT luật (xem được MỌI đích): chỉ người có CẢ HAI (hoặc admin); người một nhà máy KHÔNG có trong roster và assign từ chối bằng câu RIÊNG (assigneeOutOfScope); áp cả khi admin giao", async () => {
      expect(h5.homeCreated, "tiền đề: máy changeover thuộc một nhà máy thật của _test").toBe(false);
      const runId = await mkRunOn("HB", [machineId, h5.machineB]);
      for (const who of ["supMulti", "adminA"]) {
        const r = ids(await roster(who, { entityType: "orchestration_run", entityId: runId }));
        for (const k of ["dualEng", "supMulti", "adminA"]) expect(r.has(uid[k]), `${who}: ${k}`).toBe(true);
        for (const k of ["engViewer", "engViewer2", "engB", "engCorpB", "supB"]) expect(r.has(uid[k]), `${who}: ${k}`).toBe(false);
      }
      const c = await as("supMulti");
      for (const k of ["engViewer", "engB"]) {
        const e = await c.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid[k], expectedAssigneeUserId: null }).catch((x) => x);
        expect(e, k).toMatchObject(OUT_OF_SCOPE);
      }
      expect(await activeRows("orchestration_run", runId)).toHaveLength(0);
      await c.assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.dualEng, expectedAssigneeUserId: null });
      expect((await activeRows("orchestration_run", runId)).map((r) => Number(r.assignee_user_id))).toEqual([uid.dualEng]);
    });

    it("★ I1 — đích chỉ của bước DỪNG (robot ABORT ở B, DỪNG đã xác minh) KHÔNG đòi người được giao thấy B: người chỉ ở 'nhà' có trong roster và assign nhận", async () => {
      const runId = await mkRunOn("HstopB", [machineId], [{ id: "s1", type: "command", machineId: h5.robotMachineB, command: "abort", args: { robotId: h5.robotB } }]);
      const r = ids(await roster("supMulti", { entityType: "orchestration_run", entityId: runId }));
      expect(r.has(uid.engViewer)).toBe(true);
      expect(r.has(uid.engB)).toBe(false); // không cùng nhà máy của đích không-DỪNG ('nhà')
      await (await as("supMulti")).assign({ entityType: "orchestration_run", entityId: runId, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      expect((await activeRows("orchestration_run", runId)).map((x) => Number(x.assignee_user_id))).toEqual([uid.engViewer]);
    });

    it("★★ luật run của roster (SQL một lượt) == runIdVisibleTo của E, từng người gieo, trên run một / hai nhà máy / không đích", async () => {
      const { runAssigneeVisibilitySql } = await import("../services/engineeringAssignment/rosterScope");
      const { runIdVisibleTo } = await import("../services/orchestration/foe/foeEngine");
      const { getDb } = await import("../db/connection");
      const { users } = await import("../../drizzle/schema");
      const { and, inArray } = await import("drizzle-orm");
      const d = (await getDb())!;
      const runs = [
        await mkRunOn("eqB", [h5.machineB]),
        await mkRunOn("eqHB", [machineId, h5.machineB]),
        await mkRunOn("eq0", []),
        await mkRunOn("eqStop", [machineId], [{ id: "s1", type: "command", machineId: h5.robotMachineB, command: "abort", args: { robotId: h5.robotB } }]),
        await mkRunOn("eqRobot", [], [{ id: "m1", type: "command", machineId: h5.robotMachineB, command: "start", args: { robotId: h5.robotB } }]),
        await mkRunOn("eqBad", [], [], { ref: `${RUN}-wfeqBad`, name: "malformed (no steps)" }),
      ];
      for (const runId of runs) {
        const pred = await runAssigneeVisibilitySql(d, runId);
        const rows = await d.select({ id: users.id }).from(users).where(and(inArray(users.id, Object.values(uid)), pred));
        const sqlSet = new Set(rows.map((r) => r.id));
        for (const [k, id] of Object.entries(uid)) {
          const want = await runIdVisibleTo(runId, { userId: id, userRole: ROLES[k] });
          expect(sqlSet.has(id), `run ${runId} · ${k} (${ROLES[k]})`).toBe(want);
        }
      }
    });

    it("★ selectedId của người KHÁC nhà máy ⇒ KHÔNG lộ tên qua roster", async () => {
      const ecnB = await mkEcnF(h5.facB);
      const r = await (await as("supB")).assignableUsers({ entityType: "ecn", entityId: ecnB, search: `${RUN} engB`, selectedId: uid.engViewer } as never);
      expect(r.users.map((u) => u.id)).toEqual([uid.engB]);
    });

    it("★ assign khớp roster: giao ECN nhà máy B cho người chỉ ở 'nhà' ⇒ assigneeOutOfScope (câu riêng), không ghi; cho người của B ⇒ ghi; admin giao ECN thì không lọc", async () => {
      const ecnB = await mkEcnF(h5.facB);
      const c = await as("supB");
      const e = await c.assign({ entityType: "ecn", entityId: ecnB, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null }).catch((x) => x);
      expect(e).toMatchObject(OUT_OF_SCOPE);
      expect(await activeRows("ecn", ecnB)).toHaveLength(0);
      await c.assign({ entityType: "ecn", entityId: ecnB, assigneeUserId: uid.engB, expectedAssigneeUserId: null });
      expect((await activeRows("ecn", ecnB)).map((r) => Number(r.assignee_user_id))).toEqual([uid.engB]);
      const ecnB2 = await mkEcnF(h5.facB);
      await (await as("adminA")).assign({ entityType: "ecn", entityId: ecnB2, assigneeUserId: uid.engViewer, expectedAssigneeUserId: null });
      expect((await activeRows("ecn", ecnB2)).map((r) => Number(r.assignee_user_id))).toEqual([uid.engViewer]);
    });
  });
});

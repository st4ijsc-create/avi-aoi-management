/**
 * SCADA R0 Task 9 (fix round 2) — luật `telemetry_tag` PHẢI có machineId + sourceKey: create / update / approve từ chối (BAD_REQUEST).
 * Lý do: thiếu một trong hai ⇒ cổng đọc giá trị sống không đánh giá được (lyDo cau_hinh) ⇒ cổng chặn mọi lệnh nhắm tới luật, còn engine
 * không bao giờ tự phát hành động. Chặn từ nguồn thay vì để luật hỏng nằm im.
 *
 * CSDL THẬT (`_test`). Số tổng hợp, tự dọn (control_audit_log là WORM — dòng audit ở lại vô hại).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";
import { _internal as oversight } from "./oversightRouter";
import { getDb } from "../db/connection";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKCH-${Date.now()}`;
const A = 990_520_001; // tác giả
const B = 990_520_002; // người duyệt
const MAY = 990_520_100;

function caller(userId: number) {
  return interlockRouter.createCaller({
    user: { id: userId, role: "admin", name: `probe-${userId}`, twoFactorEnabled: true },
  } as any);
}
const trpcCodeOf = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

function input(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    scope: "machine" as const,
    sourceType: "telemetry_tag" as const,
    sourceKey: "nhiet_do",
    machineId: MAY,
    comparisonOperator: "gt" as const,
    threshold: 80,
    action: "alert" as const,
    ...over,
  };
}

let sql: ReturnType<typeof postgres>;
const ruleIds: number[] = [];

describe.skipIf(!DB_URL)("interlockRouter — luật telemetry_tag hỏng cấu trúc bị từ chối (cau_hinh)", () => {
  beforeAll(() => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
  }, 60_000);

  afterAll(async () => {
    if (ruleIds.length) await sql`DELETE FROM interlock_rules WHERE id = ANY(${ruleIds})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("create: telemetry_tag thiếu machineId ⇒ BAD_REQUEST, không ghi hàng", async () => {
    const err = await caller(A).create(input(`${DAU}-c1`, { machineId: null })).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
    expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-c1"}`).length).toBe(0);
  });

  it("create: telemetry_tag thiếu sourceKey (null / rỗng) ⇒ BAD_REQUEST", async () => {
    for (const sourceKey of [null, "", "   "]) {
      const err = await caller(A).create(input(`${DAU}-c2`, { sourceKey })).catch((e) => e);
      expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
    }
    expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-c2"}`).length).toBe(0);
  });

  it("create: telemetry_tag đủ machineId + sourceKey ⇒ OK; nguồn khác (ng_rate) không cần cả hai", async () => {
    const ok = await caller(A).create(input(`${DAU}-c3`));
    ruleIds.push(ok.id);
    const khac = await caller(A).create(input(`${DAU}-c3b`, { sourceType: "ng_rate", sourceKey: null, machineId: null }));
    ruleIds.push(khac.id);
    expect(ok.id).toBeGreaterThan(0);
    expect(khac.id).toBeGreaterThan(0);
  });

  it("update: bỏ machineId / sourceKey của luật telemetry_tag ⇒ BAD_REQUEST, hàng giữ nguyên", async () => {
    const r = await caller(A).create(input(`${DAU}-u1`));
    ruleIds.push(r.id);
    const e1 = await caller(A).update({ id: r.id, machineId: null }).catch((e) => e);
    const e2 = await caller(A).update({ id: r.id, sourceKey: null }).catch((e) => e);
    expect(trpcCodeOf(e1)).toBe("BAD_REQUEST");
    expect(trpcCodeOf(e2)).toBe("BAD_REQUEST");
    const [row] = await sql`SELECT "machineId" AS m, "sourceKey" AS k FROM interlock_rules WHERE id = ${r.id}`;
    expect(row).toEqual({ m: MAY, k: "nhiet_do" });
  });

  it("update: đổi luật ng_rate (không machineId/sourceKey) sang telemetry_tag mà không bổ sung ⇒ BAD_REQUEST; bổ sung đủ ⇒ OK", async () => {
    const r = await caller(A).create(input(`${DAU}-u2`, { sourceType: "ng_rate", sourceKey: null, machineId: null }));
    ruleIds.push(r.id);
    const e = await caller(A).update({ id: r.id, sourceType: "telemetry_tag" }).catch((x) => x);
    expect(trpcCodeOf(e)).toBe("BAD_REQUEST");
    const ok = await caller(A).update({ id: r.id, sourceType: "telemetry_tag", sourceKey: "ap_suat", machineId: MAY });
    expect(ok.sourceType).toBe("telemetry_tag");
  });

  it("approve: hàng telemetry_tag hỏng ghi thẳng bảng (seed / AI tool) ⇒ BAD_REQUEST, KHÔNG duyệt", async () => {
    const [ins] = await sql`
      INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "createdBy")
      VALUES (${DAU + "-a1"}, 'machine', 'telemetry_tag', 'gt', 80, 'alert', ${A}) RETURNING id`;
    ruleIds.push(ins.id as number);
    const token = (await caller(B).list()).find((r) => r.id === ins.id)!.versionToken;
    const err = await caller(B).approve({ id: ins.id as number, expectedVersion: token }).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
    const [row] = await sql`SELECT "approvedBy" AS a FROM interlock_rules WHERE id = ${ins.id}`;
    expect(row.a).toBeNull();
  });

  it("enable: hàng telemetry_tag hỏng ĐÃ duyệt sẵn (seed) ⇒ BAD_REQUEST, KHÔNG bật", async () => {
    const [ins] = await sql`
      INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, "approvedBy", "createdBy")
      VALUES (${DAU + "-e1"}, 'machine', 'telemetry_tag', 'gt', 80, 'alert', ${B}, ${A}) RETURNING id`;
    ruleIds.push(ins.id as number);
    const token = (await caller(A).list()).find((r) => r.id === ins.id)!.versionToken;
    const err = await caller(A).enable({ id: ins.id as number, expectedVersion: token }).catch((e) => e);
    expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
    const [row] = await sql`SELECT enabled FROM interlock_rules WHERE id = ${ins.id}`;
    expect(row.enabled).toBe(false);
  });

  it("posture (ILK-06): luật BẬT + ĐÃ DUYỆT nhưng hỏng cấu trúc được đếm là KHÔNG chức năng", async () => {
    const d = await getDb();
    const truoc = await oversight.fetchInterlockCauHinhHong(d);
    expect(truoc.degraded).toBe(false);
    const [ins] = await sql`
      INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
      VALUES (${DAU + "-p1"}, 'machine', 'telemetry_tag', 'gt', 80, 'alert', true, ${B}, ${A}) RETURNING id`;
    ruleIds.push(ins.id as number);
    const sau = await oversight.fetchInterlockCauHinhHong(d);
    expect(sau.count).toBe(truoc.count + 1);
    // sourceKey chỉ gồm khoảng trắng (khớp router + cổng) cũng được đếm; luật đủ machineId + sourceKey thì không.
    const [ws] = await sql`
      INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
      VALUES (${DAU + "-p2"}, 'machine', ${MAY}, E'  	 ', 'telemetry_tag', 'gt', 80, 'alert', true, ${B}, ${A}) RETURNING id`;
    ruleIds.push(ws.id as number);
    const [tot] = await sql`
      INSERT INTO interlock_rules (name, scope, "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, enabled, "approvedBy", "createdBy")
      VALUES (${DAU + "-p3"}, 'machine', ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', true, ${B}, ${A}) RETURNING id`;
    ruleIds.push(tot.id as number);
    const cuoi = await oversight.fetchInterlockCauHinhHong(d);
    expect(cuoi.count).toBe(sau.count + 1);
  });
});

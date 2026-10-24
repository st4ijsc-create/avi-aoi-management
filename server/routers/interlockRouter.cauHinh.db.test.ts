/**
 * SCADA R0 Task 9 (fix round 2) — luật `telemetry_tag` PHẢI có machineId + sourceKey: create / update / approve từ chối (BAD_REQUEST).
 * Lý do: thiếu một trong hai ⇒ cổng đọc giá trị sống không đánh giá được (lyDo cau_hinh) ⇒ cổng chặn mọi lệnh nhắm tới luật, còn engine
 * không bao giờ tự phát hành động. Chặn từ nguồn thay vì để luật hỏng nằm im.
 *
 * CSDL THẬT (`_test`). Số tổng hợp, tự dọn (control_audit_log là WORM — dòng audit ở lại vô hại).
 */
import { describe, it, expect, beforeAll, afterAll, onTestFinished } from "vitest";
import postgres from "postgres";
import { interlockRouter } from "./interlockRouter";
import { _internal as oversight } from "./oversightRouter";
import { getDb } from "../db/connection";
import { evaluateInterlockGate } from "../services/interlock/interlockGate";

const DB_URL = process.env.DATABASE_URL;
const DAU = `ILKCH-${Date.now()}`;
const A = 990_520_001; // tác giả
const B = 990_520_002; // người duyệt
const C = 990_520_003; // người sửa thứ ba (R0.1 — SoD sau khi đổi khiThieuDuLieu)
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
    // R0.1 — ca "phải từ chối" mà lại ghi được (lượt đỏ / đột biến) không vào ruleIds ⇒ dọn thêm theo tiền tố tên của lượt này.
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${DAU + "-%"}`;
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

  // ═══════════════════════════════════════════════════════════════════════
  // SCADA R0.1 (2026-10-24, kiem-dinh P1-2) — (a) khiThieuDuLieu sửa được, đi qua MOC sẵn có; (b) telemetry_tag chỉ phạm vi Máy (D11).
  // ═══════════════════════════════════════════════════════════════════════
  describe("R0.1 (a) — khiThieuDuLieu ('chan' | 'cho_qua') sửa được, đổi ⇒ duyệt lại", () => {
    it("create: mặc định 'chan'; khai 'cho_qua' ⇒ lưu 'cho_qua' NHƯNG vẫn chưa duyệt + tắt", async () => {
      const md = await caller(A).create(input(`${DAU}-k1`));
      ruleIds.push(md.id);
      expect(md.khiThieuDuLieu).toBe("chan");
      const cq = await caller(A).create(input(`${DAU}-k2`, { khiThieuDuLieu: "cho_qua" }));
      ruleIds.push(cq.id);
      expect(cq.khiThieuDuLieu).toBe("cho_qua");
      expect(cq.approvedBy).toBeNull();
      expect(cq.enabled).toBe(false);
      const [row] = await sql`SELECT "khiThieuDuLieu" AS k FROM interlock_rules WHERE id = ${cq.id}`;
      expect(row.k).toBe("cho_qua");
    });

    it("create: giá trị lạ ⇒ zod từ chối (BAD_REQUEST), không ghi hàng", async () => {
      const err = await caller(A).create(input(`${DAU}-k3`, { khiThieuDuLieu: "bo_qua" }) as any).catch((e) => e);
      expect(trpcCodeOf(err)).toBe("BAD_REQUEST");
      expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-k3"}`).length).toBe(0);
    });

    it("★★★ update rule ĐÃ duyệt + ĐANG bật sang 'cho_qua' ⇒ approvedBy null, tắt, audit before/after mang khiThieuDuLieu; người sửa KHÔNG tự duyệt (SoD); admin khác duyệt + bật ⇒ cổng tôn trọng 'cho_qua'", async () => {
      const MAY_DICH = 990_521_201; // đích riêng của ca này — cổng chỉ xét luật nhắm đúng máy này
      const r = await caller(A).create(
        input(`${DAU}-k4`, { machineId: 990_521_200, sourceKey: `${DAU}-khong-co-mau`, action: "stop_line", targetMachineId: MAY_DICH }),
      );
      ruleIds.push(r.id);
      // R1b-1 T10b — bật luật không phải alert đòi tag NGUỒN tồn tại + bật trên một adapter bật của máy nguồn (INTERLOCK_DICH_CHUA_SAN_SANG).
      // Tag có thật nhưng KHÔNG có mẫu nào (không telemetry, bộ đệm tắt) ⇒ ca "thiếu dữ liệu" của test vẫn đúng như cũ.
      const [adNguon] = await sql`INSERT INTO device_adapters (code, name, protocol, endpoint, "isEnabled", "machineId")
        VALUES (${DAU + "-k4-nguon"}, ${DAU + "-k4-nguon"}, 'stub', 'stub://k4-nguon', true, 990521200) RETURNING id`;
      onTestFinished(async () => {
        await sql`DELETE FROM device_tags WHERE "adapterId" = ${adNguon.id}`;
        await sql`DELETE FROM device_adapters WHERE id = ${adNguon.id}`;
      });
      await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
        VALUES (${adNguon.id}, ${DAU + "-khong-co-mau"}, 'addr-k4', 'float', false, true)`;
      await caller(B).approve({ id: r.id, expectedVersion: (await caller(B).get({ id: r.id })).versionToken });
      const bat = await caller(A).enable({ id: r.id, expectedVersion: (await caller(A).get({ id: r.id })).versionToken });
      expect(bat.enabled).toBe(true);

      // Đối chứng: 'chan' (mặc định) + không có mẫu ⇒ cổng CHẶN (thieu_du_lieu).
      const truoc = await evaluateInterlockGate({ adapterId: 990_521_299, machineId: MAY_DICH, tagKeys: [] });
      expect(truoc.violations).toEqual([expect.objectContaining({ ruleId: r.id, lyDo: "thieu_du_lieu" })]);

      // C (≠ người tạo A, ≠ người duyệt B) đổi sang cho_qua.
      const sua = await caller(C).update({ id: r.id, khiThieuDuLieu: "cho_qua" });
      expect(sua.khiThieuDuLieu).toBe("cho_qua");
      expect(sua.approvedBy).toBeNull();
      expect(sua.approvedAt).toBeNull();
      expect(sua.enabled).toBe(false);
      const [audit] = await sql`
        SELECT reason, "beforeJson" AS b, "afterJson" AS a FROM control_audit_log
         WHERE "entityType" = 'interlock_rule' AND "entityId" = ${String(r.id)} AND action = 'update'
         ORDER BY id DESC LIMIT 1`;
      expect(audit.reason).toBe("sửa rule đã duyệt ⇒ cần duyệt lại");
      expect((audit.b as any).khiThieuDuLieu).toBe("chan");
      expect((audit.a as any).khiThieuDuLieu).toBe("cho_qua");

      // Đã tắt ⇒ cổng không xét luật này nữa (chưa duyệt lại thì cho_qua chưa có hiệu lực, cũng không chặn).
      expect((await evaluateInterlockGate({ adapterId: 990_521_299, machineId: MAY_DICH, tagKeys: [] })).violations).toEqual([]);

      // SoD: C vừa sửa ⇒ không được tự duyệt; hàng giữ chưa duyệt.
      const tuDuyet = await caller(C)
        .approve({ id: r.id, expectedVersion: (await caller(C).get({ id: r.id })).versionToken })
        .catch((e) => e);
      expect(tuDuyet?.cause?.appCode).toBe("PERMISSION_DENIED");
      expect((await caller(B).get({ id: r.id })).approvedBy).toBeNull();

      // B (độc lập) duyệt, A bật ⇒ cổng tôn trọng cho_qua: thiếu dữ liệu KHÔNG chặn.
      await caller(B).approve({ id: r.id, expectedVersion: (await caller(B).get({ id: r.id })).versionToken });
      await caller(A).enable({ id: r.id, expectedVersion: (await caller(A).get({ id: r.id })).versionToken });
      const sau = await evaluateInterlockGate({ adapterId: 990_521_299, machineId: MAY_DICH, tagKeys: [] });
      expect(sau.failClosed).toBe(false);
      expect(sau.violations).toEqual([]);
      expect(sau.blocked).toBe(false);
    });

    it("update KHÔNG khai khiThieuDuLieu (vd đổi tên) ⇒ giữ nguyên 'cho_qua' (không bị mặc định zod ghi đè về 'chan')", async () => {
      const r = await caller(A).create(input(`${DAU}-k5`, { khiThieuDuLieu: "cho_qua" }));
      ruleIds.push(r.id);
      const sua = await caller(A).update({ id: r.id, name: `${DAU}-k5-moi` });
      expect(sua.khiThieuDuLieu).toBe("cho_qua");
      // và chiều ngược lại: đổi về 'chan' được.
      const lai = await caller(A).update({ id: r.id, khiThieuDuLieu: "chan" });
      expect(lai.khiThieuDuLieu).toBe("chan");
    });
  });

  describe("R0.1 (b) — telemetry_tag chỉ phạm vi Máy (D11)", () => {
    const loiPhamVi = (e: unknown) => ({
      code: trpcCodeOf(e),
      appCode: (e as any)?.cause?.appCode,
      field: (e as any)?.cause?.appParams?.field,
      reason: (e as any)?.cause?.appParams?.reason,
    });
    const LOI = { code: "BAD_REQUEST", appCode: "INVALID_VALUE", field: "scope", reason: "telemetryTagChiPhamViMay" };

    it("create: telemetry_tag + scope line / station (đủ machineId + sourceKey) ⇒ BAD_REQUEST INVALID_VALUE{field:scope}, không ghi hàng", async () => {
      for (const scope of ["line", "station"] as const) {
        const err = await caller(A).create(input(`${DAU}-s1`, { scope, lineId: 1, stationId: 1 })).catch((e) => e);
        expect(loiPhamVi(err)).toEqual(LOI);
        expect(String(err?.message)).toMatch(/phạm vi/i);
      }
      expect((await sql`SELECT id FROM interlock_rules WHERE name = ${DAU + "-s1"}`).length).toBe(0);
      // nguồn khác vẫn được ở phạm vi line.
      const khac = await caller(A).create(input(`${DAU}-s1b`, { scope: "line", lineId: 1, sourceType: "ng_rate", sourceKey: null, machineId: null }));
      ruleIds.push(khac.id);
      expect(khac.scope).toBe("line");
    });

    it("update: đổi phạm vi luật telemetry_tag sang line ⇒ BAD_REQUEST, hàng giữ 'machine'", async () => {
      const r = await caller(A).create(input(`${DAU}-s2`));
      ruleIds.push(r.id);
      const err = await caller(A).update({ id: r.id, scope: "line", lineId: 1 }).catch((e) => e);
      expect(loiPhamVi(err)).toEqual(LOI);
      const [row] = await sql`SELECT scope FROM interlock_rules WHERE id = ${r.id}`;
      expect(row.scope).toBe("machine");
    });

    it("update (merge với hàng đang lưu): luật ng_rate phạm vi station đổi sang telemetry_tag + đủ máy/tag nhưng KHÔNG gửi scope ⇒ BAD_REQUEST; gửi kèm scope machine ⇒ OK", async () => {
      const r = await caller(A).create(input(`${DAU}-s3`, { scope: "station", stationId: 7, sourceType: "ng_rate", sourceKey: null, machineId: null }));
      ruleIds.push(r.id);
      const err = await caller(A).update({ id: r.id, sourceType: "telemetry_tag", machineId: MAY, sourceKey: "ap_suat" }).catch((e) => e);
      expect(loiPhamVi(err)).toEqual(LOI);
      const ok = await caller(A).update({ id: r.id, scope: "machine", sourceType: "telemetry_tag", machineId: MAY, sourceKey: "ap_suat" });
      expect(ok.scope).toBe("machine");
    });

    it("approve / enable hàng cũ telemetry_tag phạm vi line (ghi thẳng bảng, đủ máy + tag) ⇒ BAD_REQUEST, KHÔNG duyệt / KHÔNG bật", async () => {
      const [a] = await sql`
        INSERT INTO interlock_rules (name, scope, "lineId", "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, "createdBy")
        VALUES (${DAU + "-s4a"}, 'line', 1, ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', ${A}) RETURNING id`;
      ruleIds.push(a.id as number);
      const e1 = await caller(B).approve({ id: a.id as number, expectedVersion: (await caller(B).get({ id: a.id as number })).versionToken }).catch((e) => e);
      expect(loiPhamVi(e1)).toEqual(LOI);
      expect((await sql`SELECT "approvedBy" AS x FROM interlock_rules WHERE id = ${a.id}`)[0].x).toBeNull();

      const [e] = await sql`
        INSERT INTO interlock_rules (name, scope, "stationId", "machineId", "sourceKey", "sourceType", "comparisonOperator", threshold, action, "approvedBy", "createdBy")
        VALUES (${DAU + "-s4e"}, 'station', 1, ${MAY}, 'nhiet_do', 'telemetry_tag', 'gt', 80, 'alert', ${B}, ${A}) RETURNING id`;
      ruleIds.push(e.id as number);
      const e2 = await caller(A).enable({ id: e.id as number, expectedVersion: (await caller(A).get({ id: e.id as number })).versionToken }).catch((x) => x);
      expect(loiPhamVi(e2)).toEqual(LOI);
      expect((await sql`SELECT enabled FROM interlock_rules WHERE id = ${e.id}`)[0].enabled).toBe(false);
    });
  });
});

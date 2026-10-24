/**
 * kiem-dinh R1b-1 I1 + I3 (điều phối 2026-10-25) — chuỗi lỗi: sửa / xoá luật interlock tự bỏ duyệt mà KHÔNG đòi mã ⇒ tag hết được bảo vệ ⇒ đổi
 * address / kiểu không cần mã ⇒ admin duyệt lại mà không thấy định nghĩa đã đổi.
 *
 *   I1 (a) — bám ĐỊNH NGHĨA tag nguồn / đích (address, dataType, scale / offset, adapterId + edgeNodeId của adapter) nằm trong `versionToken` của
 *            approve và được chụp vào `approvedDefHash` (mig 0434). Định nghĩa đổi sau duyệt ⇒ luật trở về CHƯA DUYỆT (fail-closed): enable từ
 *            chối, `luatDuyetConHieuLuc` (engine / dispatcher) = false. Đổi lại đúng định nghĩa cũ ⇒ bám khớp lại (bám tất định).
 *   I1 (b) — `kiemTotpCauHinh` khi sửa / xoá luật ghi lệnh ĐANG BẬT hoặc ĐÃ DUYỆT có đích / nguồn tag; kiểm hợp lệ TRƯỚC, mã CUỐI.
 *   I3     — `changeDeviceOwner` đổi `edgeNodeId` của adapter = ĐỔI ĐÍCH ⇒ luật đã duyệt nhắm adapter đó trở về chưa duyệt.
 *   Quyết định ghi lại: lệch bám KHÔNG làm tag mất bảo vệ (`luatBaoVe` dùng `approvedBy` thô — sửa tag đích vẫn cần mã).
 *
 * CSDL `_test` THẬT (mig 0434 đã áp TEST); người dùng qua `taoNguoiDungTest`; 2FA thật (speakeasy + setup2FA/enable2FA); TOTP qua
 * `kiemXacThucTheoMuc` THẬT; `changeDeviceOwner` THẬT. Oracle: SELECT thô + hàm bám của sản phẩm.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import speakeasy from "speakeasy";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { setup2FA, enable2FA } from "../db/auth";
import { getDb } from "../db/connection";
import { interlockRouter } from "./interlockRouter";
import { deviceAdapterRouter } from "./deviceAdapterRouter";
import { bamDinhNghiaLuat, luatDuyetConHieuLuc } from "../services/interlock/dinhNghiaDuyet";
import { changeDeviceOwner } from "../services/robot/deviceOwnershipService";

const DB_URL = process.env.DATABASE_URL;
const RUN = `ilkkd${process.pid}${Date.now().toString(36)}`;

let sql: ReturnType<typeof postgres>;
const ids = { fac: "", may: 0, ad: 0, ad2: 0, edge: 0, tVan: 0, tNhiet: 0 };
const nguoi = { A: 0, B: 0 };
let A!: ReturnType<typeof interlockRouter.createCaller>;
let B!: ReturnType<typeof interlockRouter.createCaller>;
let devA!: ReturnType<typeof deviceAdapterRouter.createCaller>;

async function maMoi(uid: number): Promise<string> {
  const secret = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(uid, secret);
  await enable2FA(uid);
  return speakeasy.totp({ secret, encoding: "base32" });
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

const hangLuat = async (id: number) =>
  (await sql`SELECT id, "approvedBy", "approvedDefHash", enabled, "sourceType", "machineId", "sourceKey", "targetAdapterId", "commandTag"
    FROM interlock_rules WHERE id = ${id}`)[0] as {
    id: number;
    approvedBy: number | null;
    approvedDefHash: string | null;
    enabled: boolean;
    sourceType: string;
    machineId: number | null;
    sourceKey: string | null;
    targetAdapterId: number | null;
    commandTag: string | null;
  };

const dbApp = async () => (await getDb())!;
const hieuLuc = async (id: number) => luatDuyetConHieuLuc((await dbApp()) as never, (await hangLuat(id)) as never);

/** Luật bảo vệ: nguồn telemetry_tag (máy M, 'nhiet') → stop_line ghi 0 lên 'van' của adapter AD. Tạo bởi A, duyệt bởi B qua router THẬT. */
async function taoLuatDaDuyet(ten: string, o: { action?: "stop_line" | "alert" } = {}): Promise<number> {
  const r = await A.create({
    name: `${RUN}-${ten}`,
    scope: "machine",
    machineId: ids.may,
    sourceType: "telemetry_tag",
    sourceKey: "nhiet",
    comparisonOperator: "gt",
    threshold: 80,
    action: o.action ?? "stop_line",
    ...(o.action === "alert" ? {} : { targetAdapterId: ids.ad, commandTag: "van", commandValue: 0 }),
  });
  await B.approve({ id: r.id, expectedVersion: (await B.get({ id: r.id })).versionToken });
  return r.id;
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("kiem-dinh R1b-1 I1 / I3 — bám định nghĩa lúc duyệt + TOTP khi sửa / xoá luật bảo vệ", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id, code`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`;
    ids.fac = String(f.code);
    ids.may = Number(m.id);
    const ad = async (hau: string) =>
      Number((await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
        VALUES (${ids.may}, ${RUN + hau}, ${RUN + hau}, 'stub', ${"stub://" + RUN + hau}, false) RETURNING id`)[0].id);
    ids.ad = await ad("-a");
    ids.ad2 = await ad("-b");
    ids.edge = Number((await sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${RUN + "-en"}, ${RUN}, ${ids.fac}) RETURNING id`)[0].id);
    const ua = await taoNguoiDungTest("a", "admin", { tienTo: "ilkkd", ts: RUN, ten: "ILK KD A" });
    const ub = await taoNguoiDungTest("b", "admin", { tienTo: "ilkkd", ts: RUN, ten: "ILK KD B" });
    nguoi.A = ua.id;
    nguoi.B = ub.id;
    A = interlockRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
    B = interlockRouter.createCaller({ user: { id: ub.id, role: "admin", name: ub.name, twoFactorEnabled: true } } as never);
    devA = deviceAdapterRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id IN (${ids.ad}, ${ids.ad2})`;
    await sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids.ad}, ${ids.ad2})`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN (${nguoi.A}, ${nguoi.B})`;
    ids.tVan = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${ids.ad}, 'van', '40001', 'int', true, true) RETURNING id`)[0].id);
    ids.tNhiet = Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
      VALUES (${ids.ad}, 'nhiet', '30001', 'float', false, true) RETURNING id`)[0].id);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id IN (${ids.ad}, ${ids.ad2})`;
    await sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids.ad}, ${ids.ad2})`;
    await sql`DELETE FROM device_adapters WHERE id IN (${ids.ad}, ${ids.ad2})`;
    await sql`DELETE FROM edge_nodes WHERE id = ${ids.edge}`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN (${nguoi.A}, ${nguoi.B})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  describe("I1 (a) — bám định nghĩa tag nguồn / đích", () => {
    it("★ approve CHỤP bám hiện tại vào approvedDefHash; get ⇒ duyetHieuLuc true, canDuyetLai false; engine / dispatcher ⇒ còn hiệu lực", async () => {
      const id = await taoLuatDaDuyet("chup");
      const h = await hangLuat(id);
      expect(h.approvedBy).toBe(nguoi.B);
      expect(h.approvedDefHash).toMatch(/^d1:[0-9a-f]{64}$/);
      expect(h.approvedDefHash).toBe(await bamDinhNghiaLuat((await dbApp()) as never, h as never));
      expect(await A.get({ id })).toMatchObject({ duyetHieuLuc: true, canDuyetLai: false });
      expect(await hieuLuc(id)).toBe(true);
    });

    it("★ đổi address tag ĐÍCH sau duyệt (ghi thẳng bảng — như mappings-import có cờ) ⇒ CHƯA DUYỆT: canDuyetLai, enable FORBIDDEN interlockDefinitionChanged, engine/dispatcher false; đổi lại ⇒ khớp lại", async () => {
      const id = await taoLuatDaDuyet("dich");
      await sql`UPDATE device_tags SET address = '40099' WHERE id = ${ids.tVan}`;
      expect(await A.get({ id })).toMatchObject({ duyetHieuLuc: false, canDuyetLai: true });
      expect(await hieuLuc(id)).toBe(false);
      const e = await loiCua(A.enable({ id, expectedVersion: (await A.get({ id })).versionToken }));
      expect(e).toMatchObject({ code: "FORBIDDEN", appCode: "OPERATION_FAILED", appParams: { operation: "activateInterlockRule", reason: "interlockDefinitionChanged" } });
      expect((await hangLuat(id)).enabled).toBe(false);
      await sql`UPDATE device_tags SET address = '40001' WHERE id = ${ids.tVan}`;
      expect(await hieuLuc(id)).toBe(true); // bám tất định: đúng định nghĩa đã duyệt ⇒ khớp lại
    });

    it("★ mỗi thành phần định nghĩa đều vào bám: dataType / scale / offset tag đích, address tag NGUỒN, thêm tag nguồn trên adapter khác của máy; scale '1' ⇒ '1.000000' KHÔNG phải thay đổi", async () => {
      const id = await taoLuatDaDuyet("thanhphan");
      const doiRoiTra = async (lam: () => Promise<unknown>, tra: () => Promise<unknown>, mong: boolean, nhan: string) => {
        await lam();
        expect(await hieuLuc(id), nhan).toBe(mong);
        await tra();
        expect(await hieuLuc(id), `${nhan} (trả lại)`).toBe(true);
      };
      await doiRoiTra(() => sql`UPDATE device_tags SET "dataType" = 'float' WHERE id = ${ids.tVan}`, () => sql`UPDATE device_tags SET "dataType" = 'int' WHERE id = ${ids.tVan}`, false, "dataType đích");
      await doiRoiTra(() => sql`UPDATE device_tags SET scale = 2 WHERE id = ${ids.tVan}`, () => sql`UPDATE device_tags SET scale = NULL WHERE id = ${ids.tVan}`, false, "scale đích");
      await doiRoiTra(() => sql`UPDATE device_tags SET "offset" = 5 WHERE id = ${ids.tVan}`, () => sql`UPDATE device_tags SET "offset" = NULL WHERE id = ${ids.tVan}`, false, "offset đích");
      await doiRoiTra(() => sql`UPDATE device_tags SET address = '39999' WHERE id = ${ids.tNhiet}`, () => sql`UPDATE device_tags SET address = '30001' WHERE id = ${ids.tNhiet}`, false, "address nguồn");
      await doiRoiTra(
        () => sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled") VALUES (${ids.ad2}, 'nhiet', '30002', 'float', false, true)`,
        () => sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad2} AND "tagKey" = 'nhiet'`,
        false,
        "thêm tag nguồn trên adapter khác của máy",
      );
      await doiRoiTra(() => sql`UPDATE device_tags SET scale = '1.000000' WHERE id = ${ids.tVan}`, () => sql`UPDATE device_tags SET scale = NULL WHERE id = ${ids.tVan}`, true, "scale 1 viết khác");
    });

    it("★ versionToken chứa bám định nghĩa: tag đổi giữa lúc xem và lúc bấm duyệt ⇒ approve CONFLICT, không duyệt", async () => {
      const r = await A.create({
        name: `${RUN}-token`,
        scope: "machine",
        machineId: ids.may,
        sourceType: "telemetry_tag",
        sourceKey: "nhiet",
        comparisonOperator: "gt",
        threshold: 80,
        action: "stop_line",
        targetAdapterId: ids.ad,
        commandTag: "van",
        commandValue: 0,
      });
      const daXem = (await B.get({ id: r.id })).versionToken;
      await sql`UPDATE device_tags SET address = '40077' WHERE id = ${ids.tVan}`;
      expect((await B.get({ id: r.id })).versionToken).not.toBe(daXem);
      const e = await loiCua(B.approve({ id: r.id, expectedVersion: daXem }));
      expect(e).toMatchObject({ code: "CONFLICT", appParams: { operation: "approveInterlockRule", reason: "interlockRuleChanged" } });
      expect((await hangLuat(r.id)).approvedBy).toBeNull();
    });

    it("★ duyệt TRƯỚC mig 0434 (approvedDefHash NULL) ⇒ canDuyetLai, enable từ chối, engine/dispatcher false — fail-closed", async () => {
      const id = await taoLuatDaDuyet("cu");
      await sql`UPDATE interlock_rules SET "approvedDefHash" = NULL WHERE id = ${id}`;
      expect(await A.get({ id })).toMatchObject({ duyetHieuLuc: false, canDuyetLai: true });
      expect(await hieuLuc(id)).toBe(false);
      const e = await loiCua(A.enable({ id, expectedVersion: (await A.get({ id })).versionToken }));
      expect(e).toMatchObject({ code: "FORBIDDEN", appParams: { reason: "interlockDefinitionChanged" } });
    });

    it("quyết định: luật lệch bám VẪN bảo vệ tag của nó (luatBaoVe dùng approvedBy thô) — sửa address tag đích qua tags.update vẫn cần mã", async () => {
      const id = await taoLuatDaDuyet("baove");
      await sql`UPDATE device_tags SET "dataType" = 'int', address = '40055' WHERE id = ${ids.tVan}`;
      expect(await hieuLuc(id)).toBe(false);
      const e = await loiCua(devA.tags.update({ id: ids.tVan, address: "40066" }));
      expect(e).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
    });
  });

  describe("I3 — changeDeviceOwner đổi edgeNodeId của adapter = đổi đích", () => {
    /** Luật CHỈ có đích tag (nguồn ng_rate — không có tag nguồn) ⇒ phần đích của bám là thứ duy nhất đổi. */
    const taoLuatChiDich = async () => {
      const r = await A.create({
        name: `${RUN}-chidich`,
        scope: "machine",
        machineId: ids.may,
        sourceType: "ng_rate",
        comparisonOperator: "gt",
        threshold: 5,
        action: "stop_line",
        targetAdapterId: ids.ad,
        commandTag: "van",
        commandValue: 0,
      });
      await B.approve({ id: r.id, expectedVersion: (await B.get({ id: r.id })).versionToken });
      return r.id;
    };
    /** Luật CHỈ có nguồn tag (đích là máy, không adapter) ⇒ phần nguồn của bám là thứ duy nhất đổi. */
    const taoLuatChiNguon = async () => {
      const r = await A.create({
        name: `${RUN}-chinguon`,
        scope: "machine",
        machineId: ids.may,
        sourceType: "telemetry_tag",
        sourceKey: "nhiet",
        comparisonOperator: "gt",
        threshold: 80,
        action: "stop_line",
        targetMachineId: ids.may,
      });
      await B.approve({ id: r.id, expectedVersion: (await B.get({ id: r.id })).versionToken });
      return r.id;
    };

    it("★ đích: adapter đích chuyển sang node edge (changeDeviceOwner THẬT) ⇒ luật CHỈ có đích tag trở về CHƯA DUYỆT; trả về trung tâm ⇒ khớp lại", async () => {
      const id = await taoLuatChiDich();
      expect(await hieuLuc(id)).toBe(true);
      expect((await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: ids.edge, actorUserId: nguoi.A, actorName: "ILK KD A" })).ok).toBe(true);
      expect(await hieuLuc(id)).toBe(false);
      expect((await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: null, actorUserId: nguoi.A, actorName: "ILK KD A" })).ok).toBe(true);
      expect(await hieuLuc(id)).toBe(true);
    });

    it("★ nguồn: adapter mang tag nguồn chuyển sang node edge ⇒ luật CHỈ có nguồn tag trở về CHƯA DUYỆT; trả về ⇒ khớp lại", async () => {
      const id = await taoLuatChiNguon();
      expect(await hieuLuc(id)).toBe(true);
      expect((await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: ids.edge, actorUserId: nguoi.A, actorName: "ILK KD A" })).ok).toBe(true);
      expect(await hieuLuc(id)).toBe(false);
      expect((await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: null, actorUserId: nguoi.A, actorName: "ILK KD A" })).ok).toBe(true);
      expect(await hieuLuc(id)).toBe(true);
    });

    it("★ adapter đích chuyển sang node edge (changeDeviceOwner THẬT) ⇒ luật đã duyệt nhắm adapter đó trở về CHƯA DUYỆT; enable từ chối; trả về trung tâm ⇒ khớp lại", async () => {
      const id = await taoLuatDaDuyet("edge");
      expect(await hieuLuc(id)).toBe(true);
      const di = await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: ids.edge, actorUserId: nguoi.A, actorName: "ILK KD A" });
      expect(di, JSON.stringify(di)).toMatchObject({ ok: true });
      expect((await sql`SELECT "edgeNodeId" FROM device_adapters WHERE id = ${ids.ad}`)[0].edgeNodeId).toBe(ids.edge);
      expect(await hieuLuc(id)).toBe(false);
      expect(await A.get({ id })).toMatchObject({ canDuyetLai: true });
      const e = await loiCua(A.enable({ id, expectedVersion: (await A.get({ id })).versionToken }));
      expect(e).toMatchObject({ code: "FORBIDDEN", appParams: { reason: "interlockDefinitionChanged" } });
      const ve = await changeDeviceOwner({ kind: "adapter", deviceId: ids.ad, toEdgeNodeId: null, actorUserId: nguoi.A, actorName: "ILK KD A" });
      expect(ve, JSON.stringify(ve)).toMatchObject({ ok: true });
      expect(await hieuLuc(id)).toBe(true);
    });
  });

  describe("I1 (b) — TOTP tươi mức 5 khi sửa / xoá luật bảo vệ (kiểm hợp lệ TRƯỚC, mã CUỐI)", () => {
    it("★ sửa luật ĐÃ DUYỆT không mã ⇒ SCADA_CONFIG_TOTP_REQUIRED, hàng giữ nguyên (vẫn duyệt); có mã ⇒ sửa + bỏ duyệt (approvedBy / approvedDefHash NULL)", async () => {
      const id = await taoLuatDaDuyet("sua");
      const truoc = await hangLuat(id);
      const e = await loiCua(A.update({ id, threshold: 90 }));
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
      expect(await hangLuat(id)).toEqual(truoc);
      const sai = await loiCua(A.update({ id, threshold: 90, totpCode: "000000" }));
      expect(sai).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
      const ma = await maMoi(nguoi.A);
      const r = await A.update({ id, threshold: 90, totpCode: ma });
      expect(r).toMatchObject({ approvedBy: null, approvedDefHash: null, enabled: false });
      expect(Number(r.threshold)).toBe(90);
    });

    it("★ xoá luật ĐANG BẬT không mã ⇒ TOTP_CAN, hàng còn; có mã ⇒ xoá", async () => {
      const id = await taoLuatDaDuyet("xoa");
      await sql`UPDATE interlock_rules SET enabled = true WHERE id = ${id}`;
      const e = await loiCua(A.delete({ id, reason: "xoa luat bao ve" }));
      expect(e).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_REQUIRED" });
      expect((await sql`SELECT count(*)::int AS n FROM interlock_rules WHERE id = ${id}`)[0].n).toBe(1);
      const ma = await maMoi(nguoi.A);
      expect(await A.delete({ id, reason: "xoa luat bao ve", totpCode: ma })).toEqual({ success: true });
      expect((await sql`SELECT count(*)::int AS n FROM interlock_rules WHERE id = ${id}`)[0].n).toBe(0);
    });

    it("★ kiểm hợp lệ ĐỨNG TRƯỚC mã: bỏ hết đích của luật stop_line ⇒ FIELD_REQUIRED và mã KHÔNG bị tiêu (dùng lại được ngay)", async () => {
      const id = await taoLuatDaDuyet("hople");
      const ma = await maMoi(nguoi.A);
      const e = await loiCua(A.update({ id, targetAdapterId: null, commandTag: null, targetMachineId: null, totpCode: ma }));
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "FIELD_REQUIRED" });
      expect((await hangLuat(id)).approvedBy).toBe(nguoi.B);
      const r = await A.update({ id, description: "sua mo ta", totpCode: ma });
      expect(r).toMatchObject({ description: "sua mo ta", approvedBy: null });
    });

    it("luật NHÁP (chưa duyệt, tắt) và luật alert đã duyệt ⇒ sửa / xoá KHÔNG cần mã (không bảo vệ tag nào)", async () => {
      const nhap = await A.create({
        name: `${RUN}-nhap`,
        scope: "machine",
        machineId: ids.may,
        sourceType: "telemetry_tag",
        sourceKey: "nhiet",
        comparisonOperator: "gt",
        threshold: 80,
        action: "stop_line",
        targetAdapterId: ids.ad,
        commandTag: "van",
        commandValue: 0,
      });
      expect((await A.update({ id: nhap.id, threshold: 85 })).approvedBy).toBeNull();
      const canh = await taoLuatDaDuyet("canh", { action: "alert" });
      expect((await A.update({ id: canh, threshold: 70 })).approvedBy).toBeNull();
      expect(await A.delete({ id: nhap.id, reason: "xoa luat nhap" })).toEqual({ success: true });
    });
  });
});

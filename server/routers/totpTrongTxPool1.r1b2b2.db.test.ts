/**
 * SCADA R1b-2b-2a T5B (dieu-phoi 2026-11-01) — KHÔNG lấy thêm kết nối pool trong giao dịch giữ khoá hàng: kiểm TOTP mức 5 của đường cấu hình.
 *
 * Trước T5B: `kiemTotpCauHinh` chạy BÊN TRONG giao dịch đang giữ khoá (interlock.update: adapter FOR SHARE + luật FOR UPDATE; setStopPin: adapter
 * FOR SHARE + tag FOR UPDATE) và đọc / ghi 2FA, bộ đếm sai, sổ mã đã dùng QUA POOL = kết nối thứ hai. Pool cạn ⇒ tự khoá chết (mỗi giao dịch giữ
 * khoá chờ thêm một kết nối). Ở đây pool của ứng dụng = 1 (`DB_POOL_MAX=1`, vi.hoisted, chỉ trong tiến trình của tệp này): giao dịch giữ kết nối
 * DUY NHẤT ⇒ lượt kiểm TOTP chờ tới hạn `HAN_TOTP_CAU_HINH_MS` (3 s) ⇒ CONFLICT "thử lại" ⇒ ca ĐỎ (có trần, không treo). Sau T5B: lượt 1 của giao
 * dịch dừng ĐÚNG chỗ kiểm cũ (sau mọi kiểm hợp lệ), rollback, nhả khoá + kết nối; TOTP được kiểm NGOÀI giao dịch (pool, bộ đếm sai commit độc lập
 * như cũ); mã đúng ⇒ lượt 2 chạy lại giao dịch và ghi ⇒ XANH trong `HAN_XONG_MS`.
 *
 * Trần: mọi lời gọi router đi qua `trongHan` (đua với hẹn giờ có tên `HAN_POOL1_MS`) + timeout của ca; thời gian đo trừ phần máy không chạy tệp
 * (`batDauDoLag`, có trần) — không bao giờ treo bộ test.
 *
 * Hồi quy TOTP (cùng pool = 1, mã lỗi giữ NGUYÊN): thiếu mã / sai mã / mã cũ (hết nhịp) / 2FA chưa đăng ký / mã đã dùng (chống phát lại) / tạm khoá
 * sau 5 lần sai (bộ đếm `totp_khoa_sai` sống qua rollback) / kiểm hợp lệ đứng trước mã (mã không bị tiêu) / NOT_FOUND đứng trước mã (không đếm
 * sai) / luật không cần mã bỏ qua mã sai (không đếm).
 *
 * CSDL `_test` THẬT; người dùng qua `taoNguoiDungTest`; 2FA thật (speakeasy + setup2FA / enable2FA); TOTP qua `kiemXacThucTheoMuc` THẬT. Oracle:
 * SELECT thô qua kết nối RIÊNG (`postgres`, max 1 — ngoài pool ứng dụng, chỉ dùng khi không có lời gọi router nào đang bay).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DB_POOL_MAX = "1";
});

import postgres from "postgres";
import speakeasy from "speakeasy";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { batDauDoLag } from "../testing/doLagBucleSuKien";
import { setup2FA, enable2FA } from "../db/auth";
import { getDb, resolvePoolMax } from "../db/connection";
import { interlockRouter } from "./interlockRouter";
import { deviceAdapterRouter } from "./deviceAdapterRouter";

const DB_URL = process.env.DATABASE_URL;
const RUN = `t5bp1${process.pid}${Date.now().toString(36)}`;

/** Trần cứng của MỘT lời gọi router trong tệp này (hẹn giờ có tên — không bao giờ treo). */
const HAN_POOL1_MS = 8_000;
/** Sau T5B một lượt có TOTP phải xong trong mức này (< hạn kiểm TOTP 3 s ⇒ phân biệt được "đi qua" với "chờ tới hạn rồi bị từ chối"). */
const HAN_XONG_MS = 2_500;

let sql: ReturnType<typeof postgres>;
const ids = { fac: "", may: 0, ad: 0, tVan: 0, tNhiet: 0, tGhim: 0 };
const nguoi = { A: 0, K: 0 };
let A!: ReturnType<typeof interlockRouter.createCaller>;
let devA!: ReturnType<typeof deviceAdapterRouter.createCaller>;
let devK!: ReturnType<typeof deviceAdapterRouter.createCaller>;
let secretA = "";

async function trongHan<T>(p: Promise<T>, ten: string): Promise<T> {
  let h: ReturnType<typeof setTimeout> | undefined;
  const het = new Promise<never>((_, loi) => {
    h = setTimeout(() => loi(new Error(`QUÁ HẠN HAN_POOL1_MS (${HAN_POOL1_MS} ms): ${ten}`)), HAN_POOL1_MS);
  });
  try {
    return await Promise.race([p, het]);
  } finally {
    clearTimeout(h);
  }
}

async function maMoi(uid: number): Promise<string> {
  secretA = speakeasy.generateSecret({ length: 20 }).base32;
  await setup2FA(uid, secretA);
  await enable2FA(uid);
  return speakeasy.totp({ secret: secretA, encoding: "base32" });
}

async function loiCua(p: Promise<unknown>, ten: string): Promise<{ code?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await trongHan(p, ten);
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    if (String(x.message).startsWith("QUÁ HẠN")) throw e;
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error(`mong đợi lỗi nhưng thủ tục thành công: ${ten}`);
}

const hangLuat = async (id: number) =>
  (await sql`SELECT threshold, enabled, "approvedBy" FROM interlock_rules WHERE id = ${id}`)[0] as { threshold: string; enabled: boolean } | undefined;
const demSai = async (uid: number) => Number((await sql`SELECT coalesce(sum(so_lan_sai), 0)::int AS n FROM totp_khoa_sai WHERE user_id = ${uid} AND loai = 'totp'`)[0]?.n ?? 0);
const ghimCua = async (id: number) => (await sql`SELECT stop_value AS v FROM device_tags WHERE id = ${id}`)[0].v as unknown;

/** Luật BẢO VỆ (ghi lệnh, ĐANG BẬT, đích tag): sửa / xoá cần TOTP mức 5. Tạo qua router THẬT (pool = 1), bật bằng SQL thô. */
async function taoLuatBaoVe(ten: string): Promise<number> {
  const r = await trongHan(
    A.create({
      name: `${RUN}-${ten}`,
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
    }),
    "interlock.create",
  );
  await sql`UPDATE interlock_rules SET enabled = true WHERE id = ${r.id}`;
  return r.id;
}

/** Một lời gọi có trần + thời gian đo (đã trừ phần máy không chạy tệp, trần 500 ms). */
async function doThoiGian<T>(p: () => Promise<T>, ten: string): Promise<{ kq: T; ms: number }> {
  const lag = batDauDoLag();
  const t0 = Date.now();
  const kq = await trongHan(p(), ten);
  const ms = Date.now() - t0 - (await lag.dung(500));
  return { kq, ms };
}

describe.skipIf(!DB_URL || !/_test\b/.test(DB_URL ?? ""))("R1b-2b-2a T5B — TOTP cấu hình KHÔNG lấy kết nối pool thứ hai trong giao dịch giữ khoá (pool = 1)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN}) RETURNING id, code`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN}) RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN}, 'AOI', true) RETURNING id`;
    ids.fac = String(f.code);
    ids.may = Number(m.id);
    ids.ad = Number((await sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "isEnabled")
      VALUES (${ids.may}, ${RUN}, ${RUN}, 'stub', ${"stub://" + RUN}, false) RETURNING id`)[0].id);
    const ua = await taoNguoiDungTest("a", "admin", { tienTo: "t5bp1", ts: RUN, ten: "T5B A" });
    const uk = await taoNguoiDungTest("k", "engineer", { tienTo: "t5bp1", ts: RUN, ten: "T5B K" });
    nguoi.A = ua.id;
    nguoi.K = uk.id;
    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${uk.id}, ${ids.fac})`;
    await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
      VALUES (${uk.id}, 'machine_control', 'machine_control', true, true, true, true)`;
    A = interlockRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
    devA = deviceAdapterRouter.createCaller({ user: { id: ua.id, role: "admin", name: ua.name, twoFactorEnabled: true } } as never);
    // K: engineer CHƯA đăng ký 2FA (cờ phiên false) — nhánh TOTP_CHUA_DANG_KY
    devK = deviceAdapterRouter.createCaller({ user: { id: uk.id, role: "engineer", name: uk.name, twoFactorEnabled: false } } as never);
  }, 60_000);

  beforeEach(async () => {
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN (${nguoi.A}, ${nguoi.K})`;
    await sql`DELETE FROM totp_consumed WHERE "userId" IN (${nguoi.A}, ${nguoi.K})`;
    const tag = async (key: string, writable: boolean, dataType: string) =>
      Number((await sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
        VALUES (${ids.ad}, ${key}, ${"addr-" + key}, ${dataType}, ${writable}, true) RETURNING id`)[0].id);
    ids.tVan = await tag("van", true, "int");
    ids.tNhiet = await tag("nhiet", false, "float");
    ids.tGhim = await tag("ghim", true, "int");
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM interlock_rules WHERE name LIKE ${RUN + "-%"}`;
    await sql`DELETE FROM device_tags WHERE "adapterId" = ${ids.ad}`;
    await sql`DELETE FROM device_adapters WHERE id = ${ids.ad}`;
    await sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${RUN}`;
    await sql`DELETE FROM machines WHERE code = ${RUN}`;
    await sql`DELETE FROM stations WHERE code = ${RUN}`;
    await sql`DELETE FROM production_lines WHERE code = ${RUN}`;
    await sql`DELETE FROM workshops WHERE code = ${RUN}`;
    await sql`DELETE FROM factories WHERE code = ${RUN}`;
    await sql`DELETE FROM totp_khoa_sai WHERE user_id IN (${nguoi.A}, ${nguoi.K})`;
    await sql`DELETE FROM totp_consumed WHERE "userId" IN (${nguoi.A}, ${nguoi.K})`;
    await sql.end({ timeout: 5 });
  }, 60_000);

  it("cầu chì: pool của ứng dụng trong tiến trình này đúng 1 kết nối — cấu hình VÀ pool SỐNG (3 truy vấn song song bị xếp hàng)", async () => {
    expect(resolvePoolMax()).toBe(1);
    // review m2 — đo trên pool SỐNG, không chỉ biến môi trường: client postgres.js không lộ `max` qua API công khai ⇒ đo HÀNH VI. 3 lượt
    // `pg_sleep(0.25)` đồng thời qua `getDb()`: pool 1 ⇒ xếp hàng ≥ 3 × 250 ms; pool ≥ 3 ⇒ ≈ 250 ms. Cận DƯỚI (không bao giờ xong sớm) ⇒ không
    // đỏ oan dưới tải; 700 ms chừa trượt hẹn giờ.
    const { sql: s } = await import("drizzle-orm");
    const d = (await getDb())!;
    const t0 = Date.now();
    await trongHan(Promise.all([0, 1, 2].map(() => d.execute(s`SELECT pg_sleep(0.25)`))), "pool song");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(700);
  });

  describe("★ pool = 1 — lượt ghi có TOTP đi qua, không chờ tới hạn", () => {
    it("★ interlock.update luật BẢO VỆ + mã đúng ⇒ sửa xong trong HAN_XONG_MS (trước T5B: CONFLICT scadaKenhThuLai sau 3 s)", async () => {
      const id = await taoLuatBaoVe("p1sua");
      const ma = await maMoi(nguoi.A);
      const { kq, ms } = await doThoiGian(() => A.update({ id, threshold: 91, totpCode: ma }), "interlock.update");
      expect(Number(kq.threshold)).toBe(91);
      expect(kq).toMatchObject({ enabled: false, approvedBy: null }); // MOC: sửa luật đang bật ⇒ tắt
      expect(ms).toBeLessThan(HAN_XONG_MS);
      expect(Number((await hangLuat(id))!.threshold)).toBe(91);
    }, 20_000);

    it("★ interlock.delete luật BẢO VỆ + mã đúng ⇒ xoá xong trong HAN_XONG_MS", async () => {
      const id = await taoLuatBaoVe("p1xoa");
      const ma = await maMoi(nguoi.A);
      const { kq, ms } = await doThoiGian(() => A.delete({ id, reason: "xoa luat bao ve pool 1", totpCode: ma }), "interlock.delete");
      expect(kq).toEqual({ success: true });
      expect(ms).toBeLessThan(HAN_XONG_MS);
      expect(await hangLuat(id)).toBeUndefined();
    }, 20_000);

    it("★ deviceAdapter.tags.setStopPin (ghi ghim STOP) + mã đúng ⇒ ghim xong trong HAN_XONG_MS; gỡ bằng mã mới cũng vậy", async () => {
      const ma = await maMoi(nguoi.A);
      const dat = await doThoiGian(
        () => devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "ghim STOP pool 1", totpCode: ma }),
        "setStopPin dat",
      );
      expect(dat.kq).toMatchObject({ changed: true, stopValue: 0 });
      expect(dat.ms).toBeLessThan(HAN_XONG_MS);
      expect(await ghimCua(ids.tGhim)).toBe(0);
      const ma2 = await maMoi(nguoi.A);
      const go = await doThoiGian(
        () => devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: null, reason: "go ghim STOP pool 1", totpCode: ma2 }),
        "setStopPin go",
      );
      expect(go.kq).toMatchObject({ changed: true, stopValue: null });
      expect(go.ms).toBeLessThan(HAN_XONG_MS);
      expect(await ghimCua(ids.tGhim)).toBeNull();
    }, 20_000);
  });

  describe("★ hồi quy TOTP — cùng mã lỗi như trước, chống phát lại giữ nguyên (pool = 1)", () => {
    it("thiếu mã ⇒ SCADA_CONFIG_TOTP_REQUIRED; sai mã ⇒ SCADA_CONFIG_TOTP_INVALID và bộ đếm sai TĂNG dù giao dịch rollback; mã cũ (hết nhịp) ⇒ INVALID", async () => {
      const id = await taoLuatBaoVe("hqma");
      await maMoi(nguoi.A);
      const thieu = await loiCua(A.update({ id, threshold: 90 }), "thieu ma");
      expect(thieu).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_REQUIRED", appParams: { ma: "TOTP_CAN" } });
      expect(await demSai(nguoi.A)).toBe(0); // thiếu mã không phải một lần thử
      const sai = await loiCua(A.update({ id, threshold: 90, totpCode: "000000" }), "sai ma");
      expect(sai).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID", appParams: { ma: "TOTP_SAI" } });
      expect(await demSai(nguoi.A)).toBe(1); // ★ bộ đếm commit độc lập với giao dịch cấu hình (đã rollback)
      const cu = speakeasy.totp({ secret: secretA, encoding: "base32", time: Math.floor(Date.now() / 1000) - 300 });
      const het = await loiCua(A.update({ id, threshold: 90, totpCode: cu }), "ma het nhip");
      expect(het).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
      expect(Number((await hangLuat(id))!.threshold)).toBe(80);
      expect((await hangLuat(id))!.enabled).toBe(true);
    }, 30_000);

    it("2FA chưa đăng ký ⇒ SCADA_CONFIG_TOTP_NOT_ENROLLED (ghim STOP), ghim không đổi", async () => {
      const e = await loiCua(devK.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "chua dang ky 2fa", totpCode: "123456" }), "chua 2fa");
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_NOT_ENROLLED" });
      expect(await ghimCua(ids.tGhim)).toBeNull();
    }, 20_000);

    it("★ chống phát lại: mã đúng dùng LẦN HAI (lượt gọi khác) ⇒ SCADA_CONFIG_TOTP_INVALID, không ghi — cả interlock lẫn ghim STOP", async () => {
      const id1 = await taoLuatBaoVe("pl1");
      const id2 = await taoLuatBaoVe("pl2");
      const ma = await maMoi(nguoi.A);
      await trongHan(A.update({ id: id1, threshold: 92, totpCode: ma }), "lan 1");
      const lai = await loiCua(A.update({ id: id2, threshold: 93, totpCode: ma }), "phat lai interlock");
      expect(lai).toMatchObject({ code: "PRECONDITION_FAILED", appCode: "SCADA_CONFIG_TOTP_INVALID" });
      expect(Number((await hangLuat(id2))!.threshold)).toBe(80);
      const laiGhim = await loiCua(
        devA.tags.setStopPin({ adapterId: ids.ad, tagKey: "ghim", stopValue: 0, reason: "phat lai ghim", totpCode: ma }),
        "phat lai ghim",
      );
      expect(laiGhim).toMatchObject({ appCode: "SCADA_CONFIG_TOTP_INVALID" });
      expect(await ghimCua(ids.tGhim)).toBeNull();
    }, 30_000);

    it("★ tạm khoá: 5 lần sai (mỗi lần giao dịch rollback) ⇒ lượt thứ 6 MÃ ĐÚNG vẫn TOTP_TAM_KHOA (TOO_MANY_REQUESTS), không ghi", async () => {
      const id = await taoLuatBaoVe("khoa");
      const ma = await maMoi(nguoi.A);
      for (let i = 0; i < 5; i++) await loiCua(A.update({ id, threshold: 90, totpCode: `00000${i}` }), `sai ${i}`);
      const e = await loiCua(A.update({ id, threshold: 90, totpCode: ma }), "sau khoa");
      expect(e).toMatchObject({ code: "TOO_MANY_REQUESTS", appCode: "TOTP_TAM_KHOA" });
      expect(Number((await hangLuat(id))!.threshold)).toBe(80);
    }, 40_000);

    it("★ kiểm hợp lệ ĐỨNG TRƯỚC mã: bỏ hết đích ⇒ FIELD_REQUIRED, mã KHÔNG bị tiêu, không đếm sai (dùng lại ngay được)", async () => {
      const id = await taoLuatBaoVe("hople");
      const ma = await maMoi(nguoi.A);
      const e = await loiCua(A.update({ id, targetAdapterId: null, commandTag: null, targetMachineId: null, totpCode: ma }), "bo dich");
      expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "FIELD_REQUIRED" });
      expect(await demSai(nguoi.A)).toBe(0);
      const r = await trongHan(A.update({ id, description: "sua mo ta", totpCode: ma }), "dung lai ma");
      expect(r).toMatchObject({ description: "sua mo ta" });
    }, 30_000);

    it("NOT_FOUND đứng TRƯỚC mã (luật không tồn tại + mã sai ⇒ NOT_FOUND, không đếm sai); luật KHÔNG cần mã bỏ qua mã sai (không đếm)", async () => {
      await maMoi(nguoi.A);
      const nf = await loiCua(A.update({ id: 2_000_000_000, threshold: 90, totpCode: "000000" }), "khong ton tai");
      expect(nf.code).toBe("NOT_FOUND");
      expect(await demSai(nguoi.A)).toBe(0);
      const id = await taoLuatBaoVe("nhap");
      await sql`UPDATE interlock_rules SET enabled = false WHERE id = ${id}`; // nháp: không bảo vệ
      const r = await trongHan(A.update({ id, threshold: 85, totpCode: "000000" }), "nhap ma sai");
      expect(Number(r.threshold)).toBe(85);
      expect(await demSai(nguoi.A)).toBe(0);
    }, 30_000);
  });
});

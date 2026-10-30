/**
 * SCADA R1b-2b-2b A — C1 (M9 + mục 10; Review Focus 1 + 2; KD-2bA 1.1–1.4) — `commandLog.nhatKy` + che chi tiết kỹ thuật ở `list` / `get`.
 * CSDL `_test` THẬT, gọi qua `commandLogRouter.createCaller` (khuôn `lenhCongThucPhamVi.db.test.ts`). Ba nhà máy:
 *   A — kỹ sư A (engineer + canEdit), viewer A (viewer, canView KHÔNG canEdit), operator A (operator + canEdit — không phải kỹ sư);
 *   B — người B (engineer, chỉ nhà máy B) ra một lệnh trên máy A (KD-2bA 1.4 ⇒ "quản trị" với người A);
 *   P — phân trang (KD-2bA 1.2): 120 hàng CÙNG `at` trải HAI nguồn (60 lệnh + 60 lần thử — id hai bảng lệch số chữ số trên `_test`: command_log
 *       ~6 chữ số, attempts ~5 chữ số), và 3 hàng cùng `at` trải hai nguồn ± 1 µs. Ranh 9 → 10 → … → 1000 TRONG một nguồn: ca thuần `soThuTu`.
 * ⚠ `command_log` (REVOKE DELETE cho avi_app, mig 0279) và `scada_command_attempts` (WORM) KHÔNG dọn được bằng vai test ⇒ dòng của tệp này ở lại
 *   `_test` (adapter trỏ adapter đã xoá — chỉ toàn quyền thấy). Vì vậy tệp này KHÔNG BAO GIỜ ghi id tường minh (id cao còn lại làm hỏng mốc
 *   `max(id)` của test khác và va sequence — sự cố 2026-10-30, xem báo cáo C1). Mọi khẳng định của admin lọc theo máy / adapter của tệp.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { duocXemChiTietKyThuat, maLoiCua, maLyDoThu } from "./_chiTietKyThuat";
import { giaiConTro, maHoaConTro, soThuTu } from "./commandLogRouter";

const RUN = `nk${process.pid}${Date.now().toString(36)}`;
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let db: Db;
const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

type Caller = any;
const nguoi: Record<"kyA" | "viewerA" | "opA" | "nguoiB" | "admin" | "kyP", { id: number; c: Caller; ten: string }> = {} as never;
const fx = { fA: "", fB: "", fP: "", mA: 0, mA2: 0, mB: 0, mP: 0, aA: 0, aA2: 0, aB: 0, aP: 0, aT: 0, aD: 0 };
const lenh = { a1: 0, intent: 0, ketQua: 0, a2: 0, b: 0, mayNull: 0, timeout: 0, edge: 0, rb: 0, intent2: 0, ketQua2: 0, d: 0 };
const thu = { a: 0, b: 0, nullVerA: 0, nullUnverA: 0, nullVerB: 0, nullKhongGiaTri: 0, dispatchTho: 0, d: 0 };
const pLenh: number[] = [];
const pThu: number[] = [];
const factories: string[] = [];
// fix round 1 (I1) — văn bản THẬT mà dispatcher ghi cho kết cục thiết bị (KHÔNG có tiền tố MÃ): `otDeviceWrite.ts` (lỗi driver thô / timeout /
// read-back) qua `commandDispatcher.ts` (`errorText: o.errorText`), và `edgeReportsCentral.ts` (hàng edge báo). Tiền tố `MA:` chỉ có ở `writeAll`.
const LOI_DRIVER = "connect ECONNREFUSED 127.0.0.1:502";
const LOI_TIMEOUT = "write timeout after 2000ms — outcome unknown: the write may have been applied on the device";
const LOI_EDGE = 'edge reported status "aborted"';
const LOI_READBACK = "readback mismatch: expected=1 actual=0";

async function seedNhaMay(ten: string): Promise<{ code: string; sid: number }> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  factories.push(code);
  return { code, sid: Number(s.id) };
}
async function seedMay(sid: number, ma: string): Promise<number> {
  const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${sid}, ${RUN + ma}, ${ma}, 'AOI', true) RETURNING id`);
  return Number(m.id);
}
async function seedAdapter(mid: number | null, ma: string, protocol: "stub" | "modbus"): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "lastError")
    VALUES (${mid}, ${`${RUN}-${ma}`}, ${`${RUN}-${ma}`}, ${protocol}::otprotocolenum, ${protocol === "stub" ? `stub://${RUN}-${ma}` : "tcp://10.0.0.5:502"}, 60000, false, 'disabled', 'LOI-BI-MAT') RETURNING id`);
  return Number(r.id);
}
async function seedNguoi(tag: string, role: "engineer" | "viewer" | "operator" | "admin", nhaMay: string[], canEdit: boolean) {
  const ten = `NK ${tag} ${RUN}`;
  const u = await taoNguoiDungTest(tag, role, { tienTo: "nk", ts: RUN, ten });
  for (const c of nhaMay) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${c})`);
  if (role !== "admin") {
    await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', true, ${canEdit})`);
  }
  const { commandLogRouter } = await import("./commandLogRouter");
  return { id: u.id, ten: u.name ?? ten, c: commandLogRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never) };
}
async function seedLenh(o: { adapterId: number; machineId: number | null; status: string; by: number; ackValue?: unknown; errorText?: string | null; createdAt?: string; tagKey?: string }): Promise<number> {
  const [r] = await dung(sql`INSERT INTO command_log ("adapterId", "machineId", "tagKey", "commandType", "requestedValue", "requestedBy", "confirmedBy", status, "triggerKind", "ackValue", "errorText", "createdAt")
    VALUES (${o.adapterId}, ${o.machineId}, ${o.tagKey ?? "tk"}, 'write_tag', ${JSON.stringify(1)}::jsonb, ${o.by}, ${o.by}, ${o.status}::commandstatusenum, 'hitl',
      ${o.ackValue === undefined ? null : JSON.stringify(o.ackValue)}::jsonb, ${o.errorText ?? null}, ${o.createdAt ?? sql`now()`}) RETURNING id`);
  return Number(r.id);
}
async function seedThu(o: { adapterId: number | null; userId: number; reasonCode: string; requestedValue?: unknown; lyDo?: string; at?: string; stage?: string; outcome?: string }): Promise<number> {
  const [r] = await dung(sql`INSERT INTO scada_command_attempts (user_id, adapter_id, tag_key, requested_value, stage, outcome, reason_code, ly_do, at)
    VALUES (${o.userId}, ${o.adapterId}, 'tk', ${o.requestedValue === undefined ? null : JSON.stringify(o.requestedValue)}::jsonb, ${o.stage ?? "request"}, ${o.outcome ?? "rejected"}, ${o.reasonCode}, ${o.lyDo ?? null}, ${o.at ?? sql`now()`}) RETURNING id`);
  return Number(r.id);
}
type Loi = { code?: string; appCode?: string; appParams?: Record<string, unknown> };
async function loiCua(p: Promise<unknown>): Promise<Loi> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}
/** Mọi trang của nhatKy (theo con trỏ) — trả mảng trang. */
async function moiTrang(c: Caller, input: Record<string, unknown>): Promise<Array<{ hang: any[]; conTro: string | null }>> {
  const ra: Array<{ hang: any[]; conTro: string | null }> = [];
  let conTro: string | undefined;
  for (let i = 0; i < 50; i++) {
    const kq = await c.nhatKy({ ...input, ...(conTro ? { conTro } : {}) });
    ra.push(kq);
    if (!kq.conTro) return ra;
    conTro = kq.conTro;
  }
  throw new Error("phân trang không dừng");
}

beforeAll(async () => {
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  const A = await seedNhaMay("a");
  const B = await seedNhaMay("b");
  const P = await seedNhaMay("p");
  fx.fA = A.code;
  fx.fB = B.code;
  fx.fP = P.code;
  fx.mA = await seedMay(A.sid, "mA");
  fx.mA2 = await seedMay(A.sid, "mA2");
  fx.mB = await seedMay(B.sid, "mB");
  fx.mP = await seedMay(P.sid, "mP");
  fx.aA = await seedAdapter(fx.mA, "aA", "stub");
  fx.aA2 = await seedAdapter(fx.mA2, "aA2", "modbus");
  fx.aB = await seedAdapter(fx.mB, "aB", "stub");
  fx.aP = await seedAdapter(fx.mP, "aP", "stub");
  fx.aT = await seedAdapter(fx.mP, "aT", "stub");
  fx.aD = await seedAdapter(fx.mP, "aD", "stub");

  nguoi.kyA = await seedNguoi("kyA", "engineer", [A.code], true);
  nguoi.viewerA = await seedNguoi("viewerA", "viewer", [A.code], false);
  nguoi.opA = await seedNguoi("opA", "operator", [A.code], true);
  nguoi.nguoiB = await seedNguoi("nguoiB", "engineer", [B.code], true);
  nguoi.admin = await seedNguoi("admin", "admin", [], true);
  nguoi.kyP = await seedNguoi("kyP", "engineer", [P.code], true);

  // ── lệnh nhà máy A / B ──
  lenh.a1 = await seedLenh({ adapterId: fx.aA, machineId: fx.mA, status: "failed", by: nguoi.kyA.id, errorText: LOI_DRIVER });
  lenh.intent = await seedLenh({ adapterId: fx.aA, machineId: fx.mA, status: "sent", by: nguoi.kyA.id, ackValue: { ledger: "intent" } });
  lenh.ketQua = await seedLenh({ adapterId: fx.aA, machineId: fx.mA, status: "acked", by: nguoi.kyA.id, ackValue: { ledger: "result", intentId: lenh.intent, raw: "ACK-BI-MAT" } });
  lenh.a2 = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "simulated", by: nguoi.nguoiB.id });
  // lệnh của adapter máy A mà cột machineId NULL ⇒ vẫn thuộc A (qua adapter), lọc machineId vẫn thấy
  lenh.mayNull = await seedLenh({ adapterId: fx.aA, machineId: null, status: "rejected", by: nguoi.kyA.id, errorText: "TAG_NOT_WRITABLE: tag x" });
  lenh.b = await seedLenh({ adapterId: fx.aB, machineId: fx.mB, status: "failed", by: nguoi.nguoiB.id, errorText: "connect ETIMEDOUT 10.9.9.9:102" });
  // I1 — kết cục thiết bị thật (văn bản thô) trên adapter modbus của máy A2
  lenh.timeout = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "timeout", by: nguoi.kyA.id, errorText: LOI_TIMEOUT });
  lenh.edge = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "failed", by: nguoi.kyA.id, errorText: LOI_EDGE });
  lenh.rb = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "acked_unverified", by: nguoi.kyA.id, errorText: LOI_READBACK });
  // M5 — intentId CHUỖI số ⇒ intentId null (cùng luật client commandLedgerRole)
  lenh.intent2 = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "sent", by: nguoi.kyA.id, ackValue: { ledger: "intent" } });
  lenh.ketQua2 = await seedLenh({ adapterId: fx.aA2, machineId: fx.mA2, status: "acked", by: nguoi.kyA.id, ackValue: { ledger: "result", intentId: String(lenh.intent2) } });

  // ── lần thử ──
  thu.a = await seedThu({ adapterId: fx.aA, userId: nguoi.opA.id, reasonCode: "GIA_TRI_NGOAI_DAI", lyDo: "ly do A", requestedValue: 7 });
  thu.b = await seedThu({ adapterId: fx.aB, userId: nguoi.nguoiB.id, reasonCode: "GIA_TRI_NGOAI_DAI" });
  thu.nullVerA = await seedThu({ adapterId: null, userId: nguoi.opA.id, reasonCode: "STOP_QUA_HAN", stage: "dispatch", requestedValue: { machineId: fx.mA, daXacMinhPhamVi: true, buoc: "vai_tro", hanMs: 2000 } });
  thu.nullUnverA = await seedThu({ adapterId: null, userId: nguoi.opA.id, reasonCode: "STOP_QUA_HAN", stage: "dispatch", requestedValue: { machineId: fx.mA, daXacMinhPhamVi: false, buoc: "pham_vi", hanMs: 2000 } });
  thu.nullVerB = await seedThu({ adapterId: null, userId: nguoi.nguoiB.id, reasonCode: "STOP_QUA_HAN", stage: "dispatch", requestedValue: { machineId: fx.mB, daXacMinhPhamVi: true, buoc: "vai_tro", hanMs: 2000 } });
  thu.nullKhongGiaTri = await seedThu({ adapterId: null, userId: nguoi.kyA.id, reasonCode: "NOT_FOUND" });
  // M1 — dòng dispatch mang văn bản thô của driver (đường thử lại idempotent: kq.reason = errorText; lenhHmi bước 9)
  thu.dispatchTho = await seedThu({ adapterId: fx.aA2, userId: nguoi.kyA.id, stage: "dispatch", outcome: "dispatched", reasonCode: LOI_DRIVER, lyDo: `Kết quả gửi: failed (${LOI_DRIVER})` });

  // ── M8: một lệnh + một lần thử ở …05.654321 (den ms phải bao gồm trọn mili-giây) ──
  lenh.d = await seedLenh({ adapterId: fx.aD, machineId: fx.mP, status: "simulated", by: nguoi.kyP.id, createdAt: "2026-10-27 05:06:07.654321" });
  thu.d = await seedThu({ adapterId: fx.aD, userId: nguoi.kyP.id, reasonCode: "D", at: "2026-10-27 05:06:07.654321+00" });

  // ── P: 120 hàng CÙNG at (60 lệnh + 60 lần thử), id tự sinh của hai bảng ──
  const AT_P = "2026-10-28 03:04:05.654321";
  for (let i = 0; i < 60; i++) {
    pLenh.push(await seedLenh({ adapterId: fx.aP, machineId: fx.mP, status: "simulated", by: nguoi.kyP.id, createdAt: AT_P }));
    pThu.push(await seedThu({ adapterId: fx.aP, userId: nguoi.kyP.id, reasonCode: "P", at: `${AT_P}+00` }));
  }
}, 180_000);

afterAll(async () => {
  if (!db) return;
  const ad = [fx.aA, fx.aA2, fx.aB, fx.aP, fx.aT, fx.aD].filter(Boolean);
  // avi_app không có DELETE trên command_log (0279) — thử (vai owner thì dọn được), lỗi quyền thì bỏ qua như lenhCongThucPhamVi
  if (ad.length) await dung(sql`DELETE FROM command_log WHERE "adapterId" IN (${sql.join(ad.map((x) => sql`${x}`), sql`, `)})`).catch(() => undefined);
  for (const k of Object.keys(nguoi) as Array<keyof typeof nguoi>) if (nguoi[k]) await dung(sql`DELETE FROM permissions WHERE "userId" = ${nguoi[k].id}`).catch(() => undefined);
  await dung(sql`DELETE FROM device_adapters WHERE code LIKE ${RUN + "-%"}`).catch(() => undefined);
  await dung(sql`DELETE FROM machines WHERE code LIKE ${RUN + "%"}`).catch(() => undefined);
  for (const c of factories) {
    await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM stations WHERE code = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM production_lines WHERE code = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM workshops WHERE code = ${c}`).catch(() => undefined);
    await dung(sql`DELETE FROM factories WHERE code = ${c}`).catch(() => undefined);
  }
}, 120_000);

describe("_chiTietKyThuat — bảng chân trị duocXemChiTietKyThuat", () => {
  it("admin / engineer × canEdit có / không; operator / viewer / supervisor KHÔNG BAO GIỜ", () => {
    const co = () => true;
    const khong = () => false;
    expect(duocXemChiTietKyThuat({ user: { role: "admin" } }, co)).toBe(true);
    expect(duocXemChiTietKyThuat({ user: { role: "engineer" } }, co)).toBe(true);
    expect(duocXemChiTietKyThuat({ user: { role: "admin" } }, khong)).toBe(false);
    expect(duocXemChiTietKyThuat({ user: { role: "engineer" } }, khong)).toBe(false);
    for (const r of ["operator", "viewer", "supervisor", "quality_inspector", "user"]) expect(duocXemChiTietKyThuat({ user: { role: r } }, co)).toBe(false);
    // hỏi ĐÚNG cặp (machine_control, canEdit)
    const hoi: string[] = [];
    duocXemChiTietKyThuat({ user: { role: "engineer" } }, (m, a) => (hoi.push(`${m}.${a}`), true));
    expect(hoi).toEqual(["machine_control.canEdit"]);
    expect(duocXemChiTietKyThuat({ user: { role: "engineer" } }, (m, a) => m === "machine_control" && a === "canView")).toBe(false);
  });
  it("maLoiCua lấy tiền tố MÃ, không bao giờ phần chi tiết", () => {
    expect(maLoiCua("TAG_NOT_WRITABLE: tag x", "rejected")).toBe("TAG_NOT_WRITABLE");
    expect(maLoiCua(null, "failed")).toBeNull();
    // I1 — văn bản THÔ không tiền tố ⇒ mã DỰ PHÒNG theo status / hình văn bản, không bao giờ null
    expect(maLoiCua(LOI_DRIVER, "failed")).toBe("DRIVER_WRITE_FAILED");
    expect(maLoiCua("no result", "failed")).toBe("DRIVER_WRITE_FAILED");
    expect(maLoiCua(LOI_TIMEOUT, "timeout")).toBe("TIMEOUT");
    expect(maLoiCua("link lost while the write was in flight (after 40ms) — outcome unknown: the write may have been applied on the device", "timeout")).toBe("TIMEOUT");
    expect(maLoiCua(LOI_TIMEOUT, null)).toBe("TIMEOUT"); // gợi ý an toàn sống cả khi không biết status
    expect(maLoiCua(LOI_EDGE, "failed")).toBe("EDGE_REPORTED");
    expect(maLoiCua("the edge reported the re-sent STOP failed", "failed")).toBe("EDGE_REPORTED");
    expect(maLoiCua("readback unavailable", "acked_unverified")).toBe("READBACK_UNAVAILABLE");
    expect(maLoiCua(LOI_READBACK, "acked_unverified")).toBe("READBACK_MISMATCH");
    expect(maLoiCua("readback not verified: sample quality=bad (expected=1 actual=0)", "acked_unverified")).toBe("READBACK_MISMATCH");
    expect(maLoiCua("something odd", "rejected")).toBe("TECHNICAL_ERROR");
    expect(maLyDoThu("STOP_QUA_HAN")).toBe("STOP_QUA_HAN");
    expect(maLyDoThu(LOI_DRIVER)).toBe("TECHNICAL_ERROR");
    expect(maLyDoThu(`TIMEOUT: x`)).toBe("TIMEOUT");
    expect(maLyDoThu(null)).toBeNull();
  });
});

describe("★★★ Review Focus 1 — phạm vi nhà máy (lenh + thu), ngoài phạm vi ≡ NOT_FOUND", () => {
  it("★★★ kỹ sư A nhatKy({}) ⇒ ĐÚNG tập hàng của A (lệnh + lần thử, gồm lần thử adapter NULL đã xác minh); 0 hàng của B; không intent", async () => {
    const kq = await nguoi.kyA.c.nhatKy({ gioiHan: 200 });
    expect(kq.conTro).toBeNull();
    const ids = new Set(kq.hang.map((h: any) => h.id));
    expect([...ids].sort()).toEqual(
      [
        `lenh:${lenh.a1}`, `lenh:${lenh.ketQua}`, `lenh:${lenh.a2}`, `lenh:${lenh.mayNull}`, `lenh:${lenh.timeout}`, `lenh:${lenh.edge}`, `lenh:${lenh.rb}`,
        `lenh:${lenh.ketQua2}`, `thu:${thu.a}`, `thu:${thu.nullVerA}`, `thu:${thu.dispatchTho}`,
      ].sort(),
    );
    expect(kq.hang.filter((h: any) => h.machineId === fx.mB || h.adapterId === fx.aB)).toEqual([]);
    expect(ids.has(`lenh:${lenh.intent}`)).toBe(false);
    expect(ids.has(`lenh:${lenh.intent2}`)).toBe(false);
    expect(ids.has(`thu:${thu.nullUnverA}`)).toBe(false); // Q4: chưa xác minh ⇒ chỉ toàn quyền
    expect(ids.has(`thu:${thu.nullKhongGiaTri}`)).toBe(false); // adapter NULL, không máy ⇒ chỉ toàn quyền
    // lần thử adapter NULL đã xác minh — máy suy từ requested_value (máy chủ ghi)
    expect(kq.hang.find((h: any) => h.id === `thu:${thu.nullVerA}`)).toMatchObject({ nguon: "thu", machineId: fx.mA, adapterId: null, trangThai: "dispatch:rejected", reasonCode: "STOP_QUA_HAN" });
  }, 30_000);

  it("★★★ machineId / adapterId của nhà máy B ⇒ NOT_FOUND machine / adapter — CÙNG lỗi với id không tồn tại", async () => {
    const mayB = await loiCua(nguoi.kyA.c.nhatKy({ machineId: fx.mB }));
    const mayKhong = await loiCua(nguoi.kyA.c.nhatKy({ machineId: 2_000_000_001 }));
    expect(mayB).toEqual({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "machine" } });
    expect(mayKhong).toEqual(mayB);
    const adB = await loiCua(nguoi.kyA.c.nhatKy({ adapterId: fx.aB }));
    const adKhong = await loiCua(nguoi.kyA.c.nhatKy({ adapterId: 2_000_000_001 }));
    expect(adB).toEqual({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "adapter" } });
    expect(adKhong).toEqual(adB);
  }, 30_000);

  it("★★ lọc machineId A ⇒ cả lệnh có machineId NULL nhưng adapter thuộc máy A; lọc adapter ⇒ chỉ adapter đó", async () => {
    const kq = await nguoi.kyA.c.nhatKy({ machineId: fx.mA, gioiHan: 200 });
    expect(kq.hang.map((h: any) => h.id).sort()).toEqual([`lenh:${lenh.a1}`, `lenh:${lenh.ketQua}`, `lenh:${lenh.mayNull}`, `thu:${thu.a}`, `thu:${thu.nullVerA}`].sort());
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.mayNull}`).machineId).toBe(fx.mA);
    const ad = await nguoi.kyA.c.nhatKy({ adapterId: fx.aA2, gioiHan: 200 });
    expect(ad.hang.map((h: any) => h.id).sort()).toEqual(
      [`lenh:${lenh.a2}`, `lenh:${lenh.timeout}`, `lenh:${lenh.edge}`, `lenh:${lenh.rb}`, `lenh:${lenh.ketQua2}`, `thu:${thu.dispatchTho}`].sort(),
    );
  }, 30_000);

  it("★★★ KD-2bA 1.3 — lần thử adapter NULL: daXacMinhPhamVi true ⇒ kỹ sư A thấy; false ⇒ chỉ admin (lọc máy A); B đã xác minh ⇒ không với A", async () => {
    const a = new Set((await nguoi.kyA.c.nhatKy({ nguon: "thu", gioiHan: 200 })).hang.map((h: any) => h.id));
    expect(a.has(`thu:${thu.nullVerA}`)).toBe(true);
    expect(a.has(`thu:${thu.nullUnverA}`)).toBe(false);
    expect(a.has(`thu:${thu.nullVerB}`)).toBe(false);
    const ad = await nguoi.admin.c.nhatKy({ machineId: fx.mA, nguon: "thu", gioiHan: 200 });
    const adIds = new Set(ad.hang.map((h: any) => h.id));
    expect(adIds.has(`thu:${thu.nullVerA}`)).toBe(true);
    expect(adIds.has(`thu:${thu.nullUnverA}`)).toBe(true);
    // máy của dòng CHƯA xác minh là lời client ⇒ không gắn vào hàng (kể cả admin)
    expect(ad.hang.find((h: any) => h.id === `thu:${thu.nullUnverA}`).machineId).toBeNull();
  }, 30_000);

  it("★★ admin (toàn quyền) lọc adapter B ⇒ thấy lệnh + lần thử của B; không intent ở BẤT KỲ ai", async () => {
    const b = await nguoi.admin.c.nhatKy({ adapterId: fx.aB, gioiHan: 200 });
    expect(b.hang.map((h: any) => h.id).sort()).toEqual([`lenh:${lenh.b}`, `thu:${thu.b}`].sort());
    const a = await nguoi.admin.c.nhatKy({ adapterId: fx.aA, gioiHan: 200 });
    expect(a.hang.map((h: any) => h.id)).not.toContain(`lenh:${lenh.intent}`);
  }, 30_000);
});

describe("★★★ Review Focus 2 / KD-2bA 1.1 — chi tiết kỹ thuật theo quyền (nhatKy + list + get)", () => {
  it("★★★ viewer A (canView, không canEdit) ⇒ loi null MỌI hàng; hàng có errorText ⇒ loiBiChe + reasonCode (MÃ, không trống)", async () => {
    const kq = await nguoi.viewerA.c.nhatKy({ gioiHan: 200 });
    expect(kq.hang.length).toBeGreaterThanOrEqual(6);
    for (const h of kq.hang) expect(h.loi).toBeNull();
    const h = (id: string) => kq.hang.find((x: any) => x.id === id);
    // I1 — văn bản thô THẬT của driver / timeout / edge / read-back ⇒ MÃ (không null), không văn bản
    expect(h(`lenh:${lenh.a1}`)).toMatchObject({ loi: null, loiBiChe: true, reasonCode: "DRIVER_WRITE_FAILED" });
    expect(h(`lenh:${lenh.timeout}`)).toMatchObject({ loi: null, loiBiChe: true, reasonCode: "TIMEOUT", trangThai: "timeout" });
    expect(h(`lenh:${lenh.edge}`)).toMatchObject({ loi: null, loiBiChe: true, reasonCode: "EDGE_REPORTED" });
    expect(h(`lenh:${lenh.rb}`)).toMatchObject({ loi: null, loiBiChe: true, reasonCode: "READBACK_MISMATCH" });
    expect(h(`lenh:${lenh.mayNull}`)).toMatchObject({ loi: null, loiBiChe: true, reasonCode: "TAG_NOT_WRITABLE" });
    expect(h(`lenh:${lenh.a2}`)).toMatchObject({ loi: null, loiBiChe: false, reasonCode: null });
    // M1 — dòng thử stage dispatch mang văn bản thô ⇒ reasonCode về MÃ, lyDo null; dòng request giữ lý do người dùng
    expect(h(`thu:${thu.dispatchTho}`)).toMatchObject({ reasonCode: "TECHNICAL_ERROR", lyDo: null, loiBiChe: true });
    expect(h(`thu:${thu.a}`)).toMatchObject({ lyDo: "ly do A", reasonCode: "GIA_TRI_NGOAI_DAI", loiBiChe: false });
    expect(h(`thu:${thu.nullVerA}`)).toMatchObject({ reasonCode: "STOP_QUA_HAN", lyDo: null, loiBiChe: false });
    const json = JSON.stringify(kq);
    for (const cam of ['"ackValue"', '"email"', '"endpoint"', "10.0.0.5", "127.0.0.1", "ECONNREFUSED", "may have been applied", "edge reported", "readback mismatch", "ACK-BI-MAT", "LOI-BI-MAT", "tcp://"]) {
      expect(json, `lộ ${cam}`).not.toContain(cam);
    }
  }, 30_000);

  it("★★★ operator A có canEdit (không phải kỹ sư) ⇒ cũng bị che", async () => {
    const kq = await nguoi.opA.c.nhatKy({ machineId: fx.mA, nguon: "lenh" });
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a1}`)).toMatchObject({ loi: null, loiBiChe: true });
  }, 30_000);

  it("★★★ kỹ sư A (engineer + canEdit) ⇒ loi = errorText đầy đủ; vẫn KHÔNG có ackValue", async () => {
    const kq = await nguoi.kyA.c.nhatKy({ machineId: fx.mA, nguon: "lenh" });
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a1}`)).toMatchObject({ loi: LOI_DRIVER, loiBiChe: false, reasonCode: "DRIVER_WRITE_FAILED" });
    const k2 = await nguoi.kyA.c.nhatKy({ adapterId: fx.aA2 });
    expect(k2.hang.find((h: any) => h.id === `lenh:${lenh.timeout}`)).toMatchObject({ loi: LOI_TIMEOUT, reasonCode: "TIMEOUT" });
    expect(k2.hang.find((h: any) => h.id === `thu:${thu.dispatchTho}`)).toMatchObject({ reasonCode: LOI_DRIVER, lyDo: `Kết quả gửi: failed (${LOI_DRIVER})`, loiBiChe: false });
    expect(JSON.stringify(kq)).not.toContain('"ackValue"');
    expect(JSON.stringify(kq)).not.toContain("ACK-BI-MAT");
  }, 30_000);

  it("★★★ commandLog.list — viewer: errorText / ackValue null, ledger / intentId / maLoi / loiBiChe suy ra; kỹ sư: nguyên cột", async () => {
    const v = await nguoi.viewerA.c.list({ adapterId: fx.aA, limit: 500 });
    const vA1 = v.find((r: any) => r.id === lenh.a1);
    expect(vA1).toMatchObject({ errorText: null, ackValue: null, maLoi: "DRIVER_WRITE_FAILED", loiBiChe: true, ledger: null });
    const vKq = v.find((r: any) => r.id === lenh.ketQua);
    expect(vKq).toMatchObject({ ackValue: null, ledger: "result", intentId: lenh.intent, loiBiChe: false });
    expect(v.find((r: any) => r.id === lenh.intent)).toMatchObject({ ackValue: null, ledger: "intent" });
    for (const r of v) {
      expect(r.errorText).toBeNull();
      expect(r.ackValue).toBeNull();
    }
    expect(JSON.stringify(v)).not.toContain("127.0.0.1");
    const v2 = await nguoi.viewerA.c.list({ adapterId: fx.aA2, limit: 500 });
    expect(v2.find((r: any) => r.id === lenh.timeout)).toMatchObject({ errorText: null, maLoi: "TIMEOUT", loiBiChe: true });
    expect(v2.find((r: any) => r.id === lenh.edge)).toMatchObject({ errorText: null, maLoi: "EDGE_REPORTED", loiBiChe: true });
    // M5 — intentId chuỗi số ⇒ null (ledger vẫn "result")
    expect(v2.find((r: any) => r.id === lenh.ketQua2)).toMatchObject({ ledger: "result", intentId: null });
    expect(JSON.stringify(v2)).not.toContain("may have been applied");
    expect(JSON.stringify(v)).not.toContain("ACK-BI-MAT");
    const op = await nguoi.opA.c.list({ adapterId: fx.aA, limit: 500 });
    expect(op.find((r: any) => r.id === lenh.a1)).toMatchObject({ errorText: null, loiBiChe: true });
    const k = await nguoi.kyA.c.list({ adapterId: fx.aA, limit: 500 });
    expect(k.find((r: any) => r.id === lenh.a1)).toMatchObject({ errorText: LOI_DRIVER, maLoi: "DRIVER_WRITE_FAILED", loiBiChe: false });
    expect(k.find((r: any) => r.id === lenh.ketQua).ackValue).toEqual({ ledger: "result", intentId: lenh.intent, raw: "ACK-BI-MAT" });
  }, 30_000);

  it("★★★ commandLog.get — viewer che, kỹ sư nguyên; ngoài phạm vi vẫn NOT_FOUND", async () => {
    expect(await nguoi.viewerA.c.get({ id: lenh.a1 })).toMatchObject({ id: lenh.a1, errorText: null, ackValue: null, maLoi: "DRIVER_WRITE_FAILED", loiBiChe: true });
    expect(await nguoi.viewerA.c.get({ id: lenh.timeout })).toMatchObject({ errorText: null, maLoi: "TIMEOUT", loiBiChe: true });
    expect(await nguoi.viewerA.c.get({ id: lenh.ketQua })).toMatchObject({ ackValue: null, ledger: "result", intentId: lenh.intent });
    expect(await nguoi.kyA.c.get({ id: lenh.a1 })).toMatchObject({ errorText: LOI_DRIVER, loiBiChe: false });
    expect(await loiCua(nguoi.viewerA.c.get({ id: lenh.b }))).toMatchObject({ code: "NOT_FOUND" });
  }, 30_000);
});

describe("★★ mục 10 + KD-2bA 1.4 — laStub, người (không email), người ngoài phạm vi ⇒ 'quản trị'", () => {
  it("adapter stub ⇒ laStub true + adapterCode; adapter modbus ⇒ false", async () => {
    const kq = await nguoi.kyA.c.nhatKy({ gioiHan: 200 });
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a1}`)).toMatchObject({ laStub: true, adapterCode: `${RUN}-aA`, adapterId: fx.aA, machineId: fx.mA });
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a2}`)).toMatchObject({ laStub: false, adapterCode: `${RUN}-aA2` });
    expect(kq.hang.find((h: any) => h.id === `thu:${thu.a}`)).toMatchObject({ laStub: true, lyDo: "ly do A", reasonCode: "GIA_TRI_NGOAI_DAI", trangThai: "request:rejected", giaTri: 7 });
  }, 30_000);

  it("★★ người trong phạm vi ⇒ tên thật; người chỉ thuộc nhà máy B ⇒ 'quản trị' + ngoaiPhamVi; admin thấy tên thật", async () => {
    const kq = await nguoi.kyA.c.nhatKy({ gioiHan: 200 });
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a1}`).nguoi).toEqual({ id: nguoi.kyA.id, ten: nguoi.kyA.ten, ngoaiPhamVi: false });
    expect(kq.hang.find((h: any) => h.id === `thu:${thu.a}`).nguoi).toEqual({ id: nguoi.opA.id, ten: nguoi.opA.ten, ngoaiPhamVi: false });
    // M4 (fix round 1) — người ngoài phạm vi: id null (không lộ id người dùng nhà máy khác)
    expect(kq.hang.find((h: any) => h.id === `lenh:${lenh.a2}`).nguoi).toEqual({ id: null, ten: "quản trị", ngoaiPhamVi: true });
    expect(JSON.stringify(kq)).not.toContain(nguoi.nguoiB.ten);
    const ad = await nguoi.admin.c.nhatKy({ adapterId: fx.aA2 });
    expect(ad.hang.find((h: any) => h.id === `lenh:${lenh.a2}`).nguoi).toEqual({ id: nguoi.nguoiB.id, ten: nguoi.nguoiB.ten, ngoaiPhamVi: false });
  }, 30_000);
});

describe("★★★ KD-2bA 1.2 — con trỏ tuyến tính (at µs, nguồn, id SỐ)", () => {
  it("★★★ 120 hàng CÙNG at trải hai nguồn (id hai bảng lệch số chữ số) ⇒ 50 / 50 / 20, không trùng, không sót; thu trước lenh, id SỐ giảm dần", async () => {
    const soChuSo = new Set([...pLenh, ...pThu].map((x) => String(x).length));
    if (soChuSo.size < 2) console.warn("[nk] id hai bảng cùng số chữ số trên _test hôm nay — ranh chữ số được canh ở ca thuần soThuTu");
    const trang = await moiTrang(nguoi.kyP.c, { adapterId: fx.aP, gioiHan: 50 });
    expect(trang.map((t) => t.hang.length)).toEqual([50, 50, 20]);
    const ids = trang.flatMap((t) => t.hang.map((h: any) => h.id));
    expect(new Set(ids).size).toBe(120);
    const mong = [...[...pThu].sort((a, b) => b - a).map((x) => `thu:${x}`), ...[...pLenh].sort((a, b) => b - a).map((x) => `lenh:${x}`)];
    expect(ids).toEqual(mong);
    // ranh trang 1 → 2 rơi GIỮA nguồn thu (60 hàng), ranh 2 → 3 GIỮA nguồn lenh — cả hai ở giữa nhóm cùng at
    expect(trang[0].hang[49].nguon).toBe("thu");
    expect(trang[1].hang[0].nguon).toBe("thu");
    expect(trang[1].hang[49].nguon).toBe("lenh");
    expect(trang[0].hang[0].at).toBe("2026-10-28T03:04:05.654321Z");
  }, 60_000);

  it("★★★ (thuần) soThuTu + con trỏ — id lệch số chữ số 9 / 10 / 99 / 100 / 999 / 1000 / 12 345 cùng at: thứ tự SỐ, không so chuỗi", () => {
    const at = "20261028030405654321";
    const hang = [9, 10, 99, 100, 999, 1000, 12_345].flatMap((id) => [
      { at, nguon: "lenh" as const, idSo: id },
      { at, nguon: "thu" as const, idSo: id },
    ]);
    const xep = [...hang].sort(soThuTu).map((h) => `${h.nguon}:${h.idSo}`);
    expect(xep).toEqual([
      ...[12_345, 1000, 999, 100, 99, 10, 9].map((x) => `thu:${x}`),
      ...[12_345, 1000, 999, 100, 99, 10, 9].map((x) => `lenh:${x}`),
    ]);
    // at muộn hơn 1 µs luôn đứng trước, bất kể nguồn / id
    expect([{ at, nguon: "thu" as const, idSo: 1e9 }, { at: "20261028030405654322", nguon: "lenh" as const, idSo: 1 }].sort(soThuTu)[0].idSo).toBe(1);
    for (const c of [{ at, nguon: "lenh" as const, id: 9 }, { at, nguon: "thu" as const, id: 100_000_000_000_000 }]) expect(giaiConTro(maHoaConTro(c))).toEqual(c);
    expect(maHoaConTro({ at, nguon: "thu", id: 999_999_999_999_999 }).length).toBeLessThanOrEqual(64);
  });

  it("★★★ 3 hàng CÙNG at trải hai nguồn + 1 hàng sớm hơn 1 µs + 1 hàng muộn hơn 1 µs; ranh trang rơi GIỮA nhóm cùng at", async () => {
    const T = "2026-10-29 01:02:03.123456";
    const l1 = await seedLenh({ adapterId: fx.aT, machineId: fx.mP, status: "simulated", by: nguoi.kyP.id, createdAt: T });
    const t1 = await seedThu({ adapterId: fx.aT, userId: nguoi.kyP.id, reasonCode: "R1", at: `${T}+00` });
    const t2 = await seedThu({ adapterId: fx.aT, userId: nguoi.kyP.id, reasonCode: "R2", at: `${T}+00` });
    const som = await seedThu({ adapterId: fx.aT, userId: nguoi.kyP.id, reasonCode: "SOM", at: "2026-10-29 01:02:03.123455+00" });
    const muon = await seedLenh({ adapterId: fx.aT, machineId: fx.mP, status: "simulated", by: nguoi.kyP.id, createdAt: "2026-10-29 01:02:03.123457" });
    // thứ tự mong đợi: muộn nhất trước; cùng at ⇒ nguồn thu trước lenh; trong thu ⇒ id số giảm dần
    const mong = [`lenh:${muon}`, `thu:${Math.max(t1, t2)}`, `thu:${Math.min(t1, t2)}`, `lenh:${l1}`, `thu:${som}`];
    for (const gioiHan of [1, 2, 3, 200]) {
      const trang = await moiTrang(nguoi.kyP.c, { adapterId: fx.aT, gioiHan });
      const ids = trang.flatMap((t) => t.hang.map((h: any) => h.id));
      expect(ids, `gioiHan ${gioiHan}`).toEqual(mong);
      if (gioiHan < 5) expect(trang.length).toBe(Math.ceil(5 / gioiHan));
    }
    // µs giữ nguyên trong at
    const tat = await nguoi.kyP.c.nhatKy({ adapterId: fx.aT, gioiHan: 200 });
    expect(tat.hang.map((h: any) => h.at)).toEqual([
      "2026-10-29T01:02:03.123457Z",
      "2026-10-29T01:02:03.123456Z",
      "2026-10-29T01:02:03.123456Z",
      "2026-10-29T01:02:03.123456Z",
      "2026-10-29T01:02:03.123455Z",
    ]);
  }, 60_000);

  it("★★ con trỏ hỏng ⇒ BAD_REQUEST INVALID_VALUE {field: conTro}", async () => {
    for (const x of ["x", Buffer.from("20261029010203123456.q.5").toString("base64url"), Buffer.from("20261399010203123456.l.5").toString("base64url"), "!!!"]) {
      expect(await loiCua(nguoi.kyP.c.nhatKy({ conTro: x }))).toEqual({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "conTro" } });
    }
  }, 30_000);

  it("★ lọc trạng thái: lenh theo status; thu chỉ khi có 'rejected'; mảng rỗng ⇒ 0 hàng", async () => {
    const f = await nguoi.kyA.c.nhatKy({ trangThai: ["failed"], gioiHan: 200 });
    expect(f.hang.map((h: any) => h.id).sort()).toEqual([`lenh:${lenh.a1}`, `lenh:${lenh.edge}`].sort());
    const r = await nguoi.kyA.c.nhatKy({ trangThai: ["rejected"], gioiHan: 200 });
    expect(r.hang.map((h: any) => h.id).sort()).toEqual([`lenh:${lenh.mayNull}`, `thu:${thu.a}`, `thu:${thu.nullVerA}`].sort());
    expect((await nguoi.kyA.c.nhatKy({ trangThai: [] })).hang).toEqual([]);
  }, 30_000);

  it("★★ M8 — den (ms) bao gồm trọn mili-giây cuối tới µs; tu bao gồm đầu; ngoài mili-giây ⇒ không", async () => {
    const tat = (o: Record<string, unknown>) => nguoi.kyP.c.nhatKy({ adapterId: fx.aD, ...o }).then((k: any) => k.hang.map((h: any) => h.id).sort());
    const ca = [`lenh:${lenh.d}`, `thu:${thu.d}`].sort();
    expect(await tat({ den: "2026-10-27T05:06:07.654Z" })).toEqual(ca);
    expect(await tat({ tu: "2026-10-27T05:06:07.654Z" })).toEqual(ca);
    expect(await tat({ tu: "2026-10-27T05:06:07.654Z", den: "2026-10-27T05:06:07.654Z" })).toEqual(ca);
    expect(await tat({ den: "2026-10-27T05:06:07.653Z" })).toEqual([]);
    expect(await tat({ tu: "2026-10-27T05:06:07.655Z" })).toEqual([]);
  }, 30_000);
});

describe("★ M3 — giả định múi giờ của cột command_log.createdAt (naive, coi là UTC)", () => {
  it("phiên Postgres của _test chạy UTC (gộp lenh naive với thu timestamptz chỉ đúng khi TimeZone = UTC)", async () => {
    const [r] = await dung(sql`SELECT current_setting('TimeZone') AS tz`);
    expect(["UTC", "Etc/UTC"]).toContain(String(r.tz));
  });
});

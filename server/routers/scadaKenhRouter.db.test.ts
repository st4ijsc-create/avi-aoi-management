/**
 * SCADA R1a Task 12 — router M12 `scadaKenh` (cấu hình kênh + kênh chế độ máy) trên CSDL `_test` THẬT.
 *
 * Phạm vi do `idsTrongPhamVi` THẬT đọc `user_factory_assignments`; quyền do `checkPermission` THẬT đọc `permissions`; người dùng qua
 * `taoNguoiDungTest`. Hai nhà máy A/B. Không mở kết nối OT nào (adapter stub BẬT chỉ để thoả "adapter đang bật" của kênh chế độ; không
 * gọi startOt). Bộ đệm giá trị hiện tại TẮT (SCADA_LIVE_CACHE_ENABLED=false) ⇒ `cheDoMay` của máy đã khai kênh = LOCAL `bo_dem_tat`.
 *
 * Oracle độc lập: SELECT thô (drizzle `sql`) cho cột tag, hàng `scada_kenh_che_do` và `control_audit_log` (WORM — lọc theo lý do của lượt).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const H = vi.hoisted(() => ({ hongSauAudit: "" }));
vi.mock("../services/audit/controlAuditService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/audit/controlAuditService")>();
  return {
    ...real,
    recordAuditEvent: async (...args: Parameters<typeof real.recordAuditEvent>) => {
      const row = await real.recordAuditEvent(...args);
      // Dòng audit ĐÃ ghi bằng handle được truyền vào, RỒI lỗi ⇒ handle là `tx` thì cả audit lẫn thay đổi rollback.
      if (H.hongSauAudit && String(args[1].reason ?? "").includes(H.hongSauAudit)) throw new Error("R1aT12-hong-sau-audit");
      return row;
    },
  };
});

import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { cheDoMay } from "../services/scada/cheDoMay";

const RUN = `r1at12${process.pid}${Date.now().toString(36)}`;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Router = typeof import("./scadaKenhRouter").scadaKenhRouter;
type Caller = ReturnType<Router["createCaller"]>;

let db: Db;
let scadaKenhRouter: Router;

interface NhaMay {
  fid: number;
  mid: number;
  mid2: number;
  code: string;
}
let A!: NhaMay;
let B!: NhaMay;
const ad = { a: 0, a2: 0, aOff: 0, b: 0, n: 0, o: 0 };
const tg = { mode: 0, sp: 0, stop: 0, out1: 0, mode2: 0, modeB: 0, modeO: 0, txt: 0 };
const factories: string[] = [];
const ruleIds: number[] = [];
let edgeNodeId = 0;

let viewerA!: Caller;
let viewerB!: Caller;
let operatorA!: Caller;
let engA!: Caller;
let engB!: Caller;
let admin!: Caller;

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

async function seedNhaMay(ten: string): Promise<NhaMay> {
  const code = `${RUN}${ten}`;
  const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code + " f"}) RETURNING id`);
  const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code + " w"}) RETURNING id`);
  const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code + " l"}) RETURNING id`);
  const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code + " s"}) RETURNING id`);
  const [m] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, ${code + " m"}, 'AOI', true) RETURNING id`,
  );
  const [m2] = await dung(
    sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code + "-2"}, ${code + " m2"}, 'AOI', true) RETURNING id`,
  );
  factories.push(code);
  return { fid: Number(f.id), mid: Number(m.id), mid2: Number(m2.id), code };
}

async function seedAdapter(code: string, machineId: number | null, isEnabled: boolean, protocol = "stub"): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "lastError")
    VALUES (${machineId}, ${code}, ${code}, ${protocol}, ${"secret-endpoint://" + code}, 500, ${isEnabled}, 'disabled', 'LOI-BI-MAT') RETURNING id`);
  return Number(r.id);
}

async function seedTag(adapterId: number, tagKey: string, dataType: string, writable: boolean): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled")
    VALUES (${adapterId}, ${tagKey}, ${"addr-" + tagKey}, ${dataType}, ${writable}, true) RETURNING id`);
  return Number(r.id);
}

async function seedNguoi(
  ten: string,
  role: "viewer" | "operator" | "engineer" | "admin",
  factoryCodes: string[],
  quyen: { view: boolean; edit: boolean },
): Promise<Caller> {
  const u = await taoNguoiDungTest(ten, role, { tienTo: "r1at12", ts: RUN, ten: `R1aT12 ${ten}` });
  for (const code of factoryCodes) await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
  if (role !== "admin" && (quyen.view || quyen.edit)) {
    await dung(
      sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canEdit") VALUES (${u.id}, 'machine_control', 'machine_control', ${quyen.view}, ${quyen.edit})`,
    );
  }
  return scadaKenhRouter.createCaller({ user: { id: u.id, role, name: u.name, twoFactorEnabled: true } } as never);
}

async function loiCua(p: Promise<unknown>): Promise<{ code?: string; message?: string; appCode?: string; appParams?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message?: string; cause?: { appCode?: string; appParams?: Record<string, unknown> } };
    return { code: x.code, message: x.message, appCode: x.cause?.appCode, appParams: x.cause?.appParams };
  }
  throw new Error("mong đợi lỗi nhưng thủ tục thành công");
}

async function cotTag(id: number) {
  const [r] = await dung(sql`SELECT channel_kind AS "channelKind", display_name AS "displayName", display_format AS "displayFormat",
      write_min AS "writeMin", write_max AS "writeMax", write_step AS "writeStep", actuation_level AS "actuationLevel"
    FROM device_tags WHERE id = ${id}`);
  return r;
}

async function auditTheoLyDo(lyDo: string) {
  return dung(sql`SELECT "entityType", "entityId", action, "actorId", "beforeJson", "afterJson", reason FROM control_audit_log
    WHERE reason = ${lyDo} ORDER BY id`);
}

async function kenhCheDo(machineId: number) {
  const [r] = await dung(sql`SELECT adapter_id AS "adapterId", tag_key AS "tagKey", gia_tri_remote AS "giaTriRemote", updated_by AS "updatedBy"
    FROM scada_kenh_che_do WHERE machine_id = ${machineId}`);
  return r ?? null;
}

const DAT_LAI_TAG = sql`channel_kind = NULL, display_name = NULL, display_format = NULL, write_min = NULL, write_max = NULL,
  write_step = NULL, actuation_level = NULL, deadband = NULL`;

let dem = 0;
const lyDo = (nhan: string) => `${RUN} ${nhan} ${++dem}`;

beforeAll(async () => {
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "false");
  vi.stubEnv("OT_OPCUA_MONITORED_ITEMS", "true");
  const d = await getDb();
  if (!d) throw new Error("test cần CSDL _test");
  db = d;
  ({ scadaKenhRouter } = await import("./scadaKenhRouter"));

  A = await seedNhaMay("a");
  B = await seedNhaMay("b");
  ad.a = await seedAdapter(`${RUN}-a`, A.mid, true);
  ad.a2 = await seedAdapter(`${RUN}-a2`, A.mid2, true); // máy KHÁC trong cùng nhà máy A
  ad.aOff = await seedAdapter(`${RUN}-aoff`, A.mid, false); // máy A nhưng TẮT
  ad.b = await seedAdapter(`${RUN}-b`, B.mid, true);
  ad.n = await seedAdapter(`${RUN}-n`, null, false); // KHÔNG gắn máy
  ad.o = await seedAdapter(`${RUN}-o`, B.mid2, false, "opcua"); // OPC UA (tắt — không ai nối)
  tg.mode = await seedTag(ad.a, "mode", "int", false);
  tg.sp = await seedTag(ad.a, "sp", "float", true);
  tg.stop = await seedTag(ad.a, "stop", "int", true);
  tg.out1 = await seedTag(ad.a, "out1", "int", true);
  tg.txt = await seedTag(ad.a, "txt", "string", true);
  tg.mode2 = await seedTag(ad.a2, "mode", "int", false);
  await seedTag(ad.aOff, "mode", "int", false);
  tg.modeB = await seedTag(ad.b, "mode", "int", false);
  tg.modeO = await seedTag(ad.o, "mode", "bool", false);
  const [n] = await dung(sql`INSERT INTO edge_nodes (code, name, status) VALUES (${RUN + "-en"}, 'r1at12 edge', 'offline') RETURNING id`);
  edgeNodeId = Number(n.id);

  viewerA = await seedNguoi("va", "viewer", [A.code], { view: true, edit: false });
  viewerB = await seedNguoi("vb", "viewer", [B.code], { view: true, edit: false });
  operatorA = await seedNguoi("oa", "operator", [A.code], { view: true, edit: true });
  engA = await seedNguoi("ea", "engineer", [A.code], { view: true, edit: true });
  engB = await seedNguoi("eb", "engineer", [B.code], { view: true, edit: true });
  admin = await seedNguoi("ad", "admin", [], { view: false, edit: false });
}, 60_000);

beforeEach(async () => {
  H.hongSauAudit = "";
  const ids = Object.values(tg);
  await dung(sql`UPDATE device_tags SET ${DAT_LAI_TAG}, stop_value = NULL, stop_pinned_by = NULL, stop_pinned_at = NULL
    WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id = ${ad.a}`);
  if (ruleIds.length) await dung(sql`UPDATE interlock_rules SET enabled = false WHERE id IN (${sql.join(ruleIds.map((i) => sql`${i}`), sql`, `)})`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!db) return;
  try {
    const mays = [A?.mid, A?.mid2, B?.mid, B?.mid2].filter(Boolean);
    if (mays.length) await dung(sql`DELETE FROM scada_kenh_che_do WHERE machine_id IN (${sql.join(mays.map((i) => sql`${i}`), sql`, `)})`);
    if (ruleIds.length) await dung(sql`DELETE FROM interlock_rules WHERE id IN (${sql.join(ruleIds.map((i) => sql`${i}`), sql`, `)})`);
    const ids = [...Object.values(ad).filter(Boolean), -1];
    await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = NULL WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    await dung(sql`DELETE FROM device_adapters WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    if (edgeNodeId) await dung(sql`DELETE FROM edge_nodes WHERE id = ${edgeNodeId}`);
    for (const code of factories) {
      await dung(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${code}`);
      await dung(sql`DELETE FROM machines WHERE code IN (${code}, ${code + "-2"})`);
      await dung(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung(sql`DELETE FROM factories WHERE code = ${code}`);
    }
  } catch (e) {
    console.warn("[r1at12] dọn dữ liệu:", (e as Error).message);
  }
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
describe("scadaKenh.danhSach — phạm vi, hình dạng, mức hiệu lực", () => {
  it("viewer A đọc kênh của adapter máy A: mucHieuLuc=5 cho kênh ra không khai mức, loại kênh suy từ writable, KHÔNG lộ endpoint/lastError", async () => {
    const ds = await viewerA.danhSach({ adapterId: ad.a });
    expect(ds.map((r) => r.tagKey).sort()).toEqual(["mode", "out1", "sp", "stop", "txt"]);
    const out1 = ds.find((r) => r.tagKey === "out1")!;
    expect(out1).toMatchObject({
      tagId: tg.out1,
      dataType: "int",
      writable: true,
      loaiKenh: "input_output",
      channelKindKhai: null,
      actuationLevel: null,
      mucHieuLuc: 5,
      laKenhCheDo: false,
      writeMin: null,
      writeMax: null,
      writeStep: null,
    });
    expect(ds.find((r) => r.tagKey === "mode")).toMatchObject({ loaiKenh: "input", mucHieuLuc: 5 });
    const tho = JSON.stringify(ds);
    expect(tho).not.toContain("secret-endpoint");
    expect(tho).not.toContain("LOI-BI-MAT");
    for (const r of ds) {
      expect(r).not.toHaveProperty("endpoint");
      expect(r).not.toHaveProperty("lastError");
      expect(r).not.toHaveProperty("address");
    }
  });

  it("viewer B (nhà máy khác) ⇒ NOT_FOUND, CÙNG lỗi với adapter không tồn tại; adapter KHÔNG gắn máy chỉ với phạm vi toàn quyền", async () => {
    const ngoai = await loiCua(viewerB.danhSach({ adapterId: ad.a }));
    const khong = await loiCua(viewerB.danhSach({ adapterId: 2_000_000_000 }));
    expect(ngoai.code).toBe("NOT_FOUND");
    expect({ ...ngoai }).toEqual({ ...khong });
    expect((await loiCua(viewerA.danhSach({ adapterId: ad.n }))).code).toBe("NOT_FOUND");
    expect(await admin.danhSach({ adapterId: ad.n })).toEqual([]);
  });

  it("thiếu canView machine_control ⇒ FORBIDDEN", async () => {
    const khongQuyen = await seedNguoi("vk", "viewer", [A.code], { view: false, edit: false });
    expect((await loiCua(khongQuyen.danhSach({ adapterId: ad.a }))).code).toBe("FORBIDDEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("scadaKenh.capNhat — quyền, kiểm hợp lệ, audit trong giao dịch", () => {
  it("operator sửa ⇒ FORBIDDEN, cột không đổi", async () => {
    const e = await loiCua(operatorA.capNhat({ tagId: tg.out1, patch: { actuationLevel: 3 }, lyDo: lyDo("op") }));
    expect(e.code).toBe("FORBIDDEN");
    expect((await cotTag(tg.out1)).actuationLevel).toBeNull();
  });

  it("kỹ sư nhà máy B sửa tag của máy A ⇒ NOT_FOUND (cùng lỗi với tag không tồn tại)", async () => {
    const ngoai = await loiCua(engB.capNhat({ tagId: tg.out1, patch: { actuationLevel: 3 }, lyDo: lyDo("eb") }));
    const khong = await loiCua(engB.capNhat({ tagId: 2_000_000_000, patch: { actuationLevel: 3 }, lyDo: lyDo("eb") }));
    expect(ngoai.code).toBe("NOT_FOUND");
    expect({ ...ngoai }).toEqual({ ...khong });
    expect((await cotTag(tg.out1)).actuationLevel).toBeNull();
  });

  it("kỹ sư A khai kênh: ghi cột + MỘT dòng audit (before/after/lyDo); danhSach trả khai báo + mức hiệu lực", async () => {
    const ld = lyDo("khai");
    const kq = await engA.capNhat({
      tagId: tg.sp,
      patch: { channelKind: "output", displayName: "Tốc độ đặt", displayFormat: "0.0", writeMin: 0, writeMax: 100, writeStep: 0.5, actuationLevel: 3 },
      lyDo: ld,
    });
    expect(kq.changed).toBe(true);
    expect(await cotTag(tg.sp)).toEqual({
      channelKind: "output",
      displayName: "Tốc độ đặt",
      displayFormat: "0.0",
      writeMin: 0,
      writeMax: 100,
      writeStep: 0.5,
      actuationLevel: 3,
    });
    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ entityType: "device_tag", entityId: String(tg.sp), action: "scada_kenh_cap_nhat" });
    expect(au[0].beforeJson).toMatchObject({ channelKind: null, writeMin: null, actuationLevel: null });
    expect(au[0].afterJson).toMatchObject({ channelKind: "output", writeMin: 0, writeMax: 100, writeStep: 0.5, actuationLevel: 3 });
    const r = (await viewerA.danhSach({ adapterId: ad.a })).find((x) => x.tagKey === "sp")!;
    expect(r).toMatchObject({ loaiKenh: "output", channelKindKhai: "output", actuationLevel: 3, mucHieuLuc: 3, displayName: "Tốc độ đặt" });

    // patch một phần: chỉ đổi max, giữ phần còn lại; về NULL được (khai lại = bỏ khai)
    await engA.capNhat({ tagId: tg.sp, patch: { writeMax: 50 }, lyDo: lyDo("max") });
    expect(await cotTag(tg.sp)).toMatchObject({ writeMin: 0, writeMax: 50, writeStep: 0.5, actuationLevel: 3 });
    await engA.capNhat({ tagId: tg.sp, patch: { actuationLevel: null }, lyDo: lyDo("bo-muc") });
    expect((await viewerA.danhSach({ adapterId: ad.a })).find((x) => x.tagKey === "sp")!.mucHieuLuc).toBe(5);
  });

  it("không đổi gì ⇒ changed=false, không audit", async () => {
    const ld = lyDo("noop");
    const kq = await engA.capNhat({ tagId: tg.out1, patch: { writeMin: null }, lyDo: ld });
    expect(kq.changed).toBe(false);
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
  });

  it("kiểm hợp lệ: min>max (kể cả sau khi gộp với hàng hiện tại), bước <= 0, mức ngoài {1,3,4,5}, patch rỗng, dải trên kênh không phải số", async () => {
    const minMax = await loiCua(engA.capNhat({ tagId: tg.out1, patch: { writeMin: 10, writeMax: 5 }, lyDo: lyDo("v") }));
    expect(minMax).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE" });
    await engA.capNhat({ tagId: tg.out1, patch: { writeMax: 5 }, lyDo: lyDo("v") });
    const gop = await loiCua(engA.capNhat({ tagId: tg.out1, patch: { writeMin: 6 }, lyDo: lyDo("v") }));
    expect(gop).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE" });
    for (const writeStep of [0, -1]) {
      expect((await loiCua(engA.capNhat({ tagId: tg.out1, patch: { writeStep }, lyDo: lyDo("v") }))).code).toBe("BAD_REQUEST");
    }
    for (const actuationLevel of [0, 2, 6]) {
      expect((await loiCua(engA.capNhat({ tagId: tg.out1, patch: { actuationLevel: actuationLevel as never }, lyDo: lyDo("v") }))).code).toBe(
        "BAD_REQUEST",
      );
    }
    expect((await loiCua(engA.capNhat({ tagId: tg.out1, patch: {}, lyDo: lyDo("v") }))).code).toBe("BAD_REQUEST");
    expect((await loiCua(engA.capNhat({ tagId: tg.txt, patch: { writeMin: 0 }, lyDo: lyDo("v") }))).code).toBe("BAD_REQUEST");
    expect((await loiCua(engA.capNhat({ tagId: tg.out1, patch: { writeMax: 5 }, lyDo: "abc" }))).code).toBe("BAD_REQUEST"); // lyDo < 5
    expect(await cotTag(tg.out1)).toMatchObject({ writeMin: null, writeMax: 5, writeStep: null, actuationLevel: null });
  });

  it("audit trong CÙNG giao dịch: audit lỗi SAU khi đã chèn ⇒ thay đổi rollback và KHÔNG còn dòng audit lẻ", async () => {
    const ld = lyDo("hong");
    H.hongSauAudit = ld;
    const e = await loiCua(engA.capNhat({ tagId: tg.out1, patch: { actuationLevel: 4, writeMax: 9 }, lyDo: ld }));
    expect(e.message).toContain("R1aT12-hong-sau-audit");
    expect(await cotTag(tg.out1)).toMatchObject({ actuationLevel: null, writeMax: null });
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("scadaKenh.capNhat — nhất quán dải ↔ STOP ghim (điều phối mục 4)", () => {
  it("tag có stop_value=0 đang ghim, khai dải 10..20 ⇒ STOP_PIN_NGOAI_DAI, cột không đổi, không audit", async () => {
    await dung(sql`UPDATE device_tags SET stop_value = '0'::jsonb, stop_pinned_by = 'test', stop_pinned_at = now() WHERE id = ${tg.stop}`);
    const ld = lyDo("stop");
    const e = await loiCua(engA.capNhat({ tagId: tg.stop, patch: { writeMin: 10, writeMax: 20 }, lyDo: ld }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "STOP_PIN_NGOAI_DAI" });
    expect(e.appParams).toMatchObject({ ma: "STOP_PIN_NGOAI_DAI", lyDo: "OUT_OF_RANGE", tagKey: "stop", stopValue: "0", min: 10, max: 20 });
    expect(await cotTag(tg.stop)).toMatchObject({ writeMin: null, writeMax: null });
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
  });

  it("ghim 0 lệch bước (min 1, bước 2) ⇒ từ chối; dải chứa ghim và đúng bước ⇒ OK; dải NULL ⇒ không kiểm", async () => {
    await dung(sql`UPDATE device_tags SET stop_value = '0'::jsonb, stop_pinned_by = 'test', stop_pinned_at = now() WHERE id = ${tg.stop}`);
    const e = await loiCua(engA.capNhat({ tagId: tg.stop, patch: { writeMin: -1, writeMax: 9, writeStep: 2 }, lyDo: lyDo("buoc") }));
    expect(e).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "OFF_STEP" }) });
    await engA.capNhat({ tagId: tg.stop, patch: { writeMin: -2, writeMax: 10, writeStep: 2 }, lyDo: lyDo("ok") });
    expect(await cotTag(tg.stop)).toMatchObject({ writeMin: -2, writeMax: 10, writeStep: 2 });
    await engA.capNhat({ tagId: tg.stop, patch: { writeMin: null, writeMax: null, writeStep: null }, lyDo: lyDo("bo") });
    expect(await cotTag(tg.stop)).toMatchObject({ writeMin: null, writeMax: null, writeStep: null });
  });

  it("đổi loại kênh của tag có ghim DỪNG sang kênh chỉ đọc (input) ⇒ STOP_PIN_NGOAI_DAI (cổng kênh sẽ từ chối lệnh DỪNG)", async () => {
    await dung(sql`UPDATE device_tags SET stop_value = '0'::jsonb, stop_pinned_by = 'test', stop_pinned_at = now() WHERE id = ${tg.stop}`);
    const e = await loiCua(engA.capNhat({ tagId: tg.stop, patch: { channelKind: "input" }, lyDo: lyDo("ro") }));
    expect(e).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "CHANNEL_READ_ONLY" }) });
    expect((await cotTag(tg.stop)).channelKind).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("scadaKenh.capNhat — nhất quán dải ↔ commandValue của luật interlock ĐANG BẬT (review T3 M-3)", () => {
  async function luat(ten: string, o: { enabled: boolean; action?: string; commandValue: unknown }): Promise<number> {
    const [r] = await dung(sql`INSERT INTO interlock_rules (name, scope, "sourceType", "comparisonOperator", threshold, action,
        "targetAdapterId", "commandTag", "commandValue", enabled, "approvedBy", "requiresHumanConfirm")
      VALUES (${RUN + "-" + ten}, 'machine', 'ng_rate', 'gt', 5, ${o.action ?? "reduce_speed"}, ${ad.a}, 'sp',
        ${o.commandValue === null ? null : JSON.stringify(o.commandValue)}::jsonb, ${o.enabled}, 1, false) RETURNING id`);
    ruleIds.push(Number(r.id));
    return Number(r.id);
  }

  it("luật bật ghi sp=50, khai dải 0..10 ⇒ INTERLOCK_NGOAI_DAI, không ghi, không audit; luật TẮT / luật alert không chặn", async () => {
    const id = await luat("bat", { enabled: false, commandValue: 50 });
    await luat("alert", { enabled: true, action: "alert", commandValue: null });
    // luật đang tắt ⇒ khai được (approve/enable sẽ kiểm lại phía interlockRouter)
    await engA.capNhat({ tagId: tg.sp, patch: { writeMin: 0, writeMax: 10 }, lyDo: lyDo("tat") });
    await engA.capNhat({ tagId: tg.sp, patch: { writeMin: null, writeMax: null }, lyDo: lyDo("tat-bo") });

    await dung(sql`UPDATE interlock_rules SET enabled = true WHERE id = ${id}`);
    const ld = lyDo("ilk");
    const e = await loiCua(engA.capNhat({ tagId: tg.sp, patch: { writeMin: 0, writeMax: 10 }, lyDo: ld }));
    expect(e).toMatchObject({ code: "BAD_REQUEST", appCode: "INTERLOCK_NGOAI_DAI" });
    expect(e.appParams).toMatchObject({ ma: "INTERLOCK_NGOAI_DAI", lyDo: "OUT_OF_RANGE", tagKey: "sp", ruleId: id, min: 0, max: 10 });
    expect(await cotTag(tg.sp)).toMatchObject({ writeMin: null, writeMax: null });
    expect(await auditTheoLyDo(ld)).toHaveLength(0);

    // lệch bước cũng chặn; dải chứa 50 và đúng bước ⇒ OK
    expect((await loiCua(engA.capNhat({ tagId: tg.sp, patch: { writeMin: 1, writeMax: 100, writeStep: 2 }, lyDo: lyDo("b") }))).appCode).toBe(
      "INTERLOCK_NGOAI_DAI",
    );
    await engA.capNhat({ tagId: tg.sp, patch: { writeMin: 0, writeMax: 100, writeStep: 5 }, lyDo: lyDo("ok") });
    expect(await cotTag(tg.sp)).toMatchObject({ writeMin: 0, writeMax: 100, writeStep: 5 });
  });

  it("commandValue NULL (engine gửi true) trên kênh float đã khai ⇒ INTERLOCK_NGOAI_DAI (TYPE_MISMATCH lúc chạy)", async () => {
    await luat("null", { enabled: true, commandValue: null });
    const e = await loiCua(engA.capNhat({ tagId: tg.sp, patch: { writeMax: 100 }, lyDo: lyDo("null") }));
    expect(e).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: expect.objectContaining({ lyDo: "TYPE_MISMATCH" }) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("scadaKenh.cheDo — kênh chế độ máy", () => {
  it("dat: tag của adapter gắn máy KHÁC ⇒ từ chối; adapter đúng máy nhưng TẮT ⇒ từ chối; adapter ngoài phạm vi ⇒ NOT_FOUND", async () => {
    const khac = await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a2, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("khac") }));
    expect(khac).toMatchObject({ code: "BAD_REQUEST", appCode: "INVALID_VALUE", appParams: { field: "adapterId", reason: "scadaKenhCheDoSaiMay" } });
    const tat = await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.aOff, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("tat") }));
    expect(tat).toMatchObject({ code: "BAD_REQUEST", appParams: { field: "adapterId", reason: "scadaKenhCheDoAdapterTat" } });
    const ngoai = await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.b, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("ngoai") }));
    expect(ngoai.code).toBe("NOT_FOUND");
    const mayNgoai = await loiCua(engA.cheDo.dat({ machineId: B.mid, adapterId: ad.b, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("mn") }));
    const mayKhong = await loiCua(engA.cheDo.dat({ machineId: 2_000_000_000, adapterId: ad.b, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("mk") }));
    expect(mayNgoai.code).toBe("NOT_FOUND");
    expect({ ...mayNgoai }).toEqual({ ...mayKhong });
    const tagKhong = await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "khong-co", giaTriRemote: 1, lyDo: lyDo("tk") }));
    expect(tagKhong.code).toBe("NOT_FOUND");
    expect(await kenhCheDo(A.mid)).toBeNull();
  });

  it("dat: operator ⇒ FORBIDDEN; giaTriRemote sai kiểu ⇒ từ chối; ép kiểu theo dataType (\"1\" ⇒ 1); audit; danhSach trả kênh + cheDoMay; go gỡ", async () => {
    expect((await loiCua(operatorA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("op") }))).code).toBe(
      "FORBIDDEN",
    );
    const sai = await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: "abc", lyDo: lyDo("sai") }));
    expect(sai).toMatchObject({ code: "BAD_REQUEST", appParams: { field: "giaTriRemote", reason: "scadaGiaTriRemoteSaiKieu" } });

    const ld = lyDo("dat");
    await engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: "1", lyDo: ld });
    const k = await kenhCheDo(A.mid);
    expect(k).toMatchObject({ adapterId: ad.a, tagKey: "mode", giaTriRemote: 1 });
    const au = await auditTheoLyDo(ld);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ entityType: "scada_kenh_che_do", entityId: String(A.mid), action: "scada_kenh_che_do_dat", beforeJson: null });
    expect(au[0].afterJson).toMatchObject({ adapterId: ad.a, tagKey: "mode", giaTriRemote: 1 });

    const ds = await viewerA.cheDo.danhSach();
    expect(ds.every((m) => [A.mid, A.mid2].includes(m.machineId))).toBe(true);
    const mA = ds.find((m) => m.machineId === A.mid)!;
    expect(mA.kenh).toMatchObject({ adapterId: ad.a, tagKey: "mode", giaTriRemote: 1, dataType: "int" });
    const that = await cheDoMay(A.mid);
    expect(mA).toMatchObject({ cheDo: that.cheDo, lyDo: that.lyDo, canhBaoNguon: null });
    expect(mA.lyDo).toBe("bo_dem_tat");
    expect(ds.find((m) => m.machineId === A.mid2)).toMatchObject({ kenh: null, cheDo: "LOCAL", lyDo: "chua_khai", canhBaoNguon: null });
    // danhSach adapter đánh dấu kênh chế độ
    expect((await viewerA.danhSach({ adapterId: ad.a })).find((r) => r.tagKey === "mode")!.laKenhCheDo).toBe(true);

    // đổi (upsert): before = hàng cũ
    const ld2 = lyDo("doi");
    await engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: 2, lyDo: ld2 });
    const au2 = await auditTheoLyDo(ld2);
    expect(au2[0].beforeJson).toMatchObject({ giaTriRemote: 1 });
    expect(au2[0].afterJson).toMatchObject({ giaTriRemote: 2 });

    // go: kỹ sư B ⇒ NOT_FOUND; kỹ sư A ⇒ gỡ + audit; gỡ lần nữa ⇒ không đổi, không audit
    expect((await loiCua(engB.cheDo.go({ machineId: A.mid, lyDo: lyDo("gob") }))).code).toBe("NOT_FOUND");
    const ld3 = lyDo("go");
    expect(await engA.cheDo.go({ machineId: A.mid, lyDo: ld3 })).toEqual({ daGo: true });
    expect(await kenhCheDo(A.mid)).toBeNull();
    const au3 = await auditTheoLyDo(ld3);
    expect(au3).toHaveLength(1);
    expect(au3[0]).toMatchObject({ action: "scada_kenh_che_do_go", afterJson: null });
    const ld4 = lyDo("go2");
    expect(await engA.cheDo.go({ machineId: A.mid, lyDo: ld4 })).toEqual({ daGo: false });
    expect(await auditTheoLyDo(ld4)).toHaveLength(0);
  });

  it("dat: audit lỗi sau khi chèn ⇒ không có hàng kênh, không có audit lẻ", async () => {
    const ld = lyDo("hong");
    H.hongSauAudit = ld;
    await loiCua(engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: 1, lyDo: ld }));
    expect(await kenhCheDo(A.mid)).toBeNull();
    expect(await auditTheoLyDo(ld)).toHaveLength(0);
  });

  it("canhBaoNguon: deadband trên tag chế độ ⇒ deadband; adapter do edge sở hữu ⇒ edge; OPC UA monitored items ⇒ bao_khi_doi", async () => {
    await engA.cheDo.dat({ machineId: A.mid, adapterId: ad.a, tagKey: "mode", giaTriRemote: 1, lyDo: lyDo("cb") });
    const cua = async (c: Caller, m: number) => (await c.cheDo.danhSach()).find((x) => x.machineId === m)!;
    expect((await cua(viewerA, A.mid)).canhBaoNguon).toBeNull();
    await dung(sql`UPDATE device_tags SET deadband = 0.5 WHERE id = ${tg.mode}`);
    expect((await cua(viewerA, A.mid)).canhBaoNguon).toBe("deadband");
    await dung(sql`UPDATE device_adapters SET "edgeNodeId" = ${edgeNodeId} WHERE id = ${ad.a}`);
    expect((await cua(viewerA, A.mid)).canhBaoNguon).toBe("edge");
    await engA.cheDo.go({ machineId: A.mid, lyDo: lyDo("cb-go") });

    // OPC UA: kênh khai thẳng bằng SQL (adapter tắt — test không mở phiên OPC UA nào)
    await dung(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by)
      VALUES (${B.mid2}, ${ad.o}, 'mode', 'true'::jsonb, 1)`);
    const o = await cua(viewerB, B.mid2);
    expect(o).toMatchObject({ canhBaoNguon: "bao_khi_doi", cheDo: "LOCAL", lyDo: "kenh_sai_may" });
    vi.stubEnv("OT_OPCUA_MONITORED_ITEMS", "false");
    expect((await cua(viewerB, B.mid2)).canhBaoNguon).toBeNull();
    vi.stubEnv("OT_OPCUA_MONITORED_ITEMS", "true");
    // phạm vi: viewer A không thấy máy của B
    expect((await viewerA.cheDo.danhSach()).some((x) => x.machineId === B.mid2)).toBe(false);
  });
});

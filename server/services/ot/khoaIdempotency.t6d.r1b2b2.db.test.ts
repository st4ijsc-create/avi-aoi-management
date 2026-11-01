/**
 * SCADA R1b-2b-2a T6d (AN TOÀN, dieu-phoi 2026-11-01) — khoá idempotency KHÔNG MƠ HỒ + CHỐT phát lại theo đúng lệnh ở dispatcher OT.
 *
 * Trước T6d: dispatcher dò idempotency CHỈ theo khoá (`${base}:${tagKey}:${idx}`, `intent:${resultKey}`), không kiểm adapterId / tag / payload của hàng cũ:
 *   • khoá bên gọi chứa `:` hoặc bắt đầu `intent:` đụng khoá nội bộ của lệnh KHÁC ⇒ lệnh mới không được thực thi (bị coi là phát lại / đang bay);
 *   • khoá trùng của adapter KHÁC / payload KHÁC ⇒ trả kết quả cũ = "đã ghi" GIẢ cho lệnh chưa từng tới máy.
 * Sau T6d: khoá v2 có độ dài từng phần (`perWriteKey`), ý định `intent:<khoá v2>` (giữ tiền tố cho hàm DB ot_write_intent_resolve, mig 0374); `quyetDinhKhoa` chỉ phát lại khi MỌI hàng của khoá (kết quả + ý định, định
 * dạng mới + cũ) CÙNG adapterId + tagKey + người gọi + băm payload (hàng cũ chưa có băm ⇒ khớp chắc chắn loại lệnh + giá trị, không ⇒ lệch); lệch ⇒
 * `IDEMPOTENCY_KEY_REUSED`, không gửi, hàng KHÔNG mang khoá; STOP (theo loại hoặc nội dung = ghim; khoá lệch / lần trước không tới thiết bị / ý định
 * treo, kể cả khi bị giành GIỮA bước 2 và khoá tư vấn) ⇒ GỬI THẬT dưới khoá mới, ghi `ackValue.lanTruoc`.
 *
 * DB THẬT (`_test`): dispatcher THẬT + driver GIẢ theo kịch bản cho MỖI adapter (đếm `writeTags`); mọi ghi trong giao dịch ROLLBACK của test; bảng WORM
 * command_log: không id tường minh.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const H = vi.hoisted(() => ({
  tx: null as unknown,
  bay: 0,
  drivers: new Map<number, unknown>(),
  fingerprints: new Map<number, string>(),
  /** chạy TRONG preflight an toàn (sau bước 2, trước khoá tư vấn) — mô phỏng lệnh khác giành khoá giữa hai lần đọc. */
  giuaChung: null as null | (() => Promise<void>),
}));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...real,
    getDb: (async () => {
      if (H.tx) return H.tx;
      H.bay++;
      return null;
    }) as typeof real.getDb,
    __realGetDb: real.getDb,
  };
});
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "T6D-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => {
        const h = H.giuaChung;
        H.giuaChung = null;
        if (h) await h();
        return { status: { estop: false }, unreadable: [] };
      },
    }),
  };
});
vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (adapterId: number) => H.drivers.get(adapterId) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (adapterId: number) => H.fingerprints.get(adapterId),
  };
});

import * as conn from "../../db/connection";
import { aiPendingActions, commandLog, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";
import { dispatch, perWriteKey, bamLenhOt, quyetDinhKhoa, MA_KHOA_DUNG_LAI, type DispatchResult, type DispatchInput, type HangTheoKhoa } from "./commandDispatcher";
import type { OtCommandResult, OtWrite } from "./otDriver";
import { coTheDaBayCua } from "../equipment/lenhTruocCoTheDaBay";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T6D-${Date.now()}`;
const OWNER = 990_907_101;
const KHAC = 990_907_102; // người gọi khác (requestedBy)
const MACHINE = 990_907_001;
const TOOL = "set_machine_param";
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

type KichBan = (w: OtWrite) => OtCommandResult;
const ACK: KichBan = (w) => ({ tagKey: w.tagKey, ok: true });
const HONG: KichBan = (w) => ({ tagKey: w.tagKey, ok: false, error: "modbus exception 2 (illegal data address)" });

/** Driver giả: mọi write ⇒ `kb`; đếm lời gọi writeTags. */
function driverGia(kb: KichBan = ACK) {
  const d = {
    protocol: "modbus",
    soGhi: 0,
    kb,
    isConnected: () => true,
    connect: async () => undefined,
    disconnect: async () => undefined,
    health: async () => ({ protocol: "modbus", connected: true }),
    writeTags: async (ws: OtWrite[]) => {
      d.soGhi += 1;
      return ws.map((w) => d.kb(w));
    },
    readTags: async () => [],
  };
  return d;
}

/** adapter modbus + tag `t`, `0:t` (chứa `:`), `a` (stopValue 0) — driver giả của riêng adapter. */
async function taoAdapter(tx: Tx, d: unknown): Promise<number> {
  const endpoint = `tcp://192.0.2.${10 + Math.floor(Math.random() * 200)}:502`;
  const [a] = await tx.insert(deviceAdapters).values({ code: `${DAU}-A-${Math.random().toString(36).slice(2, 8)}`, name: `${DAU} adapter`, protocol: "modbus", endpoint, isEnabled: true, machineId: MACHINE }).returning();
  const adapterId = a!.id;
  await tx.insert(deviceTags).values([
    { adapterId, tagKey: "t", address: "40001", dataType: "int", writable: true },
    { adapterId, tagKey: "0:t", address: "40002", dataType: "int", writable: true },
    { adapterId, tagKey: "a", address: "40003", dataType: "int", writable: true, stopValue: 0 as never },
  ]);
  H.drivers.set(adapterId, d);
  H.fingerprints.set(adapterId, adapterTargetFingerprint({ protocol: "modbus", endpoint, machineId: MACHINE, connectionOptions: null }));
  return adapterId;
}

/** Uỷ quyền HITL gắn ĐÚNG lệnh này (mỗi lệnh khác nhau có hành động riêng — như thật). */
async function taoHanhDong(tx: Tx, adapterId: number, writes: Array<{ tagKey: string; value: unknown }>, commandType = "set_param"): Promise<string> {
  const actionId = `${DAU}-act-${Math.random().toString(36).slice(2, 10)}`;
  await tx.insert(aiPendingActions).values({
    id: actionId,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} test action`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${actionId}-idem`,
    expiresAt: new Date(Date.now() + 600_000),
  });
  return actionId;
}

async function gui(tx: Tx, adapterId: number, writes: Array<{ tagKey: string; value: unknown }>, key: string, commandType = "set_param", requestedBy = OWNER): Promise<DispatchResult> {
  const actionId = await taoHanhDong(tx, adapterId, writes, commandType);
  return dispatch({
    adapterId,
    machineId: MACHINE,
    commandType,
    writes,
    triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy },
    idempotencyKey: key,
  });
}

/** Hàng kết quả ghi TRƯỚC T6d (khoá định dạng CŨ, không `bam`) — chèn literal tại chỗ (không id). */
async function chenHangCu(tx: Tx, adapterId: number, base: string, tagKey: string, value: unknown, status: "acked" | "failed" = "acked") {
  return chenHang(tx, { adapterId, tagKey, value, status, ackValue: { ledger: "result" }, key: `${base}:${tagKey}:0` });
}

/** Một hàng sổ bất kỳ (không id) — để dựng tình huống: ý định treo, hàng của lệnh khác giành khoá, … */
async function chenHang(tx: Tx, o: { adapterId: number; tagKey: string; value: unknown; status: "acked" | "failed" | "sent"; ackValue: unknown; key: string; commandType?: string }) {
  const [r] = await tx
    .insert(commandLog)
    .values({
      actionId: null,
      adapterId: o.adapterId,
      machineId: MACHINE,
      tagKey: o.tagKey,
      address: "40001",
      commandType: o.commandType ?? "set_param",
      requestedValue: o.value as never,
      requestedBy: OWNER,
      confirmedBy: OWNER,
      status: o.status,
      errorText: o.status === "failed" ? "modbus exception 2" : null,
      ackValue: o.ackValue as never,
      idempotencyKey: o.key,
      sentAt: new Date(),
    })
    .returning({ id: commandLog.id });
  return r!.id;
}

const chieu = (r: DispatchResult) => ({ ok: r.ok, simulated: r.simulated, status: r.status, reason: r.reason ?? null, motPhan: r.motPhan ?? null, pinnedStop: r.pinnedStop === true, results: r.results.map((x) => ({ tagKey: x.tagKey, ok: x.ok, status: x.status })) });
const khoaMoi = () => `${DAU}-${randomUUID().slice(0, 8)}`;

const ENV_KEYS = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED", "AI_OT_CONTROL_ENABLED", "PARAM_GUARDRAIL_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

describe("T6d — khoá không mơ hồ (thuần)", () => {
  it("perWriteKey: base `K` + tag `x:y` ≠ base `K:x` + tag `y`; base `intent:X` không cho khoá ý định của base `X`", () => {
    expect(perWriteKey("K", "x:y", 0)).not.toBe(perWriteKey("K:x", "y", 0));
    expect(perWriteKey("K", "0:t", 0)).not.toBe(perWriteKey("K:0", "t", 0));
    expect(perWriteKey("intent:X", "t", 0)).not.toBe(`intent:${perWriteKey("X", "t", 0)}`); // khoá kết quả luôn bắt đầu `v2:`, khoá ý định luôn `intent:`
    expect(perWriteKey("intent:X", "t", 0).startsWith("v2:")).toBe(true);
    expect(perWriteKey("K", "t", 0)).toBe("v2:1:K:1:t:0");
  });
  it("băm payload: cùng lệnh ⇒ cùng băm; khác giá trị / kiểu / thứ tự / loại lệnh ⇒ khác", () => {
    const w = (v: unknown) => [{ tagKey: "t", value: v }];
    expect(bamLenhOt({ commandType: "set_param", writes: w(1) })).toBe(bamLenhOt({ commandType: "set_param", writes: w(1) }));
    expect(bamLenhOt({ commandType: "set_param", writes: w(1) })).not.toBe(bamLenhOt({ commandType: "set_param", writes: w(2) }));
    expect(bamLenhOt({ commandType: "set_param", writes: w(1) })).not.toBe(bamLenhOt({ commandType: "set_param", writes: w("1") }));
    expect(bamLenhOt({ commandType: "set_param", writes: w(1) })).not.toBe(bamLenhOt({ commandType: "stop", writes: w(1) }));
    const ab = [{ tagKey: "a", value: 1 }, { tagKey: "b", value: 2 }];
    expect(bamLenhOt({ commandType: "set_param", writes: ab })).not.toBe(bamLenhOt({ commandType: "set_param", writes: [...ab].reverse() }));
  });
  it("quyetDinhKhoa: bảng quyết định (băm / adapter / tag / người gọi / hàng cũ khớp chắc chắn / ý định)", () => {
    const input = { adapterId: 1, commandType: "set_param", writes: [{ tagKey: "t", value: "245" }], idempotencyKey: "K", triggeredBy: { kind: "hitl", requestedBy: 7 } } as unknown as DispatchInput;
    const ng = { requestedBy: 7, triggerKind: "hitl" };
    const hang = (o: Partial<{ id: number; adapterId: number; tagKey: string; commandType: string; requestedValue: unknown; ackValue: unknown; status: string; requestedBy: number; triggerKind: string }>) =>
      ({ id: 1, adapterId: 1, tagKey: "t", commandType: "set_param", requestedValue: 245, ackValue: { ledger: "result" }, status: "acked", requestedBy: 7, triggerKind: "hitl", ...o }) as never;
    const h = (o: Partial<HangTheoKhoa>): HangTheoKhoa => ({ ketQuaMoi: [undefined], ketQuaCu: [undefined], yDinhMoi: [undefined], yDinhCu: [undefined], ...o });
    const b = bamLenhOt(input);
    const q = (x: Partial<HangTheoKhoa>) => quyetDinhKhoa(input, b, ng, h(x)).loai;
    expect(q({})).toBe("khong");
    // hàng MỚI (có băm)
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b } })] })).toBe("phat_lai");
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: "khac" } })] })).toBe("lech"); // payload khác
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b }, adapterId: 2 })] })).toBe("lech"); // adapter khác
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b }, tagKey: "u" })] })).toBe("lech"); // tag khác
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b }, requestedBy: 8 })] })).toBe("lech"); // người gọi khác
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b }, triggerKind: "interlock" })] })).toBe("lech"); // nguồn kích hoạt khác
    // hàng CŨ (không băm): khớp chắc chắn ⇒ phát lại; giá trị không chắc ⇒ khong_chac (kết cục KHÔNG RÕ); cột / loại lệnh khác ⇒ lệch
    expect(q({ ketQuaCu: [hang({})] })).toBe("phat_lai"); // "245" ≡ 245
    expect(q({ ketQuaCu: [hang({ requestedValue: 246 })] })).toBe("khong_chac");
    expect(q({ ketQuaCu: [hang({ requestedValue: 246 })], ketQuaMoi: [hang({ id: 3, ackValue: { bam: "khac" } })] })).toBe("lech"); // lệch thắng không chắc
    expect(q({ ketQuaCu: [hang({ commandType: "start" })] })).toBe("lech");
    expect(q({ ketQuaCu: [hang({ adapterId: 2 })] })).toBe("lech");
    // ý định: cùng lệnh không kết quả ⇒ đang bay; ý định của lệnh khác ⇒ lệch (dù không có hàng kết quả)
    expect(q({ yDinhMoi: [hang({ status: "sent", ackValue: { ledger: "intent", bam: b } })] })).toBe("dang_bay");
    expect(q({ yDinhCu: [hang({ status: "sent", ackValue: { ledger: "intent" } })] })).toBe("dang_bay");
    expect(q({ yDinhMoi: [hang({ status: "sent", ackValue: { ledger: "intent", bam: "khac" } })] })).toBe("lech");
    // một hàng lệch trong nhiều hàng ⇒ lệch (không bao giờ phát lại một phần)
    expect(q({ ketQuaMoi: [hang({ ackValue: { bam: b } })], yDinhMoi: [hang({ id: 2, status: "sent", ackValue: { ledger: "intent", bam: "khac" } })] })).toBe("lech");
    // hàng kết quả chưa kết thúc ⇒ đang bay (không phát lại)
    expect(q({ ketQuaMoi: [hang({ status: "sent", ackValue: { bam: b } })] })).toBe("dang_bay");
  });
});

describe.skipIf(!DB_URL)("T6d — chốt phát lại của dispatcher OT (DB thật, giao dịch ROLLBACK)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    await import("./adapterFacade");
    await import("../safety/plc/safetyPlcAdapter");
  }, 60_000);
  afterAll(() => {
    H.drivers.clear();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });
  beforeEach(() => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    for (const k of ENV_KEYS.slice(2)) delete process.env[k];
    H.bay = 0;
  });

  it("★ D1 khoá chứa `:` KHÔNG đụng: lệnh A (khoá K, tag `0:t`) rồi lệnh B (khoá `K:0`, tag `t`) ⇒ CẢ HAI được ghi (định dạng cũ: `K:0:t:0` ≡ `K:0:t:0`)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const a = await gui(tx, ad, [{ tagKey: "0:t", value: 1 }], K);
      const b = await gui(tx, ad, [{ tagKey: "t", value: 1 }], `${K}:0`);
      expect(a).toMatchObject({ ok: true, status: "acked" });
      expect(b).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGhi).toBe(2);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D2 khoá bắt đầu `intent:` KHÔNG đụng: lệnh A (khoá `intent:K`) rồi lệnh B (khoá K) cùng tag ⇒ B được ghi, không DUPLICATE_IN_FLIGHT", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const a = await gui(tx, ad, [{ tagKey: "t", value: 1 }], `intent:${K}`);
      const b = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K);
      expect(a).toMatchObject({ ok: true, status: "acked" });
      expect(b).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGhi).toBe(2);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D3 dùng lại khoá với payload KHÁC ⇒ IDEMPOTENCY_KEY_REUSED, 0 gói ghi, không trả kết quả cũ; hàng từ chối KHÔNG mang khoá", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const a = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K);
      const b = await gui(tx, ad, [{ tagKey: "t", value: 2 }], K);
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({ ok: false, simulated: false, status: "rejected", reason: MA_KHOA_DUNG_LAI });
      expect(d.soGhi).toBe(1);
      expect(b.commandLogIds.some((id) => a.commandLogIds.includes(id))).toBe(false);
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, b.commandLogIds));
      expect(hang).toHaveLength(1);
      expect(hang[0]!.idempotencyKey).toBeNull();
      expect(hang[0]!.errorText).toMatch(/^IDEMPOTENCY_KEY_REUSED: /);
      const thamChieu = (hang[0]!.ackValue as { khoaDungLai?: { commandLogIds?: number[] } }).khoaDungLai?.commandLogIds ?? [];
      expect(thamChieu).toEqual(expect.arrayContaining(a.commandLogIds)); // hàng kết quả của lệnh kia (+ ý định của nó)
      expect(thamChieu).toHaveLength(2);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D4 khoá trùng (`hmi:<uuid>`) nhưng adapter KHÁC ⇒ từ chối, 0 gói trên adapter kia", async () => {
    await trongGiaoDich(async (tx) => {
      const dX = driverGia();
      const dY = driverGia();
      const x = await taoAdapter(tx, dX);
      const y = await taoAdapter(tx, dY);
      const K = `hmi:${randomUUID()}`;
      expect((await gui(tx, x, [{ tagKey: "t", value: 1 }], K)).ok).toBe(true);
      const b = await gui(tx, y, [{ tagKey: "t", value: 1 }], K);
      expect(b).toMatchObject({ ok: false, status: "rejected", reason: MA_KHOA_DUNG_LAI });
      expect(dX.soGhi).toBe(1);
      expect(dY.soGhi).toBe(0);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("D5 hàng CŨ (khoá định dạng cũ, không băm) khác giá trị ⇒ KHÔNG chứng minh được khác lệnh ⇒ DUPLICATE_IN_FLIGHT (kết cục không rõ, lớp \"có thể đã bay\"), không bao giờ ok:true, 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      await chenHangCu(tx, ad, K, "t", 1);
      const r = await gui(tx, ad, [{ tagKey: "t", value: 2 }], K);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe("DUPLICATE_IN_FLIGHT"); // không phải IDEMPOTENCY_KEY_REUSED: FOE sẽ KHÔNG thử lại với khoá mới (coTheDaBayCua)
      expect(coTheDaBayCua({ ok: false, detail: { reason: r.reason } })).toBe("DUPLICATE_IN_FLIGHT");
      expect(coTheDaBayCua({ ok: false, detail: { reason: MA_KHOA_DUNG_LAI } })).toBeNull(); // lệch CHẮC CHẮN ⇒ lệnh này chưa gửi ⇒ thử lại được
      expect(d.soGhi).toBe(0);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("D6 hàng CŨ khớp CHẮC CHẮN adapter + tag + loại lệnh + giá trị ⇒ phát lại kết quả cũ (T6c), 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      await chenHangCu(tx, ad, K, "t", 1);
      const r = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K);
      expect(r).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGhi).toBe(0);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D7 STOP với khoá đã dùng cho lệnh KHÁC ⇒ VẪN GỬI THẬT (khoá mới), hàng mang ackValue.lanTruoc", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const a = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K);
      // CÙNG tag ⇒ cùng khoá per-write; khác loại lệnh + giá trị ⇒ băm lệch (lệnh thường ở đây sẽ bị IDEMPOTENCY_KEY_REUSED)
      const s = await gui(tx, ad, [{ tagKey: "t", value: 0 }], K, "stop");
      expect(s).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGhi).toBe(2);
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, s.commandLogIds));
      const lt = (hang[0]!.ackValue as { lanTruoc?: { idempotencyKey?: string; commandLogIds?: number[]; lyDo?: string } }).lanTruoc;
      expect(lt).toMatchObject({ idempotencyKey: K, lyDo: "khoa_lech" });
      expect(lt?.commandLogIds).toEqual(expect.arrayContaining(a.commandLogIds)); // kết quả + ý định của lần trước
      expect(lt?.commandLogIds).toHaveLength(2);
      expect(hang[0]!.idempotencyKey).not.toBe(perWriteKey(K, "t", 0)); // khoá gốc thuộc lần trước
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("D8 STOP khoá trùng, lần trước KHÔNG ok ⇒ gửi lại; D9 lần trước ok ⇒ phát lại (không gửi)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia(HONG);
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const s1 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], K, "stop");
      expect(s1.ok).toBe(false);
      d.kb = ACK;
      const s2 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], K, "stop");
      expect(s2).toMatchObject({ ok: true, status: "acked" });
      expect(d.soGhi).toBe(2); // ★ gửi lại thật
      const h2 = await tx.select().from(commandLog).where(inArray(commandLog.id, s2.commandLogIds));
      expect((h2[0]!.ackValue as { lanTruoc?: { lyDo?: string } }).lanTruoc?.lyDo).toBe("lan_truoc_khong_ok");

      const K2 = khoaMoi();
      const t1 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], K2, "stop");
      const t2 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], K2, "stop");
      expect(t1.ok).toBe(true);
      expect(chieu(t2)).toEqual(chieu(t1)); // phát lại = sống
      expect(d.soGhi).toBe(3); // lần thứ hai của K2 KHÔNG gửi
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("D10 phát lại ĐÚNG lệnh (cùng adapter / tag / payload) vẫn trả kết quả cũ = câu trả lời sống (T6c), 0 gói thêm; hàng mang ackValue.bam", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const writes = [{ tagKey: "t", value: 1 }];
      const a = await gui(tx, ad, writes, K);
      const b = await gui(tx, ad, writes, K);
      expect(chieu(b)).toEqual(chieu(a));
      expect(d.soGhi).toBe(1);
      const hang = await tx.select().from(commandLog).where(like(commandLog.idempotencyKey, `%${K}%`));
      expect(hang.length).toBeGreaterThan(0);
      for (const h of hang) expect((h.ackValue as { bam?: string }).bam).toBe(bamLenhOt({ commandType: "set_param", writes }));
    });
    expect(H.bay).toBe(0);
  }, 30_000);
  it("★ D4b khoá trùng, CÙNG adapter / tag / payload nhưng NGƯỜI GỌI khác ⇒ từ chối (không lộ kết quả của người kia), 0 gói", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      const a = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K);
      const b = await gui(tx, ad, [{ tagKey: "t", value: 1 }], K, "set_param", KHAC);
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({ ok: false, status: "rejected", reason: MA_KHOA_DUNG_LAI });
      expect(b.commandLogIds.some((id) => a.commandLogIds.includes(id))).toBe(false);
      expect(d.soGhi).toBe(1);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D11 STOP theo NỘI DUNG (loại lệnh thường, write = tag ghim + giá trị ghim) với khoá của lệnh khác ⇒ VẪN GỬI (khoá mới, khoa_lech)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      await chenHang(tx, { adapterId: ad, tagKey: "a", value: 5, status: "acked", ackValue: { ledger: "result", bam: "lenh-khac" }, key: perWriteKey(K, "a", 0) });
      const s1 = await gui(tx, ad, [{ tagKey: "a", value: 0 }], K, "set_param");
      expect(s1.ok).toBe(true);
      expect(d.soGhi).toBe(1);
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, s1.commandLogIds));
      expect((hang[0]!.ackValue as { lanTruoc?: { lyDo?: string } }).lanTruoc?.lyDo).toBe("khoa_lech");
      // đối chứng: cùng khoá, write KHÔNG phải ghim ⇒ từ chối, không gửi
      const r = await gui(tx, ad, [{ tagKey: "a", value: 3 }], K, "set_param");
      expect(r.reason).toBe(MA_KHOA_DUNG_LAI);
      expect(d.soGhi).toBe(1);
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("D12 ý định treo không kết quả: CÙNG lệnh ⇒ DUPLICATE_IN_FLIGHT (T3F, cả ý định định dạng CŨ); ý định của lệnh KHÁC ⇒ IDEMPOTENCY_KEY_REUSED; STOP ⇒ gửi (dang_bay)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const writes = [{ tagKey: "t", value: 1 }];
      const K1 = khoaMoi();
      await chenHang(tx, { adapterId: ad, tagKey: "t", value: 1, status: "sent", ackValue: { ledger: "intent", bam: bamLenhOt({ commandType: "set_param", writes }) }, key: `intent:${perWriteKey(K1, "t", 0)}` });
      expect((await gui(tx, ad, writes, K1)).reason).toBe("DUPLICATE_IN_FLIGHT");
      const K2 = khoaMoi();
      await chenHang(tx, { adapterId: ad, tagKey: "t", value: 1, status: "sent", ackValue: { ledger: "intent" }, key: `intent:${K2}:t:0` });
      expect((await gui(tx, ad, writes, K2)).reason).toBe("DUPLICATE_IN_FLIGHT"); // ý định CŨ vẫn chặn gửi lại
      const K3 = khoaMoi();
      await chenHang(tx, { adapterId: ad, tagKey: "t", value: 9, status: "sent", ackValue: { ledger: "intent", bam: "lenh-khac" }, key: `intent:${perWriteKey(K3, "t", 0)}` });
      expect((await gui(tx, ad, writes, K3)).reason).toBe(MA_KHOA_DUNG_LAI);
      expect(d.soGhi).toBe(0);
      const K4 = khoaMoi();
      const stopW = [{ tagKey: "a", value: 0 }];
      await chenHang(tx, { adapterId: ad, tagKey: "a", value: 0, status: "sent", ackValue: { ledger: "intent", bam: bamLenhOt({ commandType: "stop", writes: stopW }) }, key: `intent:${perWriteKey(K4, "a", 0)}`, commandType: "stop" });
      const s = await gui(tx, ad, stopW, K4, "stop");
      expect(s.ok).toBe(true);
      expect(d.soGhi).toBe(1);
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, s.commandLogIds));
      expect((hang[0]!.ackValue as { lanTruoc?: { lyDo?: string } }).lanTruoc?.lyDo).toBe("dang_bay");
    });
    expect(H.bay).toBe(0);
  }, 30_000);

  it("★ D13 ĐUA: lệnh khác giành khoá GIỮA bước 2 và khoá tư vấn ⇒ lệnh thường bị từ chối trong giao dịch giữ chỗ (0 gói, duyệt KHÔNG bị tiêu); STOP vẫn gửi dưới khoá mới", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      const K = khoaMoi();
      H.giuaChung = async () => {
        await chenHang(tx, { adapterId: ad, tagKey: "t", value: 7, status: "acked", ackValue: { ledger: "result", bam: "lenh-khac" }, key: perWriteKey(K, "t", 0) });
      };
      const actionId = await taoHanhDong(tx, ad, [{ tagKey: "t", value: 1 }]);
      const r = await dispatch({ adapterId: ad, machineId: MACHINE, commandType: "set_param", writes: [{ tagKey: "t", value: 1 }], triggeredBy: { kind: "hitl", actionId, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }, idempotencyKey: K });
      expect(H.giuaChung).toBeNull(); // móc đã chạy (preflight nằm giữa hai lần đọc)
      expect(r.reason).toBe(MA_KHOA_DUNG_LAI);
      expect(d.soGhi).toBe(0);
      const [act] = await tx.select().from(aiPendingActions).where(inArray(aiPendingActions.id, [actionId]));
      expect(act!.status).toBe("confirmed"); // duyệt không bị tiêu cho lệnh không gửi

      const K2 = khoaMoi();
      H.giuaChung = async () => {
        await chenHang(tx, { adapterId: ad, tagKey: "t", value: 7, status: "acked", ackValue: { ledger: "result", bam: "lenh-khac" }, key: perWriteKey(K2, "t", 0) });
      };
      const s = await gui(tx, ad, [{ tagKey: "t", value: 0 }], K2, "stop"); // STOP không ghim (tag t) ⇒ preflight chạy ⇒ móc giành khoá
      expect(H.giuaChung).toBeNull();
      expect(s.ok).toBe(true);
      expect(d.soGhi).toBe(1);
      const hang = await tx.select().from(commandLog).where(inArray(commandLog.id, s.commandLogIds));
      expect((hang[0]!.ackValue as { lanTruoc?: { idempotencyKey?: string; lyDo?: string } }).lanTruoc).toMatchObject({ idempotencyKey: K2, lyDo: "khoa_lech" });
    });
    expect(H.bay).toBe(0);
  }, 30_000);
  it("D14 ý định khoá v2 treo, người vận hành GIẢI bằng hàm DB `ot_write_intent_resolve` (mig 0374) ⇒ kết quả mang ĐÚNG khoá v2 ⇒ gọi lại cùng lệnh được TRẢ LỜI từ kết quả ấy (timeout, 0 gói), không DUPLICATE_IN_FLIGHT", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      // bên gọi gửi "1.0"; sổ lưu giá trị ĐÃ ép kiểu 1 (bước 3b) ⇒ hàng kết quả do hàm DB chép (không băm) chỉ khớp được qua ý định gắn với nó
      const writes = [{ tagKey: "t", value: "1.0" }];
      const K = khoaMoi();
      const [yd] = await tx
        .insert(commandLog)
        .values({
          actionId: null,
          adapterId: ad,
          machineId: MACHINE,
          tagKey: "t",
          address: "40001",
          commandType: "set_param",
          requestedValue: 1 as never,
          requestedBy: OWNER,
          confirmedBy: OWNER,
          status: "sent",
          ackValue: { ledger: "intent", bam: bamLenhOt({ commandType: "set_param", writes }) } as never,
          idempotencyKey: `intent:${perWriteKey(K, "t", 0)}`,
          sentAt: new Date(),
          createdAt: new Date(Date.now() - 30 * 60_000),
        })
        .returning({ id: commandLog.id });
      const nguoi = (await tx.execute(sql`INSERT INTO public.users ("openId", role, "isActive") VALUES (${`${DAU}-op-${randomUUID().slice(0, 6)}`}, 'admin', true) RETURNING id`)) as unknown as Array<{ id: number }>;
      await tx.execute(sql`SELECT public.ot_write_intent_resolve(${yd!.id}, ${nguoi[0]!.id}, ${"tien trinh sap giua ghi va so"})`);
      const [kq] = await tx.select().from(commandLog).where(inArray(commandLog.idempotencyKey, [perWriteKey(K, "t", 0)]));
      expect(kq).toMatchObject({ status: "timeout" }); // hàm DB suy khoá kết quả = substr(khoá ý định, 8) = khoá v2
      const r = await gui(tx, ad, writes, K);
      expect(r).toMatchObject({ ok: false, status: "timeout" });
      expect(r.reason).not.toBe("DUPLICATE_IN_FLIGHT");
      expect(d.soGhi).toBe(0);
      // lệnh KHÁC cùng khoá vẫn bị từ chối (không lấy kết quả đã giải của lệnh kia)
      expect((await gui(tx, ad, [{ tagKey: "t", value: 2 }], K)).reason).toBe(MA_KHOA_DUNG_LAI);
    });
    expect(H.bay).toBe(0);
  }, 30_000);
  it("D15 lệnh KHÔNG có write bị từ chối (hàng sổ tagKey null dưới khoá `_`): gọi lại cùng khoá ⇒ phát lại đúng lời từ chối cũ, không ném (không vỡ UNIQUE)", async () => {
    await trongGiaoDich(async (tx) => {
      const d = driverGia();
      const ad = await taoAdapter(tx, d);
      await tx.update(deviceAdapters).set({ isEnabled: false }).where(inArray(deviceAdapters.id, [ad])); // ⇒ ADAPTER_DISABLED (writeAll: một hàng tagKey null)
      const K = khoaMoi();
      const r1 = await gui(tx, ad, [], K);
      expect(r1).toMatchObject({ ok: false, reason: "ADAPTER_DISABLED" });
      const r2 = await gui(tx, ad, [], K);
      expect(chieu(r2)).toEqual(chieu(r1));
      expect(r2.commandLogIds).toEqual(r1.commandLogIds);
      expect(d.soGhi).toBe(0);
    });
    expect(H.bay).toBe(0);
  }, 30_000);
});

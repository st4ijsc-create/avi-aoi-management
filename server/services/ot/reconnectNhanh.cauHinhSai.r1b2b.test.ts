/**
 * SCADA R1b-2b-1 Task 5 (mục 51, T13 m4) — tag sai cấu hình CỤC BỘ (driver KHÔNG gửi yêu cầu nào cho nó) là mẫu TRUNG TÍNH: không nói
 * gì về liên lạc — không "đã trả lời", không "chưa trả lời". Phiên mà MỌI tag trung tính ⇒ không đọc tốt (không `connected`), không hỏng
 * (không D1, không vòng nối lại) ⇒ ở `connecting` kèm lý do `moi_tag_sai_cau_hinh` (điều kiện 5 của điều phối, phán quyết C5).
 *
 * K13 giữ: config_error mà THIẾT BỊ trả (Modbus exception, SLMP end code) là ĐÃ trả lời; MC `device_error` không trung tính.
 * Lớp driver: S7 / MC THẬT (package giả như chatLuong.drivers.test.ts) + vòng poll chung THẬT ⇒ tick mang `statusCode` của mẫu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtSample, OtTagAddress, SuKienDoc } from "./otDriver";
import {
  laDocTot,
  laMauTrungTinh,
  laTickHong,
  MA_CAU_HINH_KHONG_GUI,
  mauMayChuDaTraLoi,
  SO_TICK_HONG_DE_MAT,
  taoBatDocTot,
  taoDemTickHong,
} from "./reconnectNhanh";

const tt = (k: string) => ({ tagKey: k, quality: "bad" as const, reason: "config_error" as const, statusCode: "invalid_address" });

describe("R1b-2b-1 T5 — luật mẫu trung tính (thuần)", () => {
  it("bộ mã đúng như hợp đồng", () => {
    expect([...MA_CAU_HINH_KHONG_GUI].sort()).toEqual(["BadNodeIdInvalid (0x80330000)", "invalid_address"]);
  });

  it("mọi tag sai địa chỉ cục bộ ⇒ không đọc tốt, không hỏng", () => {
    const e = { ok: true, timeout: false, ms: 1, tags: [tt("a"), tt("b")] };
    expect(laDocTot(e)).toBe(false);
    expect(laTickHong(e)).toBe(false);
  });

  it("một tag tốt + một sai cục bộ ⇒ đọc tốt; một comm_lost + một sai cục bộ ⇒ hỏng", () => {
    expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "good" as const }] })).toBe(true);
    expect(laTickHong({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "bad" as const, reason: "comm_lost" as const }] })).toBe(true);
  });

  it("config_error do thiết bị trả (slmp_end_0xC051) vẫn là đã trả lời", () => {
    expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [{ tagKey: "a", quality: "bad", reason: "config_error", statusCode: "slmp_end_0xc051" }] })).toBe(true);
  });

  it("OPC UA cú pháp sai (BadNodeIdInvalid gõ tay ở driver) mọi tag ⇒ không đọc tốt, không hỏng", () => {
    const e: SuKienDoc = {
      ok: true,
      timeout: false,
      ms: 1,
      tags: ["a", "b"].map((k) => ({ tagKey: k, quality: "bad" as const, reason: "config_error" as const, statusCode: "BadNodeIdInvalid (0x80330000)" })),
    };
    expect(laDocTot(e)).toBe(false);
    expect(laTickHong(e)).toBe(false);
  });

  it.each([
    ["Modbus exception 2 (thiết bị trả)", { quality: "bad", reason: "config_error", statusCode: "modbus_exception_2" }],
    ["SLMP end code địa chỉ (thiết bị trả)", { quality: "bad", reason: "config_error", statusCode: "slmp_end_0xc056" }],
    ["OPC UA BadNodeIdUnknown (máy chủ trả / nsu không có)", { quality: "bad", reason: "config_error", statusCode: "BadNodeIdUnknown (0x80340000)" }],
    ["MC device_error", { quality: "bad", reason: "device_error", statusCode: "invalid_address" }],
    ["config_error không mã", { quality: "bad", reason: "config_error" }],
    ["uncertain mang mã cục bộ", { quality: "uncertain", reason: "config_error", statusCode: "invalid_address" }],
  ] as const)("KHÔNG trung tính: %s", (_n, s) => {
    expect(laMauTrungTinh(s)).toBe(false);
    expect(mauMayChuDaTraLoi(s)).toBe(true);
    expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [{ tagKey: "a", ...s }] })).toBe(true);
  });

  it("tick ok:false (lỗi cả lần đọc) không đổi nghĩa; tick tags rỗng không đổi nghĩa", () => {
    expect(laTickHong({ ok: false, timeout: true, ms: 1, tags: [] })).toBe(true);
    expect(laDocTot({ ok: true, timeout: false, ms: 1, tags: [] })).toBe(true);
    expect(laTickHong({ ok: true, timeout: false, ms: 1, tags: [] })).toBe(false);
  });

  it("bộ đếm D1: 5 tick mọi-tag-trung-tính liên tiếp KHÔNG bắn (không vòng nối lại)", () => {
    const khiDat = vi.fn();
    const dem = taoDemTickHong(SO_TICK_HONG_DE_MAT, khiDat);
    const trungTinh: SuKienDoc = { ok: true, timeout: false, ms: 1, tags: [tt("a"), tt("b")] };
    for (let i = 0; i < 5; i++) dem(trungTinh);
    expect(khiDat).not.toHaveBeenCalled();
  });

  it("taoBatDocTot: tick mọi-tag-trung-tính ⇒ KHÔNG đọc tốt, báo lý do (true); tick tốt sau đó ⇒ đọc tốt, không báo lý do nữa", () => {
    const docTot = vi.fn();
    const trungTinh = vi.fn();
    const b = taoBatDocTot(docTot, trungTinh);
    b.quaTick({ ok: true, timeout: false, ms: 1, tags: [tt("a"), tt("b")] });
    expect(docTot).not.toHaveBeenCalled();
    expect(trungTinh.mock.calls).toEqual([[true]]);
    b.quaTick({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "good" }] });
    expect(docTot).toHaveBeenCalledTimes(1);
    b.quaTick({ ok: true, timeout: false, ms: 1, tags: [tt("a"), tt("b")] });
    expect(trungTinh.mock.calls).toEqual([[true]]);
  });

  it("taoBatDocTot (push): mẫu trung tính ⇒ KHÔNG đọc tốt, báo lý do (true); mẫu đã trả lời ⇒ đọc tốt; mẫu trung tính sau đó không báo lại", () => {
    const docTot = vi.fn();
    const trungTinh = vi.fn();
    const b = taoBatDocTot(docTot, trungTinh);
    b.quaMau({ quality: "bad", reason: "config_error", statusCode: "BadNodeIdInvalid (0x80330000)" });
    expect(docTot).not.toHaveBeenCalled();
    expect(trungTinh.mock.calls).toEqual([[true]]);
    b.quaMau({ quality: "good" });
    expect(docTot).toHaveBeenCalledTimes(1);
    b.quaMau({ quality: "bad", reason: "config_error", statusCode: "invalid_address" });
    expect(trungTinh.mock.calls).toEqual([[true]]);
  });

  it("taoBatDocTot (push): đã thấy mẫu CHƯA trả lời ⇒ lý do bị gỡ (false) và mẫu trung tính sau đó không gắn lại", () => {
    const docTot = vi.fn();
    const trungTinh = vi.fn();
    const b = taoBatDocTot(docTot, trungTinh);
    b.quaMau({ quality: "bad", reason: "config_error", statusCode: "invalid_address" });
    b.quaMau({ quality: "bad" }); // chưa trả lời (item err): lý do "sai cấu hình" sẽ che mất việc mất liên lạc
    b.quaMau({ quality: "bad", reason: "config_error", statusCode: "invalid_address" });
    expect(trungTinh.mock.calls).toEqual([[true], [false]]);
    expect(docTot).not.toHaveBeenCalled();
  });

  it("taoBatDocTot (poll): mẫu trung tính của lần đọc về trước tick; tick hỏng (comm_lost + trung tính) ⇒ lý do gỡ (false); ingest treo không kèm lần đọc ⇒ im", () => {
    const trungTinh = vi.fn();
    const b = taoBatDocTot(vi.fn(), trungTinh);
    b.quaMau({ quality: "bad", reason: "config_error", statusCode: "invalid_address" });
    b.quaTick({ ok: true, timeout: false, ms: 1, tags: [tt("a"), { tagKey: "b", quality: "bad", reason: "comm_lost" }] });
    b.quaTick({ ok: false, timeout: true, ms: 1, tags: [], lyDo: "ingest_treo" });
    expect(trungTinh.mock.calls).toEqual([[true], [false]]);
    b.quaTick({ ok: false, timeout: true, ms: 1, tags: [] });
    expect(trungTinh.mock.calls).toEqual([[true], [false], [false]]);
  });
});

// ─────────────────────────────── driver THẬT + vòng poll chung THẬT ───────────────────────────────
const FLAG = "OT_CHAT_LUONG_V2_ENABLED";

async function waitFor(cond: () => boolean, maxMs: number, stepMs = 10): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > maxMs) throw new Error(`waitFor quá hạn ${maxMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function mockNodes(lib: "nodes7" | "mcprotocol") {
  const conn: Record<string, unknown> = {
    initiateConnection: vi.fn((_o: unknown, cb: (err?: unknown) => void) => cb()),
    setTranslationCB: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(false, {})),
    writeItems: vi.fn(),
    dropConnection: vi.fn((cb: () => void) => cb()),
    isoConnectionState: 4,
  };
  function Lib(this: Record<string, unknown>) {
    Object.assign(this, conn);
  }
  vi.doMock(lib, () => ({ default: Lib }));
  return conn;
}

describe("R1b-2b-1 T5 — driver thật: mọi địa chỉ sai (cờ V2 bật) ⇒ tick mang statusCode, không đọc tốt, không hỏng, không gửi yêu cầu", () => {
  const dong: Array<() => Promise<unknown>> = [];
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(async () => {
    while (dong.length) await dong.pop()!().catch(() => undefined);
    vi.unstubAllEnvs();
    vi.doUnmock("nodes7");
    vi.doUnmock("mcprotocol");
  });

  it.each([
    ["S7", "nodes7", "./drivers/s7Driver", "S7Driver", [{ tagKey: "a", address: "XYZ", dataType: "float" }, { tagKey: "b", address: "QQQ", dataType: "float" }]],
    ["MC", "mcprotocol", "./drivers/mitsubishiMcDriver", "MitsubishiMcDriver", [{ tagKey: "a", address: "ZZZ", dataType: "int" }, { tagKey: "b", address: "YYY", dataType: "int" }]],
  ] as const)("%s", async (_n, lib, mod, cls, tags) => {
    vi.stubEnv(FLAG, "true");
    const conn = mockNodes(lib);
    const m = (await import(mod)) as Record<string, new () => { connect(c: unknown): Promise<void>; subscribe: (...a: unknown[]) => Promise<{ close(): Promise<void> }> }>;
    const d = new m[cls]();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const ticks: SuKienDoc[] = [];
    const mau: OtSample[] = [];
    const docTot = vi.fn();
    const trungTinh = vi.fn();
    const d1 = vi.fn();
    const bat = taoBatDocTot(docTot, trungTinh);
    const dem = taoDemTickHong(SO_TICK_HONG_DE_MAT, d1);
    const h = await d.subscribe(
      tags as unknown as OtTagAddress[],
      (s: OtSample) => {
        mau.push(s);
        bat.quaMau(s);
      },
      20,
      {
        onTick: (e: SuKienDoc) => {
          ticks.push(e);
          bat.quaTick(e);
          dem(e);
        },
      },
    );
    dong.push(() => h.close());
    await waitFor(() => ticks.length >= 3, 3000);
    await h.close();
    for (const e of ticks) {
      expect(e.ok).toBe(true);
      expect(e.tags).toEqual(tags.map((t) => ({ tagKey: t.tagKey, quality: "bad", reason: "config_error", statusCode: "invalid_address" })));
      expect(laDocTot(e)).toBe(false);
      expect(laTickHong(e)).toBe(false);
    }
    expect(docTot).not.toHaveBeenCalled();
    expect(d1).not.toHaveBeenCalled();
    expect(trungTinh).toHaveBeenCalledWith(true);
    expect(trungTinh).not.toHaveBeenCalledWith(false);
    expect(conn.readAllItems).not.toHaveBeenCalled(); // KHÔNG gửi yêu cầu nào: thiết bị chưa hề được hỏi
    expect(mau.every((s) => laMauTrungTinh(s))).toBe(true);
  });
});

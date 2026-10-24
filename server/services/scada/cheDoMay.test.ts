/**
 * SCADA R1a Task 4 (K2/D3) — chế độ máy LOCAL/REMOTE từ kênh chế độ đã khai + bộ đệm giá trị hiện tại.
 * Bộ đệm (`layGiaTri`, `boDemDangBat`) và CSDL (`getDb`) được mock: một db giả trả hàng `scada_kenh_che_do` (+ dataType của tag)
 * theo machineId, hoặc ném lỗi. Mỗi `lyDo` một ca; fail-closed (lỗi DB / db null ⇒ LOCAL `loi_doc`, không ném).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GiaTriCoTuoi } from "./boDemHienTai";

const m = vi.hoisted(() => ({
  layGiaTri: vi.fn(),
  boDemDangBat: vi.fn(),
  /** machineId → hàng kênh chế độ (null = chưa khai); "throw" ⇒ truy vấn ném. */
  hang: new Map<number, { adapterId: number; tagKey: string; giaTriRemote: unknown; dataType: string | null; adapterMachineId: number | null; adapterEnabled: boolean | null } | "throw">(),
  dbNull: false,
  soTruyVan: 0,
  machineIdHoi: [] as unknown[],
}));

vi.mock("./boDemHienTai", () => ({
  layGiaTri: (...a: unknown[]) => m.layGiaTri(...a),
  boDemDangBat: () => m.boDemDangBat(),
}));

vi.mock("../../db/connection", () => ({
  getDb: async () => {
    if (m.dbNull) return null;
    // Chuỗi drizzle tối thiểu: select().from().leftJoin().where(eq(machineId, X)).limit(1) — X lấy từ tham số của `where`.
    let mid: number | undefined;
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.from = () => chain;
    chain.leftJoin = () => chain;
    chain.where = (cond: unknown) => {
      mid = timSoTrongDieuKien(cond);
      return chain;
    };
    chain.limit = async () => {
      m.soTruyVan++;
      m.machineIdHoi.push(mid);
      const h = mid === undefined ? undefined : m.hang.get(mid);
      if (h === "throw") throw new Error("connection reset");
      return h ? [h] : [];
    };
    return chain;
  },
}));

/** Tìm giá trị tham số (số) trong SQL drizzle `eq(col, X)` — duyệt queryChunks. */
function timSoTrongDieuKien(cond: unknown): number | undefined {
  const seen = new Set<unknown>();
  const di = (x: unknown): number | undefined => {
    if (x === null || typeof x !== "object" || seen.has(x)) return undefined;
    seen.add(x);
    const o = x as Record<string, unknown>;
    if ("value" in o && typeof o.value === "number" && "encoder" in o) return o.value;
    for (const k of ["queryChunks", "value"]) {
      const c = o[k];
      if (Array.isArray(c)) for (const e of c) {
        const r = di(e);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  };
  return di(cond);
}

import { cheDoMay, congCheDoBat, TOOL_HMI_GHI_TAG } from "./cheDoMay";

const MAY = 4101;
const AD = 77;
const NOW = 1_800_000_000_000;

function gt(over: Partial<GiaTriCoTuoi> = {}): GiaTriCoTuoi {
  return {
    adapterId: AD,
    tagKey: "che_do",
    machineId: MAY,
    v: 2,
    q: "good",
    statusCode: null,
    reason: null,
    ts: NOW - 100,
    tsSource: null,
    rx: NOW - 100,
    lichSu: [],
    lichSuRx: [],
    ageMs: 100,
    stale: false,
    ...over,
  };
}

/** Hàng kênh chế độ của MAY: adapter AD còn thuộc MAY và đang bật trừ khi nói khác. */
function hangKenh(over: Partial<{ giaTriRemote: unknown; dataType: string | null; adapterMachineId: number | null; adapterEnabled: boolean | null }> = {}) {
  return { adapterId: AD, tagKey: "che_do", giaTriRemote: 2, dataType: "int" as string | null, adapterMachineId: MAY as number | null, adapterEnabled: true as boolean | null, ...over };
}

const savedFlag = process.env.SCADA_CONG_CHE_DO_ENABLED;

beforeEach(() => {
  m.layGiaTri.mockReset();
  m.boDemDangBat.mockReset();
  m.hang.clear();
  m.dbNull = false;
  m.soTruyVan = 0;
  m.machineIdHoi = [];
  m.boDemDangBat.mockReturnValue(true);
  m.layGiaTri.mockReturnValue(gt());
  m.hang.set(MAY, hangKenh());
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.SCADA_CONG_CHE_DO_ENABLED;
  else process.env.SCADA_CONG_CHE_DO_ENABLED = savedFlag;
});

describe("cheDoMay — mỗi lyDo một ca", () => {
  it("remote: đã khai + bộ đệm bật + có mẫu + good + tươi + v = gia_tri_remote ⇒ REMOTE, mang kênh", async () => {
    const r = await cheDoMay(MAY, NOW);
    expect(r).toEqual({ cheDo: "REMOTE", lyDo: "remote", kenh: { adapterId: AD, tagKey: "che_do" } });
    expect(m.layGiaTri).toHaveBeenCalledWith(AD, "che_do", NOW);
    expect(m.machineIdHoi).toEqual([MAY]);
  });

  it("chua_khai: máy không có hàng scada_kenh_che_do ⇒ LOCAL, không đọc bộ đệm", async () => {
    m.hang.clear();
    const r = await cheDoMay(MAY, NOW);
    expect(r).toEqual({ cheDo: "LOCAL", lyDo: "chua_khai" });
    expect(m.layGiaTri).not.toHaveBeenCalled();
  });

  it("bo_dem_tat: SCADA_LIVE_CACHE tắt ⇒ LOCAL (kênh đã khai vẫn được báo)", async () => {
    m.boDemDangBat.mockReturnValue(false);
    const r = await cheDoMay(MAY, NOW);
    expect(r).toEqual({ cheDo: "LOCAL", lyDo: "bo_dem_tat", kenh: { adapterId: AD, tagKey: "che_do" } });
  });

  it("chua_co_mau: bộ đệm chưa có mục cho (adapter, tag) ⇒ LOCAL", async () => {
    m.layGiaTri.mockReturnValue(null);
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("chua_co_mau");
  });

  it("chat_luong_xau: q='uncertain' (dù v đúng giá trị REMOTE và còn tươi) ⇒ LOCAL", async () => {
    m.layGiaTri.mockReturnValue(gt({ q: "uncertain" }));
    const r = await cheDoMay(MAY, NOW);
    expect(r.cheDo).toBe("LOCAL");
    expect(r.lyDo).toBe("chat_luong_xau");
  });

  it("chat_luong_xau: q='bad' ⇒ LOCAL", async () => {
    m.layGiaTri.mockReturnValue(gt({ q: "bad" }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("chat_luong_xau");
  });

  it("cu: mẫu good đúng giá trị nhưng stale ⇒ LOCAL", async () => {
    m.layGiaTri.mockReturnValue(gt({ stale: true, ageMs: 999_999 }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("cu");
  });

  it("khac_remote: mẫu good tươi nhưng v ≠ gia_tri_remote ⇒ LOCAL", async () => {
    m.layGiaTri.mockReturnValue(gt({ v: 1 }));
    const r = await cheDoMay(MAY, NOW);
    expect(r).toEqual({ cheDo: "LOCAL", lyDo: "khac_remote", kenh: { adapterId: AD, tagKey: "che_do" } });
  });
});

describe("cheDoMay — I-1: adapter của kênh phải còn thuộc máy và đang bật", () => {
  it("adapter của kênh đã CHUYỂN sang máy khác ⇒ LOCAL kenh_sai_may (không đọc bộ đệm — bộ chọn đó của máy khác)", async () => {
    m.hang.set(MAY, hangKenh({ adapterMachineId: MAY + 1 }));
    expect(await cheDoMay(MAY, NOW)).toEqual({ cheDo: "LOCAL", lyDo: "kenh_sai_may", kenh: { adapterId: AD, tagKey: "che_do" } });
    expect(m.layGiaTri).not.toHaveBeenCalled();
  });

  it("adapter của kênh bị GỠ khỏi máy (machineId null) / không còn (LEFT JOIN null) ⇒ kenh_sai_may", async () => {
    m.hang.set(MAY, hangKenh({ adapterMachineId: null }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("kenh_sai_may");
    m.hang.set(MAY, hangKenh({ adapterMachineId: null, adapterEnabled: null }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("kenh_sai_may");
  });

  it("adapter của kênh bị TẮT ⇒ kenh_sai_may", async () => {
    m.hang.set(MAY, hangKenh({ adapterEnabled: false }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("kenh_sai_may");
  });

  it("đối chiếu bộ đệm: mục bộ đệm thuộc máy khác (đăng ký OT chưa theo kịp) ⇒ kenh_sai_may dù giá trị đúng REMOTE", async () => {
    m.layGiaTri.mockReturnValue(gt({ machineId: MAY + 1 }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("kenh_sai_may");
    m.layGiaTri.mockReturnValue(gt({ machineId: null }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("kenh_sai_may");
  });
});

describe("cheDoMay — ép kiểu theo dataType của tag chế độ, so canonical", () => {
  it('int: bộ đệm "2" (chuỗi) vs gia_tri_remote 2 ⇒ REMOTE', async () => {
    m.layGiaTri.mockReturnValue(gt({ v: "2" }));
    expect((await cheDoMay(MAY, NOW)).cheDo).toBe("REMOTE");
  });

  it("bool: bộ đệm 1 vs gia_tri_remote true ⇒ REMOTE; bộ đệm 0 ⇒ khac_remote", async () => {
    m.hang.set(MAY, hangKenh({ giaTriRemote: true, dataType: "bool" }));
    m.layGiaTri.mockReturnValue(gt({ v: 1 }));
    expect((await cheDoMay(MAY, NOW)).cheDo).toBe("REMOTE");
    m.layGiaTri.mockReturnValue(gt({ v: 0 }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("khac_remote");
  });

  it("tag chế độ không còn (dataType null) ⇒ so canonical thô: 2 = 2 REMOTE, \"2\" ≠ 2 khac_remote", async () => {
    m.hang.set(MAY, hangKenh({ dataType: null }));
    m.layGiaTri.mockReturnValue(gt({ v: 2 }));
    expect((await cheDoMay(MAY, NOW)).cheDo).toBe("REMOTE");
    m.layGiaTri.mockReturnValue(gt({ v: "2" }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("khac_remote");
  });

  it("v null (mẫu good không mang giá trị) không bao giờ là REMOTE, kể cả gia_tri_remote = null", async () => {
    m.hang.set(MAY, hangKenh({ giaTriRemote: null, dataType: "json" }));
    m.layGiaTri.mockReturnValue(gt({ v: null }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("khac_remote");
  });

  it("ép kiểu thất bại (\"abc\" cho int) ⇒ khac_remote", async () => {
    m.layGiaTri.mockReturnValue(gt({ v: "abc" }));
    expect((await cheDoMay(MAY, NOW)).lyDo).toBe("khac_remote");
  });
});

describe("cheDoMay — fail-closed, không ném", () => {
  it("machineId null ⇒ LOCAL chua_khai, KHÔNG truy vấn", async () => {
    expect(await cheDoMay(null, NOW)).toEqual({ cheDo: "LOCAL", lyDo: "chua_khai" });
    expect(m.soTruyVan).toBe(0);
  });

  it("truy vấn ném lỗi ⇒ LOCAL loi_doc (không ném ra ngoài)", async () => {
    m.hang.set(MAY, "throw");
    const err = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(cheDoMay(MAY, NOW)).resolves.toEqual({ cheDo: "LOCAL", lyDo: "loi_doc" });
    err.mockRestore();
  });

  it("getDb() null ⇒ LOCAL loi_doc", async () => {
    m.dbNull = true;
    await expect(cheDoMay(MAY, NOW)).resolves.toEqual({ cheDo: "LOCAL", lyDo: "loi_doc" });
  });

  it("layGiaTri ném ⇒ LOCAL loi_doc (không ném ra ngoài)", async () => {
    m.layGiaTri.mockImplementation(() => {
      throw new Error("boom");
    });
    const err = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await cheDoMay(MAY, NOW);
    err.mockRestore();
    expect(r).toEqual({ cheDo: "LOCAL", lyDo: "loi_doc", kenh: { adapterId: AD, tagKey: "che_do" } });
  });

  it("MỘT truy vấn mỗi lần gọi (không cache: lần gọi thứ hai truy vấn lại)", async () => {
    await cheDoMay(MAY, NOW);
    await cheDoMay(MAY, NOW);
    expect(m.soTruyVan).toBe(2);
  });
});

describe("congCheDoBat / hằng tool HMI", () => {
  it("chỉ 'true' mới bật", () => {
    delete process.env.SCADA_CONG_CHE_DO_ENABLED;
    expect(congCheDoBat()).toBe(false);
    process.env.SCADA_CONG_CHE_DO_ENABLED = "1";
    expect(congCheDoBat()).toBe(false);
    process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
    expect(congCheDoBat()).toBe(true);
  });

  it("tool HMI = 'hmi.write_tag'", () => {
    expect(TOOL_HMI_GHI_TAG).toBe("hmi.write_tag");
  });
});

/**
 * ★★★ Pha 3 Task 4 (§6) — **NHẬN NUÔI GIẤY PHÉP MỒ CÔI + DỌN HÀNG CỦA TIẾN TRÌNH ĐÃ CHẾT.**
 *
 * BA DÂN SỐ, MỘT MỐI (xem docstring `vramAdoption.ts`):
 *   1. hàng MA của tiến trình đã chết (`kill -9` ⇒ hàng ở lại `vram_leases` VĨNH VIỄN — nợ Task 2);
 *   2. hàng `vram:baseline` của tiến trình đã chết (nằm lại tới 180 s — nợ Task 3);
 *   3. sidecar 7,8 GB sống sót qua một lượt khởi động lại ⇒ **sổ mất, thực tế còn** (§6).
 *
 * ⚠⚠ KHUÔN CỦA BỘ CA — **LƯỚI ĐI THEO ĐƯỜNG THOÁT, KHÔNG THEO FILE** (ràng buộc 10, đã tái diễn
 * MƯỜI MỘT lần). Nhóm D dựng HAI TIẾN TRÌNH THẬT trên MỘT bảng `vram_leases` giả, cho nhịp
 * `__runReconcileTick()` chạy đường thật, rồi đọc **đúng object mã sản xuất gửi đi**
 * (`snapshot().leases`, các lô ghi mà `gw.apply()` nhận, `VramReconcileResult`). Không ca nào tự
 * đặt `foreignBytes`, tự dựng giấy phép, hay tự khai một lô ghi.
 *
 * ⚠ FIXTURE PHẢI KHÁC NHAU **ĐÚNG Ở CHIỀU ĐANG KIỂM** (bài học I-2 của Task 2: hai đột biến sống
 * sót 590/590 vì cả năm cặp fixture đều khác VAI TRÒ ⇒ `role` vô tình phân biệt thay `processKey`).
 * Chiều đang kiểm ở đây là **`bootMs`**, nên nhóm A có các cặp **CÙNG VAI, CÙNG PID, KHÁC `bootMs`**.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;
/** Ràng buộc 7 — fixture đủ lớn để phân biệt. */
const KHOI_17K = 17_000 * MIB;
const DESKTOP = 1_000 * MIB;
const CEILING = 32_607 * MIB;
const BIN = "D:\\SOURCES\\16.AI\\llama-cuda\\llama-server.exe";
const CONG = 8081;

let thietBiUsedBytes = DESKTOP;

vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => ({ usedBytes: thietBiUsedBytes, totalBytes: CEILING, source: "smi" as const }),
  __clearProbeCache: () => {},
}));

type Holder = { pid: number; name: string };
type Proc = { pid: number; ppid: number; cmdline: string; ctime: number };

let hoGiuGpu: {
  holders: Holder[]; ours: Holder[]; peers: Holder[]; orphans: Holder[]; thirdParty: Holder[];
} | null = null;
/** Bảng tiến trình mà `readProcTable()` trả về. `null` = KHÔNG ĐỌC ĐƯỢC (không có bằng chứng). */
let bangTienTrinh: Proc[] | null = null;

vi.mock("./vramGpuHolders", () => ({
  readGpuHolders: async () => hoGiuGpu,
  readProcTable: async () => bangTienTrinh,
}));

import { __resetBrokerForTests, snapshot } from "./vramBroker";
import {
  SHARED_BASELINE_KEY, __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests,
  readSharedLedgerReplica,
} from "./vramSharedLedger";
import type { SharedLeaseRow, SharedLedgerWrite } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import {
  __resetVramBaselineForTests, __runReconcileTick, captureVramBaseline, reconcileOnce,
} from "./vramReconciler";
import { __resetDecisionTickForTests } from "./vramTickCell";
import {
  lapKeHoachNhanNuoi, moTaSidecarNhanNuoi, ownerNhanNuoi, pidTuOwnerNhanNuoi, trangThaiTienTrinh,
} from "./vramAdoption";

/** Bảng `vram_leases` GIẢ — MỘT bảng, NHIỀU tiến trình. Ghi lại MỌI lô để đọc đúng thứ đã gửi. */
class BangDungChung implements SharedLedgerGateway {
  rows = new Map<string, SharedLeaseRow>();
  loDaGui: SharedLedgerWrite[][] = [];
  async apply(writes: readonly SharedLedgerWrite[]): Promise<void> {
    this.loDaGui.push([...writes]);
    for (const w of writes) {
      if (w.op === "upsert") this.rows.set(w.leaseKey, w.row);
      else this.rows.delete(w.leaseKey);
    }
  }
  async selectAll(): Promise<readonly SharedLeaseRow[]> {
    return [...this.rows.values()];
  }
  /** Mọi lệnh XOÁ đã THẬT SỰ đi qua cổng — không phải một con số do ca test tự khai. */
  khoaDaXoa(): string[] {
    return this.loDaGui.flat().flatMap((w) => (w.op === "delete" ? [w.leaseKey] : []));
  }
}

let bang: BangDungChung;

const DESK: Holder[] = [{ pid: 7824, name: "C:\\Windows\\explorer.exe" }];
/** Sidecar 7,8 GB sống sót qua lượt khởi động lại — hộ lớn nhất hệ, đúng dân số §6. */
const SIDECAR: Holder = { pid: 31337, name: BIN };

function census(p: Partial<Record<"ours" | "peers" | "orphans" | "thirdParty", Holder[]>>) {
  const ours = p.ours ?? [];
  const peers = p.peers ?? [];
  const orphans = p.orphans ?? [];
  const thirdParty = p.thirdParty ?? DESK;
  return { holders: [...ours, ...peers, ...orphans, ...thirdParty], ours, peers, orphans, thirdParty };
}

/** FILETIME UTC (100 ns từ 1601) của một mốc Unix ms — đúng thứ `Win32_Process.CreationDate` cho. */
function ft(unixMs: number): number {
  return (unixMs + 11_644_473_600_000) * 10_000;
}

function chuyenTienTrinh(selfKey: string): void {
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(bang);
  __setSharedLedgerSelfKeyForTests(selfKey);
}

function hangGiaySo(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "worker:900:1000#lease-1",
    processKey: "worker:900:1000",
    pid: 900,
    role: "worker",
    leaseId: "lease-1",
    owner: "gguf:30B",
    leaseKind: "gguf-model",
    priority: "interactive",
    bytes: KHOI_17K,
    measured: true,
    refCount: 1,
    reclaimer: null,
    acquiredAtMs: 1000,
    updatedAtMs: 1000,
    ...over,
  };
}

beforeEach(() => {
  bang = new BangDungChung();
  thietBiUsedBytes = DESKTOP;
  hoGiuGpu = census({});
  bangTienTrinh = null;
  process.env.LLAMA_SERVER_BIN = BIN;
  process.env.LLAMA_VISION_PORT = String(CONG);
  process.env.VRAM_SIDECAR_ESTIMATE_MB = String(17_000);
  chuyenTienTrinh("worker:1001:5000");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  delete process.env.VRAM_SIDECAR_ESTIMATE_MB;
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("A. VỊ TỪ 'CÒN SỐNG' — `bootMs` là ĐIỀU KIỆN, không phải trang trí", () => {
  it("A-1: pid có trong bảng và SINH TRƯỚC mốc `bootMs` ⇒ SỐNG", () => {
    const procs: Proc[] = [{ pid: 900, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(4_000) }];
    expect(trangThaiTienTrinh("worker:900:5000", procs)).toBe("song");
  });

  it("A-2: pid VẮNG khỏi bảng tiến trình ⇒ ĐÃ CHẾT", () => {
    const procs: Proc[] = [{ pid: 111, ppid: 1, cmdline: "node dist/index.js", ctime: ft(1) }];
    expect(trangThaiTienTrinh("worker:900:5000", procs)).toBe("chet");
  });

  /**
   * ★★★ CA CHỊU LỰC — **HĐH CẤP LẠI PID.** Đột biến *"lọc bằng `pid`, bỏ `bootMs`"* đã SỐNG SÓT
   * 590/590 ở Task 2. Ở đây `pid` giống hệt nhau và **chỉ `bootMs` phân biệt được**: tiến trình
   * đang mang pid 900 SINH LÚC 9.000 — tức SAU khi người viết hàng đóng dấu `bootMs = 5000` —
   * nên nó là một tiến trình KHÁC, và hàng kia là hàng MA.
   */
  it("★★★ A-3: pid CÒN nhưng tiến trình SINH SAU `bootMs` (PID CẤP LẠI) ⇒ ĐÃ CHẾT", () => {
    const procs: Proc[] = [{ pid: 900, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(9_000) }];
    expect(trangThaiTienTrinh("worker:900:5000", procs)).toBe("chet");
  });

  /**
   * ★★★ CÙNG VAI, CÙNG PID, KHÁC `bootMs` — fixture khác nhau ĐÚNG Ở CHIỀU ĐANG KIỂM. Một lượt
   * lọc bằng `role` hay bằng `pid` cho HAI processKey này **cùng một câu trả lời**; chỉ `bootMs`
   * tách được chúng.
   */
  it("★★★ A-4: hai processKey CÙNG VAI + CÙNG PID, chỉ khác `bootMs` ⇒ một SỐNG, một CHẾT", () => {
    const procs: Proc[] = [{ pid: 900, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(7_000) }];
    expect(trangThaiTienTrinh("worker:900:8000", procs), "bootMs SAU lúc sinh ⇒ chính nó").toBe("song");
    expect(trangThaiTienTrinh("worker:900:6000", procs), "bootMs TRƯỚC lúc sinh ⇒ kẻ đã chết").toBe("chet");
  });

  it("A-5: `ctime` = 0 (không đủ quyền đọc) ⇒ KHÔNG BIẾT — tuyệt đối không kết luận đã chết", () => {
    const procs: Proc[] = [{ pid: 900, ppid: 1, cmdline: "", ctime: 0 }];
    expect(trangThaiTienTrinh("worker:900:5000", procs)).toBe("khong-biet");
  });

  it("A-6: KHÔNG đọc được bảng tiến trình (`null`) ⇒ KHÔNG BIẾT", () => {
    expect(trangThaiTienTrinh("worker:900:5000", null)).toBe("khong-biet");
  });

  it("A-7: `processKey` méo (thiếu `bootMs` / bootMs không phải số) ⇒ KHÔNG BIẾT", () => {
    const procs: Proc[] = [{ pid: 900, ppid: 1, cmdline: "x", ctime: ft(1) }];
    expect(trangThaiTienTrinh("worker:900", procs)).toBe("khong-biet");
    expect(trangThaiTienTrinh("worker:900:boot-a", procs)).toBe("khong-biet");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("B. HÀNG MA — dọn hàng của tiến trình đã chết", () => {
  const SELF = "worker:1001:5000";
  const procsChiCoTa: Proc[] = [{ pid: 1001, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(4_000) }];

  function keHoach(rows: SharedLeaseRow[], procs: Proc[] | null) {
    return lapKeHoachNhanNuoi({
      selfKey: SELF,
      rows,
      procs,
      orphans: [],
      pidDaNhanNuoi: [],
      sidecar: moTaSidecarNhanNuoi(),
    });
  }

  it("B-1: hàng của tiến trình ĐÃ CHẾT ⇒ vào danh sách XOÁ", () => {
    const ke = keHoach([hangGiaySo()], procsChiCoTa);
    expect(ke.xoaHangMa.map((x) => x.leaseKey)).toEqual(["worker:900:1000#lease-1"]);
  });

  it("B-2: hàng của tiến trình CÒN SỐNG ⇒ KHÔNG xoá", () => {
    const procs = [...procsChiCoTa, { pid: 900, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(900) }];
    expect(keHoach([hangGiaySo()], procs).xoaHangMa).toEqual([]);
  });

  it("★ B-3: hàng của CHÍNH TA KHÔNG BAO GIỜ bị xoá — sổ cục bộ là chủ về giấy phép của ta", () => {
    const cuaTa = hangGiaySo({ leaseKey: `${SELF}#lease-9`, processKey: SELF, pid: 1001 });
    // Bảng tiến trình KHÔNG có pid của ta (kịch bản đọc thiếu) — vẫn không được đụng hàng của ta.
    expect(keHoach([cuaTa], []).xoaHangMa).toEqual([]);
  });

  it("★★ B-4: hàng `vram:baseline` của tiến trình đã chết ⇒ XOÁ (dân số Task 3 để lại)", () => {
    const nen = hangGiaySo({
      leaseKey: SHARED_BASELINE_KEY, processKey: "api:900:1000", pid: 900, role: "api",
      leaseId: "smi", owner: "reconciler:baseline",
    });
    expect(keHoach([nen], procsChiCoTa).xoaHangMa.map((x) => x.leaseKey)).toEqual([SHARED_BASELINE_KEY]);
  });

  it("B-5: hàng `vram:baseline` của CHÍNH TA ⇒ KHÔNG xoá", () => {
    const nen = hangGiaySo({ leaseKey: SHARED_BASELINE_KEY, processKey: SELF, pid: 1001, leaseId: "smi" });
    expect(keHoach([nen], procsChiCoTa).xoaHangMa).toEqual([]);
  });

  it("★ B-6: KHÔNG đọc được bảng tiến trình ⇒ KHÔNG XOÁ GÌ (không bằng chứng, không hành động)", () => {
    expect(keHoach([hangGiaySo()], null).xoaHangMa).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("C. NHẬN NUÔI — sidecar sống sót qua lượt khởi động lại", () => {
  const SELF = "worker:1001:5000";
  const procs: Proc[] = [
    { pid: 1001, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(9_000) },
    { pid: 31337, ppid: 60001, cmdline: `${BIN} -m qwen3-vl.gguf --port ${CONG} --jinja`, ctime: ft(1_000) },
  ];

  function keHoach(over: Partial<Parameters<typeof lapKeHoachNhanNuoi>[0]> = {}) {
    return lapKeHoachNhanNuoi({
      selfKey: SELF,
      rows: [],
      procs,
      orphans: [SIDECAR],
      pidDaNhanNuoi: [],
      sidecar: moTaSidecarNhanNuoi(),
      ...over,
    });
  }

  it("★★★ C-1: hộ mồ côi khớp ẢNH THỰC THI + CỔNG đã khai ⇒ nhận nuôi ĐÚNG SỐ BYTE cấu hình", () => {
    const ke = keHoach();
    expect(ke.nhanNuoi.map((n) => n.pid)).toEqual([31337]);
    expect(ke.nhanNuoi[0]!.bytes).toBe(KHOI_17K);
  });

  it("C-2: dòng lệnh KHÔNG mang cổng đã khai ⇒ KHÔNG nhận nuôi (cổng + PID, không phải chỉ tên)", () => {
    const khac = procs.map((p) => (p.pid === 31337 ? { ...p, cmdline: `${BIN} -m x.gguf --port 9099` } : p));
    expect(keHoach({ procs: khac }).nhanNuoi).toEqual([]);
  });

  it("C-3: chưa cấu hình sidecar (`LLAMA_SERVER_BIN` trống) ⇒ KHÔNG nhận nuôi", () => {
    expect(keHoach({ sidecar: null }).nhanNuoi).toEqual([]);
  });

  /**
   * ★★★ DÂN SỐ THỨ BA — sidecar **ĐÃ CÓ CHỦ** là một tiến trình ANH EM còn sống. Nó vẫn bị
   * `classifyHolders` xếp vào `orphans` (nó KHÔNG là con của một vai trò nào còn sống), nhưng byte
   * của nó **ĐÃ ĐƯỢC TÍNH** ⇒ không được nhận nuôi lần hai, và không được coi là tàn dư vô chủ.
   */
  it("★★★ C-4: hộ mồ côi ĐÃ CÓ CHỦ (anh em còn sống đứng tên) ⇒ KHÔNG nhận nuôi, và ĐÃ CÓ CHỦ", () => {
    const procsCoAnhEm = [...procs, { pid: 900, ppid: 1, cmdline: "node dist/index.js", ctime: ft(900) }];
    const hangAnhEm = hangGiaySo({
      leaseKey: "api:900:1000#lease-7", processKey: "api:900:1000", pid: 900, role: "api",
      owner: ownerNhanNuoi(31337), leaseKind: "external-process",
    });
    const ke = keHoach({ rows: [hangAnhEm], procs: procsCoAnhEm });
    expect(ke.nhanNuoi, "anh em đã đứng tên ⇒ nhận nuôi lần hai là ĐẾM HAI LẦN").toEqual([]);
    expect([...ke.pidTanDuDaCoChu]).toEqual([31337]);
  });

  it("★★ C-5: chủ của hàng đó ĐÃ CHẾT ⇒ hàng là MA ⇒ hộ lại VÔ CHỦ ⇒ nhận nuôi lại", () => {
    const hangMa = hangGiaySo({
      leaseKey: "api:900:1000#lease-7", processKey: "api:900:1000", pid: 900, role: "api",
      owner: ownerNhanNuoi(31337), leaseKind: "external-process",
    });
    const ke = keHoach({ rows: [hangMa] }); // pid 900 KHÔNG có trong `procs`
    expect(ke.nhanNuoi.map((n) => n.pid)).toEqual([31337]);
    expect([...ke.pidTanDuDaCoChu]).toEqual([]);
  });

  it("C-6: hộ đã được CHÍNH TA nhận nuôi ⇒ không nhận lần hai, và ĐÃ CÓ CHỦ", () => {
    const ke = keHoach({ pidDaNhanNuoi: [31337] });
    expect(ke.nhanNuoi).toEqual([]);
    expect([...ke.pidTanDuDaCoChu]).toEqual([31337]);
  });

  it("C-7: `owner` đi VÀ VỀ qua đúng MỘT bản dịch", () => {
    expect(pidTuOwnerNhanNuoi(ownerNhanNuoi(31337))).toBe(31337);
    expect(pidTuOwnerNhanNuoi("gguf:30B")).toBeNull();
  });

  // ⚠ LƯỚI ĐỐI CHIẾU cổng mặc định ⇄ `getVisionSidecarConfig()` nằm ở **file riêng**
  // (`adoption.port.test.ts`): nó cần `vi.resetModules()` (hằng `VISION_PORT` đóng băng lúc nạp
  // module), và một lượt `resetModules()` giữa file này sẽ làm `await import("./vramBroker")` bên
  // trong mã sản xuất trả về một **bản sao KHÁC** của sổ — đúng cái bẫy đã làm nhóm D đỏ một lượt.
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("D. ĐƯỜNG THẬT — nhịp đối chiếu, sổ chung thật, giấy phép thật", () => {
  const SELF = "worker:1001:5000";
  const procsCoSidecar: Proc[] = [
    { pid: 1001, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(9_000) },
    { pid: 31337, ppid: 60001, cmdline: `${BIN} -m qwen3-vl.gguf --port ${CONG} --jinja`, ctime: ft(1_000) },
  ];

  beforeEach(() => {
    chuyenTienTrinh(SELF);
    hoGiuGpu = census({ orphans: [SIDECAR] });
    bangTienTrinh = procsCoSidecar;
    thietBiUsedBytes = DESKTOP + KHOI_17K;
  });

  /**
   * ★★★ CA LÕI CỦA CẢ TASK — §6 nguyên văn: *"server khởi động lại trong khi sidecar còn giữ 7,8 GB
   * ⇒ sổ mất, thực tế còn"*. Sau MỘT nhịp, giấy phép phải được **dựng lại ĐÚNG SỐ BYTE** và phải
   * có mặt trong **sổ chung** để anh em thấy.
   */
  it("★★★ D-1: sidecar mồ côi ⇒ giấy phép được DỰNG LẠI đúng số byte và LÊN sổ chung", async () => {
    expect(snapshot().totalReservedBytes, "trước nhịp: sổ RỖNG (đã mất qua lượt khởi động lại)").toBe(0);

    await __runReconcileTick();
    await syncSharedLedger();

    const leases = snapshot().leases;
    expect(leases.length, "đúng MỘT giấy phép được dựng lại").toBe(1);
    expect(leases[0]!.actualBytes, "đúng số byte cấu hình của hộ 7,8 GB").toBe(KHOI_17K);
    expect(pidTuOwnerNhanNuoi(leases[0]!.request.owner)).toBe(31337);
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);

    const hang = [...bang.rows.values()].find((r) => pidTuOwnerNhanNuoi(r.owner) === 31337);
    expect(hang, "hàng phải có mặt trong sổ chung — anh em phải THẤY nó").toBeDefined();
    expect(hang!.bytes).toBe(KHOI_17K);
  });

  it("★★ D-2: nhịp sau sidecar CHẾT ⇒ giấy phép được NHẢ và hàng bị XOÁ khỏi sổ chung", async () => {
    await __runReconcileTick();
    await syncSharedLedger();
    expect(snapshot().leases.length).toBe(1);

    // Sidecar chết: biến khỏi bảng tiến trình VÀ khỏi danh sách hộ giữ GPU.
    bangTienTrinh = [procsCoSidecar[0]!];
    hoGiuGpu = census({});
    thietBiUsedBytes = DESKTOP;
    await __runReconcileTick();
    await syncSharedLedger();

    expect(snapshot().leases.length, "giấy phép của một tiến trình đã chết phải được NHẢ").toBe(0);
    expect(bang.khoaDaXoa().some((k) => k.startsWith(SELF)), "lệnh XOÁ phải THẬT SỰ đi qua cổng").toBe(true);
  });

  /**
   * ★★★ Đột biến *"lọc bằng `pid`, bỏ `bootMs`/`ctime`"* phải ĐỎ ở đây: pid 31337 VẪN CÒN trong
   * bảng, chỉ `CreationDate` nói đó là một tiến trình KHÁC.
   */
  it("★★★ D-3: PID được CẤP LẠI cho tiến trình khác ⇒ giấy phép nhận nuôi phải được NHẢ", async () => {
    await __runReconcileTick();
    expect(snapshot().leases.length).toBe(1);

    bangTienTrinh = [
      procsCoSidecar[0]!,
      // Cùng PID, `CreationDate` MỚI HƠN ⇒ tiến trình cũ đã chết, số 31337 được cấp lại.
      { pid: 31337, ppid: 5, cmdline: "C:\\Windows\\notepad.exe", ctime: ft(20_000) },
    ];
    hoGiuGpu = census({});
    await __runReconcileTick();
    expect(snapshot().leases.length, "PID cấp lại KHÔNG được kế thừa giấy phép của người đã chết").toBe(0);
  });

  it("★★ D-4: hàng MA của tiến trình đã chết bị XOÁ qua đúng cổng ghi", async () => {
    bang.rows.set("api:900:1000#lease-7", hangGiaySo({
      leaseKey: "api:900:1000#lease-7", processKey: "api:900:1000", pid: 900, role: "api",
    }));
    bang.rows.set(SHARED_BASELINE_KEY, hangGiaySo({
      leaseKey: SHARED_BASELINE_KEY, processKey: "api:900:1000", pid: 900, role: "api",
      leaseId: "smi", owner: "reconciler:baseline", bytes: DESKTOP,
    }));
    await syncSharedLedger(); // đưa hai hàng MA vào bản sao đọc
    expect(readSharedLedgerReplica()!.foreignLeases.length).toBe(1);

    await __runReconcileTick();
    await syncSharedLedger();

    expect(bang.khoaDaXoa()).toEqual(expect.arrayContaining(["api:900:1000#lease-7", SHARED_BASELINE_KEY]));
    expect(bang.rows.has("api:900:1000#lease-7")).toBe(false);
  });

  /**
   * ★★★ DÂN SỐ 3 — CỜ `baselineVerified`. Trước Task 4, một hộ trong `orphans` hạ cờ **VÔ ĐIỀU
   * KIỆN** ⇒ trong topo CÓ sidecar cờ là **hằng số `false`** + phạt 1.024 MiB thường trực (đúng
   * lớp lỗi I-3 của Task 2: *"một cờ luôn bật là một cờ không còn thông tin"*).
   */
  it("★★★ D-5: tàn dư ĐÃ NHẬN NUÔI thôi hạ cờ `baselineVerified`; tàn dư VÔ CHỦ vẫn hạ", async () => {
    // (a) hộ mồ côi mà KHÔNG khớp cổng ⇒ không nhận nuôi được ⇒ VẪN là tàn dư vô chủ ⇒ cờ TẮT.
    bangTienTrinh = [
      procsCoSidecar[0]!,
      { pid: 31337, ppid: 60001, cmdline: `${BIN} -m x.gguf --port 9099`, ctime: ft(1_000) },
    ];
    await __runReconcileTick();
    const r1 = await reconcileOnce();
    expect(r1.baselineVerified, "tàn dư VÔ CHỦ ⇒ cờ phải TẮT").toBe(false);
    expect(r1.baselineUnverifiedReasons).toContain("co-tan-du-giu-gpu");

    // (b) đúng hộ đã khai (cổng khớp) ⇒ nhận nuôi ⇒ byte của nó ĐÃ được tính ⇒ cờ BẬT.
    chuyenTienTrinh(SELF);
    bangTienTrinh = procsCoSidecar;
    await __runReconcileTick();
    const r2 = await reconcileOnce();
    expect(r2.baselineUnverifiedReasons).not.toContain("co-tan-du-giu-gpu");
    expect(r2.baselineVerified, "tàn dư ĐÃ CÓ CHỦ ⇒ cờ không còn lý do để tắt").toBe(true);
  });

  /**
   * ★★★ Chiều ANH EM: hộ do một tiến trình anh em CÒN SỐNG đứng tên vẫn nằm ở `orphans`, nhưng
   * byte của nó đã được tính ở sổ chung ⇒ **không được** hạ cờ của ta. Đột biến *"hộ anh em vẫn bị
   * xếp là tàn dư vô chủ"* làm ca này ĐỎ.
   */
  it("★★★ D-6: hộ mồ côi do ANH EM CÒN SỐNG đứng tên ⇒ KHÔNG hạ cờ và KHÔNG bị nhận nuôi lần hai", async () => {
    bang.rows.set("api:900:1000#lease-7", hangGiaySo({
      leaseKey: "api:900:1000#lease-7", processKey: "api:900:1000", pid: 900, role: "api",
      owner: ownerNhanNuoi(31337), leaseKind: "external-process", bytes: KHOI_17K,
    }));
    bangTienTrinh = [...procsCoSidecar, { pid: 900, ppid: 1, cmdline: "node dist/index.js", ctime: ft(900) }];
    await syncSharedLedger();

    await __runReconcileTick();
    const r = await reconcileOnce();
    expect(snapshot().leases, "anh em đã đứng tên ⇒ ta KHÔNG nhận nuôi lần hai").toEqual([]);
    expect(r.baselineUnverifiedReasons).not.toContain("co-tan-du-giu-gpu");
    expect(bang.rows.has("api:900:1000#lease-7"), "hàng của anh em CÒN SỐNG không được xoá").toBe(true);
  });

  it("D-7: KHÔNG đọc được bảng tiến trình ⇒ KHÔNG nhận nuôi, KHÔNG xoá, cờ vẫn TẮT (chiều CHẶT)", async () => {
    bangTienTrinh = null;
    bang.rows.set("api:900:1000#lease-7", hangGiaySo({
      leaseKey: "api:900:1000#lease-7", processKey: "api:900:1000", pid: 900, role: "api",
    }));
    await syncSharedLedger();
    await __runReconcileTick();
    await syncSharedLedger();
    expect(snapshot().leases).toEqual([]);
    expect(bang.rows.has("api:900:1000#lease-7")).toBe(true);
    const r = await reconcileOnce();
    expect(r.baselineUnverifiedReasons).toContain("co-tan-du-giu-gpu");
  });

  it("★ D-8: giấy phép nhận nuôi KHÔNG chặn lượt chụp nền (byte của nó ĐÃ nằm trên thiết bị)", async () => {
    await __runReconcileTick();
    const nen = await captureVramBaseline();
    expect(nen, "nền = thiết bị − đã chốt sổ ⇒ đúng nền THẬT của máy").toBe(DESKTOP);
  });
});

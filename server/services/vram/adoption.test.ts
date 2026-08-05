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

import {
  __resetBrokerForTests, nguoiThiHanhThuHoi, nguoiThiHanhThuHoiTu, preemptCandidates, preemptPlan,
  snapshot,
} from "./vramBroker";
import { preempt } from "./vramPreempt";
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
  __pidDangNhanNuoi, __resetVramBaselineForTests, __runReconcileTick, __setCuaThuHoiForTests,
  captureVramBaseline, reconcileOnce, sidecarTtlMs, thuHoiHoNhanNuoi,
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

  /**
   * ★★★ CA DO **NGHIỆM THU SỐNG** ĐẺ RA (không phải suy luận). Lệnh `delete` chỉ được XẾP HÀNG,
   * nên nếu bản sao đọc không được dọn NGAY thì **chính nhịp vừa chứng minh hàng là MA** vẫn:
   *   • đem 17.000 MiB ma đi tính lệch ⇒ `LỆCH −16.671 MiB` + `alarm` + một dòng `drift` vào DB
   *     (số ĐO ĐƯỢC ở lượt nghiệm thu đầu tiên);
   *   • **NHẬN NUÔI nền** của đúng tiến trình đã chết đó (`baselineOrigin: "adopted"`).
   */
  it("★★★ D-9: hàng MA bị vứt khỏi bản sao NGAY trong nhịp — không báo động, không nhận nuôi nền của xác chết", async () => {
    bang.rows.set("api:900:1000#lease-ma", hangGiaySo({
      leaseKey: "api:900:1000#lease-ma", processKey: "api:900:1000", pid: 900, role: "api",
      bytes: KHOI_17K,
    }));
    bang.rows.set(SHARED_BASELINE_KEY, hangGiaySo({
      leaseKey: SHARED_BASELINE_KEY, processKey: "api:900:1000", pid: 900, role: "api",
      leaseId: "smi", owner: "reconciler:baseline", bytes: DESKTOP,
    }));
    await syncSharedLedger();
    expect(readSharedLedgerReplica()!.foreignBytes, "trước nhịp: bản sao VẪN mang hàng ma").toBe(KHOI_17K);

    const r = await __runReconcileTick();
    expect(r.foreignLedgerBytes, "byte của hàng MA KHÔNG được vào vế sổ").toBe(0);
    expect(r.baselineOrigin, "KHÔNG được nhận nuôi nền của một tiến trình đã chết").not.toBe("adopted");
    expect(r.baselineUsedBytes, "nền = thiết bị − giấy phép nhận nuôi").toBe(DESKTOP);
    expect(r.driftBytes, "hai vế khớp ⇒ lệch 0").toBe(0);
    expect(r.alarm, "KHÔNG báo động cho một khối byte nhịp này vừa tuyên bố là không tồn tại").toBe(false);
  });

  /**
   * ★★ Câu cảnh báo phải NÓI ĐÚNG HÀNH ĐỘNG. Nghiệm thu sống in ra *"1 TÀN DƯ … tắt chúng THEO
   * ĐÚNG PID"* ngay cạnh *"Nền vẫn XÁC MINH ĐƯỢC"* — hai vế mâu thuẫn, và vế đầu mời người trực đi
   * giết một tiến trình mà byte của nó đã được tính đủ.
   */
  it("★★ D-10: hộ ĐÃ ĐỨNG TÊN không được gọi là 'TÀN DƯ VÔ CHỦ'; hộ vô chủ thì PHẢI bị gọi tên", async () => {
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    await __runReconcileTick();
    const daNhan = warn.mock.calls.map((c: unknown[]) => String(c[0] ?? "")).join("\n");
    expect(daNhan).toMatch(/ĐƯỢC ĐỨNG TÊN/);
    expect(daNhan, "hộ có chủ KHÔNG được khuyên tắt").not.toMatch(/TÀN DƯ VÔ CHỦ/);

    chuyenTienTrinh(SELF);
    warn.mockClear();
    bangTienTrinh = [
      procsCoSidecar[0]!,
      { pid: 31337, ppid: 60001, cmdline: `${BIN} -m x.gguf --port 9099`, ctime: ft(1_000) },
    ];
    await __runReconcileTick();
    const voChu = warn.mock.calls.map((c: unknown[]) => String(c[0] ?? "")).join("\n");
    expect(voChu).toMatch(/TÀN DƯ VÔ CHỦ/);
  });

  it("★ D-8: giấy phép nhận nuôi KHÔNG chặn lượt chụp nền (byte của nó ĐÃ nằm trên thiết bị)", async () => {
    await __runReconcileTick();
    const nen = await captureVramBaseline();
    expect(nen, "nền = thiết bị − đã chốt sổ ⇒ đúng nền THẬT của máy").toBe(DESKTOP);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Pha 3 Task 5 (A) — **NGƯỜI THI HÀNH THU HỒI XUYÊN TIẾN TRÌNH.**
 *
 * Task 4 đóng lại với một món nợ ghi rõ địa chỉ: *"hộ nhận nuôi CHƯA CÓ người thi hành thu hồi;
 * `reclaimer` cố ý để trống vì khai `vision-sidecar` là HỨA NGƯỢC"*. Nhóm này trả món nợ đó, và
 * phải trả **đúng vị từ `coThiHanhThuHoi()`** — tổng, câu chữ, nhãn và người thi hành đọc CÙNG
 * một vị từ (bàn giao cứng của Pha 2B Task 5).
 *
 * ⚠⚠ ĐIỀU KIỆN RA SỐ 1 CỦA PHA 3: *"chỉ khai thành công khi byte THẬT SỰ đã nhả"*. Bằng chứng ở
 * đây là **THIẾT BỊ** (`nvidia-smi --query-compute-apps`), KHÔNG phải bảng tiến trình — Task 1 đo
 * được hai câu trả lời lệch nhau **543 ms** trên chính hộ 7,8 GB.
 */
describe("E. THU HỒI XUYÊN TIẾN TRÌNH — hộ nhận nuôi nay CÓ người thi hành", () => {
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

  afterEach(() => {
    __setCuaThuHoiForTests(null);
  });

  /** Cửa I/O giả — MỘT chỗ dựng, để mọi ca đi qua ĐÚNG hàm sản xuất `thuHoiHoNhanNuoi()`. */
  function cua(pidConGiuGpu: readonly number[] | null, ghi?: { giet: number[] }) {
    let t = 0;
    return {
      giet: (p: number) => {
        ghi?.giet.push(p);
      },
      docPidGiuGpu: async () => pidConGiuGpu,
      nghi: async () => {},
      // Đồng hồ nhảy 1 s mỗi lượt đọc ⇒ hạn 8.000 ms hết sau vài vòng, ca không treo.
      now: () => (t += 1_000),
    };
  }

  it("★★★ E-1: hộ nhận nuôi nay đi qua ĐÚNG vị từ chung ⇒ `reclaimable` = true và CÓ trong kế hoạch", async () => {
    await __runReconcileTick();
    const l = snapshot().leases[0]!;
    expect(l.request.reclaimer, "Task 4 để trống ô này; Task 5 trả nợ ĐÚNG ở đây").toBe("orphan-pid");
    expect(l.refCount, "hộ mồ côi KHÔNG có lượt phục vụ nào đang bay").toBe(0);
    expect(nguoiThiHanhThuHoi(l), "vị từ DUY NHẤT phải nhận ra nó").toBe("orphan-pid");

    // Và nó phải có mặt trong CẢ HAI danh sách mà câu từ chối + lượt thi hành đọc.
    const ungVien = preemptCandidates("interactive", KHOI_17K);
    expect(ungVien.map((h) => h.owner)).toEqual([ownerNhanNuoi(31337)]);
    expect(ungVien[0]!.reclaimable, "nhãn trong câu từ chối phải đọc CÙNG vị từ").toBe(true);
    expect(preemptPlan("interactive", KHOI_17K).map((s) => s.reclaimer)).toEqual(["orphan-pid"]);
  });

  it("★★★ E-2: thiết bị XÁC NHẬN pid không còn giữ GPU ⇒ khai thành công VÀ nhả đúng số byte", async () => {
    await __runReconcileTick();
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);
    const ghi = { giet: [] as number[] };

    const ok = await thuHoiHoNhanNuoi(31337, cua([7824], ghi));
    expect(ok).toBe(true);
    expect(ghi.giet, "tắt ĐÚNG PID, không quét mù theo tên").toEqual([31337]);
    expect(snapshot().totalReservedBytes, "byte đã nhả ⇒ sổ phải trống").toBe(0);
    expect(__pidDangNhanNuoi(), "và bảng pid → giấy phép phải sạch").toEqual([]);
  });

  /**
   * ⚠⚠⚠ ĐỘT BIẾN BẮT BUỘC CỦA BRIEF: *"người thi hành khai thu hồi được một hộ ngoài tiến trình mà
   * thực tế KHÔNG ⇒ ca đỏ"*. Đây đúng lớp lỗi C-2 của Pha 2B (`return true` vô điều kiện), chỉ đổi
   * dân số: khai `reclaimed` với `freedBytes = 0` khiến người gọi **xin lại ngay** và hỏng lần
   * hai — SAU KHI đã giết một hộ 7,8 GB.
   */
  it("★★★ E-3: thiết bị VẪN thấy pid giữ GPU ⇒ khai THẤT BẠI và GIỮ NGUYÊN giấy phép", async () => {
    await __runReconcileTick();
    const ok = await thuHoiHoNhanNuoi(31337, cua([7824, 31337]));
    expect(ok, "chưa có bằng chứng byte đã nhả ⇒ KHÔNG được khai thành công").toBe(false);
    expect(snapshot().totalReservedBytes, "và TUYỆT ĐỐI không được nhả sổ").toBe(KHOI_17K);
    expect(__pidDangNhanNuoi()).toEqual([31337]);
  });

  it("★★ E-4: KHÔNG đọc được thiết bị (`null`) ⇒ KHÔNG bằng chứng ⇒ THẤT BẠI (không đọc null thành rỗng)", async () => {
    await __runReconcileTick();
    const ok = await thuHoiHoNhanNuoi(31337, cua(null));
    expect(ok).toBe(false);
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);
  });

  it("E-5: pid KHÔNG phải hộ nhận nuôi ⇒ từ chối ngay, không gửi tín hiệu nào", async () => {
    await __runReconcileTick();
    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(999_999, cua([], ghi))).toBe(false);
    expect(ghi.giet, "không được đụng tới một PID mà ta không đứng tên").toEqual([]);
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);
  });

  /**
   * ★★★ C-1 (review TOÀN NHÁNH) — **GIẾT NHẦM RỒI KHAI THÀNH CÔNG.** Ba ca dưới đây khoá đúng lỗ
   * mà E-5 KHÔNG canh: E-5 hỏi *"pid này có phải hộ của ta không"*; ba ca này hỏi
   * *"cái pid ta đứng tên HÔM NAY còn là ĐÚNG TIẾN TRÌNH đó không"*.
   *
   * `leaseNhanNuoi` lưu `ctime` **đúng vì lý do PID-CẤP-LẠI** (xem docstring của nó), nhưng trước
   * bản vá `ctime` chỉ được đọc ở **nhịp 60 s**; đường **PHÁ HUỶ** chỉ kiểm `leaseNhanNuoi.get(pid)`
   * có mặt rồi `process.kill()`. Cửa sổ còn **rộng hơn 60 s**: `chayLuotNhanNuoi` `continue` khi
   * bảng tiến trình không đọc được, và Task 4 đo được `readProcTable()` trả `null` **4 lượt liên
   * tiếp** dưới tải.
   *
   * ⚠⚠ Và hình dạng TỆ NHẤT không phải lượt giết — mà là lời khai sau đó: hộ nhận nuôi có
   * `refCount = 0` VĨNH VIỄN ⇒ `coTheNhuong` cho MỌI mức người xin ⇒ mọi `reserve()` bị từ chối đều
   * lên kế hoạch giết nó; rồi lượt kiểm bằng chứng thoả **RỖNG TUẾCH** (một `notepad.exe` không
   * phải compute-app ⇒ `!pids.includes(pid)` đúng ngay lượt đầu) ⇒ `return true` kèm một dòng log
   * *"nvidia-smi XÁC NHẬN"*. Sai **và** tự khai là đúng.
   */
  it("★★★ E-10 (C-1): PID được CẤP LẠI (cùng số, KHÁC `ctime`) ⇒ KHÔNG giết, KHÔNG khai thành công", async () => {
    await __runReconcileTick();
    expect(__pidDangNhanNuoi(), "tiền đề: ta đang đứng tên đúng pid này").toEqual([31337]);

    // Hộ mồ côi đã chết; HĐH cấp lại đúng số PID cho một tiến trình vô can.
    bangTienTrinh = [
      procsCoSidecar[0]!,
      { pid: 31337, ppid: 5, cmdline: "C:\\Windows\\notepad.exe", ctime: ft(20_000) },
    ];
    const ghi = { giet: [] as number[] };

    // ⚠ Cửa thiết bị nói "pid KHÔNG giữ GPU" — đúng thứ làm bằng chứng THOẢ RỖNG TUẾCH ở bản cũ.
    const ok = await thuHoiHoNhanNuoi(31337, cua([7824], ghi));

    expect(ghi.giet, "một `notepad.exe` vô can TUYỆT ĐỐI không được nhận SIGTERM").toEqual([]);
    expect(ok, "và một lượt giết NHẦM không được khai là thành công").toBe(false);
    expect(snapshot().totalReservedBytes, "sổ giữ nguyên: nhịp 60 s mới là người dọn").toBe(KHOI_17K);
    expect(__pidDangNhanNuoi()).toEqual([31337]);
  });

  it("★★ E-11 (C-1): pid VẮNG HẲN khỏi bảng tiến trình ⇒ không có gì để giết ⇒ không khai thành công", async () => {
    await __runReconcileTick();
    bangTienTrinh = [procsCoSidecar[0]!];
    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    expect(ghi.giet, "gửi tín hiệu tới một số PID trống là bắn vào bóng tối").toEqual([]);
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);
  });

  it("★★ E-12 (C-1): KHÔNG đọc được bảng tiến trình ⇒ KHÔNG bằng chứng ⇒ KHÔNG hành động", async () => {
    await __runReconcileTick();
    bangTienTrinh = null;
    const ghi = { giet: [] as number[] };
    expect(await thuHoiHoNhanNuoi(31337, cua([7824], ghi))).toBe(false);
    expect(ghi.giet, '"không kiểm được" KHÔNG được đọc thành "được phép"').toEqual([]);
    expect(snapshot().totalReservedBytes).toBe(KHOI_17K);
  });

  /**
   * ★★★ ĐƯỜNG THOÁT ĐẦY ĐỦ: `preempt()` → `preemptPlan()` → `NGUOI_THI_HANH["orphan-pid"]` →
   * `pidTuOwnerNhanNuoi()` → `thuHoiHoNhanNuoi()`. `freedBytes` đo bằng **CHÊNH LỆCH SỔ**, không
   * cộng theo lời khai của kế hoạch.
   */
  it("★★★ E-6: `preempt()` thu hồi được hộ NGOÀI tiến trình và `freedBytes` đo bằng SỔ", async () => {
    await __runReconcileTick();
    __setCuaThuHoiForTests(cua([7824]));
    const kq = await preempt("interactive", KHOI_17K);
    expect(kq.planned).toBe(1);
    expect(kq.reclaimed).toEqual([ownerNhanNuoi(31337)]);
    expect(kq.failed).toEqual([]);
    expect(kq.freedBytes, "ĐO BẰNG SỔ: 17.000 MiB đã ra khỏi sổ").toBe(KHOI_17K);
  });

  it("★★★ E-7: người thi hành THẤT BẠI ⇒ `preempt()` khai `failed` và `freedBytes = 0`", async () => {
    await __runReconcileTick();
    __setCuaThuHoiForTests(cua([7824, 31337]));
    const kq = await preempt("interactive", KHOI_17K);
    expect(kq.planned).toBe(1);
    expect(kq.reclaimed).toEqual([]);
    expect(kq.failed).toEqual([ownerNhanNuoi(31337)]);
    expect(kq.freedBytes).toBe(0);
    expect(snapshot().totalReservedBytes, "sổ y nguyên — không nói dối đúng chiều OOM").toBe(KHOI_17K);
  });

  it("★★ E-8: `VRAM_SIDECAR_TTL_MS` — dây có LƯỚI ở CẢ HAI mép (Task 4 để `?? 900_000` trần)", () => {
    delete process.env.VRAM_SIDECAR_TTL_MS;
    expect(sidecarTtlMs()).toBe(900_000);
    process.env.VRAM_SIDECAR_TTL_MS = "60000";
    expect(sidecarTtlMs()).toBe(60_000);
    // ⚠ "đặt rồi để TRỐNG" ⇒ `Number("")` là 0 ⇒ giấy phép tự khai QUÁ HẠN ngay lúc sinh.
    process.env.VRAM_SIDECAR_TTL_MS = "   ";
    expect(sidecarTtlMs()).toBe(900_000);
    // ⚠ rác ⇒ `NaN` đi thẳng vào `ttlMs` rồi vào ống dẫn sự kiện (cột bigint ⇒ MẤT CẢ LÔ).
    process.env.VRAM_SIDECAR_TTL_MS = "abc";
    expect(sidecarTtlMs()).toBe(900_000);
    process.env.VRAM_SIDECAR_TTL_MS = "-5";
    expect(sidecarTtlMs()).toBe(900_000);
    delete process.env.VRAM_SIDECAR_TTL_MS;
  });

  it("★★ E-9: giấy phép nhận nuôi mang ĐÚNG `ttlMs` đã cấu hình (dây đi tới nơi, không rơi giữa đường)", async () => {
    process.env.VRAM_SIDECAR_TTL_MS = "123456";
    await __runReconcileTick();
    expect(snapshot().leases[0]!.request.ttlMs).toBe(123_456);
    delete process.env.VRAM_SIDECAR_TTL_MS;
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Pha 3 Task 5 — **CỬA SỔ "HAI TIẾN TRÌNH CÙNG NHẬN NUÔI MỘT HỘ VÔ CHỦ".**
 *
 * Nợ ghi trong báo cáo Task 4 §8.7: chưa có **cuộc bầu** cho lượt nhận nuôi, nên hai tiến trình
 * cùng thấy một hộ vô chủ sẽ **cùng nhận nuôi** trong cửa sổ trước khi bản sao đọc tới nơi (≤60 s)
 * ⇒ khối byte bị đếm **HAI lần**. Task 4 lập luận đó là chiều **CHẶT** rồi **HỘI TỤ** — nhưng
 * **chưa có ca test nào**, tức một lập luận không có lưới.
 *
 * ⇒ Task 5 chọn **thêm ca, không thêm bầu**, và nói rõ vì sao: một cuộc bầu ở đây sẽ **NỚI** —
 * bên thua không nhận nuôi, nên khối 7,8 GB vô hình với sổ CỤC BỘ của nó cho tới khi bản sao tới
 * nơi (cùng ≤60 s). Đổi một khoản đếm THỪA lấy một khoản đếm THIẾU là ngược ràng buộc 8.
 */
describe("F. CHƯA CÓ BẦU CHO LƯỢT NHẬN NUÔI — cửa sổ đếm hai lần là CHẶT rồi HỘI TỤ", () => {
  const A = "api:900:1000";
  const B = "worker:901:1000";
  const procs: Proc[] = [
    { pid: 900, ppid: 1, cmdline: "node dist/index.js", ctime: ft(900) },
    { pid: 901, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(901) },
    { pid: 31337, ppid: 60001, cmdline: `${BIN} -m qwen3-vl.gguf --port ${CONG} --jinja`, ctime: ft(1_000) },
  ];

  it("★★★ F-1: bản sao CHƯA tới nơi ⇒ CẢ HAI cùng nhận nuôi (đếm hai lần = chiều CHẶT, không NỚI)", () => {
    const keA = lapKeHoachNhanNuoi({
      selfKey: A, rows: [], procs, orphans: [SIDECAR], pidDaNhanNuoi: [], sidecar: moTaSidecarNhanNuoi(),
    });
    const keB = lapKeHoachNhanNuoi({
      selfKey: B, rows: [], procs, orphans: [SIDECAR], pidDaNhanNuoi: [], sidecar: moTaSidecarNhanNuoi(),
    });
    expect(keA.nhanNuoi.map((n) => n.pid)).toEqual([31337]);
    expect(keB.nhanNuoi.map((n) => n.pid), "cùng nhận nuôi — đã biết, và đây là chiều AN TOÀN").toEqual([31337]);
  });

  it("★★★ F-2: bản sao tới nơi ⇒ bên thấy hàng của bên kia THÔI nhận nuôi (HỘI TỤ, không ping-pong)", () => {
    const hangCuaA = hangGiaySo({
      leaseKey: `${A}#lease-1`, processKey: A, pid: 900, role: "api",
      owner: ownerNhanNuoi(31337), leaseKind: "external-process", bytes: KHOI_17K,
    });
    const keB = lapKeHoachNhanNuoi({
      selfKey: B, rows: [hangCuaA], procs, orphans: [SIDECAR], pidDaNhanNuoi: [],
      sidecar: moTaSidecarNhanNuoi(),
    });
    expect(keB.nhanNuoi, "A đã đứng tên ⇒ B thôi").toEqual([]);
    expect([...keB.pidTanDuDaCoChu], "và B phải coi hộ đó là ĐÃ CÓ CHỦ").toEqual([31337]);

    // ⚠ Vế đối xứng: A đọc hàng của CHÍNH NÓ thì **không** đi qua đường trên (hàng của ta bị bỏ
    // qua ở dòng `r.processKey === selfKey`) — nó thôi nhận nuôi nhờ `pidDaNhanNuoi`. Hai đường
    // khác nhau cho cùng một kết luận; thiếu vế này thì đột biến "bỏ `pidDaNhanNuoi`" sống.
    const keA = lapKeHoachNhanNuoi({
      selfKey: A, rows: [hangCuaA], procs, orphans: [SIDECAR], pidDaNhanNuoi: [31337],
      sidecar: moTaSidecarNhanNuoi(),
    });
    expect(keA.nhanNuoi).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ (4) review TOÀN NHÁNH — **KHOÁ MỘT ĐỘT BIẾN ĐÃ SỐNG SÓT 692/692, 0 ĐỎ.**
 *
 * Nợ Task 5 tự khai: *"ai đưa `foreignLeases` vào `preemptPlan()` thì race `refCount` quay lại
 * NGAY và không ca nào đỏ"*. Người review đã **tự chạy đúng đột biến đó** (nối `foreignLeases` đã
 * lọc bằng CHÍNH `nguoiThiHanhThuHoiTu` vào kết quả `preemptPlan`) và cả 692 ca vẫn xanh.
 *
 * ⚠⚠ VÀ HẬU QUẢ NẶNG HƠN LỜI KHAI. Không chỉ là một race trên `refCount` đọc từ bản sao cũ tới
 * 60 s. `NGUOI_THI_HANH[step.reclaimer]` (`vramPreempt.ts:57`) chạy **TRONG TIẾN TRÌNH NÀY**, nên
 * một hàng của **anh em** mang `reclaimer: "gguf-idle-model"` sẽ gọi `unloadGgufModel(modelId)`
 * trên **engine CỦA TA** cho một model mà **anh em** đang nạp, và `"vision-sidecar"` sẽ
 * `stopSidecar()` giết **sidecar CỦA TA**. Đó không phải "mở lại một race" — đó là **quy trách
 * nhiệm SAI HỘ**, và vì `freedBytes` đo bằng chênh lệch sổ CỤC BỘ nên hậu quả **im lặng**.
 *
 * ⚠ Khuôn của ca này là khuôn RẺ NHẤT mà người review chỉ ra, và nó cố ý **không biết `foreignLeases`
 * là gì**: nó chỉ khẳng định một bất biến — *mỗi bước thi hành phải trỏ tới một giấy phép CÓ TRONG
 * `snapshot().leases`*. Bất kỳ đường nào đưa hàng của người khác vào kế hoạch đều đỏ ở đây, kể cả
 * đường chưa ai nghĩ ra.
 */
describe("G. RANH GIỚI THI HÀNH — `preemptPlan()` CHỈ trả giấy phép CỦA TA", () => {
  const SELF = "worker:1001:5000";
  /** ⚠ pid 900 phải CÒN SỐNG (ctime ≤ bootMs của `api:900:1000`), nếu không hàng của nó bị dọn như
   *  HÀNG MA ngay trong nhịp và ca này xanh RỖNG. */
  const procs: Proc[] = [
    { pid: 1001, ppid: 1, cmdline: "node dist/worker.js", ctime: ft(9_000) },
    { pid: 900, ppid: 1, cmdline: "node dist/index.js", ctime: ft(900) },
    { pid: 31337, ppid: 60001, cmdline: `${BIN} -m qwen3-vl.gguf --port ${CONG} --jinja`, ctime: ft(1_000) },
  ];

  beforeEach(() => {
    chuyenTienTrinh(SELF);
    hoGiuGpu = census({ orphans: [SIDECAR] });
    bangTienTrinh = procs;
    thietBiUsedBytes = DESKTOP + KHOI_17K;
  });

  it("★★★ G-1: hàng của ANH EM nhàn rỗi + CÓ người thi hành vẫn KHÔNG được vào kế hoạch thi hành", async () => {
    // Hàng của anh em ở đúng hình dạng HẤP DẪN NHẤT với đột biến: nhàn rỗi, mức thấp nhất, và
    // `reclaimer` mà bảng `NGUOI_THI_HANH` CÓ cài đặt.
    bang.rows.set(`api:900:1000#lease-9`, hangGiaySo({
      leaseKey: "api:900:1000#lease-9", processKey: "api:900:1000", pid: 900, role: "api",
      leaseId: "lease-9", owner: "gguf:cua-anh-em", priority: "background",
      refCount: 0, reclaimer: "gguf-idle-model",
    }));
    await syncSharedLedger();

    // ⚠ TIỀN ĐỀ, kiểm bằng chính bản sao mã sản xuất đọc — không có hai dòng này thì ca có thể
    // xanh vì hàng anh em KHÔNG TỒN TẠI, chứ không vì bất biến được giữ.
    const banSao = readSharedLedgerReplica()!;
    expect(banSao.foreignLeases.map((r) => r.leaseId), "hàng anh em PHẢI có trong bản sao").toEqual(["lease-9"]);
    expect(
      nguoiThiHanhThuHoiTu(banSao.foreignLeases[0]!.reclaimer, banSao.foreignLeases[0]!.refCount),
      "và nó PHẢI thu hồi được theo vị từ DÙNG CHUNG — đó đúng là thứ làm đột biến hấp dẫn",
    ).toBe("gguf-idle-model");

    await __runReconcileTick(); // sổ CỤC BỘ có hộ nhận nuôi ⇒ kế hoạch KHÔNG rỗng

    const cuaTa = new Set(snapshot().leases.map((l) => l.id));
    const ke = preemptPlan("interactive", Number.POSITIVE_INFINITY);
    expect(ke.length, "kế hoạch rỗng thì ca này không khẳng định được gì").toBeGreaterThan(0);
    for (const b of ke) {
      expect(
        cuaTa.has(b.leaseId),
        `bước "${b.owner}" (leaseId ${b.leaseId}, reclaimer ${b.reclaimer}) trỏ tới một giấy phép ` +
          `KHÔNG có trong sổ cục bộ — người thi hành chạy TRONG tiến trình này, nên nó sẽ dọn hộ CỦA TA`,
      ).toBe(true);
    }
  });
});

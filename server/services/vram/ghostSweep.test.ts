/**
 * ★★★ Pha 10 — **BỘ QUÉT HÀNG MA: KÊNH BẰNG CHỨNG PHỤ + HÀNG RÀO TUỔI + CHUÔNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO BỘ CA NÀY TỒN TẠI, VÀ NÓ ĐO CÁI GÌ MÀ `adoption.test.ts` KHÔNG ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `adoption.test.ts` đã khoá **vị từ** (`trangThaiTienTrinh`) và **kế hoạch** khi bảng tiến trình
 * ĐỌC ĐƯỢC. Thứ nó KHÔNG đo — và đó đúng lỗ hổng đã tốn 2 ngày sản xuất — là hành vi khi bảng tiến
 * trình **CÂM**: ca `B-6` chỉ khẳng định *"không xoá gì"*, tức nó khoá đúng cái **trạng thái tê
 * liệt** mà sự cố 2026-08-19 rơi vào (107 hàng / 54.755 MiB hộ ma, dư địa **−19.054 MiB**, AI
 * ngừng trả lời). Lưới xanh, hệ chết.
 *
 * ⚠⚠ **CẠM BẪY SỐ MỘT CỦA CHÍNH BỘ CA NÀY — LƯỚI "KHÔNG CÒN HÀNG MA" TRÊN BẢNG RỖNG LÀ TỰ THOẢ.**
 * Một ca kiểu `expect(xoaHangMa).toEqual([])` sau khi dọn sẽ **xanh vĩnh viễn** kể cả khi bộ quét
 * bị gỡ sạch. Nên **mọi** ca dọn ở đây đều dựng **HAI** hàng cạnh nhau — một hàng MA của pid đã
 * chết và một hàng THẬT của pid CÒN SỐNG — rồi khẳng định **cả hai vế**: cái thứ nhất BIẾN MẤT,
 * cái thứ hai CÒN NGUYÊN. Một đột biến xoá tất hoặc xoá không cái nào đều ĐỎ.
 *
 * ⚠ Đây cũng là hình dạng dữ liệu THẬT đo được lúc 10:36 ngày 2026-08-19 trên `aoi_management`:
 * 8 hàng = **4 ma** (pid 18208/10992/20788/33488, đứng im 2 ngày) + **4 sống** (pid 38432).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TUOI_TOI_THIEU_KENH_PHU_MS, lapKeHoachNhanNuoi, tachProcessKey, trangThaiTienTrinh,
} from "./vramAdoption";
import type { SharedLeaseRow } from "./vramSharedLedger";
import { __setDauDoHienDienForTests, hienDienCuaPid, quetPidVangMat } from "./vramProcessPresence";
import type { SuHienDien } from "./vramProcessPresence";
import { formatVramRefusal } from "./vramRefusal";
import type { VramRefusalFacts } from "./vramRefusal";

const MIB = 1024 * 1024;
type Proc = { pid: number; ppid: number; cmdline: string; ctime: number };

/** Unix ms → FILETIME UTC. Cùng phép đổi với `ctimeSangUnixMs()`, chiều ngược. */
function ft(unixMs: number): number {
  return (unixMs + 11_644_473_600_000) * 10_000;
}

const SELF = "all:38432:1787109709385";
/** "Bây giờ" của mọi ca — cố định để hàng rào tuổi là một phép đo tất định. */
const NOW = 1_787_200_000_000;

/**
 * Hàng MA: pid 20788, `bootMs` 2 ngày trước, `updatedAtMs` đứng im từ đó. Đúng hàng thật đã đo.
 */
function hangMa(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return hang({
    leaseKey: "all:20788:1787018249695#lease-1",
    processKey: "all:20788:1787018249695",
    pid: 20788,
    bytes: 432 * MIB,
    updatedAtMs: 1787018249695,
    ...over,
  });
}

/**
 * Hàng THẬT của một tiến trình anh em CÒN SỐNG (pid 38999), vừa đồng bộ xong.
 * ⚠ `processKey` KHÁC `SELF` — nếu dùng `SELF` thì nó được giữ lại vì lý do KHÁC (hàng của chính
 * ta), và ca sẽ xanh mà không chứng minh được gì về vị từ sống/chết.
 */
function hangSong(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return hang({
    leaseKey: "all:38999:1787199000000#lease-1",
    processKey: "all:38999:1787199000000",
    pid: 38999,
    bytes: 3878 * MIB,
    updatedAtMs: NOW - 30_000,
    ...over,
  });
}

function hang(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "x#lease-1",
    processKey: "x:1:1",
    pid: 1,
    role: "all",
    leaseId: "lease-1",
    owner: "gguf:30B",
    leaseKind: "gguf-model",
    priority: "interactive",
    bytes: 100 * MIB,
    measured: true,
    refCount: 1,
    reclaimer: null,
    acquiredAtMs: 1000,
    updatedAtMs: 1000,
    identityTruncated: [],
    ...over,
  };
}

function keHoach(opts: {
  rows: SharedLeaseRow[];
  procs: Proc[] | null;
  pidVangMat?: ReadonlySet<number> | null;
  nowMs?: number;
  tuoiToiThieuKenhPhuMs?: number;
}) {
  return lapKeHoachNhanNuoi({
    selfKey: SELF,
    rows: opts.rows,
    procs: opts.procs,
    orphans: [],
    pidDaNhanNuoi: [],
    sidecar: null,
    pidVangMat: opts.pidVangMat ?? null,
    // ⚠ `"nowMs" in opts` chứ KHÔNG `?? NOW`: ca T-4 cố ý truyền `undefined`/`NaN`, và một `??` ở
    // đây sẽ **thay hộ** giá trị bẩn bằng một giá trị sạch ⇒ ca đo một thế giới khác thế giới nó
    // định đo, rồi xanh. Đúng lớp lỗi mà cả bộ ca này canh.
    nowMs: "nowMs" in opts ? opts.nowMs : NOW,
    tuoiToiThieuKenhPhuMs: opts.tuoiToiThieuKenhPhuMs,
  });
}

afterEach(() => {
  __setDauDoHienDienForTests(null);
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("P. ĐẦU DÒ HIỆN DIỆN — `process.kill(pid, 0)`, ba giá trị", () => {
  it("P-1: tiến trình NÀY chắc chắn có mặt ⇒ \"co\"", () => {
    expect(hienDienCuaPid(process.pid)).toBe("co");
  });

  it("★★ P-2: `ESRCH` ⇒ \"vang\" · `EPERM` ⇒ \"co\" (KHÔNG phải \"vang\") · lỗi lạ ⇒ \"khong-biet\"", () => {
    const nem = (code: string) => () => {
      const e = new Error(code) as NodeJS.ErrnoException;
      e.code = code;
      throw e;
    };
    vi.spyOn(process, "kill").mockImplementation(nem("ESRCH") as never);
    expect(hienDienCuaPid(4242)).toBe("vang");
    // ⚠ VẾ SỐNG CÒN: `EPERM` nghĩa là tiến trình **CÓ TỒN TẠI** (chạy dưới tài khoản khác). Đọc nó
    // thành "vắng" là tuyên bố một tiến trình đang sống đã chết ⇒ xoá hàng ⇒ NỚI dư địa.
    vi.spyOn(process, "kill").mockImplementation(nem("EPERM") as never);
    expect(hienDienCuaPid(4242)).toBe("co");
    vi.spyOn(process, "kill").mockImplementation(nem("EINVAL") as never);
    expect(hienDienCuaPid(4242)).toBe("khong-biet");
  });

  it("★★ P-3: `pid <= 0` KHÔNG BAO GIỜ tới được `process.kill` — nó là tín hiệu NHÓM trên POSIX", () => {
    const giet = vi.spyOn(process, "kill").mockImplementation((() => true) as never);
    for (const pid of [0, -1, -1000, 1.5, NaN]) expect(hienDienCuaPid(pid)).toBe("khong-biet");
    expect(giet).not.toHaveBeenCalled();
  });

  it("P-4: `quetPidVangMat` chỉ trả PID CHỨNG MINH ĐƯỢC là vắng — im lặng ≠ vắng", () => {
    const bang: Record<number, SuHienDien> = { 11: "vang", 22: "co", 33: "khong-biet", 44: "vang" };
    __setDauDoHienDienForTests((p) => bang[p] ?? "khong-biet");
    expect([...quetPidVangMat([11, 22, 33, 44])].sort((a, b) => a - b)).toEqual([11, 44]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("K. VỊ TỪ — kênh phụ chỉ nói được MỘT NỬA, và chỉ khi kênh chính câm", () => {
  // ⚠ `ctime` phải TRƯỚC `bootMs` (1787018249695) thì mới là "chính tiến trình đã viết hàng" ⇒
  // "song". Đặt nó SAU `bootMs` là dựng ca PID-CẤP-LẠI, tức một thế giới khác hẳn.
  const procs: Proc[] = [{ pid: 20788, ppid: 1, cmdline: "node", ctime: ft(1787018249695 - 1000) }];

  it("★★★ K-1: `procs === null` + KHÔNG kênh phụ ⇒ \"khong-biet\" (chiều CHẶT, KHÔNG đổi)", () => {
    expect(trangThaiTienTrinh("all:20788:1787018249695", null)).toBe("khong-biet");
    expect(trangThaiTienTrinh("all:20788:1787018249695", null, null)).toBe("khong-biet");
  });

  it("★★★ K-2: `procs === null` + kênh phụ nói VẮNG ⇒ \"chet\"", () => {
    expect(trangThaiTienTrinh("all:20788:1787018249695", null, new Set([20788]))).toBe("chet");
  });

  it("★★★ K-3: `procs === null` + kênh phụ IM về pid đó ⇒ \"khong-biet\", TUYỆT ĐỐI không \"song\"", () => {
    // Kênh phụ có trả lời, nhưng không nêu tên pid này ⇒ ta KHÔNG biết. Trả "song" ở đây sẽ làm hộ
    // của một tiến trình đã chết được coi là "đã có chủ" vĩnh viễn.
    expect(trangThaiTienTrinh("all:20788:1787018249695", null, new Set([999]))).toBe("khong-biet");
  });

  it("★★ K-4: bảng tiến trình ĐỌC ĐƯỢC ⇒ kênh phụ bị BỎ QUA hoàn toàn (không bỏ phiếu)", () => {
    // Kênh phụ khai pid 20788 VẮNG, nhưng bảng tiến trình — nguồn đầy đủ — nói nó CÒN SỐNG.
    // Nguồn đầy đủ phải thắng, nếu không ta có hai vị từ trôi khỏi nhau.
    expect(trangThaiTienTrinh("all:20788:1787018249695", procs, new Set([20788]))).toBe("song");
  });

  it("K-5: `processKey` méo ⇒ \"khong-biet\" kể cả khi kênh phụ khai vắng", () => {
    expect(trangThaiTienTrinh("all:20788", null, new Set([20788]))).toBe("khong-biet");
    expect(tachProcessKey("all:20788")).toBeNull();
    expect(tachProcessKey("all:20788:1787018249695")).toEqual({ pid: 20788, bootMs: 1787018249695 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("G. CA ÂM TRUNG TÂM — dọn ĐÚNG hàng ma, GIỮ NGUYÊN hàng của pid còn sống", () => {
  /**
   * ⚠⚠ ĐÂY LÀ CA MÀ BA ĐỘT BIẾN BẮT BUỘC PHẢI LÀM ĐỎ. Nó KHÔNG chạy trên bảng rỗng: hai hàng vào,
   * và ca khẳng định **cả hai vế** — nếu bộ quét bị gỡ thì vế 1 đỏ; nếu bộ quét quá tay thì vế 2 đỏ.
   */
  it("★★★ G-1: bảng tiến trình ĐỌC ĐƯỢC — ma (vắng mặt) bị xoá, hàng của pid sống CÒN NGUYÊN", () => {
    const procs: Proc[] = [
      // pid 38999 CÒN SỐNG và sinh TRƯỚC `bootMs` của nó ⇒ đúng người đã viết hàng.
      { pid: 38999, ppid: 1, cmdline: "node dist/index.js", ctime: ft(1787198000000) },
    ];
    const ke = keHoach({ rows: [hangMa(), hangSong()], procs });
    expect(ke.xoaHangMa.map((x) => x.processKey), "CHỈ hàng ma bị xoá").toEqual([
      "all:20788:1787018249695",
    ]);
    expect(
      ke.xoaHangMa.some((x) => x.processKey.includes("38999")),
      "hàng của pid CÒN SỐNG tuyệt đối không được đụng",
    ).toBe(false);
  });

  it("★★★ G-2: bảng tiến trình ĐỌC ĐƯỢC — PID ĐÃ CẤP LẠI (ctime > bootMs) bị xoá, pid sống giữ nguyên", () => {
    const procs: Proc[] = [
      // pid 20788 CÓ trong bảng, nhưng sinh SAU `bootMs` ⇒ là một tiến trình KHÁC ⇒ người viết đã chết.
      { pid: 20788, ppid: 1, cmdline: "notepad.exe", ctime: ft(1787100000000) },
      { pid: 38999, ppid: 1, cmdline: "node dist/index.js", ctime: ft(1787198000000) },
    ];
    const ke = keHoach({ rows: [hangMa(), hangSong()], procs });
    expect(ke.xoaHangMa.map((x) => x.processKey)).toEqual(["all:20788:1787018249695"]);
  });

  it("★★★ G-3: KÊNH CHÍNH CÂM + kênh phụ — ma bị xoá, hàng của pid sống CÒN NGUYÊN", () => {
    // Đúng thế giới sản xuất ngày 2026-08-19: `readProcTable()` trả `null` MỌI nhịp.
    const ke = keHoach({ rows: [hangMa(), hangSong()], procs: null, pidVangMat: new Set([20788]) });
    expect(ke.xoaHangMa.map((x) => x.processKey)).toEqual(["all:20788:1787018249695"]);
  });

  /**
   * ★★★ TÍNH CHẤT AN TOÀN MẠNH NHẤT CỦA CẢ BẢN VÁ, và nó được PHÁT HIỆN bởi một ca đỏ chứ không
   * phải được thiết kế trước: **một tiến trình anh em CÒN SỐNG là BẤT KHẢ XÂM PHẠM với kênh phụ,
   * theo CẤU TRÚC — kể cả khi đầu dò nói dối.**
   *
   * Vì sao: mọi tiến trình còn sống **ghi lại toàn bộ giấy phép của nó mỗi 60 s**
   * (`vramSharedLedgerStore.dungLaiTuSoCucBo`), nên `updatedAtMs` của nó **không bao giờ** già hơn
   * ~60 s, trong khi hàng rào tuổi đòi **5 phút**. ⇒ Hai cơ chế độc lập (nhịp sống + hàng rào tuổi)
   * cùng chặn, và cái chặn ấy KHÔNG phụ thuộc vào việc `process.kill(pid,0)` trả lời đúng hay sai.
   *
   * ⇒ Đột biến "đầu dò khai bừa pid còn sống là vắng" **KHÔNG** phá được hệ. Đó là điều ca này khoá.
   */
  it("★★★ G-4: kênh phụ NÓI DỐI (khai pid còn sống là vắng) ⇒ hàng của nó VẪN an toàn nhờ nhịp sống", () => {
    const ke = keHoach({ rows: [hangMa(), hangSong()], procs: null, pidVangMat: new Set([38999, 20788]) });
    expect(
      ke.xoaHangMa.map((x) => x.processKey),
      "hàng của pid sống vừa đồng bộ 30 s trước ⇒ chưa đủ cũ ⇒ KHÔNG bị xoá dù đầu dò khai vắng",
    ).toEqual(["all:20788:1787018249695"]);
  });

  it("★★★ G-5: hàng của CHÍNH TA không bao giờ bị xoá, kể cả khi kênh phụ khai pid ta vắng", () => {
    const cuaTa = hang({ leaseKey: `${SELF}#lease-1`, processKey: SELF, pid: 38432, updatedAtMs: 1 });
    const ke = keHoach({ rows: [cuaTa, hangMa()], procs: null, pidVangMat: new Set([38432, 20788]) });
    expect(ke.xoaHangMa.map((x) => x.processKey)).toEqual(["all:20788:1787018249695"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("T. HÀNG RÀO TUỔI — cửa sổ 'SỚM GIẢ' của `kill(pid,0)` (bài học Pha 3 Task 1)", () => {
  it("★★★ T-1: hàng VỪA đổi (trẻ hơn ngưỡng) ⇒ kênh phụ KHÔNG được phép xoá nó", () => {
    // `ESRCH` về sau ~11-17 ms nhưng byte của một tiến trình CUDA chỉ rời card sau ~500 ms. Xoá
    // trong cửa sổ đó là NỚI dư địa đúng bằng byte của hàng — chiều bị cấm.
    const vuaChet = hangMa({ updatedAtMs: NOW - 1000 });
    expect(keHoach({ rows: [vuaChet], procs: null, pidVangMat: new Set([20788]) }).xoaHangMa).toEqual([]);
  });

  it("★★★ T-2: hàng ĐỦ CŨ ⇒ xoá. Ranh giới đúng tại `TUOI_TOI_THIEU_KENH_PHU_MS`", () => {
    const ngay = hangMa({ updatedAtMs: NOW - TUOI_TOI_THIEU_KENH_PHU_MS });
    const thieu1ms = hangMa({ updatedAtMs: NOW - TUOI_TOI_THIEU_KENH_PHU_MS + 1 });
    expect(keHoach({ rows: [ngay], procs: null, pidVangMat: new Set([20788]) }).xoaHangMa).toHaveLength(1);
    expect(keHoach({ rows: [thieu1ms], procs: null, pidVangMat: new Set([20788]) }).xoaHangMa).toEqual([]);
  });

  it("★★ T-3: hàng rào tuổi KHÔNG áp cho bảng tiến trình — `CreationDate` là bằng chứng tức thời", () => {
    const vuaChet = hangMa({ updatedAtMs: NOW - 1 });
    // pid vắng khỏi bảng ⇒ chết, và không phải chờ 5 phút.
    expect(keHoach({ rows: [vuaChet], procs: [] }).xoaHangMa).toHaveLength(1);
  });

  it("★★★ T-4: `nowMs` KHÔNG hữu hạn ⇒ KHÔNG xoá (không có `?? Date.now()` lén lút)", () => {
    for (const now of [undefined, NaN, Infinity]) {
      expect(
        keHoach({ rows: [hangMa()], procs: null, pidVangMat: new Set([20788]), nowMs: now as number })
          .xoaHangMa,
        `nowMs=${String(now)} phải KHÔNG xoá gì`,
      ).toEqual([]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("R. CÂU TỪ CHỐI — dư địa ÂM phải TỰ KHAI là sổ hỏng", () => {
  function facts(availableBytes: number | null): VramRefusalFacts {
    return {
      appCode: "VRAM_REFUSED",
      owner: "gguf:30B",
      priority: "interactive",
      requestedBytes: 0,
      availableBytes,
      holders: [],
      preemptable: [],
      preemptableBytes: 0,
      foreignLedgerBytes: 54_755 * MIB,
      slotsNeeded: 0,
      degradedReasons: [],
      caveat: "vramLedgerCoverageOnly",
      wiredSiteCount: 1,
      knownSiteRowCount: 1,
      unattributedBytes: 0,
      unledgeredEstimateBytes: 0,
      unknownCount: 0,
    } as unknown as VramRefusalFacts;
  }

  it("★★★ R-1: dư địa ÂM ⇒ câu từ chối GỌI TÊN hàng ma + chỉ đường lệnh ops", () => {
    const cau = formatVramRefusal(facts(-19_054 * MIB));
    expect(cau, "phải nói con số này KHÔNG THỂ là phép đo đúng").toMatch(/DƯ ĐỊA ÂM/);
    expect(cau, "phải nêu đích danh bảng sổ chung").toContain("vram_leases");
    expect(cau, "phải gọi tên HÀNG MA").toMatch(/HÀNG MA/);
    expect(cau, "phải chỉ đường lệnh ops").toContain("releaseStale");
  });

  it("★★★ R-2: dư địa DƯƠNG ⇒ TUYỆT ĐỐI không nhắc hàng ma (không dựng báo động giả)", () => {
    const cau = formatVramRefusal(facts(5_000 * MIB));
    expect(cau).not.toMatch(/DƯ ĐỊA ÂM/);
    expect(cau).not.toMatch(/HÀNG MA/);
  });

  it("★★ R-3: dư địa `0` là RANH GIỚI — hết sạch KHÔNG phải sổ hỏng", () => {
    expect(formatVramRefusal(facts(0))).not.toMatch(/DƯ ĐỊA ÂM/);
  });

  it("R-4: `availableBytes === null` (không tính được) ⇒ đi nhánh riêng, không khai sổ hỏng", () => {
    expect(formatVramRefusal(facts(null))).not.toMatch(/DƯ ĐỊA ÂM/);
  });
});

/**
 * ★★★ Pha 3 Task 2 — SỔ CHUNG: bản sao đọc ĐỒNG BỘ, ghi BẤT ĐỒNG BỘ.
 *
 * ⚠⚠ HAI TIẾN TRÌNH ĐƯỢC DỰNG THẬT, KHÔNG PHẢI ĐƯỢC KHAI BẰNG TAY. Khuôn:
 *   • một **bảng dùng chung** trong bộ nhớ (`BangDungChung`) đóng vai `vram_leases`;
 *   • `__setSharedLedgerSelfKeyForTests()` đổi *"tôi là ai"* ⇒ cùng một bảng, hai danh tính;
 *   • `__resetBrokerForTests()` xoá sổ CỤC BỘ ⇒ đúng nghĩa "một tiến trình khác, bộ nhớ khác".
 * Cả hai chiều đều đi qua **đường thật**: A ghi bằng `reserve()` → `syncSharedLedger()`;
 * B đọc bằng `syncSharedLedger()` → `readSharedLedgerReplica()` → `reserve()`.
 * Không ca nào tự đặt `foreignBytes` bằng tay (ràng buộc 10 — lưới đi theo ĐƯỜNG THOÁT).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetBrokerForTests, commit, deviceUsableBytes, release, reserve, setLeaseRefCount, snapshot,
} from "./vramBroker";
import type { VramDecisionContext } from "./vramBroker";
import { applyEnforcement } from "./vramEnforcement";
import { computeHeadroom } from "./vramHeadroom";
import {
  __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests, drainSharedLedgerWrites,
  publishSharedLedgerReplica, readSharedLedgerReplica, sharedLedgerFact, sharedLedgerSelfKey,
} from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
  syncTimeoutMs,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import { __resetDecisionTickForTests, publishDecisionTick } from "./vramTickCell";
import { safetyReserveBytes } from "./vramCaps";

const MIB = 1024 * 1024;
const NOW = 1_700_000_000_000;
/** Đ4/ràng buộc 7 — fixture đủ lớn để phân biệt: khối 30B. */
const KHOI_30B = 17_000 * MIB;

/** Bảng `vram_leases` GIẢ — một bảng, nhiều tiến trình. Đây là "thế giới ngoài". */
class BangDungChung implements SharedLedgerGateway {
  rows = new Map<string, SharedLeaseRow>();
  soLuotGhi = 0;
  soLuotDoc = 0;
  /** Bật để mô phỏng DB gãy (bảng chưa có, mất kết nối…). */
  nemKhiGhi: Error | null = null;
  nemKhiDoc: Error | null = null;
  /**
   * ⚠ I-1 — chế độ **TREO**: không ném, không trả. Đây là chế độ hỏng mà `nemKhi*` **không dựng
   * được**, và trước lượt vá này không cơ chế nào canh nó (xem describe `C2`).
   */
  treoKhiDoc = false;

  async apply(writes: readonly { op: string; row?: SharedLeaseRow; leaseKey?: string }[]): Promise<void> {
    this.soLuotGhi += 1;
    if (this.nemKhiGhi) throw this.nemKhiGhi;
    for (const w of writes) {
      if (w.op === "upsert" && w.row) this.rows.set(w.row.leaseKey, w.row);
      else if (w.op === "delete" && w.leaseKey) this.rows.delete(w.leaseKey);
    }
  }

  async selectAll(): Promise<readonly SharedLeaseRow[]> {
    this.soLuotDoc += 1;
    if (this.nemKhiDoc) throw this.nemKhiDoc;
    // ⚠ Lời hứa KHÔNG BAO GIỜ giải quyết — đúng nghĩa "DB nhận rồi im".
    if (this.treoKhiDoc) return new Promise<never>(() => {});
    return [...this.rows.values()];
  }
}

let bang: BangDungChung;

/**
 * Ô tick SẠCH — để mọi phép trừ ngoài "sổ chung" bằng 0, và mọi thay đổi quan sát được đều
 * quy về đúng thứ task này thêm vào.
 */
function tickSach(): void {
  publishDecisionTick({ attributableBytes: 0, baselineVerified: true }, NOW);
}

/**
 * ⚠⚠ MỘT ĐỒNG HỒ CHO CẢ HAI TUỔI. `syncSharedLedger()` đóng dấu bản sao bằng **`Date.now()` THẬT**,
 * còn bộ ca này dùng hằng số `NOW`. Trộn hai đồng hồ cho ra `ageMs` **ÂM khổng lồ** ⇒ nhánh *"tuổi
 * không đọc được"* ⇒ `"shared-ledger-stale"` bật oan ở **mọi** ca đã sync. Bản đầu của helper này
 * làm đúng thế, và nó chỉ lộ ra khi ca `I-3` bắt đầu khẳng định `trusted === true`.
 * ⇒ Lấy mốc từ **chính bản sao** khi đã có; chưa có thì mới rơi về `NOW`.
 */
function bayGio(): number {
  return readSharedLedgerReplica()?.atMs ?? NOW;
}

function ctx(): VramDecisionContext {
  const now = bayGio();
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    // ⚠ ĐỌC Ô THẬT — không tự dựng một bản sao đọc bằng tay.
    sharedLedger: sharedLedgerFact(now),
    nowMs: now,
  };
}

function xin(owner: string, bytes: number, over: Partial<Parameters<typeof reserve>[0]> = {}) {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority: "interactive" as const, ...over };
}

beforeEach(() => {
  bang = new BangDungChung();
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetDecisionTickForTests();
  delete process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS;
  __setSharedLedgerGatewayForTests(bang);
  tickSach();
});

afterEach(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetDecisionTickForTests();
  delete process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS;
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("A. HAI TIẾN TRÌNH, MỘT SỔ", () => {
  it("★★★ A-1 — tiến trình B PHẢI THẤY giấy phép 17.000 MiB của tiến trình A (và bị TỪ CHỐI vì nó)", async () => {
    // ── tiến trình A ────────────────────────────────────────────────────────────────────
    __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    expect(a.lease, "A phải được cấp trên một card trống").not.toBeNull();
    await syncSharedLedger();
    expect(bang.rows.size, "sổ chung phải có ĐÚNG hàng của A").toBe(1);

    // ── tiến trình B: bộ nhớ KHÁC (sổ cục bộ rỗng), danh tính KHÁC, CÙNG bảng ───────────
    __resetBrokerForTests();
    __resetSharedLedgerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2002:boot-b");
    tickSach();
    expect(snapshot().totalReservedBytes, "sổ CỤC BỘ của B rỗng").toBe(0);

    await syncSharedLedger();
    const ban = readSharedLedgerReplica();
    expect(ban, "B phải có bản sao đọc sau một lượt làm mới").not.toBeNull();
    expect(ban!.foreignBytes, "B phải THẤY 17.000 MiB của A").toBe(KHOI_30B);
    expect(ban!.foreignLeases.map((r) => r.owner)).toEqual(["gguf:30B@A"]);

    // ⇒ và điều đó phải ĐỔI QUYẾT ĐỊNH, không chỉ đổi một con số hiển thị.
    const b = reserve(xin("gguf:30B@B", KHOI_30B), ctx());
    expect(b.lease, "B xin thêm 17.000 MiB ⇒ PHẢI bị từ chối vì A đang giữ").toBeNull();
    expect(b.decision.ledgerTotalBytes, "sổ mà B quyết định trên = CỤC BỘ + CHUNG").toBe(KHOI_30B);
  });

  /**
   * ★★★ I-2 (review vòng 1) — **HAI TIẾN TRÌNH CÙNG VAI TRÒ.** Hai đột biến của reviewer SỐNG SÓT
   * 590/590 vì **cả năm cặp fixture** ở bộ ca này đều là `"api:…"` ⟷ `"worker:…"` — hai VAI KHÁC
   * NHAU, LUÔN LUÔN — nên một phép lọc bằng **role** (thay vì `processKey` đầy đủ) **vô tình phân
   * biệt được**. Lưới đi theo **hình dạng fixture**, không theo **đường thoát**: lần thứ CHÍN.
   *
   * ⚠ "Hai tiến trình cùng vai" là dân số **CÓ THẬT** và không hiếm: nhiều `worker`; một lượt khởi
   * động lại chồng lấn (worker cũ chưa thoát hẳn, worker mới đã lên); và **mọi tiến trình không
   * đặt `ROLE`** — `sharedLedgerSelfKey()` mặc định `"all"`, nên hai script CLI/cron bất kỳ đều là
   * `all:…`. Dưới đột biến đó chúng **vô hình với nhau** — đúng cái lỗ mà cả Pha 3 tồn tại để bịt.
   */
  it("★★★ I-2 — HAI TIẾN TRÌNH CÙNG VAI TRÒ vẫn phải thấy nhau (vị từ là `processKey`, KHÔNG phải role)", async () => {
    __setSharedLedgerSelfKeyForTests("worker:1001:boot-a");
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    expect(a.lease).not.toBeNull();
    await syncSharedLedger();

    // Tiến trình thứ hai — **CÙNG VAI `worker`**, chỉ khác pid + bootMs.
    __resetBrokerForTests();
    __resetSharedLedgerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2002:boot-b");
    tickSach();
    await syncSharedLedger();

    const ban = readSharedLedgerReplica();
    expect(ban!.foreignBytes, "cùng vai KHÔNG có nghĩa là cùng tiến trình").toBe(KHOI_30B);
    expect(ban!.foreignLeases.map((r) => r.role), "hộ ngoài mang ĐÚNG vai `worker`").toEqual(["worker"]);
    expect(reserve(xin("gguf:30B@B", KHOI_30B), ctx()).lease, "PHẢI bị từ chối").toBeNull();
  });

  /**
   * ★★★ I-2 (vế `bootMs`) — **HĐH CẤP LẠI PID.** `bootMs` có docstring ở `vramSharedLedger.ts`, có
   * mặt trong cột `processKey` của `drizzle/0312_vram_leases.sql`, có lý lẽ dẫn thẳng nợ **N2-2**
   * của Pha 2A… và **KHÔNG CÓ MỘT CA NÀO** — nên một đột biến bỏ hẳn `bootMs` (lọc bằng pid) sống
   * sót 590/590.
   *
   * ⚠ Hậu quả nếu mất `bootMs`: một `worker` chết, HĐH cấp lại đúng PID cho tiến trình mới, và
   * tiến trình mới **coi giấy phép của người đã chết là CỦA MÌNH** ⇒ nó tự trừ dư địa cho một khối
   * byte **không tồn tại**, và không ai dọn hàng đó (sổ cục bộ của nó không có giấy phép ấy để
   * dựng lại, cũng không có lệnh `delete` nào được phát). Chiều hỏng: **khoá VRAM vĩnh viễn**.
   */
  it("★★★ I-2 (bootMs) — CÙNG vai CÙNG pid, khác `bootMs` ⇒ hàng của 'kiếp trước' là NGOÀI, không phải của ta", async () => {
    __setSharedLedgerSelfKeyForTests("worker:7777:boot-CU");
    reserve(xin("gguf:30B@kiepTruoc", KHOI_30B), ctx());
    await syncSharedLedger();
    expect(bang.rows.size).toBe(1);

    // Tiến trình MỚI nhận lại ĐÚNG pid 7777 — chỉ `bootMs` khác.
    __resetBrokerForTests();
    __resetSharedLedgerForTests();
    __setSharedLedgerSelfKeyForTests("worker:7777:boot-MOI");
    tickSach();
    await syncSharedLedger();

    const ban = readSharedLedgerReplica();
    expect(
      ban!.foreignBytes,
      "cùng pid KHÔNG có nghĩa là cùng tiến trình — HĐH cấp lại PID (nợ N2-2 Pha 2A)",
    ).toBe(KHOI_30B);
    expect(ban!.foreignLeases[0]!.pid, "và hàng đó THẬT SỰ mang cùng pid").toBe(7777);
    expect(reserve(xin("gguf:x", KHOI_30B), ctx()).lease, "PHẢI bị từ chối").toBeNull();
  });

  it("★★★ A-2 — KHÔNG có sổ chung thì B vẫn cấp (chứng minh A-1 đo đúng thứ nó nói)", async () => {
    __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
    reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    await syncSharedLedger();

    __resetBrokerForTests();
    __resetSharedLedgerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2002:boot-b");
    tickSach();
    // CỐ Ý KHÔNG `syncSharedLedger()` — B chưa từng đọc sổ chung.
    const b = reserve(xin("gguf:30B@B", KHOI_30B), ctx());
    expect(b.lease, "chưa đọc sổ chung ⇒ B không thấy A ⇒ vẫn cấp (đây là hành vi CŨ)").not.toBeNull();
  });

  it("★★★ A-3 — hàng của CHÍNH TA trong sổ chung KHÔNG bị đếm hai lần", async () => {
    __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    const ban = readSharedLedgerReplica();
    expect(ban!.foreignBytes, "hàng của chính ta ⇒ 0 byte NGOÀI").toBe(0);
    // ⚠ `ledgerTotalBytes` là sổ ĐỌC LÚC QUYẾT ĐỊNH, tức TRƯỚC khi giấy phép mới vào sổ.
    const r = reserve(xin("gguf:b", 1 * MIB), ctx());
    expect(r.decision.ledgerTotalBytes, "sổ = 5.000 MiB, KHÔNG phải 10.000 (đếm hai lần)").toBe(5_000 * MIB);
    expect(r.decision.foreignLedgerBytes, "hàng của chính ta ⇒ phần NGOÀI = 0").toBe(0);
    expect(r.decision.localLedgerBytes).toBe(5_000 * MIB);
    expect(a.lease).not.toBeNull();
    expect(r.lease).not.toBeNull();
  });

  it("★★★ A-4 — LƯỢT NHẢ của A biến mất khỏi sổ chung ⇒ B lại cấp được", async () => {
    __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    await syncSharedLedger();
    release(a.lease!);
    await syncSharedLedger();
    expect(bang.rows.size, "release() phải XOÁ hàng khỏi sổ chung").toBe(0);

    __resetBrokerForTests();
    __resetSharedLedgerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2002:boot-b");
    tickSach();
    await syncSharedLedger();
    expect(readSharedLedgerReplica()!.foreignBytes).toBe(0);
    expect(reserve(xin("gguf:30B@B", KHOI_30B), ctx()).lease).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("B. `reserve()` VẪN ĐỒNG BỘ — lá chắn cấu trúc Pha 1", () => {
  it("★★★ B-1 — `reserve()` trả THẲNG kết quả, KHÔNG phải Promise, kể cả khi sổ chung đang bận", () => {
    const r = reserve(xin("gguf:a", 100 * MIB), ctx());
    expect(r instanceof Promise).toBe(false);
    expect(r.lease).not.toBeNull();
  });

  it("★★★ B-2 — đường quyết định KHÔNG chạm gateway (0 lượt đọc, 0 lượt ghi DB)", () => {
    bang.soLuotDoc = 0;
    bang.soLuotGhi = 0;
    for (let i = 0; i < 5; i++) reserve(xin(`gguf:${i}`, 10 * MIB), ctx());
    expect(bang.soLuotDoc, "reserve() không được đọc DB").toBe(0);
    expect(bang.soLuotGhi, "reserve() không được ghi DB").toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("C. GHI HỎNG ⇒ GIẤY PHÉP VẪN CÓ HIỆU LỰC CỤC BỘ, NHƯNG CÓ CỜ VÀ CÓ TIẾNG", () => {
  it("★★★ C-1 — DB ném ⇒ lease vẫn sống cục bộ · `unsyncedWrites > 0` · KÊU", async () => {
    const keu = vi.spyOn(console, "warn").mockImplementation(() => {});
    bang.nemKhiGhi = new Error('relation "vram_leases" does not exist');
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    expect(a.lease, "ghi hỏng KHÔNG được làm hỏng lượt xin").not.toBeNull();

    await syncSharedLedger();

    expect(snapshot().totalReservedBytes, "giấy phép vẫn có hiệu lực CỤC BỘ").toBe(5_000 * MIB);
    const fact = sharedLedgerFact(bayGio());
    expect(fact?.unsyncedWrites ?? 0, "phải GẮN CỜ chưa đồng bộ").toBeGreaterThan(0);
    expect(keu, "phải CÓ TIẾNG").toHaveBeenCalled();
    expect(keu.mock.calls.flat().join(" ")).toMatch(/sổ chung|vram_leases/i);
  });

  it("★★★ C-2 — cờ chưa-đồng-bộ LÀM HỆ CHẶT HƠN (lý do + phụ phí), không phải chỉ một dòng log", async () => {
    bang.nemKhiDoc = null;
    // nền: một lượt SẠCH để lấy dư địa cơ sở
    await syncSharedLedger();
    const sach = reserve(xin("gguf:base", 1 * MIB), ctx());
    __resetBrokerForTests();

    vi.spyOn(console, "warn").mockImplementation(() => {});
    bang.nemKhiGhi = new Error("db down");
    reserve(xin("gguf:x", 1 * MIB), ctx());
    await syncSharedLedger();
    __resetBrokerForTests();

    const hong = reserve(xin("gguf:y", 1 * MIB), ctx());
    expect(hong.decision.reasons, "lý do phải NÓI RA").toContain("shared-ledger-unsynced");
    expect(hong.decision.trusted).toBe(false);
    expect(
      hong.decision.effectiveHeadroomBytes,
      "chưa đồng bộ ⇒ dư địa hiệu lực phải NHỎ HƠN lượt sạch",
    ).toBeLessThan(sach.decision.effectiveHeadroomBytes);
  });

  /**
   * ★★★ C-4 — NỬA NGUY HIỂM CỦA "GIỮ Ý ĐỊNH GHI", VÀ NÓ ĐƯỢC TÌM RA BẰNG ĐỘT BIẾN.
   *
   * Đột biến "ghi hỏng IM LẶNG" (vòng 1) giết C-1 và C-2 nhưng **C-3 SỐNG SÓT**. Lý do: một ý định
   * `upsert` **tự dựng lại được** từ sổ CỤC BỘ ở lượt đồng bộ sau (`dungLaiTuSoCucBo()`), nên C-3
   * xanh nhờ một cơ chế KHÁC với cơ chế nó tưởng đang canh — đúng nghĩa một lưới giả.
   *
   * ⚠⚠ Ý định `delete` thì **KHÔNG dựng lại được**: giấy phép đã rời sổ cục bộ, không còn gì để
   * suy ra. Mất nó ⇒ **HÀNG MA nằm lại trong `vram_leases` VĨNH VIỄN** ⇒ mọi tiến trình anh em trừ
   * dư địa cho một khối byte **đã nhả**, cho tới khi có người xoá tay. Với hộ sidecar thị giác đó
   * là **7,8 GB bị khoá khỏi cả cụm** vì một lượt mất kết nối 200 ms.
   * ⇒ Đây mới là nửa cần `requeueSharedLedgerWrites()`, và trước ca này nó KHÔNG có lưới nào.
   */
  it("★★★ C-4 — lệnh XOÁ hỏng KHÔNG được bốc hơi (mất nó ⇒ HÀNG MA khoá byte của cả cụm)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    expect(bang.rows.size).toBe(1);

    // Nhả THẬT (đường `release()`), nhưng DB gãy đúng lúc đó.
    bang.nemKhiGhi = new Error("db down giữa lượt xoá");
    release(a.lease!);
    await syncSharedLedger();
    expect(bang.rows.size, "DB gãy ⇒ hàng còn nằm đó (đây là cửa sổ HÀNG MA)").toBe(1);
    expect(sharedLedgerFact(bayGio())?.unsyncedWrites ?? 0, "phải GẮN CỜ").toBeGreaterThan(0);

    // DB lành ⇒ lệnh xoá phải được THỬ LẠI. Sổ cục bộ KHÔNG còn giấy phép nào để suy ra lệnh này.
    bang.nemKhiGhi = null;
    await syncSharedLedger();
    expect(bang.rows.size, "lệnh XOÁ phải được giữ và thử lại — nếu không, hàng MA ở lại mãi").toBe(0);
    expect(sharedLedgerFact(bayGio())?.unsyncedWrites ?? -1, "đồng bộ xong ⇒ cờ TẮT").toBe(0);
  });

  it("★★★ C-3 — lượt ghi HỎNG được GIỮ LẠI để thử lại, không bốc hơi", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    bang.nemKhiGhi = new Error("db down");
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    expect(bang.rows.size).toBe(0);

    bang.nemKhiGhi = null;
    await syncSharedLedger();
    expect(bang.rows.size, "lượt sau DB lành ⇒ hàng phải lên sổ chung").toBe(1);
    expect([...bang.rows.values()][0]!.bytes).toBe(5_000 * MIB);
    expect(sharedLedgerFact(bayGio())?.unsyncedWrites ?? -1, "đồng bộ xong ⇒ cờ phải TẮT").toBe(0);
    expect(a.lease).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("C2. 🔴 I-1 — 'DB TREO' KHÁC 'DB NÉM', và trước lượt vá này KHÔNG AI CANH", () => {
  /**
   * ⚠⚠ Toàn bộ họ ca `C-*` mô phỏng hỏng bằng **NÉM**. Một lượt **TREO** (Postgres nhận TCP nhưng
   * không trả · pool 25 kết nối cạn nên truy vấn **xếp hàng trong JS** nơi `statement_timeout`
   * chưa áp · `DB_STATEMENT_TIMEOUT_MS=0`) đi một đường khác hẳn, và **mọi** cơ chế phòng vệ im:
   * không ném ⇒ `consecutiveFailures` đứng `0` · `keuMotLan()` không chạy ⇒ **không một dòng cảnh
   * báo** · `dangDongBo` không bao giờ về `null` ⇒ **mọi** lượt sync sau đó là no-op ⇒ lệnh
   * `delete` của `release()` nằm lại **VÔ THỜI HẠN** ⇒ đúng **HÀNG MA** mà `C-4` sinh ra để chống,
   * qua một cửa `C-4` không đi qua.
   */
  it("★★★ I-1 — DB TREO (không ném) ⇒ QUÁ HẠN phải ĐẾM NHƯ MỘT LƯỢT HỎNG, KÊU, và KHÔNG kẹt `dangDongBo`", async () => {
    const keu = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS = "30";
    // TREO: không ném, không trả — đúng chế độ mà `nemKhiDoc/nemKhiGhi` KHÔNG dựng được.
    bang.treoKhiDoc = true;

    reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();

    expect(keu, "TREO phải CÓ TIẾNG, y như NÉM").toHaveBeenCalled();
    expect(keu.mock.calls.flat().join(" ")).toMatch(/QUÁ HẠN|TREO/i);

    // ⚠ Và quan trọng nhất: khoá KHÔNG kẹt — lượt sau phải CHẠY THẬT, không trả lại lời hứa treo.
    bang.treoKhiDoc = false;
    bang.soLuotDoc = 0;
    await syncSharedLedger();
    expect(bang.soLuotDoc, "`dangDongBo` không được kẹt: lượt sau phải đi DB thật").toBeGreaterThan(0);
    expect(readSharedLedgerReplica(), "và lượt sau phải xuất bản được bản sao").not.toBeNull();
  });

  it("★★★ I-1b — hạn RÁC/DƯỚI SÀN ⇒ vẫn dùng mặc định, KHÔNG thành một phép đo tức thời (dây `??`)", () => {
    for (const rac of ["", "abc", "0", "-5", "NaN"]) {
      process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS = rac;
      expect(syncTimeoutMs(), `hạn="${rac}"`).toBe(120_000);
    }
    process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS = "5000";
    expect(syncTimeoutMs(), "số hợp lệ thì PHẢI được tôn trọng").toBe(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("C3. I-3 — cờ chưa-đồng-bộ chỉ bắn cho ý định ĐỔI BYTE", () => {
  /**
   * ⚠⚠ `llamaVisionSidecar`/`aiGgufEngine` gọi `noteRefCount()` **mỗi lượt request vào/ra** ⇒ với
   * phép đếm cũ (`hangCho.length`), một `worker` **đang phục vụ** mang `shared-ledger-unsynced`
   * gần như liên tục ⇒ `trusted:false` **thường trực** + **−1.024 MiB thường trực**.
   * *Một cờ luôn bật là một cờ không còn thông tin* — đúng lớp NHIỄU mà Wave 3/4 tốn hai đợt để dập.
   */
  it("★★★ I-3 — bump `refCount` KHÔNG đổi byte ⇒ KHÔNG bật `shared-ledger-unsynced`", async () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB, { reclaimer: "gguf-idle-model" }), ctx());
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())?.unsyncedWrites, "đồng bộ xong ⇒ 0").toBe(0);

    // Đúng thứ xảy ra mỗi lượt suy luận: refCount 1 → 0 → 1 → 0. KHÔNG một byte nào đổi.
    for (const n of [0, 1, 0]) setLeaseRefCount(a.lease!.id, n);

    const fact = sharedLedgerFact(bayGio());
    expect(fact!.unsyncedWrites, "bump refCount KHÔNG phải một sự cố đồng bộ").toBe(0);
    const r = reserve(xin("gguf:b", 1 * MIB), { ...ctx(), sharedLedger: fact });
    expect(r.decision.reasons).not.toContain("shared-ledger-unsynced");
    expect(r.decision.trusted, "một worker BẬN không được mất tin cậy vì chính việc nó bận").toBe(true);
  });

  it("★★★ I-3 (chiều NGƯỢC) — ý định ĐỔI BYTE vẫn phải bật cờ", async () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())?.unsyncedWrites).toBe(0);

    // `commit()` thay ước lượng bằng số ĐO ⇒ byte anh em đọc SẼ khác ⇒ phải bật cờ.
    commit(a.lease!, 9_000 * MIB, "process-delta");
    expect(sharedLedgerFact(bayGio())!.unsyncedWrites, "đổi byte ⇒ anh em đang đọc số SAI").toBeGreaterThan(0);
  });

  it("★★★ I-3 (giấy phép MỚI) — chưa công bố lần nào ⇒ vẫn đếm (không nới ở chiều nguy hiểm)", async () => {
    await syncSharedLedger();
    reserve(xin("gguf:moi", 17_000 * MIB), ctx());
    expect(
      sharedLedgerFact(bayGio())!.unsyncedWrites,
      "hàng chưa từng lên sổ chung ⇒ anh em KHÔNG thấy 17 GB của ta",
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("D. BẢN SAO ĐỌC CŨ LÀ 'PHẠM TRÙ THỨ BA' — giữ SỐ, cộng biên, hạ `trusted`", () => {
  it("★★★ D-1 — bản sao đọc CŨ vẫn GIỮ NGUYÊN byte của anh em (TUYỆT ĐỐI không về null/0)", async () => {
    __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
    reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    await syncSharedLedger();

    __resetBrokerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2002:boot-b");
    await syncSharedLedger();

    // 10 phút sau — bản sao đọc đã rất cũ. ⚠ Mốc lấy từ CHÍNH bản sao (`syncSharedLedger()` đóng
    // dấu bằng đồng hồ THẬT), không từ hằng số `NOW` của bộ ca: hai đồng hồ khác nhau thì "tuổi"
    // là một con số vô nghĩa.
    const giaMs = readSharedLedgerReplica()!.atMs + 600_000;
    const fact = sharedLedgerFact(giaMs);
    expect(fact, "cũ KHÔNG phải null — null là 'chưa hỏi', hai chuyện khác nhau").not.toBeNull();
    expect(fact!.ageMs).toBe(600_000);

    const r = reserve(xin("gguf:B", 1 * MIB), {
      tick: { attributableBytes: 0, baselineVerified: true, atMs: giaMs, consecutiveFailures: 0 },
      unledgered: { bytes: 0, unknownCount: 0 },
      sharedLedger: fact,
      nowMs: giaMs,
    });
    expect(r.decision.ledgerTotalBytes, "byte của anh em PHẢI còn nguyên trong phép tính").toBe(KHOI_30B);
    expect(r.decision.foreignLedgerBytes, "và phải khai đúng đó là phần của ANH EM").toBe(KHOI_30B);
    expect(r.decision.sharedLedgerAgeMs, "độ trễ cưỡng chế phải KHAI ra").toBe(600_000);
    expect(r.decision.reasons).toContain("shared-ledger-stale");
    expect(r.decision.trusted).toBe(false);
    expect(r.decision.sharedLedgerMarginBytes, "phải CỘNG BIÊN theo tuổi").toBeGreaterThan(0);
  });

  it("★★★ D-2 — biên theo tuổi CÓ TRẦN (một đơn vị mất-tin-cậy), không phải phép nhân không đáy", async () => {
    await syncSharedLedger();
    const gia = readSharedLedgerReplica()!.atMs + 10_000_000;
    const mot = sharedLedgerFact(gia);
    const r = reserve(xin("gguf:a", 1 * MIB), {
      tick: { attributableBytes: 0, baselineVerified: true, atMs: gia, consecutiveFailures: 0 },
      unledgered: { bytes: 0, unknownCount: 0 },
      sharedLedger: mot,
      nowMs: gia,
    });
    expect(r.decision.sharedLedgerMarginBytes).toBe(1024 * MIB);
  });

  /**
   * ★★★ I-4 (review vòng 1) — **KHOÁ ĐIỂM BÃO HOÀ, VÌ "BIÊN THEO TUỔI" THẬT RA LÀ MỘT THUẾ PHẲNG.**
   *
   * `trần / tốc_độ = 1.073.741.824 / 1.591.942 ≈ 674 ms`, trong khi nhịp làm mới là **60.000 ms**
   * ⇒ **≥ 98,9 % thời gian biên đứng NGUYÊN Ở TRẦN**. Một tiến trình khoẻ mạnh vẫn mất
   * `staleMarginBytes` 1.024 MiB **+** `sharedLedgerMarginBytes` 1.024 MiB = **~2 GiB thường trực**.
   * Ca này khoá cả hai mép để con số đó **không trôi trong im lặng** (đổi `rate` hay `unit` mà quên
   * khai là đúng thứ I-4 vừa bắt).
   */
  it("★★★ I-4 — biên 'theo tuổi' BÃO HOÀ ở ~674 ms: 673 ms CHƯA kịch trần, 675 ms ĐÃ kịch trần", () => {
    const bien = (ageMs: number) =>
      applyEnforcement({
        headroom: computeHeadroom({
          ceilingBytes: 32_607 * MIB,
          safetyReserveBytes: 1024 * MIB,
          ledgerTotalBytes: 0,
          attributableBytes: 0,
          baselineVerified: true,
        }),
        tickAgeMs: 0,
        tickConsecutiveFailures: 0,
        unledgered: { bytes: 0, unknownCount: 0 },
        sharedLedger: { foreignBytes: 0, ageMs, unsyncedWrites: 0, consecutiveFailures: 0 },
      }).sharedLedgerMarginBytes;

    expect(bien(1), "hệ số đo được ở nghiệm thu SỐNG: ageMs=1 ⇒ 1.591.942").toBe(1_591_942);
    expect(bien(673), "673 ms — CHƯA chạm trần").toBeLessThan(1024 * MIB);
    expect(bien(675), "675 ms — ĐÃ kịch trần").toBe(1024 * MIB);
    expect(bien(60_000), "ở NHỊP THẬT (60 s) nó là một khoản trừ CỐ ĐỊNH, không 'theo tuổi'").toBe(1024 * MIB);
  });

  it("★★★ D-3 — CHƯA LÀM MỚI LẦN NÀO (`null`) là MÙ ⇒ CHẶT HƠN, không phải 'không có ai khác'", () => {
    const chuaHoi = reserve(xin("gguf:a", 1 * MIB), { ...ctx(), sharedLedger: null });
    expect(chuaHoi.decision.reasons).toContain("shared-ledger-unasked");
    expect(chuaHoi.decision.trusted).toBe(false);

    // so với một lượt ĐÃ làm mới (cùng mọi thứ khác)
    publishSharedLedgerReplica([], NOW, sharedLedgerSelfKey());
    const daHoi = reserve(xin("gguf:b", 1 * MIB), ctx());
    expect(
      chuaHoi.decision.effectiveHeadroomBytes,
      "chưa hỏi phải CHẶT HƠN đã hỏi",
    ).toBeLessThan(daHoi.decision.effectiveHeadroomBytes);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("E. 🔴 BẰNG CHỨNG NHẢ PHẢI LÀ MỘT LƯỢT GHI TƯỜNG MINH — phát hiện của Task 1", () => {
  it("★★★ E-1 — `release()` TỰ phát lệnh xoá (không đợi ai đó thấy hàng biến mất)", () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    drainSharedLedgerWrites();               // dọn lượt ghi của `reserve()`
    release(a.lease!);
    const w = drainSharedLedgerWrites();
    expect(w.length, "release() PHẢI xếp hàng ĐÚNG MỘT lệnh").toBe(1);
    expect(w[0]!.op).toBe("delete");
    expect(w[0]!.leaseKey).toBe(`${sharedLedgerSelfKey()}#${a.lease!.id}`);
  });

  /**
   * ⚠ HẠ GIỌNG CÓ CHỦ Ý (đo được ở vòng đột biến 3): ca này canh **hậu quả** — sổ cục bộ và giấy
   * phép không đổi khi hàng biến mất — nhưng nó **KHÔNG bắt được** một cơ chế suy luận theo hiệu
   * số, vì lượt ghi-lại-từ-sổ-cục-bộ (E-3) đưa hàng trở lại bảng **trước** phép đọc. Lưới đích
   * danh cho phép suy luận bị cấm là **E-4**; ca này là vành đai ngoài, không phải mũi nhọn.
   */
  it("★★★ E-2 — hàng BIẾN KHỎI bản sao đọc KHÔNG phải bằng chứng ta đã nhả (hình dạng lỗi T5-11)", async () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    expect(bang.rows.size).toBe(1);

    // Ai đó (một tiến trình khác, một lượt dọn dẹp, một lượt mất kết nối) xoá hàng của TA.
    bang.rows.clear();
    await syncSharedLedger();

    expect(
      snapshot().totalReservedBytes,
      "sổ CỤC BỘ là chủ về giấy phép của chính ta — hàng biến mất KHÔNG nhả nó",
    ).toBe(5_000 * MIB);
    expect(a.lease!.released, "giấy phép KHÔNG được tự khai đã nhả").toBe(false);
    const r = reserve(xin("gguf:b", 1 * MIB), ctx());
    expect(r.decision.ledgerTotalBytes, "5.000 MiB vẫn phải nằm trong phép tính").toBe(5_000 * MIB);
  });

  it("★★★ E-3 — giấy phép của ta bị xoá ngoài ý muốn ⇒ lượt đồng bộ sau DỰNG LẠI nó", async () => {
    reserve(xin("gguf:a", 5_000 * MIB), ctx());
    await syncSharedLedger();
    bang.rows.clear();
    await syncSharedLedger();
    expect(bang.rows.size, "sổ chung phải được ghi lại từ sổ CỤC BỘ (nguồn sự thật của ta)").toBe(1);
  });

  /**
   * ★★★ E-4 — LƯỚI ĐÍCH DANH CHO PHÉP SUY LUẬN BỊ CẤM, VÀ NÓ RA ĐỜI VÌ MỘT ĐỘT BIẾN SỐNG SÓT.
   *
   * ⚠⚠ E-2 **KHÔNG** bắt được đột biến *"hàng vắng trong bản sao đọc ⇒ coi như đã nhả"*, và lý do
   * đáng ghi lại: mỗi lượt đồng bộ **GHI LẠI** giấy phép của ta từ sổ cục bộ (E-3) **TRƯỚC** khi
   * đọc, nên trong kịch bản của E-2 hàng đã quay lại bảng đúng lúc phép đọc chạy — cơ chế E-3
   * **che mất** đột biến. Đo được: đột biến vòng 3 giết C-1 và C-3 nhưng E-2 **XANH**.
   *
   * ⇒ Kịch bản dựng đúng cửa sổ đó, và nó là một ca SẢN XUẤT có thật chứ không phải một dàn dựng:
   * **DB cho ĐỌC nhưng từ chối GHI** (bảng thiếu · quyền chỉ-đọc · replica chỉ-đọc · đĩa đầy).
   * Khi ấy hàng của ta **thật sự vắng** trong lượt đọc, và một cơ chế suy luận theo hiệu số sẽ
   * **nhả giấy phép 5.000 MiB của một khối byte đang nằm trên card** — sổ khai trống, card vẫn
   * giữ, lượt xin kế tiếp được cấp trên chỗ trống ma. Đúng lớp lỗi T5-11, và đúng thứ phát hiện
   * `kill(pid,0)` sớm giả của Task 1 cấm.
   */
  it("★★★ E-4 — DB cho ĐỌC nhưng chặn GHI ⇒ hàng vắng trong lượt đọc VẪN KHÔNG nhả giấy phép", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    bang.nemKhiGhi = new Error("permission denied for table vram_leases");

    await syncSharedLedger();

    expect(bang.rows.size, "ghi bị chặn ⇒ bảng KHÔNG có hàng của ta").toBe(0);
    expect(readSharedLedgerReplica()!.foreignLeases.length, "và lượt ĐỌC vẫn chạy").toBe(0);
    expect(
      snapshot().totalReservedBytes,
      "🔴 hàng VẮNG trong bản sao đọc KHÔNG phải bằng chứng ta đã nhả — sổ CỤC BỘ là chủ",
    ).toBe(5_000 * MIB);
    expect(a.lease!.released, "giấy phép KHÔNG được tự khai đã nhả").toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("F. Ô DỮ LIỆU ĐI RA SỔ CHUNG", () => {
  it("★★★ F-1 — `refCount` đi ra sổ chung (Task 5 đứng trên nó để thu hồi xuyên tiến trình)", async () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB, { reclaimer: "gguf-idle-model" }), ctx());
    setLeaseRefCount(a.lease!.id, 0);
    await syncSharedLedger();
    const row = [...bang.rows.values()][0]!;
    expect(row.refCount).toBe(0);
    expect(row.reclaimer).toBe("gguf-idle-model");
    expect(row.pid).toBe(process.pid);
  });

  it("★★★ F-2 — KHÔNG giá trị không hữu hạn nào ra sổ chung (cột `bigint` ⇒ mất CẢ LÔ)", async () => {
    const a = reserve(xin("gguf:a", 5_000 * MIB), ctx());
    // đẩy một số bẩn vào sổ SỐNG bằng đúng cửa mà mã sản xuất dùng
    (a.lease as { actualBytes: number | null }).actualBytes = Number.NaN;
    await syncSharedLedger();
    for (const row of bang.rows.values()) {
      expect(Number.isFinite(row.bytes), `bytes=${row.bytes} phải HỮU HẠN`).toBe(true);
      expect(Number.isFinite(row.refCount)).toBe(true);
      expect(Number.isFinite(row.acquiredAtMs)).toBe(true);
    }
  });

  /**
   * ★★★ M-1 (review vòng 1) — `rowFromLease()` tự nhận là "cửa vào DUY NHẤT" lọc mọi ô, nhưng bản
   * trước **chỉ lọc SỐ** — trong khi tiền lệ mà chính docstring của nó viện dẫn (migration 0311,
   * `22001`, **mất CẢ LÔ**) là một lỗi **CHUỖI**. `owner` là chuỗi ĐỘNG lấy từ **đường dẫn tuyệt
   * đối** (`onnx-ocr:${modelPath}` · `reranker:${modelPath}`) ⇒ một lượt đổi thư mục model là đủ
   * vượt `varchar(160)`.
   * ⚠ Và ở bảng này hậu quả NẶNG HƠN `vram_events`: `requeueSharedLedgerWrites()` **ném lại đúng
   * hàng độc** ⇒ hỏng **VĨNH VIỄN**, `unsyncedWrites` không bao giờ về 0 — tức cơ chế thử-lại biến
   * một lỗi TẠM thành một lỗi CHẾT.
   */
  it("★★★ M-1 — chuỗi VƯỢT độ rộng `varchar` bị CẮT, không để `22001` làm mất cả lô", async () => {
    const duongDanDai = `onnx-ocr:${"D:/rat/rat/dai/".repeat(30)}model.onnx`;
    expect(duongDanDai.length, "fixture phải THẬT SỰ vượt 160").toBeGreaterThan(160);
    reserve(xin(duongDanDai, 1_000 * MIB), ctx());
    await syncSharedLedger();

    const row = [...bang.rows.values()][0]!;
    // Các con số đúng bằng độ rộng cột ở `drizzle/0312_vram_leases.sql`.
    expect(row.owner.length, "owner varchar(160)").toBeLessThanOrEqual(160);
    expect(row.leaseKey.length, "leaseKey varchar(200)").toBeLessThanOrEqual(200);
    expect(row.processKey.length, "processKey varchar(96)").toBeLessThanOrEqual(96);
    expect(row.role.length, "role varchar(32)").toBeLessThanOrEqual(32);
    expect(row.leaseId.length, "leaseId varchar(64)").toBeLessThanOrEqual(64);
    expect(row.owner, "CẮT chứ không VỨT — phần đầu phải còn nhận ra được").toContain("onnx-ocr:");
  });

  it("★★★ F-3 — dư địa PHẢI trừ cả sổ chung: một anh em 17.000 MiB đẩy dư địa xuống đúng chừng ấy", async () => {
    __setSharedLedgerSelfKeyForTests("api:1:a");
    reserve(xin("gguf:30B@A", KHOI_30B), ctx());
    await syncSharedLedger();
    __resetBrokerForTests();
    __setSharedLedgerSelfKeyForTests("worker:2:b");
    await syncSharedLedger();
    const r = reserve(xin("gguf:b", 1 * MIB), ctx());
    // dư địa thô = trần − đệm − max(sổ, attributable=0), và sổ ở đây là **của anh em** (cục bộ = 0).
    expect(r.decision.headroomBytes).toBe(deviceUsableBytes() - safetyReserveBytes() - KHOI_30B);
  });
});

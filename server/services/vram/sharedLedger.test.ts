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
  __resetBrokerForTests, deviceUsableBytes, release, reserve, setLeaseRefCount, snapshot,
} from "./vramBroker";
import type { VramDecisionContext } from "./vramBroker";
import {
  __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests, drainSharedLedgerWrites,
  publishSharedLedgerReplica, readSharedLedgerReplica, sharedLedgerFact, sharedLedgerSelfKey,
} from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import {
  __setSharedLedgerGatewayForTests, syncSharedLedger,
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

function ctx(): VramDecisionContext {
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: NOW, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    // ⚠ ĐỌC Ô THẬT — không tự dựng một bản sao đọc bằng tay.
    sharedLedger: sharedLedgerFact(NOW),
    nowMs: NOW,
  };
}

function xin(owner: string, bytes: number, over: Partial<Parameters<typeof reserve>[0]> = {}) {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority: "interactive" as const, ...over };
}

beforeEach(() => {
  bang = new BangDungChung();
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(bang);
  tickSach();
});

afterEach(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetDecisionTickForTests();
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
    const fact = sharedLedgerFact(NOW);
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
    expect(sharedLedgerFact(NOW)?.unsyncedWrites ?? -1, "đồng bộ xong ⇒ cờ phải TẮT").toBe(0);
    expect(a.lease).not.toBeNull();
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

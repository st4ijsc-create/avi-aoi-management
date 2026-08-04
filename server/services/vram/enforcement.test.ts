/**
 * ★★★ Pha 2B Task 5 — CƯỠNG CHẾ. Đây là bộ test của task ĐỔI HÀNH VI: từ đây `reserve()` có thể
 * TRẢ VỀ `lease: null`.
 *
 * Ba nhóm ca, và cả ba đều canh một câu khác nhau:
 *   A. `vramEnforcement` — chính sách suy giảm: **mỗi mức một phụ phí RIÊNG, và mọi mức CHẶT HƠN**.
 *   B. `vramBroker.reserve()` — quyết định: từ chối · cấp · kế hoạch nhường (ai, thứ tự nào).
 *   C. bàn giao: bốn món của Task 1–4 nay CÓ NGƯỜI TIÊU THỤ trên đường quyết định.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  reserve, release, snapshot, noteDeviceTotalBytes, setLeaseRefCount,
  preemptCandidates, __resetBrokerForTests,
  type VramDecisionContext,
} from "./vramBroker";
import { applyEnforcement, distrustUnitBytes, TICK_STALE_AFTER_MS } from "./vramEnforcement";
import { computeHeadroom, type HeadroomInput } from "./vramHeadroom";
import type { VramPriority } from "./types";

const MIB = 1024 * 1024;
const NOW = 1_800_000_000_000;
/** Ràng buộc 7 — fixture đủ lớn để phân biệt: khối 30B đo được 17.511.354.368 B ≈ 16.700 MiB. */
const KHOI_30B = 17_000 * MIB;

function req(owner: string, bytes: number, priority: VramPriority = "interactive") {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority };
}

/** Ô tick SẠCH: có số, nền đã xác minh, vừa mới chạy, ống ngoài sổ đã hỏi và rỗng. */
function ctxSach(attributableBytes: number, over: Partial<VramDecisionContext> = {}): VramDecisionContext {
  return {
    tick: { attributableBytes, baselineVerified: true, atMs: NOW, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    nowMs: NOW,
    ...over,
  };
}

function headroomInput(over: Partial<HeadroomInput> = {}): HeadroomInput {
  return {
    ceilingBytes: 32_607 * MIB,
    ledgerTotalBytes: 0,
    attributableBytes: 0,
    safetyReserveBytes: 1024 * MIB,
    baselineVerified: true,
    tickPresent: true,
    ...over,
  };
}

describe("A. vramEnforcement — mỗi mức suy giảm một chính sách RIÊNG, và mọi mức CHẶT HƠN", () => {
  const sach = () =>
    applyEnforcement({
      headroom: computeHeadroom(headroomInput()),
      tickAgeMs: 0,
      tickConsecutiveFailures: 0,
      unledgered: { bytes: 0, unknownCount: 0 },
    });

  it("không suy giảm ⇒ KHÔNG phụ phí: dư địa hiệu lực = dư địa thô", () => {
    const d = sach();
    expect(d.trusted).toBe(true);
    expect(d.reasons).toEqual([]);
    expect(d.effectiveHeadroomBytes).toBe(computeHeadroom(headroomInput()).headroomBytes);
    expect(d.distrustChargeBytes).toBe(0);
  });

  it("★ MÙ vì CHƯA CÓ NHỊP NÀO (no-tick) ⇒ chặt hơn, và phụ phí NẶNG HƠN mù tạm thời (probe-blind)", () => {
    const noTick = applyEnforcement({
      headroom: computeHeadroom(headroomInput({ attributableBytes: null, tickPresent: false })),
      tickAgeMs: null,
      tickConsecutiveFailures: 0,
      unledgered: { bytes: 0, unknownCount: 0 },
    });
    const probeBlind = applyEnforcement({
      headroom: computeHeadroom(headroomInput({ attributableBytes: null, tickPresent: true })),
      tickAgeMs: 0,
      tickConsecutiveFailures: 0,
      unledgered: { bytes: 0, unknownCount: 0 },
    });
    expect(noTick.reasons).toContain("no-tick");
    expect(probeBlind.reasons).toContain("probe-blind");
    // CẢ HAI chặt hơn ca sạch…
    expect(noTick.effectiveHeadroomBytes).toBeLessThan(sach().effectiveHeadroomBytes);
    expect(probeBlind.effectiveHeadroomBytes).toBeLessThan(sach().effectiveHeadroomBytes);
    // …và KHÔNG BẰNG NHAU: cấu trúc (không tự lành) phải nặng hơn tạm thời (lành ở nhịp sau).
    expect(noTick.effectiveHeadroomBytes).toBeLessThan(probeBlind.effectiveHeadroomBytes);
  });

  it("★ MÙ KHÔNG được coi thiết bị là TRỐNG: phụ phí > 0 và lý do được gọi tên", () => {
    const mu = applyEnforcement({
      headroom: computeHeadroom(headroomInput({ attributableBytes: null, tickPresent: true })),
      tickAgeMs: 0,
      tickConsecutiveFailures: 0,
      unledgered: { bytes: 0, unknownCount: 0 },
    });
    expect(mu.distrustChargeBytes).toBeGreaterThan(0);
    expect(mu.trusted).toBe(false);
  });

  it("nền CHƯA XÁC MINH ⇒ có phụ phí RIÊNG (không gộp vào mù)", () => {
    const chuaXacMinh = applyEnforcement({
      headroom: computeHeadroom(headroomInput({ baselineVerified: false })),
      tickAgeMs: 0,
      tickConsecutiveFailures: 0,
      unledgered: { bytes: 0, unknownCount: 0 },
    });
    expect(chuaXacMinh.reasons).toEqual(["unverified-baseline"]);
    expect(chuaXacMinh.effectiveHeadroomBytes).toBeLessThan(sach().effectiveHeadroomBytes);
  });

  it("★★ CỘNG DỒN: thêm MỘT lý do bất kỳ ⇒ luôn chặt hơn, không bao giờ lỏng hơn", () => {
    const mu = computeHeadroom(headroomInput({ attributableBytes: null, tickPresent: true }));
    const muVaChuaXacMinh = computeHeadroom(
      headroomInput({ attributableBytes: null, tickPresent: true, baselineVerified: false }),
    );
    const a = applyEnforcement({ headroom: mu, tickAgeMs: 0, tickConsecutiveFailures: 0, unledgered: { bytes: 0, unknownCount: 0 } });
    const b = applyEnforcement({ headroom: muVaChuaXacMinh, tickAgeMs: 0, tickConsecutiveFailures: 0, unledgered: { bytes: 0, unknownCount: 0 } });
    expect(b.reasons.length).toBeGreaterThan(a.reasons.length);
    expect(b.effectiveHeadroomBytes).toBeLessThan(a.effectiveHeadroomBytes);
  });

  describe("TICK CŨ — phạm trù THỨ BA: giữ SỐ, cộng BIÊN theo tuổi, KHÔNG đi qua null", () => {
    it("★★★ tick cũ vẫn dùng `attributable` (basis KHÔNG rơi về chỉ-sổ) và cộng một biên > 0", () => {
      const h = computeHeadroom(headroomInput({ attributableBytes: 20_000 * MIB }));
      const cu = applyEnforcement({
        headroom: h,
        tickAgeMs: TICK_STALE_AFTER_MS + 1,
        tickConsecutiveFailures: 0,
        unledgered: { bytes: 0, unknownCount: 0 },
      });
      // `attributable` THẮNG phép max ⇒ số vẫn được dùng, KHÔNG bị vứt thành null (phép LÀM LỎNG).
      expect(h.basis).toBe("attributable");
      expect(h.blind).toBe(false);
      expect(cu.staleMarginBytes).toBeGreaterThan(0);
      expect(cu.reasons).toContain("stale-tick");
      expect(cu.effectiveHeadroomBytes).toBeLessThan(h.headroomBytes);
    });

    it("★★ biên theo tuổi CHẶT HƠN đường 'vứt số ⇒ chỉ-sổ' (chứng minh null là CHẶN TRÊN)", () => {
      const giuSo = applyEnforcement({
        headroom: computeHeadroom(headroomInput({ attributableBytes: 20_000 * MIB })),
        tickAgeMs: TICK_STALE_AFTER_MS + 1,
        tickConsecutiveFailures: 0,
        unledgered: { bytes: 0, unknownCount: 0 },
      });
      const vutSo = applyEnforcement({
        headroom: computeHeadroom(headroomInput({ attributableBytes: null })),
        tickAgeMs: TICK_STALE_AFTER_MS + 1,
        tickConsecutiveFailures: 0,
        unledgered: { bytes: 0, unknownCount: 0 },
      });
      expect(giuSo.effectiveHeadroomBytes).toBeLessThan(vutSo.effectiveHeadroomBytes);
    });

    it("biên KHÔNG lớn vô hạn theo tuổi (một nhịp chết KHÔNG được làm hệ từ chối mọi thứ)", () => {
      const mot_gio = applyEnforcement({
        headroom: computeHeadroom(headroomInput({ attributableBytes: 0 })),
        tickAgeMs: 3_600_000,
        tickConsecutiveFailures: 60,
        unledgered: { bytes: 0, unknownCount: 0 },
      });
      expect(Number.isFinite(mot_gio.effectiveHeadroomBytes)).toBe(true);
      expect(mot_gio.effectiveHeadroomBytes).toBeGreaterThan(0);
      // nhịp HỎNG LIÊN TIẾP là một lý do RIÊNG (tuổi không nói được "sẽ không tự lành")
      expect(mot_gio.reasons).toContain("tick-failing");
    });
  });

  describe("ống NGOÀI SỔ — trừ như thứ ĐÃ TIÊU, và `unknownCount` làm mất tin cậy", () => {
    it("`unledgeredBytes` bị TRỪ khỏi dư địa đúng bằng số byte đó", () => {
      const d = applyEnforcement({
        headroom: computeHeadroom(headroomInput()),
        tickAgeMs: 0,
        tickConsecutiveFailures: 0,
        unledgered: { bytes: 5_000 * MIB, unknownCount: 0 },
      });
      expect(d.unledgeredChargeBytes).toBe(5_000 * MIB);
      expect(d.effectiveHeadroomBytes).toBe(sach().effectiveHeadroomBytes - 5_000 * MIB);
    });

    it("★ `unknownCount > 0` ⇒ thêm phụ phí RIÊNG (đọc byte mà bỏ đếm là đúng chiều nguy hiểm)", () => {
      const chiByte = applyEnforcement({
        headroom: computeHeadroom(headroomInput()),
        tickAgeMs: 0, tickConsecutiveFailures: 0,
        unledgered: { bytes: 5_000 * MIB, unknownCount: 0 },
      });
      const coDem = applyEnforcement({
        headroom: computeHeadroom(headroomInput()),
        tickAgeMs: 0, tickConsecutiveFailures: 0,
        unledgered: { bytes: 5_000 * MIB, unknownCount: 3 },
      });
      expect(coDem.reasons).toContain("unledgered-unknown");
      expect(coDem.effectiveHeadroomBytes).toBeLessThan(chiByte.effectiveHeadroomBytes);
    });

    it("CHƯA HỎI (`null`) ⇒ lý do riêng, và CHẶT HƠN 'đã hỏi và rỗng'", () => {
      const chuaHoi = applyEnforcement({
        headroom: computeHeadroom(headroomInput()),
        tickAgeMs: 0, tickConsecutiveFailures: 0, unledgered: null,
      });
      expect(chuaHoi.reasons).toContain("unledgered-unasked");
      expect(chuaHoi.effectiveHeadroomBytes).toBeLessThan(sach().effectiveHeadroomBytes);
    });
  });

  it("đầu vào vô nghĩa (`invalid-input`) ⇒ `-Infinity`, KHÔNG BAO GIỜ NaN", () => {
    const d = applyEnforcement({
      headroom: computeHeadroom(headroomInput({ ceilingBytes: Number.NaN })),
      tickAgeMs: 0, tickConsecutiveFailures: 0, unledgered: { bytes: 0, unknownCount: 0 },
    });
    expect(d.effectiveHeadroomBytes).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(d.effectiveHeadroomBytes)).toBe(false);
    expect(d.reasons).toContain("invalid-input");
  });

  it("mọi phụ phí đều HỮU HẠN kể cả khi ống ngoài sổ trả số bẩn", () => {
    const d = applyEnforcement({
      headroom: computeHeadroom(headroomInput()),
      tickAgeMs: Number.NaN, tickConsecutiveFailures: Number.NaN,
      unledgered: { bytes: Number.POSITIVE_INFINITY, unknownCount: Number.NaN },
    });
    expect(Number.isFinite(d.staleMarginBytes)).toBe(true);
    expect(Number.isFinite(d.unledgeredChargeBytes)).toBe(true);
    expect(Number.isFinite(d.distrustChargeBytes)).toBe(true);
  });
});

describe("B. vramBroker.reserve() — CƯỠNG CHẾ THẬT", () => {
  beforeEach(() => {
    __resetBrokerForTests();
    process.env.VRAM_DISTRUST_UNIT_MB = "1024";
    noteDeviceTotalBytes(32_607 * MIB);
  });
  afterEach(() => { delete process.env.VRAM_DISTRUST_UNIT_MB; });

  it("★★★ dư địa ÂM ⇒ TỪ CHỐI: không có giấy phép, và câu từ chối mang đủ BỐN thành phần", () => {
    // sổ đã giữ 30.000 MiB ⇒ dư địa âm với mọi lượt xin
    const a = reserve(req("gguf:A", 30_000 * MIB), ctxSach(0));
    expect(a.lease).not.toBeNull();
    const r = reserve(req("gguf:B", KHOI_30B), ctxSach(0));
    expect(r.lease).toBeNull();
    expect(r.wouldRefuse).toBe(true);
    expect(r.refusal).not.toBeNull();
    // BỐN thứ §5.3
    expect(r.refusal!.requestedBytes).toBe(KHOI_30B);
    expect(r.refusal!.availableBytes).not.toBeNull();
    expect(r.refusal!.holders.map((h) => h.owner)).toContain("gguf:A");
    expect(r.refusal!.preemptable).toBeDefined();
    // sổ KHÔNG được cộng thêm gì cho lượt bị từ chối
    expect(snapshot().totalReservedBytes).toBe(30_000 * MIB);
  });

  it("★★★ VỪA ĐỦ ⇒ ĐƯỢC CẤP (cưỡng chế mà từ chối mọi thứ thì không phải cưỡng chế)", () => {
    const r = reserve(req("gguf:30B", KHOI_30B), ctxSach(0));
    expect(r.lease).not.toBeNull();
    expect(r.wouldRefuse).toBe(false);
    expect(r.refusal).toBeNull();
    expect(snapshot().totalReservedBytes).toBe(KHOI_30B);
  });

  it("câu từ chối in ĐÚNG con số đã dùng để quyết định (dư địa HIỆU LỰC, không phải dư địa thô)", () => {
    const r = reserve(req("gguf:B", 31_000 * MIB), ctxSach(0, { unledgered: { bytes: 2_000 * MIB, unknownCount: 0 } }));
    expect(r.lease).toBeNull();
    expect(r.refusal!.availableBytes).toBe(r.decision.effectiveHeadroomBytes);
    expect(r.decision.effectiveHeadroomBytes).toBeLessThan(r.decision.headroomBytes);
  });

  it("MÙ ⇒ vẫn quyết định được, nhưng lý do phải ĐI VÀO câu từ chối (ghi rõ đang chạy mù)", () => {
    const muCtx: VramDecisionContext = { tick: null, unledgered: { bytes: 0, unknownCount: 0 }, nowMs: NOW };
    const r = reserve(req("gguf:B", 31_000 * MIB), muCtx);
    expect(r.lease).toBeNull();
    expect(r.decision.blind).toBe(true);
    expect(r.refusal!.degradedReasons).toContain("no-tick");
  });

  it("MÙ làm hệ CHẶT HƠN: đúng lượt xin được cấp khi có số lại bị TỪ CHỐI khi mù", () => {
    // 29.000 MiB nằm ĐÚNG giữa hai ngưỡng: lọt khi có số (dư địa 31.583 MiB), KHÔNG lọt khi mù
    // (31.583 − 3 đơn vị mất-tin-cậy = 28.511 MiB). Chọn số sát mép có chủ ý — đây là chỗ DUY NHẤT
    // mà "chặt hơn" nhìn thấy được bằng một quyết định ĐỔI CHIỀU, không phải bằng một phép trừ.
    const xin = () => req("gguf:X", 29_000 * MIB);
    const coSo = reserve(xin(), ctxSach(0));
    expect(coSo.lease).not.toBeNull();
    release(coSo.lease!);
    const mu = reserve(xin(), { tick: null, unledgered: { bytes: 0, unknownCount: 0 }, nowMs: NOW });
    expect(mu.lease).toBeNull();
  });

  it("★★★ TICK CŨ ở ĐƯỜNG QUYẾT ĐỊNH: giữ SỐ + cộng biên — KHÔNG BAO GIỜ đi qua `attributable = null`", () => {
    const r = reserve(req("gguf:X", 100 * MIB), {
      tick: { attributableBytes: 20_000 * MIB, baselineVerified: true, atMs: NOW - 600_000, consecutiveFailures: 0 },
      unledgered: { bytes: 0, unknownCount: 0 },
      nowMs: NOW,
    });
    // `null` là CHẶN TRÊN ⇒ "quá hạn thì vứt số" là phép LÀM LỎNG. Số phải còn nguyên trong phép max.
    expect(r.decision.basis).toBe("attributable");
    expect(r.decision.blind).toBe(false);
    expect(r.decision.usedBytes).toBe(20_000 * MIB);
    expect(r.decision.staleMarginBytes).toBeGreaterThan(0);
    expect(r.decision.reasons).toContain("stale-tick");
    expect(r.decision.effectiveHeadroomBytes).toBeLessThan(r.decision.headroomBytes);
  });

  it("reserve() vẫn ĐỒNG BỘ — trả thẳng kết quả, KHÔNG phải Promise (lá chắn cấu trúc Pha 1)", () => {
    const r = reserve(req("gguf:A", 100 * MIB), ctxSach(0));
    expect(r).not.toBeInstanceOf(Promise);
    expect(typeof (r as unknown as { then?: unknown }).then).toBe("undefined");
  });

  describe("§5.2 — AI CÓ THỂ NHƯỜNG: production KHÔNG BAO GIỜ, background TRƯỚC TIÊN, chỉ khi nhàn rỗi", () => {
    /** Đánh dấu nhàn rỗi: `reserve()` mở giấy phép ở trạng thái ĐANG DÙNG (`refCount = 1`). */
    const nhanRoi = (leaseId: string) => setLeaseRefCount(leaseId, 0);

    it("★★★ production KHÔNG BAO GIỜ vào kế hoạch nhường — kể cả khi NHÀN RỖI", () => {
      const p = reserve(req("prod:aoi", 10_000 * MIB, "production"), ctxSach(0));
      nhanRoi(p.lease!.id);
      const r = reserve(req("prod:aoi-2", 25_000 * MIB, "production"), ctxSach(0));
      expect(r.lease).toBeNull();
      expect(r.refusal!.preemptable.map((h) => h.owner)).not.toContain("prod:aoi");
      expect(r.wouldPreempt).not.toContain("prod:aoi");
    });

    it("★★ background NHƯỜNG TRƯỚC TIÊN (đứng đầu kế hoạch, trước interactive)", () => {
      const bg = reserve(req("bg:kb-sync", 6_000 * MIB, "background"), ctxSach(0));
      const it1 = reserve(req("gguf:idle", 6_000 * MIB, "interactive"), ctxSach(0));
      nhanRoi(bg.lease!.id);
      nhanRoi(it1.lease!.id);
      const r = reserve(req("gguf:big", 25_000 * MIB, "interactive"), ctxSach(0));
      expect(r.lease).toBeNull();
      expect(r.refusal!.preemptable[0]!.owner).toBe("bg:kb-sync");
    });

    it("★★ CHỈ thu hồi giấy phép NHÀN RỖI hoặc mức THẤP HƠN — cùng mức mà ĐANG DÙNG thì không", () => {
      const dangDung = reserve(req("gguf:busy", 6_000 * MIB, "interactive"), ctxSach(0));
      const bgBan = reserve(req("bg:trainer", 6_000 * MIB, "background"), ctxSach(0));
      void dangDung; void bgBan;   // cả hai giữ refCount = 1 (ĐANG DÙNG)
      const r = reserve(req("gguf:big", 25_000 * MIB, "interactive"), ctxSach(0));
      expect(r.lease).toBeNull();
      const ten = r.refusal!.preemptable.map((h) => h.owner);
      expect(ten).not.toContain("gguf:busy");   // CÙNG mức + ĐANG DÙNG ⇒ không đụng
      expect(ten).toContain("bg:trainer");      // mức THẤP HƠN ⇒ nhường được dù đang dùng
    });

    it("cùng mức nhưng NHÀN RỖI ⇒ nhường được (đây là chỗ `evictLRU` cũ vẫn phải làm được)", () => {
      const idle = reserve(req("gguf:idle", 6_000 * MIB, "interactive"), ctxSach(0));
      nhanRoi(idle.lease!.id);
      const r = reserve(req("gguf:big", 26_000 * MIB, "interactive"), ctxSach(0));
      expect(r.refusal!.preemptable.map((h) => h.owner)).toContain("gguf:idle");
    });

    it("`reserve().wouldPreempt` và `preemptCandidates()` đọc CÙNG MỘT vị từ", () => {
      const bg = reserve(req("bg:kb-sync", 6_000 * MIB, "background"), ctxSach(0));
      nhanRoi(bg.lease!.id);
      const r = reserve(req("gguf:big", 26_000 * MIB, "interactive"), ctxSach(0));
      const truc = preemptCandidates("interactive", Number.POSITIVE_INFINITY).map((h) => h.owner);
      expect(r.wouldPreempt.every((o) => truc.includes(o))).toBe(true);
      expect(r.wouldPreempt).toContain("bg:kb-sync");
    });
  });

  describe("C. bàn giao Task 1–4 — bốn món nay CÓ NGƯỜI TIÊU THỤ", () => {
    it("Task 1 `baselineVerified: false` ⇒ dư địa hiệu lực NHỎ HƠN (cờ không còn là đồng hồ không kim)", () => {
      const xin = () => req("gguf:X", 100 * MIB);
      const daXacMinh = reserve(xin(), ctxSach(0)).decision.effectiveHeadroomBytes;
      __resetBrokerForTests();
      noteDeviceTotalBytes(32_607 * MIB);
      const chuaXacMinh = reserve(xin(), {
        tick: { attributableBytes: 0, baselineVerified: false, atMs: NOW, consecutiveFailures: 0 },
        unledgered: { bytes: 0, unknownCount: 0 }, nowMs: NOW,
      }).decision.effectiveHeadroomBytes;
      expect(chuaXacMinh).toBeLessThan(daXacMinh);
    });

    it("Task 3 `unledgeredBytes` ⇒ dư địa hiệu lực bị TRỪ đúng bằng khối byte đã chạy ngoài sổ", () => {
      const co = reserve(req("gguf:X", 100 * MIB), ctxSach(0, { unledgered: { bytes: 3_000 * MIB, unknownCount: 0 } }));
      expect(co.decision.unledgeredChargeBytes).toBe(3_000 * MIB);
    });

    it("Task 2 `degradedReasons` đi thẳng vào `decision.reasons` (không bị nuốt trên đường)", () => {
      const r = reserve(req("gguf:X", 100 * MIB), { tick: null, unledgered: null, nowMs: NOW });
      expect(r.decision.reasons).toContain("no-tick");
      expect(r.decision.reasons).toContain("unledgered-unasked");
      expect(r.decision.trusted).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// D. LỜI TỪ CHỐI PHẢI TỚI ĐƯỢC NGƯỜI GỌI — vị từ DÙNG CHUNG và những sợi dây quanh nó
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("D. từ chối KHÔNG được biến mất trên đường ra", () => {
  it("★★ `isVramRefusal()` nhận đúng `VramRefusedError` — hai bên đọc CÙNG một hằng số tên", async () => {
    const { VramRefusedError, buildVramRefusal } = await import("./vramRefusal");
    const { isVramRefusal, VRAM_REFUSED_ERROR_NAME } = await import("./vramRefusalSignal");
    const err = new VramRefusedError(
      buildVramRefusal({
        requestedBytes: KHOI_30B, owner: "gguf:30b", priority: "interactive",
        headroomBytes: 100 * MIB, degradedReasons: [], blind: false,
        ledgerTotalBytes: 0, usedBytes: 0, holders: [], preemptable: [],
        unledgered: { bytes: 0, unknownCount: 0 },
      }),
    );
    expect(err.name).toBe(VRAM_REFUSED_ERROR_NAME);
    expect(isVramRefusal(err)).toBe(true);
    // ⚠ Lưới cho chiều NGƯỢC LẠI: một lỗi telemetry thường KHÔNG được thả qua cổng — nếu vị từ
    // này nói "true" cho mọi thứ thì chính sách "telemetry chết vẫn nạp được model" chết theo.
    expect(isVramRefusal(new Error("đầu dò hỏng"))).toBe(false);
    expect(isVramRefusal(null)).toBe(false);
    expect(isVramRefusal("VramRefusedError")).toBe(false);
  });

  /**
   * ★★★ RÀNG BUỘC 6 (vị từ dùng chung) — BẢN KIỂM BẰNG MÁY của bảng trong báo cáo Task 5.
   *
   * `beginVramAllocation()` nay NÉM `VramRefusedError`, và **mọi** điểm gọi đều có một `catch` mang
   * chính sách Pha 1 (*"telemetry chết thì hệ vẫn phải nạp được model"*) sẽ nuốt nó nếu không được
   * dạy. Một điểm gọi bị bỏ sót = cưỡng chế KHÔNG TỒN TẠI ở điểm đó, im lặng.
   *
   * ⚠ GIỚI HẠN ĐÃ BIẾT, khai thẳng: đây là một lượt quét VĂN BẢN, nên nó **không đóng lớp alias**
   * (`vramAllocationSites.ts` đã chứng minh một lượt đổi tên biến đi lọt). Nó chỉ bảo đảm rằng một
   * điểm gọi VIẾT THEO KHUÔN THÔNG THƯỜNG không thể quên vị từ. Bảng người-đọc trong báo cáo vẫn là
   * nguồn chính; cái này là lưới CHỐNG QUÊN, không phải bằng chứng đầy đủ.
   */
  it("★★★ MỌI file sản xuất gọi beginVramAllocation đều nhập vị từ `isVramRefusal`", async () => {
    const { readFileSync } = await import("node:fs");
    // ⚠ `execFileSync` + mảng tham số (không `execSync` + chuỗi shell): không có shell nào diễn
    // giải ký tự đặc biệt. Ở đây đầu vào là hằng số, nhưng khuôn an toàn phải là khuôn mặc định.
    const { execFileSync } = await import("node:child_process");
    const ra = execFileSync("git", ["grep", "-l", "beginVramAllocation", "--", "server"], { encoding: "utf8" });
    /** Miễn trừ CÓ LÝ DO — mỗi dòng phải nói được vì sao nó không cần vị từ. */
    const mienTru = new Map<string, string>([
      // Nơi NÉM: không có `catch` nào ở đây để nuốt lời từ chối của chính mình.
      ["server/services/vram/vramWiring.ts", "nơi NÉM"],
      // Module DỮ LIỆU thuần: bảng liệt kê chứa tên hàm như một CHUỖI DỮ LIỆU (mẫu quét), không
      // gọi gì cả — không import, không tác dụng phụ, không `catch`.
      ["server/services/vram/vramAllocationSites.ts", "bản liệt kê, tên hàm là dữ liệu"],
    ]);
    /**
     * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI TÌM LỜI GỌI. Bảy file trong `server/services/vram/**` chỉ **NHẮC
     * TÊN** `beginVramAllocation()` trong docstring; đếm chúng là ca DƯƠNG TÍNH GIẢ, và một lưới
     * kêu oan bảy lần sẽ bị người sau tắt đi — lúc đó ca THẬT (đã bắt được `aiReranker.ts`) chết
     * theo. Cách bỏ chú thích ở đây là THÔ (theo dòng): đủ cho khuôn viết của repo này.
     */
    const boChuThich = (src: string): string =>
      src
        .split(/\r?\n/)
        .filter((l) => {
          const t = l.trimStart();
          return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
        })
        .join("\n");
    const thieu: string[] = [];
    for (const f of ra.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      if (f.endsWith(".test.ts") || mienTru.has(f)) continue;
      const src = readFileSync(f, "utf8");
      // Chỉ tính file THẬT SỰ gọi (hoặc bọc lại) hàm, không tính file chỉ nói về nó.
      if (!/\bbeginVramAllocation\s*[({]/.test(boChuThich(src))) continue;
      if (!src.includes("isVramRefusal")) thieu.push(f);
    }
    expect(thieu).toEqual([]);
    // Lưới cho chính lưới: nếu phép lọc trên loại nhầm TẤT CẢ, ca này thành rỗng-mà-xanh.
    expect(ra.split(/\r?\n/).filter((f) => f.trim().endsWith(".ts")).length).toBeGreaterThanOrEqual(10);
  });

  /**
   * ★★★ CA QUAN TRỌNG NHẤT CỦA CẢ TASK — đi HẾT đường thật, không mock: `beginVramAllocation()`
   * **NÉM**, chứ không trả một giấy phép rỗng rồi để lượt cấp phát chạy tiếp.
   *
   * ⚠ Đây là điểm khác biệt giữa "cưỡng chế" và "một cái đồng hồ không kim": trước Task 5, nhánh
   * `if (!lease)` ở `vramWiring` `return NOOP_TICKET` — người gọi KHÔNG PHÂN BIỆT ĐƯỢC nó với một
   * lượt cấp phát thành công, và model vẫn được nạp sau khi cổng sổ đã chặn.
   */
  it("★★★ beginVramAllocation() NÉM VramRefusedError khi cổng sổ từ chối (không trả ticket rỗng)", async () => {
    const wiring = await import("./vramWiring");
    const brokerMod = await import("./vramBroker");
    const { isVramRefusal } = await import("./vramRefusalSignal");
    brokerMod.__resetBrokerForTests();
    brokerMod.noteDeviceTotalBytes(32_607 * MIB);
    // Lấp sổ tới sát trần bằng một giấy phép production (KHÔNG nhường được).
    brokerMod.reserve(req("prod:aoi", 30_000 * MIB, "production"), ctxSach(0));

    await expect(
      wiring.beginVramAllocation({
        owner: "gguf:30b-test",
        kind: "gguf-model",
        priority: "interactive",
        fileBytes: KHOI_30B,
      }),
    ).rejects.toSatisfy((e: unknown) => isVramRefusal(e));

    // …và lượt bị từ chối KHÔNG được ghi byte nào vào sổ (nếu ghi, lượt sau bị chặn trên BYTE MA).
    expect(brokerMod.snapshot().totalReservedBytes).toBe(30_000 * MIB);
    // …cũng KHÔNG được tính vào "sổ đang hụt": lượt này chưa cấp phát byte nào.
    expect(wiring.vramBeginFailureState().unledgeredBytes).toBe(0);
    expect(wiring.vramBeginFailureState().count).toBe(0);
    brokerMod.__resetBrokerForTests();
  });

  it("★★ ô tick LÁ và `readLastReconcileTick()` khai CÙNG một sự thật sau mỗi nhịp", async () => {
    const rec = await import("./vramReconciler");
    const cell = await import("./vramTickCell");
    rec.__resetVramBaselineForTests();
    expect(cell.readDecisionTick()).toBeNull();
    await rec.__runReconcileTick().catch(() => {});
    const a = rec.readLastReconcileTick();
    const b = cell.readDecisionTick();
    if (a === null) {
      // Không nhịp nào chạy được trong môi trường test (không GPU) — ô lá PHẢI cũng rỗng.
      expect(b).toBeNull();
    } else {
      expect(b).not.toBeNull();
      expect(b!.attributableBytes).toBe(a.result.attributableBytes);
      expect(b!.baselineVerified).toBe(a.result.baselineVerified);
      expect(b!.atMs).toBe(a.atMs);
      expect(b!.consecutiveFailures).toBe(a.consecutiveFailures);
    }
  });
});

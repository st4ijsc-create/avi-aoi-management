import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeHeadroom,
  headroomInputFromTick,
  type HeadroomInput,
  type HeadroomTickFields,
} from "./vramHeadroom";

const MIB = 1024 * 1024;

/**
 * Fixture cỡ THẬT (ràng buộc toàn cục 7). Con số 17.000 MiB không phải cho đẹp: đó là khối
 * trọng số 30B đo được ở Pha 1 (§3.5, `nvidia-smi = 18.115 MiB` khi lease vẫn pending), và là
 * cỡ DUY NHẤT phân biệt được "trừ một lần" với "trừ hai lần" — với fixture 600 MiB thì đột biến
 * `max` → `+` vẫn cho một headroom DƯƠNG trông rất hợp lý.
 */
const CEILING = 30_000 * MIB;
const RESERVE = 1_000 * MIB;
const MODEL_30B = 17_000 * MIB;

/** Đầu vào mặc định "lành mạnh" — mỗi ca chỉ đổi đúng thứ nó đang kiểm. */
function input(over: Partial<HeadroomInput> = {}): HeadroomInput {
  return {
    ceilingBytes: CEILING,
    ledgerTotalBytes: MODEL_30B,
    attributableBytes: MODEL_30B,
    safetyReserveBytes: RESERVE,
    baselineVerified: true,
    ...over,
  };
}

describe("vramHeadroom §5.6c — hàm quyết định THUẦN (chưa cưỡng chế)", () => {
  it("sổ THẮNG: `max()` lấy vế sổ khi sổ lớn hơn phần quy được cho thiết bị", () => {
    const r = computeHeadroom(input({ ledgerTotalBytes: MODEL_30B, attributableBytes: 12_000 * MIB }));
    expect(r.headroomBytes).toBe(12_000 * MIB); // 30.000 − 17.000 − 1.000
    expect(r.basis).toBe("ledger");
    expect(r.usedBytes).toBe(MODEL_30B);
    expect(r.blind).toBe(false);
  });

  /**
   * ★★ ĐÂY LÀ CHỖ MÔ HÌNH §5.6c THẮNG BẢN LIỆT KÊ: sổ mới nối 14/159 dòng, nhưng khoản CHƯA
   * LIỆT KÊ vẫn nằm trong `deviceUsed` ⇒ nó tự làm hẹp dư địa mà KHÔNG cần ai phát hiện, đặt tên,
   * hay thêm nó vào bảng.
   */
  it("★★ `attributable` THẮNG: khoản CHƯA LIỆT KÊ tự làm hẹp dư địa, không cần ai đặt tên nó", () => {
    const chiSo = computeHeadroom(input({ ledgerTotalBytes: 12_000 * MIB, attributableBytes: null }));
    const coThietBi = computeHeadroom(input({ ledgerTotalBytes: 12_000 * MIB, attributableBytes: MODEL_30B }));

    expect(coThietBi.headroomBytes).toBe(12_000 * MIB); // 30.000 − 17.000 − 1.000
    expect(coThietBi.basis).toBe("attributable");
    expect(coThietBi.usedBytes).toBe(MODEL_30B);
    // 5.000 MiB mà sổ KHÔNG BIẾT vẫn bị trừ khỏi dư địa.
    expect(chiSo.headroomBytes - coThietBi.headroomBytes).toBe(5_000 * MIB);
  });

  /**
   * ★★★ CA ĐỘT BIẾN BẮT BUỘC (`max` → `+`). Cùng MỘT khối 17.000 MiB nằm ở CẢ hai vế: sổ đã đặt
   * cọc ước lượng cho lease đang nạp, và thiết bị đã thấy trọng số lên VRAM. Cộng hai vế là trừ
   * khối đó HAI LẦN — hệ tự nhốt mình dưới trần và từ chối mọi lượt xin hợp lệ.
   */
  it("★★★ KHÔNG ĐẾM HAI LẦN: một khối 17.000 MiB nằm ở CẢ hai vế chỉ được trừ MỘT lần", () => {
    const r = computeHeadroom(input({ ledgerTotalBytes: MODEL_30B, attributableBytes: MODEL_30B }));
    expect(r.headroomBytes).toBe(12_000 * MIB); // KHÔNG phải −5.000 MiB
    expect(r.headroomBytes).toBeGreaterThan(0);
    expect(r.usedBytes).toBe(MODEL_30B);
    // Hoà thì ghi là "ledger": phần thiết bị đã được sổ GIẢI THÍCH HẾT, không có khoản ngoài sổ nào.
    expect(r.basis).toBe("ledger");
  });

  it("★★ MÙ (`attributableBytes === null`) ⇒ `blind: true` và dùng CHỈ sổ", () => {
    const r = computeHeadroom(input({ attributableBytes: null }));
    expect(r.blind).toBe(true);
    expect(r.basis).toBe("ledger-only");
    expect(r.usedBytes).toBe(MODEL_30B);
    expect(r.headroomBytes).toBe(12_000 * MIB);
    expect(r.trusted).toBe(false);
    expect(r.degradedReasons).toContain("blind");
  });

  /**
   * ★★★ ĐÍNH CHÍNH 2026-08-04 (ràng buộc toàn cục 10) — "mù ⇒ chỉ-sổ" KHÔNG phải suy biến an
   * toàn. Vì `max(L, A) ≥ L`, chỉ-sổ là **CHẶN TRÊN** của mọi headroom. Ca này khoá bất đẳng
   * thức đó bằng SỐ để không ai "dọn dẹp" nó thành một nhánh im lặng.
   */
  it("★★★ mù là CHẶN TRÊN chứ không phải suy biến an toàn: sổ rỗng + mù ⇒ dư địa = gần cả tấm card", () => {
    const mu = computeHeadroom(input({ ledgerTotalBytes: 0, attributableBytes: null }));
    expect(mu.headroomBytes).toBe(29_000 * MIB); // cả tấm card trừ đúng đệm an toàn

    // Với MỌI giá trị `attributable` — kể cả âm, kể cả một nền NHIỄM làm nó hụt đi — dư địa đều ≤ chỉ-sổ.
    for (const a of [-5_000 * MIB, 0, 1 * MIB, MODEL_30B, 40_000 * MIB]) {
      const co = computeHeadroom(input({ ledgerTotalBytes: 0, attributableBytes: a }));
      expect(co.headroomBytes).toBeLessThanOrEqual(mu.headroomBytes);
    }
  });

  it("headroom ÂM (đã vượt trần) trả về ÂM — TUYỆT ĐỐI không kẹp về 0", () => {
    const r = computeHeadroom(input({ ledgerTotalBytes: 1_000 * MIB, attributableBytes: 31_500 * MIB }));
    expect(r.headroomBytes).toBe(-2_500 * MIB); // 30.000 − 31.500 − 1.000
    expect(r.headroomBytes).toBeLessThan(0);
    expect(r.basis).toBe("attributable");
  });

  it("`safetyReserve` được TRỪ đúng, byte cho byte", () => {
    const khong = computeHeadroom(input({ safetyReserveBytes: 0 }));
    const co = computeHeadroom(input({ safetyReserveBytes: 2_048 * MIB }));
    expect(khong.headroomBytes - co.headroomBytes).toBe(2_048 * MIB);

    // Và chỉ riêng đệm an toàn cũng đủ lật dấu — nó KHÔNG được âm thầm bị kẹp.
    const lat = computeHeadroom(input({ ledgerTotalBytes: 29_900 * MIB, attributableBytes: null, safetyReserveBytes: 200 * MIB }));
    expect(lat.headroomBytes).toBe(-100 * MIB);
  });

  /**
   * ★★★ N2-4 (bàn giao cứng từ Task 1): `baselineVerified` phải có NGƯỜI TIÊU THỤ. Task 2 là
   * người tiêu thụ đầu tiên — cờ đi VÀO đầu vào và đi RA đầu ra, kèm một LÝ DO có tên, để Task 5
   * có thứ để treo chính sách "chặt hơn" lên.
   */
  it("★★★ N2-4: `baselineVerified === false` phản ánh ra ĐẦU RA, có tên lý do, và KHÔNG tự đổi con số", () => {
    const chuaXacMinh = computeHeadroom(input({ baselineVerified: false }));
    const daXacMinh = computeHeadroom(input({ baselineVerified: true }));

    expect(chuaXacMinh.baselineVerified).toBe(false);
    expect(chuaXacMinh.trusted).toBe(false);
    expect(chuaXacMinh.degradedReasons).toEqual(["unverified-baseline"]);

    expect(daXacMinh.baselineVerified).toBe(true);
    expect(daXacMinh.trusted).toBe(true);
    expect(daXacMinh.degradedReasons).toEqual([]);

    // Hàm này KHÔNG tự quyết định "chặt hơn" — đó là chính sách của Task 5. Nó chỉ phải làm cho
    // chính sách đó KHẢ THI: cùng con số, khác trạng thái tin cậy.
    expect(chuaXacMinh.headroomBytes).toBe(daXacMinh.headroomBytes);
  });

  it("hai suy biến cùng lúc ⇒ ĐỦ HAI lý do, không nuốt cái nào", () => {
    const r = computeHeadroom(input({ attributableBytes: null, baselineVerified: false }));
    expect(r.blind).toBe(true);
    expect(r.trusted).toBe(false);
    expect(r.degradedReasons).toEqual(["blind", "unverified-baseline"]);
  });

  /**
   * Nền chốt trong lúc có tàn dư rồi tàn dư CHẾT ⇒ `attributable = thiết bị − nền` tụt ÂM đúng
   * bằng khối đó (đường I-1 mà Task 1 phải dựng lối tự lành). `max()` phải cho sổ thắng —
   * một số âm TUYỆT ĐỐI không được nới dư địa ra quá mức chỉ-sổ.
   */
  it("`attributable` ÂM (tàn dư vừa chết, thiết bị < nền) KHÔNG nới dư địa — sổ thắng", () => {
    const r = computeHeadroom(input({ ledgerTotalBytes: MODEL_30B, attributableBytes: -500 * MIB }));
    expect(r.basis).toBe("ledger");
    expect(r.usedBytes).toBe(MODEL_30B);
    expect(r.headroomBytes).toBe(12_000 * MIB);
  });

  it("Đ4 — đơn vị nội bộ là BYTE: không làm tròn, không đổi thước", () => {
    const r = computeHeadroom({
      ceilingBytes: MODEL_30B + 7,
      ledgerTotalBytes: 1 * MIB + 3,
      attributableBytes: 1 * MIB + 2,
      safetyReserveBytes: 5,
      baselineVerified: true,
    });
    expect(r.headroomBytes).toBe(MODEL_30B + 7 - (1 * MIB + 3) - 5);
    expect(r.usedBytes).toBe(1 * MIB + 3);
  });

  /**
   * `Number(process.env.VRAM_CEILING_MB)` của một chuỗi hỏng cho `NaN`, và `NaN < 0 === false`
   * ⇒ MỌI lượt xin đều lọt cổng, IM LẶNG. Đó đúng lớp lỗi mà cả pha này tồn tại để diệt (ràng
   * buộc 9: không đường nào tràn im lặng) ⇒ KÊU TO tại chỗ, không trả một con số vô nghĩa.
   */
  it("★★ đầu vào không phải SỐ HỮU HẠN ⇒ NÉM, không trả `NaN` im lặng", () => {
    expect(() => computeHeadroom(input({ ceilingBytes: Number.NaN }))).toThrow(/hữu hạn/);
    expect(() => computeHeadroom(input({ ledgerTotalBytes: Number.POSITIVE_INFINITY }))).toThrow(/hữu hạn/);
    expect(() => computeHeadroom(input({ attributableBytes: Number.NaN }))).toThrow(/hữu hạn/);
    expect(() => computeHeadroom(input({ safetyReserveBytes: Number.NaN }))).toThrow(/hữu hạn/);
  });

  it("★ đệm an toàn ÂM ⇒ NÉM — một đệm âm là NỚI dư địa, đúng chiều nguy hiểm", () => {
    expect(() => computeHeadroom(input({ safetyReserveBytes: -1 }))).toThrow(/âm/);
  });
});

describe("headroomInputFromTick — nối ô tick vào hàm quyết định", () => {
  const policy = { ceilingBytes: CEILING, safetyReserveBytes: RESERVE, ledgerTotalBytes: MODEL_30B };

  /**
   * ⚠ CA NÀY LÀ SỰ THẬT VẬN HÀNH, KHÔNG PHẢI GIẢ ĐỊNH: dưới topology `api` + `worker`
   * (`backgroundJobs.ts:11`), `startVramReconciler()` KHÔNG chạy ở tiến trình `api` ⇒ ô tick ở đó
   * VĨNH VIỄN rỗng ⇒ cưỡng chế trong `api` chạy MÙ mãi mãi. Phải nói ra được, không được im.
   */
  it("★★ KHÔNG có nhịp nào (vd. tiến trình `api`) ⇒ mù + chưa xác minh, KHÔNG coi thiết bị là trống", () => {
    const r = computeHeadroom(headroomInputFromTick(null, policy));
    expect(r.blind).toBe(true);
    expect(r.basis).toBe("ledger-only");
    expect(r.trusted).toBe(false);
    expect(r.degradedReasons).toEqual(["blind", "unverified-baseline"]);
    expect(r.headroomBytes).toBe(12_000 * MIB); // chỉ-sổ: 30.000 − 17.000 − 1.000
  });

  it("tick có số ⇒ `attributableBytes` và `baselineVerified` đi THẲNG vào đầu vào", () => {
    const tick: HeadroomTickFields = { attributableBytes: 20_000 * MIB, baselineVerified: true };
    const inp = headroomInputFromTick(tick, policy);
    expect(inp.attributableBytes).toBe(20_000 * MIB);
    expect(inp.baselineVerified).toBe(true);
    const r = computeHeadroom(inp);
    expect(r.basis).toBe("attributable");
    expect(r.headroomBytes).toBe(9_000 * MIB); // 30.000 − 20.000 − 1.000
  });

  /**
   * ★★ SỔ LẤY TỪ SỔ SỐNG, KHÔNG LẤY TỪ TICK. `snapshot()` là đồng bộ và CHÍNH XÁC tại thời điểm
   * `reserve()`; `tick.ledgerTotalBytes` có thể cũ tới trọn một nhịp (60 s = độ trễ cưỡng chế
   * thật, spec §5.6c). Một lượt nạp 17 GB xin xong trong khoảng đó sẽ VÔ HÌNH nếu ta đọc sổ từ
   * tick — đúng cửa mà cưỡng chế sinh ra để đóng.
   */
  it("★★ sổ lấy từ SỔ SỐNG (policy), KHÔNG lấy từ tick cũ", () => {
    const tick: HeadroomTickFields & { ledgerTotalBytes: number } = {
      attributableBytes: 1_000 * MIB,
      baselineVerified: true,
      ledgerTotalBytes: 1_000 * MIB, // sổ CŨ của nhịp trước — phải bị bỏ qua
    };
    const inp = headroomInputFromTick(tick, policy);
    expect(inp.ledgerTotalBytes).toBe(MODEL_30B);
    expect(computeHeadroom(inp).headroomBytes).toBe(12_000 * MIB);
  });
});

/**
 * Ô LƯU KẾT QUẢ TICK GẦN NHẤT (ràng buộc 1). `reserve()` là ĐỒNG BỘ — tính đồng bộ đó LÀ lá chắn
 * cấu trúc từ Pha 1, không phải tối ưu hiệu năng — nên đường cưỡng chế phải đọc được số của nhịp
 * gần nhất mà KHÔNG `await` và KHÔNG gọi lại đầu dò.
 */
describe("vramReconciler — ô lưu kết quả tick gần nhất, đọc ĐỒNG BỘ", () => {
  beforeEach(() => vi.resetModules());

  /** Đầu dò giả: lượt ĐẦU (chụp nền) thấy 1.000 MiB desktop; các lượt sau thấy thêm model 17 GB. */
  function mockProbe(): { calls: () => number } {
    let n = 0;
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => {
        n += 1;
        return { usedBytes: (n === 1 ? 1_000 : 18_000) * MIB, totalBytes: 32_607 * MIB, source: "native" };
      },
    }));
    return { calls: () => n };
  }

  function mockLedger(totalBytes: number): void {
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: totalBytes, leases: [] }),
      leaseBytes: () => 0,
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
  }

  it("chưa có nhịp nào ⇒ ô tick là `null` (và người đọc PHẢI hiểu là MÙ, không phải thiết bị trống)", async () => {
    mockLedger(0);
    mockProbe();
    const { readLastReconcileTick } = await import("./vramReconciler");
    expect(readLastReconcileTick()).toBeNull();
  });

  it("★★ sau một nhịp, kết quả đọc được ĐỒNG BỘ — không `await`, không gọi lại đầu dò", async () => {
    mockLedger(MODEL_30B);
    const probe = mockProbe();
    const { __runReconcileTick, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await __runReconcileTick();
    const sauNhip = probe.calls();

    const tick = readLastReconcileTick();
    expect(tick).not.toBeNull();
    expect(tick).not.toBeInstanceOf(Promise);
    // Đọc ô tick TUYỆT ĐỐI không được chạm đầu dò — đó là cả lý do ô này tồn tại.
    expect(probe.calls()).toBe(sauNhip);
    expect(typeof tick!.atMs).toBe("number");
  });

  it("ô tick mang ĐỦ ba số của §5.6c: sổ · `attributable` · `baselineVerified`", async () => {
    mockLedger(MODEL_30B);
    mockProbe();
    const { __runReconcileTick, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await __runReconcileTick();
    const tick = readLastReconcileTick()!;
    expect(tick.result.ledgerTotalBytes).toBe(MODEL_30B);
    // nền 1.000 (desktop) chụp ở lượt đầu; thiết bị 18.000 ⇒ quy được cho ta đúng 17.000 MiB.
    expect(tick.result.attributableBytes).toBe(MODEL_30B);
    // Quét hộ giữ GPU TẮT trong bộ test (vitest.setup.ts) ⇒ census `null` ⇒ CHƯA XÁC MINH.
    expect(tick.result.baselineVerified).toBe(false);
  });

  /**
   * ★ `reconcileOnce()` gọi TRỰC TIẾP có ngữ nghĩa RIÊNG đã ghi từ Pha 1: `baselineRequired`
   * tắt ⇒ nền = 0 ⇒ nó so số THÔ (người gọi tự biết mình đang xem gì). Xuất bản con số đó vào ô
   * quyết định là để một công cụ chẩn đoán lái đường cưỡng chế của sản xuất.
   */
  it("★ `reconcileOnce()` gọi TRỰC TIẾP KHÔNG xuất bản vào ô tick", async () => {
    mockLedger(MODEL_30B);
    mockProbe();
    const { reconcileOnce, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await reconcileOnce();
    expect(readLastReconcileTick()).toBeNull();
  });

  it("`__resetVramBaselineForTests()` XOÁ ô tick — test sau không được thừa kế quyết định của test trước", async () => {
    mockLedger(MODEL_30B);
    mockProbe();
    const { __runReconcileTick, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    await __runReconcileTick();
    expect(readLastReconcileTick()).not.toBeNull();
    __resetVramBaselineForTests();
    expect(readLastReconcileTick()).toBeNull();
  });

  /**
   * ★★ ĐẦU-CUỐI: số của reconciler chảy vào hàm quyết định, và `baselineVerified` KHÔNG rơi dọc
   * đường (N2-4 — nếu nó rơi thì Task 1 đã dựng một cái đồng hồ không kim).
   */
  it("★★ đầu-cuối: ô tick → `headroomInputFromTick` → `computeHeadroom`, cờ xác minh KHÔNG rơi dọc đường", async () => {
    mockLedger(MODEL_30B);
    mockProbe();
    const { __runReconcileTick, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();
    await __runReconcileTick();

    const tick = readLastReconcileTick()!;
    const r = computeHeadroom(
      headroomInputFromTick(tick.result, {
        ceilingBytes: CEILING,
        safetyReserveBytes: RESERVE,
        ledgerTotalBytes: tick.result.ledgerTotalBytes,
      }),
    );
    expect(r.headroomBytes).toBe(12_000 * MIB);
    expect(r.blind).toBe(false);
    expect(r.baselineVerified).toBe(false);
    expect(r.trusted).toBe(false);
    expect(r.degradedReasons).toEqual(["unverified-baseline"]);
  });
});

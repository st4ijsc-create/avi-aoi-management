import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeHeadroom,
  headroomInputFromTick,
  assertHeadroomPolicy,
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
    tickPresent: true,
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
    // I-2 — CÓ nhịp mà nhịp đó không tính được ⇒ `probe-blind` (TẠM THỜI), KHÔNG phải `no-tick`.
    expect(r.degradedReasons).toEqual(["probe-blind"]);
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
    expect(r.degradedReasons).toEqual(["probe-blind", "unverified-baseline"]);
  });

  /**
   * ★★★ I-2 (review Task 2) — CA NÀY GIẾT ĐÚNG ĐỘT BIẾN ĐÃ **SỐNG SÓT 302/302** Ở BẢN TRƯỚC.
   *
   * Reviewer hợp nhất *"có tick nhưng đầu dò hỏng"* với *"không có tick nào"* trong
   * `headroomInputFromTick` — một đổi hành vi quan sát được — mà **không ca nào đỏ**, vì khối ca
   * cũ không có tổ hợp `attributableBytes: null` + `baselineVerified: true`.
   *
   * Hai trạng thái này đòi hai đối xử khác nhau (ràng buộc 10): `probe-blind` **lành ở nhịp sau**;
   * `no-tick` là suy biến **CẤU TRÚC**, không tự lành. Gộp là bắt Task 5 đối xử với "không bao giờ
   * có số" y như "nhịp này chưa có số".
   */
  it("★★★ I-2: `no-tick` và `probe-blind` là HAI MỨC KHÁC NHAU, không được hợp nhất", () => {
    const chuaCoNhip = computeHeadroom(input({ tickPresent: false, attributableBytes: null, baselineVerified: false }));
    const nhipMu = computeHeadroom(input({ tickPresent: true, attributableBytes: null, baselineVerified: true }));

    expect(chuaCoNhip.degradedReasons).toEqual(["no-tick", "unverified-baseline"]);
    expect(nhipMu.degradedReasons).toEqual(["probe-blind"]);
    // Hai lý do KHÁC NHAU dù cùng `blind` và cùng một con số dư địa — chính chỗ đó là thông tin.
    expect(chuaCoNhip.blind).toBe(true);
    expect(nhipMu.blind).toBe(true);
    expect(chuaCoNhip.headroomBytes).toBe(nhipMu.headroomBytes);
    expect(chuaCoNhip.degradedReasons).not.toEqual(nhipMu.degradedReasons);
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
      tickPresent: true,
    });
    expect(r.headroomBytes).toBe(MODEL_30B + 7 - (1 * MIB + 3) - 5);
    expect(r.usedBytes).toBe(1 * MIB + 3);
  });

  /**
   * ★★★ C-1 (review Task 2) — HÀM NÀY KHÔNG BAO GIỜ ĐƯỢC NÉM.
   *
   * Bản đầu NÉM khi đầu vào vô nghĩa. Động cơ đúng (một `NaN` làm `estimated > headroom` thành
   * `false` cho MỌI lượt xin ⇒ cưỡng chế tắt im lặng, ràng buộc 9), nhưng **vị trí sai**:
   * `broker.reserve()` nằm trong `try` của `beginVramAllocation()`, `vramWiring` kết bằng
   * `catch { return NOOP_TICKET }`, và `reserve()` tạo lease ở **CUỐI** hàm ⇒ một cú ném =
   * **cưỡng chế tắt CỘNG một khối byte không vào sổ** ⇒ vế `L` hụt ⇒ `max(L, A)` mất vế `L` ⇒
   * headroom **phóng đại cho mọi lượt xin sau**. Tệ hơn hẳn cái `NaN` nó định phòng — `NaN` ít
   * nhất còn để **sổ đúng**.
   */
  it("★★★ C-1: đầu vào vô nghĩa ⇒ KHÔNG NÉM (ném trên đường reserve() làm MẤT giấy phép)", () => {
    for (const bad of [
      input({ ceilingBytes: Number.NaN }),
      input({ ledgerTotalBytes: Number.POSITIVE_INFINITY }),
      input({ attributableBytes: Number.NaN }),
      input({ safetyReserveBytes: Number.NaN }),
      input({ safetyReserveBytes: -1 }),
      input({ ceilingBytes: 0 }),
    ]) {
      expect(() => computeHeadroom(bad)).not.toThrow();
    }
  });

  it("★★★ C-1: đầu vào vô nghĩa ⇒ FAIL-CLOSED CÓ TÊN (−Infinity + lý do), KHÔNG phải `NaN` im lặng", () => {
    const r = computeHeadroom(input({ ceilingBytes: Number.NaN }));
    expect(r.headroomBytes).toBe(Number.NEGATIVE_INFINITY);
    // `NaN` là thứ TUYỆT ĐỐI không được trả: mọi so sánh với nó đều `false` ⇒ cưỡng chế TẮT im lặng.
    expect(Number.isNaN(r.headroomBytes)).toBe(false);
    expect(r.degradedReasons).toContain("invalid-input");
    expect(r.trusted).toBe(false);
    // Từ chối TẤT ĐỊNH: mọi lượt xin, kể cả 1 byte, đều lớn hơn dư địa.
    expect(1 > r.headroomBytes).toBe(true);
  });

  it("★ đệm an toàn ÂM ⇒ fail-closed CÓ TÊN (đệm âm là phép CỘNG dư địa)", () => {
    const r = computeHeadroom(input({ safetyReserveBytes: -1 }));
    expect(r.headroomBytes).toBe(Number.NEGATIVE_INFINITY);
    expect(r.degradedReasons).toContain("invalid-input");
  });

  /**
   * ★★ M-1 — `VRAM_CEILING_MB=` (để TRỐNG, khác hẳn "không đặt") ⇒ `Number("") === 0` ⇒ **lọt**
   * `Number.isFinite` ⇒ dư địa âm khổng lồ ⇒ từ chối 100% lượt xin, **im lặng**, toàn hệ AI chết.
   * Chiều fail-closed nên không nguy hiểm về an toàn, nhưng nó phải CÓ TÊN.
   */
  it("★★ M-1: trần = 0 (VRAM_CEILING_MB rỗng) ⇒ `invalid-input`, không phải một lượt từ chối bí ẩn", () => {
    expect(computeHeadroom(input({ ceilingBytes: 0 })).degradedReasons).toContain("invalid-input");
    expect(computeHeadroom(input({ ceilingBytes: -1 })).degradedReasons).toContain("invalid-input");
  });

  it("`attributableBytes` HỎNG (`NaN` từ đầu dò) ⇒ coi là MÙ, KHÔNG để nó nuốt vế sổ", () => {
    const r = computeHeadroom(input({ attributableBytes: Number.NaN }));
    expect(r.blind).toBe(true);
    expect(r.usedBytes).toBe(MODEL_30B); // vế sổ còn nguyên, không bị `Math.max(NaN, …)` nuốt
  });

  it("M-2: `degradedReasons` ĐÔNG CỨNG — không ai bơm thêm lý do vào bản tóm tắt của Task 4", () => {
    const r = computeHeadroom(input({ attributableBytes: null }));
    expect(Object.isFrozen(r.degradedReasons)).toBe(true);
  });
});

/**
 * ★★ C-1 — chỗ DUY NHẤT của module được phép NÉM: cổng cấu hình, gọi MỘT LẦN lúc nạp, **NGOÀI**
 * `try` của `beginVramAllocation()`. Ở đó một cú ném giết boot thật to thay vì bị `catch` nuốt.
 */
describe("assertHeadroomPolicy — cổng cấu hình lúc BOOT (chỗ duy nhất được ném)", () => {
  it("cấu hình hợp lệ ⇒ im lặng đi qua", () => {
    expect(() => assertHeadroomPolicy({ ceilingBytes: CEILING, safetyReserveBytes: RESERVE })).not.toThrow();
    expect(() => assertHeadroomPolicy({ ceilingBytes: 1, safetyReserveBytes: 0 })).not.toThrow();
  });

  it("★★ trần NaN / 0 / âm ⇒ NÉM, và câu lỗi nêu đích danh nguồn thường gặp", () => {
    expect(() => assertHeadroomPolicy({ ceilingBytes: Number.NaN, safetyReserveBytes: RESERVE })).toThrow(/trần/);
    expect(() => assertHeadroomPolicy({ ceilingBytes: 0, safetyReserveBytes: RESERVE })).toThrow(/VRAM_CEILING_MB/);
    expect(() => assertHeadroomPolicy({ ceilingBytes: -1, safetyReserveBytes: RESERVE })).toThrow(/trần/);
  });

  it("đệm NaN / âm ⇒ NÉM", () => {
    expect(() => assertHeadroomPolicy({ ceilingBytes: CEILING, safetyReserveBytes: Number.NaN })).toThrow(/đệm/);
    expect(() => assertHeadroomPolicy({ ceilingBytes: CEILING, safetyReserveBytes: -1 })).toThrow(/đệm/);
  });
});

describe("headroomInputFromTick — nối ô tick vào hàm quyết định", () => {
  const policy = { ceilingBytes: CEILING, safetyReserveBytes: RESERVE, ledgerTotalBytes: MODEL_30B };

  /**
   * ⚠ CA NÀY LÀ SỰ THẬT VẬN HÀNH, KHÔNG PHẢI GIẢ ĐỊNH: một tiến trình không gọi
   * `startVramReconciler()` thì ô tick **rỗng vĩnh viễn**, và **60 giây đầu của MỌI vai trò** cũng
   * ở trạng thái này trước khi I-1 thêm nhịp NGAY. Phải nói ra được, không được im.
   */
  it("★★ KHÔNG có nhịp nào ⇒ `no-tick` + chưa xác minh, KHÔNG coi thiết bị là trống", () => {
    const r = computeHeadroom(headroomInputFromTick(null, policy));
    expect(r.blind).toBe(true);
    expect(r.basis).toBe("ledger-only");
    expect(r.trusted).toBe(false);
    expect(r.degradedReasons).toEqual(["no-tick", "unverified-baseline"]);
    expect(r.headroomBytes).toBe(12_000 * MIB); // chỉ-sổ: 30.000 − 17.000 − 1.000
  });

  /**
   * ★★★ I-2 — NỬA CÒN LẠI CỦA CA GIẾT ĐỘT BIẾN, ở đúng chỗ đột biến sống sót: `headroomInputFromTick`
   * phải PHÂN BIỆT "có tick mà tick mù" với "không có tick". Tổ hợp `attributableBytes: null` +
   * `baselineVerified: true` là tổ hợp mà bộ ca cũ **không hề có**.
   */
  it("★★★ I-2: CÓ tick nhưng tick MÙ ⇒ `probe-blind` (tạm thời), TUYỆT ĐỐI không phải `no-tick`", () => {
    const tick: HeadroomTickFields = { attributableBytes: null, baselineVerified: true };
    const inp = headroomInputFromTick(tick, policy);
    expect(inp.tickPresent).toBe(true);
    expect(inp.baselineVerified).toBe(true);
    const r = computeHeadroom(inp);
    expect(r.blind).toBe(true);
    expect(r.degradedReasons).toEqual(["probe-blind"]);
  });

  it("tick có số ⇒ `attributableBytes` và `baselineVerified` đi THẲNG vào đầu vào", () => {
    const tick: HeadroomTickFields = { attributableBytes: 20_000 * MIB, baselineVerified: true };
    const inp = headroomInputFromTick(tick, policy);
    expect(inp.attributableBytes).toBe(20_000 * MIB);
    expect(inp.baselineVerified).toBe(true);
    expect(inp.tickPresent).toBe(true);
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

  /**
   * ★ M-5 (review Task 2) — NHỊP HỎNG PHẢI ĐẾM ĐƯỢC. `atMs` đứng yên ở cả hai ca "chưa tới hạn"
   * và "đã hỏng N lần liên tiếp", mà mức đáng tin của chúng khác hẳn: cái đầu sẽ tự lành, cái sau
   * thì không. Không có bộ đếm thì Task 5 không phân biệt được hai thứ đó.
   */
  it("★ M-5: nhịp HỎNG ⇒ giữ số CŨ, KHÔNG đè ô tick, và ĐẾM được — nhịp lành sau đó reset bộ đếm", async () => {
    mockLedger(MODEL_30B);
    let fail = false;
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => {
        if (fail) throw new Error("đầu dò nổ");
        return { usedBytes: 18_000 * MIB, totalBytes: 32_607 * MIB, source: "native" };
      },
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { __runReconcileTick, readLastReconcileTick, __resetVramBaselineForTests } = await import("./vramReconciler");
    __resetVramBaselineForTests();

    await __runReconcileTick();
    const good = readLastReconcileTick()!;
    expect(good.consecutiveFailures).toBe(0);

    fail = true;
    await expect(__runReconcileTick()).rejects.toThrow("đầu dò nổ");
    const afterFail = readLastReconcileTick()!;
    // Số CŨ vẫn là số tốt nhất ta có ⇒ không đè, không xoá. Nhưng phải BIẾT là nó đang cũ VÌ HỎNG.
    expect(afterFail.atMs).toBe(good.atMs);
    expect(afterFail.result).toBe(good.result);
    expect(afterFail.consecutiveFailures).toBe(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("NHỊP ĐỐI CHIẾU HỎNG"))).toBe(true);

    fail = false;
    await __runReconcileTick();
    expect(readLastReconcileTick()!.consecutiveFailures).toBe(0);
    warn.mockRestore();
  });
});

/**
 * ★★ I-1 (review Task 2) — HAI CÔNG TẮC, TÁCH RỜI: chạy NHỊP (nguồn số của cưỡng chế) và đánh
 * CHUÔNG (câu cảnh báo của Pha 1). Gộp chúng là hoặc để `api` mù vĩnh viễn, hoặc để chuông kêu oan
 * mỗi 60 giây ở cả hai tiến trình.
 */
describe("startVramReconciler — nhịp NGAY, và cờ CHUÔNG tách khỏi cờ NHỊP", () => {
  beforeEach(() => vi.resetModules());

  function mockAll(): { events: string[] } {
    const events: string[] = [];
    vi.doMock("./vramBroker", () => ({
      // Sổ RỖNG, nhưng thiết bị nhảy 1.000 → 18.000 MiB SAU lượt chụp nền ⇒ lệch DƯƠNG 17.000 MiB
      // (đúng hình dạng "có hộ cấp phát KHÔNG XIN PHÉP") ⇒ chuông PHẢI reo, khi được phép reo.
      snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
      leaseBytes: () => 0,
    }));
    let n = 0;
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => {
        n += 1;
        return { usedBytes: (n === 1 ? 1_000 : 18_000) * MIB, totalBytes: 32_607 * MIB, source: "native" };
      },
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string }) => events.push(e.event) }));
    return { events };
  }

  /**
   * ★★★ CỬA SỔ MÙ 60 GIÂY ĐẦU. Bản trước chỉ `setInterval` ⇒ nhịp đầu ở **T+60 s** ⇒ ô quyết định
   * `null` suốt 60 giây đó ở **MỌI vai trò** — đúng lúc `warmUpOllamaModels()` và model 30B
   * **17 GB** lên card, tức đợt cấp phát LỚN NHẤT của cả vòng đời tiến trình.
   */
  it("★★★ chạy MỘT NHỊP NGAY, không đợi hết một chu kỳ (đóng cửa sổ mù 60 giây đầu)", async () => {
    mockAll();
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();
    try {
      rec.startVramReconciler();
      // Nhịp NGAY là bất đồng bộ (không `await` được từ một hàm đồng bộ trên đường boot) — nhưng
      // nó phải xong sau vài microtask, KHÔNG phải sau 60 giây.
      await vi.waitFor(() => expect(rec.readLastReconcileTick()).not.toBeNull());
      expect(rec.readLastReconcileTick()!.result.deviceUsedBytes).toBe(18_000 * MIB);
    } finally {
      rec.stopVramReconciler();
      rec.__resetVramBaselineForTests();
    }
  });

  it("★★ `ring: false` TẮT CHUÔNG nhưng KHÔNG tắt phép đo — số vẫn vào ô quyết định", async () => {
    const { events } = mockAll();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();
    try {
      rec.startVramReconciler({ ring: false });
      await vi.waitFor(() => expect(rec.readLastReconcileTick()).not.toBeNull());
      const tick = rec.readLastReconcileTick()!;
      // PHÁT HIỆN còn nguyên: lệch dương khổng lồ vẫn được tính và vẫn đi ra kết quả…
      expect(tick.result.alarm).toBe(true);
      expect(tick.result.driftBytes).toBe(17_000 * MIB);
      // …nhưng KHÔNG có câu tuyên bố nào, và KHÔNG có dòng `drift` nào vào nhật ký.
      expect(events).not.toContain("drift");
      expect(warn.mock.calls.some((c) => String(c[0]).includes("LỆCH"))).toBe(false);
    } finally {
      rec.stopVramReconciler();
      rec.__resetVramBaselineForTests();
      warn.mockRestore();
    }
  });

  it("mặc định (không truyền `ring`) ⇒ CHUÔNG BẬT — hành vi Pha 1 không đổi", async () => {
    const { events } = mockAll();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = await import("./vramReconciler");
    rec.__resetVramBaselineForTests();
    try {
      rec.startVramReconciler();
      await vi.waitFor(() => expect(events).toContain("drift"));
      expect(warn.mock.calls.some((c) => String(c[0]).includes("LỆCH"))).toBe(true);
    } finally {
      rec.stopVramReconciler();
      rec.__resetVramBaselineForTests();
      warn.mockRestore();
    }
  });
});

/**
 * ★★ Pha 2B Task 5 — Ô TICK DÙNG CHO ĐƯỜNG QUYẾT ĐỊNH. **Module LÁ: không import gì, không I/O.**
 *
 * ⚠⚠ VÌ SAO PHẢI TÁCH RA MỘT FILE RIÊNG thay vì để `vramWiring` gọi thẳng
 * `vramReconciler.readLastReconcileTick()`:
 *   1. **VÒNG NHẬP.** `vramReconciler` nhập TĨNH `./vramBroker` (dòng 1). Cưỡng chế sống trong
 *      `vramBroker`/`vramWiring`, nên chiều ngược lại đóng vòng.
 *   2. **BỀ MẶT MOCK.** 43 file test thay CẢ module `./vramBroker` (và vài module lân cận) bằng bản
 *      giả chỉ khai vài export. Kéo `vramReconciler` — một module có I/O, đồng hồ, và trạng thái
 *      toàn cục — vào đường nhập của `vramWiring` sẽ làm những file test đó vỡ ngay lúc NẠP, với
 *      một lỗi chẳng liên quan gì tới thứ chúng đang kiểm. Một ô lá thì không đẻ thêm bề mặt nào.
 *
 * ⚠ ĐÂY KHÔNG PHẢI BỘ ĐỆM ĐẦU DÒ. Không ai được "làm mới" nó bằng cách gọi lại đầu dò từ đường đọc
 * — làm vậy là đưa I/O trở lại đúng chỗ Pha 1 đã dọn đi, và phá tính ĐỒNG BỘ của `reserve()`
 * (ràng buộc 1). Chỉ `vramReconciler.__runReconcileTick()` được ghi vào đây.
 *
 * ⚠ `consecutiveFailures` nằm ở ĐÂY chứ không nằm bên `vramReconciler`, có chủ đích: nếu hai nơi
 * cùng giữ một bộ đếm cho CÙNG một sự thật thì chúng sẽ trôi khỏi nhau — đúng lớp lỗi "hai bản cài
 * đặt song song" đã khiến `bench.mjs` sai bốn lần. `readLastReconcileTick()` đọc đúng bộ đếm này.
 */

/**
 * Hình dạng TỐI THIỂU mà đường quyết định **và mặt đọc của Agent** cần từ một nhịp đối chiếu.
 *
 * ⚠ `import type` từ `./types` — module THUẦN KIỂU, bị xoá sạch lúc biên dịch ⇒ tính "module LÁ"
 * của file này KHÔNG đổi. Tuyệt đối **đừng** nhập `./vramReconciler` vào đây (xem đầu file).
 */
import type { BaselineOrigin, VramBaselineDistrustReason } from "./types";

/** Hình dạng TỐI THIỂU mà đường quyết định cần từ một nhịp đối chiếu. */
export interface VramDecisionTickFields {
  /**
   * `deviceUsedBytes − baselineUsedBytes` của nhịp gần nhất, hoặc `null` khi KHÔNG TÍNH ĐƯỢC.
   * ⚠ `null` là **CHẶN TRÊN** của mọi headroom, KHÔNG phải "an toàn" (ràng buộc toàn cục 10).
   */
  readonly attributableBytes: number | null;
  readonly baselineVerified: boolean;
  /**
   * ★★★ Pha 4 Task 1 (D) — **VÌ SAO cờ trên tắt. ĐI CÙNG MỘT Ô, KHÔNG PHẢI HAI.**
   *
   * ⚠⚠ TRƯỚC BẢN NÀY, mặt đọc lấy `baselineVerified` từ ĐÂY và `baselineUnverifiedReasons` từ
   * `vramReconciler.readLastReconcileTick()` — **HAI ô**. Hôm nay hai ô được xuất bản bởi hai lệnh
   * gán CẠNH NHAU, đồng bộ, cùng `result` + cùng `atMs`, nên chúng khớp; nhưng **không bất biến
   * nào ép** chúng khớp, và trong BỘ TEST chúng lệch thật (`__resetDecisionTickForTests()` không
   * xoá `vramReconciler.lastTick`). Chiều Agent kết luận SAI là chiều nguy hiểm:
   * `verified:false` (nhịp mới) + `unverifiedReasons: []` (bản ghi cũ, hồi đó sạch) ⇒ đọc thành
   * *"chỉ chưa kịp chụp, không có vấn đề"* ⇒ **bỏ qua**.
   * ⇒ Ràng buộc 8 (*"hai bản sao vị từ dưới một bất biến ⇒ ĐỔI KIỂU, đừng thêm ca"*): hai ô nhập
   * làm MỘT, và bất biến "cùng nhịp" thành **CẤU TRÚC**. `publishDecisionTick(result, atMs)` vốn
   * đã nhận cả `result` — hai trường này chỉ là hai ô nó đang có sẵn.
   *
   * ⚠ Rỗng ⇔ `baselineVerified === true`. **KHÔNG** phải `VramDegradationReason`: đây là CHẨN
   * ĐOÁN, nó không đổi một byte nào của phép tính (`applyEnforcement` vẫn chỉ thấy
   * `"unverified-baseline"`, 1 đơn vị).
   */
  readonly baselineUnverifiedReasons: readonly VramBaselineDistrustReason[];
  /** Nền này đã trừ byte của anh em chưa, và bằng cách nào. Xem `VramReconcileResult.baselineOrigin`. */
  readonly baselineOrigin: BaselineOrigin;
}

export interface VramDecisionTick extends VramDecisionTickFields {
  /** `Date.now()` lúc nhịp KẾT THÚC — con số dùng để đo TUỔI (biên theo tuổi, `vramEnforcement`). */
  readonly atMs: number;
  /** Số nhịp HỎNG LIÊN TIẾP kể từ lượt thành công gần nhất. `0` = nhịp gần nhất trót lọt. */
  readonly consecutiveFailures: number;
}

let o: { readonly fields: VramDecisionTickFields; readonly atMs: number } | null = null;
let soLuotHongLienTiep = 0;

/** Nhịp CHẠY XONG — xuất bản số mới và xoá chuỗi hỏng. */
export function publishDecisionTick(fields: VramDecisionTickFields, atMs: number): void {
  o = { fields, atMs };
  soLuotHongLienTiep = 0;
}

/**
 * Nhịp NÉM — **KHÔNG đè lên ô** (số cũ vẫn là số tốt nhất ta có) nhưng phải đếm: tuổi của ô đứng
 * yên theo nhịp hỏng, nên chỉ nhìn `atMs` thì "chưa tới hạn" và "đã hỏng 5 lần" trông giống hệt nhau.
 */
export function noteDecisionTickFailure(): number {
  return ++soLuotHongLienTiep;
}

export function decisionTickFailureStreak(): number {
  return soLuotHongLienTiep;
}

/**
 * Đọc ô. **ĐỒNG BỘ, không I/O, không tác dụng phụ** — gọi được từ trong đường `reserve()`.
 * `null` = **CHƯA có nhịp nào chạy trong tiến trình này** ⇒ người đọc PHẢI hiểu là **ĐANG MÙ**
 * (`"no-tick"`), TUYỆT ĐỐI không phải "thiết bị trống".
 */
export function readDecisionTick(): VramDecisionTick | null {
  if (o === null) return null;
  return {
    attributableBytes: o.fields.attributableBytes,
    baselineVerified: o.fields.baselineVerified,
    // ★ (D) — CÙNG một `fields`, cùng một nhịp. Không có đường nào để hai vế lệch nhau.
    baselineUnverifiedReasons: o.fields.baselineUnverifiedReasons,
    baselineOrigin: o.fields.baselineOrigin,
    atMs: o.atMs,
    consecutiveFailures: soLuotHongLienTiep,
  };
}

/**
 * ★ Pha 4 Task 1 (D) — Chỉ dùng trong test: **MỘT bản định nghĩa** của hai ô chẩn đoán mới.
 *
 * ⚠ VÌ SAO MỘT HÀM CHỨ KHÔNG PHẢI HAI DÒNG CHÉP VÀO MỖI FIXTURE: bất biến *"`unverifiedReasons`
 * rỗng ⇔ `baselineVerified === true`"* là thứ khối `baseline` của mặt đọc đứng lên. Mười ba fixture
 * tự khai hai ô đó là mười ba chỗ bất biến ấy vỡ được, im lặng, ở một file test chẳng liên quan.
 */
export function __tickFieldsForTests(
  attributableBytes: number | null,
  baselineVerified: boolean,
): VramDecisionTickFields {
  return {
    attributableBytes,
    baselineVerified,
    baselineUnverifiedReasons: baselineVerified ? [] : ["chua-chup-nen"],
    baselineOrigin: "local",
  };
}

/** Chỉ dùng trong test. */
export function __resetDecisionTickForTests(): void {
  o = null;
  soLuotHongLienTiep = 0;
}

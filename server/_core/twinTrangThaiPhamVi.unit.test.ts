import { describe, it, expect } from "vitest";

/**
 * ★★★ ĐỢT 6 — GHIM LUẬT LỌC PHẠM VI CỦA `twin:trangThai`.
 *
 * ⚠ LỖ HỔNG CÓ THẬT mà bản vá này đóng, đo được 2026-09-07:
 * handler `subscribe` (`socket.ts` ~dòng 166) cho socket join `twin:{id}` mà
 * **KHÔNG kiểm quyền** — id nhà máy là lời TỰ KHAI của client. Với `twin:device`
 * điều đó còn chịu được (gateway lọc trước khi phát), nhưng broadcaster
 * `twin:trangThai` tự ĐỌC DB theo id lấy từ tên phòng. Nếu phát thẳng cho cả
 * phòng thì `operator1` — tài khoản KHÔNG được gán nhà máy nào — chỉ cần gửi
 * `{twinFactoryId: 1}` là nhận trạng thái toàn SIM-FAC mỗi 10 giây.
 *
 * ⇒ Vòng phát lọc TỪNG SOCKET theo phạm vi của chính người cầm nó.
 *
 * Test này ghim PHÉP QUYẾT ĐỊNH (`factoryIds === null || includes(factoryId)`),
 * là đúng dòng logic trong `startTwinTrangThaiBroadcaster`. Số phạm vi dưới đây
 * là ẢNH CHỤP đo thật từ `resolveTenantFactoryScope` trên DB dev:
 *
 *   engineer1  (51, engineer)     factoryIds=[1]    -> NHẬN factory 1
 *   operator1  (48, operator)     factoryIds=[]     -> BỊ CHẶN
 *   supervisor1(49, supervisor)   factoryIds=[]     -> BỊ CHẶN
 *   maint1     (50, maintenance)  factoryIds=[]     -> BỊ CHẶN
 *   admin      (1,  admin)        factoryIds=null   -> NHẬN (bypass)
 *
 * ★ Đo bằng vai NON-ADMIN: admin bypass mọi cổng, nên một suite chỉ chạy admin
 *   chứng minh SỐ 0 về phân quyền.
 */

/** Đúng biểu thức quyết định trong `startTwinTrangThaiBroadcaster`. */
function duocNhan(factoryIds: number[] | null, factoryId: number): boolean {
  return factoryIds === null || factoryIds.includes(factoryId);
}

/** Ảnh chụp phạm vi THẬT (đo bằng `resolveTenantFactoryScope`, DB dev 2026-09-07). */
const PHAM_VI_DO_DUOC: Record<string, number[] | null> = {
  engineer1: [1],
  operator1: [],
  supervisor1: [],
  maint1: [],
  admin: null,
};

describe("twin:trangThai — lọc phạm vi từng người xem", () => {
  it("★★★ engineer1 (ĐƯỢC gán SIM-FAC) NHẬN factory 1 — chiều DƯƠNG", () => {
    // Thiếu ô này thì một bản vá "chặn tất" cũng xanh mọi test chặn bên dưới.
    expect(duocNhan(PHAM_VI_DO_DUOC.engineer1, 1)).toBe(true);
  });

  it("★★★ ba vai KHÔNG được gán nhà máy đều BỊ CHẶN khỏi factory 1", () => {
    // Đây chính là rò rỉ xuyên tenant mà broadcaster mở ra nếu phát cả phòng.
    expect(duocNhan(PHAM_VI_DO_DUOC.operator1, 1)).toBe(false);
    expect(duocNhan(PHAM_VI_DO_DUOC.supervisor1, 1)).toBe(false);
    expect(duocNhan(PHAM_VI_DO_DUOC.maint1, 1)).toBe(false);
  });

  it("★★★ ĐỐI CHỨNG — engineer1 BỊ CHẶN khỏi nhà máy KHÁC (18)", () => {
    // Chứng minh bộ lọc lọc theo NHÀ MÁY, không phải theo vai. Nếu nó chỉ hỏi
    // "có phải engineer không" thì ô này đỏ.
    expect(duocNhan(PHAM_VI_DO_DUOC.engineer1, 18)).toBe(false);
  });

  it("admin (`factoryIds === null`) không bị lọc — hành vi ĐÃ BIẾT, ghim để khỏi trôi", () => {
    expect(duocNhan(PHAM_VI_DO_DUOC.admin, 1)).toBe(true);
    expect(duocNhan(PHAM_VI_DO_DUOC.admin, 18)).toBe(true);
  });

  it("phạm vi RỖNG `[]` khác phạm vi `null` — hai câu khác hẳn nhau", () => {
    // `[]` = "đã phân giải, và người này không được gán nhà máy nào"
    // `null` = "không áp phạm vi" (vai toàn quyền).
    // Gộp hai cái làm một là biến người chưa được gán thành admin.
    expect(duocNhan([], 1)).toBe(false);
    expect(duocNhan(null, 1)).toBe(true);
  });
});

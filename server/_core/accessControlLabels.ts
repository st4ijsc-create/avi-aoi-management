/**
 * Nhãn "phạm vi rỗng" — hằng số THUẦN, KHÔNG phụ thuộc gì (không drizzle, không tRPC).
 *
 * ⚠ Vì sao tách khỏi `accessControl.ts`: file kia kéo theo `_core/trpc`, nên `server/db/**`
 * chỉ được nạp nó bằng `import()` ĐỘNG (nếu không sẽ thành vòng router → db → trpc). Nhưng ba
 * bề mặt (`db/inspection.ts`, `db/statistics.ts`, `db/andonBoard.ts`) cần giá trị nhãn ngay ở
 * nhánh sớm (`if (!db) return …`) và ở lối đi KHÔNG mang danh tính người dùng — tức TRƯỚC khi
 * có `await`. Đặt hằng số ở một module không phụ thuộc cho phép nhập TĨNH an toàn, và giữ câu
 * chữ ở ĐÚNG MỘT chỗ thay vì chép tay ba lần (chép tay là cách một trong ba bề mặt lặng lẽ
 * lệch câu chữ rồi không ai phát hiện).
 *
 * `accessControl.ts` re-export lại toàn bộ để nơi gọi có sẵn `_core/accessControl` không phải
 * biết tới file này.
 */

/** Mã máy-đọc-được cho trạng thái "phạm vi rỗng vì chưa được gán nhà máy". */
export const SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT = "no_factory_assignment" as const;
export type ScopeEmptyReason = typeof SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT;

/**
 * Câu "rỗng" TRUNG THỰC — nói đúng lý do, không giả vờ hệ thống không có số liệu.
 *
 * ⚠ Một màn hình 0 dòng của tài khoản CHƯA ĐƯỢC GÁN NHÀ MÁY không được trình bày giống hệt
 * một màn hình 0 dòng của dây chuyền sạch hay của một bộ lọc không khớp. Nói "không có dữ
 * liệu" dạy người vận hành rằng **hệ thống hỏng**, trong khi sự thật là **phạm vi của họ
 * rỗng** — và họ sẽ đi tìm lỗi ở đúng chỗ không có lỗi. Bản dịch en/zh ở `common.scopeEmpty.*`.
 */
// ⚠ Câu chữ ở đây cố ý TRÁNH cụm "không có dữ liệu" — kể cả trong vế PHỦ ĐỊNH. Người dùng đọc
// lướt chỉ bắt được cụm từ, không bắt được vế phủ định, nên một câu "…không phải là không có
// dữ liệu…" vẫn đọng lại đúng cái hiểu sai mà bản vá này đi xoá.
// `accessControlScope.test.ts` canh chính cụm ấy, nên đừng đưa nó trở lại.
export const NO_FACTORY_ASSIGNMENT_MESSAGE =
  "Tài khoản của bạn chưa được gán nhà máy nào, nên KHÔNG có bản ghi kiểm nào nằm trong " +
  "phạm vi bạn được xem. Đây là phạm vi rỗng — không phải kết luận rằng dây chuyền đang " +
  "ngừng chạy. Liên hệ quản trị viên để được gán nhà máy.";

/** Ba ô phạm vi gắn vào kết quả của mọi bề mặt (một nguồn, không chép tay ở ba chỗ). */
export interface ScopeLabels {
  /** Đã áp một bộ lọc phạm vi lên truy vấn hay chưa (false = vai toàn quyền). */
  scopeApplied: boolean;
  scopeEmptyReason: ScopeEmptyReason | null;
  scopeMessage: string | null;
}

/**
 * Nhãn cho lối đi KHÔNG mang danh tính người dùng (admin, tác vụ nền, export không ngữ cảnh).
 * `scopeEmptyReason: null` nghĩa là "phạm vi không rỗng vì lý do gán nhà máy" — KHÔNG phải
 * "đã kiểm tra và thấy có quyền". Nơi gọi không truyền `userId` thì vốn không lọc gì cả.
 */
export const UNSCOPED_LABELS: ScopeLabels = {
  scopeApplied: false,
  scopeEmptyReason: null,
  scopeMessage: null,
};

/**
 * ★★★ Trích ĐÚNG BA ô nhãn ra khỏi kết quả của `resolveDataScope`.
 *
 * **Vì sao phải có hàm này thay vì gán thẳng.** `resolveDataScope` trả về CẢ `filter` — một đối
 * tượng SQL của drizzle mang tham chiếu vòng (`PgTable → PgSerial → table`). Gán
 * `scope = resolved` rồi `return { ...scope }` sẽ **spread luôn `filter` vào đáp ứng tRPC**, và
 * superjson chết với `Converting circular structure to JSON`.
 *
 * **Vì sao `tsc` KHÔNG bắt được.** `ResolvedDataScope` gán được cho `ScopeLabels`: TypeScript chỉ
 * cấm thuộc tính thừa với *object literal*, không cấm khi gán một biến. Kiểu thì hẹp lại, còn
 * **giá trị lúc chạy vẫn mang `filter`** — và phép spread lôi nó ra.
 *
 * ⚠ Lỗi này SỐNG SÓT qua `tsc` sạch cả hai config VÀ 220 ca test, chỉ lộ ra khi gọi HTTP thật
 * (2026-08-17: `dashboard.getStats` trả 500 cho mọi người dùng). Đó là lý do hàm này tồn tại:
 * biến "quên bỏ `filter`" thành thứ **không diễn đạt được**, thay vì một quy ước phải nhớ.
 */
export function scopeLabelsOf(resolved: ScopeLabels & { filter?: unknown }): ScopeLabels {
  return {
    scopeApplied: resolved.scopeApplied,
    scopeEmptyReason: resolved.scopeEmptyReason,
    scopeMessage: resolved.scopeMessage,
  };
}

/** Kết quả dạng MẢNG có mang nhãn phạm vi (xem `withScopeLabels`). */
export type ScopedRows<T> = T[] & ScopeLabels;

/**
 * ★★ Gắn ba ô nhãn lên một kết quả DẠNG MẢNG mà KHÔNG đổi hình dạng của mảng.
 *
 * **Vì sao không đơn giản đổi sang `{ rows, ...nhãn }`.** Ba hàm thống kê trả mảng
 * (`getShiftStats`, `getShiftReport`, `getTopNGMeasurementPoints`) đang được tiêu thụ bởi
 * `routers/pdfReportRouter.ts` (`(topNG || []).map(…)`), `powerpointRouter.ts` và
 * `reportBuilderRouter.ts` (`return { data }` — payload của widget báo cáo LÀ cái mảng ấy).
 * Đổi kiểu trả về vừa làm `tsc` đỏ ở hai file đầu, vừa đổi ngầm payload báo cáo ở file thứ ba.
 * Nên nhãn được ĐÍNH LÊN chính mảng: mọi nơi gọi cũ (`.map`, `.length`, `for…of`) chạy y
 * nguyên, còn nơi nào cần lý do rỗng thì đọc `rows.scopeEmptyReason`.
 *
 * **Vì sao KHÔNG liệt kê được (`enumerable: false`).** Ba lý do đo được, không phải sở thích:
 *  1. `JSON.stringify` / superjson của mảng chỉ lấy phần tử theo chỉ số — thêm ô liệt kê được
 *     cũng KHÔNG lên được dây, nên chẳng lợi gì.
 *  2. `expect(rows).toEqual([...])` của vitest so cả khoá own-enumerable ⇒ ô liệt kê được sẽ
 *     làm ĐỎ hàng loạt lưới cũ vốn không liên quan gì tới phạm vi.
 *  3. `{ ...rows }` ở nơi gọi cũ sẽ lặng lẽ nuốt thêm ba khoá lạ.
 *
 * ⚠ Vì mảng KHÔNG mang được nhãn qua tRPC, thủ tục nào trả thẳng mảng (`dashboard.getShiftStats`,
 * `inspection.topNGPoints`) thì giao diện phải lấy lý do từ truy vấn CÙNG MÀN có mang nhãn
 * (`dashboard.getStats*`, `inspection.search`). Điều này được ghi lại ở đúng chỗ dùng.
 *
 * ★ Như `scopeLabelsOf`, hàm này chỉ chép ĐÚNG BA ô — `filter` (đối tượng SQL có tham chiếu
 * vòng) không có đường nào lọt ra kết quả, kể cả khi nơi gọi truyền nguyên `ResolvedDataScope`.
 */
export function withScopeLabels<T>(
  rows: T[],
  resolved: ScopeLabels & { filter?: unknown },
): ScopedRows<T> {
  const labels = scopeLabelsOf(resolved);
  const descriptor = (value: unknown): PropertyDescriptor => ({
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return Object.defineProperties(rows, {
    scopeApplied: descriptor(labels.scopeApplied),
    scopeEmptyReason: descriptor(labels.scopeEmptyReason),
    scopeMessage: descriptor(labels.scopeMessage),
  }) as ScopedRows<T>;
}

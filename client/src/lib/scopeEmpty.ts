/**
 * ⚠ 2026-08-17 — VỊ TỪ "PHẠM VI RỖNG" phía client, TÁCH KHỎI JSX để canh được.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG XOÁ — nghiệm thu THỊ GIÁC 2026-08-17 bắt được, MỌI phép đo API đều mù
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Tài khoản `supervisor1` (0 gán nhà máy) mở `/dashboard`: dải `ScopeEmptyNotice` trên đầu nói
 * ĐÚNG ("phạm vi rỗng"), nhưng ngay bên dưới khối cảnh báo yield vẫn nói *"Tạm chưa có dữ liệu
 * kiểm"*. **Cùng một màn hình, một khối nói thật, một khối nói sai** — và khối nói sai dạy
 * người vận hành rằng HỆ THỐNG chưa có dữ liệu, nên họ đi tìm lỗi ở đúng chỗ không có lỗi.
 *
 * Dải trên đầu KHÔNG sửa được lớp lỗi này: nó chỉ thêm một câu đúng cạnh những câu sai, và mắt
 * người đọc khối gần nhất với chỗ đang nhìn.
 *
 * ── VÌ SAO LÀ MODULE `.ts` RIÊNG, KHÔNG NHÉT VÀO `ScopeEmptyNotice.tsx` ────────────────────
 * `vitest.config.ts` gom test client bằng `client/src/**\/*.unit.test.ts` chạy ở môi trường
 * **node**. Vị từ nằm ở module thuần thì canh được bằng bảng chân trị đầy đủ, không cần jsdom
 * và không kéo theo `react-i18next`. Component vẫn được canh riêng bằng `react-dom/server`.
 *
 * ── HAI CHIỀU, KHÔNG PHẢI MỘT ─────────────────────────────────────────────────────────────
 * ⚠ Một dây chuyền THẬT SỰ không có sản lượng hôm nay VẪN PHẢI nói "chưa có dữ liệu". Vị từ
 * dưới đây chỉ trả `true` khi máy chủ khai ĐÚNG mã `no_factory_assignment`; mọi giá trị khác
 * (`null`, `undefined`, chuỗi lạ) đều là "rỗng thật" và giữ nguyên câu cũ. Vá quá tay — hiện
 * câu phạm-vi-rỗng cho người CÓ gán — là một lời nói dối theo chiều ngược lại.
 */

/** Mã máy-đọc-được máy chủ trả ở `scopeEmptyReason` (`server/_core/accessControlLabels.ts`). */
export const SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT = "no_factory_assignment";

/** Bất kỳ kết quả truy vấn nào có thể mang nhãn phạm vi. */
export interface ScopeLabelled {
  scopeEmptyReason?: string | null;
}

/**
 * `true` ⇔ phạm vi của tài khoản rỗng vì CHƯA ĐƯỢC GÁN NHÀ MÁY.
 *
 * ⚠ So SÁNH BẰNG, không phải "khác null". `scopeApplied === true` với `scopeEmptyReason === null`
 * là trường hợp *"có gán, có lọc, và trong phạm vi thật sự không có bản ghi"* — chính là ca
 * "rỗng thật" phải giữ nguyên câu cũ.
 */
export function isScopeEmpty(reason?: string | null): boolean {
  return reason === SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT;
}

/**
 * Gom lý do từ NHIỀU nguồn CÙNG MÀN và trả về cái đầu tiên hợp lệ (`null` nếu không có).
 *
 * ⚠ VÌ SAO CẦN NHIỀU NGUỒN. Thủ tục nào trả **thẳng một mảng** (`dashboard.getShiftStats`,
 * `inspection.topNGPoints`) thì nhãn KHÔNG đi qua được tRPC: `withScopeLabels` đính nhãn
 * không-liệt-kê-được nên `JSON`/superjson bỏ qua (xem docblock ở
 * `server/_core/accessControlLabels.ts`). Những khối ấy phải lấy lý do từ một truy vấn khác
 * **trên cùng màn** có mang nhãn — hàm này là chỗ duy nhất làm việc ghép ấy.
 *
 * Nhận cả chuỗi trần lẫn đối tượng có ô `scopeEmptyReason`, để nơi gọi không phải nhớ
 * truy vấn nào trả hình dạng nào.
 */
export function scopeEmptyReasonOf(
  ...sources: Array<ScopeLabelled | string | null | undefined>
): string | null {
  for (const source of sources) {
    if (source == null) continue;
    const reason = typeof source === "string" ? source : source.scopeEmptyReason;
    if (isScopeEmpty(reason)) return SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT;
  }
  return null;
}

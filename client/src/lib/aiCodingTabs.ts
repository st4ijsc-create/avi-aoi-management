/**
 * ★★★ 2026-08-26 · CURSOR-PARITY — TAB ĐA-TỆP cho Trình xem của `/ai-coding-workspace`.
 *
 * Trước lượt này Trình xem chỉ giữ MỘT `selectedPath`: mở tệp khác là MẤT tệp đang xem. Cursor/VSCode
 * mở nhiều tệp thành TAB. Ở đây `openTabs` (danh sách đường tệp đang mở) đi KÈM `selectedPath` (tab
 * ĐANG hoạt động) — thuần additive, không đụng đường đọc tệp (vẫn `readFile` theo `selectedPath`).
 *
 * ⚠ VÌ SAO TÁCH HÀM THUẦN: logic "đóng tab đang hoạt động thì chọn tab NÀO kế tiếp" có ca biên (đóng
 * tab cuối · đóng tab không-hoạt-động · đóng tab duy nhất) mà nếu viết chìm trong handler JSX thì chỉ
 * đo được bằng một lượt render CẢ trang. Thuần ⇒ `aiCodingTabs.unit.test.ts` hỏi thẳng "đóng X khi
 * đang ở Y ⇒ còn tab gì, hoạt động tab nào" bằng `toEqual`. (Cùng khuôn `phanQuyetPhimNhap`.)
 */

/** Kết quả một lượt đóng tab: danh sách còn lại + tab hoạt động MỚI (null khi không còn tab nào). */
export interface KetQuaDongTab {
  tabs: string[];
  active: string | null;
}

/**
 * Đóng `dongPath` khỏi `tabs`; trả danh sách còn lại + tab hoạt động mới.
 *   • `dongPath` không có trong `tabs` ⇒ no-op (giữ nguyên `tabs` + `active`).
 *   • Đóng tab KHÔNG hoạt động ⇒ `active` giữ nguyên.
 *   • Đóng tab ĐANG hoạt động ⇒ chọn kế tiếp: tab RA SAU nó (dồn về cùng chỉ số), nếu không có thì tab
 *     TRƯỚC nó; hết tab ⇒ `null`. (Đúng thói quen VSCode: đóng tab hiện tại nhảy sang tab bên phải,
 *     hết bên phải thì bên trái.)
 */
export function dongTab(tabs: readonly string[], dongPath: string, activePath: string | null): KetQuaDongTab {
  const idx = tabs.indexOf(dongPath);
  if (idx === -1) return { tabs: [...tabs], active: activePath };
  const conLai = tabs.filter((t) => t !== dongPath);
  if (dongPath !== activePath) return { tabs: conLai, active: activePath };
  // Đóng tab đang hoạt động: sau khi bỏ ở `idx`, `conLai[idx]` chính là tab từng đứng SAU nó.
  const activeMoi = conLai[idx] ?? conLai[idx - 1] ?? null;
  return { tabs: conLai, active: activeMoi };
}

/**
 * Mở `path` thành tab (nếu chưa có) — luôn đặt nó thành tab hoạt động. Giữ THỨ TỰ mở (không đẩy lên
 * đầu) để tab không nhảy chỗ mỗi lần bấm lại — đúng thói quen VSCode. Trần `tran` chặn danh sách phình
 * vô hạn (mở rất nhiều tệp): quá trần thì BỎ tab cũ NHẤT chưa-hoạt-động ở đầu.
 */
export function moTab(tabs: readonly string[], path: string, tran = 12): string[] {
  if (tabs.includes(path)) return [...tabs];
  const them = [...tabs, path];
  if (them.length <= tran) return them;
  // Vượt trần ⇒ bỏ tab CŨ NHẤT (đầu danh sách). `path` vừa thêm ở cuối nên không bao giờ bị bỏ.
  return them.slice(them.length - tran);
}

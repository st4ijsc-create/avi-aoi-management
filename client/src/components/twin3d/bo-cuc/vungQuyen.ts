/**
 * ════════════════════════════════════════════════════════════════════════════
 * `vungQuyen.ts` — QĐ-18: **HAI TRANG**, HAI CỔNG. Tệp này giữ HAI DANH SÁCH.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ LỊCH SỬ, GIỮ NGUYÊN VĂN VÌ NÓ GIẢI THÍCH HÌNH DẠNG HÔM NAY
 *
 * • §13b (14.2.2) **đề nghị KHÔNG gộp** `/twin` với `/twin-studio`: hai màn có
 *   hai cổng quyền khác nhau.
 * • **QĐ-16** (2026-09-08) chủ sở hữu **chọn GỘP**. Đợt 21 thực thi: một trang,
 *   quyền theo TỪNG VÙNG (`kepVungTheoQuyen` kẹp `?che-do=botri` theo quyền).
 * • **QĐ-18** (2026-09-09) chủ sở hữu **ĐẢO NGƯỢC QĐ-16**, và lý do mạnh hơn:
 *
 *     *"Twin-studio là nơi THIẾT KẾ và layout cũng như xây dựng 3D Twin…
 *      CHỈ NHỮNG NGƯỜI CÓ QUYỀN mới làm được. Còn Twin là nơi TRÌNH DIỄN, XEM,
 *      QUẢN LÝ REALTIME nhà máy, KHÔNG CHỈNH SỬA ĐƯỢC… 2 trang liên kết với
 *      nhau nhưng MỤC ĐÍCH HOÀN TOÀN KHÁC NHAU."*
 *
 *   QĐ-16 coi đây là hai VÙNG của một việc ⇒ gộp đúng. QĐ-18 nói đây là hai
 *   MỤC ĐÍCH ⇒ tách đúng. Người chỉ xem **không bao giờ cần** công cụ sửa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ BỀ MẶT THẬT, ĐO LẠI 2026-09-09 (bảng `permissions`, 8 tài khoản active)
 * ────────────────────────────────────────────────────────────────────────────
 *     operator1     xem ✅ (machine_status)  · sửa ❌
 *     engineer1     ✅ / ✅      maint1       ✅ / ✅
 *     supervisor1   ✅ / ✅      e2e_tai_loE  ✅ / ✅
 *
 * ⇒ ★★★ `operator1` **KHÔNG MẤT GÌ KHI TÁCH**. Đây là số đo trả lời trực tiếp
 *   nỗi lo lớn nhất của QĐ-16 ("cổng CHẶT ⇒ operator1 mất lối vào"): họ vốn
 *   không có `settings_factory` lẫn `machine_control`, nên vùng sửa với họ đã
 *   luôn không tồn tại — QĐ-16 cũng tự hạ họ về `xem`. Tách chỉ **đổi chỗ** một
 *   thứ họ chưa từng thấy. Khác hẳn tai nạn Đợt 3 CHẶN-1, nơi 2/4 vai mất một
 *   màn họ ĐANG dùng được.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ CÒN LẠI GÌ TRONG TỆP NÀY — VÀ CÁI GÌ ĐÃ BỊ XOÁ, VÌ SAO
 * ────────────────────────────────────────────────────────────────────────────
 * CÒN: hai danh sách quyền + hai vị từ. Chúng là **hợp đồng BA CHỖ**
 * (`navigation.tsx` ↔ tệp này ↔ `twinCanhRouter.ts:63`), và lưới cưỡng chế
 * điều đó vẫn còn nguyên giá trị sau khi tách.
 *
 * XOÁ (Đợt 26): `kepVungTheoQuyen`, `docVungTuUrl`, `TenVung`, `VungDaKep`.
 * Chúng tồn tại **chỉ để kẹp `?che-do=`** — một khoá URL nay không còn tồn tại
 * ở bất kỳ đâu. Sau QĐ-18 chúng có **0 chỗ gọi ngoài test** (đếm bằng cách
 * liệt kê MỌI export, tách `import` / gọi hàm — G70). Giữ lại là để một API
 * chết cùng 8 lưới xanh canh gác đúng con số không — chính lớp lỗi "CÓ MÃ +
 * CÓ TEST + KHÔNG GIAO HÀNG" mà đợt Twin trước đã đo được 4 lỗ.
 *
 * ★ Việc kẹp mà chúng từng làm KHÔNG biến mất, nó **đổi tầng**: từ "kẹp trong
 *   trang" sang "cổng ở cửa" (`RouteGuard navHref="/twin-studio"` ở `App.tsx`,
 *   tra quyền từ chính ô nav). Hàng rào GHI không đổi: `requireAnyPermission`
 *   ở `twinCanhRouter.ts:63`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ LUẬT ẨN-KHÔNG-DISABLE (§12b.3) — VẪN ÁP DỤNG, CHỈ ĐỔI ĐỐI TƯỢNG
 * ────────────────────────────────────────────────────────────────────────────
 * Trước: ẩn NÚT "Sửa bố cục". Nay: ẩn **LIÊN KẾT sang `/twin-studio`** trên
 * `/twin`, và ẩn **mục nav** `/twin-studio` (nav tự lọc theo quyền). Thiếu
 * quyền thì không thấy, chứ không phải thấy rồi bị chặn.
 *
 * ⚠ Đây KHÔNG phải hàng rào bảo mật. Nó là hàng rào **giao diện**.
 *
 * ★ Module THUẦN — không react, không DOM. Cưỡng chế được ở `environment:"node"`.
 */

/** Chữ ký tối thiểu của `hasPermission` từ `usePermissions()`. */
export type DoQuyen = (moduleName: string, action?: "canView") => boolean;

/**
 * Quyền **VÀO TRANG** — giữ NGUYÊN cổng cũ của `/twin`.
 *
 * ⚠ Danh sách này phải khớp NGUYÊN VĂN `navigation.tsx` ô `/twin`
 *   (`requiredPermissionAny: ["analytics_oee", "machine_status"]`). Hai bên
 *   lệch nhau là lớp lỗi "một lối vào rồi TỪ CHỐI" của Khối D.
 */
export const QUYEN_XEM: readonly string[] = ["analytics_oee", "machine_status"];

/**
 * Quyền **SỬA NHÀ XƯỞNG** — giữ NGUYÊN cổng cũ của `/twin-studio`.
 *
 * ⚠ Khớp NGUYÊN VĂN `navigation.tsx` ô `/twin-studio`
 *   (`["settings_factory", "machine_control"]`) và `twinCanhRouter.ts:63`
 *   `quyenThietKe()`. Ba chỗ là **một hợp đồng**; đổi một chỗ phải đổi cả ba.
 */
export const QUYEN_SUA: readonly string[] = ["settings_factory", "machine_control"];

/** Vào được trang? (`hoặc` trên `QUYEN_XEM`) */
export function coQuyenXemTwin(coQuyen: DoQuyen): boolean {
  return QUYEN_XEM.some((q) => coQuyen(q, "canView"));
}

/**
 * ★★★ Thấy vùng SỬA? (`hoặc` trên `QUYEN_SUA`)
 *
 * `false` ⇒ mọi công cụ sửa nhà xưởng (kéo thả, gizmo, lưu bố cục, nút "Sửa bố
 * cục") **KHÔNG được render**. Không disable, không tooltip "bạn thiếu quyền" —
 * ẩn hẳn.
 */
export function coQuyenSuaNhaXuong(coQuyen: DoQuyen): boolean {
  return QUYEN_SUA.some((q) => coQuyen(q, "canView"));
}

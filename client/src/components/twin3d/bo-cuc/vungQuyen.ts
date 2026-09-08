/**
 * ════════════════════════════════════════════════════════════════════════════
 * `vungQuyen.ts` — QD-16: MỘT TRANG, **QUYỀN THEO TỪNG VÙNG** (spec §13c.1)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ QUYẾT ĐỊNH CỦA CHỦ SỞ HỮU, VÀ VÌ SAO NÓ KHÁC ĐỀ NGHỊ CỦA §13b
 *
 * §13b (14.2.2) **đề nghị KHÔNG gộp** `/twin` với `/twin-studio`, vì hai màn có
 * hai cổng quyền khác nhau. Chủ sở hữu đã đọc lý lẽ đó và **vẫn chọn GỘP**
 * (§13c.1). Điều đó hợp lệ, và §13c chỉ ra lối thoát sạch: gộp **bề mặt**,
 * KHÔNG gộp **cổng**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ BỀ MẶT THẬT, ĐO ĐƯỢC (bảng `permissions`, 2026-09-08)
 * ────────────────────────────────────────────────────────────────────────────
 *     Tổng tài khoản hoạt động có quyền vào Twin : 7  (4 thường + 3 admin)
 *     Vào được CẢ HAI màn                        : 4  engineer1, maint1,
 *                                                     supervisor1, e2e_tai_loE
 *     CHỈ vào được /twin                         : 1  ← operator1 (vai operator)
 *
 * ⇒ Rủi ro **không phải giả định**, nó là **đúng một người**. Và vì thế mọi
 *   thiết kế ở đây phải trả lời được **hai câu, không phải một**:
 *
 *     (a) `operator1` CÓ vào được trang không?      → PHẢI: có
 *     (b) `operator1` CÓ thấy nút SỬA không?        → PHẢI: không
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ HAI CÁCH GỘP BỊ TỪ CHỐI — ghi lại để đợt sau không "sửa" ngược
 * ────────────────────────────────────────────────────────────────────────────
 * • **Cổng CHẶT** (`settings_factory` cho cả trang): `operator1` **mất luôn lối
 *   vào**, không xem được 3D nữa. Đó đúng là **tai nạn Đợt 3 CHẶN-1** (1/4 vai
 *   mất quyền) mà **Đợt 15 đã phải vá ngược** — xem `navigation.tsx:445-461`.
 * • **Cổng RỘNG** (ai xem được thì sửa được): `operator1` **sửa được nhà xưởng**.
 *   Đó là **đổi mô hình an toàn**, không phải đổi giao diện.
 *
 * ⇒ Còn lại đúng một cách: **quyền theo TỪNG VÙNG**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ LUẬT ẨN-KHÔNG-DISABLE (§12b.3)
 * ────────────────────────────────────────────────────────────────────────────
 * Thiếu quyền thì **ẨN**, không hiện-rồi-chặn. Hiện một nút rồi từ chối khi bấm
 * là dạy người dùng rằng hệ thống hỏng; ẩn nó là nói rằng việc ấy không thuộc
 * vai này. Khuôn đã có ở `nganXuLyLogic.ts:102-111`; vi phạm duy nhất từng đo
 * được đã vá ở `RobotCockpit.tsx:916-918` (P-3).
 *
 * ⚠ Đây KHÔNG phải hàng rào bảo mật. Nó là hàng rào **giao diện**. Đường ghi
 *   thật vẫn do server cưỡng chế (`twinCanhRouter.ts:63` `requireAnyPermission`),
 *   và phải như vậy: ẩn một nút không ngăn được ai gọi thẳng tRPC.
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

/** Hai vùng của trang gộp. `xem` là vùng ai vào được cũng thấy. */
export type TenVung = "xem" | "sua";

/**
 * Vùng đang mở, đã **kẹp theo quyền**.
 *
 * ★★★ ĐÂY LÀ CHỖ DỄ GÂY TAI NẠN NHẤT CỦA ĐỢT, và nó là một hàm chứ không phải
 *   một `if` rải rác: `?che-do=botri` (hoặc một redirect từ `/twin-studio`) đưa
 *   `yeuCau="sua"` vào cho MỌI người, kể cả `operator1`. Nếu tầng gọi tin thẳng
 *   vào URL thì `operator1` sẽ thấy vùng sửa — **cổng rộng**, đúng thứ §13c.1 từ
 *   chối.
 *
 * ⇒ Hàm này **luôn hạ về `"xem"`** khi thiếu quyền, và **không bao giờ ném lỗi**
 *   (URL là đầu vào không tin được). Trả về cả `daHaCap` để tầng gọi khai thật
 *   với người dùng thay vì im lặng hiện một thứ khác.
 */
export interface VungDaKep {
  vung: TenVung;
  /** `true` khi URL đòi `sua` mà quyền không cho — cần NÓI RA, không im lặng. */
  daHaCap: boolean;
}

export function kepVungTheoQuyen(yeuCau: TenVung, coQuyen: DoQuyen): VungDaKep {
  if (yeuCau !== "sua") return { vung: "xem", daHaCap: false };
  const duocSua = coQuyenSuaNhaXuong(coQuyen);
  return duocSua ? { vung: "sua", daHaCap: false } : { vung: "xem", daHaCap: true };
}

/**
 * Đọc vùng từ query string, KHÔNG kẹp quyền.
 *
 * ★ Tách đôi có chủ ý: đọc URL và áp quyền là hai việc, và trộn chúng làm phép
 *   đọc không test được riêng. Tầng gọi PHẢI chạy `kepVungTheoQuyen` sau — và
 *   test cưỡng chế rằng bỏ qua bước đó thì `operator1` thấy vùng sửa.
 *
 * ⚠ Giá trị lạ (`?che-do=xoa-het`) rơi về `"xem"`, không ném lỗi: URL là đầu vào
 *   không tin được (nguyên tắc của `duongDanTwin.ts`).
 */
export function docVungTuUrl(raw: string | null | undefined): TenVung {
  return raw === "botri" || raw === "sua" ? "sua" : "xem";
}

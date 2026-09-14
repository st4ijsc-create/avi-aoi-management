/**
 * nganXuLyLogic.ts — LUẬT của `NganXuLy` (§9.2): Twin là nơi **XỬ LÝ**, không
 * chỉ để xem. Đây là phần quan trọng nhất của màn Vận hành.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-2 — 3D ĐỊNH VỊ, 2D QUYẾT ĐỊNH
 * ════════════════════════════════════════════════════════════════════════════
 * Khảo sát: KHÔNG hệ lớn nào (AWS TwinMaker, Azure ADT, ThingsBoard) cho ack
 * alarm / tạo phiếu ngay trên 3D ⇒ **không có tiền lệ để sao chép**. Cách giải
 * mâu thuẫn giữa "mọi việc xử lý trên twin" (yêu cầu chủ sở hữu) và "3D không
 * nên là mặt xử lý alarm" (ASM/ISA-101): **ngữ cảnh ở 3D, hành động ở ngăn 2D**.
 *
 * ⇒ KHÔNG có nút ack nổi trên máy 3D. Mọi nút nằm trên bề mặt 2D tuân ISA-101,
 *   và mọi nút đó CŨNG phải bấm được từ danh sách DOM bên trái (§9.9) — nếu
 *   không thì bàn phím và trình đọc màn hình mất hẳn đường xử lý.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QUYỀN — ĐO ĐƯỢC, KHÔNG PHỎNG ĐOÁN (2026-09-06, SQL thô)
 * ════════════════════════════════════════════════════════════════════════════
 * Ba hành động của §9.2 đi qua BA cổng quyền KHÁC NHAU, và tập người qua được
 * mỗi cổng cũng khác nhau — đo trên 4 tài khoản không-admin của repo:
 *
 *   | hành động   | thủ tục                        | module (đã resolve)   | ai qua (48-51)         |
 *   |-------------|--------------------------------|-----------------------|------------------------|
 *   | mở /twin    | (RouteGuard navHref)           | analytics_oee/canView | supervisor1            |
 *   | ack alarm   | andon.acknowledge              | andon/canEdit         | operator1, supervisor1, engineer1 |
 *   | tạo phiếu   | maintenance.createWorkOrder    | machine_status/canCreate ★ | engineer1         |
 *   | ẩn tạm      | equipmentStandards.shelveMasterAlarm | machine_control/canCreate | supervisor1, engineer1 |
 *
 * ★ `maintenance.createWorkOrder` khai `requirePermission("machine_monitoring",…)`,
 *   nhưng `machine_monitoring` là một CATEGORY, không phải module. Cả server lẫn
 *   client resolve nó qua `PERMISSION_MODULE_ALIASES` về **`machine_status`**
 *   (`shared/permissions.ts`). Kiểm quyền ở client PHẢI dùng cùng tên mà server
 *   dùng, nếu không hai bên lệch và ta lại dựng đúng lớp lỗi "một lối vào rồi TỪ
 *   CHỐI" của Khối D. `usePermissions.hasPermission` đã resolve sẵn, nên tầng
 *   component truyền tên nào cũng ra cùng kết quả — ta khai `machine_monitoring`
 *   để KHỚP NGUYÊN VĂN với router, và ghi chú này để không ai "sửa" thành tên khác.
 *
 * ⚠ Đo quyền PHẢI bằng tài khoản KHÔNG-admin: admin bypass `requirePermission`,
 *   nên một phép đo bằng admin chứng minh SỐ 0 về cổng quyền.
 *
 * ★ Module THUẦN — không react, không trpc. Nó chỉ trả lời "hành động nào ĐƯỢC
 *   PHÉP và ĐÁNG HIỆN lúc này"; việc gọi mutation là của component.
 */

/** Ba nhóm hành động của §9.2. */
export type NhomHanhDong = "canhBao" | "taoViec" | "moChucNang";

/** Mã hành động — khoá ổn định cho `data-testid` và cho test. */
export type MaHanhDong =
  | "ack"
  | "anTam"
  | "ghiChu"
  | "taoPhieu"
  | "ganKyThuat"
  | "datUuTien";

/** Quyền người dùng đang có, đã đọc từ `usePermissions`. */
export interface QuyenXuLy {
  /** `andon` / canEdit — ack và ghi chú. */
  ackAlarm: boolean;
  /** `machine_control` / canCreate — ẩn tạm (shelve) master alarm. */
  anTamAlarm: boolean;
  /** `machine_monitoring`→`machine_status` / canCreate — tạo phiếu. */
  taoPhieu: boolean;
  /** `machine_monitoring`→`machine_status` / canEdit — gán KTV, đặt ưu tiên. */
  suaPhieu: boolean;
}

export const QUYEN_RONG: QuyenXuLy = {
  ackAlarm: false,
  anTamAlarm: false,
  taoPhieu: false,
  suaPhieu: false,
};

/** Một cảnh báo đang mở trên vật thể đang chọn (`andon_events`). */
export interface CanhBaoDangMo {
  id: number;
  /** `andon_events.state` — green|yellow|red|call. */
  mucDo: string;
  /** `andon_events.status` — raised|acknowledged|resolved. */
  trangThai: string;
  tieuDe: string;
  raisedAt: number;
  machineId: number | null;
}

/** Một hành động sẵn sàng hiện trên ngăn xử lý. */
export interface HanhDongKhaDung {
  ma: MaHanhDong;
  nhom: NhomHanhDong;
  /** false ⇒ ẩn hẳn (KHÔNG disable) — xem docblock về "ẩn chứ không disable". */
  duocPhep: boolean;
  /**
   * Lý do KHÔNG khả dụng, khi `duocPhep=true` mà vẫn không bấm được lúc này
   * (ví dụ: alarm đã ack rồi). Khác hẳn "không có quyền".
   */
  lyDoChan: "da_ack" | "khong_co_canh_bao" | "chua_chon_may" | null;
}

/**
 * ★★★ ẨN CHỨ KHÔNG DISABLE — cùng luật CHẶN-2 của màn Thiết kế.
 *
 * Một nút xám vẫn nói *"chức năng này thuộc về bạn, chỉ đang không dùng được lúc
 * này"*, nên người dùng đi tìm cách bật nó. Với người KHÔNG BAO GIỜ có quyền,
 * câu đó là SAI. Nên `duocPhep=false` ⇒ component không render nút.
 *
 * Ngược lại, `lyDoChan` (đã ack rồi / chưa chọn máy) LÀ trạng thái tạm thời và
 * người dùng CÓ thể thay đổi được — ca đó mới disable + giải thích.
 */
export function hanhDongChoVatThe(args: {
  quyen: QuyenXuLy;
  /** Máy đang chọn; `null` = chưa chọn gì. */
  machineId: number | null;
  canhBao: readonly CanhBaoDangMo[];
}): HanhDongKhaDung[] {
  const { quyen, machineId, canhBao } = args;
  const chuaChon = machineId === null;
  const coCanhBaoChuaAck = canhBao.some((c) => c.trangThai === "raised");
  const coCanhBao = canhBao.length > 0;

  const lyDoCanhBao = chuaChon
    ? ("chua_chon_may" as const)
    : !coCanhBao
      ? ("khong_co_canh_bao" as const)
      : !coCanhBaoChuaAck
        ? ("da_ack" as const)
        : null;

  return [
    { ma: "ack", nhom: "canhBao", duocPhep: quyen.ackAlarm, lyDoChan: lyDoCanhBao },
    {
      ma: "anTam",
      nhom: "canhBao",
      duocPhep: quyen.anTamAlarm,
      // Ẩn tạm áp được cả khi alarm ĐÃ ack (ISA-18.2: shelve khác acknowledge) —
      // nên chỉ chặn khi không có cảnh báo nào.
      lyDoChan: chuaChon ? "chua_chon_may" : coCanhBao ? null : "khong_co_canh_bao",
    },
    {
      ma: "ghiChu",
      nhom: "canhBao",
      duocPhep: quyen.ackAlarm,
      lyDoChan: chuaChon ? "chua_chon_may" : coCanhBao ? null : "khong_co_canh_bao",
    },
    // Tạo phiếu KHÔNG cần có cảnh báo: bảo trì phòng ngừa là ca dùng chính đáng.
    { ma: "taoPhieu", nhom: "taoViec", duocPhep: quyen.taoPhieu, lyDoChan: chuaChon ? "chua_chon_may" : null },
    { ma: "ganKyThuat", nhom: "taoViec", duocPhep: quyen.suaPhieu, lyDoChan: chuaChon ? "chua_chon_may" : null },
    { ma: "datUuTien", nhom: "taoViec", duocPhep: quyen.suaPhieu, lyDoChan: chuaChon ? "chua_chon_may" : null },
  ];
}

/** Lọc ra các hành động THẬT SỰ bấm được ngay bây giờ (có quyền và không bị chặn). */
export function hanhDongBamDuoc(ds: readonly HanhDongKhaDung[]): MaHanhDong[] {
  return ds.filter((h) => h.duocPhep && h.lyDoChan === null).map((h) => h.ma);
}

/**
 * §9.2 "Ẩn tạm (shelve) CÓ HẠN" — ISA-18.2 đòi alarm bị shelve phải **tự bung**.
 *
 * Các mốc cho sẵn (giờ). Không cho nhập tự do: một ô text mở đường cho "ẩn tạm
 * 9999 giờ", tức là suppress vĩnh viễn đội lốt shelve — đúng thứ ISA-18.2 tách
 * hai khái niệm ra để chặn.
 */
export const MOC_AN_TAM_GIO: readonly number[] = [1, 4, 8, 24];

/** Trần cứng — không mốc nào được vượt (một ca làm việc dài nhất là 24 h). */
export const TRAN_AN_TAM_GIO = 24;

/**
 * Thời điểm tự bung của một lượt ẩn tạm.
 *
 * ★ Trả `null` với số giờ không hợp lệ (≤ 0, không hữu hạn, vượt trần) thay vì
 *   kẹp về trần: kẹp âm thầm biến một lượt nhập sai thành một lượt shelve HỢP LỆ
 *   mà người dùng không hề định, và vết kiểm toán sẽ ghi một con số không ai gõ.
 */
export function hanAnTam(soGio: number, bayGio: number): number | null {
  if (!Number.isFinite(soGio) || soGio <= 0 || soGio > TRAN_AN_TAM_GIO) return null;
  return bayGio + soGio * 3_600_000;
}

/** Một lượt shelve còn hiệu lực không? (`shelvedUntil > now`, khớp `isShelvedNow` của server) */
export function dangAnTam(shelvedUntil: number | null | undefined, bayGio: number): boolean {
  return shelvedUntil != null && shelvedUntil > bayGio;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* §9.3 — BẢNG ĐIỀU HƯỚNG: mở chức năng chuyên sâu, MANG THEO ĐÚNG ID          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Loại vật thể mà bảng §9.3 phân biệt. */
export type LoaiDich = "machine" | "station" | "line" | "workshop" | "factory" | "robot";

export interface NutDieuHuong {
  /** Khoá i18n cho nhãn nút. */
  khoaNhan: string;
  /** Đường dẫn ĐÃ mang id — không để component tự ghép (chỗ dễ quên id nhất). */
  href: string;
  /** Module quyền của màn đích; component ẩn nút nếu người dùng không có canView. */
  quyen: string;
}

/**
 * Bảng điều hướng §9.3 — đo được từ 11 màn hiện có.
 *
 * ⚠ MỌI href ở đây phải là route THẬT trong `App.tsx`. Một nút trỏ tới route
 *   không tồn tại rơi vào trang 404 — và đó là lớp lỗi tệ hơn không có nút, vì
 *   người dùng tin là chức năng có mà hỏng.
 *
 * ★★★ MỌI `quyen` DƯỚI ĐÂY ĐƯỢC ĐỌC TỪ NGUỒN, KHÔNG ĐOÁN (2026-09-06).
 *   Lượt viết đầu tiên của bảng này đoán `traceability` và `production_view` là
 *   tên module — cả hai **KHÔNG TỒN TẠI** trong `PERMISSION_MODULES`. Hậu quả
 *   nếu để nguyên: `hasPermission("traceability", …)` trả `false` cho MỌI người
 *   không-admin ⇒ nút biến mất vĩnh viễn với đúng những người cần nó, và không
 *   lỗi nào nổ. Đó là lớp lỗi "một lối vào rồi TỪ CHỐI" chạy theo chiều câm nhất.
 *
 *   Giá trị đúng lấy từ chính nơi cưỡng chế (`navigation.tsx` cho route có mục
 *   nav, `App.tsx` `RouteGuard requirePermission` cho route không có):
 *     /machine/:id            → machine_status      (App.tsx:450)
 *     /device-monitor         → machine_status      (navigation.tsx:724)
 *     /history                → history_view        (navigation.tsx:468)
 *     /traceability           → analytics_oee       (navigation.tsx:405)
 *     /station-analysis/:id   → analytics_spc       (App.tsx:336)
 *     /wip-dashboard          → analytics_oee       (navigation.tsx:396)
 *     /oee-dashboard          → machine_status      (navigation.tsx:741)
 *     /production-dashboard   → dashboard_view      (navigation.tsx:335)
 *     /andon                  → dashboard_view      (navigation.tsx:294)
 *     /corporate-dashboard    → dashboard_corporate (navigation.tsx:261)
 *     /control-plane          → machine_control     (App.tsx:424)   ← Đợt 6 #21
 *     /command-console        → machine_control     (App.tsx:422)   ← Đợt 6 #29
 *     /robot/:id              → machine_status      (App.tsx:454)   ← Đợt 6 #24-29
 *
 * ⚠ `/machine-health` là REDIRECT sang `/device-monitor?tab=health`
 *   (`App.tsx:381`), nên nút trỏ thẳng tới đích để không phải nhảy hai lần.
 */
export function nutDieuHuongCho(loai: LoaiDich, id: number): NutDieuHuong[] {
  switch (loai) {
    case "machine":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.cockpit", href: `/machine/${id}`, quyen: "machine_status" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.sucKhoeMay", href: "/device-monitor?tab=health", quyen: "machine_status" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.lichSu", href: `/history?machineId=${id}`, quyen: "history_view" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.truyXuat", href: `/traceability?machineId=${id}`, quyen: "analytics_oee" },
        /*
         * ★ Sổ kiểm §11 #21 — `gatedActions → /control-plane`.
         *
         * §11 xếp mục này vào "`NganXuLy` nhóm Mở chức năng", tức là CHỈ NỐI
         * NÚT: bảng `gatedActions` vẫn sống ở `MachineCockpit` (#21 không nói
         * "viết lại"), Twin chỉ cần mở được đường tới nơi thao tác.
         *
         * ⚠ `machine_control` lấy từ CHÍNH nơi cưỡng chế (`App.tsx:424`), không
         *   đoán: khai rộng hơn ⇒ nút hiện rồi bị chặn (lỗi Khối D); khai hẹp
         *   hơn ⇒ nút biến mất với đúng người cần nó, và không lỗi nào nổ.
         */
        { khoaNhan: "twin3d.vanHanh.dieuHuong.dieuKhien", href: `/control-plane?machineId=${id}`, quyen: "machine_control" },
      ];
    /*
     * ★ Sổ kiểm §11 #24-#29 — RobotCockpit.
     *
     * Năm trong sáu mục (#24 teach/jog · #25 joints · #27 sparkline · #28 tab
     * safety/anomalies · #29 gatedActions) có cột "Đích di trú" là **GIỮ Ở
     * COCKPIT**. Nên phần Twin phải làm là MỘT ĐƯỜNG MỞ tới cockpit đó — không
     * phải dựng lại sáu tính năng ở Twin. #26 (E-STOP) là ngoại lệ duy nhất:
     * spec ghi "Nổi lên Twin", và nó được xử lý ở tầng badge, không ở đây.
     */
    case "robot":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.robotCockpit", href: `/robot/${id}`, quyen: "machine_status" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.banDieuKhien", href: `/command-console?robotId=${id}`, quyen: "machine_control" },
      ];
    case "station":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.phanTichTram", href: `/station-analysis/${id}`, quyen: "analytics_spc" },
      ];
    case "line":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.wip", href: `/wip-dashboard?lineId=${id}`, quyen: "analytics_oee" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.oee", href: `/oee-dashboard?lineId=${id}`, quyen: "machine_status" },
      ];
    case "workshop":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.sanXuat", href: `/production-dashboard?workshopId=${id}`, quyen: "dashboard_view" },
        { khoaNhan: "twin3d.vanHanh.dieuHuong.andon", href: "/andon", quyen: "dashboard_view" },
      ];
    case "factory":
      return [
        { khoaNhan: "twin3d.vanHanh.dieuHuong.tapDoan", href: `/corporate-dashboard?factoryId=${id}`, quyen: "dashboard_corporate" },
      ];
  }
}

/** Nút "sửa mặt bằng" — hiện khi vật thể đang chọn CHƯA có chỗ trên bố cục (§9.5.3). */
export function nutSuaBoTri(): NutDieuHuong {
  return {
    khoaNhan: "twin3d.vanHanh.dieuHuong.xuongDung",
    href: "/twin-studio",
    // Khớp `quyenThietKe()` của twinCanhRouter — hai quyền, ta lấy cái phổ biến hơn
    // ở vai kỹ thuật; component vẫn kiểm cả hai trước khi hiện.
    quyen: "machine_control",
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ T-4 (Đợt 5) — DANH SÁCH GÁN KỸ THUẬT VIÊN                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Ô tối thiểu mà dropdown "Gán kỹ thuật viên" cần từ `user.list`. */
export interface NguoiCoTheGan {
  id: number;
  name?: string | null;
  username?: string | null;
  isActive?: boolean | null;
}

/**
 * Lọc danh sách người có thể GÁN việc.
 *
 * ★ §9.2 — tài khoản đã VÔ HIỆU HOÁ không được nằm trong danh sách gán. Gán một
 *   phiếu bảo trì cho người đã nghỉ việc là một phiếu KHÔNG AI NHẬN, và nó im
 *   lặng: phiếu vẫn "đã gán", vẫn có tên người, vẫn trôi qua mọi báo cáo — chỉ
 *   không có ai đang thực sự chờ nó. Đây cùng họ với lớp lỗi NT-3: một ô dữ liệu
 *   trông đầy đủ trong khi thế giới thật đằng sau nó đã rỗng.
 *
 * ⚠ `isActive` VẮNG MẶT (`undefined`) được coi là CÒN hoạt động — `undefined`
 *   nghĩa là "trường không được trả về", không phải "đã vô hiệu hoá". Chỉ
 *   `false` mới loại. Suy ngược lại sẽ làm dropdown rỗng sạch khi hợp đồng
 *   server đổi hình, và rỗng-vì-đọc-nhầm trông y hệt rỗng-vì-không-có-ai.
 */
export function nguoiGanDuoc(ds: readonly NguoiCoTheGan[] | null | undefined): NguoiCoTheGan[] {
  return (ds ?? []).filter((u) => u.isActive !== false);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ §11 #60 (Đợt 8 lô D) — STATS AOI OK/NG/NTF/YIELD                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hàng thô từ `dashboard.getMachineStats`.
 *
 * ⚠ Mọi trường `optional`: hợp đồng server trả thêm ba ô nhãn phạm vi và có thể
 *   đổi hình, và một `undefined` lọt qua `Number()` thành `NaN` — thứ hiển thị
 *   ra màn hình như một con số thật. Chuẩn hoá ở một chỗ, không ở JSX.
 */
export interface HangStatsAoi {
  total?: number | null;
  ok?: number | null;
  ng?: number | null;
  ntf?: number | null;
  yieldRate?: number | null;
  fpy?: number | null;
}

/**
 * Bốn ô của #60 sau khi chuẩn hoá. `null` = **CHƯA ĐO ĐƯỢC**, KHÔNG phải 0.
 */
export interface StatsAoi {
  total: number | null;
  ok: number | null;
  ng: number | null;
  ntf: number | null;
  /** % — `null` khi mẫu rỗng (chia cho 0), không phải 0 %. */
  yieldRate: number | null;
  fpy: number | null;
  /** true khi mẫu thật sự rỗng: máy CÓ được đo, chỉ là 0 chiếc trong cửa sổ. */
  mauRong: boolean;
}

/**
 * ★★★ NT-3 TẠI Ô SỐ: "CHƯA ĐO ĐƯỢC" ≠ "ĐO ĐƯỢC 0" ≠ "0 %".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là chỗ lớp lỗi CHẶN-2 quay lại dưới dạng khác. `getMachineStats` trả
 * `{total:0, ok:0, ng:0, ntf:0, yieldRate:0}` khi **không có DB** — cùng hình
 * dạng y hệt một máy chạy thật mà chưa kiểm chiếc nào trong cửa sổ. Nếu ta vẽ
 * thẳng hàng đó ra, người vận hành đọc "Yield 0 %" và tưởng máy đang hỏng nặng.
 *
 * Ba trạng thái phải phân biệt được, và chúng có ba biểu hiện khác nhau:
 *   1. **chưa đo được** (`dangTai`/`loi`/`hang == null`) ⇒ mọi ô `null` ⇒ UI vẽ `—`
 *   2. **đo được, mẫu rỗng** (`total === 0`) ⇒ `mauRong=true`, tỉ lệ `null` ⇒ `—`
 *      (đếm vẫn là 0 THẬT: "0 chiếc" là một sự thật, "0 %" thì không)
 *   3. **đo được, có mẫu** ⇒ số thật
 *
 * ⚠ `yieldRate` KHÔNG được tính lại ở client. Server dùng `finalYield({ok, ntf,
 *   total})` — NTF tính là PASS (quyết định #4 của repo). Tự tính `ok/total` ở
 *   đây tạo **nguồn sự thật thứ hai** cho cùng một chỉ số, và hai bản sẽ lệch
 *   ngay lần đầu ai đó đổi cách xử NTF (G12). Ta chỉ CHUẨN HOÁ, không TÍNH.
 */
export function docStatsAoi(
  hang: HangStatsAoi | null | undefined,
  daDo: boolean,
): StatsAoi {
  const RONG: StatsAoi = {
    total: null, ok: null, ng: null, ntf: null,
    yieldRate: null, fpy: null, mauRong: false,
  };
  if (!daDo || hang === null || hang === undefined) return RONG;

  const so = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const total = so(hang.total);
  // Hợp đồng hỏng hình (thiếu `total`) ⇒ coi như CHƯA ĐO, không coi như 0.
  if (total === null) return RONG;

  const mauRong = total === 0;
  return {
    total,
    ok: so(hang.ok) ?? 0,
    ng: so(hang.ng) ?? 0,
    ntf: so(hang.ntf) ?? 0,
    // ★ Mẫu rỗng ⇒ tỉ lệ `null`. `0/0` không phải 0 %.
    yieldRate: mauRong ? null : so(hang.yieldRate),
    fpy: mauRong ? null : so(hang.fpy),
    mauRong,
  };
}

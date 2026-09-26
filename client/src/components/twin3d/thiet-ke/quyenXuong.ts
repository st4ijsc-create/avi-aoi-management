/**
 * quyenXuong.ts — QUYỀN CỦA MÀN THIẾT KẾ, TÁCH THEO ĐÚNG CỔNG SERVER (vá PH-15).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — MỘT CỜ GÁC BỐN CỔNG KHÁC NHAU
 * ════════════════════════════════════════════════════════════════════════════
 * `XuongThietKe.tsx` trước bản này có ĐÚNG MỘT cờ:
 *     const coQuyenSua = quyenSettings.canEdit || quyenMayMoc.canEdit;
 * và gác bằng nó cả gizmo, cả nút "Sinh tự động", cả ba khối tải ảnh nền / tải
 * model / lưu bản ghi. `grep canCreate` trên cả `thiet-ke/*.tsx` + `TwinStudio.tsx`
 * = **0 dòng**.
 *
 * Nhưng `server/routers/twinCanhRouter.ts` gác bằng BỐN mức khác nhau, và mức
 * chặt nhất không phải `canEdit`:
 *
 *   | thủ tục                              | cổng server                     |
 *   |--------------------------------------|---------------------------------|
 *   | `luuHangLoat` `luuVungAnToan`         | `quyenThietKe("canEdit")`       |
 *   | `xuatBanBanGhi` `luuToaNha` `luuTang` | `quyenThietKe("canEdit")`       |
 *   | `taiAnhNen` `taiModelMay` `luuBanGhi` | `quyenThietKe("**canCreate**")` |
 *   | `dungNhaXuong`                        | `quyenThietKe("**canCreate**")` |
 *   | `goKhoiMatBang` `xoaVungAnToan` `xoaBanGhi` | `quyenThietKe("canDelete")` |
 *   | `danhSachBanGhi` `chiTietBanGhi`      | `quyenThietKe("canView")`       |
 *   | `sinhTuDong`                          | **`adminProcedure`**            |
 *
 * Đo được (`qatd_quanly`, `machine_control` V+E, **canCreate = false**): nút
 * `nut-mo-sinh` "Generate" render + enabled, và tab "Add building" đi hết ba
 * bước tới `nut-tao` "Create building" render + enabled ⇒ **người dùng bấm xong
 * mới nhận 403**. Đúng lớp lỗi *"một lối vào rồi TỪ CHỐI"* (họ G149).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ẨN, KHÔNG DISABLE — và đây không phải chuyện thẩm mỹ
 * ════════════════════════════════════════════════════════════════════════════
 * §6.4 + `van-hanh/nganXuLyLogic.ts:102-111` (nơi luật này đang được làm ĐÚNG):
 * một nút xám vẫn nói *"chức năng này thuộc về bạn, chỉ đang không dùng được lúc
 * này"*, nên người dùng đi tìm cách bật nó. Với người **KHÔNG BAO GIỜ** có
 * quyền, câu đó là SAI.
 *
 * Ngược lại, một nút tắt vì TRẠNG THÁI TẠM ("chưa có thay đổi nào để lưu", "chưa
 * chọn máy") thì `disabled` + giải thích mới đúng — người dùng đổi được trạng
 * thái đó. Hai thứ này không được trộn: `nut-luu` HIỆN theo quyền `sua` và TẮT
 * theo `thayDoi.length === 0`.
 *
 * ⚠ Đây là cưỡng chế TRÌNH BÀY, KHÔNG thay thế cổng server (phòng thủ nhiều
 *   lớp). Router vẫn kiểm từng mutation.
 *
 * ⚠ `useCanWrite` cho admin TẤT CẢ true (`usePermissions` bypass). Nên phép đo
 *   nghiệm thu PHẢI chạy bằng tài khoản KHÔNG phải admin — đo bằng admin chứng
 *   minh số 0 về cổng quyền (§6.4).
 *
 * ★ Module THUẦN — không react, không trpc. Component đọc hook rồi đưa số liệu
 *   thô vào đây, đúng khuôn `nganXuLyLogic.ts`.
 */

/** Bốn cờ ghi của một module quyền, như `useCanWrite(module)` trả về. */
export interface CoQuyenModule {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

/** Đầu vào thô: hai module của `quyenThietKe()` + vai admin của `usePermissions()`. */
export interface QuyenThoXuong {
  settingsFactory: CoQuyenModule;
  machineControl: CoQuyenModule;
  /**
   * `usePermissions().isAdmin`. Đọc RIÊNG, không suy từ bốn cờ trên: `sinhTuDong`
   * là `adminProcedure`, một cổng theo VAI chứ không theo module — một tài khoản
   * đủ C+E+D ở cả hai module vẫn phải bị chặn ở đó.
   */
  laAdmin: boolean;
}

/** Năm cổng mà màn Thiết kế thật sự có. */
export interface QuyenXuong {
  /** `quyenThietKe("canView")` — đọc danh sách model, danh sách bản ghi. */
  xem: boolean;
  /** `quyenThietKe("canCreate")` — dựng nhà xưởng, tải ảnh nền/model, lưu bản ghi. */
  tao: boolean;
  /** `quyenThietKe("canEdit")` — kéo-thả, gizmo, lưu bố cục, vẽ vùng an toàn. */
  sua: boolean;
  /** `quyenThietKe("canDelete")` — gỡ khỏi mặt bằng, xoá vùng, xoá bản ghi. */
  xoa: boolean;
  /** `adminProcedure` — SINH TỰ ĐỘNG (ghi đè TOÀN BỘ bố cục trong một lượt). */
  sinh: boolean;
}

export const QUYEN_XUONG_RONG: QuyenXuong = {
  xem: false,
  tao: false,
  sua: false,
  xoa: false,
  sinh: false,
};

/**
 * Hợp quyền hai module — **HOẶC, THEO TỪNG HÀNH ĐỘNG**.
 *
 * ★ `requireAnyPermission([{settings_factory, X}, {machine_control, X}])` của
 *   router hỏi CÙNG hành động `X` ở hai module rồi HOẶC lại. Viết thành `&&` sẽ
 *   chặn đúng những người mà §6.4 muốn cho vào (đo trên seed thật: 3/4 vai
 *   non-admin chỉ có MỘT trong hai module).
 *
 * ★ HOẶC theo TỪNG hành động, không gộp thành một cờ: một vai có `canCreate` ở
 *   module này và `canEdit` ở module kia thì server cho qua CẢ HAI đường — và đó
 *   là ca mà một cờ duy nhất không biểu diễn được.
 */
export function tinhQuyenXuong(t: QuyenThoXuong): QuyenXuong {
  const hoac = (k: keyof CoQuyenModule): boolean => t.settingsFactory[k] || t.machineControl[k];
  return {
    xem: hoac("canView"),
    tao: hoac("canCreate"),
    sua: hoac("canEdit"),
    xoa: hoac("canDelete"),
    // KHÔNG `hoac(...)`: cổng của `sinhTuDong` là VAI, không phải module.
    sinh: t.laAdmin,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* BẢNG NÚT × THỦ TỤC × CỔNG SERVER                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Cổng server của một thủ tục `twinCanh.*`. */
export type CongServer = "canView" | "canCreate" | "canEdit" | "canDelete" | "admin";

/** Mã của một công cụ GHI trên màn Thiết kế. */
export type MaCongCu =
  /* ── canEdit ──────────────────────────────────────────────────────────── */
  | "cheDoGizmo"
  | "batDinh"
  | "hoanTacLamLai"
  | "thanhCanChinh"
  | "luuBoCuc"
  | "suaThuocTinh"
  | "veVungAnToan"
  | "khoiPhucBanGhi"
  | "xuatBanBanGhi"
  /* ── canDelete ────────────────────────────────────────────────────────── */
  | "goKhoiMatBang"
  | "xoaVungAnToan"
  | "xoaBanGhi"
  /* ── canCreate ────────────────────────────────────────────────────────── */
  | "anhNenTang"
  | "taiModelMay"
  | "luuBanGhi"
  | "dungNhaXuong"
  /* ── canView ──────────────────────────────────────────────────────────── */
  | "danhSachBanGhi"
  /* ── adminProcedure ───────────────────────────────────────────────────── */
  | "sinhTuDong";

export interface CongCuXuong {
  ma: MaCongCu;
  /** `data-testid` chính của công cụ trên DOM — để đối chiếu bằng mắt/Playwright. */
  testid: string;
  /** Thủ tục tRPC mà công cụ này thật sự GỌI (tên đúng như trong router). */
  thuTuc: string;
  /** Cổng của thủ tục ấy trong `server/routers/twinCanhRouter.ts`. */
  cong: CongServer;
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢNG NÀY LÀ NGUỒN SỰ THẬT DUY NHẤT CỦA "NÚT NÀO CẦN QUYỀN GÌ"
 * ════════════════════════════════════════════════════════════════════════════
 * Cột `cong` KHÔNG được chép từ trí nhớ: `quyenXuong.unit.test.ts` khối ④ mở
 * `server/routers/twinCanhRouter.ts` **trên đĩa** và đối chiếu từng dòng. Một
 * bảng chép tay là chỗ để UI và server lệch nhau lần nữa — và lệch âm thầm, vì
 * mọi test "UI ẩn nút" vẫn xanh khi bảng sai.
 *
 * ⚠ `khoiPhucBanGhi` là ca DUY NHẤT mà thủ tục đọc (`chiTietBanGhi`, canView)
 *   khác thủ tục GHI. Nó nạp một ảnh chụp vào bộ đệm đang sửa; thứ đưa ảnh chụp
 *   ấy xuống DB là `luuHangLoat`. Nên cổng đúng của NÚT là cổng của đường ghi
 *   (`canEdit`), không phải của lượt đọc — gác bằng canView sẽ cho người chỉ-xem
 *   dựng lên một bố cục họ không bao giờ lưu được.
 */
export const BANG_CONG_CU_XUONG: readonly CongCuXuong[] = [
  /* ── SỬA bố cục: `luuHangLoat` là đường ghi chung của mọi thao tác kéo-thả ── */
  { ma: "cheDoGizmo", testid: "nut-che-do-translate", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "batDinh", testid: "cong-tac-bat-dinh", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "hoanTacLamLai", testid: "nut-hoan-tac", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "thanhCanChinh", testid: "thanh-can-chinh", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "luuBoCuc", testid: "nut-luu", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "suaThuocTinh", testid: "bang-thuoc-tinh", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "khoiPhucBanGhi", testid: "nut-khoi-phuc", thuTuc: "twinCanh.luuHangLoat", cong: "canEdit" },
  { ma: "veVungAnToan", testid: "khoi-vung-an-toan", thuTuc: "twinCanh.luuVungAnToan", cong: "canEdit" },
  { ma: "xuatBanBanGhi", testid: "nut-xuat-ban", thuTuc: "twinCanh.xuatBanBanGhi", cong: "canEdit" },

  /* ── XOÁ ─────────────────────────────────────────────────────────────────── */
  { ma: "goKhoiMatBang", testid: "nut-go-khoi-mat-bang", thuTuc: "twinCanh.goKhoiMatBang", cong: "canDelete" },
  { ma: "xoaVungAnToan", testid: "ve-vung-xoa", thuTuc: "twinCanh.xoaVungAnToan", cong: "canDelete" },
  { ma: "xoaBanGhi", testid: "nut-xoa-ban-ghi", thuTuc: "twinCanh.xoaBanGhi", cong: "canDelete" },

  /* ── TẠO — bốn đường mà bản cũ mở nhầm cho người chỉ có canEdit ──────────── */
  { ma: "anhNenTang", testid: "khoi-anh-nen", thuTuc: "twinCanh.taiAnhNen", cong: "canCreate" },
  { ma: "taiModelMay", testid: "nut-tai-model", thuTuc: "twinCanh.taiModelMay", cong: "canCreate" },
  { ma: "luuBanGhi", testid: "nut-luu-ban-ghi", thuTuc: "twinCanh.luuBanGhi", cong: "canCreate" },
  { ma: "dungNhaXuong", testid: "tab-con-duong-b", thuTuc: "twinCanh.dungNhaXuong", cong: "canCreate" },

  /* ── ĐỌC ─────────────────────────────────────────────────────────────────── */
  { ma: "danhSachBanGhi", testid: "khoi-ban-ghi", thuTuc: "twinCanh.danhSachBanGhi", cong: "canView" },

  /* ── ADMIN — thao tác PHÁ HUỶ NHẤT của màn (ghi đè toàn bộ bố cục) ───────── */
  { ma: "sinhTuDong", testid: "nut-mo-sinh", thuTuc: "twinCanh.sinhTuDong", cong: "admin" },
];

/** Cờ tương ứng với một cổng server. Một chỗ ánh xạ, không rải khắp JSX. */
export function coQuyenCho(q: QuyenXuong, cong: CongServer): boolean {
  switch (cong) {
    case "canView":
      return q.xem;
    case "canCreate":
      return q.tao;
    case "canEdit":
      return q.sua;
    case "canDelete":
      return q.xoa;
    case "admin":
      return q.sinh;
  }
}

/**
 * Tập công cụ ĐƯỢC RENDER với một bộ quyền.
 *
 * ★ "Được render" chứ không phải "bấm được": mã nào KHÔNG có trong danh sách trả
 *   về thì component **không dựng phần tử** — kiểm nghiệm thu là
 *   `expect(queryByTestId(...)).toBeNull()`, một phép đo phân biệt được ẩn với
 *   disable (nút `disabled` vẫn nằm trong DOM).
 */
export function congCuHienThi(q: QuyenXuong): MaCongCu[] {
  return BANG_CONG_CU_XUONG.filter((c) => coQuyenCho(q, c.cong)).map((c) => c.ma);
}

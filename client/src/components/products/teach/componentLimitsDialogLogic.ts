/**
 * componentLimitsDialogLogic.ts — Khối C Task 11: logic THUẦN cho `ComponentLimitsDialog.tsx`.
 * Tách khỏi component để test được KHÔNG CẦN DOM (đúng khuôn `teachTreeLogic.ts`/Task 10 —
 * `vitest.config.ts` chạy `*.unit.test.ts` ở `environment: "node"`, không jsdom, 0
 * `@testing-library/react` trong repo này — xem docblock `teachTreeLogic.ts` mục "Vì sao KHÔNG
 * 'render + mock trpc'" trong `task-10-report.md`, lý do đó áp NGUYÊN VĂN ở đây).
 *
 * Ba việc THUẦN tách ra khỏi component:
 *   1. Form 5 trường (quyết định #2 chủ dự án, xem `teachTreeLogic.ts`) → `items` của
 *      `measurementPoint.setLimitsBatch` — CHỈ trường có nội dung mới xuất hiện trong item
 *      (`layTruongDaNhap`): trường rỗng nghĩa là "không đổi", KHÔNG được gửi `""` (đó sẽ vỡ cột
 *      numeric ở Postgres, hoặc với batch sẽ ghi đè giá trị khác nhau của N linh kiện về rỗng).
 *   2. Kiểm số hợp lệ TRƯỚC khi gửi — đo trực tiếp `drizzle/schema/product.ts:120-121,159-160`:
 *      `lowerLimit`/`upperLimit`/`heightMin`/`heightMax` là `decimal(precision:15, scale:6)`.
 *      ⚠⚠ BÁC BỎ BRIEF: prompt Task 11 khai "heightMin/Max numeric(10,4)" — ĐO TRỰC TIẾP schema
 *      bác bỏ, cột thật là precision 15 / scale 6 cho CẢ BỐN trường số (không riêng heightMin/Max).
 *      Theo phép đo, không theo prompt — khai trong `task-11-report.md`.
 *   3. Phân biệt kết quả THẬT của `setLimitsBatch` — ĐÂY LÀ BÁC BỎ THỨ HAI, quan trọng hơn:
 *
 *      ⚠⚠⚠ BÁC BỎ BRIEF — "sản phẩm sống ⇒ đã gửi duyệt N điểm":
 *      Đọc `server/routers/productRouters.ts:1611` (`setLimitsBatch`) +
 *      `server/services/thresholdGovernanceService.ts:198-221` (`assertThresholdEditAllowed`):
 *      khi sản phẩm đang sống (live/eol/archived, hoặc development NHƯNG đã có chương trình kiểm
 *      phát hành) VÀ cổng đang enforce, hàm chỉ THROW FORBIDDEN — nó KHÔNG ghi bất kỳ hàng nào
 *      vào `threshold_approvals`. `updateMeasurementPointLimitsBatch` (nơi DUY NHẤT ghi
 *      `measurement_point_versions` + bump version) không hề được gọi trên nhánh này (throw xảy
 *      ra TRƯỚC nó). Hàng đợi duyệt thật (`thresholdApproval.request`,
 *      `server/routers/thresholdApprovalRouter.ts:137-181`) là một MUTATION KHÁC — hợp đồng KHÁC
 *      (đúng MỘT `pointDefId`, `proposedLsl`/`proposedUsl` BẮT BUỘC CẢ HAI, KHÔNG có
 *      `unit`/`heightMin`/`heightMax`) — tự động gọi nó ở đây khi bắt được FORBIDDEN sẽ HOẶC bỏ
 *      rơi âm thầm các trường ngoài LSL/USL người dùng vừa nhập, HOẶC đòi hỏi cả hai trường mà
 *      form 5-trường này để tuỳ chọn từng cái. Task 11 KHÔNG tự chế một cầu nối chưa ai giao (đổi
 *      hợp đồng `thresholdApproval.request` hoặc thêm mutation gộp là quyết định kiến trúc ngoài
 *      phạm vi task này) — dialog chỉ báo TRUNG THỰC "CHƯA lưu, cần duyệt" (`thongBaoCanDuyet`),
 *      KHÔNG bịa "đã gửi duyệt" vì thực tế KHÔNG có gì được gửi đi đâu cả.
 */
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";

type RouterInputs = inferRouterInputs<AppRouter>;
export type SetLimitsBatchInput = RouterInputs["measurementPoint"]["setLimitsBatch"];
export type SetLimitsBatchItem = SetLimitsBatchInput["items"][number];

/** 5 trường DUY NHẤT dialog cho sửa — quyết định #2 chủ dự án (xem `teachTreeLogic.ts`). */
export const TEN_TRUONG_FORM = ["lowerLimit", "upperLimit", "unit", "heightMin", "heightMax"] as const;
export type TenTruongForm = (typeof TEN_TRUONG_FORM)[number];
export type FormGioiHan = Record<TenTruongForm, string>;
export const FORM_RONG: FormGioiHan = {
  lowerLimit: "",
  upperLimit: "",
  unit: "",
  heightMin: "",
  heightMax: "",
};

const TRUONG_SO: readonly TenTruongForm[] = ["lowerLimit", "upperLimit", "heightMin", "heightMax"];

// decimal(precision:15, scale:6) THẬT — drizzle/schema/product.ts:120-121 (lowerLimit/upperLimit),
// :159-160 (heightMin/heightMax). Precision 15 - scale 6 = tối đa 9 chữ số phần nguyên.
const RE_SO_HOP_LE = /^-?\d{1,9}(\.\d{1,6})?$/;

/** Chuỗi rỗng (chưa nhập) là HỢP LỆ — nó có nghĩa "không đổi trường này", không phải một số 0. */
export function laChuoiSoHopLe(gia: string): boolean {
  const s = gia.trim();
  if (s === "") return true;
  return RE_SO_HOP_LE.test(s);
}

/** Parse một chuỗi ĐÃ hợp lệ theo `laChuoiSoHopLe` — rỗng hoặc sai định dạng ⇒ `null` (không bịa số). */
function soHopLeHoacNull(gia: string): number | null {
  const s = gia.trim();
  if (s === "" || !RE_SO_HOP_LE.test(s)) return null;
  return Number(s);
}

/** `measurement_point_defs.unit` varchar(20) — chặn ở client, đừng để Postgres 22001 là lần đầu người dùng biết. */
export function laDonViHopLe(gia: string): boolean {
  return gia.trim().length <= 20;
}

export interface LoiTruongForm {
  readonly truong: TenTruongForm;
  readonly khoa: string;
  readonly macDinh: string;
}

/**
 * Kiểm toàn bộ form — trả DANH SÁCH lỗi (rỗng = form hợp lệ, sẵn sàng gửi).
 *
 * Vòng sửa 1 (review, Minor #1) — thêm so sánh CHÉO `lowerLimit ≤ upperLimit` và
 * `heightMin ≤ heightMax` khi CẢ HAI đã là số hợp lệ (bỏ qua khi một trong hai rỗng/sai định
 * dạng — lỗi định dạng ở trên đã đủ, không chồng thêm lỗi khó hiểu). Đây là kiểm CLIENT-SIDE
 * — server (`measurementPoint.update`/`setLimitsBatch`) KHÔNG tự kiểm điều này, ghi nợ **BG-113**
 * (chung cho cả hai mutation, ngoài phạm vi Task 11 — không sửa server ở vòng này).
 */
export function kiemTraForm(gia: FormGioiHan): LoiTruongForm[] {
  const loi: LoiTruongForm[] = [];
  for (const truong of TRUONG_SO) {
    if (!laChuoiSoHopLe(gia[truong])) {
      loi.push({ truong, khoa: "teachLimits.errSoKhongHopLe", macDinh: "Không phải một số hợp lệ" });
    }
  }
  if (!laDonViHopLe(gia.unit)) {
    loi.push({ truong: "unit", khoa: "teachLimits.errDonViQuaDai", macDinh: "Đơn vị tối đa 20 ký tự" });
  }

  const lower = soHopLeHoacNull(gia.lowerLimit);
  const upper = soHopLeHoacNull(gia.upperLimit);
  if (lower != null && upper != null && lower > upper) {
    loi.push({
      truong: "upperLimit",
      khoa: "teachLimits.errCanDuoiLonHonCanTren",
      macDinh: "Cận dưới phải nhỏ hơn hoặc bằng cận trên",
    });
  }

  const hMin = soHopLeHoacNull(gia.heightMin);
  const hMax = soHopLeHoacNull(gia.heightMax);
  if (hMin != null && hMax != null && hMin > hMax) {
    loi.push({
      truong: "heightMax",
      khoa: "teachLimits.errCaoMinLonHonMax",
      macDinh: "Cao tối thiểu phải nhỏ hơn hoặc bằng cao tối đa",
    });
  }

  return loi;
}

/**
 * Chỉ trường CÓ NỘI DUNG (trim non-empty) mới xuất hiện trong kết quả — trống (kể cả toàn
 * khoảng trắng) KHÔNG được gửi, kể cả là `""`: đây là ranh giới giữa "không đổi" và "xoá về rỗng"
 * mà `setLimitsBatch` (mọi trường `.optional()`, không `.nullable()`) không phân biệt được nếu ta
 * gửi `""` — cùng khuôn `ProductVariantsTab.tsx` override dialog (`if (ovLower.trim()) patch.lowerLimit = ...`).
 */
export function layTruongDaNhap(gia: FormGioiHan): Partial<Record<TenTruongForm, string>> {
  const ra: Partial<Record<TenTruongForm, string>> = {};
  for (const truong of TEN_TRUONG_FORM) {
    const v = gia[truong].trim();
    if (v !== "") ra[truong] = v;
  }
  return ra;
}

export function soTruongDaNhap(gia: FormGioiHan): number {
  return Object.keys(layTruongDaNhap(gia)).length;
}

/**
 * ★★★ Vòng sửa 1 (review — Important, race dữ liệu thật) ★★★
 *
 * TRƯỚC vòng sửa: chế độ đơn đổi từ điểm A sang điểm B trong khi `measurementPoint.getById(B)`
 * còn đang tải — `gia` KHÔNG được reset (chỉ nhánh hàng loạt gọi `setGia(FORM_RONG)`), và nút Lưu
 * chỉ khoá theo `dangLuu`/`rows.length===0`/`loiForm`/`soTruongDaNhap` — KHÔNG khoá theo việc
 * `getById` đang tải. Nếu người dùng bấm Lưu ngay trong cửa sổ đó, `gia` vẫn mang giá trị CỦA A
 * (hợp lệ, `soTruongDaNhap>0`) trong khi `rows[0].id` đã là B ⇒ `xayInputSetLimitsBatch` ghi giá
 * trị của A LÊN B. Mã cũ tương đương biểu thức (chép nguyên văn để đối chiếu — xem test
 * "[HỒI QUY]" trong `componentLimitsDialog.unit.test.ts`):
 *
 *     const duocLuuMaCu = rows.length > 0 && loiForm.length === 0 && soTruongDaNhap > 0;
 *
 * — biểu thức này KHÔNG có khái niệm "đang tải chi tiết điểm khác", nên LUÔN true trong cửa sổ
 * race, dù `gia` đang mang dữ liệu của điểm SAI.
 *
 * SAU vòng sửa — hai lớp phòng thủ, cả hai đều bắt buộc (không phải chọn một):
 *   (a) `ComponentLimitsDialog.tsx`: effect reset `gia = FORM_RONG` được gọi LUÔN LUÔN khi tập
 *       `rows` đổi (kể cả đơn — bỏ điều kiện `if (!donMode)` cũ), NGAY LẬP TỨC, không đợi
 *       `getById` trả về — nên trong cửa sổ tải, `gia` rỗng ⇒ `soTruongDaNhap===0` đã tự chặn.
 *   (b) HÀM NÀY: chặn CỨNG bất kể `gia` đang chứa gì, chỉ dựa vào tín hiệu tải
 *       (`dangTaiChiTietDon` — đơn mode: `chiTietQuery.isFetching`; hàng loạt: luôn `false`, không
 *       phụ thuộc `getById`) — phòng khi (a) có lỗ hổng thứ tự effect trong tương lai. Nút Lưu VÀ
 *       `handleLuu` đều gọi đúng hàm này — một nguồn quyết định, không lặp lại điều kiện hai nơi.
 */
export function coTheLuu(opts: {
  readonly soHang: number;
  readonly loiForm: readonly LoiTruongForm[];
  readonly soTruongDaNhap: number;
  readonly dangTaiChiTietDon: boolean;
}): boolean {
  if (opts.soHang === 0) return false;
  if (opts.dangTaiChiTietDon) return false;
  if (opts.loiForm.length > 0) return false;
  if (opts.soTruongDaNhap === 0) return false;
  return true;
}

/**
 * `ids` (1 phần tử = đơn, N phần tử = hàng loạt) + MỘT bộ giá trị form áp cho tất cả →
 * input thật của `measurementPoint.setLimitsBatch`. `changeReason` rỗng ⇒ bỏ hẳn khỏi input
 * (khớp `.optional()`, tránh gửi chuỗi rỗng vô nghĩa vào audit log).
 */
export function xayInputSetLimitsBatch(
  ids: readonly number[],
  gia: FormGioiHan,
  changeReason: string,
): SetLimitsBatchInput {
  const truong = layTruongDaNhap(gia);
  const items: SetLimitsBatchItem[] = ids.map((id) => ({ id, ...truong }));
  const reason = changeReason.trim();
  return reason ? { items, changeReason: reason } : { items };
}

// ── Phân biệt kết quả THẬT: đã lưu vs bị chặn bởi cửa duyệt ngưỡng ─────────────────────────────

export interface KetQuaLuuThanhCong {
  readonly loai: "daLuu";
  readonly soDiem: number;
}

/** `setLimitsBatch` THÀNH CÔNG trả đúng `{updated, pointsConfigVersion}` — chiếu thẳng `updated`. */
export function ketQuaThanhCong(res: { updated: number }): KetQuaLuuThanhCong {
  return { loai: "daLuu", soDiem: res.updated };
}

export type LyDoCanDuyet = "productLifecycleRequiresApproval" | "releasedProgramRequiresApproval";

export interface KetQuaCanDuyet {
  readonly loai: "canDuyet";
  readonly lyDo: LyDoCanDuyet | null;
}

/**
 * Nhận diện ĐÚNG lỗi từ `assertThresholdEditAllowed` (cửa duyệt ngưỡng) trong đám lỗi FORBIDDEN —
 * KHÔNG PHẢI mọi FORBIDDEN (thiếu quyền `settings_measurement_points.canEdit` cũng ném FORBIDDEN
 * nhưng KHÔNG mang `appParams.operation==="editThresholdDirectly"`, đừng nhận nhầm).
 *
 * Đọc ĐÚNG shape client thật nhận được — `errorFormatter` (`server/_core/trpc.ts:37-65`) nâng
 * `appCode`/`appParams` (gắn bởi `appError()`, `server/_core/appError.ts`) lên
 * `error.data.appCode`/`error.data.appParams`; `error.data.code` là mã TRPC chuẩn ("FORBIDDEN") —
 * cùng shape mà `client/src/lib/trpcErrors.ts` (`getErrorCode`/`getAppError`) đã đọc, không phát
 * minh đường đọc khác.
 */
export function docLoiCanDuyetNguong(err: unknown): KetQuaCanDuyet | null {
  if (!err || typeof err !== "object") return null;
  const data = (err as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const { code, appCode, appParams } = data as { code?: unknown; appCode?: unknown; appParams?: unknown };
  if (code !== "FORBIDDEN" || appCode !== "OPERATION_FAILED") return null;
  if (!appParams || typeof appParams !== "object") return null;
  const { operation, reason } = appParams as { operation?: unknown; reason?: unknown };
  if (operation !== "editThresholdDirectly") return null;
  const lyDo: LyDoCanDuyet | null =
    reason === "productLifecycleRequiresApproval" || reason === "releasedProgramRequiresApproval"
      ? reason
      : null;
  return { loai: "canDuyet", lyDo };
}

export interface ThongBaoKetQua {
  readonly khoa: string;
  readonly macDinh: string;
  readonly params?: Record<string, unknown>;
}

/** "Đã lưu N điểm" — CHỈ dùng khi mutation thật sự thành công (có `updated`). */
export function thongBaoThanhCong(soDiem: number): ThongBaoKetQua {
  return { khoa: "teachLimits.daLuu", macDinh: "Đã lưu {{soDiem}} điểm", params: { soDiem } };
}

/**
 * "CHƯA lưu — cần duyệt" — KHÔNG BAO GIỜ nói "đã gửi duyệt" (xem cảnh báo bác bỏ đầu file: không
 * gì thật sự được gửi vào hàng đợi duyệt ở nhánh này).
 */
export function thongBaoCanDuyet(ketQua: KetQuaCanDuyet): ThongBaoKetQua {
  return ketQua.lyDo === "releasedProgramRequiresApproval"
    ? {
        khoa: "teachLimits.canDuyetChuongTrinh",
        macDinh:
          "Chưa lưu — sản phẩm đã có chương trình kiểm phát hành, thay đổi giới hạn phải qua hàng đợi duyệt ngưỡng",
      }
    : {
        khoa: "teachLimits.canDuyetLifecycle",
        macDinh: "Chưa lưu — sản phẩm đang hoạt động, thay đổi giới hạn phải qua hàng đợi duyệt ngưỡng",
      };
}

// ── Sau khi lưu THÀNH CÔNG: bảng/thống kê Task 10 phải cập nhật, KHÔNG tự sửa state cục bộ ─────

export interface KeHoachLamMoiSauLuu {
  readonly listComponents: { readonly captureRowId: number };
  readonly thongKeGioiHan: { readonly productModelId: number; readonly machineId: number };
}

/**
 * Hai truy vấn Task 9 phải `invalidate` sau một lượt `setLimitsBatch` thành công, để
 * `ComponentLimitsTable`/thanh thống kê (Task 10) đọc lại từ server thay vì tự đếm lại ở client
 * (đúng luật "không tự sửa state cục bộ — hai nguồn"). Tách thành hàm THUẦN vì repo này không có
 * hạ tầng test render+mock-trpc (xem docblock đầu file) — đây là điểm neo test được của bước
 * invalidate; component chỉ CHIẾU THẲNG kết quả hàm này vào hai lời gọi
 * `utils.cayDay.listComponents.invalidate(...)` / `utils.cayDay.thongKeGioiHan.invalidate(...)`.
 */
export function keHoachLamMoiSauLuu(ctx: {
  captureRowId: number;
  productModelId: number;
  machineId: number;
}): KeHoachLamMoiSauLuu {
  return {
    listComponents: { captureRowId: ctx.captureRowId },
    thongKeGioiHan: { productModelId: ctx.productModelId, machineId: ctx.machineId },
  };
}

// ── Canvas (R-KC-1): hình học THẬT của một component cây dạy là roi*, KHÔNG phải shape/geometry ──

export interface DiemCayDayChoCanvas {
  readonly code: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly radius: number;
  readonly shape: "rect";
  readonly geometry: { shape: "rect"; x: number; y: number; width: number; height: number };
}

/**
 * `server/db/cayDay.ts:70-75` tự cảnh báo: hàng cây dạy CỐ Ý không ghi `shape`/`geometry`/`radius`
 * (giữ mặc định DB `'circle'`/20) — đọc chúng cho một component cây dạy là đọc "DI SẢN VÔ NGHĨA".
 * Hình học THẬT là `roiX/roiY/roiWidth/roiHeight` (rect, pixel TUYỆT ĐỐI — `roiTemplate`,
 * `server/contracts/machineTemplateContract.ts:108-113`). Hàm này dựng ĐÚNG một
 * `CanvasMeasurementPoint` (rect) từ roi thật — trả `null` khi thiếu bất kỳ toạ độ nào (không bịa
 * hình học một phần).
 */
export function diemCayDayChoCanvas(p: {
  readonly componentExtId: string | null;
  readonly code?: string | null;
  readonly roiX: number | null;
  readonly roiY: number | null;
  readonly roiWidth: number | null;
  readonly roiHeight: number | null;
}): DiemCayDayChoCanvas | null {
  if (p.roiX == null || p.roiY == null || p.roiWidth == null || p.roiHeight == null) return null;
  return {
    code: p.componentExtId ?? p.code ?? "",
    positionX: Math.round(p.roiX + p.roiWidth / 2),
    positionY: Math.round(p.roiY + p.roiHeight / 2),
    radius: Math.max(2, Math.round(Math.max(p.roiWidth, p.roiHeight) / 2)),
    shape: "rect",
    geometry: { shape: "rect", x: p.roiX, y: p.roiY, width: p.roiWidth, height: p.roiHeight },
  };
}

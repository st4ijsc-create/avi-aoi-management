/**
 * `nguyCoHongHienThi.ts` — PH-39: BA TRẠNG THÁI của ô "Nguy cơ hỏng".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MODULE NÀY TỒN TẠI — LỖI ĐO ĐƯỢC, KHÔNG PHẢI PHÒNG XA
 * ════════════════════════════════════════════════════════════════════════════
 * QA tập đoàn 2026-09-15 (ảnh `.qa-tapdoan/anh/DE-D1-kythuat.png`): trên CÙNG
 * một khung hình, cách nhau khoảng 300 điểm ảnh, màn máy in
 *
 *     chip twin  →  "Health 40 % · critical"
 *     ô cockpit  →  "Failure risk 0 %"
 *
 * `0 %` ấy không phải kết quả của phép tính nào. `computeFailureRisk` chỉ nhận
 * hàng sức khoẻ KHÔNG phải `PREDICTIVE_WS4`, mà cơ sở dữ liệu có đúng MỘT điểm
 * mỗi máy ⇒ không đặc trưng nào đủ dữ liệu ⇒ hàm rơi vào nhánh mặc định
 * `failureRisk 0 / urgency LOW` cho **mọi** máy. Ghi chú của chính nó (`rulNote`)
 * ghi "cold start" — tức nó BIẾT là chưa đủ dữ liệu, nhưng màn in ra số 0.
 *
 * `0` ở đó là một LỜI KHAI SAI VỀ THẾ GIỚI: nó nói *"đã tính, máy này không có
 * nguy cơ hỏng"* trong khi sự thật là *"chưa tính được gì"*. Người trực ca đọc
 * `0 %` cạnh một chip `critical` rồi hoặc tin số này, hoặc mất lòng tin vào cả
 * hai. Đây đúng lớp lỗi của "Cảnh báo (0)" đã vá ở
 * `components/twin3d/van-hanh/trungThucDuLieu.ts` (NT-3.5) — chỉ khác nguồn im
 * lặng: lần đó là CỔNG QUYỀN, lần này là DỮ LIỆU CHƯA ĐỦ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUÔN TÁI DÙNG (không tự nghĩ khuôn mới)
 * ════════════════════════════════════════════════════════════════════════════
 * · `trungThucDuLieu.hienSo` (NT-3.5) — "ĐẾM RỖNG KHÁC ĐẾM BẰNG 0": chưa đo thì
 *   in `—`. Ô nguy cơ dùng đúng ký hiệu ấy cho hai trạng thái chưa-biết.
 * · `alarmKpiEmptyState.pickOccurrenceLogNotice` — hàm THUẦN trả một NHÃN phân
 *   biệt; `t()` thuộc về tầng component (RB-8.3). Và: "server cũ chưa trả trường
 *   này ⇒ KHÔNG BỊA lý do".
 * · `thiet-ke/BangThuocTinh.tsx` badge vàng `twin3d.chuaDo` — cách sản phẩm này
 *   vẫn nói "giá trị chưa được đo" cạnh một con số.
 *
 * ★ Module THUẦN: không react, không `t()`, không đồng hồ — test được ở
 *   `environment: "node"` và không phụ thuộc bộ dựng bố cục (jsdom không có).
 */

/** Xuất xứ của `failureRisk` do `predictiveMaintenanceService` gắn kèm. */
export type XuatXuNguyCo = "measured" | "insufficient_data" | "unavailable";

/**
 * Ba trạng thái — và chỉ ba. `chuaDuDuLieu` KHÔNG được gộp vào `chuaDocDuoc`
 * (hai câu dẫn tới hai hành động khác nhau: "chờ máy chạy thêm" vs "đi hỏi vì
 * sao không đọc được"), và không trạng thái nào được gộp vào `so`.
 */
export type NhanNguyCo =
  | { kind: "so"; phanTram: number }
  | { kind: "chuaDuDuLieu" }
  | { kind: "chuaDocDuoc" };

export interface NguonNguyCo {
  /** `Section.available` của mục `health` — false = nguồn tắt / lỗi / ngoài phạm vi. */
  available?: boolean;
  failureRisk?: number | null;
  /** Vắng mặt = server CŨ chưa trả trường này. */
  riskMethod?: XuatXuNguyCo | null;
}

/**
 * Quy một mục sức khoẻ của cockpit về đúng một nhãn hiển thị.
 *
 * Thứ tự xét có chủ ý: nhãn xuất xứ THẮNG con số. Một server trả
 * `{ failureRisk: 42, riskMethod: "insufficient_data" }` là tự mâu thuẫn; khi đó
 * tin cái NÓI VỀ ĐỘ TIN CẬY chứ không tin con số — in 42 ra màn nguy hiểm hơn là
 * không in gì.
 */
export function nhanNguyCoHong(nguon: NguonNguyCo | null | undefined): NhanNguyCo {
  if (nguon == null) return { kind: "chuaDocDuoc" };
  if (nguon.available === false) return { kind: "chuaDocDuoc" };
  if (nguon.riskMethod === "insufficient_data") return { kind: "chuaDuDuLieu" };
  if (nguon.riskMethod === "unavailable") return { kind: "chuaDocDuoc" };
  const v = nguon.failureRisk;
  // `0` là một phép đo hợp lệ ⇒ so `== null` chứ KHÔNG dùng `!v` / `?? 0`.
  if (v == null || !Number.isFinite(v)) return { kind: "chuaDocDuoc" };
  return { kind: "so", phanTram: v };
}

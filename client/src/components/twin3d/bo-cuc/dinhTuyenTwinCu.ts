/**
 * ════════════════════════════════════════════════════════════════════════════
 * `dinhTuyenTwinCu.ts` — 13 URL CŨ, **KHÔNG URL NÀO ĐƯỢC CHẾT** (§13b 14.2.3)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đợt 21 gộp `/digital-twin` (vỏ Tabs 7 tab) vào `/twin`.
 * ★★★ ĐỢT 26 (QĐ-18): `/twin-studio` **RỜI bảng này** — nó trở lại là tuyến
 *   THẬT, nên nó nay là **đích** của 4 dòng, không còn là khoá. Bảng còn 13.
 * Mười bốn đường vào cũ vì thế trỏ vào chỗ không còn. Chúng nằm trong link đã
 * gửi qua chat, trong bookmark, trong tài liệu — nên **mọi đường phải còn tới
 * được đích đúng**, và §13b đặt thêm một điều kiện: **mỗi đường ≤ 1 chặng**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ VÌ SAO "≤ 1 CHẶNG" LÀ MỘT LUẬT, KHÔNG PHẢI SỰ CẦU KỲ
 * ────────────────────────────────────────────────────────────────────────────
 * Trước đợt này `/factory-live-map` đi **hai chặng**:
 *     /factory-live-map → /digital-twin?tab=map → (Tabs) bản đồ
 * Mắt xích giữa là `/digital-twin`. Ngày ai đó dọn `/digital-twin` — và Đợt 21
 * chính là ngày ấy — mắt xích mục, và `/factory-live-map` chết **trong im
 * lặng**: không lỗi biên dịch, không lưới đỏ, chỉ một người dùng bấm bookmark
 * và ra trang 404. Nên chuỗi phải được **rút thẳng về đích** trong cùng đợt
 * tạo ra nó, không để lại cho đợt sau.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ★★★ HAI ĐIỀU §13b NÓI MÀ ĐỢT NÀY LÀM KHÁC — ghi rõ, không lặng lẽ đổi
 * ────────────────────────────────────────────────────────────────────────────
 * 1. §13b 14.2.3 ghi `?tab=floor`/`?tab=layout` → **`/twin-studio`**. Đợt 21
 *    (QD-16) đổi đích thành `/twin?che-do=botri` vì hai màn khi ấy là MỘT.
 *    ★★★ QĐ-18 (2026-09-09) tách lại hai trang ⇒ đích quay về **đúng như §13b
 *    đề nghị ban đầu**: `/twin-studio`. Khoá `?che-do=` **không còn tồn tại ở
 *    bất kỳ đâu** — nó chết cùng QĐ-16, và đó là chủ ý: để lại một khoá URL mà
 *    không ai đọc chính là G67 (tính năng chết ở tầng DANH SÁCH, im lặng).
 * 2. §13b ghi `?tab=cell` → `/twin?thu=moPhong`. ⚠ Đó là **lỗi trong spec**, và
 *    nó đảo ngược ý nghĩa: `thu=` là danh sách panel **ĐANG THU** (vắng mặt =
 *    đang mở — xem `duongDanTwin.ts` `PANEL_THU_DUOC`). `?thu=moPhong` sẽ
 *    **ĐÓNG** ngăn Mô phỏng, tức là đưa người dùng tới đúng nơi họ muốn rồi
 *    đóng thứ họ tới xem. Ngăn Mô phỏng **mặc định đã mở**, nên đích đúng là
 *    `/twin` trơn. Báo lại thay vì chép nguyên spec.
 * 3. §13b ghi `?tab=map` và `/factory-live-map` → **`/twin?lop=uns`**. ⚠ Cũng
 *    là **lỗi trong spec**: `"uns"` KHÔNG nằm trong `LOP_HOP_LE` của
 *    `duongDanTwin.ts` (`["nhan","canhBao","wip","dongChay","tuoi",
 *    "ngungKhaiThac"]` — sáu tên, đóng ở cả hai chiều). `docLop()` **bỏ tên lạ
 *    trong im lặng**, nên `?lop=uns` ghi ra đúng, đọc lại ra rỗng, và không lỗi
 *    nào nổ — đúng lớp G67 "tính năng chết ở tầng ĐẦU TIÊN là KIỂU/DANH SÁCH"
 *    mà chính `duongDanTwin.ts` đã ghi cảnh báo cho `?thu=moPhong`.
 *    ⇒ Đích ở đây là `/twin` trơn. **Không** thêm `"uns"` vào `LOP_HOP_LE`:
 *    tệp ấy nằm dưới `van-hanh/**` mà lô Z đang giữ, và một khoá URL mới cũng
 *    đi ngược G40. Nợ ghi lại: nếu muốn `?lop=uns` thật thì phải thêm tên vào
 *    danh sách ĐÓNG ấy TRƯỚC, ở một đợt có quyền chạm tệp đó.
 *
 * ★ Module THUẦN — không react, không `window`. Bảng ánh xạ test được ở
 *   `environment: "node"`, và test cưỡng chế **cả 14 dòng** cùng luật ≤1 chặng.
 */

/**
 * Đích của mọi đường vào Twin cũ.
 *
 * ★ Khoá là **đường dẫn + query đầy đủ** đúng như người dùng gõ/dán; giá trị là
 *   đích **CUỐI CÙNG**, không phải chặng kế tiếp. Đó là cách bảng này cưỡng chế
 *   luật ≤1 chặng ở tầng dữ liệu: không có giá trị nào trong bảng lại là một
 *   khoá của chính bảng (test kiểm điều đó).
 */
import {
  docPhamVi,
  docVatTheChon,
  duongDanManLine,
  duongDanManMay,
} from "../van-hanh/duongDanTwin";
import { docNganNhung } from "../van-hanh/nhungTaiCho";

export const DICH_TWIN_CU: Readonly<Record<string, string>> = {
  // ── Vỏ `/digital-twin` và 7 tab của nó ───────────────────────────────────
  "/digital-twin": "/twin",
  "/digital-twin?tab=overview": "/twin",
  "/digital-twin?tab=center": "/twin",
  "/digital-twin?tab=map": "/twin",
  // ★★★ QĐ-18 (§13c.2, thay QĐ-16): hai tab SOẠN THẢO về `/twin-studio` — đúng
  //   nguyên văn §13b 14.2.3 đề nghị ban đầu. Xem mục 1 của "HAI ĐIỀU…" dưới.
  "/digital-twin?tab=floor": "/twin-studio",
  "/digital-twin?tab=layout": "/twin-studio",
  // ★ Xem "HAI ĐIỀU §13b NÓI MÀ ĐỢT NÀY LÀM KHÁC" mục 2: KHÔNG `?thu=moPhong`.
  "/digital-twin?tab=cell": "/twin",
  // ★ §13b: RF là mô phỏng thuần (đo được **0 lời gọi tRPC** trong 792 dòng) —
  //   nó không trả lời "nhà máy đang thế nào", nên đứng RIÊNG ngoài Twin.
  "/digital-twin?tab=rf": "/rf-test-cell",

  // ── Sáu tuyến cũ trước đây đi VÒNG qua `/digital-twin` (hai chặng) ───────
  "/factory-live-map": "/twin",
  "/factory-floor-editor": "/twin-studio",
  "/cell-twin": "/twin",
  "/digital-twin-center": "/twin",
  "/layout": "/twin-studio",

  // ── ★★★ `/twin-studio` KHÔNG còn trong bảng này (QĐ-18) ──────────────────
  //   Đợt 21 (QĐ-16) gộp nó vào `/twin` nên nó là một ĐƯỜNG CŨ cần ánh xạ.
  //   QĐ-18 trả nó về **tuyến thật** (`App.tsx` `RouteGuard navHref`), nên nó
  //   không còn là "đường vào Twin cũ" nữa — để nó ở đây sẽ đẻ ra một chặng
  //   redirect trỏ vào chính nó. Test `khongCoChuoiRedirect()` cưỡng chế điều
  //   đó ở tầng dữ liệu: nay `/twin-studio` là **giá trị**, không phải khoá.
};

/**
 * Tra đích cho một đường vào cũ.
 *
 * ⚠ Trả `null` cho đường không có trong bảng — KHÔNG đoán. Một redirect đoán mò
 *   sẽ nuốt cả những URL chưa từng thuộc Twin, và người dùng mất trang mà không
 *   biết vì sao.
 */
export function traDichCu(duongDan: string): string | null {
  return DICH_TWIN_CU[duongDan] ?? null;
}

/**
 * ★★★ Cưỡng chế luật ≤1 chặng ở tầng DỮ LIỆU.
 *
 * Trả danh sách khoá mà **đích của nó lại là một khoá khác** — tức là một chuỗi
 * hai chặng. Bảng đúng phải cho **mảng rỗng**.
 *
 * ★ Đây là phép đo, không phải lời khai: nó ĐỌC bảng thật thay vì tin vào chú
 *   thích ở trên. Ai thêm một dòng `"/x": "/digital-twin?tab=map"` sẽ làm lưới
 *   ĐỎ ngay, chứ không phải để người dùng phát hiện bằng một cú bấm bookmark.
 */
export function timChuoiNhieuChang(): string[] {
  const khoa = new Set(Object.keys(DICH_TWIN_CU));
  return Object.entries(DICH_TWIN_CU)
    .filter(([, dich]) => khoa.has(dich))
    .map(([k]) => k);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 33 — QĐ-23: `/twin?pv=line:N` · `?chon=machine:N` · `?xem=machine:N` */
/*     là ĐƯỜNG CŨ tới hai màn riêng — redirect THAM SỐ, không nằm được trong    */
/*     bảng khoá-tĩnh ở trên                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
/*
 * Trước QĐ-23, `/twin?pv=line:2` dựng màn Line **tại chỗ** và `/twin?chon=
 * machine:14` mở panel máy — hai bản của thứ nay đã là `/twin/line/2` và
 * `/twin/may/14`. Link cũ trong chat/bookmark vẫn còn, nên G40 đòi chúng tới
 * đúng đích, ≤ 1 chặng. Bảng `DICH_TWIN_CU` khớp CHUỖI ĐẦY ĐỦ nên không chứa
 * được dạng `line:N`; hàm này đọc query bằng ĐÚNG bộ phân tích của
 * `duongDanTwin.ts`/`nhungTaiCho.ts` (một bộ đọc, không viết bộ thứ hai — G12).
 *
 * Thứ tự ưu tiên = độ cụ thể: `xem=machine` (cockpit nhúng) > `chon=machine` >
 * `pv=machine` > `chon=line` > `pv=line`. `?pv=tapdoan|factory:N|tang:N`,
 * `?chon=station:N` và `?xem=robot|station:N` **ở lại `/twin`** (QĐ-23 giữ ba
 * cấp; robot/trạm chưa có màn riêng — nói ra ở §14q.10, không đoán đích).
 *
 * ⚠ `TwinVanHanh` (vỏ) là chỗ DUY NHẤT gọi hàm này; `App.tsx` không đổi.
 */
export function dichManRieng(search: string): string | null {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const xem = docNganNhung(sp.get("xem"));
  if (xem?.loai === "machine") return duongDanManMay(xem.id);
  const chon = docVatTheChon(sp.get("chon"));
  if (chon?.loai === "machine") return duongDanManMay(chon.id);
  const pv = docPhamVi(sp.get("pv"));
  if (pv?.cap === "may" && pv.id !== null) return duongDanManMay(pv.id);
  if (chon?.loai === "line") return duongDanManLine(chon.id);
  if (pv?.cap === "line" && pv.id !== null) return duongDanManLine(pv.id);
  return null;
}

/**
 * byteMau.ts — quy MỘT chuỗi màu CSS bất kỳ ra ba byte sRGB, **KHÔNG phụ thuộc three**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TÁCH KHỎI `mauThree.ts` — GIỮ `phamViCanh.ts` THUẦN
 * ════════════════════════════════════════════════════════════════════════════
 * `phamViCanh.ts` tự khai ở docblock đầu tệp: *"Module THUẦN: không three, không
 * react"* — nhờ vậy toàn bộ luật phạm vi test được ở `environment: "node"` mà
 * không cần WebGL. Nhưng `phaVeNen()` của nó lại CẦN quy `oklch()` (G29).
 *
 * Nếu nó import `mauThree.ts` thì nó kéo theo `three` và lời khai kia thành SAI
 * — một tệp tự nhận "thuần" mà thực ra không phải là đúng lớp lỗi "docblock nói
 * quá mã" (G27). Nên phần KHÔNG cần three nằm ở đây; `mauThree.ts` import lên.
 *
 * ★ Chạy được trong node: `byteMau` trả `null` khi `typeof document === "undefined"`.
 */

/** Cú pháp màu CSS mà `THREE.Color`/`tachRgb` KHÔNG đọc được — phải đi vòng canvas. */
const CU_PHAP_LA = /^\s*(oklch|oklab|lch|lab|color|hwb)\s*\(/i;

/**
 * Chuỗi màu CSS này có phải loại `THREE.Color` KHÔNG hiểu không?
 *
 * Tách thành hàm riêng (thay vì inline regex ở ba chỗ) vì đây là **danh sách
 * cú pháp**, và một danh sách nhân bản là một danh sách sẽ lệch. Xuất ra để test
 * ghim được đúng tập cú pháp, không phải ghim một regex chép tay.
 */
export function laCuPhapLa(gt: string): boolean {
  return CU_PHAP_LA.test(gt);
}

/**
 * Đọc MỘT chuỗi màu CSS bất kỳ ra ba byte **sRGB**, bằng canvas 2D.
 *
 * `null` khi không quy được (chuỗi rác, canvas bị chặn, không có DOM) — người
 * gọi tự chọn màu dự phòng; module này KHÔNG bịa một màu câm.
 *
 * ★ Vì sao có canh gác `#010203` thay vì chỉ đọc pixel: một chuỗi RÁC cũng cho
 *   pixel `(0,0,0)`, không phân biệt được với "màu đen hợp lệ". Nhưng canvas 2D
 *   BỎ QUA giá trị không hợp lệ và GIỮ NGUYÊN `fillStyle` cũ — nên đặt một giá
 *   trị canh gác rồi kiểm xem nó có đổi không là phép thử đáng tin, còn đọc
 *   pixel thì không.
 */
/* ═══════════════════════════════════════════════════════════════════════════ */
/* BỘ NHỚ ĐỆM — bản vá Pareto #1 của vòng PDCA "engine 3D"                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ VÌ SAO CÓ ĐỆM — SỐ ĐO, KHÔNG PHẢI CẢM GIÁC.
 *
 * CDP Profiler trên `dist` 2026-09-18, `/twin`, kéo xoay camera, RTX 5090:
 *   `getImageData` chiếm **36,7 s / 39 s = 93 %** main thread; three.js chỉ 1 %.
 *   Đếm trực tiếp trong một lần kéo: **2.425 lượt `getImageData` + 2.425
 *   `createElement("canvas")`** — trong khi cùng thao tác ở chế độ 2D chỉ 1 lượt.
 *   Đường gọi: `LopCanhBao` (`useFrame` ⇒ `setState` mỗi khung) → `mauCss` +
 *   `mauChuTrenNen` → `byteMau`. Mỗi badge ~3 lượt, mỗi khung một lượt render.
 *   Hệ quả đo được: 9,2 fps khi kéo, khung p95 = 333 ms.
 *
 * ★ KHOÁ LÀ CHUỖI VÀO, VÀ CHỈ THẾ LÀ ĐỦ — CHO CA THÀNH CÔNG:
 *   ánh xạ "chuỗi màu CSS → ba byte sRGB" do đặc tả CSS định nghĩa, không phụ
 *   thuộc theme/DOM/thời gian. Đổi theme làm `giaiMauCanh(token)` trả **chuỗi
 *   khác** ⇒ **khoá khác** ⇒ tự đúng.
 *
 * ★★★ NHƯNG **KHÔNG ĐỆM `null`** — và đây là thứ phép đo dạy, không phải suy luận.
 *   Bản vá đầu đệm cả `null` và làm **11/33 ca của `mauThree`/`phaVeNen` chuyển
 *   ĐỎ** (bản gốc 33/33 xanh). Đọc ra: `null` KHÔNG phải một sự thật về chuỗi
 *   màu, nó là sự thật về **canvas lúc ấy có dùng được không** — một điều kiện
 *   NGOÀI khoá đệm. Đệm nó lại là ghim một thất bại tạm thời thành vĩnh viễn.
 *   ⇒ Ca hỏng KHÔNG vào đệm, nên hành vi ở nhánh hỏng giống hệt trước bản vá;
 *     chỉ ca thành công — cũng chính là đường nóng — mới được đệm.
 *
 * ★ Vẫn `createElement` mỗi lượt TRƯỢT đệm (không dùng lại một ctx module-level):
 *   dùng lại làm thêm 2 ca đỏ nữa, vì lưới test THAY canvas giữa các ca. Sau khi
 *   đệm ấm thì số lượt trượt là vài chục cho cả phiên — không còn là đường nóng.
 *
 * ★ Trần 512: tập token của app hữu hạn, nhưng hàm nhận chuỗi tự do nên phải có
 *   trần, nếu không một chỗ gọi sinh chuỗi động biến đệm thành rò bộ nhớ câm.
 */
const TRAN_DEM = 512;
const DEM_BYTE = new Map<string, [number, number, number]>();

/** Chỉ dành cho lưới đo/ablation: xoá đệm để đo lại từ trạng thái lạnh. */
export function xoaDemByteMau(): void {
  DEM_BYTE.clear();
}

export function byteMau(gt: string): [number, number, number] | null {
  const daCo = DEM_BYTE.get(gt);
  if (daCo !== undefined) return daCo;
  const kq = quyByteMau(gt);
  if (kq) {
    if (DEM_BYTE.size >= TRAN_DEM) DEM_BYTE.clear();
    DEM_BYTE.set(gt, kq);
  }
  return kq;
}

function quyByteMau(gt: string): [number, number, number] | null {
  if (typeof document === "undefined") return null;
  try {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const CANH_GAC = "#010203";
    ctx.fillStyle = CANH_GAC;
    ctx.fillStyle = gt;
    if (ctx.fillStyle === CANH_GAC) return null;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  } catch {
    // Canvas bị chặn (fingerprinting guard) — người gọi dùng màu dự phòng ĐÚNG
    // SẮC, còn hơn để `THREE.Color` âm thầm trả về trắng.
    return null;
  }
}


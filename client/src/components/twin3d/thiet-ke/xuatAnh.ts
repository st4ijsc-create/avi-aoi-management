/**
 * xuatAnh.ts — Export PNG của canvas 3D (§11.9 #57).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `preserveDrawingBuffer` MẶC ĐỊNH **false** ⇒ `toDataURL` TRẢ ẢNH TRẮNG
 * ════════════════════════════════════════════════════════════════════════════
 * Kiểm trên `node_modules/three/src/renderers/WebGLRenderer.js:82` của CHÍNH
 * repo này: `preserveDrawingBuffer = false` là mặc định, và `KhungCanh.tsx`
 * không đặt lại. Với cờ đó, trình duyệt được phép xoá backbuffer ngay sau khi
 * compose khung — nên `canvas.toDataURL()` gọi ở một lượt sự kiện KHÁC (một cú
 * click chẳng hạn) trả về ảnh **trong suốt/đen**, và không có lỗi nào.
 *
 * Hai đường ra, và ta chọn đường thứ hai:
 *
 *   (a) Bật `preserveDrawingBuffer: true`. Đơn giản, nhưng buộc trình duyệt giữ
 *       một bản sao backbuffer **mỗi khung, mãi mãi** — trả giá bộ nhớ và băng
 *       thông cho một nút bấm mỗi vài giờ. Và nó sửa `loi/KhungCanh.tsx`, tệp
 *       đã qua QA.
 *   (b) **Vẽ LẠI rồi chụp NGAY trong cùng lượt tick**, trước khi quyền kiểm
 *       soát trở về trình duyệt. `gl.render(scene, camera)` xong thì backbuffer
 *       còn nguyên cho tới hết microtask hiện tại. Đây là khuôn chuẩn của
 *       three để chụp ảnh và nó KHÔNG tốn gì khi không dùng.
 *
 * ⇒ `chupCanvas` dưới đây **bắt buộc** nhận một hàm `veLai` và gọi nó ngay
 *   trước `toDataURL`. Không cho truyền `undefined`: quên vẽ lại là đúng cái
 *   lỗi câm mà module này sinh ra để chặn, nên nó phải là lỗi BIÊN DỊCH.
 *
 * ★ Module THUẦN theo nghĩa vitest "node": không import three, không import
 *   react. Nó chạm DOM qua các tham số truyền vào (canvas, document), nên test
 *   dựng vật giả và đo được cả nhánh hỏng.
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Phần bề mặt canvas mà module này cần — khai hẹp để test dựng vật giả được. */
export interface CanvasChupDuoc {
  width: number;
  height: number;
  toDataURL: (loai?: string, chatLuong?: number) => string;
}

/** Kết quả chụp. `lyDo` khác null nghĩa là KHÔNG có ảnh. */
export interface KetQuaChup {
  dataUrl: string | null;
  lyDo: "khong-canvas" | "canvas-rong" | "chup-loi" | null;
  rong: number;
  cao: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tên tệp                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Tên tệp PNG: `twin-<slug>-<YYYYMMDD-HHmmss>.png`.
 *
 * ★ Nhận `khi: Date` làm THAM SỐ, không gọi `new Date()` bên trong — module này
 *   phải TẤT ĐỊNH để test khẳng định được chuỗi ra, và một `Date.now()` ẩn
 *   biến mọi test tên tệp thành test "hàm có chạy không".
 *
 * ★ Dùng giờ ĐỊA PHƯƠNG, không UTC: tệp này nằm trong thư mục Tải xuống của
 *   một kỹ sư ở nhà máy, và "14h30" phải là 14h30 của họ.
 */
export function tenTepAnh(nhan: string, khi: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ngay = `${khi.getFullYear()}${p2(khi.getMonth() + 1)}${p2(khi.getDate())}`;
  const gio = `${p2(khi.getHours())}${p2(khi.getMinutes())}${p2(khi.getSeconds())}`;
  const slug = lamSlug(nhan);
  return slug ? `twin-${slug}-${ngay}-${gio}.png` : `twin-${ngay}-${gio}.png`;
}

/**
 * Chuỗi bất kỳ → slug an toàn cho tên tệp.
 * Bỏ dấu tiếng Việt trước khi lọc: `"Tầng trệt"` phải ra `tang-tret`, không
 * phải `t-ng-tr-t`. Windows cấm `\ / : * ? " < > |` trong tên tệp và một tên
 * chứa chúng làm cú tải xuống thất bại **im lặng** ở một số trình duyệt.
 */
export function lamSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Chụp                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chụp canvas thành data URL PNG.
 *
 * `veLai` được gọi NGAY TRƯỚC `toDataURL` — xem docblock đầu tệp; đây là toàn
 * bộ lý do hàm này tồn tại thay vì một dòng `canvas.toDataURL()` tại chỗ gọi.
 *
 * Canvas 0×0 trả `lyDo: "canvas-rong"` chứ không trả một data URL rỗng: một
 * chuỗi `"data:,"` vẫn "tải xuống được" và người dùng nhận một tệp 0 byte mà
 * không hiểu vì sao.
 */
export function chupCanvas(
  canvas: CanvasChupDuoc | null | undefined,
  veLai: () => void,
): KetQuaChup {
  if (!canvas) return { dataUrl: null, lyDo: "khong-canvas", rong: 0, cao: 0 };
  const rong = canvas.width;
  const cao = canvas.height;
  if (!(rong > 0) || !(cao > 0)) {
    return { dataUrl: null, lyDo: "canvas-rong", rong: rong || 0, cao: cao || 0 };
  }
  try {
    // ★★★ Thứ tự này là bản chất, không phải phong cách.
    veLai();
    const url = canvas.toDataURL("image/png");
    if (typeof url !== "string" || !url.startsWith("data:image/png")) {
      return { dataUrl: null, lyDo: "chup-loi", rong, cao };
    }
    return { dataUrl: url, lyDo: null, rong, cao };
  } catch {
    // `toDataURL` ném `SecurityError` khi canvas bị "tainted" (texture chéo
    // nguồn). RB-5 cấm asset CDN nên chuyện này không nên xảy ra — nhưng nếu
    // xảy ra thì người dùng phải thấy một thông báo, không phải một tab treo.
    return { dataUrl: null, lyDo: "chup-loi", rong, cao };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tải xuống                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Phần `document` mà {@link taiXuong} cần. Hẹp để test dựng vật giả được.
 *
 * ⚠ `appendChild`/`removeChild` khai trả `unknown` và nhận `never`, KHÔNG nhận
 *   `unknown`. Lý do là biến thiên (variance): `Document.body.appendChild` có
 *   chữ ký `<T extends Node>(node: T) => T`, và một tham số `unknown` KHÔNG
 *   gán được vào tham số `Node` (tham số nghịch biến) ⇒ `Document` thật sẽ
 *   **không khớp** interface này, và chỗ gọi phải `as any` — tức vứt bỏ đúng
 *   thứ interface hẹp sinh ra để giữ. `never` là kiểu tham số duy nhất mà mọi
 *   hàm nhận-một-tham-số đều gán được vào.
 */
export interface DocTaiXuong {
  createElement: (ten: string) => {
    href?: string;
    download?: string;
    style?: Partial<CSSStyleDeclaration> | Record<string, string>;
    click: () => void;
    remove?: () => void;
  };
  body: { appendChild: (n: never) => unknown; removeChild?: (n: never) => unknown };
}

/**
 * Kích hoạt tải xuống một data URL. Trả `true` khi đã bấm được.
 *
 * ★ Phải `appendChild` trước khi `click()`: Firefox bỏ qua cú click trên một
 *   `<a>` chưa nằm trong document, và cú "tải xuống" **không xảy ra, không báo
 *   lỗi**. Rồi `remove()` ngay để không rò node.
 */
export function taiXuong(doc: DocTaiXuong | null | undefined, dataUrl: string, ten: string): boolean {
  if (!doc || !dataUrl) return false;
  try {
    const a = doc.createElement("a");
    a.href = dataUrl;
    a.download = ten;
    if (a.style) (a.style as Record<string, string>).display = "none";
    doc.body.appendChild(a as never);
    a.click();
    if (typeof a.remove === "function") a.remove();
    else doc.body.removeChild?.(a as never);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chụp + tải xuống trong MỘT lượt. Đây là hàm mà nút bấm gọi.
 * Trả về `lyDo` khi hỏng để tầng UI hiện toast đúng nguyên nhân, thay vì im
 * lặng — "bấm nút xong không có gì xảy ra" là hỏng tệ nhất trong ba kiểu hỏng.
 */
export function xuatPng(
  canvas: CanvasChupDuoc | null | undefined,
  veLai: () => void,
  doc: DocTaiXuong | null | undefined,
  nhan: string,
  khi: Date,
): { xong: boolean; lyDo: KetQuaChup["lyDo"] | "tai-loi"; ten: string } {
  const ten = tenTepAnh(nhan, khi);
  const kq = chupCanvas(canvas, veLai);
  if (!kq.dataUrl) return { xong: false, lyDo: kq.lyDo, ten };
  const daTai = taiXuong(doc, kq.dataUrl, ten);
  return daTai ? { xong: true, lyDo: null, ten } : { xong: false, lyDo: "tai-loi", ten };
}

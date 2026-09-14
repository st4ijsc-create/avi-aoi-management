/**
 * xuatUsd.ts — Xuất cảnh Twin ra tệp USD/USDA (§11 #1), tầng LOGIC THUẦN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G28 — "TẢI VỀ ĐƯỢC" KHÔNG PHẢI LÀ PHÉP ĐO. NỘI DUNG MỚI LÀ.
 * ════════════════════════════════════════════════════════════════════════════
 * `buildFactoryUsda` của server (`usdExport.ts` docblock, nguyên văn) là
 * **DEGRADE-SAFE**: *"a null-factory / empty scene-graph → a valid EMPTY stage
 * (header + metadata, no prims), never a throw"*. Nghĩa là đường hỏng KHÔNG ném
 * lỗi, KHÔNG trả chuỗi rỗng, và KHÔNG có mã lỗi nào để bắt — nó trả về một tệp
 * USDA **hợp lệ** mà rỗng ruột.
 *
 * ĐO ĐƯỢC trên DB dev ngày 2026-09-07 bằng chính `buildFactoryUsda`:
 *
 *     factory 1 (SIM-FAC) → 40.025 byte · 142 prim `def`   ← cảnh THẬT
 *     factory 2           →    115 byte ·   0 prim `def`   ← "empty stage (no factory)"
 *
 * Hai kết quả ấy đi qua ĐÚNG MỘT đường mã, cùng `format: "usda"`, cùng HTTP 200.
 * Một nút chỉ hỏi "có tải được không" sẽ báo THÀNH CÔNG cho cả hai, và người
 * dùng mở tệp 115 byte trong Omniverse thấy một stage trống mà không hiểu vì
 * sao — đúng chế độ hỏng mà G28 sinh ra để chặn.
 *
 * ⇒ Module này **đếm prim** trước khi cho tải. Số prim là thứ duy nhất phân biệt
 *   được hai kết quả trên; `byteLength` thì KHÔNG (115 vẫn là "có nội dung" với
 *   mọi phép kiểm `length > 0`).
 *
 * ★ Module THUẦN theo nghĩa vitest "node": không import three, không import
 *   react, không import trpc. Nó chạm DOM qua tham số truyền vào, nên test dựng
 *   vật giả và đo được CẢ NHÁNH HỎNG — không chỉ nhánh xanh.
 *
 * ★ Tất định: không `Date.now()` bên trong; mốc thời gian là THAM SỐ.
 */

import { lamSlug, taiXuong, type DocTaiXuong } from "../thiet-ke/xuatAnh";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Kiểu                                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Phần hợp đồng `twin.usdExport` mà module này dùng. Khai HẸP (không lấy nguyên
 * kiểu trả về của tRPC) để test không phải dựng cả router.
 */
export interface KetQuaUsdExport {
  usda: string;
  byteLength: number;
}

/** Lý do KHÔNG xuất được. `null` = xuất được. */
export type LyDoKhongXuat =
  | "khong-nha-may" // chưa chọn nhà máy
  | "rong" // chuỗi rỗng / không phải chuỗi
  | "khong-phai-usda" // thiếu header `#usda`
  | "canh-trong" // ★ hợp lệ nhưng 0 prim — chế độ hỏng của G28
  | "tai-loi"; // tạo <a> / click hỏng

/** Kết quả thẩm định nội dung USDA. */
export interface ThamDinhUsda {
  /** Số prim `def` đếm được — thước đo "cảnh có gì" duy nhất đáng tin. */
  soPrim: number;
  /** Số byte THẬT của chuỗi (đếm tại chỗ, không tin `byteLength` server gửi). */
  soByte: number;
  lyDo: LyDoKhongXuat | null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tên tệp                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Tên tệp USDA: `twin-<slug>-<YYYYMMDD-HHmmss>.usda`.
 *
 * ★ Dùng lại `lamSlug` của `xuatAnh.ts` thay vì chép: một bản sao thứ hai của
 *   luật bỏ dấu/lọc ký tự cấm Windows là hai luật sẽ trôi khỏi nhau.
 *
 * ★ Giờ ĐỊA PHƯƠNG, cùng lý lẽ đã ghi ở `tenTepAnh`.
 */
export function tenTepUsd(nhan: string, khi: Date): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const ngay = `${khi.getFullYear()}${p2(khi.getMonth() + 1)}${p2(khi.getDate())}`;
  const gio = `${p2(khi.getHours())}${p2(khi.getMinutes())}${p2(khi.getSeconds())}`;
  const slug = lamSlug(nhan);
  return slug ? `twin-${slug}-${ngay}-${gio}.usda` : `twin-${ngay}-${gio}.usda`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Thẩm định — trái tim của module                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Đếm prim `def` trong một stage USDA.
 *
 * ⚠ Phải neo ĐẦU DÒNG (`^\s*def\s`). Không neo thì chuỗi `"undefined"` trong
 *   một `doc = "..."` cũng khớp `def`, và một stage rỗng tự khai là có prim —
 *   phép đo sẽ nói ĐÚNG cái điều nó sinh ra để bác bỏ.
 *
 * ⚠ Cờ `m` là bắt buộc: thiếu nó thì `^` chỉ khớp đầu CHUỖI, và mọi stage đều
 *   đếm ra 0 hoặc 1 — một chỉ báo mù kêu-đúng-một-lần.
 */
export function demPrim(usda: string): number {
  if (typeof usda !== "string" || usda.length === 0) return 0;
  return (usda.match(/^[ \t]*def[ \t]+/gm) ?? []).length;
}

/**
 * Số byte UTF-8 của một chuỗi, KHÔNG dùng `Buffer` (module này chạy ở trình
 * duyệt). `TextEncoder` có ở mọi trình duyệt mục tiêu và ở node >= 11.
 */
export function demByteUtf8(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  // Đường lui cho môi trường test tối giản: đếm tay theo bậc mã.
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Thẩm định nội dung trước khi cho tải.
 *
 * Thứ tự kiểm là có chủ ý — từ "không có gì" tới "có mà rỗng ruột", để thông
 * báo cho người dùng nêu đúng nguyên nhân GẦN NHẤT:
 *   1. rỗng / không phải chuỗi
 *   2. không có header `#usda` (không phải tệp USD — hợp đồng server đã đổi?)
 *   3. 0 prim ⇒ `canh-trong` — ★ chính là ca factory 2 đo được ở docblock đầu tệp
 */
export function thamDinhUsda(kq: KetQuaUsdExport | null | undefined): ThamDinhUsda {
  const usda = kq?.usda;
  if (typeof usda !== "string" || usda.trim().length === 0) {
    return { soPrim: 0, soByte: 0, lyDo: "rong" };
  }
  // Đếm byte TẠI CHỖ. `kq.byteLength` là lời khai của server về chính nó; nếu
  // nó lệch với chuỗi thật thì thứ người dùng nhận là chuỗi thật, không phải
  // con số. (Đo cùng một vật bằng thiết bị của mình.)
  const soByte = demByteUtf8(usda);
  if (!usda.trimStart().startsWith("#usda")) {
    return { soPrim: 0, soByte, lyDo: "khong-phai-usda" };
  }
  const soPrim = demPrim(usda);
  if (soPrim === 0) return { soPrim: 0, soByte, lyDo: "canh-trong" };
  return { soPrim, soByte, lyDo: null };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Tải xuống                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Kết quả của một lần bấm nút. `soPrim`/`soByte` dùng cho thông báo + e2e. */
export interface KetQuaXuatUsd {
  xong: boolean;
  lyDo: LyDoKhongXuat | null;
  ten: string;
  soPrim: number;
  soByte: number;
}

/**
 * Thẩm định + tải xuống trong MỘT lượt. Đây là hàm mà nút bấm gọi.
 *
 * ★ Dùng `data:` URL qua `taiXuong` của `xuatAnh.ts` thay vì `URL.createObjectURL`:
 *   cùng một đường đã qua QA (đã xử lý bẫy "Firefox bỏ qua click trên `<a>` chưa
 *   nằm trong document"), và không có object URL nào để rò nếu quên `revoke`.
 *
 * ★ `encodeURIComponent` chứ không `btoa`: USDA chứa tên nhà máy tiếng Việt có
 *   dấu, và `btoa` NÉM `InvalidCharacterError` với mọi ký tự > U+00FF — một cú
 *   "bấm nút không có gì xảy ra" kinh điển.
 */
export function xuatUsd(
  kq: KetQuaUsdExport | null | undefined,
  doc: DocTaiXuong | null | undefined,
  nhan: string,
  khi: Date,
): KetQuaXuatUsd {
  const ten = tenTepUsd(nhan, khi);
  const td = thamDinhUsda(kq);
  if (td.lyDo !== null) {
    return { xong: false, lyDo: td.lyDo, ten, soPrim: td.soPrim, soByte: td.soByte };
  }
  const url = `data:text/plain;charset=utf-8,${encodeURIComponent(kq!.usda)}`;
  const daTai = taiXuong(doc, url, ten);
  return daTai
    ? { xong: true, lyDo: null, ten, soPrim: td.soPrim, soByte: td.soByte }
    : { xong: false, lyDo: "tai-loi", ten, soPrim: td.soPrim, soByte: td.soByte };
}

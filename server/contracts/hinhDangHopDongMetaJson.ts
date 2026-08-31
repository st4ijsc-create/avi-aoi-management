// server/contracts/hinhDangHopDongMetaJson.ts
//
// Pha 1F Task 4 (⭐ TRỌNG TÂM, BG-78/BG-77/BG-73/BG-72) — cổng theo HÌNH DẠNG
// HỢP ĐỒNG CHO PHÉP, không theo hình dạng ĐANG CÓ trong DB test.
//
// ── Vì sao file này tồn tại ────────────────────────────────────────────────
// Sáu lượt review toàn nhánh, sáu lần tìm Critical. Lượt 6 tổng hợp gốc rễ
// chung (spec 2026-08-31-aoi-backlog-toan-canh.md §L-4, tầng sâu hơn):
//   "Mỗi lần đổi phân loại, phép nghiệm thu chạy trên HÌNH DẠNG CÓ TRONG DB
//    TEST, không chạy trên HÌNH DẠNG HỢP ĐỒNG CHO PHÉP."
// 254/254 gói DB test đều có `result` đầy đủ ⇒ lỗi "lá thiếu result bị tính
// NTF" (BG-78) vô hình cho tới lượt 6. Mẫu meta.json máy THẬT không nằm trong
// bộ nghiệm thu cửa ZIP ⇒ lỗi "gói máy thật chết 'dead'" (BG-73) vô hình.
//
// File này KHÔNG lặp lại việc Task 1/2 đã làm (vá BA thể hiện) — nó dựng bộ
// SINH HÌNH DẠNG bằng cách ĐI THEO CHÍNH `metaJsonSchema` (không phải bảng
// viết tay đoán mò), rồi để `server/routers/aoiPackageHinhDangHopDongChoPhep.test.ts`
// chạy đường verdict + phân loại lỗi THẬT (commit sống, SELECT sau commit)
// trên từng hình dạng — cùng ethos "đo THẬT, không suy đoán" của toàn nhánh.
//
// Hai phần:
//   (1) `duyetTruongOptional` — đệ quy MỌI trường `.optional()` của MỘT schema
//       zod bất kỳ (mặc định dùng cho `metaJsonSchema`), CÙNG triết lý
//       `duyetTimTruongChuoi` (capChuoiVarcharScan.ts, Pha 1D Task 5/1F Task 3):
//       kiểu KHÔNG nhận diện được ⇒ THROW (báo động), KHÔNG `return []` im
//       lặng — im lặng ở chỗ không biết đọc giống hệt xanh vì không có vấn đề
//       (L-1, đã cắn dự án bốn lần). Đây là bộ đếm CHỐNG TỰ THOẢ cho MỆNH ĐỀ 3
//       của Task 4: nếu `metaJsonSchema` đổi hình dạng (thêm/bớt trường), danh
//       sách trả về TỰ ĐỘNG đổi theo — không cần ai cập nhật tay.
//   (2) `BANG_HINH_DANG` — danh sách hình dạng CỤ THỂ (mỗi hình dạng là một
//       `meta.json` hợp lệ-theo-schema hoặc cố ý lệch hợp đồng), MỖI hình dạng
//       mang kỳ vọng verdict/phân loại GHI RÕ (không phải `toBeDefined()`).
//       `duongVangMat` là lưới CANH đối chiếu bảng này với (1): mọi trường
//       `.optional()` mà (1) tìm thấy phải có ÍT NHẤT MỘT hình dạng trong (2)
//       để nó VẮNG MẶT — nếu không, census (2) đỏ, nêu đúng tên trường thiếu.
//
// KHÔNG có DB/fs trong file này (trừ `layHinhDangMauMayThat`, tách riêng, đọc
// LAZY — không chặn import của mọi test khác nếu đường dẫn máy thật vắng mặt
// trên một máy CI nào đó không có ổ `D:\SOURCES\AOIData`).
//
// ── BG-85 (2026-09-02) — CẬP NHẬT theo hợp đồng MỚI, KHÔNG hoàn nguyên ──────
// `metaJsonSchema` không còn là schema PHẲNG (`measurements[]`/`points[]`) —
// nó là `machineDataContractV2` (cây `surfaces[].positions[].captures[].
// components[]`) + `images[]`. `BANG_HINH_DANG` bên dưới viết LẠI HOÀN TOÀN
// theo hình dạng CÂY. Máy (1) `duyetTruongOptional`/`duongVangMat` KHÔNG đổi
// — cả hai schema-shape-agnostic theo thiết kế, chỉ đệ quy CẤU TRÚC zod thật.
//
// Hình dạng `biDanhPointsRongThayMeasurements_BG77` (đường `points[]`/
// `measurements[]` chọn nhầm mảng rỗng) đã BỊ XOÁ — không phải bỏ sót: khái
// niệm "hai mảng đo lường cùng cấp, chọn nhầm cái rỗng" KHÔNG CÒN TỒN TẠI
// trong hợp đồng cây (chỉ có MỘT cây `surfaces[]`, không có mảng thay thế
// song song) — đây CHÍNH LÀ bằng chứng "BG-77 tự tan" mà báo cáo BG-85 yêu
// cầu: không phải lập luận, mà là KHÔNG THỂ VIẾT LẠI được payload tái hiện
// lỗi đó bằng hợp đồng mới.
import { z, ZodError } from "zod";
import { readFileSync } from "node:fs";
import {
  metaJsonSchema,
  laLoiVinhVienDemVaoNguongDeadZip,
} from "../routers/aoiPackageRouter";

// ════════════════════════════════════════════════════════════════════════════
// (1) duyetTruongOptional — đệ quy MỌI trường .optional() của một schema zod.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Bóc `ZodOptional`/`ZodNullable`/`ZodDefault` — trả `optional=true` nếu BẤT
 * KỲ lớp bọc nào khiến KHOÁ (key) này được phép VẮNG MẶT khỏi input.
 *
 * `ZodOptional` ⇒ optional (định nghĩa). `ZodDefault` ⇒ CŨNG optional — đo
 * THẬT bằng `safeParse`: `z.object({x: z.string().default("d")}).safeParse({})`
 * THÀNH CÔNG (input được phép thiếu khoá `x`, giá trị thay bằng default) —
 * đây là ĐỊNH NGHĨA của "vắng mặt được" mà census này canh, không phải suy
 * đoán từ tên API. `ZodNullable` ĐƠN LẺ (không đi kèm `.optional()`) KHÔNG
 * đủ — đo THẬT: `z.object({x: z.string().nullable()}).safeParse({})` THẤT
 * BẠI (khoá `x` vẫn BẮT BUỘC phải có mặt, chỉ được phép giá trị `null`) —
 * "được null" và "được vắng mặt" là HAI khái niệm khác nhau, `.nullable()`
 * đơn lẻ chỉ cho khái niệm đầu. Vẫn phải BÓC `ZodNullable` khi duyệt tiếp
 * (để không dừng lại giữa chừng), chỉ KHÔNG dùng nó để bật cờ `optional`.
 */
function boLop(node: z.ZodTypeAny): { optional: boolean; loi: unknown } {
  let n: any = node;
  let optional = false;
  while (n instanceof z.ZodOptional || n instanceof z.ZodNullable || n instanceof z.ZodDefault) {
    if (n instanceof z.ZodOptional || n instanceof z.ZodDefault) optional = true;
    n = n.unwrap();
  }
  return { optional, loi: n };
}

const GIOI_HAN_DO_SAU = 15; // chặn đệ quy vô hạn nếu lỡ có cấu trúc tự trỏ.

/** Các kiểu LÁ, KHÔNG THỂ giấu một trường `.optional()` con — cùng danh sách
 *  `KIEU_LA_AN_TOAN` của `capChuoiVarcharScan.ts` (không import lại: đây là
 *  cây kiểm OPTIONALITY, không phải ĐỘ DÀI CHUỖI — hai mối quan tâm khác
 *  nhau dù trùng danh sách kiểu an toàn). */
const KIEU_LA_AN_TOAN = [
  z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodBigInt, z.ZodDate, z.ZodEnum, z.ZodLiteral,
  z.ZodNull, z.ZodUndefined, z.ZodVoid, z.ZodNaN, z.ZodNever, z.ZodSymbol,
] as const;

/**
 * Đệ quy MỌI trường `.optional()` của `goc` — trả về danh sách đường dẫn
 * dạng `"a.b"` / `"a.[].b"` (bước `"[]"` = phần tử mảng). Chỉ ghi nhận MỘT
 * trường là "optional" khi CHÍNH bản thân node của nó (không phải cha) được
 * bọc `ZodOptional` — khớp đúng nghĩa BG-78: "trường VẮNG MẶT được", không
 * phải "trường có mặt nhưng giá trị null".
 *
 * Kiểu KHÔNG khớp `ZodObject`/`ZodArray`/`ZodUnion`/lá-an-toàn ⇒ THROW — cùng
 * lý do `duyetTimTruongChuoi` (BG-69/BG-79): walker không được phép ÂM THẦM
 * bỏ sót một nhánh nó không hiểu.
 */
export function duyetTruongOptional(
  goc: z.ZodTypeAny,
  duongDanHienTai: string[] = [],
  doSau = 0,
): string[] {
  if (doSau > GIOI_HAN_DO_SAU) {
    throw new Error(
      `duyetTruongOptional: vượt độ sâu ${GIOI_HAN_DO_SAU} tại "${duongDanHienTai.join(".")}" ` +
        `— khả năng cấu trúc tự trỏ, dừng lại để không treo thay vì đệ quy vô hạn.`,
    );
  }
  const { optional, loi } = boLop(goc);
  const ra: string[] = [];
  if (optional && duongDanHienTai.length > 0) {
    ra.push(duongDanHienTai.join("."));
  }

  if (loi instanceof z.ZodObject) {
    const shape = loi.shape as Record<string, z.ZodTypeAny>;
    for (const key of Object.keys(shape)) {
      ra.push(...duyetTruongOptional(shape[key], [...duongDanHienTai, key], doSau + 1));
    }
    return ra;
  }
  if (loi instanceof z.ZodArray) {
    ra.push(...duyetTruongOptional((loi as any).element, [...duongDanHienTai, "[]"], doSau + 1));
    return ra;
  }
  if (loi instanceof z.ZodUnion) {
    for (const option of loi.options as z.ZodTypeAny[]) {
      ra.push(...duyetTruongOptional(option, duongDanHienTai, doSau + 1));
    }
    return ra;
  }
  if (KIEU_LA_AN_TOAN.some((K) => loi instanceof K)) {
    return ra; // lá thật — không thể giấu một trường .optional() con
  }
  throw new Error(
    `duyetTruongOptional: kiểu zod CHƯA HỖ TRỢ (${(loi as any)?.constructor?.name ?? typeof loi}) tại ` +
      `"${duongDanHienTai.join(".") || "<gốc>"}" — walker KHÔNG THỂ chứng minh nhánh này không chứa ` +
      `trường .optional() con. Bổ sung nhánh xử lý trước khi tin bất kỳ kết quả census nào.`,
  );
}

/** Đường dẫn dạng dữ liệu: `"[]"` → phần tử. Cùng cú pháp `duyetTruongOptional` trả về. */
function tachDuongDan(duongDan: string): string[] {
  return duongDan.split(".");
}

/**
 * Một trường tại `duongDan` có VẮNG MẶT trong `data` không? "Vắng mặt" bao
 * gồm: (a) chính field không tồn tại/`undefined`; (b) MỘT container cha nào
 * đó trên đường đi vắng mặt (kéo theo mọi con cũng vắng — lẽ hiển nhiên);
 * (c) bước `"[]"` gặp mảng RỖNG hoặc không phải mảng — vắng mặt VỚI MỌI phần
 * tử (mảng rỗng không có phần tử nào để mang trường, nên trường đó vắng mặt
 * một cách hiển nhiên — đúng nghĩa dùng cho hình dạng "measurements: []").
 * Với mảng CÓ phần tử, trường được coi là "được hình dạng này chứng minh
 * vắng mặt" nếu BẤT KỲ phần tử nào thiếu nó (không cần TẤT CẢ — một hình dạng
 * chỉ cần DEMO được ca vắng mặt, không cần toàn bộ mảng đồng nhất).
 */
export function duongVangMat(data: unknown, duongDan: string): boolean {
  const buoc = tachDuongDan(duongDan);
  function di(node: unknown, con: string[]): boolean {
    const [dau, ...duoi] = con;
    if (dau === "[]") {
      if (!Array.isArray(node) || node.length === 0) return true;
      return node.some((phanTu) => di(phanTu, duoi));
    }
    const coMat =
      node !== null && node !== undefined && typeof node === "object" &&
      dau in (node as object) && (node as Record<string, unknown>)[dau] !== undefined;
    if (!coMat) return true;
    if (duoi.length === 0) return false; // có mặt, là lá — KHÔNG vắng mặt
    return di((node as Record<string, unknown>)[dau], duoi);
  }
  return di(data, buoc);
}

// ════════════════════════════════════════════════════════════════════════════
// (2) BANG_HINH_DANG — hình dạng CỤ THỂ, mỗi hình dạng mang kỳ vọng GHI RÕ.
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ SỬA SAU PHÁT HIỆN COORDINATOR (2026-08-30) — trước bản vá này,
 * `KyVongChapNhan.overallResult` là một chuỗi PHẲNG: không phân biệt được
 * "tôi KHẲNG ĐỊNH đây là hành vi ĐÚNG" với "tôi GHI NHẬN đây là hành vi HIỆN
 * TẠI (đã biết SAI, chưa vá)". Hậu quả THẬT đã xảy ra: hình dạng
 * `"ngayGioDaiThatBiTuChoiOCuaZip_KHAC_v1x"` mã hoá HÀNH VI CŨ (bị từ chối,
 * đếm vào 'dead') làm `kyVong` — khi BG-91 được vá ở `6082df2f`, cổng chuyển
 * ĐỎ và trông giống hệt "bản vá gây hồi quy", trong khi thật ra đó là cổng
 * ĐANG BẮT ĐÚNG một hành vi giờ đã khác. Đây CÙNG lớp lỗi với ca
 * `"ĐỐI CHỨNG… ntfSource VẪN NULL (đúng, không phải lỗi)"` đã cắn dự án trước
 * đó: một test HỢP THỨC HOÁ lỗi bằng cách gọi nó là chủ đích.
 *
 * `KyVongOverallResult` tách hai việc:
 *   - `khangDinh` — khẳng định: giá trị NÀY PHẢI đúng. Cổng đo VÀ so trực
 *     tiếp; lệch = lỗi thật (hồi quy hoặc cổng sai), không có "lý do chính
 *     đáng" nào để lệch.
 *   - `ghiNhanNoDaDuyet` — ghi nhận nợ ĐÃ ĐƯỢC CHỦ DỰ ÁN DUYỆT treo (ví dụ
 *     BG-77, "còn mở SAU Pha 1F" — backlog toàn cảnh §3): cổng đo
 *     `hanhViHienTai` (giữ XANH — đây không phải việc cổng này phải chặn) NHƯNG
 *     BẮT BUỘC khai riêng `hanhViDung` (giá trị ĐÚNG theo ngữ nghĩa) +
 *     `maBacklog` (liên kết nợ) — hai trường đó PHẢI khai KHÁC NHAU (lưới
 *     `hinhDangHopDongMetaJson.test.ts` canh: nếu `hanhViHienTai===hanhViDung`,
 *     không có lý do gì dùng biến thể "ghi nhận nợ" thay vì `khangDinh`).
 *
 * Chỉ dùng `khangDinh` cho MỘT giá trị mà tôi có bằng chứng ĐÂY LÀ ĐÚNG
 * (hành vi đã được kiểm chứng đúng — mã sản xuất khớp ngữ nghĩa mong muốn),
 * KHÔNG BAO GIỜ dùng nó chỉ vì "hôm nay nó đang chạy vậy".
 *
 * ★★★ Pha 1F Task 8 (I-1) — SỬA SAU KHI ĐỘT BIẾN SỐNG BẮT ĐƯỢC: chốt cũ chỉ
 * canh `hanhViHienTai !== hanhViDung` (BẤT ĐẲNG THỨC, hai giá trị TỰ KHAI) —
 * người review đổi `hanhViDung` "NG"→"NTF" (sai ngữ nghĩa, "NTF" vẫn khác
 * "OK") và cổng vẫn 49/49 XANH: không có gì đối chiếu `hanhViDung` với LUẬT
 * THẬT, chỉ có nó khác `hanhViHienTai`. `tinhHanhViDung` đóng đúng lỗ đó —
 * một hàm THUẦN, PHẢI tái dùng một hàm suy verdict production THẬT đã export
 * (`inferAoiOverallResult`, KHÔNG viết công thức ưu tiên NG>NTF>OK một bản
 * chép tay thứ hai) cho phần CỘNG DỒN/ƯU TIÊN — chỉ được viết logic CỤC BỘ
 * cho đúng PHẦN bị bug bỏ sót (ví dụ BG-77: gộp CẢ HAI mảng thay vì chọn MỘT
 * theo độ rỗng). Bắt buộc ở TẦNG KIỂU (không phải optional) — một
 * `ghiNhanNoDaDuyet` MỚI không có `tinhHanhViDung` không qua được
 * `npm run check`, không chỉ "quên" một dòng lưới. `hinhDangHopDongMetaJson.test.ts`
 * §4 gọi `tinhHanhViDung(meta)` và so với `hanhViDung` khai — lệch ⇒ ĐỎ, cộng
 * một ca tự-kiểm chống "hàm trả hằng số nguỵ trang" (biến thể `meta` KHÔNG
 * NG/NTF nào phải luôn tính ra "OK", cùng hợp đồng `inferAoiOverallResult`).
 */
export type KyVongOverallResult =
  | { dang: "khangDinh"; overallResult: "OK" | "NG" | "NTF" }
  | {
      dang: "ghiNhanNoDaDuyet";
      /** Giá trị cổng ĐO ĐƯỢC hôm nay — cổng so khớp cái NÀY (giữ xanh). */
      hanhViHienTai: "OK" | "NG" | "NTF";
      /** Giá trị ĐÚNG theo ngữ nghĩa — KHÔNG dùng để assert TRỰC TIẾP, nhưng
       *  PHẢI khớp `tinhHanhViDung(meta)` (lưới `hinhDangHopDongMetaJson.test.ts`
       *  §4 canh) — không còn là một chuỗi tự khai đứng một mình. */
      hanhViDung: "OK" | "NG" | "NTF";
      /** Mã backlog theo dõi nợ này — dạng "BG-NN", ví dụ "BG-77". PHẢI trỏ một
       *  mục CÓ THẬT trong `docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md`
       *  (lưới canh bằng cách đọc + phân tích tệp đó, không chỉ khớp regex hình
       *  dạng chuỗi — "BG-9999" khớp regex nhưng KHÔNG tồn tại trong tài liệu ⇒ ĐỎ). */
      maBacklog: string;
      /** Ai/ở đâu đã duyệt treo nợ này — một câu, trích dẫn được. */
      lyDoDuyet: string;
      /** ★★★ Hàm THUẦN tính `hanhViDung` từ CHÍNH `meta` bằng LUẬT THẬT — xem
       *  khối chú thích lớn phía trên `KyVongOverallResult`. Đây là bằng chứng
       *  "đây là đúng theo tính toán", thay cho một chuỗi người viết tự khai. */
      tinhHanhViDung: (meta: Record<string, unknown>) => "OK" | "NG" | "NTF";
    };

/** Giá trị cổng THẬT SỰ phải đo được HÔM NAY (dùng để `expect(...).toBe(...)`).
 *  `khangDinh` ⇒ chính giá trị khẳng định; `ghiNhanNoDaDuyet` ⇒ `hanhViHienTai`
 *  (giá trị được CHO PHÉP treo — KHÔNG PHẢI giá trị đúng). */
export function giaTriQuanSatDuoc(kv: KyVongOverallResult): "OK" | "NG" | "NTF" {
  return kv.dang === "khangDinh" ? kv.overallResult : kv.hanhViHienTai;
}

/** Giá trị ĐÚNG theo ngữ nghĩa — dùng để GHI trong thông điệp lỗi/báo cáo,
 *  KHÔNG dùng để assert trực tiếp (nếu không, một `ghiNhanNoDaDuyet` sẽ tự đỏ
 *  vì chính định nghĩa của nó là "nợ CHƯA vá"). */
export function giaTriDung(kv: KyVongOverallResult): "OK" | "NG" | "NTF" {
  return kv.dang === "khangDinh" ? kv.overallResult : kv.hanhViDung;
}

/** Verdict cho hình dạng ĐƯỢC SCHEMA CHẤP NHẬN — đo bằng SELECT sau commit
 *  THẬT (`aoiPackageHinhDangHopDongChoPhep.test.ts`), không bằng giá trị
 *  `caller.commit()` trả về (cùng kỷ luật Task 1). */
export interface KyVongChapNhan {
  loai: "chapNhan";
  /** `product_inspections.overallResult` / `inspection_packages.overallResult` kỳ vọng — xem `KyVongOverallResult`. */
  overallResult: KyVongOverallResult;
  /** BG-85 — `inspection_packages.totalPoints` kỳ vọng. Đếm CAPTURES (cấp gần
   *  nhất với "một điểm kiểm tra có ảnh" trong cây) — KHÔNG còn đếm "lá đo
   *  lường" của hợp đồng phẳng cũ (khái niệm đó không còn tồn tại). */
  tongDiem: number;
  /** `inspection_packages.okCount` kỳ vọng — số captures rolledResult==="OK". */
  ok: number;
  /** `inspection_packages.ngCount` kỳ vọng — số captures rolledResult==="NG". */
  ng: number;
}

/** Phân loại cho hình dạng BỊ SCHEMA TỪ CHỐI (`metaJsonSchema.safeParse` = false)
 *  — kỳ vọng là PHÂN LOẠI LỖI (vĩnh viễn/tạm thời), không phải verdict OK/NG/NTF. */
export interface KyVongTuChoi {
  loai: "tuChoi";
  /** `laLoiVinhVienDemVaoNguongDeadZip(error)` kỳ vọng — true = đếm vào ngưỡng 'dead'. */
  vinhVien: boolean;
}

export interface HinhDangMetaJson {
  /** Tên hiển thị, PHẢI duy nhất trong bảng — dùng làm tên `it()`. */
  ten: string;
  /** Vì sao hình dạng này nằm trong bảng — liên kết BG-xx/C-x, một câu. */
  lyDo: string;
  /** `meta.json` giả lập — đối tượng THẬT sẽ được `JSON.stringify` vào ZIP. */
  meta: Record<string, unknown>;
  kyVong: KyVongChapNhan | KyVongTuChoi;
  /** true = hình dạng này có thể CHỨNG MINH bằng SELECT là KHÔNG tồn tại
   *  trong DB test (mệnh đề 3 chống tự thoả) — phép chứng minh THẬT nằm ở
   *  file test tích hợp (SELECT), ở đây chỉ là lời khai CẦN được đo. */
  ungCuVienKhongTrongDbTest?: boolean;
}

/** `identity` tối thiểu hợp lệ — dùng chung cho mọi fixture cây bên dưới, tránh chép tay 7 trường mỗi lần. */
function identityToiThieu() {
  return {
    station: "HD-STATION", machine: "HD-MACHINE", line: "HD-LINE",
    plant: "HD-PLANT", country: "VN", solutionName: "HD-SOLUTION", appVersion: "1.0.0",
  };
}
/** Nhóm 4 chỉ số total/pass/ng/ntf — dùng cho `summary` (bốn nhóm surfaces/positions/captures/components). */
function nhom(total: number, pass: number, ng: number, ntf: number) {
  return { total, pass, ng, ntf };
}

/**
 * BG-85 — bảng hình dạng THUẦN (không fs/DB), viết LẠI HOÀN TOÀN theo hợp đồng
 * CÂY (`machineDataContractV2` + `images[]`). Phủ: (A) mọi trường `.optional()`
 * VẮNG MẶT (một nhánh THẬT, không mảng rỗng — coverage KHÔNG vacuous), (B) NTF
 * thật qua cờ `ntf` component, (C) hỗn hợp OK/NG nhiều capture, (D) hợp đồng
 * LỆCH HÌNH DẠNG (thiếu `surfaces`/`ntf`/`summary` bắt buộc — phân loại lỗi),
 * (E) varchar quá cỡ (một mình too_big ⇒ vĩnh viễn) VÀ trộn too_big+thiếu
 * trường (không đếm), (F) chuỗi ngày-giờ dài `.max(64)` vẫn được nhận (BG-91,
 * áp dụng ĐỀU cho cả bốn cấp thời gian trong hợp đồng cây — không riêng gốc).
 *
 * ⚠ Mẫu meta.json máy THẬT (BG-73) KHÔNG nằm trong bảng này — xem
 * `layHinhDangMauMayThat` bên dưới (đọc file LAZY).
 */
export const BANG_HINH_DANG: readonly HinhDangMetaJson[] = [
  // ── (A) mọi trường .optional() VẮNG MẶT — MỘT nhánh thật (không mảng rỗng) ──
  {
    ten: "toiThieuMoiTruongOptionalVangMat",
    lyDo:
      "BG-85 — payload TỐI THIỂU hợp lệ theo hợp đồng CÂY: type/apiKey/productModel/machineProductIndex/" +
      "startedAt/completedAt/images (gốc) VÀ captureName/index/componentName/value/lowerLimit/upperLimit/" +
      "errorCode/errorDesc/startedAt/completedAt (mọi cấp con) đều VẮNG MẶT trên MỘT nhánh THẬT (không phải " +
      "mảng rỗng — coverage cho `duongVangMat` không vacuous, xem docblock hàm đó).",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-TT",
      serialNumber: "HD-TT-SN",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(1, 1, 0, 0), positions: nhom(1, 1, 0, 0), captures: nhom(1, 1, 0, 0), components: nhom(1, 1, 0, 0) },
      surfaces: [{
        name: "TOP", result: "OK", ntf: false,
        positions: [{
          positionId: "P01", result: "OK", ntf: false,
          captures: [{
            captureId: "HD-TT-CAP-01", result: "OK", ntf: false,
            components: [{ componentId: "HD-TT-COMP-01", result: "OK", ntf: false }],
          }],
        }],
      }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "OK" }, tongDiem: 1, ok: 1, ng: 0 },
    ungCuVienKhongTrongDbTest: false, // hình dạng "tối thiểu" hợp lý có thể trùng dữ liệu test có sẵn
  },
  {
    ten: "ntfThatTuCoNguoiXacNhanChuaXacNhan",
    lyDo: "Cờ `ntf` THẬT tại lá (component) — không phải suy đoán từ result thiếu — phải cuộn NTF lên toàn cây (rollupVerdict, NG>NTF>OK) rồi verdictLuuTru đưa verdict lưu trữ về NTF dù overallResult khai OK.",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-NTF",
      serialNumber: "HD-NTF-SN",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(1, 0, 0, 1), positions: nhom(1, 0, 0, 1), captures: nhom(1, 0, 0, 1), components: nhom(1, 0, 0, 1) },
      surfaces: [{
        name: "TOP", result: "OK", ntf: true,
        positions: [{
          positionId: "P01", result: "OK", ntf: true,
          captures: [{
            captureId: "HD-NTF-CAP-01", result: "OK", ntf: true,
            components: [{ componentId: "HD-NTF-COMP-01", result: "OK", ntf: true }],
          }],
        }],
      }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NTF" }, tongDiem: 1, ok: 0, ng: 0 },
  },
  {
    ten: "honHopOkNgNhieuCapture",
    lyDo: "Hai capture trong CÙNG một gói, một OK một NG — cột báo cáo (totalPoints/okCount/ngCount, đếm CAPTURES) phải khớp overallResult (verdict cuộn từ cây) dù công thức đếm khác VỊ TRÍ mã.",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-HH",
      serialNumber: "HD-HH-SN",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(1, 0, 1, 0), positions: nhom(1, 0, 1, 0), captures: nhom(2, 1, 1, 0), components: nhom(2, 1, 1, 0) },
      surfaces: [{
        name: "TOP", result: "NG", ntf: false,
        positions: [{
          positionId: "P01", result: "NG", ntf: false,
          captures: [
            { captureId: "HD-HH-CAP-OK", result: "OK", ntf: false, components: [{ componentId: "HD-HH-COMP-OK", result: "OK", ntf: false }] },
            { captureId: "HD-HH-CAP-NG", result: "NG", ntf: false, components: [{ componentId: "HD-HH-COMP-NG", result: "NG", ntf: false }] },
          ],
        }],
      }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 2, ok: 1, ng: 1 },
  },
  {
    ten: "capGoiThatKemImagesJoinDungCaptureId",
    lyDo:
      "★★★ BG-85 — kịch bản CỐT LÕI của chuẩn gói ảnh: cây ĐẦY ĐỦ + `images[]` " +
      "tham chiếu ĐÚNG `captureId` có trong cây (khoá join, §4 chuẩn gói ảnh), " +
      "MỖI ảnh mang cả `captureName`/`sha256` (hai trường optional còn lại của " +
      "ImageRef — census 'đủ đường .optional()' cần MỘT hình dạng chứng minh " +
      "chúng CÓ MẶT, không chỉ vắng mặt ở hình dạng tối thiểu).",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-IMG",
      serialNumber: "HD-IMG-SN",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(1, 1, 0, 0), positions: nhom(1, 1, 0, 0), captures: nhom(1, 1, 0, 0), components: nhom(1, 1, 0, 0) },
      surfaces: [{
        name: "TOP", result: "OK", ntf: false,
        positions: [{
          positionId: "P01", result: "OK", ntf: false,
          captures: [{ captureId: "HD-IMG-CAP-01", result: "OK", ntf: false, components: [{ componentId: "HD-IMG-COMP-01", result: "OK", ntf: false }] }],
        }],
      }],
      images: [{ captureId: "HD-IMG-CAP-01", fileName: "top-p01-default.jpg", captureName: "Default", sha256: "a".repeat(64) }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "OK" }, tongDiem: 1, ok: 1, ng: 0 },
  },

  // ── (B) Đ-21 (worse-wins) đo LẠI trên hợp đồng CÂY, cả hai chiều ─────────
  {
    ten: "cayRongVaLoiKhaiNgThang_D21_chieuThuan",
    lyDo: "Đ-21 (chiều thuận) — surfaces:[] RỖNG (cuộn=OK, mảng RỖNG là hợp lệ theo `machineDataContractV2`) nhưng overallResult khai 'NG' ⇒ verdictXauHon(khai, cuộn) phải lấy XẤU HƠN ⇒ NG — lời khai cấp bo KHÔNG được cuộn rỗng làm nhẹ đi.",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-D21A",
      serialNumber: "HD-D21A-SN",
      overallResult: "NG",
      ntf: false,
      summary: { surfaces: nhom(0, 0, 0, 0), positions: nhom(0, 0, 0, 0), captures: nhom(0, 0, 0, 0), components: nhom(0, 0, 0, 0) },
      surfaces: [],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 0, ok: 0, ng: 0 },
  },
  {
    ten: "cuonTuCayNangHonLoiKhaiOk_D21_chieuNguoc",
    lyDo: "Đ-21 (chiều ngược) — lời khai overallResult:'OK' KHÔNG được phép làm NHẸ một cuộn cây có NG thật (bo TỐT giả — máy khai OK nhưng dữ liệu thật NG).",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-D21B",
      serialNumber: "HD-D21B-SN",
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(1, 0, 1, 0), positions: nhom(1, 0, 1, 0), captures: nhom(1, 0, 1, 0), components: nhom(1, 0, 1, 0) },
      surfaces: [{
        name: "TOP", result: "NG", ntf: false,
        positions: [{
          positionId: "P01", result: "NG", ntf: false,
          captures: [{ captureId: "HD-D21B-CAP-01", result: "NG", ntf: false, components: [{ componentId: "HD-D21B-COMP-01", result: "NG", ntf: false }] }],
        }],
      }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 1, ok: 0, ng: 1 },
  },

  // ── (C) Hợp đồng LỆCH HÌNH DẠNG — phân loại lỗi (mệnh đề 2) ──────────────
  {
    ten: "hopDongThieuSurfacesBatBuoc",
    lyDo:
      "★★★ BG-85 — hình dạng PHẲNG cũ (`measurements[]`/`points[]`, không `surfaces`) — chính hình dạng đã " +
      "sinh ra 262 gói `committed` hiện có — KHÔNG còn parse được qua hợp đồng hợp nhất (thiếu `surfaces`/" +
      "`ntf`/`summary`/`identity` bắt buộc). ZodError nhiều issue `invalid_type` (KHÔNG chỉ `too_big`) ⇒ " +
      "KHÔNG đếm vĩnh viễn — gói ở lại 'failed', retry được, KHÔNG khoá 'dead' (Bước 6, đường di trú).",
    meta: {
      serialNumber: "HD-PHANG-SN",
      productModel: "HD-PHANG-PM",
      measurements: [{ fileName: "phang-1.jpg", result: "NG" }],
      // KHÔNG có `surfaces`/`ntf`/`summary`/`identity`/`productId` — hình dạng phẳng cũ.
    },
    kyVong: { loai: "tuChoi", vinhVien: false },
    ungCuVienKhongTrongDbTest: true,
  },
  {
    ten: "varcharQuaCoChiMotLoiToCo",
    lyDo: "Đối chứng phân loại VĨNH VIỄN thật trên CHÍNH metaJsonSchema: serialNumber vượt .max(100) ⇒ MỘT issue too_big duy nhất ⇒ đếm vào ngưỡng dead (đúng lý do BG-64 — quá cỡ không sửa được bằng retry). Mọi trường bắt buộc KHÁC đều hợp lệ, để lỗi too_big là issue DUY NHẤT.",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-QC",
      serialNumber: "S".repeat(150),
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(0, 0, 0, 0), positions: nhom(0, 0, 0, 0), captures: nhom(0, 0, 0, 0), components: nhom(0, 0, 0, 0) },
      surfaces: [],
    },
    kyVong: { loai: "tuChoi", vinhVien: true },
  },
  {
    ten: "tronLoiToCoVaLechHinhDang",
    lyDo: "Đối chứng TRỘN: serialNumber quá cỡ (too_big) VÀ `identity` vắng (invalid_type, bắt buộc) trong CÙNG một lượt parse ⇒ KHÔNG PHẢI toàn bộ too_big ⇒ KHÔNG đếm (tạm thời) — payload này còn SỬA ĐƯỢC (thiếu một trường), không phải 'không bao giờ vừa cột'.",
    meta: {
      productId: "HD-PID-TRON",
      serialNumber: "S".repeat(150),
      overallResult: "OK",
      ntf: false,
      summary: { surfaces: nhom(0, 0, 0, 0), positions: nhom(0, 0, 0, 0), captures: nhom(0, 0, 0, 0), components: nhom(0, 0, 0, 0) },
      surfaces: [],
      // KHÔNG có `identity` (bắt buộc).
    },
    kyVong: { loai: "tuChoi", vinhVien: false },
  },
  {
    ten: "ngayGioDaiThatDuocNhanOMoiCap_BG91",
    lyDo:
      "★★★ BG-91 — `DateTime.ToString()` mặc định của Agent C# dài tới 50 ký tự vẫn là ngày hợp lệ " +
      "(`new Date()` parse được). Hợp đồng CÂY áp `.max(64)` ĐỀU cho `startedAt`/`completedAt` ở CẢ BỐN cấp " +
      "(gốc/position/capture/component, xem `machineDataContractV2.ts` 'Vòng sửa 3') — hình dạng này khẳng " +
      "định chuỗi dài đó ĐƯỢC NHẬN ở cấp GỐC, gói commit THÀNH CÔNG ngay lượt đầu.",
    meta: {
      identity: identityToiThieu(),
      productId: "HD-PID-DT50",
      serialNumber: "HD-DT50-SN",
      overallResult: "OK",
      ntf: false,
      startedAt: "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)", // 50 ký tự, new Date() parse được
      summary: { surfaces: nhom(0, 0, 0, 0), positions: nhom(0, 0, 0, 0), captures: nhom(0, 0, 0, 0), components: nhom(0, 0, 0, 0) },
      surfaces: [],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "OK" }, tongDiem: 0, ok: 0, ng: 0 },
    ungCuVienKhongTrongDbTest: true,
  },
] as const;

// ════════════════════════════════════════════════════════════════════════════
// Mẫu meta.json máy THẬT (BG-73) — tách riêng vì cần đọc file, LAZY.
// ════════════════════════════════════════════════════════════════════════════
const DUONG_DAN_MAU_MAY_THAT = "D:\\SOURCES\\AOIData\\aoipackage-meta-sample.json";

/**
 * Trả về hình dạng máy THẬT — ĐỌC FILE tại thời điểm GỌI (không phải lúc
 * import module này), cùng kỷ luật `aoiPackageZipHinhDangMayThat.test.ts`
 * (Task 2): một môi trường không có ổ `D:\SOURCES\AOIData` sẽ chỉ làm ĐÚNG
 * các test cần tệp này thất bại rõ ràng, không kéo sập toàn bộ file import nó.
 */
export function layHinhDangMauMayThat(): HinhDangMetaJson {
  const meta = JSON.parse(readFileSync(DUONG_DAN_MAU_MAY_THAT, "utf8"));
  return {
    ten: "mauMetaJsonMayThat_BG73",
    lyDo:
      "BG-73/BG-85 ⛔ — mẫu meta.json THẬT của máy AOI (images[] + các trường gốc phẳng: serialNumber/" +
      "productModel/overallResult/startedAt/completedAt — KHÔNG hề có cây surfaces[]/ntf/summary/identity). " +
      "TRƯỚC BG-85: ZodError một issue invalid_type (thiếu measurements, hợp đồng phẳng cũ). SAU BG-85: " +
      "ZodError NHIỀU issue invalid_type (thiếu ntf/summary/surfaces — hợp đồng cây) — CÙNG KẾT LUẬN " +
      "(KHÔNG đếm vào ngưỡng dead, laLoiVinhVienDemVaoNguongDeadZip), KHÁC LÝ DO: hợp nhất hợp đồng KHÔNG " +
      "làm mẫu máy thật tệ hơn (vẫn 'failed' vô thời hạn, retry vẫn mở) — xem baseline Bước 1, báo cáo BG-85.",
    meta,
    kyVong: { loai: "tuChoi", vinhVien: false },
    ungCuVienKhongTrongDbTest: true,
  };
}

/**
 * Phân loại lỗi THẬT cho một hình dạng `tuChoi` — helper dùng chung giữa
 * census thuần (`hinhDangHopDongMetaJson.test.ts`) và cổng tích hợp
 * (`aoiPackageHinhDangHopDongChoPhep.test.ts`), tránh viết lại `safeParse` +
 * tạo `ZodError` hai lần.
 */
export function phanLoaiTuChoi(hinhDang: HinhDangMetaJson): { thanhCong: boolean; vinhVien: boolean | null } {
  const r = metaJsonSchema.safeParse(hinhDang.meta);
  if (r.success) return { thanhCong: true, vinhVien: null };
  const err = r.error as ZodError;
  return { thanhCong: false, vinhVien: laLoiVinhVienDemVaoNguongDeadZip(err) };
}

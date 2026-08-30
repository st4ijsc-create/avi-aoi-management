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
 */
export type KyVongOverallResult =
  | { dang: "khangDinh"; overallResult: "OK" | "NG" | "NTF" }
  | {
      dang: "ghiNhanNoDaDuyet";
      /** Giá trị cổng ĐO ĐƯỢC hôm nay — cổng so khớp cái NÀY (giữ xanh). */
      hanhViHienTai: "OK" | "NG" | "NTF";
      /** Giá trị ĐÚNG theo ngữ nghĩa — KHÔNG dùng để assert, chỉ để khai rõ khoảng cách. */
      hanhViDung: "OK" | "NG" | "NTF";
      /** Mã backlog theo dõi nợ này — dạng "BG-NN", ví dụ "BG-77". */
      maBacklog: string;
      /** Ai/ở đâu đã duyệt treo nợ này — một câu, trích dẫn được. */
      lyDoDuyet: string;
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
  /** `inspection_packages.totalPoints` kỳ vọng (đếm MỌI lá, kể cả lá thiếu result). */
  tongDiem: number;
  /** `inspection_packages.okCount` kỳ vọng. */
  ok: number;
  /** `inspection_packages.ngCount` kỳ vọng. */
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

/**
 * Mười hình dạng THUẦN (không fs/DB) — phủ cả năm hạng mục brief Task 4 yêu
 * cầu tối thiểu, cộng thêm các ca chống-hồi-quy Đ-21/BG-68 trên CHÍNH cửa ZIP
 * (khác `machineDataContractV2`/`submitInspectionCoreObject`, nơi Đ-21 đã
 * được đóng ở Pha 1C/1E — bảng này đo LẠI trên `metaJsonSchema`, đường
 * KHÔNG được hai pha đó chạm tới theo cùng bộ test).
 *
 * ⚠ Mẫu meta.json máy THẬT (BG-73) KHÔNG nằm trong bảng này — nó cần đọc
 * file (`layHinhDangMauMayThat`, bên dưới) nên tách riêng để KHÔNG buộc mọi
 * import của bảng này phụ thuộc một đường dẫn tuyệt đối chỉ tồn tại trên máy
 * có ổ `D:\SOURCES\AOIData`.
 */
export const BANG_HINH_DANG: readonly HinhDangMetaJson[] = [
  // ── (A) BG-78 — mọi trường .optional() VẮNG MẶT ─────────────────────────
  {
    ten: "toiThieuMoiTruongOptionalVangMat",
    lyDo: "C-1/BG-78 — payload TỐI THIỂU hợp lệ: overallResult, mọi trường phân cấp, VÀ result của lá đều VẮNG MẶT. Lá thiếu result KHÔNG được sinh phán quyết nào (Task 1).",
    meta: {
      serialNumber: "HD-TT-SN",
      productModel: "HD-TT-PM",
      measurements: [{ fileName: "tt-1.jpg" }], // KHÔNG result/pointId/pointCode/code/name/measuredValue/value/unit/remark
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "OK" }, tongDiem: 1, ok: 0, ng: 0 },
    ungCuVienKhongTrongDbTest: false, // hình dạng "tối thiểu" hợp lý là có thể trùng với dữ liệu test có sẵn — không dùng làm bằng chứng "không có trong DB test"
  },
  {
    ten: "ntfThatChongSietNguoc",
    lyDo: "BG-78 mệnh đề 2 — lá khai NTF THẬT (không phải thiếu result) vẫn phải cuộn NTF, không được bản vá vá quá tay.",
    meta: {
      serialNumber: "HD-NTF-SN",
      productModel: "HD-NTF-PM",
      overallResult: "NTF",
      measurements: [{ fileName: "ntf-1.jpg", result: "NTF" }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NTF" }, tongDiem: 1, ok: 0, ng: 0 },
  },
  {
    ten: "honHopBaLoaiKetQuaTrongMotGoi",
    lyDo: "Tổ hợp OK + NG + lá-thiếu-result trong CÙNG một gói — calculatedSummary (báo cáo) phải khớp overallResult (verdict) dù công thức đếm khác nhau về mặt VỊ TRÍ mã (Task 1 mệnh đề 4).",
    meta: {
      serialNumber: "HD-HH-SN",
      productModel: "HD-HH-PM",
      measurements: [
        { fileName: "hh-1.jpg", result: "OK" },
        { fileName: "hh-2.jpg", result: "NG" },
        { fileName: "hh-3.jpg" }, // thiếu result
      ],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 3, ok: 1, ng: 1 },
  },

  // ── (B) Bí danh cũ points[] thay measurements[] — BG-77 (CHƯA SỬA, deferred sau Pha 1F) ──
  {
    ten: "biDanhPointsRongThayMeasurements_BG77",
    lyDo:
      "★ BG-77 (backlog toàn cảnh §3, GHI RÕ 'còn mở SAU Pha 1F' — KHÔNG sửa trong task này, chủ dự án " +
      "đã DUYỆT treo qua kế hoạch Pha 1F). `measurements: []` (mảng RỖNG nhưng CÓ MẶT, vì measurements " +
      "KHÔNG .optional()) cùng `points[]` mang dữ liệu NG thật. Biểu thức SẢN XUẤT " +
      "`metaData?.measurements || metaData?.points || []` chọn `measurements` vì MẢNG RỖNG LÀ TRUTHY " +
      "trong JS — `points[]` bị bỏ qua HOÀN TOÀN dù có dữ liệu NG. `kyVong.overallResult` dùng " +
      "`ghiNhanNoDaDuyet` (KHÔNG `khangDinh`) — cổng GHI NHẬN hành vi hiện tại (OK) là nợ ĐÃ DUYỆT treo, " +
      "KHÔNG khẳng định đó là đúng; `hanhViDung` khai rõ giá trị ngữ nghĩa đúng (NG). Nếu BG-77 được vá " +
      "sau này, hàng SELECT sẽ tự lệch khỏi `hanhViHienTai` và ca này tự ĐỎ — đúng lúc đó đổi biến thể " +
      "sang `khangDinh` (không phải một 'lý do' viết sẵn không ai kiểm — bài học `ntfSource`/BG-91).",
    meta: {
      serialNumber: "HD-BG77-SN",
      productModel: "HD-BG77-PM",
      measurements: [],
      points: [{ code: "P1", fileName: "bg77-1.jpg", result: "NG" }],
    },
    kyVong: {
      loai: "chapNhan",
      overallResult: {
        dang: "ghiNhanNoDaDuyet",
        hanhViHienTai: "OK",
        hanhViDung: "NG",
        maBacklog: "BG-77",
        lyDoDuyet: "docs/superpowers/specs/2026-08-31-aoi-backlog-toan-canh.md §3 + plan Pha 1F 'Còn mở sau Pha 1F: … BG-77'",
      },
      tongDiem: 0, ok: 0, ng: 0,
    },
    ungCuVienKhongTrongDbTest: true,
  },

  // ── (C) Mảng RỖNG ở mọi cấp — Đ-21 (đã đóng ở Pha 1C cho verdictXauHon, đo LẠI trên metaJsonSchema/cửa ZIP) ──
  {
    ten: "mangRongVaLoiKhaiNgThang_D21_chieuThuan",
    lyDo: "Đ-21 (chiều thuận, cửa ZIP) — measurements RỖNG (cuộn=OK) nhưng overallResult khai 'NG' ⇒ XẤU HƠN phải thắng ⇒ NG. Trước Pha 1C: lời khai 'OK' có thể LÀM NHẸ một cuộn tệ hơn — đây là chiều NGƯỢC, chống hồi quy cho chiều 'lời khai làm NẶNG lên'.",
    meta: {
      serialNumber: "HD-D21A-SN",
      productModel: "HD-D21A-PM",
      overallResult: "NG",
      measurements: [],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 0, ok: 0, ng: 0 },
  },
  {
    ten: "cuonTuMeasurementsNangHonLoiKhaiOk_D21_chieuNguoc",
    lyDo: "Đ-21 (chiều ngược) — lời khai overallResult:'OK' KHÔNG được phép làm nhẹ một cuộn measurements[] có NG thật. Đúng lớp lỗi gốc Đ-21/Đ-22 (bo TỐT giả — máy khai OK nhưng dữ liệu thật NG).",
    meta: {
      serialNumber: "HD-D21B-SN",
      productModel: "HD-D21B-PM",
      overallResult: "OK",
      measurements: [{ fileName: "d21b-1.jpg", result: "NG" }],
    },
    kyVong: { loai: "chapNhan", overallResult: { dang: "khangDinh", overallResult: "NG" }, tongDiem: 1, ok: 0, ng: 1 },
  },

  // ── (D) Hợp đồng LỆCH HÌNH DẠNG — phân loại lỗi (mệnh đề 2) ──────────────
  {
    ten: "hopDongCuChiCoPointsKhongCoMeasurements",
    lyDo:
      "★★★ PHÁT HIỆN MỚI của cổng này — 'points[] tương thích ngược' (comment tại chỗ khai schema: " +
      "'Legacy fields (backward compatible)') KHÔNG thật sự tương thích: `measurements` là trường BẮT BUỘC " +
      "(không `.optional()`), nên một máy CŨ chỉ gửi `points[]` (không gửi `measurements` — kể cả mảng rỗng) " +
      "KHÔNG BAO GIỜ qua được `metaJsonSchema.parse()`. Cùng LỚP LỖI BG-73 (ZodError lệch hình dạng) nhưng " +
      "KHÁC NGUYÊN NHÂN — chưa có mã BG riêng, xem 'mối lo' trong báo cáo Task 4.",
    meta: {
      serialNumber: "HD-PTSONLY-SN",
      productModel: "HD-PTSONLY-PM",
      points: [{ code: "P1", fileName: "ptsonly-1.jpg", result: "NG" }],
      // KHÔNG có `measurements` — kể cả mảng rỗng.
    },
    kyVong: { loai: "tuChoi", vinhVien: false },
    ungCuVienKhongTrongDbTest: true,
  },
  {
    ten: "varcharQuaCoChiMotLoiToCo",
    lyDo: "Đối chứng phân loại VĨNH VIỄN thật trên CHÍNH metaJsonSchema (Task 2's §1 dùng schema TỔNG HỢP riêng cho ca này — đây là ca THẬT trên schema production): serialNumber vượt .max(100) ⇒ MỘT issue too_big duy nhất ⇒ đếm vào ngưỡng dead (đúng lý do BG-64 — quá cỡ không sửa được bằng retry).",
    meta: {
      serialNumber: "S".repeat(150),
      productModel: "HD-QC-PM",
      measurements: [{ fileName: "qc-1.jpg" }],
    },
    kyVong: { loai: "tuChoi", vinhVien: true },
  },
  {
    ten: "tronLoiToCoVaLechHinhDang",
    lyDo: "Đối chứng TRỘN (Task 2's §1 dùng schema riêng — đây là ca THẬT): serialNumber quá cỡ (too_big) VÀ productModel vắng (invalid_type, bắt buộc) trong CÙNG một lượt parse ⇒ KHÔNG PHẢI toàn bộ too_big ⇒ KHÔNG đếm (tạm thời) — payload này còn SỬA ĐƯỢC (thiếu một trường), không phải 'không bao giờ vừa cột'.",
    meta: {
      serialNumber: "S".repeat(150),
      measurements: [{ fileName: "tron-1.jpg" }],
      // KHÔNG có productModel (bắt buộc).
    },
    kyVong: { loai: "tuChoi", vinhVien: false },
  },
  {
    ten: "ngayGioDaiThatDuocNhanOCuaZip_BG91_daVa",
    lyDo:
      "★★★ BG-91 — cổng này TỰ PHÁT HIỆN lỗ này lần đầu (BG-72 chỉ được vá ở đường v1.x, " +
      "`submitInspectionCoreObject.inspectionTime`/`.serverReceivedAt` .max(40)→.max(64); cửa ZIP " +
      "`metaJsonSchema.inspectionTime` CÒN NGUYÊN .max(40) — cùng chuỗi DateTime.ToString() 50 ký tự bị " +
      "TỪ CHỐI ở ZIP trong khi v1.x đã nhận, và bị đếm VĨNH VIỄN (too_big) ⇒ khoá 'dead' sau N lượt, " +
      "NẶNG HƠN BG-73). Đã VÁ ở `6082df2f` (`.max(40)`→`.max(64)` tại `metaJsonSchema.inspectionTime`, " +
      "cùng con số/lý lẽ v1.x) — xem `aoiPackageZipInspectionTimeDaiThat.test.ts` (Task 2, 5 ca). " +
      "Hình dạng này giờ KHẲNG ĐỊNH (`khangDinh`, không phải ghi nhận) hành vi ĐÚNG: chuỗi 50 ký tự " +
      "ĐƯỢC CHẤP NHẬN, gói commit THÀNH CÔNG ngay lượt đầu, KHÔNG hề chạm 'failed'/'dead'. " +
      "★ BÀI HỌC ĐÃ TRẢ GIÁ (2026-08-30): trước bản sửa NÀY, hình dạng này mã hoá HÀNH VI CŨ (bị từ chối) " +
      "làm kỳ vọng — khi BG-91 được vá, cổng ĐỎ và trông giống một hồi quy do bản vá gây ra, trong khi " +
      "thực ra cổng đang bắt ĐÚNG một hành vi giờ đã đổi. `KyVongOverallResult.khangDinh` chỉ nên dùng " +
      "cho hành vi ĐÃ XÁC NHẬN đúng — không phải 'hôm nay nó đang chạy vậy'.",
    meta: {
      serialNumber: "HD-DT50-SN",
      productModel: "HD-DT50-PM",
      measurements: [{ fileName: "dt50-1.jpg" }],
      inspectionTime: "Sun Aug 30 2026 14:26:51 GMT+0700 (Indochina Time)", // 50 ký tự, new Date() parse được — ĐƯỢC CHẤP NHẬN sau 6082df2f (.max(64))
    },
    kyVong: {
      loai: "chapNhan",
      overallResult: { dang: "khangDinh", overallResult: "OK" },
      tongDiem: 1, ok: 0, ng: 0,
    },
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
      "BG-73 ⛔ — mẫu meta.json THẬT của máy AOI (images[], KHÔNG measurements[]/points[]). " +
      "ZodError một issue invalid_type (thiếu measurements) ⇒ KHÔNG đếm vào ngưỡng dead " +
      "(laLoiVinhVienDemVaoNguongDeadZip, Task 2) — gói ở lại 'failed' vô thời hạn, retry vẫn mở.",
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

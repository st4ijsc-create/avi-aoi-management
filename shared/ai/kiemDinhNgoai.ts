/**
 * Đợt 10.4 (T2) — HỢP ĐỒNG KẾT QUẢ KIỂM ĐỊNH của AI NGOÀI: MỘT nguồn duy nhất cho máy chủ (node `ai.kiem-dinh-ngoai`, thủ tục `aiKiemDinh.chay`) và client
 * (hộp kết quả). Kế hoạch: `docs/superpowers/plans/2026-10-27-dot10-4-kiem-dinh-ngoai.md` §D2.
 *
 * ⚠ ĐẦU RA CỦA AI NGOÀI LÀ DỮ LIỆU KHÔNG TIN CẬY. Hàm này là cửa kiểm DUY NHẤT: làm sạch (ký tự điều khiển / bidi / zero-width; NFKC chỉ cho trường NGẮN,
 * `banChuanHoa` là MÃ ⇒ NFC — NFKC đổi ligature / toàn-độ-rộng / số mũ ⇒ bản chuẩn hoá sai) RỒI kiểm `.strict()` (khoá lạ, `__proto__`, `constructor` ⇒ sai),
 * trần từng trường, luật nội tại (`dat` mà có lỗi `nghiem-trong` ⇒ sai), tổng ≤ 64 KB. Vượt trần ⇒ SAI (không cắt âm thầm — lời nhắc thử lại bảo model viết ngắn lại).
 * Chuỗi `loi` trả về đi vào lời nhắc thử lại (tối đa 1 lần — bên gọi quyết).
 */
import { z } from "zod";

export const KET_LUAN_KIEM_DINH = ["dat", "can-sua", "sai"] as const;
export const MUC_LOI_KIEM_DINH = ["nghiem-trong", "vua", "nhe"] as const;
export const PHAM_VI_BAI_HOC = ["nguoi", "du-an", "nha-may"] as const;

/** Trần (ký tự UTF-16 sau làm sạch). */
export const TRAN_KIEM_DINH = Object.freeze({
  banChuanHoa: 20_000,
  moTaLoi: 500,
  viTri: 200,
  soLoi: 20,
  noiDungBaiHoc: 500,
  viDuBaiHoc: 1000,
  soBaiHoc: 5,
  tongByte: 64 * 1024,
});

export type KetLuanKiemDinh = (typeof KET_LUAN_KIEM_DINH)[number];
export type MucLoiKiemDinh = (typeof MUC_LOI_KIEM_DINH)[number];
export type PhamViBaiHoc = (typeof PHAM_VI_BAI_HOC)[number];

export interface KetQuaKiemDinh {
  ketLuan: KetLuanKiemDinh;
  diem: number;
  banChuanHoa?: string;
  loi: Array<{ muc: MucLoiKiemDinh; moTa: string; viTri?: string }>;
  baiHocDeXuat: Array<{ noiDung: string; phamVi: PhamViBaiHoc; viDu?: string }>;
}

// ─── làm sạch ─────────────────────────────────────────────────────────────────────────────────────────

/** Điều khiển C0/DEL (giữ \t \n \r ở trường mã), C1, bidi override/isolate, zero-width, BOM. */
const RE_BIDI_ZW = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029\u00AD]/g;
// eslint-disable-next-line no-control-regex
const RE_DIEU_KHIEN_MA = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
// eslint-disable-next-line no-control-regex
const RE_DIEU_KHIEN_NGAN = /[\u0000-\u001F\u007F-\u009F]/g;

/** Trường NGẮN hiển thị: bỏ điều khiển (xuống dòng/tab ⇒ khoảng trắng), bidi, zero-width; NFKC; gộp khoảng trắng; cắt hai đầu. */
export function lamSachChuNgan(s: string): string {
  return s.replace(RE_BIDI_ZW, "").replace(/[\t\n\r]+/g, " ").replace(RE_DIEU_KHIEN_NGAN, "").normalize("NFKC").replace(/ {2,}/g, " ").trim();
}

/** Trường MÃ (`banChuanHoa`): bỏ điều khiển (giữ \t \n \r), bidi, zero-width; NFC (KHÔNG NFKC). */
export function lamSachMa(s: string): string {
  return s.replace(RE_BIDI_ZW, "").replace(RE_DIEU_KHIEN_MA, "").normalize("NFC");
}

/** Hiển thị: ký tự ngoài ASCII in được ⇒ `\uXXXX` (tránh lừa mắt bằng đồng chữ / ký tự vô hình). Cặp thay thế (emoji…) thoát từng đơn vị. */
export function thoatKyTuLa(s: string): string {
  let ra = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    ra += c >= 0x20 && c <= 0x7e ? s[i] : "\\u" + c.toString(16).toUpperCase().padStart(4, "0");
  }
  return ra;
}

// ─── schema ───────────────────────────────────────────────────────────────────────────────────────────

const ngan = (tran: number) => z.string().transform(lamSachChuNgan).pipe(z.string().min(1).max(tran));
const nganTuyChon = (tran: number) => z.string().transform(lamSachChuNgan).pipe(z.string().max(tran));

const SchemaLoi = z
  .object({
    muc: z.enum(MUC_LOI_KIEM_DINH),
    moTa: ngan(TRAN_KIEM_DINH.moTaLoi),
    viTri: nganTuyChon(TRAN_KIEM_DINH.viTri).optional(),
  })
  .strict();

const SchemaBaiHoc = z
  .object({
    noiDung: ngan(TRAN_KIEM_DINH.noiDungBaiHoc),
    phamVi: z.enum(PHAM_VI_BAI_HOC),
    viDu: nganTuyChon(TRAN_KIEM_DINH.viDuBaiHoc).optional(),
  })
  .strict();

export const SchemaKetQuaKiemDinh = z
  .object({
    ketLuan: z.enum(KET_LUAN_KIEM_DINH),
    diem: z.number().int().min(0).max(100),
    banChuanHoa: z.string().transform(lamSachMa).pipe(z.string().max(TRAN_KIEM_DINH.banChuanHoa)).optional(),
    loi: z.array(SchemaLoi).max(TRAN_KIEM_DINH.soLoi),
    baiHocDeXuat: z.array(SchemaBaiHoc).max(TRAN_KIEM_DINH.soBaiHoc),
  })
  .strict();

// ─── trích JSON từ văn bản model ─────────────────────────────────────────────────────────────────────

/** Lấy đối tượng JSON ĐẦU TIÊN (cân bằng ngoặc, tôn trọng chuỗi) trong văn bản — bỏ hàng rào ```json … ``` và lời dẫn. Không có ⇒ undefined. */
export function trichDoiTuongJson(text: string): string | undefined {
  const t = text.trim();
  const bat = t.indexOf("{");
  if (bat < 0) return undefined;
  let sau = 0;
  let trongChuoi = false;
  let thoat = false;
  for (let i = bat; i < t.length; i++) {
    const c = t[i];
    if (trongChuoi) {
      if (thoat) thoat = false;
      else if (c === "\\") thoat = true;
      else if (c === '"') trongChuoi = false;
      continue;
    }
    if (c === '"') trongChuoi = true;
    else if (c === "{") sau++;
    else if (c === "}") {
      sau--;
      if (sau === 0) return t.slice(bat, i + 1);
    }
  }
  return undefined;
}

export type KetQuaParseKiemDinh = { ok: true; data: KetQuaKiemDinh } | { ok: false; loi: string };

/**
 * Tóm lỗi zod cho LỜI NHẮC THỬ LẠI gửi lại AI ngoài. ⚠ CHỈ đường dẫn + mã lỗi CỐ ĐỊNH + hằng của schema (trần, tập giá trị hợp lệ): KHÔNG BAO GIỜ phản chiếu
 * giá trị / tên khoá do MODEL viết (message mặc định của zod có "received '…'", "Unrecognized key(s): '…'") — đó là kênh tiêm lời nhắc (rà kiem-dinh T2).
 */
function tomLoi(e: z.ZodError): string {
  const ds = e.issues.slice(0, 6).map((i) => {
    const duong = i.path.length ? i.path.map((p) => (typeof p === "number" ? String(p) : String(p).replace(/[^A-Za-z0-9_]/g, "?").slice(0, 40))).join(".") : "(gốc)";
    let nd: string;
    switch (i.code) {
      case "invalid_type":
        nd = "sai kiểu (cần " + String((i as { expected?: unknown }).expected).replace(/[^a-z]/g, "") + ")";
        break;
      case "invalid_value" as string: // zod 4 (`values`)
      case "invalid_enum_value" as string: // zod 3 (`options`)
        nd = "giá trị không thuộc tập cho phép: " + ((i as { values?: unknown[]; options?: unknown[] }).values ?? (i as { options?: unknown[] }).options ?? []).map((o) => String(o).replace(/[^a-z-]/g, "")).join("|");
        break;
      case "unrecognized_keys":
        nd = "có khoá không được phép";
        break;
      case "too_big":
        nd = "vượt trần (tối đa " + Number((i as { maximum?: unknown }).maximum) + ")";
        break;
      case "too_small":
        nd = "quá ngắn/nhỏ (tối thiểu " + Number((i as { minimum?: unknown }).minimum) + ")";
        break;
      default:
        nd = "giá trị không hợp lệ";
    }
    return duong + ": " + nd;
  });
  return ds.join("; ").slice(0, 600);
}

/**
 * CỬA KIỂM DUY NHẤT. `raw` là đối tượng đã parse HOẶC văn bản thô của model (có thể kèm hàng rào/lời dẫn).
 * ok ⇒ `data` đã LÀM SẠCH. Không ném.
 */
export function parseKetQuaKiemDinh(raw: unknown): KetQuaParseKiemDinh {
  let v: unknown = raw;
  if (typeof raw === "string") {
    const j = trichDoiTuongJson(raw);
    if (j === undefined) return { ok: false, loi: "không tìm thấy đối tượng JSON trong câu trả lời" };
    try {
      v = JSON.parse(j);
    } catch (e) {
      void e; // KHÔNG phản chiếu message của JSON.parse (chứa đoạn văn bản của model)
      return { ok: false, loi: "JSON không hợp lệ (lỗi cú pháp)" };
    }
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, loi: "phải là một đối tượng JSON" };
  const kq = SchemaKetQuaKiemDinh.safeParse(v);
  if (!kq.success) return { ok: false, loi: tomLoi(kq.error) };
  const data = kq.data as KetQuaKiemDinh;
  if (data.ketLuan === "dat" && data.loi.some((l) => l.muc === "nghiem-trong")) {
    return { ok: false, loi: "mâu thuẫn: ketLuan='dat' nhưng có lỗi mức 'nghiem-trong'" };
  }
  const byte = new TextEncoder().encode(JSON.stringify(data)).length;
  if (byte > TRAN_KIEM_DINH.tongByte) return { ok: false, loi: `kết quả quá lớn (${byte} byte > ${TRAN_KIEM_DINH.tongByte})` };
  return { ok: true, data };
}

/** Mô tả định dạng cho LỜI NHẮC gửi AI ngoài (một chỗ — node và thủ tục dùng chung). */
export const MO_TA_DINH_DANG_KIEM_DINH = [
  "Trả về ĐÚNG MỘT đối tượng JSON, không văn bản khác, với các khoá (không thêm khoá nào khác):",
  '  "ketLuan": "dat" | "can-sua" | "sai"',
  '  "diem": số nguyên 0..100',
  `  "banChuanHoa": (tuỳ chọn) chuỗi, bản đã sửa/chuẩn hoá, tối đa ${TRAN_KIEM_DINH.banChuanHoa} ký tự`,
  `  "loi": mảng tối đa ${TRAN_KIEM_DINH.soLoi} phần tử { "muc": "nghiem-trong"|"vua"|"nhe", "moTa": chuỗi ≤ ${TRAN_KIEM_DINH.moTaLoi}, "viTri": (tuỳ chọn) chuỗi ≤ ${TRAN_KIEM_DINH.viTri} }`,
  `  "baiHocDeXuat": mảng tối đa ${TRAN_KIEM_DINH.soBaiHoc} phần tử { "noiDung": chuỗi ≤ ${TRAN_KIEM_DINH.noiDungBaiHoc}, "phamVi": "nguoi"|"du-an"|"nha-may", "viDu": (tuỳ chọn) chuỗi ≤ ${TRAN_KIEM_DINH.viDuBaiHoc} }`,
  `Nếu ketLuan là "dat" thì KHÔNG được có lỗi mức "nghiem-trong".`,
].join("\n");

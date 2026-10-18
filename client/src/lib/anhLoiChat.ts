/**
 * ★★ Đợt 3b (3.5) — DÁN / KÉO ẢNH LỖI vào ô chat (hàm THUẦN; trang nối `onPaste`/`onDrop`).
 *
 * Model lập trình chính KHÔNG có thị giác ⇒ ảnh không đi tới model. Luồng: lấy ẢNH đầu tiên trong clipboard/kéo-thả ⇒
 * kiểm loại + kích thước (máy chủ kiểm lại theo BYTE ĐẦU) ⇒ base64 ⇒ `repoWorkspace.ocrAnhLoi` ⇒ CHÈN chữ OCR vào câu
 * hỏi trong một khối có nhãn — người đọc/sửa trước khi gửi.
 */

export const TRAN_BYTE_ANH_CLIENT = 4 * 1024 * 1024;
export const LOAI_ANH_NHAN = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"] as const;

interface MucDuLieu {
  kind: string;
  type: string;
  getAsFile(): File | null;
}
interface NguonDuLieu {
  items?: ArrayLike<MucDuLieu> | null;
  files?: ArrayLike<File> | null;
}

/** Ảnh ĐẦU TIÊN trong clipboard/kéo-thả, hoặc `null` (chữ thường đi đường dán mặc định). THUẦN. */
export function layAnhTuDuLieu(dt: NguonDuLieu | null | undefined): File | null {
  if (!dt) return null;
  const items = dt.items ? Array.from(dt.items) : [];
  for (const it of items) {
    if (it.kind === "file" && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  const files = dt.files ? Array.from(dt.files) : [];
  return files.find((f) => f.type.startsWith("image/")) ?? null;
}

/** Kiểm phía client (lịch sự — máy chủ là hàng rào). THUẦN. */
export function kiemAnhLoi(f: { type: string; size: number }): "ok" | "khong_phai_anh" | "qua_lon" {
  if (!(LOAI_ANH_NHAN as readonly string[]).includes(f.type)) return "khong_phai_anh";
  if (f.size > TRAN_BYTE_ANH_CLIENT) return "qua_lon";
  return "ok";
}

/** Khối chèn vào câu hỏi: nhãn nguồn + rào văn bản (rào dài hơn mọi chuỗi backtick trong chữ OCR). THUẦN. */
export function khoiChuOcr(text: string, nhan: string): string {
  const dai = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const rao = "`".repeat(dai + 1);
  return `${nhan}\n${rao}text\n${text.replace(/\n+$/, "")}\n${rao}\n`;
}

/** Chèn `khoi` vào `cu` tại con trỏ (hoặc cuối), cách bằng dòng trống. THUẦN. */
export function chenVaoO(cu: string, khoi: string, viTri: number | null): string {
  const i = viTri === null || viTri < 0 || viTri > cu.length ? cu.length : viTri;
  const truoc = cu.slice(0, i);
  const sau = cu.slice(i);
  const dem1 = truoc === "" || truoc.endsWith("\n\n") ? "" : truoc.endsWith("\n") ? "\n" : "\n\n";
  return `${truoc}${dem1}${khoi}${sau}`;
}

/** File ⇒ base64 (không tiền tố data:). */
export function docBase64(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("FileReader"));
    r.readAsDataURL(f);
  });
}

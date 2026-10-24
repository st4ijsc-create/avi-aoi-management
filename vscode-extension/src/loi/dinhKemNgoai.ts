/**
 * ★★★ 2026-10-24 — ĐÍNH KÈM TỪ NGOÀI WORKSPACE (dán ảnh Ctrl+V, kéo-thả tệp, "Tệp từ máy…"). THUẦN: không import `vscode`.
 *
 * Trước đây ô nhập không có trình nghe paste/drop và nút đính kèm chỉ chọn trong danh sách tệp CỦA workspace (`bangChat.moBoChonDinhKem`), nên ảnh chụp màn hình/tệp từ Explorer
 * không vào được chat. Tệp này là HÀNG RÀO phía host cho mọi thứ người dùng CHỦ ĐỘNG đưa vào từ ngoài workspace — webview chỉ chuyển tiếp, KHÔNG được tin:
 *   · KHÔNG phải quyền đọc tuỳ ý: agent vẫn chỉ đọc được trong workspace (`read_file` không đổi). Dữ liệu ở đây là thứ người dùng tự dán/kéo/chọn, nằm trong CÂU HỎI của họ.
 *   · TRẦN kích thước/số lượng (ảnh ≤ 6 MB khớp `CHAT_VISION_MAX_IMAGE_MB` của máy chủ, ≤ 4 ảnh; tệp văn bản ≤ 200 KB, ≤ 5 tệp) — kiểm lại ở đây dù webview đã kiểm.
 *   · Ảnh: KIỂU khai báo phải KHỚP chữ ký byte thật (PNG/JPEG/WEBP) — không tin `type` của trình duyệt. Tệp văn bản: UTF-8, không byte NUL (từ chối nhị phân).
 *   · TÊN nhạy cảm (`.env*`, khoá riêng, `*.pem`, `*.key`, kho khoá…) bị từ chối dù người dùng chủ động đưa vào — cùng tinh thần `duocPhepRoiMay` của @-mention, vì kéo nhầm `.env` vào chat là tai nạn thật.
 *   · Mọi thứ nhận được đều hiện RÕ trong chat (chip tên · loại · kích thước · ảnh thu nhỏ) ở phía webview.
 */

export const TRAN_ANH_BYTE = 6 * 1024 * 1024;
export const TRAN_TEP_BYTE = 200 * 1024;
export const TOI_DA_ANH = 4;
/** Trần TỔNG byte ảnh một lượt — khớp hợp đồng /v1 (413 ANH_QUA_LON khi tổng > 12 MB). */
export const TRAN_TONG_ANH_BYTE = 12 * 1024 * 1024;
export const TOI_DA_TEP = 5;
export const KIEU_ANH_HOP_LE: readonly string[] = ["image/png", "image/jpeg", "image/webp"];

export interface DinhKemNgoai {
  loai: "anh" | "tep";
  /** tên hiển thị (đã lọc đường dẫn/ký tự điều khiển) */
  ten: string;
  /** MIME (ảnh: một trong KIEU_ANH_HOP_LE; tệp: text/plain) */
  kieu: string;
  /** số byte THẬT (do host tính lại) */
  kichThuoc: number;
  /** ảnh: base64 (không tiền tố data:) · tệp: văn bản UTF-8 */
  noiDung: string;
}

const MAU_TEN_NHAY_CAM: readonly RegExp[] = [
  /^\.env($|\.)/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|jks|keystore|kdbx|ppk|gpg|asc)$/i,
  /^(credentials?|secrets?|\.npmrc|\.netrc|\.pgpass)(\.|$)/i,
  /(^|[._-])(secret|token|password|passwd)s?\.(json|ya?ml|txt|env|ini|conf)$/i,
];

export function laTenNhayCam(ten: string): boolean {
  const co = lamSachTen(ten);
  return MAU_TEN_NHAY_CAM.some((re) => re.test(co));
}

/** Chỉ giữ tên cuối (không đường dẫn), bỏ ký tự điều khiển, tối đa 80 ký tự. */
export function lamSachTen(ten: unknown): string {
  const t = typeof ten === "string" ? ten : "";
  // eslint-disable-next-line no-control-regex
  const khongDk = t.replace(/[\u0000-\u001f\u007f]/g, "");
  const cuoi = khongDk.split(/[\\/]/).pop() ?? "";
  const gon = cuoi.trim().slice(0, 80);
  return gon.length > 0 ? gon : "tep-khong-ten";
}

/** Chữ ký byte → kiểu ảnh thật; null nếu không phải PNG/JPEG/WEBP. */
export function kieuAnhTheoChuKy(b: Buffer): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const BASE64_HOP_LE = /^[A-Za-z0-9+/]*={0,2}$/;

function dinhDangByte(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
}

/** Bỏ MỌI ảnh khỏi danh sách (khi đọc ảnh đang tắt) — trả phần còn lại + số ảnh bị bỏ. */
export function boAnh(ds: DinhKemNgoai[]): { ds: DinhKemNgoai[]; soAnhBo: number } {
  const con = ds.filter((m) => m.loai !== "anh");
  return { ds: con, soAnhBo: ds.length - con.length };
}

/**
 * Kiểm một danh sách đính kèm NGOÀI do webview/host gom. Không bao giờ ném. `ds` = phần ĐƯỢC NHẬN (đã chuẩn hoá, kích thước do host tính lại);
 * `tuChoi` = lý do tiếng Việt cho từng mục bị bỏ (hiển thị cho người dùng — không được im lặng bỏ).
 */
export function kiemTraDinhKemNgoai(raw: unknown): { ds: DinhKemNgoai[]; tuChoi: string[] } {
  const ds: DinhKemNgoai[] = [];
  const tuChoi: string[] = [];
  if (raw === undefined || raw === null) return { ds, tuChoi };
  if (!Array.isArray(raw)) return { ds, tuChoi: ["Dữ liệu đính kèm không đúng dạng — đã bỏ qua."] };
  let soAnh = 0;
  let soTep = 0;
  let tongAnh = 0;
  for (const m of raw) {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const ten = lamSachTen(o.ten);
    if (o.loai !== "anh" && o.loai !== "tep") {
      tuChoi.push(`"${ten}": loại đính kèm không hợp lệ.`);
      continue;
    }
    if (typeof o.noiDung !== "string" || o.noiDung.length === 0) {
      tuChoi.push(`"${ten}": rỗng.`);
      continue;
    }
    if (laTenNhayCam(ten)) {
      tuChoi.push(`"${ten}": tên tệp thuộc loại nhạy cảm (khoá/bí mật/.env) — không gửi lên máy chủ.`);
      continue;
    }
    if (o.loai === "anh") {
      if (soAnh >= TOI_DA_ANH) {
        tuChoi.push(`"${ten}": quá ${TOI_DA_ANH} ảnh trong một lượt.`);
        continue;
      }
      // chặn sớm theo độ dài chuỗi trước khi cấp phát buffer
      if (o.noiDung.length > Math.ceil((TRAN_ANH_BYTE * 4) / 3) + 16) {
        tuChoi.push(`"${ten}": ảnh quá lớn (tối đa ${dinhDangByte(TRAN_ANH_BYTE)}).`);
        continue;
      }
      const b64 = o.noiDung.replace(/\s/g, "");
      if (!BASE64_HOP_LE.test(b64)) {
        tuChoi.push(`"${ten}": ảnh không đọc được (base64 sai).`);
        continue;
      }
      const buf = Buffer.from(b64, "base64");
      if (buf.length > TRAN_ANH_BYTE) {
        tuChoi.push(`"${ten}": ảnh quá lớn (${dinhDangByte(buf.length)}, tối đa ${dinhDangByte(TRAN_ANH_BYTE)}).`);
        continue;
      }
      const that = kieuAnhTheoChuKy(buf);
      if (!that) {
        tuChoi.push(`"${ten}": không phải ảnh PNG/JPEG/WEBP hợp lệ.`);
        continue;
      }
      if (tongAnh + buf.length > TRAN_TONG_ANH_BYTE) {
        tuChoi.push(`"${ten}": tổng dung lượng ảnh vượt ${dinhDangByte(TRAN_TONG_ANH_BYTE)} trong một lượt.`);
        continue;
      }
      ds.push({ loai: "anh", ten, kieu: that, kichThuoc: buf.length, noiDung: b64 });
      soAnh++;
      tongAnh += buf.length;
    } else {
      if (soTep >= TOI_DA_TEP) {
        tuChoi.push(`"${ten}": quá ${TOI_DA_TEP} tệp trong một lượt.`);
        continue;
      }
      const byte = Buffer.byteLength(o.noiDung, "utf8");
      if (byte > TRAN_TEP_BYTE) {
        tuChoi.push(`"${ten}": tệp quá lớn (${dinhDangByte(byte)}, tối đa ${dinhDangByte(TRAN_TEP_BYTE)}).`);
        continue;
      }
      if (o.noiDung.includes("\u0000")) {
        tuChoi.push(`"${ten}": có vẻ là tệp nhị phân — chỉ nhận tệp văn bản.`);
        continue;
      }
      ds.push({ loai: "tep", ten, kieu: "text/plain", kichThuoc: byte, noiDung: o.noiDung });
      soTep++;
    }
  }
  return { ds, tuChoi };
}

/**
 * Khối văn bản chèn vào ngữ cảnh/câu hỏi cho các TỆP VĂN BẢN ngoài workspace. Nhãn nói RÕ nguồn ("do người dùng đưa vào từ máy, không thuộc workspace") để model
 * không nhầm với tệp trong dự án — cùng kỷ luật `nhanNguonNguCanh` ở `yeuCau.ts`. Rỗng khi không có tệp.
 */
export function dungKhoiTepNgoai(ds: readonly DinhKemNgoai[]): string {
  const tep = ds.filter((d) => d.loai === "tep");
  if (tep.length === 0) return "";
  return tep
    .map((t) => `--- TỆP ĐÍNH KÈM do người dùng đưa vào từ máy (KHÔNG thuộc workspace): ${t.ten} (${dinhDangByte(t.kichThuoc)}) ---\n${t.noiDung}\n--- hết tệp ${t.ten} ---`)
    .join("\n\n");
}

/** Đường KB (`/api/ai/local-kb/stream`) nhận ĐÚNG MỘT ảnh (`image` data URL + `imageMimeType`); trả ảnh đầu và số ảnh phải bỏ. */
export function anhChoKb(ds: readonly DinhKemNgoai[]): { image?: string; imageMimeType?: string; boQua: number } {
  const anh = ds.filter((d) => d.loai === "anh");
  if (anh.length === 0) return { boQua: 0 };
  const a = anh[0]!;
  return { image: `data:${a.kieu};base64,${a.noiDung}`, imageMimeType: a.kieu, boQua: anh.length - 1 };
}

export function coAnh(ds: readonly DinhKemNgoai[]): boolean {
  return ds.some((d) => d.loai === "anh");
}

export { dinhDangByte };

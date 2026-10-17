/**
 * ★★★ Đợt 3a (Q3) — **NHẬP ZIP AN TOÀN** cho dự án cá nhân: giải nén một tệp ZIP người dùng tải lên vào một thư mục
 * ĐÍCH RỖNG, fail-closed với mọi hình dạng tấn công đã biết của tệp nén.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN LỚP CHẶN — TỪ CHỐI CẢ TỆP (không giải nén một phần) khi gặp bất kỳ lớp nào
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Zip-slip**: tên mục được đọc ở dạng GỐC (`unsafeOriginalName` — JSZip tự "làm sạch" `../` trong `name`,
 *      nên đọc `name` là đo trên dữ liệu đã bị che). Từ chối: đoạn `..`, đường tuyệt đối (`/x`, `C:…`, `\\srv`),
 *      dấu `:` ở bất kỳ đâu (luồng dữ liệu thay thế NTFS `a.txt:ads`), ký tự điều khiển/NUL. Lớp cuối: đường đã
 *      giải phải nằm TRONG thư mục đích (so `path.relative`), và thư mục cha (realpath) cũng vậy.
 *   2. **Symlink**: thuộc tính Unix của mục mang kiểu `S_IFLNK` ⇒ từ chối cả tệp (một symlink giải ra rồi bị ghi
 *      xuyên qua là đường thoát kinh điển; không có lý do chính đáng nào để mã nguồn tải lên mang symlink).
 *   3. **Zip bomb**: trần SỐ MỤC (đếm cả mục bị bỏ qua — đọc thư mục trung tâm khổng lồ cũng là một đòn), trần BYTE
 *      GIẢI NÉN tổng và từng tệp — đếm trên **byte THẬT chảy ra khỏi bộ giải nén** (kích thước khai trong ZIP chỉ là
 *      lời khai, chỉ dùng để từ chối SỚM), và trần TỈ LỆ NÉN tổng (byte ra / byte ZIP) khi đã ra > 1 MiB.
 *   4. Ghi với cờ `wx` (thất bại nếu tệp đã có): hai mục trùng tên / khác hoa-thường trên Windows không ghi đè nhau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐUÔI TỆP — DANH SÁCH TRẮNG, mục ngoài danh sách BỊ BỎ QUA (không từ chối cả tệp) và được LIỆT KÊ cho người dùng
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chọn: (a) mọi đuôi/tên tệp VĂN BẢN mà hộp cát đọc được (`DUOI_CHO_PHEP` + `TEN_TEP_CHO_PHEP` — chính tập AI làm
 * việc được), (b) cộng TÀI NGUYÊN NHỊ PHÂN phổ biến của dự án web/ứng dụng (ảnh, phông chữ) và `.lock`. Vì sao:
 *   • Dự án thật mang ảnh/phông — bỏ chúng thì dự án React vỡ giao diện ngay khi chạy (Đợt 3.3 "chạy + xem trước").
 *   • KHÔNG nhận tệp CHẠY ĐƯỢC của hệ điều hành (`.exe .dll .bat .cmd .ps1 .msi .scr .jar…`): máy chủ xưởng không
 *     phải nơi trung chuyển nhị phân; mọi thứ chạy ở đây phải dựng từ mã nguồn đọc được.
 *   • Bỏ qua thay vì từ chối: một `.exe` lạc trong `tools/` không đáng làm hỏng cả lượt nhập; người dùng thấy danh
 *     sách bị bỏ và quyết định. Bí mật (`.env*`, `.pem`, `.key`…, `KHUON_TEP_CAM`) và thư mục cấm (`.git`,
 *     `node_modules` — `.git/hooks` trong ZIP là đường cài hook rồi chờ lượt `git commit` đầu tiên) cũng bị BỎ QUA.
 */
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { DUOI_CHO_PHEP, KHUON_TEP_CAM, TEN_TEP_CHO_PHEP } from "../../aiLocalTools/repoSandbox";

/** Đuôi tài nguyên NHỊ PHÂN được nhận thêm (ngoài tập văn bản của hộp cát). */
export const DUOI_TAI_NGUYEN: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".lock",
]);

/** Đoạn thư mục BỎ QUA khi nhập (không phải mã nguồn của dự án; `.git` còn là đường cài hook). */
export const DOAN_BO_QUA_KHI_NHAP: ReadonlySet<string> = new Set([".git", "node_modules", "__macosx"]);

export interface TranZip {
  /** Trần số mục (đếm cả mục thư mục/bị bỏ qua). */
  soMuc: number;
  /** Trần tổng byte GIẢI NÉN THẬT. */
  byteGiaiNen: number;
  /** Trần byte một tệp. */
  byteMoiTep: number;
  /** Trần tỉ lệ (byte ra / byte ZIP) — chỉ xét khi đã ra > `TRAN_TI_LE_TU_BYTE`. */
  tiLeNen: number;
}

export const TRAN_ZIP_MAC_DINH: TranZip = {
  soMuc: 5_000,
  byteGiaiNen: 300 * 1024 * 1024,
  byteMoiTep: 50 * 1024 * 1024,
  tiLeNen: 100,
};
/** Byte ZIP tải lên tối đa (trần ở cửa tRPC — base64 ~ 4/3 lần). */
export const TRAN_BYTE_ZIP_TAI_LEN = 50 * 1024 * 1024;
const TRAN_TI_LE_TU_BYTE = 1024 * 1024;

export type MaLoiZip =
  | "ZIP_HONG" // không phải ZIP / hỏng
  | "ZIP_DUONG_DAN_XAU" // zip-slip: `..`, tuyệt đối, `:`, ký tự điều khiển
  | "ZIP_SYMLINK" // mục mang kiểu symlink
  | "ZIP_QUA_NHIEU_MUC"
  | "ZIP_QUA_LON" // tổng byte giải nén vượt trần
  | "ZIP_TEP_QUA_LON" // một tệp vượt trần
  | "ZIP_TI_LE_NEN" // tỉ lệ nén bất thường (zip bomb)
  | "ZIP_GHI_THAT_BAI"; // trùng tên / hệ tệp từ chối

export type KetQuaNhapZip =
  | { ok: true; soTep: number; soByte: number; boQua: string[] }
  | { ok: false; ma: MaLoiZip; chiTiet: string };

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * ★ THUẦN — phán một TÊN MỤC (dạng gốc trong ZIP) ⇒ đường tương đối an toàn (`/`), hoặc `null` (zip-slip).
 * Chuẩn hoá `\` → `/` TRƯỚC khi phán (ZIP tạo trên Windows hay dùng `\`; Windows cũng hiểu `\` là phân cách).
 */
export function phanQuyetTenMuc(tenGoc: string): string | null {
  if (typeof tenGoc !== "string" || tenGoc === "") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(tenGoc)) return null;
  const s = tenGoc.replace(/\\/g, "/");
  if (s.startsWith("/")) return null; // tuyệt đối POSIX / UNC (`//srv`)
  if (s.includes(":")) return null; // `C:…` và luồng NTFS `a.txt:ads`
  const doan = s.split("/").filter((d) => d !== "" && d !== ".");
  if (doan.length === 0) return null;
  if (doan.some((d) => d === "..")) return null;
  return doan.join("/");
}

/** Tệp (đường tương đối `/`) có được NHẬP không — `null` ⇔ được; ngược lại lý do bỏ qua (ngắn). */
export function lyDoBoQua(rel: string): string | null {
  const doan = rel.split("/");
  if (doan.slice(0, -1).some((d) => DOAN_BO_QUA_KHI_NHAP.has(d.toLowerCase()))) return "thư mục bỏ qua";
  const ten = doan[doan.length - 1]!;
  if (KHUON_TEP_CAM.some((re) => re.test(ten))) return "tệp bí mật";
  const thuong = ten.toLowerCase();
  if (TEN_TEP_CHO_PHEP.has(thuong)) return null;
  const duoi = path.extname(thuong);
  if (DUOI_CHO_PHEP.has(duoi) || DUOI_TAI_NGUYEN.has(duoi)) return null;
  return "đuôi không được phép";
}

function namTrongThuc(con: string, cha: string): boolean {
  const rel = path.relative(cha, con);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

type MucZip = JSZip.JSZipObject & {
  unsafeOriginalName?: string;
  unixPermissions?: number | null;
  _data?: { uncompressedSize?: number; compressedSize?: number };
};

/** Giải nén MỘT mục bằng luồng, đếm byte THẬT; vượt `tranTep` hoặc `conLai` ⇒ dừng luồng và trả mã. */
function docMucCoTran(muc: MucZip, tranTep: number, conLai: number): Promise<{ ok: true; buf: Buffer } | { ok: false; ma: MaLoiZip }> {
  return new Promise((resolve) => {
    const manh: Buffer[] = [];
    let n = 0;
    let xong = false;
    // `nodeStream` (API công khai có kiểu) — Readable kéo theo áp lực ngược: `pause()` ⇒ bộ đệm đầy ⇒ JSZip ngừng giải
    // nén, nên lượt vượt trần dừng ở ~một mẩu, không giải hết quả bom vào RAM rồi mới đếm.
    const luong = muc.nodeStream("nodebuffer");
    luong
      .on("data", (chunk: Buffer) => {
        if (xong) return;
        n += chunk.length;
        if (n > tranTep || n > conLai) {
          xong = true;
          luong.pause();
          (luong as unknown as { destroy?: () => void }).destroy?.();
          resolve({ ok: false, ma: n > tranTep ? "ZIP_TEP_QUA_LON" : "ZIP_QUA_LON" });
          return;
        }
        manh.push(Buffer.from(chunk));
      })
      .on("error", () => {
        if (xong) return;
        xong = true;
        resolve({ ok: false, ma: "ZIP_HONG" });
      })
      .on("end", () => {
        if (xong) return;
        xong = true;
        resolve({ ok: true, buf: Buffer.concat(manh) });
      })
      .resume();
  });
}

/**
 * ★★★ Giải nén `zipBuf` vào `dich` (thư mục PHẢI tồn tại và RỖNG — người gọi tạo). Mọi lỗi ⇒ `{ok:false}` và người
 * gọi XOÁ thư mục đích (hàm này không dọn — nó không sở hữu thư mục). `tran` ghi đè từng trần (lưới dùng trần nhỏ).
 */
export async function giaiNenZipAnToan(zipBuf: Buffer, dich: string, tranGhiDe: Partial<TranZip> = {}): Promise<KetQuaNhapZip> {
  const tran: TranZip = { ...TRAN_ZIP_MAC_DINH, ...tranGhiDe };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuf, { createFolders: false });
  } catch (e) {
    return { ok: false, ma: "ZIP_HONG", chiTiet: (e as Error)?.message ?? String(e) };
  }
  const tatCa = Object.values(zip.files) as MucZip[];
  if (tatCa.length > tran.soMuc) {
    return { ok: false, ma: "ZIP_QUA_NHIEU_MUC", chiTiet: `${tatCa.length} > ${tran.soMuc}` };
  }

  // ── Lượt 1: PHÁN toàn bộ TRƯỚC khi ghi một byte (fail-closed cả tệp, không giải nén một phần) ──
  const canGhi: Array<{ rel: string; muc: MucZip }> = [];
  const boQua: string[] = [];
  let khaiTong = 0;
  for (const muc of tatCa) {
    const perm = typeof muc.unixPermissions === "number" ? muc.unixPermissions : 0;
    if ((perm & S_IFMT) === S_IFLNK) return { ok: false, ma: "ZIP_SYMLINK", chiTiet: muc.name };
    if (muc.dir) continue; // thư mục được dựng theo đường tệp; tên thư mục rỗng không chở dữ liệu
    const goc = muc.unsafeOriginalName ?? muc.name;
    const rel = phanQuyetTenMuc(goc);
    if (rel === null) return { ok: false, ma: "ZIP_DUONG_DAN_XAU", chiTiet: goc.slice(0, 200) };
    // Lớp cuối của zip-slip: đường giải xong phải nằm TRONG đích.
    if (!namTrongThuc(path.resolve(dich, rel), path.resolve(dich))) {
      return { ok: false, ma: "ZIP_DUONG_DAN_XAU", chiTiet: goc.slice(0, 200) };
    }
    const lyDo = lyDoBoQua(rel);
    if (lyDo !== null) {
      boQua.push(rel);
      continue;
    }
    // Từ chối SỚM theo kích thước KHAI (chỉ là lời khai — trần thật đếm ở lượt 2).
    const khai = Number(muc._data?.uncompressedSize ?? 0);
    if (Number.isFinite(khai) && khai > tran.byteMoiTep) return { ok: false, ma: "ZIP_TEP_QUA_LON", chiTiet: rel };
    if (Number.isFinite(khai) && khai > 0) khaiTong += khai;
    if (khaiTong > tran.byteGiaiNen) return { ok: false, ma: "ZIP_QUA_LON", chiTiet: `khai ${khaiTong}` };
    canGhi.push({ rel, muc });
  }

  // ── Lượt 2: giải nén bằng luồng, đếm byte THẬT, ghi `wx` ──
  const dichThat = fs.realpathSync.native(dich);
  let tong = 0;
  for (const { rel, muc } of canGhi) {
    const kq = await docMucCoTran(muc, tran.byteMoiTep, tran.byteGiaiNen - tong);
    if (!kq.ok) return { ok: false, ma: kq.ma, chiTiet: rel };
    tong += kq.buf.length;
    if (tong > TRAN_TI_LE_TU_BYTE && tong / Math.max(1, zipBuf.length) > tran.tiLeNen) {
      return { ok: false, ma: "ZIP_TI_LE_NEN", chiTiet: `${tong}/${zipBuf.length}` };
    }
    const dichTep = path.resolve(dich, rel);
    try {
      fs.mkdirSync(path.dirname(dichTep), { recursive: true });
      // Thư mục cha (realpath) phải vẫn trong đích — chỉ hàm này tạo thư mục ở đây, nhưng kiểm lại không tốn gì.
      const chaThat = fs.realpathSync.native(path.dirname(dichTep));
      if (chaThat !== dichThat && !namTrongThuc(chaThat, dichThat)) {
        return { ok: false, ma: "ZIP_DUONG_DAN_XAU", chiTiet: rel };
      }
      fs.writeFileSync(dichTep, kq.buf, { flag: "wx" });
    } catch (e) {
      return { ok: false, ma: "ZIP_GHI_THAT_BAI", chiTiet: `${rel}: ${(e as Error)?.message ?? String(e)}` };
    }
  }
  return { ok: true, soTep: canGhi.length, soByte: tong, boQua };
}

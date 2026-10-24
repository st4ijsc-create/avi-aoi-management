/**
 * ★★★ Gốc cho phép của hot-folder (W15, kiểm định phamViGhi 2026-10-25; dieu-phoi duyệt).
 * `watchPath` / `archivePath` / `errorPath` là ĐƯỜNG DẪN TUỲ Ý trên máy chủ do người có machine_control.canCreate khai — không ràng thì đọc / ghi / chuyển tệp ở bất kỳ đâu.
 * Luật (fail-closed):
 *  • danh sách gốc từ env `HOT_FOLDER_ROOTS` (ngăn bằng `;` `,` hoặc dấu phân tách của hệ điều hành); MẶC ĐỊNH RỖNG ⇒ TỪ CHỐI tạo / đổi đường dẫn;
 *  • so trên REALPATH (theo symlink / junction): đường dẫn đích phải NẰM TRONG một gốc (chặn `..`, symlink trỏ ra ngoài); đường chưa tồn tại → realpath của tổ tiên gần nhất còn tồn tại + phần còn lại;
 *  • cấu hình CŨ ngoài gốc: không quét / không theo dõi (báo log); tệp con là symlink thoát khỏi thư mục theo dõi: bỏ qua.
 */
import fs from "node:fs";
import path from "node:path";

/** Các gốc cho phép (đã chuẩn hoá realpath; gốc không tồn tại bị bỏ). */
export function hotFolderRoots(): string[] {
  const raw = process.env.HOT_FOLDER_ROOTS?.trim();
  if (!raw) return [];
  const out: string[] = [];
  for (const p of raw.split(/[;,]|\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const r = realpathGanDung(path.resolve(p));
    if (r) out.push(r);
  }
  if (path.delimiter === ":") {
    // POSIX: cho phép dấu ':' làm phân tách khi không phải đường dẫn Windows
    return [...new Set(out.flatMap((x) => x.split(":").filter(Boolean).map((y) => (path.isAbsolute(y) ? y : x))))];
  }
  return [...new Set(out)];
}

/** realpath của đường dẫn; nếu chưa tồn tại thì realpath của tổ tiên gần nhất còn tồn tại nối với phần còn lại. null nếu không tính được. */
export function realpathGanDung(p: string): string | null {
  const abs = path.resolve(p);
  const dangDi: string[] = [];
  let cur = abs;
  for (let i = 0; i < 64; i++) {
    try {
      const real = fs.realpathSync.native(cur);
      return dangDi.length ? path.join(real, ...dangDi.reverse()) : real;
    } catch {
      const cha = path.dirname(cur);
      if (cha === cur) return null;
      dangDi.push(path.basename(cur));
      cur = cha;
    }
  }
  return null;
}

const chuan = (p: string): string => (process.platform === "win32" ? p.toLowerCase() : p);

/** `con` nằm trong (hoặc bằng) `goc`? So trên đường đã chuẩn hoá, không chuỗi con thô. */
export function namTrong(con: string, goc: string): boolean {
  const rel = path.relative(chuan(goc), chuan(con));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface KetQuaGoc {
  ok: boolean;
  /** Mã máy đọc được: ROOTS_EMPTY (env rỗng) · OUTSIDE_ROOTS · UNRESOLVABLE. */
  ma?: "ROOTS_EMPTY" | "OUTSIDE_ROOTS" | "UNRESOLVABLE";
  real?: string;
}

/** Đường dẫn có nằm trong MỘT gốc cho phép không (trên realpath). Gốc rỗng ⇒ ROOTS_EMPTY. */
export function trongGocChoPhep(p: string): KetQuaGoc {
  const roots = hotFolderRoots();
  if (roots.length === 0) return { ok: false, ma: "ROOTS_EMPTY" };
  const real = realpathGanDung(p);
  if (!real) return { ok: false, ma: "UNRESOLVABLE" };
  return roots.some((r) => namTrong(real, r)) ? { ok: true, real } : { ok: false, ma: "OUTSIDE_ROOTS", real };
}

/** Tệp (sau khi theo symlink) còn nằm trong thư mục theo dõi `watchPath` (cũng theo realpath)? Không phụ thuộc env. */
export function tepTrongThuMuc(tep: string, watchPath: string): boolean {
  const t = realpathGanDung(tep);
  const w = realpathGanDung(watchPath);
  return !!t && !!w && namTrong(t, w);
}

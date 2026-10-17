/**
 * ★★★ Đợt 3a (2026-10-17, quyết định Q3) — **GỐC QUẢN LÝ dự án cá nhân** của kỹ sư: đường, thư mục theo người dùng,
 * và vị từ "gốc dự án cá nhân này có nằm ĐÚNG chỗ của chủ nó không".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT MODULE LÁ (chỉ `fs`/`os`/`path` + `khoCheckpoint` cũng là lá)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `repoProjects.ts` (nằm trong đồ thị import của CLI/MCP standalone) phải hỏi được vị từ chỗ-đứng mỗi lượt phân giải
 * dự án cá nhân, còn dịch vụ TẠO dự án (`duAnCaNhan.ts`) lại nhập `repoProjects` ⇒ đặt vị từ ở dịch vụ là vòng nhập.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GỐC MẶC ĐỊNH — `D:\AI-Projects` khi có ổ D (Windows), ngược lại `<home>/AI-Projects`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • Máy chủ xưởng đặt repo + model trên D (ổ dữ liệu, NVMe — kế hoạch Đợt 6 "model lên NVMe"); C: là ổ hệ điều
 *     hành đang chật (khảo sát 7 tầng: "dọn ổ C:"). Dự án của kỹ sư là DỮ LIỆU ⇒ ổ dữ liệu.
 *   • Không có ổ D ⇒ thư mục nhà của tài khoản chạy server: luôn ghi được, không cần quyền quản trị, ngoài repo.
 *   • KHÔNG đặt trong `os.tmpdir()` (bị dọn ⇒ mất mã của người dùng) và KHÔNG trong repo (agent tự động ghi được vào
 *     dự án cá nhân — nằm trong repo chính thì Q1 thành vô nghĩa).
 *   `AI_PROJECTS_ROOT` ghi đè (tương đối ⇒ theo cwd — nhưng `duAnCaNhan.kiemTraGocQuanLy` TỪ CHỐI một gốc chồng lấn
 *   repo chính / gốc dự án khác / kho checkpoint, nên gốc tương đối nằm trong repo sẽ bị chặn ở cửa).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THƯ MỤC THEO NGƯỜI DÙNG = `u<userId>` — THEO ID ỔN ĐỊNH, KHÔNG THEO TÊN HIỂN THỊ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tên hiển thị đổi được, trùng được, có dấu/ký tự lạ; id người dùng là khoá chính bất biến. `u` + số nguyên dương:
 * không bao giờ trùng thư mục hệ thống của gốc (`.thung-rac`, `.tam`, `.khong-hook` đều bắt đầu bằng dấu chấm).
 *
 * ⚠ Đọc env TẠI CHỖ GỌI (lưới lật env theo ca — cùng nguyên tắc `gocHopCat()`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { namTrongHoacLa } from "./khoCheckpoint";

export const BIEN_GOC_DU_AN_CA_NHAN = "AI_PROJECTS_ROOT";
/** Thùng rác: xoá dự án = CHUYỂN vào đây, hạn 30 ngày rồi mới xoá cứng. */
export const TEN_THUNG_RAC = ".thung-rac";
/** Thư mục RỖNG trỏ `core.hooksPath` cho mọi lệnh git của tính năng này (không hook nào chạy). */
export const TEN_KHONG_HOOK = ".khong-hook";

/**
 * Gốc mặc định (THUẦN — tham số để lưới đo cả hai nhánh mà không cần một máy không có ổ D).
 * Windows + có `D:\` ⇒ `D:\AI-Projects`; còn lại ⇒ `<home>/AI-Projects`.
 */
export function gocQuanLyMacDinh(
  nenTang: NodeJS.Platform = process.platform,
  coO: (p: string) => boolean = (p) => fs.existsSync(p),
  home: string = os.homedir(),
): string {
  if (nenTang === "win32" && coO("D:\\")) return "D:\\AI-Projects";
  return path.join(home, "AI-Projects");
}

/** Gốc quản lý hiệu lực (CHƯA kiểm hợp lệ — `duAnCaNhan.kiemTraGocQuanLy` kiểm). Luôn tuyệt đối. */
export function gocQuanLy(): string {
  const raw = (process.env[BIEN_GOC_DU_AN_CA_NHAN] ?? "").trim();
  if (raw === "") return path.resolve(gocQuanLyMacDinh());
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

/**
 * Lỗi lập trình (id người dùng xấu tới tận đây) — lớp có `code`, KHÔNG import `_core/appError` vì tệp này nằm trong đồ thị
 * import của CLI/MCP standalone. Message giữ nguyên văn.
 */
export class LoiNguoiDungDuAnCaNhan extends Error {
  readonly code = "USER_ID_KHONG_HOP_LE" as const;
  constructor(message: string) {
    super(message);
    this.name = "LoiNguoiDungDuAnCaNhan";
  }
}

/** Tên thư mục của một người dùng: `u<id>` — id nguyên dương, KHÔNG tên hiển thị. Id xấu ⇒ ném (lỗi lập trình). */
export function tenThuMucNguoiDung(userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) throw new LoiNguoiDungDuAnCaNhan(`userId không hợp lệ: ${String(userId)}`);
  return `u${userId}`;
}

export function thuMucNguoiDung(userId: number, goc: string = gocQuanLy()): string {
  return path.join(goc, tenThuMucNguoiDung(userId));
}

/**
 * ★★★ VỊ TỪ CHỖ ĐỨNG — gốc của một dự án cá nhân có nằm THẬT SỰ trong thư mục của CHỦ nó không, so bằng **realpath**:
 *   • realpath(gốc dự án) phải là con THỰC SỰ (không phải chính nó) của realpath(`<gốc quản lý>/u<chủ>`);
 *   • ⇒ một junction/symlink đặt trong thư mục người dùng trỏ RA NGOÀI (vào repo chính, vào dự án người khác) bị bắt,
 *     dù đường CHỮ trông vẫn ở trong; một hàng DB bị sửa tay trỏ `goc` sang `u<người khác>` cũng bị bắt.
 * Lỗi bất kỳ (không tồn tại, không đọc được) ⇒ `false` — fail-closed: dự án không phân giải được, không mở gốc lạ.
 */
export function duAnCaNhanDungCho(gocDuAn: string, chuSoHuu: number): boolean {
  try {
    if (!path.isAbsolute(gocDuAn)) return false;
    const that = fs.realpathSync.native(gocDuAn);
    const cuaChu = fs.realpathSync.native(thuMucNguoiDung(chuSoHuu));
    if (!namTrongHoacLa(that, cuaChu)) return false;
    return path.relative(cuaChu, that) !== "";
  } catch {
    return false;
  }
}

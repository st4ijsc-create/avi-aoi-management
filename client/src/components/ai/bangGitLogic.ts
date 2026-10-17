/**
 * ★ Đợt 3b (3.4) — hàm THUẦN cho bảng Git (lưới đơn vị chạy thẳng, không React).
 */

/** Mã lỗi máy chủ có câu riêng ở `repoWs.git.loi.*` (ba locale). Mã lạ ⇒ câu chung kèm mã. */
export const MA_LOI_GIT = [
  "PERMISSION_DENIED",
  "PROJECT_NOT_FOUND",
  "GIT_CHUA_SAN_SANG",
  "GIT_KHONG_PHAI_REPO",
  "GIT_REPO_CHINH_CHI_DOC",
  "GIT_WORKTREE_CHI_DOC",
  "GIT_CAY_BAN",
  "GIT_TEN_NHANH_SAI",
  "GIT_NHANH_DA_CO",
  "GIT_NHANH_KHONG_CO",
  "GIT_DUONG_KHONG_HOP_LE",
  "GIT_KHONG_CO_TEP",
  "GIT_QUA_NHIEU_TEP",
  "GIT_THONG_DIEP_RONG",
  "GIT_TEP_BI_CHAN",
  "GIT_HET_GIO",
  "GIT_THAT_BAI",
  "KHONG_CO_THAY_DOI",
  "MODEL_LOI",
  "MODEL_RONG",
] as const;

type HamT = (k: string, o?: Record<string, unknown>) => string;

/** Câu cho một mã lỗi git — LUÔN nêu mã (người báo lỗi đọc được mã cho quản trị). */
export function cauLoiGit(ma: string | null | undefined, t: HamT): string {
  const m = String(ma ?? "?");
  if ((MA_LOI_GIT as readonly string[]).includes(m)) return `${t(`repoWs.git.loi.${m}`)} [${m}]`;
  return t("repoWs.git.loi.khac", { ma: m });
}

/** Nhãn một ký tự + loại (cho màu) từ `XY` porcelain. Ưu tiên cột cây làm việc (Y), rồi index (X). */
export function nhanTrangThai(xy: string): { kyTu: string; loai: "moi" | "sua" | "xoa" | "doiTen" | "xungDot" } {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (xy === "??") return { kyTu: "U", loai: "moi" };
  if (x === "U" || y === "U" || xy === "AA" || xy === "DD") return { kyTu: "!", loai: "xungDot" };
  if (x === "R" || x === "C") return { kyTu: "R", loai: "doiTen" };
  if (x === "D" || y === "D") return { kyTu: "D", loai: "xoa" };
  if (x === "A") return { kyTu: "A", loai: "moi" };
  return { kyTu: "M", loai: "sua" };
}

/** Thông điệp đủ để bật nút Commit: có chữ thật sau khi bỏ khoảng trắng. */
export function thongDiepDung(s: string): boolean {
  return s.trim().length > 0 && s.length <= 2000;
}

/** Kiểm tên nhánh phía client (CÙNG luật lớp 1 của máy chủ — máy chủ vẫn phán lại). */
export function tenNhanhHopLeClient(x: string): boolean {
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(x)) return false;
  if (x.startsWith("-") || x.startsWith("/") || x.startsWith(".")) return false;
  if (x.includes("..") || x.includes("//") || x.includes("/.")) return false;
  if (x.endsWith(".lock") || x.endsWith("/") || x.endsWith(".")) return false;
  return x !== "HEAD";
}

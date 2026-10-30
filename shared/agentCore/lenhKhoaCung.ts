/**
 * ★ Đợt 11.3-A (UX-S02) — DANH SÁCH LỆNH KHOÁ CỨNG, MỘT NGUỒN cho máy chủ và giao diện.
 *
 * Bối cảnh: lệnh của agent đi qua DANH SÁCH TRẮNG (`repoCommandSandbox.DANH_SACH_TRANG`) — mọi thứ ngoài danh sách đã bị từ chối. Tệp này KHÔNG phải cơ chế
 * cấp quyền; nó là (1) vành đai thứ hai của máy chủ: `phanQuyetLenh` từ chối các lệnh dưới đây TRƯỚC khi nhìn danh sách trắng (một mục trắng khai nhầm cũng không
 * mở được chúng — chỉ THÊM từ chối, không nới gì), và (2) dữ liệu để thẻ duyệt HIỂN THỊ "lệnh bị khoá cứng" bằng biểu tượng khoá (người duyệt biết agent không
 * bao giờ có thể làm các việc này dù bấm duyệt).
 *
 * Luật so khớp (cố ý RỘNG — nhiều từ chối hơn, không ít hơn): tên chương trình lấy phần cuối đường dẫn, bỏ `.exe/.cmd/.bat`, không phân biệt HOA/thường;
 * mục `git` khoá khi BẤT KỲ phần tử argv nào bằng đúng tiểu lệnh (bắt cả `git -C x push`); các mục khác khoá khi argv bắt đầu bằng đúng chuỗi (không phân biệt HOA/thường).
 * Mục `loai: "mo-ta"` là việc bị chặn bằng cơ chế KHÁC (hộp cát đường dẫn, vai trò CSDL chỉ đọc) — chỉ để người duyệt đọc, không dùng so khớp argv.
 *
 * ⚠ Muốn BỚT một mục: không được. Muốn thêm: thêm vào đây (test ghim danh sách cũ là tập con; test đối chiếu mọi mục argv phải bị `phanQuyetLenh` từ chối thật).
 */
export interface LenhKhoaCung {
  id: string;
  /** Chuỗi hiển thị (lệnh thật hoặc mô tả ngắn). */
  hienThi: string;
  loai: "argv" | "mo-ta";
  /** `argv`: chuỗi mở đầu (git: [ "git", tiểu lệnh ]). `mo-ta`: rỗng. */
  khuon: readonly string[];
  /** Vì sao khoá (nhóm — giao diện dịch theo khoá `repoWs.agent.khoa.nhom.<nhom>`). */
  nhom: "git-lich-su" | "xoa" | "phat-hanh" | "dung-lai-server" | "ngoai-du-an" | "csdl-that";
}

export const LENH_KHOA_CUNG: readonly LenhKhoaCung[] = Object.freeze([
  { id: "git-push", hienThi: "git push", loai: "argv", khuon: ["git", "push"], nhom: "git-lich-su" },
  { id: "git-reset", hienThi: "git reset (kể cả --hard)", loai: "argv", khuon: ["git", "reset"], nhom: "git-lich-su" },
  { id: "git-checkout", hienThi: "git checkout", loai: "argv", khuon: ["git", "checkout"], nhom: "git-lich-su" },
  { id: "git-clean", hienThi: "git clean", loai: "argv", khuon: ["git", "clean"], nhom: "xoa" },
  { id: "git-revert", hienThi: "git revert", loai: "argv", khuon: ["git", "revert"], nhom: "git-lich-su" },
  { id: "git-commit", hienThi: "git commit", loai: "argv", khuon: ["git", "commit"], nhom: "git-lich-su" },
  { id: "git-restore", hienThi: "git restore", loai: "argv", khuon: ["git", "restore"], nhom: "git-lich-su" },
  { id: "git-switch", hienThi: "git switch", loai: "argv", khuon: ["git", "switch"], nhom: "git-lich-su" },
  { id: "git-stash", hienThi: "git stash", loai: "argv", khuon: ["git", "stash"], nhom: "git-lich-su" },
  { id: "rm", hienThi: "rm", loai: "argv", khuon: ["rm"], nhom: "xoa" },
  { id: "npm-publish", hienThi: "npm publish", loai: "argv", khuon: ["npm", "publish"], nhom: "phat-hanh" },
  { id: "dotnet-nuget-push", hienThi: "dotnet nuget push", loai: "argv", khuon: ["dotnet", "nuget", "push"], nhom: "phat-hanh" },
  { id: "npm-run-build", hienThi: "npm run build", loai: "argv", khuon: ["npm", "run", "build"], nhom: "dung-lai-server" },
  { id: "ngoai-du-an", hienThi: "Xoá / ghi tệp NGOÀI thư mục dự án", loai: "mo-ta", khuon: [], nhom: "ngoai-du-an" },
  { id: "csdl-that", hienThi: "Ghi vào cơ sở dữ liệu THẬT", loai: "mo-ta", khuon: [], nhom: "csdl-that" },
] as const satisfies readonly LenhKhoaCung[]);

/** Tên chương trình chuẩn hoá: phần cuối đường dẫn, bỏ đuôi chạy được Windows, chữ thường. */
export function tenChuongTrinh(argv0: unknown): string {
  if (typeof argv0 !== "string") return "";
  const cuoi = argv0.split(/[\\/]/).pop() ?? "";
  return cuoi.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

/** Mục khoá cứng khớp `argv`, hoặc null. Rộng có chủ ý (xem đầu tệp). */
export function timLenhKhoaCung(argv: readonly string[]): LenhKhoaCung | null {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const a0 = tenChuongTrinh(argv[0]);
  const phanSau = argv.slice(1).map((x) => (typeof x === "string" ? x.toLowerCase() : ""));
  for (const m of LENH_KHOA_CUNG) {
    if (m.loai !== "argv") continue;
    if (m.khuon[0] !== a0) continue;
    if (a0 === "git") {
      if (phanSau.includes(m.khuon[1]!)) return m;
      continue;
    }
    const duoi = m.khuon.slice(1);
    if (duoi.every((k, i) => phanSau[i] === k)) return m;
  }
  return null;
}

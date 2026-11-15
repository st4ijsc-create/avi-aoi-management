/**
 * B1 `.csv` — cho tác nhân ĐỌC / GHI tệp `.csv` CHỈ trong `sandbox-projects/**`, theo ĐƯỜNG THẬT. Phạm vi do chủ dự án duyệt (qua HST, 15/11):
 *   • CHỈ đường dưới `sandbox-projects/**`; đọc có trần 32 KB / 200 dòng, báo "đã cắt"; ghi CHỈ trong chính dự án (gốc nằm dưới `sandbox-projects`);
 *   • MẶC ĐỊNH TẮT — cờ `AI_AGENT_CSV_DOC=1` (cùng quy ước H1.1/H1.4/HA-4: chữ gửi model đổi ⇒ phải có A/B GPU rồi mới bật; phát lại fixture H4.2 không lệch);
 *   • KHÔNG mở theo: chỉ mục mã, nhập ZIP, cửa git, dòng chữ prompt, `grep`/`glob` (`duyetTepDocDuoc`), tạo khung, xoá/đổi tên, IDE người dùng, đường AI ngoài.
 *
 * VÌ SAO KHÔNG THÊM `.csv` VÀO `DUOI_CHO_PHEP`: tập đó dùng chung cho mọi nơi trên — thêm vào là mở theo tất cả. Ở đây `duoiDuocPhep(ten)` GIỮ NGUYÊN (`.csv` ⇒ false);
 * chỉ HAI điểm gọi sản xuất hỏi `csvDuocPhep` (đọc: `moTepTrongHopCat` khi người gọi bật `choPhepCsv`; ghi: `phanQuyetChinhSachDuong(duong, goc)`), census khoá số đó.
 *
 * ⚠ BẪY ĐÃ ĐO: gốc agent-f là `sandbox-projects/agent-f` và đường tương đối là `py-doi-soat/du_lieu/so_sach.csv` — KHÔNG chứa chữ `sandbox-projects`. Kiểm chuỗi trên
 *   đường tương đối sẽ từ chối đúng ca cần mở. Vị từ kiểm trên đường TUYỆT ĐỐI đã `realpath` (junction/symlink trong sandbox-projects trỏ ra ngoài ⇒ KHÔNG).
 * ⚠ FAIL-CLOSED: mọi lỗi đĩa / đầu vào lạ ⇒ `false`, không ném.
 */
import fs from "node:fs";
import path from "node:path";

/** Trần byte một lượt đọc `.csv` (thấp hơn `TRAN_BYTE_MOI_TEP` 64 KiB) và trần số dòng trả về. */
export const TRAN_BYTE_DOC_CSV = 32_768;
export const TRAN_DONG_DOC_CSV = 200;

/** Công tắc `AI_AGENT_CSV_DOC`: chỉ `1` bật (mặc định TẮT — hành vi cũ từng byte). Điểm gọi truyền `process.env.AI_AGENT_CSV_DOC` TẠI CHỖ GỌI (không nhớ đệm). */
export function csvBat(giaTri: string | undefined): boolean {
  return giaTri === "1";
}

/** Đuôi đúng `.csv` (không phân biệt hoa thường). `.csv.txt`, `.csvx`, dotfile `.csv` ⇒ không. */
export function laTepCsv(ten: string): boolean {
  return path.extname(ten).toLowerCase() === ".csv";
}

/** `<thư mục làm việc>/sandbox-projects` — cùng gốc mặc định với `gocHopCat()` (không có nguồn nào khác của repo này). */
export function gocSandboxProjects(): string {
  return path.join(path.resolve(process.cwd()), "sandbox-projects");
}

export interface TuyChonCsv {
  /** Ghi đè gốc `sandbox-projects` (lưới thử). Mặc định `gocSandboxProjects()`. */
  gocSandboxProjects?: string;
  /** Lượt GHI: gốc dự án chính nó phải nằm dưới `sandbox-projects` (không đủ khi gốc là gốc repo). */
  ghi?: boolean;
}

/** `realpath` của phần tồn tại sâu nhất của `abs`, nối lại phần còn thiếu (đích GHI mới). `null` khi không xác định được. */
function duongThatCuaDich(abs: string): string | null {
  let p = abs;
  const duoi: string[] = [];
  for (let i = 0; i < 4096; i++) {
    try {
      return path.join(fs.realpathSync(p), ...duoi);
    } catch {
      const cha = path.dirname(p);
      if (cha === p) return null;
      duoi.unshift(path.basename(p));
      p = cha;
    }
  }
  return null;
}

/** `con` nằm BÊN TRONG `cha` (không bằng). */
function namBenTrong(cha: string, con: string): boolean {
  const rel = path.relative(cha, con);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Tệp `duong` (tương đối với `goc`) có được mở `.csv` không: cờ BẬT ∧ đuôi `.csv` ∧ đường THẬT nằm dưới `sandbox-projects` ∧ (ghi ⇒ gốc dự án nằm dưới `sandbox-projects`).
 * Thuần trừ đọc `realpath`; không ném.
 */
export function csvDuocPhep(goc: string, duong: unknown, tuyChon: TuyChonCsv = {}): boolean {
  try {
    if (!csvBat(process.env.AI_AGENT_CSV_DOC)) return false;
    if (typeof duong !== "string" || duong === "" || typeof goc !== "string" || goc === "") return false;
    const ten = duong.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
    if (!laTepCsv(ten)) return false;
    const sb = fs.realpathSync(tuyChon.gocSandboxProjects ?? gocSandboxProjects());
    const thatDich = duongThatCuaDich(path.resolve(goc, duong));
    if (thatDich === null || !namBenTrong(sb, thatDich)) return false;
    if (tuyChon.ghi === true) {
      const thatGoc = duongThatCuaDich(path.resolve(goc));
      if (thatGoc === null) return false;
      if (thatGoc !== sb && !namBenTrong(sb, thatGoc)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface KetQuaCatCsv {
  noiDung: string;
  /** số dòng TRẢ VỀ */
  dong: number;
  /** `true` ⇔ có dòng bị bỏ vì vượt trần số dòng */
  catTheoDong: boolean;
}

/** Cắt còn `TRAN_DONG_DOC_CSV` dòng đầu (giữ nguyên chữ, kể cả CRLF). Thuần. */
export function catCsv(noiDung: string): KetQuaCatCsv {
  if (noiDung === "") return { noiDung: "", dong: 0, catTheoDong: false };
  const ds = noiDung.split("\n");
  const coXuongDongCuoi = ds[ds.length - 1] === "";
  const tong = coXuongDongCuoi ? ds.length - 1 : ds.length;
  if (tong <= TRAN_DONG_DOC_CSV) return { noiDung, dong: tong, catTheoDong: false };
  return { noiDung: ds.slice(0, TRAN_DONG_DOC_CSV).join("\n") + "\n", dong: TRAN_DONG_DOC_CSV, catTheoDong: true };
}

/** Bỏ dòng dở dang ở cuối khi đọc bị cắt theo BYTE (không để một chuỗi bí mật bị chặt ngang đúng ranh giới rồi lọt lưới che). */
export function boDongDoDang(noiDung: string): string {
  const i = noiDung.lastIndexOf("\n");
  return i < 0 ? "" : noiDung.slice(0, i + 1);
}

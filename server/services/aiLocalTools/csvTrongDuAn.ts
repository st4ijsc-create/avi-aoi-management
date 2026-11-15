/**
 * B1 `.csv` — cho tác nhân ĐỌC tệp `.csv` CHỈ trong `sandbox-projects/**`, theo ĐƯỜNG THẬT. Phạm vi do chủ dự án duyệt (14/11, qua HST): ĐỌC, dự án mẫu, 32 KB / 200 dòng, có che.
 *   • GHI `.csv` (apply_diff / write_file / edit_file) CHƯA được duyệt ⇒ KHÔNG mở: `applyDiff.ts` không nhập tệp này, census khoá điều đó. Muốn mở ghi phải có duyệt riêng + cờ riêng.
 *   • CHỈ đường dưới `sandbox-projects/**`; đọc có trần 32 KB / 200 dòng, báo "đã cắt";
 *   • MẶC ĐỊNH TẮT — cờ `AI_AGENT_CSV_DOC=1` (cùng quy ước H1.1/H1.4/HA-4: chữ gửi model đổi ⇒ phải có A/B GPU rồi mới bật; phát lại fixture H4.2 không lệch);
 *   • KHÔNG mở theo: ghi, chỉ mục mã, nhập ZIP, cửa git, dòng chữ prompt, `grep`/`glob` (`duyetTepDocDuoc`), tạo khung, xoá/đổi tên, IDE người dùng, đường AI ngoài.
 *
 * VÌ SAO KHÔNG THÊM `.csv` VÀO `DUOI_CHO_PHEP`: tập đó dùng chung cho mọi nơi trên — thêm vào là mở theo tất cả. Ở đây `duoiDuocPhep(ten)` GIỮ NGUYÊN (`.csv` ⇒ false);
 * chỉ MỘT điểm gọi sản xuất hỏi `csvDuocPhep` (đọc: `moTepTrongHopCat` khi người gọi bật `choPhepCsv`), census khoá số đó.
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

/** `con` nằm BÊN TRONG `cha` (không bằng). So THEO ĐƯỜNG (`path.relative`), không so tiền tố chuỗi: `sandbox-projects-evil` không nằm trong `sandbox-projects`. */
function namBenTrong(cha: string, con: string): boolean {
  const rel = path.relative(cha, con);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}

/**
 * Tệp `duong` (tương đối với `goc`) có được ĐỌC `.csv` không: cờ BẬT ∧ đuôi `.csv` ∧ đường THẬT nằm dưới `sandbox-projects`.
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
    return thatDich !== null && namBenTrong(sb, thatDich);
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

/**
 * Khối khoá nhiều dòng (`-----BEGIN …-----` … `-----END …-----`) bị cắt ngang ranh giới đọc: `redactSecretsOnly` chỉ khớp khi có CẢ BEGIN lẫn END, nên phần đã đọc mà thiếu END sẽ hiện nguyên
 * dòng BEGIN + thân cho model. ⇒ Nếu BEGIN cuối cùng chưa có END nào sau nó, cắt TỪ DÒNG BEGIN đó trở đi. Gọi SAU `boDongDoDang`, CHỈ khi đọc bị cắt theo byte. Thuần.
 */
export function boKhoiPemDoDang(noiDung: string): string {
  const b = noiDung.lastIndexOf("-----BEGIN");
  if (b < 0) return noiDung;
  if (noiDung.indexOf("-----END", b) >= 0) return noiDung;
  return noiDung.slice(0, noiDung.lastIndexOf("\n", b) + 1);
}

/** Bỏ dòng dở dang ở cuối khi đọc bị cắt theo BYTE (không để một chuỗi bí mật bị chặt ngang đúng ranh giới rồi lọt lưới che). */
export function boDongDoDang(noiDung: string): string {
  const i = noiDung.lastIndexOf("\n");
  return i < 0 ? "" : noiDung.slice(0, i + 1);
}

/**
 * ★★★ Đợt 2 — CỬA ĐĨA DUY NHẤT của chỉ mục mã (`kyHieu.ts` + `nguNghia.ts`). Không viết lại hộp cát: mọi tầng là
 * hàm SẴN CÓ của `aiLocalTools/` ghép theo đúng thứ tự của `moTepTrongHopCat`:
 *   1. CHÍNH SÁCH thuần (`phanQuyetDuongDan` + `duoiDuocPhep`) — trước mọi `stat`;
 *   2. HỘP CÁT (`confineTargetUnder`: hình dạng → realpath/symlink/junction → `nlink`);
 *   3. fd (`readConfined`: isFile/nlink/size hỏi trên CHÍNH fd — chống TOCTOU);
 *   4. CHE BÍ MẬT (`redactSecretsOnly`) cho tệp được phép đọc.
 *
 * ⚠ VÌ SAO KHÔNG GỌI THẲNG `moTepTrongHopCat`: nó kẹp mọi lượt đọc ở `TRAN_BYTE_MOI_TEP` = 64 KiB — trần của byte RỜI
 *   hộp cát vào cửa sổ chat. Chỉ mục KHÔNG đưa tệp ra ngoài (chỉ một dòng chữ ký / đoạn ≤ vài KB / dòng tham chiếu đi
 *   ra), và repo này có tệp nguồn 350 KB (`machineApiRouters.ts`) — kẹp 64 KiB làm mù mọi định nghĩa sau dòng ~1.600
 *   mà vẫn trông "xanh". Trần riêng ở đây (`TRAN_BYTE_TEP_MAC_DINH`), có khai `catBot` khi chạm.
 * ⚠ VÌ SAO KHÔNG GỌI `duyetTepDocDuoc`: nó liệt kê mỗi thư mục tối đa `TRAN_MUC_LIET_KE` = 300 mục và KHÔNG khai khi
 *   cắt — thư mục `server/services/ai/` của repo này đã quá 300 mục ⇒ chỉ mục thiếu tệp mà không ai biết. Bản duyệt ở
 *   đây dùng CÙNG `lietKeTrongHopCat` (cùng lọc thư mục cấm/tên cấm) với trần mỗi thư mục lớn hơn và khai `catBot`.
 *
 * ⚠ `fs` ở tệp này CHỈ dùng `lstatSync` (phép HỎI mtime/kích thước cho khoá bộ đệm — cùng loại với `statSync` mà
 *   `programmingFileIo.census.test.ts` cố ý không tính là API chở byte). Byte nội dung chỉ đi qua `readConfined`.
 *   `chiMucMa.census.test.ts` khoá điều đó bằng AST cho cả thư mục này.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecretsOnly } from "../aiSafety";
import { duoiDuocPhep, lietKeTrongHopCat, phanQuyetDuongDan } from "../../aiLocalTools/repoSandbox";
import { confineTargetUnder, readConfined } from "../../aiLocalTools/readToolsProgramming";

/** Họ ngôn ngữ mà bộ trích ký hiệu hiểu. `c` gồm cả C++ (`.c .h .cpp .hpp`). */
export type NgonNgu = "ts" | "py" | "cs" | "java" | "kt" | "go" | "rs" | "c";

const NGON_NGU_THEO_DUOI: ReadonlyMap<string, NgonNgu> = new Map([
  [".ts", "ts"], [".tsx", "ts"], [".mts", "ts"], [".cts", "ts"],
  [".js", "ts"], [".jsx", "ts"], [".mjs", "ts"], [".cjs", "ts"],
  [".py", "py"], [".pyi", "py"],
  [".cs", "cs"],
  [".java", "java"],
  [".kt", "kt"],
  [".go", "go"],
  [".rs", "rs"],
  [".c", "c"], [".h", "c"], [".cpp", "c"], [".hpp", "c"],
]);

/**
 * Ngôn ngữ của một tệp — `null` nếu đuôi không thuộc bộ trích HOẶC không thuộc danh sách TRẮNG của hộp cát (hai
 * điều kiện độc lập: một đuôi mới thêm vào bảng trên mà hộp cát chưa cho đọc vẫn bị chặn).
 */
export function ngonNguCuaTep(ten: string): NgonNgu | null {
  if (!duoiDuocPhep(ten)) return null;
  return NGON_NGU_THEO_DUOI.get(path.extname(ten).toLowerCase()) ?? null;
}

/** Byte tối đa đọc từ MỘT tệp cho chỉ mục (không rời hộp cát — xem đầu tệp). 512 KiB > tệp nguồn lớn nhất repo (~354 KiB). */
export const TRAN_BYTE_TEP_MAC_DINH = 512 * 1024;
/** Số mục tối đa liệt kê trong MỘT thư mục (chống thư mục rác khổng lồ; chạm ⇒ `catBot`). */
export const TRAN_MUC_MOI_THU_MUC = 5_000;
/** Độ sâu tối đa khi duyệt cây. */
export const TRAN_DO_SAU_CHI_MUC = 16;

export type KetQuaDocChiMuc =
  | { ok: true; noiDung: string; catBot: boolean; kichThuoc: number }
  | { ok: false; ma: string };

/** Chuẩn hoá một đường TƯƠNG ĐỐI do người gọi đưa (`\` ⇒ `/`, bỏ `./`). Không phán quyết — `phanQuyetDuongDan` làm. */
export function chuanHoaRel(rel: string): string {
  return rel.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".").join("/");
}

/** Đọc MỘT tệp của dự án qua đủ bốn tầng (xem đầu tệp). Nội dung trả về ĐÃ che bí mật. */
export function docTepChiMuc(goc: string, rel: string, tranByte = TRAN_BYTE_TEP_MAC_DINH): KetQuaDocChiMuc {
  const ma = phanQuyetDuongDan(rel);
  if (ma !== null) return { ok: false, ma };
  const ten = rel.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  if (!duoiDuocPhep(ten)) return { ok: false, ma: "DENIED_EXT" };
  const cf = confineTargetUnder(goc, rel);
  if (!cf.ok) return { ok: false, ma: cf.kind === "NOT_A_FILE" ? "NOT_A_FILE" : "PATH_REJECTED" };
  const rd = readConfined(cf.target, Math.max(0, tranByte));
  if (!rd.ok) return { ok: false, ma: rd.kind };
  return { ok: true, noiDung: redactSecretsOnly(rd.content).text, catBot: rd.truncated, kichThuoc: rd.size };
}

/**
 * mtime + kích thước cho KHOÁ BỘ ĐỆM. `null` ⇔ không còn là tệp thường hợp lệ (vắng, thư mục, symlink, bị chính sách
 * cấm). `lstat` (không theo liên kết): một symlink KHÔNG BAO GIỜ là tệp chỉ mục — cùng quyết định với
 * `duyetTepDocDuoc` (liên kết có thể trỏ ra ngoài gốc).
 */
export function dauVetTep(goc: string, rel: string): { mtimeMs: number; size: number } | null {
  if (phanQuyetDuongDan(rel) !== null) return null;
  try {
    const st = fs.lstatSync(path.join(goc, chuanHoaRel(rel)));
    if (!st.isFile()) return null;
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export interface TuyChonDuyet {
  /** Số tệp tối đa thu về. */
  tranTep: number;
  /** Mốc thời gian TUYỆT ĐỐI (ms epoch) — quá mốc ⇒ dừng, `catBot`. */
  hanChot: number;
  /** Lọc tên tệp (đã qua danh sách trắng đuôi). */
  loc: (ten: string) => boolean;
  /** Bỏ qua theo `.gitignore` của gốc (`boQuaGit.ts`) — thư mục bị bỏ thì KHÔNG đi xuống. */
  boQua?: ((rel: string, laThuMuc: boolean) => boolean) | null;
  signal?: AbortSignal;
}

/**
 * Duyệt cây theo chiều rộng qua `lietKeTrongHopCat` (đã lọc thư mục cấm + tên bí mật), BỎ symlink. Thứ tự ổn định
 * (tên đã sắp ở `listConfined`). `catBot` khi chạm BẤT KỲ trần nào: số tệp, thời gian, mục/thư mục, độ sâu.
 */
export function duyetTepMa(goc: string, tc: TuyChonDuyet): { tep: string[]; catBot: boolean } {
  const tep: string[] = [];
  const hang: Array<{ rel: string; sau: number }> = [{ rel: "", sau: 0 }];
  let catBot = false;
  while (hang.length > 0) {
    if (tc.signal?.aborted || Date.now() >= tc.hanChot) {
      catBot = true;
      break;
    }
    const { rel, sau } = hang.shift()!;
    const lk = lietKeTrongHopCat(rel, goc, TRAN_MUC_MOI_THU_MUC);
    if (!lk.ok) continue;
    if (lk.catBot) catBot = true;
    for (const e of lk.muc) {
      if (tc.boQua && (e.kind === "dir" || e.kind === "file") && tc.boQua(e.relPath, e.kind === "dir")) continue;
      if (e.kind === "dir") {
        if (sau + 1 <= TRAN_DO_SAU_CHI_MUC) hang.push({ rel: e.relPath, sau: sau + 1 });
        else catBot = true;
        continue;
      }
      if (e.kind !== "file") continue;
      if (!duoiDuocPhep(e.name) || !tc.loc(e.name)) continue;
      if (tep.length >= tc.tranTep) {
        catBot = true;
        return { tep, catBot };
      }
      tep.push(e.relPath);
    }
  }
  return { tep, catBot };
}

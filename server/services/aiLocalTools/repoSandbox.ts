/**
 * ★★★ doc 78 · PHA A — **HỘP CÁT REPO: NỀN CHO CẢ PHA B (chạy lệnh) VÀ PHA C (ghi tệp).**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * QUYẾT ĐỊNH ĐANG BỊ ĐẢO, VÀ NÓ ĐƯỢC ĐẢO CÓ KIỂM SOÁT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/services/ai/repoContextService.ts` **cố ý** không đăng ký vào `toolRegistry`: LLM không
 * tự chọn được tệp, chỉ service gọi với danh sách file do NGƯỜI DÙNG nhập. Doc 78 PHA A (chủ dự án
 * duyệt 2026-08-18) đảo đúng quyết định ấy. File này là **cái giá phải trả cho phép đảo** — không
 * phải một lượt gỡ chú thích.
 *
 * ⚠ Docblock của `repoContextService` **đã được cập nhật** cùng lượt này. Để nguyên là biến nó
 * thành một lời khai SAI, và một lời khai sai trong mã an toàn nguy hiểm hơn không có lời khai nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ MỐI NGUY SỐ MỘT, NÓI THẲNG: `.env` CỦA REPO NÀY CÓ KHOÁ CSDL, `MASTER_API_KEY`,
 *     `ANH_KY_SECRET`. MỘT TOOL ĐỌC TỆP TUỲ Ý LÀ MỘT ĐƯỜNG RÒ **THẲNG VÀO CỬA SỔ CHAT** —
 *     rồi vào nhật ký, vào bộ nhớ đệm câu trả lời, vào mọi nơi câu trả lời được lưu.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐO ĐƯỢC (2026-08-18, gốc repo): **11 tệp** khớp `.env*` — `.env`, `.env.sim`, `.env.testbak`,
 * `.env.doc54F.bak`, `.env.example`, và **6 bản sao lưu** `.env.bak…`. Một danh sách cấm chép tay
 * theo TÊN sẽ trượt đúng những bản sao lưu ấy; vì thế luật ở đây là **tiền tố `.env` + danh sách
 * TRẮNG phần mở rộng**, hai lớp độc lập, mỗi lớp một mình đã đủ chặn cả 11 tệp:
 *   • lớp TÊN: `/^\.env/i` bắt cả `.env.bak-2026-08-18-truoc-bat-cong-anh`;
 *   • lớp ĐUÔI: `path.extname(".env")` = `""` và `extname(".env.sim")` = `".sim"` — **không cái
 *     nào** nằm trong danh sách trắng.
 * Cộng lớp thứ ba `redactSecretsOnly()` trên NỘI DUNG (dùng lại hàm đã có ở `ai/aiSafety.ts`,
 * KHÔNG viết bản thứ hai) cho những bí mật nằm trong tệp **được phép đọc**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ DANH SÁCH **TRẮNG** CHO PHẦN MỞ RỘNG — KHÔNG PHẢI DANH SÁCH ĐEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Danh sách đen luôn có phần tử thứ N+1 (repo này đã đếm lớp lỗi ấy **17 lần**, xem
 * `toolPermissionQuantifier.test.ts`). Một danh sách đen phần mở rộng sẽ trượt `.pfx`, `.jks`,
 * `.kdbx`, `.ovpn`, `.npmrc`, `.pgpass`, … và mỗi lần trượt là một bí mật. Danh sách trắng hỏng
 * theo chiều **AN TOÀN**: một đuôi mới (`.astro`, `.svelte`) chỉ bị **từ chối**, không bị rò.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHÔNG CÓ CỬA THỨ HAI RA ĐĨA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * File này **không nhập `node:fs`**. Mọi byte đi qua `readConfined()` của
 * `readToolsProgramming.ts` — cùng cửa mà nhóm tool lập trình dùng, cùng tầng fd chống TOCTOU,
 * cùng phép chặn hard link (`nlink > 1`). `programmingFileIo.census.test.ts` cưỡng chế bất biến ấy
 * bằng AST trên **cả thư mục** `aiLocalTools/**`, nên một `fs.readFileSync` lén ở đây ⇒ **ĐỎ**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★ MẶT TIẾP XÚC ĐỂ LẠI CHO PHA B VÀ PHA C
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `gocHopCat()`            — gốc TUYỆT ĐỐI. Pha B chạy lệnh với `cwd` = giá trị này.
 *   • `moTepTrongHopCat()`     — phán quyết ĐỌC một đường dẫn (mọi tầng, một lời gọi).
 *   • `phanQuyetDuongDan()`    — **THUẦN**, không chạm đĩa: hình dạng + cấm + đuôi. Pha C gọi nó
 *                                TRƯỚC khi hỏi `git status`, để một đường dẫn xấu bị chặn trước
 *                                cả khi sinh ra một tiến trình con.
 *   • `ThuChiByte`             — sổ ngân sách byte theo PHIÊN; pha C cộng byte GHI vào cùng sổ.
 *   • `MA_TU_CHOI_HOP_CAT`     — tập mã máy-đọc-được, dùng chung cho cả ba pha.
 * Pha C **KHÔNG** được tự viết lại phép kiểm đường dẫn: hàng rào "tệp bẩn thì từ chối" của nó là
 * một tầng **CỘNG THÊM** lên hộp cát này, không phải một cửa song song.
 */
import path from "node:path";
import { redactSecretsOnly } from "../ai/aiSafety";
import {
  confineDirUnder,
  confineTargetUnder,
  listConfined,
  readConfined,
  type ConfinedEntry,
} from "./readToolsProgramming";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ MÁY-ĐỌC-ĐƯỢC — **0 dòng im lặng là nói dối**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Mỗi mã tương ứng một **hành động khác nhau của người vận hành**, đúng luật đã dùng ở
 * `_uyQuyenAnh.ts` (`image_path_shape_unknown` ≠ `image_path_unresolved`): gộp hai lý do khác nhau
 * vào một mã là bắt người ta đi tìm một lỗi không tồn tại.
 *   • `PATH_REJECTED`   — hình dạng/thoát gốc/symlink/hard link ⇒ **sửa đường dẫn**.
 *   • `DENIED_SECRET`   — tệp nằm trong danh sách cấm bí mật ⇒ **không có đường sửa, đây là thiết kế**.
 *   • `DENIED_DIR`      — nằm trong thư mục cấm ⇒ hỏi chỗ khác.
 *   • `DENIED_EXT`      — đuôi không thuộc danh sách TRẮNG ⇒ tệp này không phải mã nguồn.
 *   • `BUDGET_EXCEEDED` — hết ngân sách byte của phiên ⇒ **chờ**, không phải hệ hỏng.
 */
export const MA_TU_CHOI_HOP_CAT = {
  PATH_REJECTED: "PATH_REJECTED",
  DENIED_SECRET: "DENIED_SECRET",
  DENIED_DIR: "DENIED_DIR",
  DENIED_EXT: "DENIED_EXT",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  NOT_FOUND: "NOT_FOUND",
  NOT_A_FILE: "NOT_A_FILE",
  NOT_A_DIRECTORY: "NOT_A_DIRECTORY",
  READ_ERROR: "READ_ERROR",
} as const;

export type MaTuChoiHopCat = (typeof MA_TU_CHOI_HOP_CAT)[keyof typeof MA_TU_CHOI_HOP_CAT];

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GỐC HỘP CÁT
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Biến môi trường để **thu hẹp** hộp cát (vd. trỏ vào một worktree). Mặc định: thư mục repo. */
export const BIEN_GOC_HOP_CAT = "AI_REPO_SANDBOX_ROOT";

/**
 * Gốc hộp cát, **luôn TUYỆT ĐỐI** (chủ dự án chốt: hộp cát = chính repo này).
 *
 * ⚠ Đọc env **tại chỗ gọi**, không nhớ đệm ở tầng module: lưới lật env theo từng ca, và một biến
 * module bị đóng băng lúc nhập sẽ làm mọi ca sau chạy trên gốc của ca đầu — đúng lớp "lưới xanh vì
 * lý do sai".
 */
export function gocHopCat(): string {
  const raw = (process.env[BIEN_GOC_HOP_CAT] ?? "").trim();
  if (raw === "") return path.resolve(process.cwd());
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(process.cwd(), raw);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHÍNH SÁCH — cấm theo THƯ MỤC · cấm theo TÊN · cho phép theo ĐUÔI
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Đoạn thư mục bị cấm — so **TỪNG ĐOẠN**, không so tiền tố chuỗi.
 * ⚠ So tiền tố chuỗi (`rel.startsWith("dist/")` như `repoContextService`) mù với
 * `client/dist/bundle.js` và với `server/node_modules/...`. Một đoạn tên `dist` ở BẤT KỲ nấc nào
 * cũng là dist.
 */
export const DOAN_THU_MUC_CAM: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "uploads",
  "coverage",
  ".superpowers",
  ".playwright-mcp",
  ".venv",
  "playwright-report",
  "test-results",
  ".vite",
  ".cache",
  "programming-workspace",
]);

/**
 * Tệp bị cấm theo TÊN. ⚠ `/^\.env/i` (không phải `/^\.env$/`) — xem khối đầu file: 6/11 tệp `.env*`
 * của repo này là bản SAO LƯU có hậu tố tự do.
 */
export const KHUON_TEP_CAM: readonly RegExp[] = [
  /^\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
  /^\.htpasswd$/i,
  /^\.gitleaks/i,
];

/**
 * Đường dẫn (tương đối, POSIX, thường) bị cấm theo TIỀN TỐ — dành cho tác tạo KHỔNG LỒ không phải
 * thư mục riêng. `knowledge/embeddings.jsonl` là **162 MB**; nó lọt lưới đuôi chỉ vì `.jsonl`
 * không nằm trong danh sách trắng, nhưng khai tường minh thì lời từ chối nói đúng lý do.
 */
export const TIEN_TO_DUONG_DAN_CAM: readonly string[] = ["knowledge/embeddings"];

/**
 * ★ DANH SÁCH **TRẮNG** — thứ một tác nhân lập trình cần đọc để trả lời *"hàm này gọi ở đâu"*.
 * Cố ý KHÔNG có: `.jsonl`, `.log`, `.pdf`, `.png`, `.zip`, `.exe`, `.gguf`, `.node`, `.map` —
 * không cái nào là mã nguồn, và mọi cái đều lớn hoặc nhị phân.
 */
export const DUOI_CHO_PHEP: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".sql",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".sh",
  ".mts",
  ".cts",
  // doc 79 — C# (dự án thử `sandbox-projects/csharp-demo`): mã nguồn + tệp dự án đều là VĂN BẢN.
  // Thiếu ba đuôi này thì `dotnet test` CHẠY được nhưng AI KHÔNG đọc/sửa được `.cs` ⇒ vòng khép
  // kín (đọc → sửa → chạy → đọc lỗi) đứt ở nhịp đầu cho C#.
  ".cs",
  ".csproj",
  ".sln",
  // ★ 2026-08-24 — đường TẠO KHUNG DỰ ÁN: một khung WPF là bất khả thi nếu thiếu `.xaml`
  // (App.xaml/MainWindow.xaml là XML văn bản thuần, cùng họ `.html`/`.xml` đã cho). Đo trước khi
  // thêm: `duoiDuocPhep("App.xaml")` = false ⇒ `apply_diff_batch` từ chối DENIED_EXT cả lô khung.
  ".xaml",
  // ★ 2026-08-24 — NGHIỆM THU LIVE lượt tạo khung ĐẦU TIÊN bắt được ngay: model 30B đưa
  //   `Resources/Strings.resx` vào khung WPF ⇒ cả lô bị từ chối `DUONG_KHONG_HOP_LE` (đúng thiết
  //   kế fail-closed, "chưa một byte nào được ghi") — nhưng `.resx` là định dạng tài nguyên CHUẨN
  //   của C#/WPF: XML văn bản thuần, cùng họ `.xaml` ngay trên. Thiếu nó thì mọi khung có chuỗi
  //   đa ngôn ngữ đều chết ở cửa. Cùng phép đo, cùng lý lẽ, cùng ngày với `.xaml`.
  ".resx",
  // ★ 2026-08-24 — quyết định chủ dự án: *"khi prompt yêu cầu tạo dự án thì vẫn tạo các file liên
  //   quan dự án được như bình thường"*. `Directory.Build.props`/`Directory.Build.targets` là tệp
  //   cấu hình MSBuild CHUẨN của mọi dự án C# nhiều tầng — XML văn bản thuần, cùng họ `.csproj`.
  //   ĐO trước khi thêm: `duoiDuocPhep("Directory.Build.props")` = false (extname `.props` không
  //   nằm trong danh sách) ⇒ trước bản vá, một khung khai tệp ấy chết ở cửa đuôi.
  ".props",
  ".targets",
]);

/**
 * ★ 2026-08-24 — DANH SÁCH TRẮNG **BASENAME** cho tệp KHÔNG-ĐUÔI, cùng lượt với quyết định chủ dự
 * án *"khi prompt yêu cầu tạo dự án thì vẫn tạo các file liên quan dự án được như bình thường"*.
 *
 * Vì sao cần một tập RIÊNG thay vì nhét vào `DUOI_CHO_PHEP`: `path.extname(".gitignore")` = `""` —
 * dotfile không-đuôi là VÔ HÌNH với phép soi đuôi, nên `.gitignore`/`.editorconfig`/`.gitattributes`
 * (tệp VĂN BẢN chuẩn của mọi dự án) bị chặn oan `DENIED_EXT` suốt từ doc 78 pha A.
 *
 * ⚠⚠ SO **BASENAME NGUYÊN VĂN** (thường hoá), KHÔNG so hậu tố — quyết định ngữ nghĩa, ghi ra:
 *   `path.extname("x.gitignore")` trả về `".gitignore"`, nên nếu nhét `".gitignore"` vào
 *   `DUOI_CHO_PHEP` thì MỌI tệp `<bất-kỳ>.gitignore` đi qua — một cái tên tuỳ ý lách được danh
 *   sách trắng chỉ bằng cách đổi đuôi. Tập này vì thế chỉ khớp khi CẢ TÊN TỆP bằng đúng một mục
 *   (`x.gitignore` vẫn bị chặn — có ca lưới ghim chiều này).
 * ⚠ NHỊ PHÂN (ico/png/font) vẫn NGOÀI mọi danh sách: đường ống này ghi VĂN BẢN — một icon "viết
 *   bằng text" là một tệp hỏng; icon/tài nguyên nhị phân để người dùng tự thêm sau.
 * ⚠ `Directory.Build.props` KHÔNG nằm ở đây dù brief gợi ý: nó CÓ đuôi (`.props` — vừa thêm ở
 *   trên) nên nhánh đuôi đã cho qua; một mục basename trùng lặp là mục CHẾT — không đột biến nào
 *   làm nó đỏ được, tức một lời khai không đo được.
 * ⚠ KHÔNG mục nào ở đây được trùng họ `.env*`/`KHUON_TEP_CAM` — lớp TÊN-CẤM chạy TRƯỚC trong
 *   `phanQuyetDuongDan`, nhưng hai lớp phải ĐỘC LẬP cùng chặn (bài học "hai lớp che nhau" §G).
 */
export const TEN_TEP_CHO_PHEP: ReadonlySet<string> = new Set([
  ".gitignore",
  ".editorconfig",
  ".gitattributes",
  // ★ 2026-08-31 · PDCA vòng 1 (T02b) — đo trên UI thật: mở `.prettierrc` bị DENIED_EXT
  // "(không có đuôi)" trong khi VSCode/Cursor mở được mọi tệp cấu hình văn bản. Bổ sung các
  // basename cấu hình PHỔ BIẾN, thuần văn bản, không mang bí mật theo cấu tạo.
  // ⚠ CỐ Ý VẮNG MẶT: `.npmrc` (mang được `_authToken` — một dòng registry token là một bí mật
  //   thật) và mọi họ `.env*` (đã cấm ở `KHUON_TEP_CAM`, hai lớp phải ĐỘC LẬP cùng chặn).
  ".prettierrc",
  ".prettierignore",
  ".dockerignore",
  ".eslintrc",
  ".nvmrc",
  "dockerfile",
  "makefile",
  "license",
]);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRẦN — số tệp/lượt · byte/tệp · byte/phiên · hạn giờ
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Byte tối đa đọc từ MỘT tệp trong một lượt. 64 KiB ≈ 1.600 dòng mã — đủ cho gần hết file repo. */
export const TRAN_BYTE_MOI_TEP = 65_536;
/**
 * Byte tối đa một PHIÊN được đưa **RA KHỎI hộp cát** trong `CUA_SO_NGAN_SACH_MS`.
 *
 * ⚠⚠ ĐƠN VỊ ĐO LÀ **BYTE RỜI HỘP CÁT**, KHÔNG PHẢI BYTE ĐỌC TỪ ĐĨA — và phân biệt ấy có tải trọng.
 * Bản nháp đầu tính cả byte `grep_repo` đọc để **quét**: 600 tệp × tới 64 KiB ⇒ trần 1 MiB cháy
 * sau đúng ~16 tệp, tức `grep_repo` **chết ngay lượt đầu** trong khi nó chỉ phát ra ≤ 80 dòng ×
 * 300 ký tự. Đó là "vá quá tay": một cái trần dựng ra để chặn RÒ lại giết đúng tính năng không rò.
 * Bề mặt rò là thứ **đi vào cửa sổ chat** (rồi vào nhật ký, vào bộ nhớ đệm câu trả lời), nên nó là
 * thứ phải đếm. Chi phí QUÉT được chặn bằng một cái trần khác, đúng loại: `TRAN_TEP_QUET` +
 * `HAN_GIO_GREP_MS`.
 */
export const TRAN_BYTE_MOI_PHIEN = 1_048_576;
/** Cửa sổ trượt của sổ ngân sách. */
export const CUA_SO_NGAN_SACH_MS = 15 * 60_000;
/** Số mục tối đa `list_files` trả về trong MỘT lượt. */
export const TRAN_MUC_LIET_KE = 300;
/**
 * Số tệp tối đa `grep_repo` được MỞ trong một lượt (trần công việc, khác trần kết quả).
 * ★ 2026-08-31 · PDCA vòng 1 (T05) — 600 là một BẢN CẮT che gần hết repo: đo thật, cây nhìn-thấy
 * của hộp cát có ~7.616 tệp, và một lượt tìm "StreamingSecretRedactor" (có ≥5 tệp nguồn khớp) trả
 * đúng 1 kết quả vì quét dừng ở tệp thứ 600. Nâng lên 9.000 để phủ trọn cây hiện tại (+dư); cầu
 * chì CPU THẬT vẫn là `HAN_GIO_GREP_MS` — quá hạn thì trả bản cắt CÓ KHAI, đúng như cũ.
 */
export const TRAN_TEP_QUET = 9_000;
/**
 * ★ 2026-08-31 · PDCA vòng 1 — trần cho CHỈ MỤC PHẲNG (`listFiles phang:true`, Ctrl+P/@-mention).
 * Đo thật: cây nhìn-thấy ~7.616 tệp ⇒ 12.000 phủ trọn + dư; hạn chót 3s là cầu chì thời gian
 * (cùng khuôn trần-kép của `duyetTepDocDuoc`). Vượt trần/hạn ⇒ `truncated:true` — client PHẢI
 * hiện cờ, không được im lặng (bài "bản cắt không khai là lời nói dối").
 */
export const TRAN_TEP_PHANG = 12_000;
export const HAN_CHOT_PHANG_MS = 3_000;
/** Số kết quả tối đa `grep_repo` trả về. */
export const TRAN_KET_QUA_GREP = 80;
/** Hạn giờ cho một lượt `grep_repo`. Quét cả repo có thể lâu tuỳ ổ đĩa ⇒ trả BẢN CẮT, không treo. */
export const HAN_GIO_GREP_MS = 4_000;
/** Trần độ sâu đệ quy của `grep_repo`/`list_files`. */
export const TRAN_DO_SAU = 12;
/**
 * Trần số mục của sổ ngân sách. Không có nó, một hệ nhiều người dùng sẽ rò bộ nhớ đúng bằng số
 * danh tính từng gọi tool — cùng lý lẽ với `TRAN_MUC` ở `_uyQuyenAnh.ts`.
 */
export const TRAN_MUC_SO_NGAN_SACH = 5_000;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÁN QUYẾT ĐƯỜNG DẪN — **THUẦN**, không chạm đĩa
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `null` ⇔ đường dẫn ĐƯỢC PHÉP theo chính sách. Không nói gì về việc nó có tồn tại hay không —
 * đó là việc của `moTepTrongHopCat()`.
 *
 * ⚠ Hàm này KHÔNG thay `confineTargetUnder`. Thứ tự bắt buộc là **chính sách trước, đĩa sau**: một
 * đường dẫn tới `.env` phải bị từ chối **trước** khi có bất kỳ lượt `stat` nào, để lời từ chối
 * không rò cả thông tin "tệp ấy có tồn tại không".
 */
export function phanQuyetDuongDan(input: unknown): MaTuChoiHopCat | null {
  if (typeof input !== "string") return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
  const raw = input.trim();
  if (raw === "") return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
  if (raw.includes("\0")) return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
  if (path.isAbsolute(raw)) return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;

  const doan = raw.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  if (doan.length === 0) return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
  for (const d of doan) {
    if (d === "..") return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
    // ⚠ TỪNG ĐOẠN — tiền lệ `_uyQuyenAnh.ts:180`: `C:` ở GIỮA đường dẫn lọt qua phép soi đầu chuỗi.
    if (/^[a-zA-Z]:/.test(d)) return MA_TU_CHOI_HOP_CAT.PATH_REJECTED;
  }

  const relThuong = doan.join("/").toLowerCase();
  for (const d of doan) {
    if (DOAN_THU_MUC_CAM.has(d.toLowerCase())) return MA_TU_CHOI_HOP_CAT.DENIED_DIR;
  }
  for (const tt of TIEN_TO_DUONG_DAN_CAM) {
    if (relThuong.startsWith(tt.toLowerCase())) return MA_TU_CHOI_HOP_CAT.DENIED_DIR;
  }

  const ten = doan[doan.length - 1]!;
  for (const kh of KHUON_TEP_CAM) {
    if (kh.test(ten)) return MA_TU_CHOI_HOP_CAT.DENIED_SECRET;
  }
  return null;
}

/** Như trên nhưng cho một THƯ MỤC: bỏ phép kiểm ĐUÔI, giữ mọi phép kiểm còn lại. `""` = gốc. */
export function phanQuyetThuMuc(input: unknown): MaTuChoiHopCat | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw === "" || raw === "." || raw === "./" || raw === ".\\") return null;
  return phanQuyetDuongDan(raw);
}

/**
 * Phán quyết TÊN TỆP theo danh sách trắng — tách riêng vì `phanQuyetThuMuc` không dùng nó.
 *
 * ★ 2026-08-24 — thêm nhánh **BASENAME** (`TEN_TEP_CHO_PHEP`) NGAY TRONG hàm này thay vì một hàm
 * mới: mọi điểm gọi hiện có (`moTepTrongHopCat` đọc · `duyetTepDocDuoc` quét grep ·
 * `applyDiff.phanQuyet` ghi · `kiemManifest` tạo khung) hưởng CÙNG LÚC, không điểm nào phải nhớ
 * gọi thêm hàm thứ hai. Đã rà cả bốn điểm gọi: không nơi nào cần ngữ nghĩa "chỉ-đuôi" thuần.
 * ⚠ Nhánh basename so NGUYÊN VĂN tên tệp (thường hoá) — `x.gitignore` KHÔNG khớp (xem docblock
 *   `TEN_TEP_CHO_PHEP` về bẫy `path.extname("x.gitignore") === ".gitignore"`).
 */
export function duoiDuocPhep(ten: string): boolean {
  if (TEN_TEP_CHO_PHEP.has(ten.toLowerCase())) return true;
  return DUOI_CHO_PHEP.has(path.extname(ten).toLowerCase());
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SỔ NGÂN SÁCH BYTE THEO PHIÊN
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Khoá là **danh tính phiên THẬT** (`__authCtx.userId`), không phải một id do model đưa: model
 * đổi khoá là reset được trần, tức trần thành trang trí. `argsWithAuthCtx` đã bảo đảm `__authCtx`
 * chỉ đến từ `ToolExecContext.user`.
 */
interface MucNganSach {
  daDung: number;
  hetHan: number;
}

const soNganSach = new Map<string, MucNganSach>();

export interface ThuChiByte {
  /** Byte còn được rút trong cửa sổ hiện tại. */
  conLai: number;
  /** Byte đã rút. */
  daDung: number;
}

export function nganSachConLai(khoa: string, bayGio = Date.now()): ThuChiByte {
  const m = soNganSach.get(khoa);
  if (m === undefined || m.hetHan <= bayGio) return { conLai: TRAN_BYTE_MOI_PHIEN, daDung: 0 };
  return { conLai: Math.max(0, TRAN_BYTE_MOI_PHIEN - m.daDung), daDung: m.daDung };
}

/** Ghi nhận đã rút `byte`. Trả trạng thái SAU khi ghi. */
export function tieuNganSach(khoa: string, byte: number, bayGio = Date.now()): ThuChiByte {
  const cu = soNganSach.get(khoa);
  if (soNganSach.size >= TRAN_MUC_SO_NGAN_SACH && cu === undefined) {
    // Map giữ thứ tự CHÈN ⇒ mục cũ nhất đứng đầu; đuổi theo lô để không phải sắp xếp.
    let can = Math.max(1, Math.floor(TRAN_MUC_SO_NGAN_SACH / 10));
    for (const k of soNganSach.keys()) {
      soNganSach.delete(k);
      if (--can <= 0) break;
    }
  }
  const m = cu !== undefined && cu.hetHan > bayGio ? cu : { daDung: 0, hetHan: bayGio + CUA_SO_NGAN_SACH_MS };
  m.daDung += Math.max(0, byte);
  soNganSach.set(khoa, m);
  return { conLai: Math.max(0, TRAN_BYTE_MOI_PHIEN - m.daDung), daDung: m.daDung };
}

/** Chỉ dùng trong lưới — một ca không được kế thừa ngân sách của ca trước. */
export function xoaSoNganSach(): void {
  soNganSach.clear();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐỌC MỘT TỆP — mọi tầng, MỘT lời gọi
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type KetQuaDocTep =
  | {
      ok: true;
      /** POSIX-style, tương đối với gốc hộp cát. */
      relPath: string;
      /** Nội dung đã qua `redactSecretsOnly()`. */
      noiDung: string;
      /** Kích thước THẬT trên đĩa (có thể lớn hơn `noiDung.length` khi bị cắt). */
      byteTrenDia: number;
      catBot: boolean;
      /** `true` ⇔ `redactSecretsOnly` đã thay ít nhất một chỗ. */
      daChe: boolean;
    }
  | { ok: false; ma: MaTuChoiHopCat; chiTiet: string };

export interface TuyChonDocTep {
  /** Trần byte cho lượt này. Bị kẹp xuống `TRAN_BYTE_MOI_TEP` và xuống ngân sách còn lại. */
  tranByte?: number;
  /**
   * Khoá ngân sách (danh tính phiên). Đặt **CHỈ KHI** nội dung đọc được sẽ đi vào câu trả lời.
   * Bỏ trống ⇒ lượt đọc là **công việc nội bộ** (vd. `grep_repo` quét để tìm dòng khớp) và không
   * bị trừ — xem khối lý lẽ ở `TRAN_BYTE_MOI_PHIEN`.
   */
  khoaNganSach?: string;
  /** Gốc hộp cát. Bỏ trống ⇒ `gocHopCat()`. */
  goc?: string;
}

/**
 * ★ CỬA DUY NHẤT của mọi lượt ĐỌC trong hộp cát repo. Thứ tự các tầng **có tải trọng**:
 *   1. **CHÍNH SÁCH** (thuần, không chạm đĩa) — cấm/đuôi. Trước cả `stat`, nên một lượt từ chối
 *      không rò cả sự tồn tại của tệp.
 *   2. **NGÂN SÁCH** — hết thì dừng ngay, không mở tệp nào.
 *   3. **HỘP CÁT** (`confineTargetUnder`) — hình dạng → realpath (symlink/junction) → thư mục? →
 *      `nlink > 1`? Đây là cửa đã có, đã bị đột biến nhiều vòng; **không viết lại**.
 *   4. **fd** (`readConfined`) — `isFile`/`nlink`/`size` hỏi trên **chính fd** sắp đọc (chống
 *      TOCTOU).
 *   5. **CHE BÍ MẬT** (`redactSecretsOnly`) — lớp cuối cho tệp ĐƯỢC PHÉP đọc.
 */
export function moTepTrongHopCat(duongDan: unknown, tuyChon: TuyChonDocTep = {}): KetQuaDocTep {
  const ma = phanQuyetDuongDan(duongDan);
  if (ma !== null) return { ok: false, ma, chiTiet: String(duongDan ?? "") };
  const ten = String(duongDan).replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  if (!duoiDuocPhep(ten)) {
    return { ok: false, ma: MA_TU_CHOI_HOP_CAT.DENIED_EXT, chiTiet: path.extname(ten) || "(không có đuôi)" };
  }

  const goc = tuyChon.goc ?? gocHopCat();
  let tran = Math.max(0, Math.min(tuyChon.tranByte ?? TRAN_BYTE_MOI_TEP, TRAN_BYTE_MOI_TEP));
  if (tuyChon.khoaNganSach) {
    const ns = nganSachConLai(tuyChon.khoaNganSach);
    if (ns.conLai <= 0) {
      return { ok: false, ma: MA_TU_CHOI_HOP_CAT.BUDGET_EXCEEDED, chiTiet: `${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}` };
    }
    tran = Math.min(tran, ns.conLai);
  }

  const confined = confineTargetUnder(goc, duongDan);
  if (!confined.ok) {
    if (confined.kind === "NOT_A_FILE") return { ok: false, ma: MA_TU_CHOI_HOP_CAT.NOT_A_FILE, chiTiet: String(duongDan) };
    return { ok: false, ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED, chiTiet: confined.reason };
  }

  const rd = readConfined(confined.target, tran);
  if (!rd.ok) {
    if (rd.kind === "NOT_FOUND") return { ok: false, ma: MA_TU_CHOI_HOP_CAT.NOT_FOUND, chiTiet: confined.target.relPath };
    if (rd.kind === "NOT_A_FILE") return { ok: false, ma: MA_TU_CHOI_HOP_CAT.NOT_A_FILE, chiTiet: confined.target.relPath };
    if (rd.kind === "PATH_REJECTED") return { ok: false, ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED, chiTiet: rd.reason };
    return { ok: false, ma: MA_TU_CHOI_HOP_CAT.READ_ERROR, chiTiet: rd.message };
  }

  if (tuyChon.khoaNganSach) tieuNganSach(tuyChon.khoaNganSach, rd.content.length);
  const che = redactSecretsOnly(rd.content);
  return {
    ok: true,
    relPath: confined.target.relPath,
    noiDung: che.text,
    byteTrenDia: rd.size,
    catBot: rd.truncated,
    daChe: che.text !== rd.content,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LIỆT KÊ / DUYỆT CÂY
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type KetQuaLietKe =
  | { ok: true; relPath: string; muc: ConfinedEntry[]; catBot: boolean }
  | { ok: false; ma: MaTuChoiHopCat; chiTiet: string };

/**
 * Liệt kê MỘT nấc, đã lọc theo chính sách: thư mục cấm và tệp bí mật **không hiện ra**.
 *
 * ⚠ Lọc ở đây là một quyết định an ninh, không phải mỹ quan: hiện tên `.env` ra cũng đã là rò
 * thông tin (nó xác nhận tệp tồn tại, và mời model thử đọc rồi ăn một lượt từ chối vô ích).
 * ⚠ Tệp có đuôi NGOÀI danh sách trắng thì **VẪN hiện** — người kỹ sư cần biết `foo.png` có ở đó;
 * cái bị chặn là ĐỌC nội dung, không phải biết tên. Ranh giới ấy đúng bằng ranh giới giữa
 * `DENIED_EXT` (một lượt từ chối đọc) và `DENIED_SECRET` (một sự tồn tại không được thừa nhận).
 */
export function lietKeTrongHopCat(duongDan: unknown, goc?: string, tran = TRAN_MUC_LIET_KE): KetQuaLietKe {
  const ma = phanQuyetThuMuc(duongDan);
  if (ma !== null) return { ok: false, ma, chiTiet: String(duongDan ?? "") };

  const cd = confineDirUnder(goc ?? gocHopCat(), duongDan);
  if (!cd.ok) {
    if (cd.kind === "NOT_FOUND") return { ok: false, ma: MA_TU_CHOI_HOP_CAT.NOT_FOUND, chiTiet: String(duongDan ?? "") };
    if (cd.kind === "NOT_A_DIRECTORY") {
      return { ok: false, ma: MA_TU_CHOI_HOP_CAT.NOT_A_DIRECTORY, chiTiet: String(duongDan ?? "") };
    }
    return { ok: false, ma: MA_TU_CHOI_HOP_CAT.PATH_REJECTED, chiTiet: cd.reason };
  }

  const lk = listConfined(cd.dir, tran);
  if (!lk.ok) return { ok: false, ma: MA_TU_CHOI_HOP_CAT.READ_ERROR, chiTiet: lk.message };

  const muc = lk.entries.filter((e) => {
    if (e.kind === "dir" && DOAN_THU_MUC_CAM.has(e.name.toLowerCase())) return false;
    if (KHUON_TEP_CAM.some((k) => k.test(e.name))) return false;
    if (TIEN_TO_DUONG_DAN_CAM.some((t) => e.relPath.toLowerCase().startsWith(t.toLowerCase()))) return false;
    return true;
  });
  return { ok: true, relPath: cd.dir.relPath, muc, catBot: lk.truncated };
}

/**
 * Duyệt cây theo chiều rộng, trả về **đường dẫn tương đối của những TỆP ĐỌC ĐƯỢC**.
 * Trần kép: `tranTep` (số tệp) và `hanChot` (mốc thời gian tuyệt đối). Dừng ở cái nào tới trước và
 * **khai ra** đã dừng vì lý do gì — một danh sách bị cắt mà không khai là một lời nói dối.
 */
export function duyetTepDocDuoc(
  goc: string,
  batDau: string,
  tranTep: number,
  hanChot: number,
  tranDoSau = TRAN_DO_SAU,
): { tep: string[]; hetGio: boolean; hetTran: boolean } {
  const tep: string[] = [];
  const hangDoi: Array<{ rel: string; sau: number }> = [{ rel: batDau, sau: 0 }];
  let hetGio = false;
  while (hangDoi.length > 0) {
    if (Date.now() >= hanChot) {
      hetGio = true;
      break;
    }
    if (tep.length >= tranTep) break;
    const { rel, sau } = hangDoi.shift()!;
    const lk = lietKeTrongHopCat(rel, goc, TRAN_MUC_LIET_KE);
    if (!lk.ok) continue;
    for (const e of lk.muc) {
      if (e.kind === "dir") {
        if (sau + 1 <= tranDoSau) hangDoi.push({ rel: e.relPath, sau: sau + 1 });
        continue;
      }
      // ⚠ `symlink` KHÔNG được đưa vào danh sách quét: nó có thể trỏ ra ngoài gốc, và một lượt
      //   `readConfined` sẽ từ chối nó — nhưng đưa vào rồi bị từ chối là đốt trần `tranTep` cho
      //   những mục chắc chắn hỏng. Người dùng vẫn ĐỌC được nó bằng `read_file` (và vẫn bị cửa
      //   realpath phán quyết ở đó) nếu họ nêu tên tường minh.
      if (e.kind !== "file") continue;
      if (!duoiDuocPhep(e.name)) continue;
      if (tep.length >= tranTep) break;
      tep.push(e.relPath);
    }
  }
  return { tep, hetGio, hetTran: tep.length >= tranTep };
}

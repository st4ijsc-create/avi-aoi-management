/**
 * ★ Đợt 10.4b L0a (kế hoạch v2.1 §2 D3 + rà kiem-dinh M3/M4/N6/6b-1) — DANH SÁCH CẤM TỆP **DÙNG CHUNG**:
 *   • hộp cát máy chủ (`server/services/aiLocalTools/repoSandbox.ts` — năm danh sách CƠ SỞ dưới đây chuyển từ đó sang, xuất lại ở đó);
 *   • tool đọc / tìm / liệt kê khi model là AI NGOÀI (máy chủ) — lớp `…Ngoai` chặt hơn;
 *   • host extension VSCode (tool chạy trên MÁY NGƯỜI DÙNG — máy chủ không ép được, nên host dùng CÙNG module này).
 *
 * THUẦN: không nhập `node:*` (chạy được ở extension host lẫn máy chủ). Phép chạm đĩa duy nhất (realpath — symlink/junction thoát gốc)
 * do người gọi TIÊM vào `phanQuyetTepNgoaiThuc`.
 *
 * Thứ tự phán (tệp, AI ngoài): chuẩn hoá (hỏng ⇒ PATH_REJECTED) → thư mục cấm (từng ĐOẠN) → tiền tố cấm → tên bí mật (cơ sở + mở rộng)
 * → đuôi cấm → danh sách TRẮNG đuôi/tên (ngoài ⇒ DENIED_EXT). Mọi lớp hỏng theo chiều AN TOÀN (từ chối).
 * Giới hạn đã khai: rào theo TÊN/ĐƯỜNG DẪN — không thay bộ che nội dung ở cổng (lớp sau) và không thay trách nhiệm người dùng với
 * nội dung tệp được phép.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CƠ SỞ (chuyển nguyên văn từ repoSandbox.ts — hộp cát máy chủ dùng đúng các tập này)
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
  // ★ 2026-10-17 · Đợt 1 — bộ đo F: 2/2 bài Python TRƯỢT vì `read_file` từ chối `.py` (model nói thật "không đọc
  //   được tệp .py" rồi dừng). Mục tiêu "dự án bất kỳ" đòi các ngôn ngữ nguồn VĂN BẢN phổ biến. Tất cả là văn bản
  //   thuần; bí mật (`.env*`, `.pem`, `.key`…) vẫn bị `KHUON_TEP_CAM` chặn độc lập, nhị phân/tệp chạy được của
  //   hệ điều hành (`.exe .dll .pyc .bat .cmd .ps1`) vẫn NGOÀI danh sách (lưới §D3 ghim cả hai chiều).
  ".py",
  ".pyi",
  ".ini",
  ".cfg",
  ".xml",
  ".java",
  ".kt",
  ".go",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".vue",
  ".svelte",
  // PLC (Structured Text / SCL) — văn bản; corpus lập trình PLC đã có từ trước.
  ".st",
  ".scl",
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
// AI NGOÀI — lớp CHẶT HƠN (tool đọc/tìm/liệt kê + ngữ cảnh tự đính kèm khi model là `ngoai:…`)
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Mã từ chối — cùng tên với `MA_TU_CHOI_HOP_CAT` của hộp cát máy chủ ở các mã trùng nghĩa. */
export const MA_TU_CHOI_NGOAI = {
  PATH_REJECTED: "PATH_REJECTED",
  DENIED_DIR: "DENIED_DIR",
  DENIED_SECRET: "DENIED_SECRET",
  DENIED_EXT: "DENIED_EXT",
} as const;
export type MaTuChoiNgoai = (typeof MA_TU_CHOI_NGOAI)[keyof typeof MA_TU_CHOI_NGOAI];

/**
 * Thư mục cấm cho AI ngoài = cơ sở + dữ liệu cục bộ (sao lưu, kho tri thức, model, nhật ký) + cấu hình định danh của máy người dùng
 * (`.ssh`, `.aws`, `.kube`…) + thư mục phiên Claude. So TỪNG ĐOẠN đã thường hoá.
 */
export const DOAN_THU_MUC_CAM_NGOAI: ReadonlySet<string> = new Set([
  ...DOAN_THU_MUC_CAM,
  "backups",
  "knowledge",
  "models",
  "logs",
  ".claude",
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
  ".gnupg",
  ".docker",
  ".config",
  "secrets",
  "credentials",
]);

/**
 * Tên tệp cấm THÊM cho AI ngoài (rà kiem-dinh 6b-1: `*.json/*.yaml/*.md/*.toml` được phép theo đuôi vẫn có thể mang bí mật ⇒ chặn theo
 * TÊN gợi bí mật). Hỏng theo chiều an toàn: `tokenizer.ts` cũng bị chặn — cái giá chấp nhận được cho model NGOÀI.
 */
export const KHUON_TEN_CAM_NGOAI: readonly RegExp[] = [
  /^id_/i,
  /^[._]netrc$/i,
  /^\.pypirc$/i,
  /^\.git-credentials$/i,
  /^\.dockercfg$/i,
  /^kubeconfig/i,
  /secret/i,
  /credential/i,
  /password/i,
  /passwd/i,
  /token/i,
  /^appsettings.*\.json$/i,
  /^docker-compose.*\.ya?ml$/i,
  /\.local\./i,
  /\.prod\./i,
  // ★ L0a-b (rà kiem-dinh) — tên gợi bí mật lọt qua danh sách trắng .json / .txt / .ini
  /(^|[._-])keys?([._-]|$)/i,
  /service.?account/i,
  /admin.?sdk/i,
  /private/i,
  /api.?key/i,
  /vault/i,
  /wallet/i,
];

/** Đuôi cấm cho AI ngoài: dữ liệu / bản dump / sao lưu / nhật ký (`.sql` có trong danh sách trắng CƠ SỞ — ở đây bị gỡ). */
export const DUOI_CAM_NGOAI: ReadonlySet<string> = new Set([".sql", ".dump", ".bak", ".csv", ".tsv", ".log", ".sqlite", ".db"]);

/** Danh sách TRẮNG đuôi cho AI ngoài = cơ sở trừ `DUOI_CAM_NGOAI`. */
export const DUOI_CHO_PHEP_NGOAI: ReadonlySet<string> = new Set([...DUOI_CHO_PHEP].filter((d) => !DUOI_CAM_NGOAI.has(d)));

/** Byte tối đa một tệp được đưa tới AI ngoài; vượt ⇒ cắt (người gọi khai cắt). */
export const TRAN_BYTE_TEP_NGOAI = 65_536;

export type KetQuaChuanHoa = { ok: true; doan: string[]; rel: string } | { ok: false };

const laTuyetDoi = (s: string): boolean => s.startsWith("/") || /^[a-zA-Z]:/.test(s);

function boTienToThietBi(s: string): string {
  // `\\?\C:\…` · `\\.\C:\…` (đã đổi `\` ⇒ `/`) — tiền tố đường dẫn dài / thiết bị Windows trỏ CÙNG tệp
  return /^\/\/[?.]\//.test(s) ? s.slice(4) : s;
}

function chuanHoaGoc(goc: string): string {
  return boTienToThietBi(goc.trim().replace(/\\/g, "/"))
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Chuẩn hoá một đường dẫn (tương đối, hoặc tuyệt đối khi có `goc`) thành các ĐOẠN thường hoá — mọi biến thể trỏ CÙNG tệp trên Windows
 * gộp về một dạng TRƯỚC khi so:
 *   • `\` ⇒ `/`; tiền tố `\\?\` / `\\.\` bị bóc; UNC (`//máy/chia-sẻ`) ⇒ từ chối;
 *   • chữ hoa/thường (`.ENV` ≡ `.env`); dấu chấm / khoảng trắng CUỐI mỗi đoạn (`.env.` ≡ `.env ` ≡ `.env`);
 *   • `..` ⇒ từ chối (không "chuẩn hoá" lên trên — người gọi tự giam trong gốc); `:` trong một đoạn (luồng ADS `.env::$DATA`,
 *     ổ đĩa giữa chuỗi) ⇒ từ chối; tên ngắn 8.3 (`ENV~1`) ⇒ từ chối (không giải được bí danh khi không chạm đĩa);
 *   • ký tự điều khiển ⇒ từ chối.
 */
export function chuanHoaDuongDanNgoai(input: unknown, goc?: string): KetQuaChuanHoa {
  if (typeof input !== "string") return { ok: false };
  let s = input.trim();
  // eslint-disable-next-line no-control-regex
  if (s === "" || /[\u0000-\u001f]/.test(s)) return { ok: false };
  s = boTienToThietBi(s.replace(/\\/g, "/"));
  if (s.startsWith("//")) return { ok: false };
  if (goc !== undefined && laTuyetDoi(s)) {
    const g = chuanHoaGoc(goc);
    const t = s.replace(/\/+$/, "").toLowerCase();
    if (t === g) s = "";
    else if (t.startsWith(`${g}/`)) s = s.slice(g.length + 1);
    else return { ok: false };
  }
  if (laTuyetDoi(s)) return { ok: false };
  const doan: string[] = [];
  for (const tho of s.split("/")) {
    if (tho === "" || tho === ".") continue;
    if (tho === "..") return { ok: false };
    const d = tho.replace(/[. ]+$/, "");
    if (d === "") return { ok: false };
    if (d.includes(":")) return { ok: false };
    if (/~\d/.test(d)) return { ok: false };
    doan.push(d.toLowerCase());
  }
  return { ok: true, doan, rel: doan.join("/") };
}

function duoiCua(ten: string): string {
  const i = ten.lastIndexOf(".");
  return i > 0 ? ten.slice(i) : "";
}

function phanQuyetDoan(doan: string[], laTep: boolean): MaTuChoiNgoai | null {
  for (const d of doan) if (DOAN_THU_MUC_CAM_NGOAI.has(d)) return MA_TU_CHOI_NGOAI.DENIED_DIR;
  const rel = doan.join("/");
  for (const tt of TIEN_TO_DUONG_DAN_CAM) if (rel.startsWith(tt.toLowerCase())) return MA_TU_CHOI_NGOAI.DENIED_DIR;
  if (!laTep) return null;
  const ten = doan[doan.length - 1]!;
  if (KHUON_TEP_CAM.some((k) => k.test(ten)) || KHUON_TEN_CAM_NGOAI.some((k) => k.test(ten))) return MA_TU_CHOI_NGOAI.DENIED_SECRET;
  // `config/*local*` (6b-1): cấu hình CỤC BỘ của môi trường (ghi đè bí mật) nằm dưới một thư mục `config`
  if (doan.slice(0, -1).includes("config") && ten.includes("local")) return MA_TU_CHOI_NGOAI.DENIED_SECRET;
  const duoi = duoiCua(ten);
  if (DUOI_CAM_NGOAI.has(duoi)) return MA_TU_CHOI_NGOAI.DENIED_EXT;
  if (TEN_TEP_CHO_PHEP.has(ten) || DUOI_CHO_PHEP_NGOAI.has(duoi)) return null;
  return MA_TU_CHOI_NGOAI.DENIED_EXT;
}

/** Phán quyết ĐỌC một TỆP cho AI ngoài (thuần, không chạm đĩa). `null` = được phép. */
export function phanQuyetTepNgoai(input: unknown, goc?: string): MaTuChoiNgoai | null {
  const c = chuanHoaDuongDanNgoai(input, goc);
  if (!c.ok || c.doan.length === 0) return MA_TU_CHOI_NGOAI.PATH_REJECTED;
  return phanQuyetDoan(c.doan, true);
}

/** Phán quyết LIỆT KÊ / ĐI VÀO một THƯ MỤC (bỏ phép tên/đuôi; gốc rỗng = được). */
export function phanQuyetThuMucNgoai(input: unknown, goc?: string): MaTuChoiNgoai | null {
  if (typeof input === "string" && /^\s*(\.[\\/]?)?\s*$/.test(input)) return null;
  const c = chuanHoaDuongDanNgoai(input, goc);
  if (!c.ok) return MA_TU_CHOI_NGOAI.PATH_REJECTED;
  return phanQuyetDoan(c.doan, false);
}

export interface ChamDia {
  /** Thư mục workspace (gốc). */
  goc: string;
  /** `realpath` do người gọi TIÊM (máy chủ: `fs.promises.realpath`; extension host: `fs.promises.realpath`). */
  realpath: (p: string) => Promise<string>;
}

/** Kết quả phán có chạm đĩa: được ⇒ `duongThuc` = đường dẫn ĐÃ GIẢI (sau symlink / junction) mà tool PHẢI mở — không mở lại đường gốc. */
export type KetQuaGiai = { ok: true; duongThuc: string } | { ok: false; ma: MaTuChoiNgoai };

async function giaiNgoai(input: unknown, o: ChamDia, laTep: boolean): Promise<KetQuaGiai> {
  const phan = laTep ? phanQuyetTepNgoai : phanQuyetThuMucNgoai;
  const ma = phan(input, o.goc);
  if (ma) return { ok: false, ma };
  // realpath nhận đường dẫn GIỮ NGUYÊN hoa-thường (hệ tệp phân biệt hoa-thường) — đã qua phép thuần nên không còn `..`/ADS/8.3
  const tho = String(input).trim();
  const goc = o.goc.replace(/[\\/]+$/, "");
  const duong = laTuyetDoi(tho.replace(/\\/g, "/")) || /^[\\/]{2}[?.][\\/]/.test(tho) ? tho : tho === "" || tho === "." ? goc : `${goc}/${tho}`;
  try {
    const [thuc, gocThuc] = await Promise.all([o.realpath(duong), o.realpath(goc)]);
    const ma2 = phan(thuc, gocThuc);
    return ma2 ? { ok: false, ma: ma2 } : { ok: true, duongThuc: thuc };
  } catch {
    return { ok: false, ma: MA_TU_CHOI_NGOAI.PATH_REJECTED };
  }
}

/**
 * Phán quyết TỆP có CHẠM ĐĨA: đường dẫn phải qua phép thuần VÀ đường dẫn THẬT (sau symlink / junction) phải còn trong gốc thật và cũng
 * qua phép thuần — `src/cauhinh.ts` là symlink tới `../.env` ⇒ bị chặn ở lần phán thứ hai. Lỗi realpath ⇒ PATH_REJECTED.
 * ★ L0a-b (rà kiem-dinh, TOCTOU) — trả `duongThuc`: tool ĐỌC ĐÚNG đường đã giải (đổi symlink sau lúc phán không đổi được tệp bị đọc).
 *   Giới hạn đã khai: một THƯ MỤC trung gian bị thay bằng symlink giữa lúc giải và lúc mở vẫn là cửa sổ đua — người gọi nên mở với cờ
 *   không theo symlink khi hệ điều hành có (máy chủ: `readConfined` của hộp cát kiểm `nlink`/fd); module thuần không đóng được cửa này.
 */
export function giaiTepNgoai(input: unknown, o: ChamDia): Promise<KetQuaGiai> {
  return giaiNgoai(input, o, true);
}

/** ★ L0a-b — như `giaiTepNgoai` cho THƯ MỤC (liệt kê / gốc tìm đệ quy): symlink thư mục trỏ ra ngoài gốc hoặc vào thư mục cấm ⇒ chặn. */
export function giaiThuMucNgoai(input: unknown, o: ChamDia): Promise<KetQuaGiai> {
  return giaiNgoai(input, o, false);
}

/** Dạng rút gọn của `giaiTepNgoai`: chỉ mã (`null` = được). */
export async function phanQuyetTepNgoaiThuc(input: unknown, o: ChamDia): Promise<MaTuChoiNgoai | null> {
  const r = await giaiTepNgoai(input, o);
  return r.ok ? null : r.ma;
}

/**
 * Lọc KẾT QUẢ của tool tìm (`grep` / `find_files` / `search_code` / `find_symbol`) và liệt kê: bỏ mọi mục mà đường dẫn bị cấm
 * (`grep -r pass` không được lòi dòng từ `.env`). Trả số mục bị bỏ để người gọi KHAI (bản cắt không khai là lời nói dối).
 */
export function locKetQuaTimNgoai<T>(ds: readonly T[], layDuong: (t: T) => string, goc?: string): { giu: T[]; soBoDi: number } {
  const giu = ds.filter((t) => phanQuyetTepNgoai(layDuong(t), goc) === null);
  return { giu, soBoDi: ds.length - giu.length };
}

/**
 * ★ L0a-b — như `locKetQuaTimNgoai` nhưng giải `realpath` TỪNG mục: tìm đệ quy đi qua symlink thư mục (`src/lien-ket → ../uploads`) ⇒
 * mục có đường THẬT bị cấm / ra ngoài gốc bị bỏ dù đường hiển thị trông vô hại.
 */
export async function locKetQuaTimNgoaiThuc<T>(ds: readonly T[], layDuong: (t: T) => string, o: ChamDia): Promise<{ giu: T[]; soBoDi: number }> {
  const ok = await Promise.all(ds.map(async (t) => (await giaiTepNgoai(layDuong(t), o)).ok));
  const giu = ds.filter((_, i) => ok[i]);
  return { giu, soBoDi: ds.length - giu.length };
}

/** Nội dung có NUL trong 8 000 ký tự đầu ⇒ coi là nhị phân ⇒ không gửi. */
export function laNoiDungNhiPhan(s: string): boolean {
  return s.slice(0, 8000).includes("\u0000");
}

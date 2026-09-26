/**
 * ★★★ 2026-08-24 — **KHUNG DỰ ÁN C# BẰNG `dotnet new` (khung CHUẨN Microsoft) + GIỮ LỚP DUYỆT DIFF.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO FILE NÀY TỒN TẠI — VÀ VÌ SAO NÓ **KHÔNG** NẰM TRONG `aiLocalTools/`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường tạo khung cũ để MODEL 30B tự viết csproj/xaml. Đo LIVE 2026-08-24: model sai chuẩn nhiều
 * lần (csproj tham chiếu `.ico` không tồn tại, lén `PackageReference`, đập-chuột `resx→ico→…`).
 * `dotnet new` sinh khung ĐÚNG CHUẨN 100%, offline (template nằm trong SDK). Nhưng `dotnet new` là
 * một lệnh **GHI ĐĨA**, nên nó **KHÔNG** được vào `DANH_SACH_TRANG` (model không được tự chạy — đó
 * là cửa cho vòng tự trị lạm dụng). Thay vào đó **SERVER** chạy nó vào một **THƯ MỤC TẠM** như một
 * bước SINH NỘI DUNG, đọc + lọc, rồi đưa qua ĐÚNG `apply_diff_batch` (mọi `original: ""`) — người
 * duyệt vẫn thấy diff từng tệp trước khi một byte nào rơi vào gốc dự án thật.
 *
 * ⚠⚠ File này **ĐỌC BYTE bằng `fs.readFileSync`** (đọc cây tệp `dotnet new` sinh ra). Đó là lý do nó
 * nằm ở `server/services/ai/` chứ KHÔNG ở `server/services/aiLocalTools/`:
 * `programmingFileIo.census.test.ts` cưỡng chế *"mọi lượt chạm đĩa theo BYTE trong `aiLocalTools/**`
 * phải nằm trong ĐÚNG HAI hàm cửa"* — một `readFileSync` ở đó sẽ ĐỎ. Cây tệp ở đây là tệp do CHÍNH
 * server vừa sinh trong thư mục tạm của mình (không phải hộp cát repo), nên nó là một cửa đọc KHÁC,
 * đúng chỗ, và không đội lốt cửa đọc mã nguồn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * AN TOÀN KHI CHẠY `dotnet new` — TÁI DÙNG HÀNG RÀO ĐÃ CÓ, KHÔNG DỰNG SONG SONG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • `execFile` (KHÔNG shell), argv MẢNG — không trình thông dịch nào trên đường đi.
 *   • `env = moiTruongDaLoc()` — **CÙNG** phép lọc môi trường của `repoCommandSandbox`: danh sách
 *     TRẮNG tên biến (hệ điều hành + chuỗi công cụ), không một bí mật ứng dụng nào; và nó ĐÃ đặt sẵn
 *     `DOTNET_CLI_TELEMETRY_OPTOUT=1` + `DOTNET_NOLOGO=1` + `DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1`
 *     (một đường ra mạng NGẦM bị tắt). KHÔNG viết bản lọc thứ hai — hai bản sẽ lệch nhau.
 *   • `-n`/`-o` là giá trị **SERVER dựng** (tmpdir + slug), KHÔNG bao giờ chuỗi model/client.
 *   • `template` lấy từ **BẢNG ÁNH XẠ THUẦN** (danh sách trắng template), KHÔNG phải chuỗi tự do.
 *   • hạn giờ (mặc định 60s) + xoá thư mục tạm ở `finally` (best-effort).
 *
 * ⚠ Bộ lọc `giuTepKhung` DÙNG LẠI `duoiDuocPhep` + `DOAN_THU_MUC_CAM` của `repoSandbox` (một nguồn
 *   chính sách), cộng danh sách thư mục SẢN PHẨM DỰNG (`bin`/`obj`/`.vs`). Đo THẬT (2026-08-24):
 *   MỌI template chạy một lượt restore NGẦM ⇒ luôn sinh `obj/` chứa `project.assets.json` — đuôi
 *   `.json` NẰM trong danh sách trắng, nên **bộ lọc THƯ MỤC là bắt buộc**, chỉ lọc đuôi là hụt.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { moiTruongDaLoc } from "../aiLocalTools/repoCommandSandbox";
import { DOAN_THU_MUC_CAM, duoiDuocPhep } from "../aiLocalTools/repoSandbox";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BẢNG ÁNH XẠ Ý ĐỊNH → TEMPLATE `dotnet new` — THUẦN, MỘT CHỖ, DANH SÁCH TRẮNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ Tín hiệu *"đây là dự án C#/.NET"*. Cần cho các loại KHÔNG độc quyền .NET (`console`/`classlib`/
 * `webapi` tồn tại ở MỌI ngôn ngữ) — nếu không đòi tín hiệu này thì *"tạo dự án console đọc log"*
 * (ý người dùng có thể là Node/Python) sẽ bị dựng nhầm thành khung C#. Chiều THỪA đắt hơn chiều SÓT.
 */
const TIN_HIEU_CSHARP = /(?:c#|c\s*sharp|csharp|\.net|asp\.net|dotnet)/i;

interface MucAnhXaTemplate {
  readonly re: RegExp;
  readonly template: string;
  /**
   * `true` ⇔ loại này **ĐỘC QUYỀN .NET** (WPF/WinForms/Blazor chỉ có trên .NET) ⇒ tự nó đã là tín
   * hiệu C#, KHÔNG cần một chữ "C#" rời. `false` ⇒ loại generic, ĐÒI thêm `TIN_HIEU_CSHARP`.
   */
  readonly ngamCsharp: boolean;
}

/**
 * ★★★ Danh sách TRẮNG template. Thứ tự có nghĩa: mục **cụ thể hơn đứng trước**. Mọi `re` neo hai mép
 * bằng lookaround không-phải-chữ-ASCII để `wpf`/`lib`/`console` không khớp GIỮA một từ khác
 * (`calibrate` chứa `lib`, nhưng `(?<![a-z])lib` từ chối vì `a` đứng trước).
 * ⚠ Chỉ các short-name ĐÃ KIỂM có trong `dotnet new list` trên SDK 10 (2026-08-24), **VÀ** sinh ≤ 8
 *   tệp văn bản (trần một thẻ duyệt): `wpf`(6) · `winforms`(4 sau lọc `.user`) · `webapi`(5 sau lọc
 *   `.http`) · `console`(2) · `classlib`(2). CỐ Ý VẮNG `blazor`: đo THẬT 2026-08-24 nó sinh **66 tệp**
 *   (kèm bootstrap vendored `.css`/`.js` dưới `wwwroot/lib`) ⇒ LUÔN vượt trần `TRAN_TEP_MOI_LO` ⇒ một
 *   mục CHẾT (không lượt nào ra được thẻ duyệt). Câu "blazor" vì thế RƠI VỀ model — model dựng được
 *   khung TỐI THIỂU ≤ 8 tệp. Thêm mục mới ⇒ phải kiểm CẢ short-name tồn tại LẪN số tệp ≤ 8.
 */
const BANG_ANH_XA_TEMPLATE: readonly MucAnhXaTemplate[] = [
  { re: /(?<![a-z])wpf(?![a-z])/i, template: "wpf", ngamCsharp: true },
  { re: /(?<![a-z])(?:winforms|windows\s*forms)(?![a-z])/i, template: "winforms", ngamCsharp: true },
  { re: /(?<![a-z])(?:web\s*api|webapi)(?![a-z])/i, template: "webapi", ngamCsharp: false },
  { re: /(?<![a-z])(?:console|dòng\s*lệnh|dong\s*lenh|command[\s-]*line)(?![a-z])/i, template: "console", ngamCsharp: false },
  {
    re: /(?<![a-z])(?:class\s*lib|classlib|thư\s*viện|thu\s*vien|library|lib)(?![a-z])/i,
    template: "classlib",
    ngamCsharp: false,
  },
];

/**
 * ★★★ *"Câu này ánh xạ được sang một template `dotnet new` nào không?"* — THUẦN, trả `null` khi không
 * khớp (⇒ đường tạo-khung RƠI VỀ model tự viết, dự phòng cho TS/React/Python…).
 *
 * ⚠ Gọi hàm này SAU `laYDinhTaoDuAn(question) === true` (nó chỉ trả lời câu hỏi loại nào, không phải
 *   "có phải ý định tạo dự án không"). Đột biến làm hàm luôn trả `null` ⇒ đường dotnet-new CHẾT ⇒
 *   ca ĐỎ ở lưới oracle + lưới vòng-thật.
 */
export function anhXaTemplateDotnet(question: string): string | null {
  const q = String(question ?? "");
  const coCsharp = TIN_HIEU_CSHARP.test(q);
  for (const m of BANG_ANH_XA_TEMPLATE) {
    if (!m.re.test(q)) continue;
    if (m.ngamCsharp || coCsharp) return m.template;
  }
  return null;
}

/**
 * ★ Tên dự án HỢP LỆ cho `dotnet new -n <ten>` (cũng là namespace gốc + tên tệp `.csproj`). Suy từ
 * id/tên dự án đang chọn: bỏ mọi ký tự ngoài `[A-Za-z0-9]`, bảo đảm bắt đầu bằng CHỮ (namespace
 * không được mở đầu bằng chữ số), rỗng ⇒ `"App"`.
 * ⚠ THUẦN — server dựng giá trị này, KHÔNG bao giờ lấy chuỗi model/client trực tiếp vào `-n`.
 */
export function slugDuAn(raw: string | undefined): string {
  const s = String(raw ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (s === "") return "App";
  const coChuDau = /^[A-Za-z]/.test(s) ? s : `App${s}`;
  return coChuDau.charAt(0).toUpperCase() + coChuDau.slice(1);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐỌC + LỌC CÂY TỆP `dotnet new` SINH RA — chỉ giữ tệp VĂN BẢN NGUỒN
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface TepKhungSinh {
  /** POSIX-style, tương đối với gốc thư mục tạm. */
  readonly duong: string;
  /** Nội dung THÔ (chưa chuẩn hoá kết dòng — người gọi qua `chuanHoaTepMoi`). */
  readonly noiDung: string;
}

/** Thư mục SẢN PHẨM DỰNG / IDE — luôn bỏ, KHÔNG đưa vào khung. */
const THU_MUC_SAN_PHAM: ReadonlySet<string> = new Set(["bin", "obj", ".vs", ".vscode", ".idea"]);

/**
 * ★★★ Vị từ THUẦN: *"tệp này có được GIỮ trong khung không?"* Hai điều kiện độc lập, mỗi cái một mình
 * đã đủ loại:
 *   1. KHÔNG nằm dưới thư mục sản phẩm dựng (`bin`/`obj`/`.vs`…) hay thư mục cấm của hộp cát.
 *      ⚠ Điều kiện này BẮT BUỘC: `obj/…/project.assets.json` có đuôi `.json` **nằm trong** danh sách
 *        trắng — chỉ lọc đuôi thì nó lọt (đo THẬT 2026-08-24).
 *   2. Đuôi/tên tệp qua `duoiDuocPhep` (danh sách trắng VĂN BẢN của `repoSandbox`) — nhị phân
 *      (`.dll`/`.pdb`/`.ico`/`.png`) rớt ở đây.
 * ⚠ Đột biến gỡ điều kiện (2) ⇒ `.ico` lọt vào khung ⇒ ca lọc ĐỎ.
 */
export function giuTepKhung(duongTuongDoi: string): boolean {
  const doan = String(duongTuongDoi ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
  if (doan.length === 0) return false;
  for (let i = 0; i < doan.length - 1; i++) {
    const low = doan[i]!.toLowerCase();
    if (THU_MUC_SAN_PHAM.has(low)) return false;
    if (DOAN_THU_MUC_CAM.has(low)) return false;
  }
  return duoiDuocPhep(doan[doan.length - 1]!);
}

/**
 * Duyệt cây `goc` (thư mục tạm của `dotnet new`), trả về mọi tệp VĂN BẢN NGUỒN đã lọc, sắp theo
 * đường dẫn cho tất định. Đọc byte bằng `fs.readFileSync` — hợp lệ vì đây KHÔNG phải `aiLocalTools/`
 * (xem docblock đầu file).
 */
export function docCayTepKhung(goc: string): TepKhungSinh[] {
  const ra: TepKhungSinh[] = [];
  const di = (dir: string, relDir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relRaw = relDir === "" ? e.name : `${relDir}/${e.name}`;
      if (e.isDirectory()) {
        const low = e.name.toLowerCase();
        if (THU_MUC_SAN_PHAM.has(low) || DOAN_THU_MUC_CAM.has(low)) continue;
        di(path.join(dir, e.name), relRaw);
      } else if (e.isFile()) {
        if (!giuTepKhung(relRaw)) continue;
        ra.push({ duong: relRaw, noiDung: fs.readFileSync(path.join(dir, e.name), "utf8") });
      }
    }
  };
  di(goc, "");
  ra.sort((a, b) => a.duong.localeCompare(b.duong));
  return ra;
}

/** ★ Khung có `<PackageReference>` không ⇒ câu trả lời phải KHAI hai chế độ NuGet (offline/internet). */
export function coPackageReference(tep: readonly TepKhungSinh[]): boolean {
  return tep.some((t) => /<PackageReference\b/i.test(t.noiDung));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHẠY `dotnet new` VÀO THƯ MỤC TẠM — SINH NỘI DUNG, KHÔNG GHI GỐC DỰ ÁN
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type KetQuaDotnetNew =
  | { ok: true; tep: TepKhungSinh[]; template: string; slug: string; coNuGet: boolean }
  | { ok: false; lyDo: string };

/** Hàm chạy bước `dotnet new` THẬT vào `tmpdir`. Tách ra để lưới TIÊM bản giả (brief cấm dotnet thật). */
export type ChayDotnetNew = (
  tmpdir: string,
  template: string,
  slug: string,
  timeoutMs: number,
) => Promise<{ ok: boolean; lyDo?: string }>;

export interface TuyChonDotnetNew {
  readonly template: string;
  readonly slug: string;
  readonly timeoutMs?: number;
  /**
   * ⚠ CHỈ dùng trong LƯỚI: thay bước gọi `dotnet new` THẬT bằng hàm ghi cây tệp GIẢ vào tmpdir.
   *   Brief cấm chạy `dotnet new` thật trong lưới — seam này là cách tuân thủ. Mặc định (production)
   *   = `chayDotnetNewThat` (execFile "dotnet", KHÔNG shell, env ĐÃ LỌC).
   */
  readonly chayThat?: ChayDotnetNew;
}

/**
 * Bước `dotnet new` THẬT: `execFile` KHÔNG shell, argv mảng, cwd = tmpdir, env ĐÃ LỌC, hạn giờ.
 * `dotnet` phân giải qua PATH (như `git` ở `repoCommandSandbox`): vắng SDK ⇒ ENOENT ⇒ `{ok:false}` ⇒
 * người gọi RƠI VỀ đường model. `-n`/`-o` là giá trị server dựng.
 */
const chayDotnetNewThat: ChayDotnetNew = (tmpdir, template, slug, timeoutMs) =>
  new Promise((giaiQuyet) => {
    execFile(
      "dotnet",
      ["new", template, "-n", slug, "-o", tmpdir],
      { cwd: tmpdir, env: moiTruongDaLoc(), timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const duoi = stderr ? ` — ${String(stderr).slice(0, 300)}` : "";
          giaiQuyet({ ok: false, lyDo: `dotnet new lỗi: ${err.message}${duoi}` });
          return;
        }
        giaiQuyet({ ok: true });
      },
    );
  });

/**
 * ★★★ CỬA CHÍNH: chạy `dotnet new <template> -n <slug>` vào MỘT thư mục tạm, đọc + lọc tệp văn bản,
 * rồi **XOÁ thư mục tạm** (finally, best-effort). Trả `{ok:false, lyDo}` khi dotnet lỗi / không có
 * SDK / không sinh tệp văn bản nào ⇒ người gọi RƠI VỀ đường model (fail-safe, KHÔNG vỡ).
 *
 * ⚠ Không đưa bất kỳ tệp nào ra gốc dự án thật ở đây — đó là việc của `apply_diff_batch` sau HITL.
 */
export async function chayDotnetNewVaoTam(opts: TuyChonDotnetNew): Promise<KetQuaDotnetNew> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const chay = opts.chayThat ?? chayDotnetNewThat;
  let tmp: string;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ai-dotnet-new-"));
  } catch (e) {
    return { ok: false, lyDo: `không tạo được thư mục tạm: ${(e as Error).message}` };
  }
  try {
    const r = await chay(tmp, opts.template, opts.slug, timeoutMs);
    if (!r.ok) return { ok: false, lyDo: r.lyDo ?? "dotnet new thất bại" };
    const tep = docCayTepKhung(tmp);
    if (tep.length === 0) {
      return { ok: false, lyDo: "dotnet new không sinh tệp VĂN BẢN nào (chỉ sản phẩm dựng?)" };
    }
    return { ok: true, tep, template: opts.template, slug: opts.slug, coNuGet: coPackageReference(tep) };
  } catch (e) {
    return { ok: false, lyDo: `đọc khung dotnet new lỗi: ${(e as Error).message}` };
  } finally {
    // ⚠ Best-effort: xoá thư mục tạm ở MỌI đường ra (thành công/lỗi/ném). Đột biến gỡ dòng này ⇒ ca
    //   "tmpdir được xoá sau khi đọc" ĐỎ (lưới ghi lại tmpdir qua hàm `chayThat` tiêm rồi kiểm tồn tại).
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

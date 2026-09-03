/**
 * ★★★ PARSER THUẦN "lỗi → VỊ TRÍ (tệp/dòng/cột)" cho panel **Problems** của `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VIỆC NÀY LÀM GÌ — VÀ CỐ Ý KHÔNG LÀM GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `shared/aiCodingLoop.ts` (`docKetQuaTest`/`ketLuanTest`) chỉ **ĐẾM** số ca đỏ/xanh — nó trả lời
 * *"đã xanh chưa"*. Nó KHÔNG biết lỗi nằm ở **tệp nào, dòng nào**. Panel Problems cần đúng thứ đó:
 * biến khối đầu ra THÔ của lệnh kiểm chứng thành danh sách địa điểm bấm-được. File này là bộ đọc ấy,
 * và nó là bộ đọc DUY NHẤT (không chép logic đếm-ca sang đây — hai bộ đọc trôi khỏi nhau là bài học
 * đã trả giá nhiều lần ở repo này).
 *
 * ⚠⚠ VÌ SAO Ở `shared/` CHỨ KHÔNG `server/`: panel Problems sống ở **CLIENT**, và client KHÔNG
 * import được mã `server/`. Bộ đọc phải THUẦN (0 phụ thuộc ngoài kiểu, không `node:*`, không I/O) để
 * chạy cả trong trình duyệt. Đặt ở `shared/` để `AICodingWorkspace.tsx` nhập thẳng, và để lưới đơn
 * vị chạy trên nó (một khuôn regex nới sai ⇒ ĐỎ tại đây, không phải phát hiện bằng mắt ở runtime).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PHẠM VI v2 — .NET TRỞ THÀNH BẤM-ĐƯỢC BẰNG SUY ĐƯỜNG TUYỆT ĐỐI → TƯƠNG ĐỐI (AN TOÀN)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chữ ký: `phanTichLoiViTri(dauRa, dsTepDuAn = [])`. `dsTepDuAn` = danh sách tệp CÓ THẬT trong cây
 * workspace (client tự cấp; đường tương đối gốc repo, dấu `/`). RỖNG/không truyền ⇒ hành xử **Y HỆT
 * v1** — mọi caller một-tham-số cũ giữ NGUYÊN kết quả (hợp đồng backward-compat CỨNG, có lưới chứng).
 *
 * Sáu khuôn, mỗi bộ chạy một regex RỜI (đầu ra của danh sách trắng `aiCodingVerify.NHAN_KIEM_CHUNG`).
 * Thứ tự đọc trong vòng lặp: tsc → csc → vitest-stack → vitest-FAIL → dotnet-`:line` → win-abs-loc.
 *
 *   1. **tsc** (`npm run check` / `check:tests`) — `<đường>(<dòng>,<cột>): error TS<số>: <msg>`.
 *      Đường TƯƠNG ĐỐI gốc repo, dấu `/`. ⇒ `{tep, dong, cot}` ĐẦY ĐỦ. ⚠ CHỈ `error TS`, KHÔNG
 *      `warning TS` (lưới §1). (Khuôn NGUYÊN VĂN, đã đo — tsc bị pipe in MỘT DÒNG, không `pretty`.)
 *
 *   2. **csc (MỚI — `dotnet build`)** — khuôn MSBuild MỘT DÒNG:
 *          `<đường>(<dòng>,<cột>): error CS<số>: <msg>[  [proj.csproj]]`
 *      • Đường TƯƠNG ĐỐI (`src/Calculator.cs(23,16): error CS0103: …`) ⇒ dùng THẲNG như tsc.
 *      • Đường TUYỆT ĐỐI của máy build (`D:\…\src\Calculator.cs(23,16): error CS1002: …`) ⇒ đi qua
 *        BỘ GIẢI HẬU TỐ: khớp cây ⇒ bấm-được; không khớp ⇒ dòng thông tin `tep:null`.
 *      ⚠ CHỈ `error CS`, KHÔNG `warning CS` (lưới §CS-warning, y như §1 của tsc).
 *
 *   3. **vitest** (`npx vitest run …`) — hai tín hiệu, khuôn NGUYÊN VĂN: `❯ <đường>:<dòng>:<cột>`
 *      ⇒ `{tep, dong, cot}`; `FAIL  <đường> > … > …` ⇒ `{tep, dong:null}`. Đường TƯƠNG ĐỐI.
 *
 *   4. **dotnet stack `:line` (NÂNG)** — `… in <đường tuyệt đối>:line <N>`. v1 chỉ DÒ rồi trả
 *      `tep:null`. v2 TRÍCH đường + dòng, đưa qua BỘ GIẢI HẬU TỐ: khớp cây ⇒ `{tep, dong:N, cot:null}`
 *      bấm-được; không khớp ⇒ `{tep:null,…}` (dòng thông tin, y v1).
 *
 *   5. **node stack tuyệt đối (NÂNG)** — `… (D:\…\x.test.js:10:9)`. v1 chỉ DÒ; v2 trích `tep/dong/cot`
 *      rồi giải hậu tố: khớp ⇒ bấm-được; không khớp ⇒ `{tep:null,…}` (y v1).
 *
 * ⚠⚠ VÌ SAO AN TOÀN (khử ĐÚNG rủi ro v1 cố tránh — "mở NHẦM tệp"): một đường tuyệt đối của MÁY BUILD
 *    chỉ trở thành liên kết KHI VÀ CHỈ KHI nó khớp HẬU TỐ CĂN-ĐOẠN với một tệp CÓ THẬT trong cây
 *    (`giaiDuongTuyetDoiTheoHauTo`). Mơ hồ (≥2 khớp cùng độ dài dài nhất) ⇒ KHÔNG đoán ⇒ `tep:null`.
 *    Không khớp ⇒ `tep:null`. Không leak đường server (msg vẫn giữ raw ở dòng thông tin), không dựng
 *    liên kết tới tệp NGOÀI cây. `dsTepDuAn` rỗng ⇒ bộ giải LUÔN trả null ⇒ đúng y hành vi v1.
 *
 * Dòng KHÔNG khớp khuôn nào ⇒ **BỎ QUA** (không đẻ mục rác). Đầu vào rỗng / không phải chuỗi ⇒ `[]`.
 * ⚠ CRLF: đầu ra lệnh trên Windows có `\r\n`. Tách bằng `split(/\r?\n/)` — xử cả hai.
 */

// ══════════════════════════════════════════════════════════════════════════════════════════════
// HỢP ĐỒNG (chốt cứng — Wave sau phụ thuộc, đừng đổi tên / hình dạng)
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface DiaDiemLoi {
  /** Đường tệp (tương đối gốc repo). `null` ⇔ chưa suy được đường bấm-được (tuyệt đối không khớp cây / mơ hồ). */
  tep: string | null;
  /** Số dòng (1-based). `null` khi biết tệp mà chưa biết dòng (vd dòng `FAIL <đường>` của vitest). */
  dong: number | null;
  /** Số cột (1-based). `null` như `dong`. */
  cot: number | null;
  /** Câu mô tả lỗi (thô, chưa dịch — component tự dịch/hiển thị sau). Luôn có, kể cả khi `tep` null. */
  thongDiep: string;
  /**
   * ★ 2026-09-03 · ĐỢT E1 — MỨC ĐỘ. `"loi"` cho mọi mục của đường CŨ (mặc định), `"canhBao"` chỉ
   * sinh khi người gọi BẬT `gomCanhBao` (xem `TuyChonPhanTich`). Trường này **bắt buộc** chứ không
   * optional: một mục không biết mình là lỗi hay cảnh báo sẽ được panel vẽ như lỗi — đúng lời khai
   * sai mà đợt này sinh ra để chấm dứt.
   */
  mucDo: "loi" | "canhBao";
}

/**
 * ★★★ 2026-09-03 · ĐỢT E1 — **CẢNH BÁO LÀ THỨ PHẢI XIN, KHÔNG PHẢI THỨ TỰ ĐẾN.**
 *
 * Hợp đồng CŨ (và hai lưới ghim §1/§CS-warning) nói: `warning TS…`/`warning CS…` KHÔNG sinh mục lỗi.
 * Lý lẽ ấy vẫn đúng nguyên: panel "Vấn đề" là danh sách *"chỗ phải sửa để build xanh"*, trộn cảnh
 * báo vào làm huy hiệu đếm nói dối về mức nghiêm trọng.
 * ⇒ Đợt này **KHÔNG nới hai regex cũ** (nới là làm hai lưới ấy đỏ — và chúng đúng). Thay vào đó:
 * hai regex RỜI cho cảnh báo, chỉ chạy khi bật cờ, mục sinh ra mang `mucDo:"canhBao"`. Mặc định
 * (`gomCanhBao` vắng) đường cũ chạy y hệt TỪNG BYTE.
 */
export interface TuyChonPhanTich {
  /** `true` ⇒ nhận thêm `warning TS…`/`warning CS…` thành mục `mucDo:"canhBao"`. Mặc định: KHÔNG. */
  gomCanhBao?: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KHUÔN — mỗi bộ chạy một regex RỜI, có docblock VÌ SAO. "Một regex thông minh" cho cả sáu là cách
// chắc chắn để một lần nới cho bộ này âm thầm nới cho bộ kia.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * tsc: `<đường>(<dòng>,<cột>): error TS<số>: <thông điệp>`.
 *   • `[^\s(][^(]*?` — đường: bắt đầu bằng ký tự KHÔNG-trắng-KHÔNG-ngoặc, rồi tham (lười) tới trước `(`
 *     đầu tiên; chặn cả việc nuốt khoảng trắng đầu dòng lẫn nuốt qua dấu `(` của bộ định vị.
 *   • `\((\d+),(\d+)\)` — bộ định vị `(dòng,cột)` trong NGOẶC (khác `:dòng:cột` của stack — không đụng).
 *   • ⚠⚠ `error\s+TS\d+\b` — ĐÒI đúng chữ `error`. Đổi thành `(?:error|warning)` / `\w+` là đột biến
 *     mà lưới `§1 warning` phải bắt: một `warning TS…` KHÔNG được sinh mục lỗi.
 */
const RE_TSC = /^(?<tep>[^\s(][^(]*?)\((?<dong>\d+),(?<cot>\d+)\):\s+(?<msg>error\s+TS\d+\b.*)$/;

/**
 * csc: `<đường>(<dòng>,<cột>): error CS<số>: <thông điệp>[  [proj.csproj]]` — lỗi biên dịch C# của
 * `dotnet build`, khuôn MSBuild MỘT DÒNG (đã đo THẬT ở `sandbox-projects/csharp`).
 *   • Thân KHUÔN Y HỆT `RE_TSC` — CỐ Ý là một regex RỜI (KHÔNG gộp `(?:TS|CS)`): nới nhầm một bộ sẽ
 *     âm thầm nới bộ kia; tách rời ⇒ một lưới soi đúng một đột biến.
 *   • `[^\s(][^(]*?` — đường (tương đối HAY tuyệt đối `D:\…` đều KHÔNG chứa `(`) lười tới `(` locator.
 *     Đuôi `[…\proj.csproj]` (nếu có) nằm SAU locator ⇒ rơi trọn vào `msg`, KHÔNG lẫn vào `tep`.
 *   • ⚠⚠ `error\s+CS\d+\b` — ĐÒI đúng `error`. `(?:error|warning)` / `\w+` là đột biến §CS-warning
 *     phải bắt: `warning CS…` KHÔNG phải một mục lỗi để nhảy tới.
 */
const RE_CSC = /^(?<tep>[^\s(][^(]*?)\((?<dong>\d+),(?<cot>\d+)\):\s+(?<msg>error\s+CS\d+\b.*)$/;

/**
 * ★ ĐỢT E1 — KHUÔN CẢNH BÁO, **hai regex RỜI** (đúng luật của file: "một regex thông minh cho cả
 * sáu là cách chắc chắn để nới nhầm"). Thân y hệt `RE_TSC`/`RE_CSC`, chỉ đổi `error` → `warning`.
 * Chúng CHỈ chạy ở nhánh `gomCanhBao`; không một điểm gọi nào của đường cũ chạm tới.
 */
const RE_TSC_CANHBAO = /^(?<tep>[^\s(][^(]*?)\((?<dong>\d+),(?<cot>\d+)\):\s+(?<msg>warning\s+TS\d+\b.*)$/;
const RE_CSC_CANHBAO = /^(?<tep>[^\s(][^(]*?)\((?<dong>\d+),(?<cot>\d+)\):\s+(?<msg>warning\s+CS\d+\b.*)$/;

/**
 * vitest — KHUNG STACK: `❯ <đường>:<dòng>:<cột>` (thường thụt đầu dòng vài dấu cách).
 *   • `[^\s:?*]+\.[A-Za-z0-9]+` — đường KHÔNG chứa khoảng trắng / `:` / ký tự glob, và có phần mở
 *     rộng tệp. Ràng buộc này loại các dòng TÊN CA cũng bắt đầu bằng `❯` (chúng có khoảng trắng và
 *     không kết bằng `:<số>:<số>`).
 *   • `:(\d+):(\d+)\s*$` — đuôi `:dòng:cột` ở CUỐI dòng ⇒ chắc chắn là một vị trí, không phải văn xuôi.
 *   • Đường tuyệt đối Windows (`D:\…`) KHÔNG khớp (lớp `[^\s:]` chặn dấu `:` của ổ đĩa) ⇒ rơi xuống
 *     bộ nhận-đường-tuyệt-đối bên dưới.
 */
const RE_VITEST_STACK = /^\s*❯\s+(?<tep>[^\s:?*]+\.[A-Za-z0-9]+):(?<dong>\d+):(?<cot>\d+)\s*$/;

/**
 * vitest — DÒNG TỔNG KẾT: `FAIL  <đường> > <suite> > <ca>`.
 *   • `FAIL\s+` — ĐÒI khoảng trắng sau `FAIL` để KHÔNG khớp `Failed`/`Failed:` (dòng tổng kết
 *     `dotnet` bắt đầu bằng `Failed`, không phải `FAIL `).
 *   • `\S+\.[A-Za-z0-9]+` — token đường có phần mở rộng; `(?=\s|$)` chốt nó kết thúc ở khoảng trắng
 *     (khoảng trắng trước ` > `) hoặc cuối dòng.
 */
const RE_VITEST_FAIL = /^\s*FAIL\s+(?<tep>\S+\.[A-Za-z0-9]+)(?=\s|$)/;

/**
 * .NET stack: `… in <đường tuyệt đối>:line <N>`. Token `:line <số>` CHỈ xuất hiện ở khung stack
 * `dotnet` ⇒ tín hiệu đường-tuyệt-đối rất sạch.
 *   • `\bin\s+` — ĐÒI ` in ` (có biên từ) đứng trước đường; KHÔNG khớp `in` giữa tên hàm (`Main()`,
 *     `Domain`, thư mục `\bin\`) vì thiếu biên trước hoặc thiếu khoảng trắng theo sau.
 *   • `(?<tep>.+?):line` — LƯỜI tới `:line` ĐẦU TIÊN. Đường chứa dấu `:` của ổ đĩa (`D:\`) KHÔNG cắt
 *     sớm: literal đòi đúng chữ `:line`, khác `:\`. (Suffix-match bên dưới còn miễn nhiễm rác tiền tố.)
 * v2: TRÍCH `tep`+`dong` rồi đưa qua bộ giải hậu tố (v1 chỉ dò, trả `tep:null`).
 */
const RE_DOTNET_LINE = /\bin\s+(?<tep>.+?):line\s+(?<dong>\d+)\b/;

/**
 * Đường TUYỆT ĐỐI Windows + bộ định vị `:<dòng>[:<cột>]`: `D:\…\x.test.js:10:9` (node stack).
 *   • `(?<![A-Za-z])[A-Za-z]:[\\/]` — ổ đĩa `X:\` / `X:/` mà TRƯỚC nó KHÔNG phải một chữ cái — để
 *     `http:/` (chữ `p` sau `t`) KHÔNG bị nhận nhầm là ổ đĩa; còn `(D:\`, ` D:\`, `file:///D:/` thì
 *     ký tự trước ổ đĩa là `(` / khoảng trắng / `/` nên vẫn nhận đúng.
 *   • `[^\s:]*\.[A-Za-z0-9]+` — thân đường (không trắng, không `:`) tới `.<ext>`.
 *   • `:(?<dong>\d+)(?::(?<cot>\d+))?` — dòng BẮT BUỘC, cột TUỲ CHỌN (node có `:dòng:cột`, đôi khi chỉ `:dòng`).
 * v2: TRÍCH `tep`/`dong`/`cot` rồi giải hậu tố (v1 chỉ dò, trả `tep:null`). ⚠ CHẠY SAU khuôn `:line`
 *     để dòng `.NET` (`…cs:line N` — KHÔNG có `.<ext>:<số>`) được khuôn dotnet nuốt trước, không lọt xuống đây.
 */
const RE_WIN_ABS_LOC = /(?<![A-Za-z])(?<tep>[A-Za-z]:[\\/][^\s:]*\.[A-Za-z0-9]+):(?<dong>\d+)(?::(?<cot>\d+))?/;

/**
 * Đường (dạng chuỗi) có TUYỆT ĐỐI không: ổ đĩa Windows `X:\` / `X:/` (`/^[A-Za-z]:[\\/]/`), hoặc POSIX
 * `/…` (`/^\//`). Dùng để `RE_CSC` rẽ nhánh: TƯƠNG ĐỐI ⇒ dùng thẳng (như tsc); TUYỆT ĐỐI ⇒ phải giải
 * hậu tố theo cây workspace trước khi cho bấm.
 */
function laDuongTuyetDoiChuoi(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^\//.test(p);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ GIẢI HẬU TỐ — trái tim v2
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ Suy một đường TUYỆT ĐỐI của máy build về đường TƯƠNG ĐỐI CÓ THẬT trong cây workspace — hoặc `null`
 * nếu không suy được CHẮC CHẮN. Đây là cách v2 khử rủi ro "mở NHẦM tệp" mà v1 cố ý né bằng `tep:null`.
 *
 *   • Chuẩn hoá `\`→`/` cho CẢ `abs` LẪN từng tệp (đầu ra build lẫn cây đều có thể lẫn hai kiểu gạch).
 *   • Nhận `fn` là HẬU TỐ CĂN-THEO-ĐOẠN của `abs`: `norm === fn` HOẶC `norm.endsWith('/' + fn)`. Dấu
 *     `/` ở đầu `'/' + fn` ép khớp tại BIÊN ĐOẠN ⇒ tệp `Calculator.cs` KHÔNG dính vào `…/myCalculator.cs`
 *     (hậu tố THÔ sẽ dính — đó chính là lỗi ta phải chặn).
 *   • Trả DUY NHẤT cái DÀI NHẤT (cụ thể nhất). Cây có cả `Calculator.cs` (gốc) lẫn `src/Calculator.cs`,
 *     abs `…/src/Calculator.cs` ⇒ chọn `src/Calculator.cs`, KHÔNG hút nhầm tệp gốc.
 *   • ⚠ HOÀ ở độ dài dài nhất — ĐẾM SỐ khớp ở max-length, `≥2 ⇒ null`: mơ hồ thì KHÔNG đoán (thà dòng
 *     thông tin còn hơn một liên kết dối). Ghi chú TOÁN HỌC: hai đường KHÁC NHAU cùng độ dài KHÔNG THỂ
 *     cùng là hậu tố của một `abs` (hậu tố ở độ dài cố định là duy nhất) — nên "hoà" chỉ thực sự nổ khi
 *     `dsTep` chứa MỤC TRÙNG ở max-length; guard vẫn giữ để danh sách bẩn không đẻ liên kết đoán mò.
 *   • Không khớp / `abs` rỗng-không-chuỗi / `dsTep` rỗng ⇒ `null` ⇒ caller v1 (không cây) LUÔN null.
 *
 * THUẦN, tất định, 0 I/O — chỉ so chuỗi. Trả về dạng đã chuẩn hoá `/` (đồng nhất với tep của tsc/vitest).
 */
export function giaiDuongTuyetDoiTheoHauTo(abs: string, dsTep: readonly string[]): string | null {
  if (typeof abs !== "string" || abs.length === 0 || dsTep.length === 0) return null;
  const norm = abs.replace(/\\/g, "/");
  let best: string | null = null;
  let bestLen = -1;
  let soKhopDaiNhat = 0; // số tệp khớp ở độ dài dài nhất hiện tại (≥2 ⇒ mơ hồ)
  for (const raw of dsTep) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const fn = raw.replace(/\\/g, "/");
    if (norm !== fn && !norm.endsWith("/" + fn)) continue; // không phải hậu tố căn-đoạn ⇒ bỏ
    if (fn.length > bestLen) {
      best = fn;
      bestLen = fn.length;
      soKhopDaiNhat = 1;
    } else if (fn.length === bestLen) {
      soKhopDaiNhat += 1;
    }
  }
  return soKhopDaiNhat >= 2 ? null : best;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ ĐỌC
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Đọc đầu ra THÔ của một lệnh kiểm chứng, trả danh sách địa điểm lỗi theo THỨ TỰ xuất hiện.
 * THUẦN, tất định, 0 phụ thuộc ngoài. KHÔNG khử trùng lặp (một block vitest có thể cho cả một mục
 * `FAIL` không-dòng lẫn một mục khung stack có-dòng cho cùng tệp — đó là HAI tín hiệu thật).
 *
 * @param dsTepDuAn danh sách tệp CÓ THẬT trong cây workspace (tương đối, `/`). Rỗng ⇒ hành xử Y HỆT v1.
 */
export function phanTichLoiViTri(
  dauRa: string,
  dsTepDuAn: readonly string[] = [],
  tuyChon: TuyChonPhanTich = {},
): DiaDiemLoi[] {
  if (typeof dauRa !== "string" || dauRa.length === 0) return [];

  const ket: DiaDiemLoi[] = [];
  for (const raw of dauRa.split(/\r?\n/)) {
    // ★ E1 — 0) CẢNH BÁO (opt-in). Đặt TRƯỚC các khuôn lỗi vì hai regex cảnh báo hẹp hơn hẳn
    //   (đòi đúng chữ `warning`), nên không mục lỗi nào bị chúng nuốt; và đặt trong `if` nên khi
    //   cờ tắt thì đường cũ không chạy thêm MỘT phép khớp nào.
    if (tuyChon.gomCanhBao === true) {
      const wt = RE_TSC_CANHBAO.exec(raw) ?? RE_CSC_CANHBAO.exec(raw);
      if (wt?.groups) {
        const tep = wt.groups.tep.trim();
        // Đường tuyệt đối (bản build C#) ⇒ giải hậu tố như nhánh lỗi; không giải được ⇒ giữ tep:null
        // để panel hiện chữ mà KHÔNG dựng một liên kết dối (cùng luật với `RE_CSC`).
        const duong = laDuongTuyetDoiChuoi(tep) ? giaiDuongTuyetDoiTheoHauTo(tep, dsTepDuAn) : tep;
        ket.push({
          tep: duong,
          dong: duong === null ? null : Number(wt.groups.dong),
          cot: duong === null ? null : Number(wt.groups.cot),
          thongDiep: duong === null ? raw.trim() : wt.groups.msg.trim(),
          mucDo: "canhBao",
        });
        continue;
      }
    }

    // 1) tsc — vị trí ĐẦY ĐỦ, đường tương đối.
    const t = RE_TSC.exec(raw);
    if (t?.groups) {
      ket.push({
        tep: t.groups.tep.trim(),
        dong: Number(t.groups.dong),
        cot: Number(t.groups.cot),
        thongDiep: t.groups.msg.trim(),
        mucDo: "loi",
      });
      continue;
    }

    // 2) csc — lỗi biên dịch C#. Đường TƯƠNG ĐỐI ⇒ dùng thẳng; TUYỆT ĐỐI ⇒ giải hậu tố theo cây.
    const c = RE_CSC.exec(raw);
    if (c?.groups) {
      const tep = c.groups.tep.trim();
      const dong = Number(c.groups.dong);
      const cot = Number(c.groups.cot);
      const msg = c.groups.msg.trim();
      if (!laDuongTuyetDoiChuoi(tep)) {
        ket.push({ tep, dong, cot, thongDiep: msg, mucDo: "loi" });
      } else {
        const giai = giaiDuongTuyetDoiTheoHauTo(tep, dsTepDuAn);
        if (giai !== null) ket.push({ tep: giai, dong, cot, thongDiep: msg, mucDo: "loi" });
        else ket.push({ tep: null, dong: null, cot: null, thongDiep: raw.trim(), mucDo: "loi" });
      }
      continue;
    }

    // 3) vitest — khung stack `❯ path:dòng:cột`.
    const vs = RE_VITEST_STACK.exec(raw);
    if (vs?.groups) {
      ket.push({
        tep: vs.groups.tep,
        dong: Number(vs.groups.dong),
        cot: Number(vs.groups.cot),
        thongDiep: raw.trim(),
        mucDo: "loi",
      });
      continue;
    }

    // 4) vitest — dòng tổng kết `FAIL path` (biết tệp, CHƯA biết dòng).
    const vf = RE_VITEST_FAIL.exec(raw);
    if (vf?.groups) {
      ket.push({ tep: vf.groups.tep, dong: null, cot: null, thongDiep: raw.trim(), mucDo: "loi" });
      continue;
    }

    // 5) dotnet stack `:line` — đường tuyệt đối máy build ⇒ giải hậu tố (v1: luôn tep:null).
    const dn = RE_DOTNET_LINE.exec(raw);
    if (dn?.groups) {
      const giai = giaiDuongTuyetDoiTheoHauTo(dn.groups.tep, dsTepDuAn);
      if (giai !== null) {
        ket.push({ tep: giai, dong: Number(dn.groups.dong), cot: null, thongDiep: raw.trim(), mucDo: "loi" });
      } else {
        ket.push({ tep: null, dong: null, cot: null, thongDiep: raw.trim(), mucDo: "loi" });
      }
      continue;
    }

    // 6) node stack tuyệt đối `D:\…:dòng:cột` ⇒ giải hậu tố (v1: luôn tep:null).
    const wa = RE_WIN_ABS_LOC.exec(raw);
    if (wa?.groups) {
      const giai = giaiDuongTuyetDoiTheoHauTo(wa.groups.tep, dsTepDuAn);
      if (giai !== null) {
        ket.push({
          tep: giai,
          dong: Number(wa.groups.dong),
          cot: wa.groups.cot != null ? Number(wa.groups.cot) : null,
          thongDiep: raw.trim(),
        mucDo: "loi",
        });
      } else {
        ket.push({ tep: null, dong: null, cot: null, thongDiep: raw.trim(), mucDo: "loi" });
      }
      continue;
    }

    // 7) không khớp khuôn nào ⇒ bỏ qua, không đẻ mục rác.
  }

  return ket;
}

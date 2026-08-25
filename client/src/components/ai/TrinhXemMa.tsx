/**
 * ★★★ 2026-08-25 — TRÌNH XEM MÃ: nội dung tệp THẬT có **tô cú pháp + SỐ DÒNG + CUỘN NGANG**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * NGHỊCH LÝ ĐANG VÁ (audit UX bắt) — và vì sao lời vá là "đi CHUNG một đường", không phải "tô lại"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mã C# do model sinh trong khung Hội thoại có màu (fenced ```code``` → `<Streamdown>` → Shiki),
 * còn tệp THẬT mở ở Trình xem là `<pre whitespace-pre-wrap>` TRƠN: không màu, không số dòng, và
 * dòng dài GẤP xuống làm cấu trúc mã (thụt đầu dòng, ngoặc) sai lệch. Hai bề mặt cho cùng một thứ —
 * mã nguồn — mà một bên đẹp một bên trơ, chỉ vì chúng đi HAI đường render khác nhau.
 *
 * Lời vá KHÔNG phải "viết một bộ tô màu cho Trình xem": đó là đẻ ra đường render THỨ BA để lệch tiếp.
 * Lời vá là đưa nội dung tệp về ĐÚNG đường model đã đi — bọc nó thành MỘT khối mã fenced
 * (```<lang>\n<nội dung>\n```) rồi giao cho `<Streamdown>`. Shiki tô qua đường **đã được duyệt**
 * (dependency TRỰC TIẾP, đã dùng ở `AIChatBox.tsx` + `pages/AICodingWorkspace.tsx`). Hệ quả: tệp
 * THẬT nay tô CHÍNH XÁC như mã trong chat — kể cả giới hạn (xem "OFFLINE" dưới) cũng khớp, vì là
 * cùng một đường.
 *
 * ⚠⚠ KHÔNG `import "shiki"` / `import "rehype-highlight"` TRỰC TIẾP. `shiki` chỉ là dependency BẮC
 *   CẦU của `streamdown` (`node_modules/streamdown/package.json` → dependencies.shiki), còn
 *   `rehype-highlight` KHÔNG có trong repo. Nhập thẳng chúng là dựng một "phantom dependency" sẽ vỡ
 *   ở lượt nâng cấp `streamdown` sau. Xem docblock chỗ `import { Streamdown }` ở `AICodingWorkspace.tsx`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ TIỀN ĐỀ BRIEF ĐÃ KIỂM — hai thứ tưởng có, thực ra KHÔNG có (đo trên bundle 1.6.11, không đoán)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  (a) **Streamdown/Shiki KHÔNG có "transformer số dòng" bật được bằng prop.** Đọc
 *      `node_modules/streamdown/dist/code-block-*.js`: mỗi dòng mã là `<span class="block
 *      before:content-[counter(line)] before:[counter-increment:line] before:w-6 …">`. Tức số dòng
 *      CÓ, nhưng là **nội dung sinh bởi CSS** (`::before content: counter(line)`) — KHÔNG phải chữ
 *      thật (vô hình với `renderToStaticMarkup` và với lưới), bề rộng cứng `w-6` (~3 chữ số → cắt ở
 *      tệp > 999 dòng), và KHÔNG có móc để tô-sáng "đúng dòng N" từ ngoài. Nên số dòng ở đây do TA
 *      dựng: một cột gutter THẬT (đo được, tô-sáng được từng dòng) — xem "GUTTER".
 *  (b) **Streamdown KHÔNG tô lúc SSR.** Tô là bất đồng bộ trong `useEffect` (tạo highlighter Shiki,
 *      và ngôn ngữ ngoài bộ gói được `fetch` từ CDN). `renderToStaticMarkup` không chạy effect ⇒ ra
 *      mã TRƠN. Đó là lý do lưới đơn vị **MOCK** `streamdown` (test LOGIC của ta: suy lang, gutter,
 *      tô-sáng, lớp cuộn-ngang) chứ không test nội bộ Shiki. Xem `trinhXemMa.unit.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GUTTER (số dòng) · CUỘN NGANG · TÔ SÁNG — và một khối CSS phạm vi hẹp phải khai thẳng
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  • **GUTTER**: cột số dòng bên trái do TA render (một `<div data-so-dong={n}>` mỗi dòng). Nó là
 *    NGUỒN SỰ THẬT của số dòng (đo được bằng lưới) và là chỗ tô-sáng `dongMucTieu`. Vì Streamdown
 *    có SẴN số dòng CSS của nó, ta phải TẮT bộ ấy (không thì đôi số). Xem `CSS_GHI_DE`.
 *  • **CUỘN NGANG**: khối mã dùng `white-space: pre` (mặc định của `<pre>`, KHÔNG wrap) và vùng
 *    `[data-ma]` bọc nó là `overflow-x-auto`. Card của Streamdown vốn `overflow-hidden` (cắt cụt dòng
 *    dài) — `CSS_GHI_DE` mở lại thành `visible` để `[data-ma]` cầm việc cuộn.
 *  • **TÔ SÁNG `dongMucTieu`**: chỉ ĐÁNH DẤU (nền nhẹ ở ô gutter của đúng dòng đó) — KHÔNG tự cuộn
 *    (cuộn là việc của TRANG; đây là component thuần hiển thị). Số dòng giúp người dùng tự dò nốt.
 *
 * ⚠ `CSS_GHI_DE` là ĐIỂM GẮN KẾT DUY NHẤT với nội bộ Streamdown (bám các thuộc tính `data-streamdown`
 *   ổn định, ghim ở bản ^1.6.11). Nếu bản sau đổi các thuộc tính ấy, ghi-đè thành no-op và HẬU QUẢ
 *   TỆ NHẤT là THẨM MỸ (số dòng CSS + thanh tiêu đề của card hiện lại), KHÔNG phải vỡ chức năng. Khai
 *   thẳng ở đây để lượt nâng cấp sau biết chỗ mà ngó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GIỚI HẠN ĐÃ ĐO (khai thẳng, không phải quên)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  • **OFFLINE**: ngôn ngữ NGOÀI bộ gói của Shiki được Streamdown `fetch` từ CDN; xưởng ngắt mạng ⇒
 *    ngôn ngữ ấy rơi về TRƠN (có `console.warn`). Đây là hành vi THỪA KẾ từ đường chat (cùng đường),
 *    KHÔNG phải hồi quy do màn này đẻ ra.
 *  • **TỆP RẤT LỚN**: gutter render N nút DOM và Shiki token hoá cả tệp. Trang phụ thuộc server đã
 *    cắt bớt (`readFile` trả cờ `truncated`); nội dung khổng lồ CHƯA cắt sẽ nặng.
 *  • **CĂN DÒNG gutter↔mã**: hai cột riêng, căn theo cùng `line-height` (1.5rem) + cùng cỡ chữ; đây
 *    là căn "đủ tốt" chứ chưa nghiệm thu bằng mắt (chưa nối dây/Playwright ở wave này). Việc nối dây
 *    ở trang nên nghiệm thu live một lượt.
 *  • Nền tô-sáng chỉ nằm ở Ô GUTTER (không phủ nền lên phần MÃ của dòng): phủ nền vào mã đòi thò tay
 *    vào span nội bộ của Shiki (`nth-child`) — đúng loại gắn kết dễ vỡ mà repo tránh. Dấu ở gutter +
 *    số dòng đã đủ cho việc "để mắt thấy ngay".
 */
import * as React from "react";
import { cn } from "@/lib/utils";
/**
 * `Streamdown` — đường tô cú pháp ĐÃ ĐƯỢC DUYỆT (xem docblock trên). Ghi đè các thuộc tính card của
 * nó bằng `CSS_GHI_DE` scoped, KHÔNG bằng ghi đè component `code` (thứ phá Shiki — xem `KhoiMaCoNhan`).
 */
import { Streamdown } from "streamdown";

/**
 * Suy ID ngôn ngữ Shiki từ ĐUÔI tệp. THUẦN, bảng cứng, không lệ thuộc nội dung — xuất ra để lưới đo
 * thẳng bằng `toBe`. Đuôi lạ / không có đuôi ⇒ `"text"` (Shiki hiểu là không tô). ID phải là ID Shiki
 * hợp lệ, nếu không Streamdown tự rơi về `"text"` ở runtime.
 */
const BANG_NGON_NGU: Readonly<Record<string, string>> = {
  cs: "csharp",
  // ⚠ tsx → typescript theo brief (mất tô JSX, nhưng bám đúng bảng brief chốt).
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  // XAML/XML và họ tệp dự án .NET đều là XML.
  xaml: "xml",
  axaml: "xml",
  xml: "xml",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  py: "python",
  pyw: "python",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  vue: "vue",
  swift: "swift",
  dockerfile: "docker",
};

export function suyNgonNgu(duongDan: string): string {
  const m = /\.([^.\\/]+)$/.exec(duongDan);
  const duoi = m ? m[1]!.toLowerCase() : "";
  return BANG_NGON_NGU[duoi] ?? "text";
}

/**
 * Chuẩn hoá nội dung cho HIỂN THỊ mà KHÔNG làm lệch số dòng:
 *   1. bỏ BOM đầu tệp;
 *   2. CRLF (`\r\n`) và CR lẻ (`\r`, kiểu Mac cũ) → LF — nên `\r\n` đếm ĐÚNG như `\n`, không nhân đôi;
 *   3. bỏ ĐÚNG MỘT dấu xuống dòng ở CUỐI — quy ước "dòng cuối kết thúc bằng LF" của trình soạn thảo,
 *      để một tệp kết thúc bằng newline KHÔNG đẻ ra một dòng trống ảo ở cuối gutter.
 * THUẦN, xuất ra để lưới đo thẳng.
 */
export function chuanHoaNoiDung(noiDung: string): string {
  // BOM: bỏ bằng mã điểm (U+FEFF = 0xFEFF) — KHÔNG nhúng ký tự vô hình vào mã nguồn.
  const khongBom = noiDung.charCodeAt(0) === 0xfeff ? noiDung.slice(1) : noiDung;
  return khongBom.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

/** Tách nội dung (đã chuẩn hoá) thành mảng dòng. Số phần tử = số dòng gutter phải vẽ. THUẦN. */
export function tachDong(noiDung: string): string[] {
  return chuanHoaNoiDung(noiDung).split("\n");
}

/**
 * Số backtick của HÀNG RÀO fenced: dài hơn chuỗi backtick DÀI NHẤT trong nội dung một ký tự (tối
 * thiểu 3). Không có bước này thì một tệp chứa ``` (vd .md, hay template literal JS) sẽ ĐÓNG fence
 * sớm ⇒ phần còn lại bị Streamdown parse như markdown ⇒ vỡ. THUẦN.
 */
export function soBacktickRao(noiDung: string): number {
  let dai = 0;
  for (const m of noiDung.matchAll(/`+/g)) dai = Math.max(dai, m[0].length);
  return Math.max(3, dai + 1);
}

/**
 * ★ CSS phạm vi hẹp (scoped dưới `[data-trinh-xem-ma]`) — ĐIỂM GẮN KẾT DUY NHẤT với nội bộ Streamdown.
 * Bám các thuộc tính `data-streamdown` (móc ổn định Streamdown cố ý phát ra), ghim ^1.6.11:
 *   • gỡ chrome card (lề `my-4`, viền, bo góc, nền) để nó nằm phẳng cạnh gutter;
 *   • ẨN thanh tiêu đề (`code-block-header`) — nó đẩy dòng 1 của mã xuống, lệch với gutter;
 *   • TẮT số dòng CSS có sẵn (`code > span::before`) — gutter của TA là nguồn sự thật, không thì đôi số;
 *   • đồng bộ `font-size`/`line-height` với gutter để hai cột căn dòng;
 *   • mở lại `overflow` (card vốn `overflow-hidden` cắt cụt dòng dài) để `[data-ma]` cầm việc cuộn ngang;
 *   • bỏ `content-visibility:auto`/`contain-intrinsic-size` (card đặt sẵn) — nó ước lượng 200px khi
 *     ngoài màn ⇒ lệch chiều cao với gutter lúc cuộn.
 * Hậu quả tệ nhất nếu bản sau đổi thuộc tính: THẨM MỸ (số CSS + tiêu đề hiện lại), không vỡ chức năng.
 */
const CSS_GHI_DE = `
[data-trinh-xem-ma] [data-streamdown="code-block"]{
  margin:0 !important; border:0 !important; border-radius:0 !important;
  background:transparent !important; overflow:visible !important;
  content-visibility:visible !important; contain-intrinsic-size:auto !important;
}
[data-trinh-xem-ma] [data-streamdown="code-block-header"]{ display:none !important; }
[data-trinh-xem-ma] [data-streamdown="code-block-body"]{
  margin:0 !important; padding:0 !important; background:transparent !important;
  font-size:13px !important; line-height:1.5rem !important;
}
[data-trinh-xem-ma] [data-streamdown="code-block-body"] code{ line-height:1.5rem !important; }
[data-trinh-xem-ma] [data-streamdown="code-block-body"] code > span::before{
  content:none !important; margin:0 !important; width:0 !important; padding:0 !important;
}
`;

/**
 * Trình xem một tệp: gutter số dòng (trái) + khối mã Streamdown tô cú pháp (phải, cuộn ngang).
 *
 * ⚠ `React.JSX.Element` (KHÔNG `JSX.Element` trần — React19 báo TS2503).
 */
export function TrinhXemMa({
  noiDung,
  duongDan,
  dongMucTieu = null,
}: {
  /** Nội dung tệp (server đã đọc, có thể đã cắt/che). */
  noiDung: string;
  /** Đường tệp — chỉ để SUY ngôn ngữ theo đuôi (không hiển thị; tiêu đề do trang lo). */
  duongDan: string;
  /** Dòng cần TÔ SÁNG (mở từ panel Vấn đề). `null` ⇒ không tô. KHÔNG tự cuộn. */
  dongMucTieu?: number | null;
}): React.JSX.Element {
  const lang = suyNgonNgu(duongDan);
  const noiDungChuan = chuanHoaNoiDung(noiDung);
  const dong = noiDungChuan.split("\n");
  const rao = "`".repeat(soBacktickRao(noiDungChuan));
  const fenced = `${rao}${lang}\n${noiDungChuan}\n${rao}`;

  return (
    <div data-trinh-xem-ma className="min-w-0 text-[13px]">
      <style>{CSS_GHI_DE}</style>
      <div className="flex min-w-0 py-2">
        {/* ── GUTTER: số dòng THẬT (nguồn sự thật, tô-sáng được từng dòng). KHÔNG cuộn ngang. ── */}
        <div
          data-gutter
          aria-hidden="true"
          className="shrink-0 select-none border-r border-border/60 pr-3 pl-3 text-right font-mono tabular-nums text-muted-foreground/60"
        >
          {dong.map((_, i) => {
            const n = i + 1;
            const sang = dongMucTieu != null && n === dongMucTieu;
            return (
              <div
                key={i}
                data-so-dong={n}
                data-dong-sang={sang ? "true" : undefined}
                className={cn(
                  "leading-6",
                  sang && "-mr-3 -ml-3 rounded-sm bg-amber-100 px-3 font-semibold text-amber-700 dark:bg-amber-400/20 dark:text-amber-300",
                )}
              >
                {n}
              </div>
            );
          })}
        </div>
        {/* ── MÃ: Streamdown tô cú pháp. `overflow-x-auto` + (qua CSS) `white-space:pre` ⇒ cuộn ngang, KHÔNG wrap. ── */}
        <div data-ma className="min-w-0 flex-1 overflow-x-auto pl-3">
          <Streamdown mode="static" controls={false}>
            {fenced}
          </Streamdown>
        </div>
      </div>
    </div>
  );
}

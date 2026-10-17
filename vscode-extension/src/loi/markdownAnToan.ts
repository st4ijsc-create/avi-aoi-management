/**
 * ★★★ ĐỢT 4B — MARKDOWN AN TOÀN cho webview chat (khảo sát VSCode P1-1).
 *
 * Thư viện: `marked` (nhẹ, đóng gói vào bundle) — NHƯNG chỉ dùng BỘ PHÂN TÍCH (`Lexer`), KHÔNG dùng bộ dựng HTML.
 * Đầu ra là một CÂY DỮ LIỆU THUẦN (`NutMd[]`) chỉ gồm các loại nút trong danh sách trắng; webview dựng DOM từ cây ấy
 * bằng `createElement` + `textContent` — KHÔNG BAO GIỜ gán `innerHTML` với HTML (kể cả HTML "đã làm sạch"). Vì thế:
 *   · HTML thô trong markdown (`<script>`, `<img onerror>`, `<b>`) ⇒ thành CHỮ hiển thị nguyên văn, không thành thẻ;
 *   · liên kết chỉ giữ `href` khi scheme là http/https/mailto — `javascript:`/`data:`/`vscode:`… ⇒ chỉ còn chữ;
 *   · ảnh ⇒ chữ "[ảnh: alt]" (không tải gì; CSP của webview cũng chặn mọi nguồn ngoài).
 * Lớp phòng thủ thứ hai: CSP `default-src 'none'; script-src 'nonce-…'` của `htmlBang.ts` (không `unsafe-inline`).
 */
import { Lexer, type Token, type Tokens } from "marked";

export type NutMd =
  | { t: "p" | "blockquote" | "li" | "strong" | "em" | "del"; con: NutMd[] }
  | { t: "h"; cap: number; con: NutMd[] }
  | { t: "ul" | "ol"; con: NutMd[]; batDau?: number }
  | { t: "code"; ngonNgu: string; ma: string }
  | { t: "codespan"; chu: string }
  | { t: "a"; href: string; con: NutMd[] }
  | { t: "text"; chu: string }
  | { t: "br" }
  | { t: "hr" }
  | { t: "table"; dau: NutMd[][]; hang: NutMd[][][] };

const TRAN_KY_TU_MD = 200_000;

/** Scheme được giữ `href`. Mọi thứ khác (javascript:, data:, vscode:, file:, command:) ⇒ chỉ còn chữ. */
export function hrefAnToan(href: string): string | null {
  const h = (href ?? "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(h) && !/[\u0000-\u001f\s]/.test(h)) return h;
  return null;
}

const boEntity = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function noiDong(tokens: Token[] | undefined): NutMd[] {
  const ra: NutMd[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "text": {
        const t = tk as Tokens.Text;
        if (t.tokens?.length) ra.push(...noiDong(t.tokens));
        else ra.push({ t: "text", chu: t.escaped ? boEntity(t.text) : t.text });
        break;
      }
      case "escape":
        ra.push({ t: "text", chu: (tk.raw ?? "").replace(/^\\/, "") });
        break;
      case "strong":
      case "em":
      case "del":
        ra.push({ t: tk.type, con: noiDong((tk as Tokens.Strong).tokens) });
        break;
      case "codespan":
        ra.push({ t: "codespan", chu: (tk as Tokens.Codespan).text });
        break;
      case "br":
        ra.push({ t: "br" });
        break;
      case "link": {
        const l = tk as Tokens.Link;
        const href = hrefAnToan(l.href);
        const con = noiDong(l.tokens);
        if (href) ra.push({ t: "a", href, con });
        else ra.push(...con, { t: "text", chu: ` (${l.href})` });
        break;
      }
      case "image":
        ra.push({ t: "text", chu: `[ảnh: ${(tk as Tokens.Image).text || "không tên"}]` });
        break;
      default:
        // html, checkbox, mọi loại lạ ⇒ CHỮ nguyên văn (không bao giờ thành thẻ).
        ra.push({ t: "text", chu: tk.raw ?? (tk as { text?: string }).text ?? "" });
    }
  }
  return ra;
}

function khoi(tokens: Token[] | undefined): NutMd[] {
  const ra: NutMd[] = [];
  for (const tk of tokens ?? []) {
    switch (tk.type) {
      case "space":
      case "def":
        break;
      case "paragraph":
        ra.push({ t: "p", con: noiDong((tk as Tokens.Paragraph).tokens) });
        break;
      case "heading": {
        const h = tk as Tokens.Heading;
        ra.push({ t: "h", cap: Math.min(6, Math.max(1, h.depth)), con: noiDong(h.tokens) });
        break;
      }
      case "code": {
        const c = tk as Tokens.Code;
        ra.push({ t: "code", ngonNgu: (c.lang ?? "").split(/\s+/)[0].slice(0, 40), ma: c.text });
        break;
      }
      case "blockquote":
        ra.push({ t: "blockquote", con: khoi((tk as Tokens.Blockquote).tokens) });
        break;
      case "list": {
        const l = tk as Tokens.List;
        const con: NutMd[] = l.items.map((it) => {
          const than = khoi(it.tokens);
          if (it.task) than.unshift({ t: "text", chu: it.checked ? "☑ " : "☐ " });
          return { t: "li", con: than };
        });
        const bd = Number(l.start);
        ra.push(l.ordered ? { t: "ol", con, ...(Number.isFinite(bd) && bd > 1 ? { batDau: bd } : {}) } : { t: "ul", con });
        break;
      }
      case "table": {
        const b = tk as Tokens.Table;
        ra.push({ t: "table", dau: b.header.map((o) => noiDong(o.tokens)), hang: b.rows.map((h) => h.map((o) => noiDong(o.tokens))) });
        break;
      }
      case "hr":
        ra.push({ t: "hr" });
        break;
      case "text": {
        // khối "text" (trong mục danh sách gọn) ⇒ dòng nội tuyến
        const t = tk as Tokens.Text;
        ra.push(...(t.tokens?.length ? noiDong(t.tokens) : [{ t: "text" as const, chu: t.text }]));
        break;
      }
      default:
        // html khối (<script>…), loại lạ ⇒ đoạn CHỮ nguyên văn
        ra.push({ t: "p", con: [{ t: "text", chu: (tk.raw ?? "").replace(/\n+$/, "") }] });
    }
  }
  return ra;
}

/** Markdown ⇒ cây nút danh-sách-trắng. Không ném: lỗi phân tích ⇒ một đoạn chữ thuần. */
export function phanTichMarkdown(md: string): NutMd[] {
  const nguon = md.length > TRAN_KY_TU_MD ? `${md.slice(0, TRAN_KY_TU_MD)}\n\n…[đã cắt phần hiển thị]` : md;
  try {
    return khoi(new Lexer({ gfm: true }).lex(nguon));
  } catch {
    return [{ t: "p", con: [{ t: "text", chu: nguon }] }];
  }
}

/** Mọi khối mã (theo thứ tự xuất hiện) — để nút Chép/Chèn/Áp dụng tra theo chỉ số, không gửi mã ngược từ webview. */
export function khoiMa(cay: NutMd[]): Array<{ ngonNgu: string; ma: string }> {
  const ra: Array<{ ngonNgu: string; ma: string }> = [];
  const di = (ds: NutMd[]) => {
    for (const n of ds) {
      if (n.t === "code") ra.push({ ngonNgu: n.ngonNgu, ma: n.ma });
      else if ("con" in n) di(n.con);
    }
  };
  di(cay);
  return ra;
}

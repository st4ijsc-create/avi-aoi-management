/**
 * ★ 2026-10-14 · Đợt 0.5 — SỐ DÒNG khối mã trong chat hiện "1" ở MỌI dòng (đọc thành "1$ git status").
 *
 * GỐC RỄ ĐÃ ĐO (không đoán): Streamdown 1.6.11 dựng số dòng bằng LỚP Tailwind tuỳ ý trong bundle của
 * nó (`node_modules/streamdown/dist/code-block-*.js`): `<code class="[counter-increment:line_0]
 * [counter-reset:line]">` + mỗi dòng `<span class="block before:content-[counter(line)]
 * before:[counter-increment:line] before:w-4 before:mr-4 …">`. Tailwind v4 KHÔNG quét `node_modules`
 * ⇒ chỉ lớp nào TÌNH CỜ xuất hiện trong mã nguồn của ta mới được sinh — `before:content-[counter(line)]`
 * và `before:[counter-increment:line]` có (chú thích ở `TrinhXemMa.tsx`), còn `[counter-reset:line]`,
 * `before:inline-block`, `before:mr-4` thì KHÔNG. Thiếu `counter-reset` ở `<code>` ⇒ mỗi `span` tự lập
 * một bộ đếm mới ⇒ "1" ở mọi dòng; thiếu `inline-block`/`mr-4` ⇒ số dính vào chữ ("1$ git status").
 *
 * Lưới này khoá HAI vế: (1) hợp đồng DOM của Streamdown mà bộ chọn của ta bám vẫn còn đúng
 * (`data-streamdown="code-block-body"` > `code` > `span`); (2) `index.css` đặt TƯỜNG MINH bộ đếm +
 * khoảng cách, không trông vào việc một chú thích nào đó tình cờ chứa tên lớp.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, "..", "..", "index.css"), "utf8");
const DIST = resolve(HERE, "..", "..", "..", "..", "node_modules", "streamdown", "dist");

/** Thân khối luật cho đúng một bộ chọn (so khít chuỗi bộ chọn, bỏ khoảng trắng thừa). */
function thanLuat(boChon: string): string | null {
  const phang = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
  const i = phang.indexOf(`${boChon} {`);
  if (i < 0) return null;
  const mo = phang.indexOf("{", i);
  return phang.slice(mo + 1, phang.indexOf("}", mo));
}

describe("số dòng khối mã Streamdown", () => {
  it("★ hợp đồng DOM của Streamdown (bản đang cài) vẫn khớp bộ chọn của ta", () => {
    const tep = readdirSync(DIST).filter((f) => /^code-block-.*\.js$/.test(f));
    expect(tep.length, "không thấy bundle code-block của streamdown").toBeGreaterThan(0);
    const nguon = tep.map((f) => readFileSync(join(DIST, f), "utf8")).join("\n");
    expect(nguon).toContain('"data-streamdown":"code-block-body"');
    expect(nguon).toContain("[counter-reset:line]");
    expect(nguon).toContain("before:[counter-increment:line]");
  });

  it("★★★ <code> của khối mã ĐẶT LẠI bộ đếm `line` (thiếu ⇒ '1' ở mọi dòng)", () => {
    const than = thanLuat('[data-streamdown="code-block-body"] > code');
    expect(than, "index.css thiếu luật counter-reset cho khối mã").not.toBeNull();
    expect(than).toMatch(/counter-reset:\s*line\b/);
  });

  it("★★★ mỗi dòng TĂNG bộ đếm, hiện số, và số TÁCH khỏi chữ (không '1$ git status')", () => {
    const than = thanLuat('[data-streamdown="code-block-body"] > code > span::before');
    expect(than, "index.css thiếu luật ::before cho dòng mã").not.toBeNull();
    expect(than).toMatch(/counter-increment:\s*line\b/);
    expect(than).toMatch(/content:\s*counter\(line\)/);
    expect(than).toMatch(/display:\s*inline-block/);
    expect(than).toMatch(/margin-right:\s*[1-9]/);
    expect(than, "số dòng không được lọt vào vùng chọn/chép").toMatch(/user-select:\s*none/);
    // ⚠ KHÔNG !important: `TrinhXemMa` TẮT số dòng CSS bằng `content:none !important` (nó có gutter
    //   riêng) — luật toàn cục này phải THUA luật ấy.
    expect(than).not.toContain("!important");
  });
});

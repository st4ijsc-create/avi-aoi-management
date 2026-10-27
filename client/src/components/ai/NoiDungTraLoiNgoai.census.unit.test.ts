/**
 * Đợt 10.4b (L0b) — CENSUS bộ render câu trả lời model ngoài: tệp KHÔNG được dùng plugin (rehype-raw / remark-* / rehype-* / katex / mermaid / streamdown),
 * `dangerouslySetInnerHTML`, `innerHTML`; PHẢI ghi đè `a`, `img`, `pre`; không gán `href=`/`src=`. Khi các bề mặt (L1+) hiển thị trả lời ngoài, mỗi bề mặt phải import bộ này
 * (thêm vào danh sách bên dưới + đột biến). Đột biến: thêm plugin / bỏ ghi đè / gán href ⇒ đỏ.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../../../..");
const nguon = readFileSync(join(GOC, "client/src/components/ai/NoiDungTraLoiNgoai.tsx"), "utf8");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("census — NoiDungTraLoiNgoai", () => {
  const ma = bo(nguon);
  it("không plugin, không HTML thô", () => {
    for (const cam of ["rehype-raw", "rehype-", "remark-", "katex", "mermaid", "streamdown", "dangerouslySetInnerHTML", "innerHTML", "remarkPlugins", "rehypePlugins", "skipHtml={false}", "allowDangerousHtml"]) {
      expect(ma.includes(cam), `không được dùng ${cam}`).toBe(false);
    }
  });
  it("ghi đè đủ a / img / pre; liên kết/ảnh KHÔNG gán href/src", () => {
    for (const k of ["a: (", "img: (", "pre: ("]) expect(ma.includes(k), `thiếu ghi đè ${k}`).toBe(true);
    expect(/\bhref\s*=\s*[{"]/.test(ma), "gán href=").toBe(false);
    expect(/\bsrc\s*=\s*[{"]/.test(ma), "gán src=").toBe(false);
    expect(/<a[\s>]/.test(ma), "thẻ <a>").toBe(false);
    expect(/<img[\s>]/.test(ma), "thẻ <img>").toBe(false);
  });
  it("chỉ import react-markdown (không bộ render nào khác)", () => {
    const imports = Array.from(ma.matchAll(/^import .* from "([^"]+)";/gm)).map((m) => m[1]);
    for (const i of imports) expect(["react", "react-markdown", "react-i18next", "sonner", "@shared/ai/kiemDinhNgoai"].includes(i), `import lạ: ${i}`).toBe(true);
  });
});

// @vitest-environment jsdom
//
// Đợt 10.4b (L0b) — bộ render DUY NHẤT cho câu trả lời model NGOÀI: ≥ 12 payload (kiem-dinh M6) ⇒ không phần tử nguy hiểm, không yêu cầu mạng, liên kết KHÔNG bấm được
// (chữ + tên miền), ảnh tắt hoàn toàn, khối mã chỉ "Chép".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d?: unknown) => (typeof d === "string" ? d : _k) }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { NoiDungTraLoiNgoai, tenMienCuaLienKet } from "./NoiDungTraLoiNgoai";

let fetchSpy: ReturnType<typeof vi.fn>;
let anh: string[];
const GocImage = globalThis.Image;
beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  anh = [];
  vi.stubGlobal(
    "Image",
    class {
      set src(v: string) {
        anh.push(v);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.Image = GocImage;
});

const NGUY_HIEM = "a, img, svg, iframe, style, script, object, embed, link, form, input, video, audio, math, details, base, meta";

const PAYLOAD: Array<[string, string]> = [
  ["ảnh markdown tự tải", "![x](http://127.0.0.1:9/leak?c=ABC)"],
  ["ảnh tham chiếu", "![x][1]\n\n[1]: http://evil.example/p.png"],
  ["autolink", "<http://evil.example/auto>"],
  ["liên kết javascript:", "[bấm](javascript:alert(1))"],
  ["liên kết data:", "[bấm](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
  ["liên kết //host", "[bấm](//evil.example/x)"],
  ["liên kết vbscript:", "[bấm](vbscript:msgbox(1))"],
  ["liên kết tham chiếu", "[bấm][r]\n\n[r]: javascript:alert(1)"],
  ["<img> thô", "<img src=x onerror=alert(1)>"],
  ["<svg> thô", "<svg onload=alert(1)></svg>"],
  ["<iframe> thô", "<iframe src=//evil.example></iframe>"],
  ["<style> thô", "<style>body{display:none}</style>"],
  ["<script> thô", "<script>alert(1)</script>"],
  ["<a href> thô", '<a href="javascript:alert(1)">x</a>'],
  ["<details>/<form> thô", "<details open ontoggle=alert(1)>x</details><form action=//evil.example><input name=p></form>"],
  ["toán \\href", "$$\\href{javascript:alert(1)}{x}$$"],
  ["toán \\includegraphics", "$\\includegraphics{http://evil.example/a.png}$"],
  ["mermaid", "```mermaid\ngraph TD; A-->B; click A href \"javascript:alert(1)\"\n```"],
  ["bảng", "| a | b |\n|---|---|\n| <img src=x onerror=alert(1)> | ![x](http://evil.example/t.png) |"],
  ["entity", "&lt;script&gt;alert(1)&lt;/script&gt; &#x3C;img src=x onerror=alert(1)&#x3E;"],
];

describe("NoiDungTraLoiNgoai — ≥ 12 payload ⇒ không phần tử nguy hiểm, không yêu cầu mạng", () => {
  it.each(PAYLOAD)("%s", (_ten, p) => {
    const { container } = render(<NoiDungTraLoiNgoai noiDung={p} />);
    expect(container.querySelectorAll(NGUY_HIEM).length, container.innerHTML.slice(0, 200)).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(anh).toEqual([]);
    // không THUỘC TÍNH sự kiện / href / src nào trên bất kỳ phần tử nào (chuỗi "onerror=" nằm trong CHỮ đã thoát thì không tính)
    const bad: string[] = [];
    for (const el of Array.from(container.querySelectorAll("*"))) {
      for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name) || /^(href|src|srcset|data|action|formaction|style)$/i.test(a.name)) bad.push(`${el.tagName}[${a.name}]`);
    }
    expect(bad).toEqual([]);
  });
});

describe("NoiDungTraLoiNgoai — hành vi", () => {
  it("liên kết KHÔNG bấm được: chữ + tên miền; giao thức lạ / tương đối ⇒ 'liên kết bị chặn'", () => {
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"[trang](https://docs.example.com/a?b=1) và [xấu](javascript:alert(1)) và [rel](/uploads/x) và [hai](//evil.example/x)"} />);
    const ds = Array.from(container.querySelectorAll("[data-ngoai-lien-ket]")).map((e) => e.textContent);
    expect(ds[0]).toContain("trang");
    expect(ds[0]).toContain("(docs.example.com)");
    for (const i of [1, 2, 3]) expect(ds[i]).toContain("liên kết bị chặn");
    expect(container.querySelector("a")).toBeNull();
  });
  it("ảnh tắt hoàn toàn: placeholder chữ kèm chú thích", () => {
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"![biểu đồ](http://evil.example/p.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-ngoai-anh]")!.textContent).toBe("[ảnh bị chặn: biểu đồ]");
  });
  it("HTML thô hiển thị như CHỮ (không biến mất âm thầm, không thành phần tử)", () => {
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"<img src=x onerror=alert(1)>"} />);
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
  it("khối mã: chỉ nút Chép (không Áp dụng/Chạy) + cảnh báo; Chép đặt đúng văn bản mã", async () => {
    const ghi = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: ghi } });
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"Chạy:\n\n```sh\nrm -rf /tmp/x\n```"} />);
    const nut = container.querySelectorAll("button");
    expect(Array.from(nut).map((b) => b.textContent)).toEqual(["Chép"]);
    expect(container.textContent).toContain("Do AI ngoài viết");
    fireEvent.click(nut[0]!);
    await waitFor(() => expect(ghi).toHaveBeenCalledWith("rm -rf /tmp/x\n"));
  });
  it("tenMienCuaLienKet: http(s) ⇒ hostname; còn lại ⇒ null", () => {
    expect(tenMienCuaLienKet("https://Docs.Example.com/x")).toBe("docs.example.com");
    for (const x of ["javascript:alert(1)", "data:text/html,x", "//evil.example/x", "/rel/path", "mailto:a@b.c", "", undefined, 5, "http://[::1"]) expect(tenMienCuaLienKet(x as never), String(x)).toBeNull();
  });
  it("văn bản thường + markdown an toàn (in đậm, danh sách) vẫn hiển thị", () => {
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"**Đậm**\n\n- một\n- hai"} />);
    expect(container.querySelector("strong")!.textContent).toBe("Đậm");
    expect(container.querySelectorAll("li").length).toBe(2);
  });
});

describe("NoiDungTraLoiNgoai — Trojan Source (bidi/zero-width trong khối mã)", () => {
  it("hiển thị VÀ chép đều không còn U+202E / U+2066 / U+200B; nội dung còn lại giữ nguyên", async () => {
    const ghi = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: ghi } });
    const ma = "if (ok) {‮ return 1;⁦ } //​ end\n";
    const { container } = render(<NoiDungTraLoiNgoai noiDung={"```js\n" + ma + "```"} />);
    expect(container.textContent).not.toMatch(/[‪-‮⁦-⁩​-‏﻿]/);
    fireEvent.click(container.querySelector("[data-ngoai-chep]")!);
    await waitFor(() => expect(ghi).toHaveBeenCalledWith("if (ok) { return 1; } // end\n"));
  });
});

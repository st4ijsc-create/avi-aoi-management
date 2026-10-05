// @vitest-environment jsdom
//
// doc 81 Đợt 3 Task 0 (D4, browser check 2026-10-05) — React Flow mặc định `colorMode="light"` ⇒ wrapper mang lớp
// `light` ⇒ các token `.light` (index.css: `:root` = tối, `.light` = sáng) bị khai lại BÊN TRONG canvas trong khi
// `<html class="dark">`: nút điều khiển/minimap trắng, bảng "THÊM · LD" của POU trắng với nhãn sáng (vô hình).
// Hợp đồng: (1) `useResolvedTheme()` trả theme thật của app (ThemeProvider; không có provider ⇒ đọc lớp của <html>);
// (2) CENSUS — mọi `<ReactFlow` trong client/src truyền `colorMode={…}` (không để mặc định "light").
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { ThemeProvider, useResolvedTheme } from "./ThemeContext";

function Probe() {
  return <span data-testid="t">{useResolvedTheme()}</span>;
}
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark", "light");
  localStorage.clear();
});

describe("useResolvedTheme", () => {
  it("ThemeProvider dark ⇒ dark; light ⇒ light", () => {
    render(<ThemeProvider defaultTheme="dark"><Probe /></ThemeProvider>);
    expect(screen.getByTestId("t").textContent).toBe("dark");
    cleanup();
    render(<ThemeProvider defaultTheme="light"><Probe /></ThemeProvider>);
    expect(screen.getByTestId("t").textContent).toBe("light");
  });
  it("không có provider ⇒ đọc lớp của <html> (dark ⇒ dark, còn lại ⇒ light); không ném", () => {
    document.documentElement.classList.add("dark");
    render(<Probe />);
    expect(screen.getByTestId("t").textContent).toBe("dark");
    cleanup();
    document.documentElement.classList.remove("dark");
    render(<Probe />);
    expect(screen.getByTestId("t").textContent).toBe("light");
  });
});

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** Phần props của thẻ mở JSX: tới `>` đầu tiên ở độ sâu ngoặc nhọn 0 (bỏ qua `=>` và `>` trong `{…}`). */
function openingTagProps(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

describe("CENSUS — <ReactFlow> theo theme của app", () => {
  it("cầu chì: bộ quét thấy colorMode đặt SAU một arrow function, và không lấy prop của thẻ con", () => {
    const a = `<ReactFlow onInit={() => rf.fitView()} colorMode={mode}><MiniMap colorMode="x" /></ReactFlow>`;
    expect(/\bcolorMode=\{/.test(openingTagProps(a, "<ReactFlow".length))).toBe(true);
    const b = `<ReactFlow onInit={() => rf.fitView()}><X colorMode={m} /></ReactFlow>`;
    expect(/\bcolorMode=\{/.test(openingTagProps(b, "<ReactFlow".length))).toBe(false);
  });

  it("mọi <ReactFlow …> trong client/src truyền colorMode", () => {
    const root = resolve(__dirname, "..");
    const sites: string[] = [];
    const missing: string[] = [];
    for (const f of tsxFiles(root)) {
      const src = readFileSync(f, "utf8");
      const re = /<ReactFlow(?=[\s>])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const where = `${f.slice(root.length + 1)}:${src.slice(0, m.index).split("\n").length}`;
        sites.push(where);
        if (!/\bcolorMode=\{/.test(openingTagProps(src, m.index + m[0].length))) missing.push(where);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(5); // cầu chì: IR · POU · Orchestration · BOM · Causal
    expect(missing, `thiếu colorMode:\n${missing.join("\n")}`).toEqual([]);
  });
});

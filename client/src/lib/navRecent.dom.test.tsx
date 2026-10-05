// @vitest-environment jsdom
//
// Doc 81 Đợt 3 Task 5 — Fleet đổi đường dẫn (/fleet-orchestration ⇒ /labs/fleet-orchestration). Ghim / Gần đây là lối tắt
// NGƯỜI DÙNG đã lưu (localStorage, dùng chung thanh bên + ⌘K + Hub): URL cũ phải được đọc như URL mới — không thì mục đã
// ghim âm thầm biến mất (thanh bên chỉ hiện href khớp một mục nav). URL đã GỘP vào trang khác (Studio, Copilot) KHÔNG đổi.
import { beforeEach, describe, expect, it } from "vitest";
import { NAV_FAVORITES_KEY, NAV_RECENT_KEY, readFavorites, readRecent } from "./navRecent";
import { canonicalNavHref } from "./engineeringLegacyRedirects";
import NAV_RECENT_SRC from "./navRecent.ts?raw";
import TABLE_SRC from "./engineeringLegacyRedirectTable.ts?raw";

beforeEach(() => localStorage.clear());

describe("Ghim / Gần đây — URL đã đổi tên đọc như URL mới", () => {
  it("canonicalNavHref: chỉ URL `rename` (giữ query); URL gộp và URL thường giữ nguyên", () => {
    expect(canonicalNavHref("/fleet-orchestration")).toBe("/labs/fleet-orchestration");
    expect(canonicalNavHref("/fleet-orchestration?filter=deadlock")).toBe("/labs/fleet-orchestration?filter=deadlock");
    expect(canonicalNavHref("/fleet-orchestration-x")).toBe("/fleet-orchestration-x");
    expect(canonicalNavHref("/engineering-studio")).toBe("/engineering-studio");
    expect(canonicalNavHref("/recipes?filter=pending")).toBe("/recipes?filter=pending");
  });

  it("readFavorites / readRecent: URL cũ ⇒ URL mới, không trùng lặp, giữ thứ tự", () => {
    localStorage.setItem(NAV_FAVORITES_KEY, JSON.stringify(["/fleet-orchestration", "/recipes", "/labs/fleet-orchestration"]));
    localStorage.setItem(NAV_RECENT_KEY, JSON.stringify(["/safety-workforce", "/fleet-orchestration?tab=zones"]));
    expect(readFavorites()).toEqual(["/labs/fleet-orchestration", "/recipes"]);
    expect(readRecent()).toEqual(["/safety-workforce", "/labs/fleet-orchestration?tab=zones"]);
  });
});

// Final wave (doc 81 Đợt 3, M-4) — navRecent.ts hứa "framework-free (no React)": nó và mọi module nội bộ nó nhập không được
// kéo React/wouter/JSX (file .tsx) vào. Đo trên MÃ NGUỒN (chuỗi import), có cầu chì chứng minh bộ đo bắt được vi phạm.
describe("navRecent.ts framework-free (M-4)", () => {
  // import … from "x" · export … from "x" · import "x" (tác dụng phụ) · import("x") (động)
  const specs = (src: string) => [
    ...[...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
    ...[...src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  const viPham = (src: string, local: Record<string, string>): string[] =>
    specs(src).flatMap((sp) => {
      if (/^(react|react-dom|wouter)(\/|$)/.test(sp)) return [`${sp}: framework`];
      if (sp.startsWith("./")) {
        if (!(sp in local)) return [`${sp}: không phải module .ts thuần đã biết (vd .tsx)`];
        return viPham(local[sp], local);
      }
      return [];
    });
  const LOCAL = { "./engineeringLegacyRedirectTable": TABLE_SRC };

  it("thiết bị đo thấy dữ liệu: navRecent.ts nhập canonicalNavHref từ bảng thuần", () => {
    expect(specs(NAV_RECENT_SRC)).toContain("./engineeringLegacyRedirectTable");
  });

  it("navRecent.ts + bảng không nhập react/wouter hay file .tsx", () => {
    expect(viPham(NAV_RECENT_SRC, LOCAL)).toEqual([]);
  });

  it("cầu chì: bộ đo bắt được import .tsx và import wouter", () => {
    expect(viPham('import { canonicalNavHref } from "./engineeringLegacyRedirects";', LOCAL)).toHaveLength(1);
    expect(viPham('import { Redirect } from "wouter";', LOCAL)).toHaveLength(1);
    expect(viPham('import "wouter";', LOCAL)).toHaveLength(1);
    expect(viPham('const m = await import("./engineeringLegacyRedirects");', LOCAL)).toHaveLength(1);
    expect(viPham('import x from "./engineeringLegacyRedirectTable";', { "./engineeringLegacyRedirectTable": 'import React from "react";' })).toHaveLength(1);
  });
});

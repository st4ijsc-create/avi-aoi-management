/**
 * Đợt 11.7 — ĐẶT TÊN "Thợ Cả": đổi TÊN HIỂN THỊ, GIỮ NGUYÊN mã định danh (để người dùng không phải cài lại / không mất cài đặt).
 *   • bất biến định danh: `name` = avi-ai-local · `publisher` = st4i · mọi lệnh `aviAiLocal.*` · mọi khoá cài đặt `aviAiLocal.*` · id view/container không đổi;
 *   • tên hiển thị: `displayName`, tiêu đề container/view, tiền tố mọi lệnh ("Thợ Cả: …"), mô tả cài đặt — KHÔNG còn "AI Local" nào trong chuỗi người dùng thấy.
 * Đột biến: đổi một mã định danh / để sót "AI Local" ở một tiêu đề hay thông báo ⇒ đỏ.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(GOC, "package.json"), "utf8")) as {
  name: string;
  displayName: string;
  publisher: string;
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration?: { title?: string; properties: Record<string, { description?: string; markdownDescription?: string }> } | Array<{ title?: string; properties: Record<string, { description?: string }> }>;
    viewsContainers?: Record<string, Array<{ id: string; title: string }>>;
    views?: Record<string, Array<{ id: string; name: string }>>;
  };
};

function duyetTep(thuMuc: string, ds: string[] = []): string[] {
  for (const t of readdirSync(thuMuc)) {
    const d = join(thuMuc, t);
    if (statSync(d).isDirectory()) duyetTep(d, ds);
    else if (/\.ts$/.test(t) && !/\.test\.ts$/.test(t)) ds.push(d);
  }
  return ds;
}

describe("đặt tên Thợ Cả — mã định danh GIỮ NGUYÊN", () => {
  it("name / publisher không đổi", () => {
    expect(pkg.name).toBe("avi-ai-local");
    expect(pkg.publisher).toBe("st4i");
  });
  it("mọi lệnh có id aviAiLocal.* ; mọi khoá cài đặt aviAiLocal.*", () => {
    expect(pkg.contributes.commands.length).toBeGreaterThan(5);
    for (const c of pkg.contributes.commands) expect(c.command, c.command).toMatch(/^aviAiLocal\./);
    const cfg = pkg.contributes.configuration;
    const khoi = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
    for (const k of khoi) for (const khoa of Object.keys(k.properties)) expect(khoa, khoa).toMatch(/^aviAiLocal\./);
  });
  it("id container/view không chứa tên hiển thị mới (id cũ giữ nguyên)", () => {
    for (const ds of Object.values(pkg.contributes.viewsContainers ?? {})) for (const x of ds) expect(x.id).not.toMatch(/Thợ|Tho-?Ca/i);
    for (const ds of Object.values(pkg.contributes.views ?? {})) for (const x of ds) expect(x.id).not.toMatch(/Thợ|Tho-?Ca/i);
  });
});

describe("đặt tên Thợ Cả — tên hiển thị", () => {
  it("displayName + tiền tố lệnh + tiêu đề container/view/cấu hình", () => {
    expect(pkg.displayName).toContain("Thợ Cả");
    for (const c of pkg.contributes.commands) expect(c.title, c.command).toMatch(/^Thợ Cả: /);
    for (const ds of Object.values(pkg.contributes.viewsContainers ?? {})) for (const x of ds) expect(x.title).toBe("Thợ Cả");
    for (const ds of Object.values(pkg.contributes.views ?? {})) for (const x of ds) expect(x.name).toBe("Thợ Cả");
  });
  it("không còn 'AI Local' ở package.json / README / mã nguồn (chuỗi người dùng thấy)", () => {
    expect(readFileSync(join(GOC, "package.json"), "utf8")).not.toContain("AI Local");
    expect(readFileSync(join(GOC, "README.md"), "utf8")).not.toContain("AI Local");
    for (const tep of duyetTep(join(GOC, "src"))) expect(readFileSync(tep, "utf8"), tep).not.toContain("AI Local");
  });
});

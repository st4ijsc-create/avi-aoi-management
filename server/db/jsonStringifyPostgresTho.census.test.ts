/**
 * ★★★ CENSUS AST (kiểm định 2026-10-25) — `${JSON.stringify(x)}` trong tagged template của client postgres.js THÔ.
 * ĐO TRÊN DB THẬT: với postgres.js thô, `${JSON.stringify(o)}::jsonb` (có hoặc không cast) và cả cột json lưu thành CHUỖI JSON (jsonb_typeof = 'string', `->>` trả NULL) vì
 * postgres.js biết cột đích là json(b) nên tự stringify THÊM một lần. Qua drizzle (`db.execute(sql…)`) thì ra đối tượng — an toàn. Mã sản xuất hiện dùng drizzle; ba chỗ postgres.js thô
 * (scripts) đều ghi vào cột TEXT `audit_logs.details` nên `JSON.stringify` là đúng. Lưới này chặn "ai đó thêm INSERT json(b) bằng postgres.js thô": mọi placeholder `JSON.stringify(...)`
 * trong tagged template của tệp postgres.js thô (tệp import 'postgres', hoặc thẻ khác `sql`) PHẢI nằm trong DANH SÁCH MIỄN dưới đây kèm cột đích là TEXT (kiểm tra trên schema drizzle).
 * Muốn ghi json(b) bằng postgres.js thô: truyền thẳng đối tượng hoặc `sql.json(obj)`, KHÔNG JSON.stringify.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const GOC = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

export interface ChoThuong {
  dong: number;
  tag: string;
  vanBan: string; // phần chữ của template (để đối chiếu bảng/cột đích)
}

/** Các chỗ `${...JSON.stringify(...)...}` trong tagged template của tệp postgres.js THÔ. Tệp không thô ⇒ []. */
export function timChoPostgresTho(duongDan: string, noiDung: string): ChoThuong[] {
  if (!/JSON\.stringify/.test(noiDung)) return [];
  const nhapPostgres = /from\s+['"]postgres['"]|require\(\s*['"]postgres['"]\s*\)|import\(\s*['"]postgres['"]\s*\)/.test(noiDung);
  const sf = ts.createSourceFile(duongDan, noiDung, ts.ScriptTarget.Latest, true, /\.(ts|tsx)$/.test(duongDan) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const ra: ChoThuong[] = [];
  const duyet = (n: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(n) && ts.isTemplateExpression(n.template)) {
      const tag = n.tag.getText(sf);
      // thẻ `sql` của drizzle (tệp KHÔNG import postgres) an toàn; mọi trường hợp còn lại coi là postgres.js thô
      const tho = nhapPostgres || tag !== "sql";
      if (tho && n.template.templateSpans.some((sp) => /JSON\.stringify\(/.test(sp.expression.getText(sf)))) {
        const vanBan = [n.template.head.text, ...n.template.templateSpans.map((sp) => sp.literal.text)].join(" ").replace(/\s+/g, " ");
        ra.push({ dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, tag, vanBan });
      }
    }
    ts.forEachChild(n, duyet);
  };
  duyet(sf);
  return ra;
}

function lietKe(thuMuc: string, ra: string[] = []): string[] {
  for (const f of readdirSync(thuMuc)) {
    if (f === "node_modules" || f === "dist" || f === ".git") continue;
    const p = join(thuMuc, f);
    if (statSync(p).isDirectory()) lietKe(p, ra);
    else if (/\.(ts|mjs|js)$/.test(f) && !/\.test\.(ts|mjs|js)$/.test(f) && !/\.d\.ts$/.test(f)) ra.push(p);
  }
  return ra;
}

/** Danh sách miễn: tệp → số chỗ + cột đích (PHẢI là TEXT trong schema drizzle). */
const MIEN: Readonly<Record<string, { so: number; bang: string; cot: string; lyDo: string }>> = {
  "scripts/mappings-import.mjs": { so: 1, bang: "audit_logs", cot: "details", lyDo: "nhật ký kiểm toán import mapping — details là chuỗi JSON trong cột TEXT" },
  "scripts/lib/machineKeyRevoke.mjs": { so: 1, bang: "audit_logs", cot: "details", lyDo: "nhật ký thu hồi khoá máy hàng loạt — details TEXT" },
  "scripts/lib/stopPinCli.mjs": { so: 1, bang: "audit_logs", cot: "details", lyDo: "nhật ký gỡ ghim DỪNG — details TEXT" },
};

/** Kiểu cột (text/json/jsonb) của `bang.cot` theo schema drizzle (đọc nguồn drizzle/schema). */
function kieuCotSchema(bang: string, cot: string): string | undefined {
  const dir = join(GOC, "drizzle", "schema");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts")) continue;
    const src = readFileSync(join(dir, f), "utf8");
    const i = src.indexOf(`pgTable("${bang}"`);
    if (i < 0) continue;
    const khoi = src.slice(i, i + 6000);
    const m = new RegExp(`\\b${cot}\\s*:\\s*(text|json|jsonb|varchar)\\(`).exec(khoi);
    return m?.[1];
  }
  return undefined;
}

describe("JSON.stringify trong tagged template postgres.js thô", () => {
  const tep = [...lietKe(join(GOC, "server")), ...lietKe(join(GOC, "scripts"))];
  const tim: Record<string, ChoThuong[]> = {};
  for (const p of tep) {
    const c = timChoPostgresTho(p, readFileSync(p, "utf8"));
    if (c.length) tim[relative(GOC, p).split(sep).join("/")] = c;
  }

  it("★ mọi chỗ thô nằm trong danh sách miễn (đúng số lượng), và danh sách miễn không có mục thừa", () => {
    const so = Object.fromEntries(Object.entries(tim).map(([f, c]) => [f, c.length]));
    expect(so).toEqual(Object.fromEntries(Object.entries(MIEN).map(([f, m]) => [f, m.so])));
  });

  it("★ mỗi mục miễn: template nhắc đúng bảng + cột đích, và cột đích là TEXT trong schema drizzle (không phải json/jsonb)", () => {
    for (const [f, m] of Object.entries(MIEN)) {
      for (const c of tim[f] ?? []) {
        expect(c.vanBan, `${f}:${c.dong} phải ghi vào ${m.bang}`).toContain(m.bang);
        expect(c.vanBan, `${f}:${c.dong} phải nêu cột ${m.cot}`).toContain(m.cot);
      }
      expect(kieuCotSchema(m.bang, m.cot), `${m.bang}.${m.cot}`).toBe("text");
      expect(m.lyDo.length).toBeGreaterThan(15);
    }
  });

  it("cầu chì: quét đủ rộng (>300 tệp) và thật sự thấy các chỗ postgres.js thô đã biết", () => {
    expect(tep.length).toBeGreaterThan(300);
    expect(Object.keys(tim).length).toBeGreaterThanOrEqual(3);
  });
});

describe("vị từ không mù (đột biến trên mã giả)", () => {
  it("postgres.js thô + JSON.stringify::jsonb ⇒ BÁO; có cast hay không đều báo", () => {
    const src = "import postgres from 'postgres';\nconst sql = postgres(u);\nawait sql`INSERT INTO t (a) VALUES (${JSON.stringify(o)}::jsonb)`;\nawait sql`INSERT INTO t (a) VALUES (${JSON.stringify(o)})`;";
    expect(timChoPostgresTho("x.mjs", src)).toHaveLength(2);
  });
  it("thẻ khác `sql` trong tệp KHÔNG import postgres (tx nhận từ nơi khác) ⇒ BÁO", () => {
    expect(timChoPostgresTho("lib.mjs", "await tx`INSERT INTO t (a) VALUES (${JSON.stringify(o)})`;")).toHaveLength(1);
  });
  it("import động / require của postgres cũng là thô", () => {
    expect(timChoPostgresTho("a.mjs", "const P = (await import('postgres')).default;\nawait P`SELECT ${JSON.stringify(o)}`;")).toHaveLength(1);
    expect(timChoPostgresTho("b.js", "const P = require('postgres');\nawait sql`SELECT ${JSON.stringify(o)}`;")).toHaveLength(1);
  });
  it("placeholder lồng (điều kiện ba ngôi) vẫn bị bắt", () => {
    expect(timChoPostgresTho("c.mjs", "import postgres from 'postgres';\nawait sql`X ${a ? JSON.stringify(o) : null}`;")).toHaveLength(1);
  });
  it("drizzle `sql` (tệp không import postgres) ⇒ KHÔNG báo; JSON.stringify ngoài tagged template ⇒ KHÔNG báo; truyền đối tượng / sql.json ⇒ KHÔNG báo", () => {
    expect(timChoPostgresTho("d.ts", "import { sql } from 'drizzle-orm';\nawait db.execute(sql`INSERT INTO t (a) VALUES (${JSON.stringify(o)}::jsonb)`);")).toEqual([]);
    expect(timChoPostgresTho("e.mjs", "import postgres from 'postgres';\nconst s = JSON.stringify(o);\nawait sql`INSERT INTO t (a) VALUES (${s})`;")).toEqual([]);
    expect(timChoPostgresTho("f.mjs", "import postgres from 'postgres';\nawait sql`INSERT INTO t (a) VALUES (${sql.json(o)})`;")).toEqual([]);
  });
});

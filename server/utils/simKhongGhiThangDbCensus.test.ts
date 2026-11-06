/**
 * 70-N1 (nghiệm thu E0-2, đã sửa câu chữ 2026-11-04): KHÔNG tiến trình giả lập SỐNG nào (daemon · service · scheduler · lúc khởi động) INSERT thẳng vào DB.
 * Miễn trừ CÓ TÊN: `seed.mjs` + `seed-production.mjs` — bộ nạp dữ liệu dev CHẠY TAY (`npm run sim:factory` / `sim:production`), chỉ ghi site origin=sim.
 * Lưới này canh ba cổng: (1) INSERT trong `scripts/sim*` chỉ ở hai tệp ấy; (2) hai tệp ấy không tự chạy theo lịch; (3) không mã máy chủ / lệnh khởi động / triển khai nào gọi chúng.
 * Đột biến (đã đo): thêm `import("../../scripts/sim-factory/seed.mjs")` vào server/_core/index.ts ⇒ ĐỎ cổng 3; thêm tệp scripts/sim-factory/x.mjs có `INSERT INTO` ⇒ ĐỎ cổng 1;
 * thêm `setInterval` vào seed.mjs ⇒ ĐỎ cổng 2; thêm `"prestart": "npm run sim:factory"` vào package.json ⇒ ĐỎ cổng 3.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const MIEN_TRU = new Set(["scripts/sim-factory/seed.mjs", "scripts/sim-factory/seed-production.mjs"]);
const DUOI = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".mts", ".sh", ".ps1", ".yml", ".yaml", ".json"]);
const BO_QUA = new Set(["node_modules", "dist", ".git", "uploads", "test-results", "models", "vendor", ".vite"]);

function* duyet(dir: string): Generator<string> {
  let ds: fs.Dirent[];
  try { ds = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ds) {
    if (BO_QUA.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* duyet(p);
    else if (DUOI.has(path.extname(d.name))) yield p;
  }
}
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const docMa = (p: string) => fs.readFileSync(p, "utf8");
/** Bỏ chú thích để câu chữ trong bình luận không gây đỏ oan. */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

const TEP_SIM = [...duyet(path.join(ROOT, "scripts"))].map(rel).filter((r) => /^scripts\/sim[^/]*\//.test(r));

describe("70-N1 — giả lập không ghi thẳng DB theo kiểu tiến trình sống", () => {
  it("có tệp để quét (lưới không rỗng)", () => {
    expect(TEP_SIM.length).toBeGreaterThan(3);
    for (const t of MIEN_TRU) expect(TEP_SIM, t).toContain(t);
  });

  it("★ cổng 1 — INSERT / .insert( trong scripts/sim* CHỈ ở hai bộ nạp chạy tay có tên", () => {
    const vi = TEP_SIM.filter((r) => /\bINSERT\s+INTO\b|\.insert\s*\(/i.test(boChuThich(docMa(path.join(ROOT, r))))).filter((r) => !MIEN_TRU.has(r));
    expect(vi).toEqual([]);
  });

  it("★ cổng 2 — hai bộ nạp không tự chạy theo lịch (setInterval · cron · schedule · vòng while(true))", () => {
    for (const t of MIEN_TRU) {
      const ma = boChuThich(docMa(path.join(ROOT, t)));
      expect(/\bsetInterval\s*\(|node-cron|\bcron\b|\.schedule\s*\(|while\s*\(\s*true\s*\)/i.test(ma), `${t} có dấu hiệu chạy theo lịch`).toBe(false);
    }
  });

  it("★ cổng 3 — không mã máy chủ / client / triển khai nào gọi bộ nạp (khởi động, lịch, tiến trình con)", () => {
    const THU_MUC = ["server", "client/src", "shared", "deploy", "FactoryAlertSystem", "apps"];
    const CAM = /sim-factory\/(seed|seed-production)(\.mjs)?\b|\bsim:(factory|production)\b/;
    const vi: string[] = [];
    for (const m of THU_MUC) {
      for (const f of duyet(path.join(ROOT, m))) {
        const r = rel(f);
        if (/\.(test|spec)\.[cm]?[tj]sx?$/.test(r)) continue;
        if (CAM.test(boChuThich(docMa(f)))) vi.push(r);
      }
    }
    for (const f of ["docker-compose.yml", "Dockerfile"]) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p) && CAM.test(docMa(p).replace(/^\s*#.*$/gm, ""))) vi.push(f);
    }
    expect(vi).toEqual([]);
  });

  it("★ cổng 3b — package.json: lệnh khởi động / cài đặt / dựng không gọi sim:* hay sim-factory", () => {
    const pj = JSON.parse(docMa(path.join(ROOT, "package.json"))) as { scripts: Record<string, string> };
    const NHAY = /^(start|dev|serve|postinstall|preinstall|prepare|prestart|predev|prebuild|build|postbuild|worker|api|edge|central)(:.*)?$/;
    const vi = Object.entries(pj.scripts).filter(([k, v]) => NHAY.test(k) && /sim:|sim-factory/.test(v)).map(([k]) => k);
    expect(vi).toEqual([]);
    // đối chứng: các lệnh chạy tay của bộ nạp VẪN còn (miễn trừ có thật, không phải hư danh)
    expect(pj.scripts["sim:factory"]).toMatch(/seed\.mjs/);
    expect(pj.scripts["sim:production"]).toMatch(/seed-production\.mjs/);
    expect(pj.scripts["sim:live"]).toBeUndefined();
  });
});

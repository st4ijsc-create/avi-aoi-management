/**
 * ★ Đợt 12 B1 (điều kiện 4 của dieu-phoi 03/11) — census: `vendor/oip-plc` CHỈ được tham chiếu từ `scripts/ai-eval/st-hanh-vi/`
 * (bộ bọc + lưới). Không mã server / client / shared / extension / e2e / script khác nào nhắc tới nó (kể cả chuỗi, import động).
 * Thêm một tham chiếu ở chỗ khác ⇒ ĐỎ kèm tên tệp. Thư mục vendor còn đúng bộ tệp đã ghi trong THIRD_PARTY.md.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const GOC = path.resolve(__dirname, "..", "..", "..");
const CHO_PHEP = path.join("scripts", "ai-eval", "st-hanh-vi") + path.sep;
const QUET = ["server", "client", "shared", "vscode-extension", "e2e", "scripts", "drizzle"];
const BO_QUA = new Set(["node_modules", "dist", "build", ".git", "out", "coverage"]);
const DUOI = /\.(m?[jt]sx?|cjs|json)$/;
const MAU = /oip-plc|vendor[\\/]+oip/;

function* tep(thuMuc: string): Generator<string> {
  let ds: fs.Dirent[];
  try {
    ds = fs.readdirSync(thuMuc, { withFileTypes: true });
  } catch {
    return;
  }
  for (const d of ds) {
    if (BO_QUA.has(d.name)) continue;
    const p = path.join(thuMuc, d.name);
    if (d.isDirectory()) yield* tep(p);
    else if (DUOI.test(d.name)) yield p;
  }
}

describe("census — vendor/oip-plc chỉ dùng trong scripts/ai-eval/st-hanh-vi", () => {
  it("không tệp mã nào ngoài thư mục cho phép nhắc tới vendor/oip-plc", () => {
    const vi: string[] = [];
    let soTep = 0;
    for (const goc of QUET) {
      for (const p of tep(path.join(GOC, goc))) {
        soTep++;
        const rel = path.relative(GOC, p);
        if (rel.startsWith(CHO_PHEP)) continue;
        if (MAU.test(fs.readFileSync(p, "utf8"))) vi.push(rel.split(path.sep).join("/"));
      }
    }
    expect(soTep, "thiết bị đo: phải quét thấy tệp (glob rỗng ⇒ xanh giả)").toBeGreaterThan(1000);
    expect(vi).toEqual([]);
  });

  it("thư mục cho phép THẬT SỰ dùng vendor (bộ bọc import interpreter) — ca trên không xanh vì đường dẫn sai", () => {
    expect(fs.readFileSync(path.join(GOC, CHO_PHEP, "stHanhVi.ts"), "utf8")).toMatch(MAU);
  });

  it("vendor/oip-plc: 37 tệp .ts + LICENSE + THIRD_PARTY.md + va-vendor.patch — không thêm tệp ngoài bảng", () => {
    const v = path.join(GOC, "vendor", "oip-plc");
    const ds = [...(function* di(t: string): Generator<string> {
      for (const d of fs.readdirSync(t, { withFileTypes: true })) {
        const p = path.join(t, d.name);
        if (d.isDirectory()) yield* di(p);
        else yield path.relative(v, p).split(path.sep).join("/");
      }
    })(v)].sort();
    const bang = fs.readFileSync(path.join(v, "THIRD_PARTY.md"), "utf8");
    const trongBang = [...bang.matchAll(/^\| `((?:src\/[^`]+\.ts)|LICENSE)` \| \d+ \|/gm)].map((m) => m[1]!).sort();
    expect(trongBang).toHaveLength(38);
    expect(ds).toEqual([...trongBang, "THIRD_PARTY.md", "va-vendor.patch"].sort());
  });

  it("vendor/oip-plc: sha256 từng tệp = bảng upstream trong THIRD_PARTY.md; riêng scanCodegen.ts = sha SAU va-vendor.patch (không ai sửa lén)", () => {
    const v = path.join(GOC, "vendor", "oip-plc");
    const bang = fs.readFileSync(path.join(v, "THIRD_PARTY.md"), "utf8");
    const sauPatch = /scanCodegen\.ts` sau `va-vendor\.patch`: sha256 `([0-9a-f]{64})`/.exec(bang)?.[1];
    expect(sauPatch).toMatch(/^[0-9a-f]{64}$/);
    const lech: string[] = [];
    for (const m of bang.matchAll(/^\| `((?:src\/[^`]+\.ts)|LICENSE)` \| \d+ \| `([0-9a-f]{64})` \|/gm)) {
      const ky = m[1] === "src/plc/scanCodegen.ts" ? sauPatch : m[2];
      const thuc = createHash("sha256").update(fs.readFileSync(path.join(v, m[1]!))).digest("hex");
      if (thuc !== ky) lech.push(m[1]!);
    }
    expect(lech).toEqual([]);
  });
});

/**
 * H1 (audit 2026-10-21) — CENSUS: không đường nào gọi luồng con mà bỏ qua bản GHIM.
 * (1) mã node (`nut/*.ts`) không được đọc "phiên bản hoạt động" của luồng khác (`phienBanHoatDong`) — đó là lỗ H1;
 * (2) MỌI lời gọi `kiemGoiLuongCon(` ngoài định nghĩa phải truyền đối số thứ BA (phiên bản ghim);
 * (3) chỉ hai loại node được phép mang tham chiếu luồng con (`luong.goi-con`, `ai.agent`) — node thứ ba tự đọc `parameters.flowId`
 *     hoặc `luongCon` sẽ không được `kiemLuong` tính hạng/ghim ⇒ phải đi qua `luongConThamChieu` (shared/flow/model.ts).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NUT = join(dirname(fileURLToPath(import.meta.url)), "nut");
const nutFiles = readdirSync(NUT).filter((f) => f.endsWith(".ts") && !/\.test\./.test(f));
const src = (f: string) => readFileSync(join(NUT, f), "utf8");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("H1 census — gọi luồng con luôn qua bản GHIM", () => {
  it("cầu chì: thấy đủ các tệp node (không đo trên tập rỗng)", () => {
    expect(nutFiles.length).toBeGreaterThanOrEqual(8);
    expect(nutFiles).toContain("luong.ts");
    expect(nutFiles).toContain("agent.ts");
  });

  it("(1) không tệp node nào gọi phienBanHoatDong(", () => {
    const vi = nutFiles.filter((f) => /\bphienBanHoatDong\s*\(/.test(bo(src(f))));
    expect(vi).toEqual([]);
  });

  it("(2) mọi lời gọi kiemGoiLuongCon( truyền phiên bản ghim (đối số thứ ba)", () => {
    const loi: string[] = [];
    let thay = 0;
    for (const f of nutFiles) {
      for (const m of bo(src(f)).matchAll(/\bkiemGoiLuongCon\s*\(([^)]*)\)/g)) {
        if (/export\s+async\s+function/.test(m[0])) continue;
        thay++;
        if ((m[1].match(/,/g) ?? []).length < 2) loi.push(`${f}: kiemGoiLuongCon(${m[1].trim()})`);
      }
    }
    expect(thay, "không thấy lời gọi nào — mẫu dò đã hỏng?").toBeGreaterThanOrEqual(2);
    expect(loi).toEqual([]);
  });

  it("(3) chỉ luong.ts và agent.ts đọc tham chiếu luồng con từ tham số node", () => {
    const doc = nutFiles.filter((f) => /(?:thamSo|parameters)\??\.(?:flowId|luongCon)\b/.test(bo(src(f))));
    expect(doc.sort()).toEqual(["agent.ts", "luong.ts"]);
  });
});

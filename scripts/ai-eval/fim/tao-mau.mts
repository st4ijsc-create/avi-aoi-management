/**
 * ★★★ ĐỢT 4C — dựng bộ mẫu FIM từ MÃ THẬT của repo (tất định, hạt giống cố định).
 *
 *   FIM_BAN=f4b504dc5 npx tsx scripts/ai-eval/fim/tao-mau.mts                                   # → mau-fim.jsonl
 *   FIM_BAN=f4b504dc5 FIM_HAT=7 FIM_RA=mau-fim-2.jsonl npx tsx scripts/ai-eval/fim/tao-mau.mts   # bộ thứ hai
 *
 * Mỗi mẫu: chọn một tệp đã commit (ts/js/py/cs), cắt MỘT chỗ ở vùng giữa tệp (15–85 %):
 *   · `giua-dong` — con trỏ giữa dòng ở ranh giới từ; đáp án = phần còn lại của dòng TRỪ cụm ký tự đóng cuối dòng
 *                   (`);`, `]`, `}`… — thứ trình soạn thảo thường đã tự chèn) ⇒ hậu tố có thể bắt đầu bằng `);`;
 *   · `dong`      — con trỏ sau thụt lề; đáp án = cả dòng;
 *   · `khoi`      — con trỏ sau thụt lề; đáp án = 2–4 dòng liền (không dòng trống, không lùi thụt lề).
 * Tiền tố/hậu tố cắt bằng CHÍNH `catNguCanh` của extension (trần 2.000/800 ký tự) — đúng thứ máy chủ sẽ nhận.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as ghostTextMod from "../../../vscode-extension/src/loi/ghostText";
// vscode-extension/ là gói CJS (không "type": "module") ⇒ tsx đưa export vào `default` khi nhập từ ESM.
const { catNguCanh } = ((ghostTextMod as { default?: typeof ghostTextMod }).default ?? ghostTextMod) as typeof ghostTextMod;
import type { MauFim } from "./chamFim";

const GOC = join(import.meta.dirname, "..", "..", "..");
// FIM_HAT/FIM_RA: bộ mẫu ĐỘC LẬP thứ hai (hạt khác) để đo độ nhiễu của bảng so model — `mau-fim-2.jsonl`.
const RA = join(import.meta.dirname, process.env.FIM_RA ?? "mau-fim.jsonl");

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ngauNhien = mulberry32(Number(process.env.FIM_HAT ?? 20261017));
function tron<T>(ds: T[]): T[] {
  const a = [...ds];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(ngauNhien() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ⚠ Đọc từ một COMMIT CỐ ĐỊNH, không từ đĩa: worktree có agent khác đang sửa tệp song song ⇒ đọc đĩa làm bộ mẫu
// trôi theo giờ chạy (đo 2026-10-17: `lenhGach.ts` đổi giữa hai lần chạy ⇒ ca "mã thật" của thước đỏ).
const BAN = execFileSync("git", ["rev-parse", process.env.FIM_BAN ?? "HEAD"], { cwd: GOC, encoding: "utf8" }).trim();
const docBan = (p: string) =>
  execFileSync("git", ["show", `${BAN}:${p}`], { cwd: GOC, encoding: "utf8", maxBuffer: 64 << 20 });
const tatCa = execFileSync("git", ["ls-tree", "-r", "--name-only", BAN], { cwd: GOC, encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\n")
  .filter((p) => p && !/node_modules|\/dist\/|\/obj\/|\/bin\/|\.min\.|\.d\.ts$|\.test\.|\.spec\.|migrations\/|fixtures?\//.test(p));

const NHOM: Array<{ ngonNgu: MauFim["ngonNgu"]; loc: (p: string) => boolean; soMau: number }> = [
  { ngonNgu: "ts", loc: (p) => /^(server|shared|vscode-extension\/src|client\/src)\/.*\.tsx?$/.test(p), soMau: 26 },
  { ngonNgu: "js", loc: (p) => /\.(mjs|cjs|js)$/.test(p) && /^(scripts|tools|examples|vscode-extension)\//.test(p), soMau: 14 },
  { ngonNgu: "py", loc: (p) => p.endsWith(".py"), soMau: 12 },
  { ngonNgu: "cs", loc: (p) => p.endsWith(".cs"), soMau: 12 },
];
const KIEU: MauFim["kieu"][] = ["giua-dong", "dong", "khoi"];

function laChuThich(t: string): boolean {
  return /^(\/\/|\/\*|\*|#|"""|'''|<!--)/.test(t);
}
function dongHopLe(dong: string): boolean {
  const t = dong.trim();
  return t.length >= 10 && t.length <= 160 && !laChuThich(t) && /[A-Za-z0-9]/.test(t) && !/^[{}()[\];,]+$/.test(t);
}
const thutLe = (d: string) => d.length - d.trimStart().length;

/** Trả [offset con trỏ, offset hết đáp án] hoặc null nếu dòng/khối không hợp kiểu. */
function chonCat(dong: string[], i: number, kieu: MauFim["kieu"], offsetDong: number[]): [number, number] | null {
  const d = dong[i];
  if (!dongHopLe(d)) return null;
  const tl = thutLe(d);
  if (kieu === "dong") return [offsetDong[i] + tl, offsetDong[i] + d.length];
  if (kieu === "khoi") {
    const n = 2 + Math.floor(ngauNhien() * 3);
    if (i + n >= dong.length) return null;
    for (let k = 1; k < n; k++) {
      const x = dong[i + k];
      if (x.trim().length < 3 || thutLe(x) < tl || laChuThich(x.trim())) return null;
    }
    const cuoi = i + n - 1;
    return [offsetDong[i] + tl, offsetDong[cuoi] + dong[cuoi].length];
  }
  // giua-dong
  const noi = d.trimEnd();
  const mDong = /[)\]};"'`,]+$/.exec(noi);
  const hetDapAn = mDong ? noi.length - mDong[0].length : noi.length;
  const ung: number[] = [];
  for (let c = tl + 3; c < hetDapAn - 3; c++) {
    if (/[ (.,=:[]/.test(d[c - 1]) && d[c] !== " ") ung.push(c);
  }
  const vung = ung.filter((c) => c >= tl + 0.3 * (noi.length - tl) && c <= tl + 0.7 * (noi.length - tl));
  const tu = vung.length ? vung : ung;
  if (!tu.length) return null;
  const c = tu[Math.floor(ngauNhien() * tu.length)];
  return [offsetDong[i] + c, offsetDong[i] + hetDapAn];
}

const mau: MauFim[] = [];
for (const nhom of NHOM) {
  const tep = tron(tatCa.filter(nhom.loc).sort());
  let k = 0;
  for (const p of tep) {
    if (mau.filter((m) => m.ngonNgu === nhom.ngonNgu).length >= nhom.soMau) break;
    let vb: string;
    try {
      vb = docBan(p).replace(/\r\n/g, "\n");
      if (vb.length > 200_000) continue;
    } catch {
      continue;
    }
    const dong = vb.split("\n");
    if (dong.length < 40) continue;
    const offsetDong: number[] = [];
    let o = 0;
    for (const d of dong) {
      offsetDong.push(o);
      o += d.length + 1;
    }
    const kieu = KIEU[k % KIEU.length];
    const ungVien = tron(
      Array.from({ length: dong.length }, (_, i) => i).filter((i) => i >= dong.length * 0.15 && i <= dong.length * 0.85),
    );
    for (const i of ungVien.slice(0, 40)) {
      const cat = chonCat(dong, i, kieu, offsetDong);
      if (!cat) continue;
      const [p0, p1] = cat;
      const dapAn = vb.slice(p0, p1);
      if (dapAn.trim().length < 3) continue;
      mau.push({
        id: `${nhom.ngonNgu}-${String(mau.length + 1).padStart(3, "0")}`,
        tep: p,
        ban: BAN,
        ngonNgu: nhom.ngonNgu,
        kieu,
        tienTo: catNguCanh(vb, p0).tienTo,
        hauTo: catNguCanh(vb, p1).hauTo,
        dapAn,
      });
      k++;
      break;
    }
  }
}
writeFileSync(RA, mau.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
const dem = (f: (m: MauFim) => string) => mau.reduce<Record<string, number>>((a, m) => ((a[f(m)] = (a[f(m)] ?? 0) + 1), a), {});
console.log(`đã ghi ${mau.length} mẫu → ${RA}`);
console.log("theo ngôn ngữ:", dem((m) => m.ngonNgu), "theo kiểu:", dem((m) => m.kieu));

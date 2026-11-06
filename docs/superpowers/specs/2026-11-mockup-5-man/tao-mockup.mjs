// Sinh man-1-home.html, man-4-canh-bao.html, man-5-tai-san.html (+ mockup.html mục lục, khoa-i18n.md). Chạy: node tao-mockup.mjs
import { writeFileSync, existsSync } from "node:fs";
import { KHOA } from "./nguon/chung.mjs";
const dir = new URL("./", import.meta.url);
const W = (n, s) => writeFileSync(new URL(n, dir), s);
const tryImport = async (f, fn) => (existsSync(new URL("./nguon/" + f, import.meta.url)) ? (await import("./nguon/" + f))[fn]() : null);
const m1 = await tryImport("man1.mjs", "man1"); if (m1) W("man-1-home.html", m1);
const m4 = await tryImport("man4.mjs", "man4"); if (m4) W("man-4-canh-bao.html", m4);
const m5 = await tryImport("man5.mjs", "man5"); if (m5) W("man-5-tai-san.html", m5);
const rows = [...KHOA].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `| \`${k}\` | ${v} |`);
W("khoa-i18n.md", `# Khoá i18n dự kiến (vi là nguồn)\n\nSinh tự động từ các thuộc tính \`data-i18n\` trong mockup; namespace theo vùng (\`chung\`, \`giamSat\`, \`duLieuChu\`, \`home\`…) theo 01-QUY-UOC §1. Chuỗi dữ liệu mẫu (tên máy, số liệu) KHÔNG phải khoá.\n\n| Khoá | vi |\n|---|---|\n${rows.join("\n")}\n\n**${KHOA.size} khoá.**\n`);
console.log("OK", { m1: !!m1, m4: !!m4, m5: !!m5, khoa: KHOA.size });

// ĐỢT 51 — tóm tắt KẾT CỤC GỐC F1: p50/p90/max `msToiMan` + số đột biến > 2 500 ms.
import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync } from "node:fs";
const OUT = process.env.QA_OUT ?? ".qa-dot51";
const gom = (thuMuc, mau) => {
  const so = [];
  for (const d of readdirSync(thuMuc).filter((x) => mau.test(x)).sort()) {
    const p = `${thuMuc}/${d}/f1-chan-1600x900.json`;
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, "utf8"));
    // f1-sau-5 cua Dot 50 dut giua chung (2/4 man, khong co `tomTat`) — lay tu `man`.
    const nguon = j.tomTat ?? j.man ?? {};
    for (const [duong, v] of Object.entries(nguon)) {
      if (v && typeof v.msToiMan === "number") so.push({ lo: d, duong, ms: v.msToiMan, dat: v.dat });
    }
  }
  return so;
};
const th = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: q(0.5), p90: q(0.9), max: s.at(-1), min: s[0] }; };
const bang = (ten, so) => {
  const ms = so.map((x) => x.ms);
  const dot = so.filter((x) => x.ms > 2500);
  return { dieuKien: ten, ...th(ms), dotBien: `${dot.length}/${so.length}`,
    chiTietDotBien: dot.map((x) => `${x.duong}:${x.ms}`), soDAT: so.filter((x) => x.dat).length };
};
const kq = { khi: new Date().toISOString(), nguong: 2500, dong: [] };
kq.dong.push(bang("Đợt 50 TRƯỚC (4215c526)", gom(".qa-dot50", /^f1-truoc-\d+$/)));
kq.dong.push(bang("Đợt 50 SAU A+B+C", gom(".qa-dot50", /^f1-sau-\d+$/)));
kq.dong.push(bang("Đợt 50 SAU A+B+C+E (nền)", gom(".qa-dot50", /^f1-sauE-[1-7]$/)));
kq.dong.push(bang("Đợt 50 SAU A+B+C+E (11 lượt)", gom(".qa-dot50", /^f1-sauE-\d+$/)));
kq.dong.push(bang("Đợt 51 CÓ INDEX", gom(".qa-dot51", /^f1-51-\d+$/)));
kq.dong.push(bang("Đợt 51 ABLATION (gỡ index)", gom(".qa-dot51", /^f1-ab-\d+$/)));
kq.dong.push(bang("Đợt 51 CÓ INDEX (14 lượt)", [...gom(".qa-dot51", /^f1-51-\d+$/), ...gom(".qa-dot51", /^f1-xn-\d+$/)]));
kq.dong.push(bang("Đợt 51 GỠ INDEX (14 lượt)", [...gom(".qa-dot51", /^f1-ab-\d+$/), ...gom(".qa-dot51", /^f1-xa-\d+$/)]));
kq.dong.push(bang("★ Đợt 52 QA lần 8 (7 lượt)", gom(".qa-dot52", /^f1-52-\d+$/)));
const p = `${OUT}/F1-tomtat.json`;
writeFileSync(p + ".tmp", JSON.stringify(kq, null, 1)); renameSync(p + ".tmp", p);
console.log("DIEU KIEN".padEnd(30), "n".padStart(4), "p50".padStart(7), "p90".padStart(7), "max".padStart(7), "  DOT BIEN >2500ms");
for (const d of kq.dong) console.log(d.dieuKien.padEnd(30), String(d.n).padStart(4), String(d.p50).padStart(7), String(d.p90).padStart(7), String(d.max).padStart(7), " ", d.dotBien, d.chiTietDotBien.join(" · "));

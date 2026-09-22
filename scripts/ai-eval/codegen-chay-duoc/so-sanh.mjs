/**
 * ★★★ BẢNG SO SÁNH MODEL — gom nhiều lượt của nhiều model về MỘT bảng, trên CÙNG bộ bài.
 *
 * ⚠⚠ VÌ SAO PHẢI GOM Ở MỘT CHỖ thay vì đọc từng báo cáo: trong đợt audit này tôi đã một lần
 * kết luận *"Coder nhanh hơn 40%"* từ hai lượt chạy trên HAI bản `llama-server` khác nhau (một
 * bản cũ 3 ngày). Số đúng, kết luận sai, vì hai lượt không so sánh được với nhau. Bảng này ép
 * mọi cột phải đến từ **cùng một tệp bài** và in kèm **số lượt** để một model đo 1 lượt không
 * bao giờ bị đọc ngang hàng với model đo 3 lượt.
 *
 * Dùng: node so-sanh.mjs <tiền-tố-nhãn>...    (vd: M-coder12 M-q36 M-q38 M-devstral12)
 */
import fs from "node:fs";
import path from "node:path";

const BENCH = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const RP = `${BENCH}/reports`;
const tienTo = process.argv.slice(2);
if (!tienTo.length) {
  console.error("Dùng: node so-sanh.mjs <tiền-tố-nhãn>...");
  process.exit(1);
}

const NGON_NGU = ["ts", "py", "cs", "cpp"];

function gom(tt) {
  /**
   * ⚠ KHỚP `<nhãn><số lượt>.json`, KHÔNG khớp tiền tố lỏng. Bản đầu dùng `startsWith(tt)` và
   * `M-q36moe-` nuốt luôn `M-q36moe-nt-*.json` ⇒ hàng "nghĩ BẬT" của MoE gom cả 36 bài nghĩ TẮT
   * vào — hai trục bị trộn thành một con số vô nghĩa, và bảng vẫn in ra đẹp đẽ. Một bộ chọn lỏng
   * là một phát hiện giả đang chờ được in.
   */
  // Nhãn chỉ gồm chữ/số/`-`/`_` ⇒ so chuỗi thẳng, KHÔNG dựng regex từ nhãn (một lần thoát ký tự
  // sai là một bộ chọn hỏng trong im lặng — vừa đo được ngay ở bản đầu của dòng này).
  const tep = fs.readdirSync(RP).filter((f) => f.startsWith(tt) && /^\d+\.json$/.test(f.slice(tt.length)));
  const luot = [];
  for (const f of tep) {
    try { luot.push(JSON.parse(fs.readFileSync(`${RP}/${f}`, "utf8"))); } catch { /* bỏ tệp hỏng */ }
  }
  if (!luot.length) return null;
  const phang = luot.flat();
  const dat = phang.filter((r) => r.chayDat).length;
  const tok = phang.reduce((s, r) => s + (r.genTok ?? 0), 0);
  const ms = phang.reduce((s, r) => s + (r.totalMs ?? 0), 0);
  const theoNgonNgu = {};
  for (const l of NGON_NGU) {
    const g = phang.filter((r) => r.lang === l);
    theoNgonNgu[l] = g.length ? `${g.filter((r) => r.chayDat).length}/${g.length}` : "—";
  }
  const theoBai = {};
  for (const r of phang) theoBai[r.id] = (theoBai[r.id] ?? 0) + (r.chayDat ? 1 : 0);
  return {
    nhan: tt, soLuot: luot.length, soBai: phang.length, dat,
    pc: Math.round((dat / phang.length) * 100),
    tokTb: Math.round(tok / phang.length), msTb: Math.round(ms / phang.length),
    theoNgonNgu, theoBai,
  };
}

const hang = tienTo.map(gom).filter(Boolean);
if (!hang.length) { console.error("Không tìm thấy báo cáo nào."); process.exit(1); }

const o = (s, n) => String(s).padEnd(n);
const p = (s, n) => String(s).padStart(n);

console.log("\n══════ SO SÁNH MODEL — cùng bộ bài KHÓ, trục thuần ══════");
console.log(o("model", 18), p("chạy được", 12), p("tok/bài", 9), p("ms/bài", 9), p("lượt", 6),
  "  " + NGON_NGU.map((l) => o(l, 7)).join(""));
console.log("─".repeat(100));
for (const h of hang) {
  console.log(
    o(h.nhan, 18), p(`${h.dat}/${h.soBai} = ${h.pc}%`, 12), p(h.tokTb, 9), p(h.msTb, 9), p(h.soLuot, 6),
    "  " + NGON_NGU.map((l) => o(h.theoNgonNgu[l], 7)).join(""),
  );
}

// ── Bài nào KHÔNG model nào giải được: đó là ranh giới thật của cả lớp model này ──────────────
const moiBai = [...new Set(hang.flatMap((h) => Object.keys(h.theoBai)))].sort();
const khongAiGiai = moiBai.filter((b) => hang.every((h) => (h.theoBai[b] ?? 0) === 0));
const aiCungGiai = moiBai.filter((b) => hang.every((h) => (h.theoBai[b] ?? 0) > 0));
console.log("\n★ KHÔNG model nào giải được:", khongAiGiai.length ? khongAiGiai.join(" ") : "(không có)");
console.log("★ Model nào cũng giải được :", aiCungGiai.length ? aiCungGiai.join(" ") : "(không có)");
console.log("\n★ Theo bài (số lượt đạt / số lượt chạy):");
console.log(o("bài", 10) + hang.map((h) => o(h.nhan.slice(0, 13), 15)).join(""));
for (const b of moiBai) {
  console.log(o(b, 10) + hang.map((h) => o(`${h.theoBai[b] ?? 0}/${h.soLuot}`, 15)).join(""));
}

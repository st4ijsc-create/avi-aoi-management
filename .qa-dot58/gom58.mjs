// ĐỢT 58 — gom kết quả do58 thành bảng M10–M13. node .qa-dot58/gom58.mjs <tag...>
import { readFileSync, existsSync } from "node:fs";
const tags = process.argv.slice(2);
const LANGS = ["vi", "en"];
const doc = (tag, lang) => { const f = `.qa-dot58/do-${tag}-${lang}/tong.json`; return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
for (const tag of tags) {
  console.log(`\n════════════════════ BẢN DỰNG: ${tag} ════════════════════`);
  /* ── M10 ─────────────────────────────────────────────── */
  console.log("── M10 tay nắm ‹/› đè nội dung (px² giao) ──");
  let tongM10 = 0, tongM10Trang = 0, tongNhanChe = 0, caM10 = 0;
  for (const lang of LANGS) { const t = doc(tag, lang); if (!t) continue;
    for (const vp of Object.keys(t)) for (const man of Object.keys(t[vp])) {
      const k = t[vp][man]; if (!k.nut) continue;
      for (const tid of Object.keys(k.nut)) { const n = k.nut[tid]; if (!n) continue;
        caM10++; tongM10 += n.giaoNoiDungTrongPanel; tongM10Trang += n.giaoNoiDungToanTrang;
        if (n.giaoNoiDungTrongPanel > 0 || n.giaoNoiDungToanTrang > 0)
          console.log(`   ${lang} ${vp} ${man} ${tid}: panel ${n.soDeTrongPanel} phần tử/${n.giaoNoiDungTrongPanel}px² · toàn trang ${n.soDeToanTrang}/${n.giaoNoiDungToanTrang}px² | ${n.deToanTrang.slice(0, 4).map((d) => `${d.chu}:${d.giao}`).join(", ")}`);
      }
      tongNhanChe += (k.nhanBiNutChe || []).length;
      if ((k.nhanBiNutChe || []).length) console.log(`   ${lang} ${vp} ${man}: NHÃN BỊ NÚT CHE ${k.nhanBiNutChe.map((c) => `${c.nhan}(${c.giao}px²)`).join(", ")}`);
      if (n_tamSai(k)) console.log(`   ${lang} ${vp} ${man}: TÂM NÚT KHÔNG TRÚNG NÚT ${JSON.stringify(Object.entries(k.nut).filter(([, v]) => v && !v.tamTrungNut).map(([a, v]) => [a, v.tamTren]))}`);
    }
  }
  console.log(`   ⇒ TỔNG ${caM10} ca nút: giao nội dung trong panel ${tongM10} px² · toàn trang ${tongM10Trang} px² · nhãn bị nút che ${tongNhanChe}`);
  /* ── M11 ─────────────────────────────────────────────── */
  console.log("── M11 tương phản chữ ≤12 px ──");
  let sChuoi = 0, sDo = 0, sThan = 0, sNgat = 0, sKhongDo = 0, minTiSo = 99;
  const lyDoKhongDo = {}; const duoiThanDS = []; const duoiNgatDS = []; const cheDS = [];
  for (const lang of LANGS) { const t = doc(tag, lang); if (!t) continue;
    for (const vp of Object.keys(t)) for (const man of Object.keys(t[vp])) {
      const m = t[vp][man].m11; if (!m) continue;
      sChuoi += m.soChuNho;
      for (const d of m.ds) {
        const kho = !d.doDuoc;
        const bịChe = d.phanChe >= 0.9;
        const khuat = d.phanThay <= 0.02;
        if (kho) { sKhongDo++; const k = khuat ? "cuộn-ra-ngoài-ô (không hiện)" : bịChe ? `bị lớp phủ che kín: ${d.cheBoi}` : (d.pixel.lyDo ?? "khác"); lyDoKhongDo[k] = (lyDoKhongDo[k] ?? 0) + 1; continue; }
        sDo++;
        if (d.tiSoThan < minTiSo) minTiSo = d.tiSoThan;
        if (d.tiSoThan < d.nguong) { sThan++; duoiThanDS.push({ lang, vp, man, tid: d.tid, duong: d.duong, chu: d.chu, px: d.px, nguong: d.nguong, P: d.pixel.tiSoP, C: d.tiSoC, che: d.phanChe, thay: d.phanThay }); }
        if (d.tiSoNgat < d.nguong) { sNgat++; duoiNgatDS.push({ lang, vp, man, tid: d.tid, duong: d.duong, chu: d.chu, px: d.px, nguong: d.nguong, P: d.pixel.tiSoP, Pfull: d.pixelFull.tiSoP, C: d.tiSoC, che: d.phanChe, cheBoi: d.cheBoi, thay: d.phanThay }); }
        if (d.phanChe >= 0.5 && d.phanChe < 0.9) cheDS.push({ lang, vp, man, chu: d.chu, cheBoi: d.cheBoi, che: d.phanChe });
      }
    }
  }
  console.log(`   chuỗi ≤12px: ${sChuoi} · đo được ${sDo} · KHÔNG đo được ${sKhongDo}`);
  for (const k of Object.keys(lyDoKhongDo)) console.log(`      · ${k}: ${lyDoKhongDo[k]}`);
  console.log(`   DƯỚI NGƯỠNG (rộng lượng = max(pixel, màu)) : ${sThan}`);
  console.log(`   DƯỚI NGƯỠNG (ngặt = min hai mô hình)        : ${sNgat}`);
  console.log(`   tỉ số nhỏ nhất (rộng lượng): ${minTiSo === 99 ? "—" : minTiSo}`);
  for (const d of duoiThanDS.slice(0, 25)) console.log(`      ✗THAN ${d.lang} ${d.vp} ${d.man} "${d.chu}" ${d.px}px ngưỡng ${d.nguong} P=${d.P} C=${d.C} (${d.duong})`);
  const nhomNgat = {};
  for (const d of duoiNgatDS) { const k = `${d.man}|${d.chu}|${d.px}`; (nhomNgat[k] ??= []).push(d); }
  for (const k of Object.keys(nhomNgat).slice(0, 30)) { const d = nhomNgat[k][0]; console.log(`      ~NGẶT ×${nhomNgat[k].length} ${d.man} "${d.chu}" ${d.px}px ngưỡng ${d.nguong} P=${d.P} Pfull=${d.Pfull} C=${d.C} che=${d.che}${d.cheBoi ? `(${d.cheBoi})` : ""} thấy=${d.thay} (${d.duong})`); }
  if (cheDS.length) console.log(`   ⚠ bị che một phần (0,5–0,9): ${cheDS.length} — ví dụ ${cheDS.slice(0, 3).map((c) => `${c.chu}←${c.cheBoi}`).join(", ")}`);
  /* ── M12 ─────────────────────────────────────────────── */
  console.log("── M12 lặp mã máy trên màn Máy ──");
  for (const lang of LANGS) { const t = doc(tag, lang); if (!t) continue;
    for (const vp of Object.keys(t)) for (const man of ["may", "may18", "twin", "line"]) {
      const k = t[vp][man]; if (!k || !k.m12) continue;
      const m = k.m12;
      const trongCockpit = m.lap.filter((l) => /cockpit|MachineWorkspace/i.test(l.duong ?? "")).length;
      console.log(`   ${lang} ${vp} ${man}: "${m.khoa}" tổng ${m.soLap} · trong khối cảnh ${m.lapTrongKhoiCanh} · viên=${m.vien ? m.vien.tid : "—"}${m.vien ? ` @(${m.vien.rect.x},${m.vien.rect.y}) trongKhốiCảnh=${m.vienTrongKhoiCanh}` : ""}`);
      if (man === "may" || man === "may18") for (const l of m.lap) console.log(`        · "${l.chu}" @(${l.rect.x},${l.rect.y}) ${l.duong || "(không testid)"}`);
    }
  }
  /* ── M13 ─────────────────────────────────────────────── */
  console.log("── M13 tồn đọng + đánh đổi danh sách máy ──");
  for (const lang of LANGS) { const t = doc(tag, lang); if (!t) continue;
    for (const vp of Object.keys(t)) { const k = t[vp].twin; if (!k) continue;
      const td = k.tonDong;
      console.log(`   ${lang} ${vp}: tồn đọng ${td ? `${td.hangDu} hàng ĐỦ / ${td.hangNua} ≥½ / tổng ${td.tongHang} (theo phần ${td.tongTheoPhan}) · ô cuộn h=${td.oCuonRect.h} scroll=${td.scrollH}` : "—"} · danh-sach-may h=${k.danhSach ? k.danhSach.rect.h : "—"} hàng đủ ${k.danhSach ? k.danhSach.hangDu : "—"}/${k.danhSach ? k.danhSach.tongHang : "—"} · panel-trái đáy ${k.panelTrai ? k.panelTrai.day : "—"} · doc ${k.tran.docH}/${k.tran.innerH} tràn ngang=${k.tran.bodyOverflowX}`);
    }
  }
}
function n_tamSai(k) { return Object.values(k.nut ?? {}).some((v) => v && !v.tamTrungNut); }

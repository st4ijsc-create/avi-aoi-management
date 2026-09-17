/**
 * p50-sim.mjs — PH-50 BƯỚC 1 + BƯỚC 2: MÔ PHỎNG NGOÀI TRANG, TRƯỚC KHI SỬA MÃ.
 *
 *   node .qa-tapdoan/p50-sim.mjs
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THIẾT BỊ ĐO PHẢI TỰ CHỨNG MINH TRƯỚC (chống tự thoả, luật 3 của chủ đợt)
 * ════════════════════════════════════════════════════════════════════════════
 * Mô hình dưới đây chép ĐÚNG phép tính của `saBanTapDoan` + `viewBox` của
 * `CanhVanHanh2D`. Trước khi dùng nó để phán bất cứ điều gì, nó phải TÁI HIỆN
 * được các con số ĐÃ ĐO SỐNG ở `n1-v2.json` cho cả 5 vai có cụm:
 *   · `viewBox` (4 số)  · bề rộng biểu tượng 2D (px)
 * Sai một số ⇒ THOÁT, không in kết luận nào. Một bộ mô phỏng không tái hiện
 * được cái đã đo thì mọi con số nó sinh ra là lời khai chưa kiểm.
 *
 * Nguồn kích thước toà nhà: CSDL (`p50-db.mjs` đã in), ghim vào đây để chạy
 * không cần CSDL — nhưng `p50-db.mjs` là nguồn, và nó có thật.
 */
import fs from "node:fs";

/* ── Hằng CHÉP TỪ mã sản phẩm (canhTapDoan.ts) ───────────────────────────── */
const BIEU_TUONG_TOI_THIEU_MM = 20_000;
const KHE_TRONG_CUM_TI_LE = 0.2;
const KHE_TRONG_CUM_TOI_THIEU_MM = 10_000;
const KHE_GIUA_CUM_TI_LE = 0.6;
const KHE_GIUA_CUM_TOI_THIEU_LAN = 3;
/** `CanhVanHanh2D`: lề viewBox = max(rộng, sâu) / 30 (suy từ 5/5 viewBox đã đo). */
const LE_VIEWBOX_CHIA = 30;
const SVG = { w: 968, h: 489 }; // @1280×720 khung MẶC ĐỊNH, không thu panel (n1-v2.json)

/* ── Dữ liệu THẬT (CSDL, 2026-09-17) ─────────────────────────────────────── */
const TOA = [
  { id: 24, ma: "TN-SEED-1", factoryId: 1, rongMm: 38_400, sauMm: 29_600, caoMm: 8_000 },
  { id: 90, ma: "FUYU-F-TN1", factoryId: 47, rongMm: 3_000_000, sauMm: 2_000_000, caoMm: 25_000 },
  ...[91, 92, 93, 94].map((id) => ({ id, ma: `QATD-A-T${id - 90}`, factoryId: 48, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 })),
  ...[95, 96, 97, 98].map((id) => ({ id, ma: `QATD-B-T${id - 94}`, factoryId: 49, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 })),
  ...[99, 100, 101, 102].map((id) => ({ id, ma: `QATD-C-T${id - 98}`, factoryId: 50, rongMm: 110_000, sauMm: 80_000, caoMm: 42_000 })),
];
/** Phạm vi ĐÃ ĐO SỐNG (`n1-v2.json → ba2D.toaTheoFactory`), không suy từ quyền. */
const PHAM_VI = {
  qatd_giamdoc: [48, 49, 50],
  qatd_quanly: [48],
  qatd_kythuat: [48, 49],
  qatd_congnhan: [50],
  qatd_admin: [1, 47, 48, 49, 50],
};

/* ── Mô hình bố cục — CHÉP phép tính của `saBanTapDoan` ──────────────────── */
const kepDuong = (n, san) => (Number.isFinite(n) && n > san ? n : san);

/**
 * @param ds     toà nhà trong phạm vi
 * @param coCua  hàm cho ra cỡ biểu tượng (mm) — ĐÂY là chỗ mọi chính sách khác nhau
 */
function boCuc(ds, coCua) {
  const nhom = new Map();
  for (const b of ds) nhom.set(b.factoryId, [...(nhom.get(b.factoryId) ?? []), b]);
  const maNhaMay = [...nhom.keys()].sort((a, b) => a - b);

  const co = new Map(ds.map((b) => [b.id, coCua(b, ds)]));
  const oRong = Math.max(...ds.map((b) => co.get(b.id).rongMm));
  const oSau = Math.max(...ds.map((b) => co.get(b.id).sauMm));
  const kheToa = Math.max(KHE_TRONG_CUM_TI_LE * Math.max(oRong, oSau), KHE_TRONG_CUM_TOI_THIEU_MM);

  const toaNhieuNhat = Math.max(...maNhaMay.map((m) => nhom.get(m).length));
  const cot = Math.max(1, Math.ceil(Math.sqrt(toaNhieuNhat)));
  const hang = Math.max(1, Math.ceil(toaNhieuNhat / cot));
  const cumRong = cot * oRong + (cot - 1) * kheToa;
  const cumSau = hang * oSau + (hang - 1) * kheToa;

  const kheCum = Math.max(KHE_GIUA_CUM_TI_LE * Math.max(cumRong, cumSau), KHE_GIUA_CUM_TOI_THIEU_LAN * kheToa);
  const cotCum = Math.max(1, Math.ceil(Math.sqrt(maNhaMay.length)));
  const hangCum = Math.max(1, Math.ceil(maNhaMay.length / cotCum));
  const vien = kheToa;

  const bieuTuong = [];
  maNhaMay.forEach((maNM, iCum) => {
    const cua = [...nhom.get(maNM)].sort((a, b) => a.id - b.id);
    const cumX = vien + (iCum % cotCum) * (cumRong + kheCum);
    const cumY = vien + Math.floor(iCum / cotCum) * (cumSau + kheCum);
    cua.forEach((b, iToa) => {
      const c = co.get(b.id);
      const oX = cumX + (iToa % cot) * (oRong + kheToa);
      const oY = cumY + Math.floor(iToa / cot) * (oSau + kheToa);
      bieuTuong.push({
        toaNhaId: b.id, factoryId: b.factoryId, chiSoCum: iCum,
        xMm: oX + (oRong - c.rongMm) / 2, yMm: oY + (oSau - c.sauMm) / 2,
        rongMm: c.rongMm, sauMm: c.sauMm,
      });
    });
  });

  const rongMm = cotCum * cumRong + (cotCum - 1) * kheCum + 2 * vien;
  const sauMm = hangCum * cumSau + (hangCum - 1) * kheCum + 2 * vien;
  const le = Math.max(rongMm, sauMm) / LE_VIEWBOX_CHIA;
  const vb = { x: -le / 1000, y: -le / 1000, w: (rongMm + 2 * le) / 1000, h: (sauMm + 2 * le) / 1000 };
  const tiLe = Math.min(SVG.w / vb.w, SVG.h / vb.h); // px trên mét
  return {
    bieuTuong, rongMm, sauMm, vb, tiLe,
    rongPx: bieuTuong.map((v) => Math.round((v.rongMm / 1000) * tiLe * 10) / 10),
  };
}

/* ── Chính sách cỡ (khai TRƯỚC khi đo) ───────────────────────────────────── */
const trungVi = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const phanVi = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

/** HÔM NAY: ô = cạnh LỚN NHẤT toàn tập, biểu tượng giữ cỡ thật. */
const CS_HOM_NAY = (b) => ({
  rongMm: kepDuong(b.rongMm, BIEU_TUONG_TOI_THIEU_MM),
  sauMm: kepDuong(b.sauMm, BIEU_TUONG_TOI_THIEU_MM),
});

/** (a) ĐỒNG CỠ theo TRUNG VỊ — mọi biểu tượng nhận trung vị của chính tập đang xem. */
const CS_DONG_CO = (b, ds) => ({
  rongMm: kepDuong(trungVi(ds.map((x) => x.rongMm)), BIEU_TUONG_TOI_THIEU_MM),
  sauMm: kepDuong(trungVi(ds.map((x) => x.sauMm)), BIEU_TUONG_TOI_THIEU_MM),
});

/** (b) THỐNG KÊ BỀN: gốc = trung vị, kẹp tỉ số lớn/nhỏ về trần R (hình học, √R hai phía). */
const CS_BEN = (R) => (b, ds) => {
  const f = (v, goc) => {
    const lo = goc / Math.sqrt(R);
    const hi = goc * Math.sqrt(R);
    return kepDuong(Math.min(hi, Math.max(lo, v)), BIEU_TUONG_TOI_THIEU_MM);
  };
  return {
    rongMm: f(b.rongMm, trungVi(ds.map((x) => x.rongMm))),
    sauMm: f(b.sauMm, trungVi(ds.map((x) => x.sauMm))),
  };
};

/** (b') THỐNG KÊ BỀN gốc PHÂN VỊ 75. */
const CS_BEN_P75 = (R) => (b, ds) => {
  const f = (v, goc) => kepDuong(Math.min(goc * Math.sqrt(R), Math.max(goc / Math.sqrt(R), v)), BIEU_TUONG_TOI_THIEU_MM);
  return { rongMm: f(b.rongMm, phanVi(ds.map((x) => x.rongMm), 0.75)), sauMm: f(b.sauMm, phanVi(ds.map((x) => x.sauMm), 0.75)) };
};

/** (c) CHUẨN HOÁ THEO TỪNG CỤM: mỗi nhà máy co theo cỡ LỚN NHẤT của chính nó. */
const CS_THEO_CUM = (b, ds) => {
  const cung = ds.filter((x) => x.factoryId === b.factoryId);
  const maxR = Math.max(...cung.map((x) => x.rongMm));
  const maxS = Math.max(...cung.map((x) => x.sauMm));
  // Co về một cỡ chuẩn chung cho MỌI cụm (nếu không, cụm to vẫn ép cụm nhỏ y như cũ).
  const CHUAN = 110_000;
  return {
    rongMm: kepDuong((b.rongMm / maxR) * CHUAN, BIEU_TUONG_TOI_THIEU_MM),
    sauMm: kepDuong((b.sauMm / maxS) * CHUAN * 0.7272, BIEU_TUONG_TOI_THIEU_MM),
  };
};

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① TỰ KIỂM THIẾT BỊ ĐO — tái hiện n1-v2.json                                */
/* ══════════════════════════════════════════════════════════════════════════ */
const N1 = JSON.parse(fs.readFileSync(".qa-tapdoan/n1-v2.json", "utf8"));
const gan = (a, b, eps) => Math.abs(a - b) <= eps;
let hong = 0;
console.log("═══ ① TỰ KIỂM: mô phỏng có tái hiện được 5 vai đã ĐO SỐNG không? ═══");
for (const vai of Object.keys(PHAM_VI)) {
  const ds = TOA.filter((t) => PHAM_VI[vai].includes(t.factoryId));
  const r = boCuc(ds, CS_HOM_NAY);
  const song = N1.vai[vai].ba2D;
  const vbSong = String(song.viewBox).split(/\s+/).map(Number);
  const okVb = gan(r.vb.x, vbSong[0], 0.02) && gan(r.vb.y, vbSong[1], 0.02) && gan(r.vb.w, vbSong[2], 0.02) && gan(r.vb.h, vbSong[3], 0.02);
  const mpSort = [...r.rongPx].sort((a, b) => a - b);
  const songSort = [...song.rongToa2D].sort((a, b) => a - b);
  const okPx = mpSort.length === songSort.length && mpSort.every((v, i) => gan(v, songSort[i], 0.15));
  if (!okVb || !okPx) hong += 1;
  console.log(
    `  ${okVb && okPx ? "✓" : "✗"} ${vai.padEnd(15)} viewBox mp=[${[r.vb.x, r.vb.y, r.vb.w, r.vb.h].map((v) => Math.round(v * 100) / 100).join(" ")}] sống=[${vbSong.map((v) => Math.round(v * 100) / 100).join(" ")}]` +
      `  px mp=[${mpSort.join(",")}] sống=[${songSort.join(",")}]`,
  );
}
if (hong > 0) {
  console.log(`\n⛔ THIẾT BỊ ĐO KHÔNG TÁI HIỆN ĐƯỢC ${hong} VAI — DỪNG, không in kết luận nào.`);
  process.exit(1);
}
console.log("  ⇒ 5/5 khớp. Mô phỏng dùng được.\n");

/* ── ĐỐI CHỨNG DƯƠNG: thiết bị đo phải biết KÊU ─────────────────────────── */
{
  const ds = TOA.filter((t) => PHAM_VI.qatd_giamdoc.includes(t.factoryId));
  const r = boCuc(ds, (b) => ({ rongMm: b.rongMm * 1.11, sauMm: b.sauMm }));
  const vbSong = String(N1.vai.qatd_giamdoc.ba2D.viewBox).split(/\s+/).map(Number);
  const keu = !gan(r.vb.w, vbSong[2], 0.02);
  console.log(`═══ ĐỐI CHỨNG DƯƠNG: bơm cỡ +11 % ⇒ thiết bị ${keu ? "KÊU ✓" : "IM ✗ (thước hỏng)"} (vb.w ${Math.round(r.vb.w * 100) / 100} ≠ ${vbSong[2]})\n`);
  if (!keu) process.exit(1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② BƯỚC 1 — PHÂN BỐ KÍCH THƯỚC THẬT THEO TỪNG VAI                          */
/* ══════════════════════════════════════════════════════════════════════════ */
console.log("═══ BƯỚC 1 ① — phân bố kích thước toà nhà THẬT mỗi vai nhìn thấy ═══");
const bang = [];
for (const vai of Object.keys(PHAM_VI)) {
  const ds = TOA.filter((t) => PHAM_VI[vai].includes(t.factoryId));
  const canh = ds.map((b) => Math.max(b.rongMm, b.sauMm)); // cạnh lớn của từng toà
  const rongs = ds.map((b) => b.rongMm);
  bang.push({
    vai,
    soCum: new Set(ds.map((b) => b.factoryId)).size,
    soToa: ds.length,
    "rộng nhỏ nhất (m)": Math.min(...rongs) / 1000,
    "rộng trung vị (m)": trungVi(rongs) / 1000,
    "rộng lớn nhất (m)": Math.max(...rongs) / 1000,
    "TỈ SỐ rộng lớn/nhỏ": Math.round((Math.max(...rongs) / Math.min(...rongs)) * 100) / 100,
    "TỈ SỐ cạnh-lớn lớn/nhỏ": Math.round((Math.max(...canh) / Math.min(...canh)) * 100) / 100,
  });
}
console.table(bang);
console.log("qatd_khonggan  : 0 nhà máy trong phạm vi ⇒ 0 toà ⇒ KHÔNG có sa bàn (n1-v2: soCum2D=0)");
console.log("qatd_khongquyen: 0 quyền ⇒ CHẶN-ĐÚNG, không vào được màn (n1-v2: soCum2D=0)\n");

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ BƯỚC 2 — SO CÁC CHÍNH SÁCH CỠ BẰNG SỐ                                   */
/* ══════════════════════════════════════════════════════════════════════════ */
const CHINH_SACH = [
  ["HÔM NAY (ô = max toàn tập)", CS_HOM_NAY],
  ["(a) ĐỒNG CỠ = trung vị", CS_DONG_CO],
  ["(b) bền, gốc trung vị, kẹp 3:1", CS_BEN(3)],
  ["(b) bền, gốc trung vị, kẹp 2:1", CS_BEN(2)],
  ["(b) bền, gốc trung vị, kẹp 1,5:1", CS_BEN(1.5)],
  ["(b') bền, gốc phân vị 75, kẹp 3:1", CS_BEN_P75(3)],
  ["(c) chuẩn hoá THEO TỪNG CỤM", CS_THEO_CUM],
];

console.log("═══ BƯỚC 2 — bề rộng biểu tượng NHỎ NHẤT (px, 2D @1280×720) theo chính sách ═══");
console.log("   (trần nghiệm thu = 24 px; 3D thường NHỎ HƠN 2D — hệ số đo được ở giamdoc là 56,5/89,9 = 0,63)\n");
const bang2 = [];
for (const [ten, cs] of CHINH_SACH) {
  const d = { "chính sách": ten };
  for (const vai of Object.keys(PHAM_VI)) {
    const ds = TOA.filter((t) => PHAM_VI[vai].includes(t.factoryId));
    const r = boCuc(ds, cs);
    const min = Math.min(...r.rongPx);
    const max = Math.max(...r.rongPx);
    d[vai.replace("qatd_", "")] = `${min}–${max}`;
  }
  const dsA = TOA.filter((t) => PHAM_VI.qatd_admin.includes(t.factoryId));
  const rA = boCuc(dsA, cs);
  d["admin 2D min"] = Math.min(...rA.rongPx);
  d["admin 3D dự phóng (×0,63)"] = Math.round(Math.min(...rA.rongPx) * 0.63 * 10) / 10;
  d["admin ĐẠT ≥24 cả 2 chế độ?"] = Math.min(...rA.rongPx) * 0.63 >= 24 ? "ĐẠT" : "KHÔNG";
  bang2.push(d);
}
console.table(bang2);

/* ── Bất biến KHÔNG HỒI QUY: 4 vai QATD phải GIỐNG HỆT hôm nay ──────────── */
console.log("\n═══ BẤT BIẾN KHÔNG HỒI QUY — 4 vai QATD có đổi một số nào không? ═══");
const bang3 = [];
for (const [ten, cs] of CHINH_SACH) {
  const d = { "chính sách": ten };
  for (const vai of ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan"]) {
    const ds = TOA.filter((t) => PHAM_VI[vai].includes(t.factoryId));
    const cu = boCuc(ds, CS_HOM_NAY);
    const moi = boCuc(ds, cs);
    const giong =
      JSON.stringify([cu.vb, cu.rongPx, cu.bieuTuong]) === JSON.stringify([moi.vb, moi.rongPx, moi.bieuTuong]);
    d[vai.replace("qatd_", "")] = giong ? "GIỐNG HỆT" : "ĐỔI";
  }
  bang3.push(d);
}
console.table(bang3);

/* ── Trần tiêu chí: có bất khả không? ───────────────────────────────────── */
console.log("\n═══ TIÊU CHÍ ≥24 px CHO ADMIN CÓ BẤT KHẢ KHÔNG? — phép chia ═══");
{
  const ds = TOA.filter((t) => PHAM_VI.qatd_admin.includes(t.factoryId));
  for (const R of [1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 10]) {
    const cs = R === 1 ? CS_DONG_CO : CS_BEN(R);
    const r = boCuc(ds, cs);
    const min = Math.min(...r.rongPx);
    console.log(
      `  trần tỉ số ${String(R).padStart(5)} : 2D min = ${String(Math.round(min * 10) / 10).padStart(6)} px · 3D dự phóng ${String(Math.round(min * 0.63 * 10) / 10).padStart(6)} px · ${min * 0.63 >= 24 ? "ĐẠT" : "không"}`,
    );
  }
  console.log(
    "\n  ⇒ Trần tỉ số tối đa còn ĐẠT ở 3D: R ≈ " +
      (() => {
        let ok = 1;
        for (let R = 1; R <= 6; R += 0.05) {
          const r = boCuc(ds, CS_BEN(R));
          if (Math.min(...r.rongPx) * 0.63 >= 24) ok = R;
        }
        return Math.round(ok * 100) / 100;
      })(),
  );
}

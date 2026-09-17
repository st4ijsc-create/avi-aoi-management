/**
 * _ph42-do.mjs — BƯỚC 1 của PH-42: ĐO TRƯỚC, KHÔNG VÁ.
 *
 * Ba câu hỏi của brief:
 *   Q1  bấm máy → bấm NỀN: viền / nhãn / nhấn sáng mỗi thứ chỉ vào đâu?
 *   Q2  bấm LẠI đúng máy đang chọn → có y hệt triệu chứng không?
 *   Q3  còn ai dùng CanhNhaMay nữa không (đo bằng census mã, ở nơi khác).
 *
 * ★ Ba bề mặt đo được từ NGOÀI:
 *   · nhãn      — DOM `[data-testid=nhan-may-twin3d]` (`LopNhan` nhận `dangChon={selectedId}`)
 *   · trang     — Sheet chi tiết mở/đóng (`selectedId != null`) + vòng `ring-primary` ở rail phải
 *   · nhấn sáng — KHÔNG có cửa sổ đo nào ⇒ vòng này chỉ ghi "chưa đo được", không đoán.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const TAI_KHOAN = process.argv[3] ?? "qatd_giamdoc";
const GOC = process.env.PH42_GOC ?? "http://localhost:3066";
const THU_MUC = `.qa-tapdoan/anh/ph42-${NHAN}`;
fs.mkdirSync(THU_MUC, { recursive: true });

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const loi = [];
page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));

await page.request.post(`${GOC}/api/auth/login`, {
  data: { username: TAI_KHOAN, password: "Qatd!2026" },
});
await page.goto(`${GOC}/factory-command?do=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

// ── bật 3D (mặc định 2D: FactoryCommandView.tsx:219) ──
await page.getByRole("button", { name: "3D", exact: true }).click();
await page
  .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
    timeout: 120_000,
    polling: 500,
  })
  .catch(() => {});
await page.waitForTimeout(2500);

const doTrangThai = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const r = canvas?.getBoundingClientRect() ?? null;
    const nhan = [...document.querySelectorAll("[data-testid='nhan-may-twin3d']")].map((e) => ({
      id: Number(e.getAttribute("data-machine-id")),
      vienStyle: e.style.border,
      chu: e.textContent?.trim().slice(0, 40) ?? null,
    }));
    const sheet = document.querySelector("[data-slot='sheet-content']");
    return {
      // ── bề mặt TRANG (selectedId) ──
      sheetMo: Boolean(sheet),
      sheetTieuDe: sheet?.querySelector("[data-slot='sheet-title']")?.textContent?.trim() ?? null,
      soRingRailPhai: document.querySelectorAll("[class*='ring-primary']").length,
      soLopPhuSheet: document.querySelectorAll("[data-slot='sheet-overlay']").length,
      // ── bề mặt NHÃN (LopNhan dangChon) ──
      nhan,
      hopNhanDaVe: window.__demTuongTac?.hopNhanDaVe?.() ?? null,
      // ── cảnh ──
      // ★ PH-42 — bốn bề mặt chọn đọc cùng lúc; `null` = bản dựng chưa gắn cửa sổ đo.
      chonCanh: window.__demChonChiHuy?.() ?? null,
      soMayVe: window.__demTuongTac?.dsMay?.()?.length ?? -1,
      thongKe: window.__thongKeVe ?? null,
      canvasHop: r ? { trai: r.left, tren: r.top, rong: r.width, cao: r.height } : null,
    };
  });

/** Điểm NỀN: một điểm trong canvas không trúng khối nào (kiểm bằng `hitTai`). */
const timDiemNen = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const r = canvas.getBoundingClientRect();
    const h = window.__demTuongTac?.hitTai;
    const ra = [];
    // quét lưới thưa, lấy điểm đầu tiên KHÔNG trúng object nào
    for (let fy = 0.05; fy <= 0.45; fy += 0.1) {
      for (let fx = 0.05; fx <= 0.95; fx += 0.1) {
        const ndcX = fx * 2 - 1;
        const ndcY = 1 - fy * 2;
        const kq = h ? h(ndcX, ndcY) : null;
        if (kq === null) {
          ra.push({ fx, fy, clientX: r.left + fx * r.width, clientY: r.top + fy * r.height });
        }
      }
    }
    return ra[0] ?? null;
  });

const elTai = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return null;
      return {
        the: el.tagName,
        testid: el.getAttribute("data-testid"),
        slot: el.getAttribute("data-slot"),
        lop: (el.className?.baseVal ?? el.className ?? "").toString().slice(0, 80),
      };
    },
    [x, y],
  );

const so = {};
const chup = async (ten) => page.screenshot({ path: `${THU_MUC}/${ten}.png` });

// ══════════════════════════════════════════════════════════════════════
so.b0_banDau = await doTrangThai();
await chup("0-ban-dau");

// máy đầu tiên nằm trong khung
const ds = await page.evaluate(() => window.__demTuongTac?.dsMay?.() ?? []);
const may = ds.find((m) => m.trongKhung) ?? ds[0];
so.mayThu = may ?? null;
if (!may) {
  console.log("KHÔNG CÓ MÁY NÀO — dừng, mọi ca sau sẽ tự thoả");
  fs.writeFileSync(`.qa-tapdoan/_ph42-do-${NHAN}.json`, JSON.stringify({ so, loi }, null, 1));
  await trinh.close();
  process.exit(1);
}

const hop = so.b0_banDau.canvasHop;
const bamCanh = async (x, y) => {
  await page.mouse.click(hop.trai + x, hop.tren + y);
  await page.waitForTimeout(1200);
};

// ── Q1a: bấm MỘT MÁY ──
so.diemMay = { x: may.x, y: may.y };
await bamCanh(may.x, may.y);
so.b1_sauBamMay = await doTrangThai();
await chup("1-sau-bam-may");

// ── điểm nền + ai đang nằm trên đó ──
const nen = await timDiemNen();
so.diemNen = nen;
so.b1_elTaiDiemNen = nen ? await elTai(nen.clientX, nen.clientY) : null;
so.b1_elTaiDiemMay = await elTai(hop.trai + may.x, hop.tren + may.y);

// ── Q1b: bấm NỀN ──
if (nen) {
  await page.mouse.click(nen.clientX, nen.clientY);
  await page.waitForTimeout(1200);
}
so.b2_sauBamNen = await doTrangThai();
await chup("2-sau-bam-nen");

// ── Q2: bấm LẠI đúng máy đang chọn ──
// đưa về trạng thái "đang chọn máy" một cách tường minh trước khi lặp
so.b3_truocBamLai = await doTrangThai();
await bamCanh(may.x, may.y);
so.b4_sauBamLai1 = await doTrangThai();
await chup("3-sau-bam-lai-1");
await bamCanh(may.x, may.y);
so.b5_sauBamLai2 = await doTrangThai();
await chup("4-sau-bam-lai-2");

so.loi = loi;
fs.writeFileSync(`.qa-tapdoan/_ph42-do-${NHAN}.json`, JSON.stringify(so, null, 1));
console.log(JSON.stringify(so, null, 1));
await ctx.close();
await trinh.close();

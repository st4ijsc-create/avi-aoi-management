/**
 * zf/chup.mjs — CHỤP KHUNG CHO PHÉP ĐO Z-FIGHTING (PH-51).
 *
 * MỖI KHUNG MỘT NGỮ CẢNH RIÊNG: khung `e-nghieng` phải nghiêng TỪ thế mặc định,
 * không phải từ thế đã cuộn của khung trước — nếu dùng chung một trang thì thứ tự
 * khung trở thành một biến ẩn của phép đo (vòng 1 của tôi dính đúng lỗi này: khung
 * "nghiêng" thừa hưởng cú zoom nên chụp vào MẶT TOÀ chứ không phải mặt sàn).
 *
 * Ghi ảnh canvas + SỐ ĐO CAMERA (near/far/camXa). Phép so hai bản chỉ hợp lệ khi
 * camXa GIỐNG NHAU và near|far KHÁC NHAU — `zf/kiem.mjs` đọc json này để tự bác bỏ.
 *
 *   node .qa-tapdoan/zf/chup.mjs <nhan> <canh1,canh2,...> [khung1,khung2]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "x";
const CANH_XIN = (process.argv[3] ?? "tapdoan").split(",");
const KHUNG_LOC = process.argv[4] ? new Set(process.argv[4].split(",")) : null;

const CANH = {
  tapdoan: { vai: "qatd_admin", url: "/twin?pv=tapdoan&do=1", khung: ["a-macdinh", "b-zoom", "e-nghieng", "f-tran"] },
  nhamay: { vai: "qatd_kythuat", url: "/twin?nm=39&do=1", khung: ["a-macdinh", "e-nghieng"] },
  line: { vai: "qatd_giamdoc", url: "/twin/line/529?do=1", khung: ["a-macdinh"] },
  may: { vai: "qatd_giamdoc", url: "/twin/may/8070?do=1", khung: ["a-macdinh"] },
};

const THU = `.qa-tapdoan/zf/anh/${NHAN}`;
fs.mkdirSync(THU, { recursive: true });
fs.mkdirSync(".qa-tapdoan/zf/tho", { recursive: true });

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const so = [];
for (const ten of CANH_XIN) {
  const c = CANH[ten];
  if (!c) throw new Error(`cảnh lạ: ${ten}`);
  for (const khung of c.khung) {
    if (KHUNG_LOC && !KHUNG_LOC.has(khung)) continue;
    const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.request.post(`${GOC}/api/auth/login`, { data: { username: c.vai, password: MK } });
    await page.goto(`${GOC}${c.url}`, { waitUntil: "domcontentloaded" });
    await page.locator("canvas").first().waitFor({ timeout: 90000 }).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const tk = window.__thongKeVe;
          if (!tk || !tk.calls) return false;
          const k = `${tk.calls}|${tk.tris ?? tk.triangles ?? 0}`;
          const on = window.__zf === k;
          window.__zf = k;
          return on;
        },
        undefined,
        { timeout: 120000, polling: 900 },
      )
      .catch(() => {});
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas").first();
    const cv = await canvas.boundingBox();
    if (khung === "b-zoom") {
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
      for (let i = 0; i < 200; i += 1) {
        const x = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
        if (x <= 300) break;
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(70);
      }
      await page.waitForTimeout(1500);
    } else if (khung === "f-tran") {
      // Cuộn RA tới TRẦN zoom (camXa ngừng tăng) — ca xấu nhất của bước z: Δz ∝ z².
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
      let truoc = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
      let yen = 0;
      for (let i = 0; i < 90; i += 1) {
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(120);
        const x = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
        if (Math.abs(x - truoc) < 0.01) { yen += 1; if (yen >= 3) break; } else yen = 0;
        truoc = x;
      }
      await page.waitForTimeout(1500);
    } else if (khung === "e-nghieng") {
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
      await page.mouse.down();
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2 - 300, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(1500);
    }

    const d = await page.evaluate(() => {
      const tk = window.__thongKeVe ?? {};
      const yc = window.__catCanhYeuCau ?? {};
      const cv = document.querySelector("canvas");
      return {
        near: tk.near ?? null,
        far: tk.far ?? null,
        camXa: tk.camXa ?? null,
        calls: tk.calls ?? null,
        tris: tk.tris ?? tk.triangles ?? null,
        ycNear: yc.near ?? null,
        ycFar: yc.far ?? null,
        cvW: cv?.width ?? null,
        cvH: cv?.height ?? null,
      };
    });
    const p = `${THU}/${ten}-${khung}.png`;
    await canvas.screenshot({ path: p });
    so.push({ canh: ten, khung, anh: p, ...d });
    console.log(
      `  ${ten}/${khung}: near=${d.near} far=${d.far} camXa=${d.camXa} calls=${d.calls} tris=${d.tris} cv=${d.cvW}x${d.cvH}`,
    );
    await ctx.close();
  }
}
const tep = `.qa-tapdoan/zf/tho/chup-${NHAN}.json`;
const cu = fs.existsSync(tep) ? JSON.parse(fs.readFileSync(tep, "utf8")) : [];
const gop = [...cu.filter((r) => !so.some((n) => n.canh === r.canh && n.khung === r.khung)), ...so];
fs.writeFileSync(tep, JSON.stringify(gop, null, 1));
console.log(`→ ${THU} · ${tep}`);
await trinh.close();

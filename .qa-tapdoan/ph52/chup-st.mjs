/**
 * ph52/chup-st.mjs — CHỤP KHUNG MÀN STUDIO `/twin-studio` (`CanhThietKe`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG DÙNG LẠI `zf/chup-studio.mjs` — ĐÓ LÀ CHỖ SINH RA "calls 3 vs 2"
 * ════════════════════════════════════════════════════════════════════════════
 * Cổng chờ của tệp cũ là "`calls` GIỐNG NHAU ở hai lần đọc cách nhau 900 ms".
 * Đo sống (`_probe-studio.mjs`, 2 lượt × 24 mẫu/1 s):
 *   lượt 1: `calls=3 tris=2702` ngay từ giây 0
 *   lượt 2: `calls=2 tris=2`    suốt 5 GIÂY rồi mới lên `3 / 2702`
 * `calls=2, tris=2` = tấm sàn (2 tam giác) + `gridHelper`; **lô máy CHƯA VỀ**.
 * Trạng thái ấy ĐỨNG YÊN 5 s nên nó THOẢ cổng "hai lần đọc giống nhau" ⇒ tệp cũ
 * chụp được một cảnh KHÔNG CÓ MÁY. Hai lượt của họ vì thế khác nhau 2.700 tam
 * giác — con số 57,30 % là hiệu của HAI CẢNH KHÁC NHAU, không tách được gì.
 *
 * Nên ở đây cổng chờ là một KHẲNG ĐỊNH KÍCH THƯỚC: phải có đủ `calls` và `tris`
 * của lô máy rồi mới tính là cảnh đã dựng xong; thiếu thì NỔ chứ không chụp.
 *
 *   node .qa-tapdoan/ph52/chup-st.mjs <nhan> [khung1,khung2]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import crypto from "node:crypto";

const GOC = "http://localhost:3077";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "x";
const KHUNG_LOC = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const KHUNG = ["a-macdinh", "f-tran", "e-nghieng"];

/** Cảnh Studio của QATD, đo sống: 3 lệnh vẽ · 2.702 tam giác · far 2000 · camXa 117,054. */
const CALLS_DU = 3;
const TRIS_DU = 2702;

const THU = `.qa-tapdoan/ph52/anh/${NHAN}`;
fs.mkdirSync(THU, { recursive: true });
fs.mkdirSync(".qa-tapdoan/ph52/tho", { recursive: true });

const THU_DIST = process.env.PH52_DIST ?? ".qa-tapdoan/dist-ph52t";
const CHUNK = fs.readdirSync(`${THU_DIST}/public/assets`).find((f) => /^TwinStudio-.*\.js$/.test(f));
if (!CHUNK) throw new Error(`không thấy chunk TwinStudio trong ${THU_DIST}`);
const DIA = `${THU_DIST}/public/assets/${CHUNK}`;
async function canhCua(luc) {
  const mong = crypto.createHash("md5").update(fs.readFileSync(DIA)).digest("hex");
  const r = await fetch(`${GOC}/assets/${CHUNK}`);
  const b = Buffer.from(await r.arrayBuffer());
  const that = crypto.createHash("md5").update(b).digest("hex");
  if (that !== mong)
    throw new Error(`[${luc}] CỔNG ${GOC} KHÔNG phục vụ dist-ph52t: ${CHUNK} md5 ${that} ≠ đĩa ${mong} — DỪNG`);
  console.log(`  canh cửa [${luc}] OK · ${CHUNK} md5=${that}`);
}
await canhCua("trước");

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const so = [];
for (const khung of KHUNG) {
  if (KHUNG_LOC && !KHUNG_LOC.has(khung)) continue;
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: "qatd_admin", password: MK } });
  await page.goto(`${GOC}/twin-studio?do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-studio").waitFor({ timeout: 90000 });
  await page.locator("canvas").first().waitFor({ timeout: 90000 });

  // ★ Cổng chờ = KHẲNG ĐỊNH KÍCH THƯỚC, không phải "hai lần đọc giống nhau".
  await page.waitForFunction(
    ([c, t]) => {
      const tk = window.__thongKeVe;
      return !!tk && (tk.calls ?? 0) >= c && (tk.triangles ?? tk.tris ?? 0) >= t;
    },
    [CALLS_DU, TRIS_DU],
    { timeout: 120000, polling: 500 },
  );
  await page.waitForTimeout(2500);

  const canvas = page.locator("canvas").first();
  const cv = await canvas.boundingBox();
  if (khung === "e-nghieng") {
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
    await page.mouse.down();
    await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2 - 260, { steps: 30 });
    await page.mouse.up();
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
      if (Math.abs(x - truoc) < 0.01) {
        yen += 1;
        if (yen >= 3) break;
      } else yen = 0;
      truoc = x;
    }
    await page.waitForTimeout(1500);
  }

  const d = await page.evaluate(() => {
    const tk = window.__thongKeVe ?? {};
    const cv = document.querySelector("canvas");
    return {
      near: tk.near ?? null,
      far: tk.far ?? null,
      camXa: tk.camXa ?? null,
      calls: tk.calls ?? null,
      tris: tk.triangles ?? tk.tris ?? null,
      cvW: cv?.width ?? null,
      cvH: cv?.height ?? null,
      soCanvas: document.querySelectorAll("canvas").length,
    };
  });
  if (d.calls !== CALLS_DU || d.tris !== TRIS_DU)
    throw new Error(
      `studio/${khung}: calls=${d.calls} tris=${d.tris} — PHẢI ${CALLS_DU}/${TRIS_DU} ` +
        `(lô máy chưa về ⇒ đang chụp CẢNH KHÁC) — DỪNG`,
    );
  const p = `${THU}/studio-${khung}.png`;
  await canvas.screenshot({ path: p });
  so.push({ canh: "studio", khung, anh: p, ...d });
  console.log(
    `  studio/${khung}: near=${d.near} far=${d.far} camXa=${d.camXa} calls=${d.calls} tris=${d.tris} cv=${d.cvW}x${d.cvH} canvas=${d.soCanvas}`,
  );
  await ctx.close();
}
await canhCua("sau");
const tep = `.qa-tapdoan/ph52/tho/chup-${NHAN}.json`;
const cu = fs.existsSync(tep) ? JSON.parse(fs.readFileSync(tep, "utf8")) : [];
const gop = [...cu.filter((r) => !so.some((n) => n.canh === r.canh && n.khung === r.khung)), ...so];
fs.writeFileSync(tep, JSON.stringify(gop, null, 1));
console.log(`→ ${THU} · ${tep}`);
await trinh.close();

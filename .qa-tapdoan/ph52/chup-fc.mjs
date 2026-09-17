/**
 * ph52/chup-fc.mjs — CHỤP KHUNG MÀN `/factory-command` (`CanhNhaMay`).
 *
 * Khác `zf/chup.mjs` ở đúng hai chỗ: (1) màn này mặc định **2D** nên phải bấm nút
 * "3D" mới có canvas WebGL; (2) cỡ cảnh đổi bằng BỘ CHỌN NHÀ MÁY chứ không bằng
 * query param, nên "hai cỡ cảnh" là: `tatca` (3 công ty) và `mot` (một công ty).
 *
 * Mỗi khung một ngữ cảnh trình duyệt RIÊNG — thứ tự khung không được là biến ẩn.
 *
 *   node .qa-tapdoan/ph52/chup-fc.mjs <nhan> [canh1,canh2] [khung1,khung2]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import crypto from "node:crypto";

const GOC = "http://localhost:3077";
const MK = "Qatd!2026";
const NHAN = process.argv[2] ?? "x";
const CANH_XIN = (process.argv[3] ?? "fc-tatca,fc-mot").split(",");
const KHUNG_LOC = process.argv[4] ? new Set(process.argv[4].split(",")) : null;

const CANH = {
  // `farKyVong` = KHẲNG ĐỊNH KÍCH THƯỚC ĐẦU VÀO. `far = max(2000, banKinh*20)` nên
  // nó là dấu vân tay của cỡ cảnh: bộ chọn nhà máy trượt (đã xảy ra thật ở lượt
  // `base1`, `fc-mot/e-nghieng` rơi về cảnh 3 công ty) thì ca này PHẢI nổ, không
  // được lặng lẽ chụp nhầm cảnh rồi đem so.
  "fc-tatca": { vai: "qatd_admin", nhaMay: null, farKyVong: 8199.902, khung: ["a-macdinh", "b-zoom", "e-nghieng"] },
  "fc-mot": { vai: "qatd_admin", nhaMay: "Công ty A", farKyVong: 2972.937, khung: ["a-macdinh", "e-nghieng"] },
};

const THU = `.qa-tapdoan/ph52/anh/${NHAN}`;
fs.mkdirSync(THU, { recursive: true });
fs.mkdirSync(".qa-tapdoan/ph52/tho", { recursive: true });

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CANH CỬA: CỔNG NÀY CÓ ĐANG PHỤC VỤ ĐÚNG `dist-ph52t` KHÔNG?
 * ════════════════════════════════════════════════════════════════════════════
 * Đã xảy ra THẬT lúc 15:43:56: một phiên khác `start` server của họ trên cổng
 * tôi đang dùng (3067), giết tiến trình của tôi và phục vụ `dist-nhan2-sau`.
 * Vì nhánh của họ KHÔNG chạm `/factory-command`, màn ấy vẽ GIỐNG HỆT bản của
 * tôi — nên hai lượt đo tiếp theo trả về "bằng bản chưa vá" mà trông hoàn toàn
 * hợp lý. Một phép đo âm tính giả HOÀN HẢO.
 *
 * Nên từ đây phép đo TỰ BÁC BỎ: băm md5 của chunk `FactoryCommandView` lấy QUA
 * HTTP phải khớp chunk trên ĐĨA của `dist-ph52t`, kiểm TRƯỚC và SAU mỗi lượt.
 */
const THU_DIST = process.env.PH52_DIST ?? ".qa-tapdoan/dist-ph52t";
const CHUNK = fs.readdirSync(`${THU_DIST}/public/assets`).find((f) => /^FactoryCommandView-.*\.js$/.test(f));
if (!CHUNK) throw new Error(`không thấy chunk FactoryCommandView trong ${THU_DIST}`);
const DIA = `${THU_DIST}/public/assets/${CHUNK}`;
async function canhCua(luc) {
  const mong = crypto.createHash("md5").update(fs.readFileSync(DIA)).digest("hex");
  const r = await fetch(`${GOC}/assets/${CHUNK}`);
  const b = Buffer.from(await r.arrayBuffer());
  const that = crypto.createHash("md5").update(b).digest("hex");
  if (that !== mong)
    throw new Error(
      `[${luc}] CỔNG ${GOC} KHÔNG phục vụ dist-ph52t: ${CHUNK} qua HTTP md5=${that} ` +
        `(${b.length} B, ${r.headers.get("content-type")}) ≠ đĩa md5=${mong} — DỪNG, phép đo vô hiệu`,
    );
  console.log(`  canh cửa [${luc}] OK · ${CHUNK} md5=${that}`);
}
await canhCua("trước");

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
    await page.goto(`${GOC}/factory-command`, { waitUntil: "domcontentloaded" });

    // ── Bộ chọn nhà máy (nếu cảnh yêu cầu MỘT công ty) ──
    if (c.nhaMay) {
      // Bộ chọn chỉ có mục "Công ty A" SAU khi `factoryCommand.overview` về; mở sớm
      // thì danh sách rỗng và `click` hết giờ. Thử lại tối đa 4 lần thay vì chờ mù.
      // `.first()` từng bắt phải bộ chọn ẨN của `AssetScopeBar` (aria-label="Factory",
      // element is not visible) ⇒ hết giờ. Lấy bộ chọn HIỆN đầu tiên.
      // Trang có NHIỀU `role="combobox"`: bộ chọn nhà máy (`AssetScopeBar`), lớp phủ
      // ("Status"), … và bộ chọn nhà máy có lúc nằm trong nhánh ẨN ⇒ `.first()` bắt
      // phải nó rồi hết giờ. Nên: duyệt MỌI bộ chọn HIỆN, mở từng cái, cái nào có
      // mục "Công ty A" thì đó là bộ chọn cần. Đúng/sai vẫn được `farKyVong` chốt lại.
      // Trang có HAI `role="combobox"` (bộ chọn nhà máy ở `FactoryCommandView.tsx:420`
      // và lớp phủ ở `:473`) và đôi lúc thêm một bộ chọn ẨN của `AssetScopeBar` —
      // `.first()` từng bắt phải cái ẩn rồi hết giờ. Neo theo `data-loc` là xác định.
      // Và "đã bấm" ≠ "đã đổi": chờ tới khi CHÍNH bộ chọn ấy hiện tên nhà máy.
      const bo = page.locator('button[role="combobox"][data-loc*="FactoryCommandView.tsx:420"]');
      await bo.waitFor({ timeout: 60000 });
      let xong = false;
      for (let lan = 1; lan <= 4 && !xong; lan += 1) {
        try {
          await bo.click({ timeout: 10000 });
          await page.waitForTimeout(500);
          await page.getByRole("option", { name: c.nhaMay, exact: true }).click({ timeout: 8000 });
          await bo.filter({ hasText: c.nhaMay }).waitFor({ timeout: 8000 });
          xong = true;
        } catch {
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
      if (!xong) throw new Error(`${ten}/${khung}: KHÔNG chọn được nhà máy "${c.nhaMay}" — DỪNG`);
      await page.waitForTimeout(2500);
    }

    // ── 2D → 3D ──
    await page.getByRole("button", { name: "3D", exact: true }).click({ timeout: 60000 });
    await page.locator("canvas").first().waitFor({ timeout: 90000 }).catch(() => {});
    await page
      .waitForFunction(
        () => {
          const tk = window.__thongKeVe;
          if (!tk || !tk.calls) return false;
          const k = `${tk.calls}|${tk.triangles ?? tk.tris ?? 0}`;
          const on = window.__ph52 === k;
          window.__ph52 = k;
          return on;
        },
        undefined,
        { timeout: 120000, polling: 900 },
      )
      .catch(() => {});
    await page.waitForTimeout(2500);

    const canvas = page.locator("canvas").first();
    const cv = await canvas.boundingBox();
    if (khung === "e-nghieng") {
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
      await page.mouse.down();
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2 - 150, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(1500);
    } else if (khung === "b-zoom") {
      await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
      for (let i = 0; i < 200; i += 1) {
        const x = await page.evaluate(() => window.__thongKeVe?.camXa ?? 0);
        if (x <= 120) break;
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(70);
      }
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
        tris: tk.triangles ?? tk.tris ?? null,
        ycNear: yc.near ?? null,
        ycFar: yc.far ?? null,
        cvW: cv?.width ?? null,
        cvH: cv?.height ?? null,
        soCanvas: document.querySelectorAll("canvas").length,
      };
    });
    if (Math.abs((d.far ?? -1) - c.farKyVong) > 0.5)
      throw new Error(
        `${ten}/${khung}: far=${d.far} nhưng cảnh này PHẢI có far=${c.farKyVong} ` +
          `(far = max(2000, banKinh×20) ⇒ đang chụp NHẦM CỠ CẢNH) — DỪNG`,
      );
    const p = `${THU}/${ten}-${khung}.png`;
    await canvas.screenshot({ path: p });
    so.push({ canh: ten, khung, anh: p, ...d });
    console.log(
      `  ${ten}/${khung}: near=${d.near} far=${d.far} camXa=${d.camXa} calls=${d.calls} tris=${d.tris} cv=${d.cvW}x${d.cvH} canvas=${d.soCanvas}`,
    );
    await ctx.close();
  }
}
await canhCua("sau");
const tep = `.qa-tapdoan/ph52/tho/chup-${NHAN}.json`;
const cu = fs.existsSync(tep) ? JSON.parse(fs.readFileSync(tep, "utf8")) : [];
const gop = [...cu.filter((r) => !so.some((n) => n.canh === r.canh && n.khung === r.khung)), ...so];
fs.writeFileSync(tep, JSON.stringify(gop, null, 1));
console.log(`→ ${THU} · ${tep}`);
await trinh.close();

import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô Y (Đợt 21) — ĐO TỈ LỆ CANVAS 3D và CHIỀU CAO DẢI NGANG
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★ Vì sao đo bằng `getBoundingClientRect()` chứ không bằng mắt: §13b 14.10.A.1
 *   đòi **cùng viewport 1280×720** với phép đo cũ ghi ở `TwinVanHanh.tsx:2417-2436`
 *   (canvas 360×416 = 16,9 %). Đổi viewport rồi khoe tiến bộ là **G9** (đổi đơn
 *   vị của con số).
 *
 * ★ G5/G32 — mỗi phép đo phải hỏi **đầu ra có KHÁC đầu vào không**. Suite này
 *   in ra CẢ hai trạng thái (panel mở / `?thu=trai,phai`) trong cùng một lượt,
 *   nên hai con số phải khác nhau; bằng nhau ⇒ thiết bị đo hỏng, không phải
 *   "bố cục không đổi".
 *
 * ★ Đo bằng vai **KHÔNG-admin** (`e2e_tai_loE`, supervisor): admin bypass
 *   `requirePermission` ⇒ đo bằng admin chứng minh **số 0** về quyền.
 */

const VIEWPORT = { width: 1280, height: 720 };
const DIEN_TICH_VIEWPORT = VIEWPORT.width * VIEWPORT.height;

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

async function dangNhap(page: Page, tk = TAI_KHOAN) {
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
}

/**
 * Đo hộp của **canvas thật** (thẻ `<canvas>` của WebGL, hoặc `svg` ở chế độ 2D).
 *
 * ⚠ KHÔNG đo `khoi-canh-3d` (cái div bọc): div bọc có thể rộng đúng mà canvas
 *   bên trong vẫn bé — đo cái bọc là đo **ý định**, không đo **kết quả** (G5).
 */
async function doCanvas(page: Page) {
  return await page.evaluate(() => {
    const c =
      document.querySelector("canvas") ??
      (document.querySelector('[data-testid="canh-2d"] svg') as Element | null);
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  });
}

/**
 * Tổng chiều cao **mọi dải ngang `shrink-0`** là con của khung màn, tính theo
 * hộp thật. Đây là số §13b 14.10.A.2 đòi ≤ 120 px ở ca xấu nhất (nền 280 px).
 */
async function doDaiNgang(page: Page) {
  return await page.evaluate(() => {
    const khung = document.querySelector('[data-testid="man-twin-van-hanh"]');
    if (!khung) return null;
    const ra: Array<{ tid: string; h: number }> = [];
    for (const el of Array.from(khung.children)) {
      const r = el.getBoundingClientRect();
      // Thân trang (cột trái|canvas|phải) là phần tử CAO NHẤT và là thứ duy nhất
      // co được — nó KHÔNG phải dải ngang. Nhận nó bằng `flex-1`, không bằng
      // chiều cao (chiều cao là hệ quả, không phải định nghĩa).
      const cs = getComputedStyle(el);
      const laThan = cs.flexGrow !== "0";
      if (laThan) continue;
      if (r.height === 0) continue;
      ra.push({
        tid: el.getAttribute("data-testid") ?? el.tagName.toLowerCase(),
        h: Math.round(r.height),
      });
    }
    return ra;
  });
}

async function choCanhSan(page: Page) {
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  // Cảnh 3D nạp bất đồng bộ (lazy + tRPC). Chờ CANVAS thật xuất hiện, không chờ
  // một khoảng thời gian đoán mò.
  await page
    .waitForFunction(() => document.querySelector("canvas") !== null, null, { timeout: 90_000 })
    .catch(() => {});
  await page.waitForTimeout(4_000);
}

test("Y-ĐO — ti le canvas 3D tren 1280x720, hai trang thai", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VIEWPORT);
  await dangNhap(page);

  const ketQua: Record<string, unknown> = { viewport: VIEWPORT };

  // ── Trạng thái 1: MẶC ĐỊNH (cả hai panel MỞ) ──────────────────────────────
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const c1 = await doCanvas(page);
  const d1 = await doDaiNgang(page);
  expect(c1, "canvas phai ton tai o trang thai mac dinh").not.toBeNull();
  const tl1 = ((c1!.w * c1!.h) / DIEN_TICH_VIEWPORT) * 100;
  ketQua.macDinh = { canvas: c1, tiLePhanTram: Number(tl1.toFixed(1)), daiNgang: d1 };
  console.log(`   [Y-ĐO] MẶC ĐỊNH  canvas ${c1!.w}×${c1!.h} = ${tl1.toFixed(1)} % viewport`);
  console.log(`   [Y-ĐO] dải ngang: ${JSON.stringify(d1)}`);
  await page.screenshot({ path: ".qa-loY/Y-macdinh.png" });

  // ── Trạng thái 2: `?thu=trai,phai` (3D gần toàn màn) ──────────────────────
  await page.goto("/twin?thu=trai,phai", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const c2 = await doCanvas(page);
  const d2 = await doDaiNgang(page);
  expect(c2, "canvas phai ton tai o trang thai thu").not.toBeNull();
  const tl2 = ((c2!.w * c2!.h) / DIEN_TICH_VIEWPORT) * 100;
  ketQua.thuCaHai = { canvas: c2, tiLePhanTram: Number(tl2.toFixed(1)), daiNgang: d2 };
  console.log(`   [Y-ĐO] THU CẢ HAI canvas ${c2!.w}×${c2!.h} = ${tl2.toFixed(1)} % viewport`);
  await page.screenshot({ path: ".qa-loY/Y-thu.png" });

  fs.writeFileSync(".qa-loY/do-bo-cuc.json", JSON.stringify(ketQua, null, 2));

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐÍNH CHÍNH MỘT KHẲNG ĐỊNH SAI CỦA CHÍNH LƯỚI NÀY — ghi lại, không xoá
   * ════════════════════════════════════════════════════════════════════════
   * Bản đầu của lưới này khẳng định `tl2 > tl1` ("thu cả hai phải cho canvas
   * LỚN HƠN mặc định"). Chạy thật thì nó **ĐỎ**, và phép đo đúng, còn khẳng
   * định sai:
   *
   *     MẶC ĐỊNH  canvas **968**×515   THU CẢ HAI  canvas **968**×489
   *
   * ★★★ Bề NGANG **bằng nhau và bằng cả khung** — và đó chính là ĐIỀU PHẢI
   *   CHỨNG MINH của đợt này, không phải điều phải bác bỏ. Sau khi panel đổi
   *   từ *chia đất* sang *nổi đè* (§13b 14.1.1), `?thu=` **không còn trả thêm
   *   bề ngang cho canvas nữa** vì canvas đã chiếm trọn bề ngang ở CẢ HAI
   *   trạng thái. Nền cũ (`488` → `968`) mới là thứ có chênh lệch, vì hồi ấy
   *   panel thật sự lấy mất 480 px.
   *
   * ⚠ Chênh 26 px chiều CAO giữa hai lượt KHÔNG do `?thu=`: đó là dải hợp nhất
   *   bật/tắt theo dữ liệu (banner "máy ở tầng khác" phụ thuộc lượt nạp).
   *   `daiNgang` trong `do-bo-cuc.json` ghi rõ điều đó, và vì thế lưới KHÔNG
   *   được khẳng định gì về chiều cao giữa hai lượt.
   *
   * ⇒ Khẳng định ĐÚNG, và nó mạnh hơn khẳng định cũ:
   */
  const RONG_KHUNG_1280 = 968; // 1280 − sidebar 264 − đệm `<main>` 48

  // 1. Canvas chiếm TRỌN bề ngang khung ở CẢ HAI trạng thái (panel nổi đè).
  expect(c1!.w, "mac dinh: canvas rong bang CA KHUNG").toBe(RONG_KHUNG_1280);
  expect(c2!.w, "thu ca hai: canvas VAN rong bang ca khung").toBe(RONG_KHUNG_1280);

  // 2. ★ Ca DƯƠNG cho chính thiết bị đo (G5/G32): nếu phép đo bắt nhầm phần tử
  //    (ví dụ bắt div bọc), hai dòng trên vẫn có thể xanh. Nên đo thêm một đại
  //    lượng phải ĐỔI: cả hai tỉ lệ phải VƯỢT XA nền 24,0 % đã đo trước đợt.
  expect(tl1, "mac dinh phai vuot nen 24,0 %").toBeGreaterThan(45);
  expect(tl2, "thu ca hai phai vuot nen 24,0 %").toBeGreaterThan(45);

  // 3. ★★★ §13b 14.10.A.2 — tổng dải ngang cố định ≤ 120 px (nền 280 px).
  const tong1 = (d1 ?? []).reduce((a, b) => a + b.h, 0);
  const tong2 = (d2 ?? []).reduce((a, b) => a + b.h, 0);
  console.log(`   [Y-ĐO] tổng dải ngang: mặc định ${tong1} px · thu ${tong2} px (trần 120)`);
  expect(tong1, "tong dai ngang mac dinh <= 120 px").toBeLessThanOrEqual(120);
  expect(tong2, "tong dai ngang khi thu <= 120 px").toBeLessThanOrEqual(120);
});

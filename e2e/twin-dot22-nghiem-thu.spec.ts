import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 22 — NGHIỆM THU THỊ GIÁC BỐ CỤC MỚI + Z4 (cây phân cấp có roll-up)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ MỤC ĐÍCH LÀ **TÌM CHỖ CHƯA DÙNG ĐƯỢC**, không phải xác nhận nó đẹp.
 *   Ba lô trước từng nộp ảnh chỉ có spinner hoặc trắng hoàn toàn. Nên mỗi ca ở
 *   đây, TRƯỚC khi chụp, ghim ba điều kiện đo được:
 *     1. khung `man-twin-van-hanh` có mặt,
 *     2. có `<canvas>` (3D) hoặc `canh-2d` (thay thế) — không phải khung rỗng,
 *     3. và in ra hộp của các vùng, để phần mô tả ảnh **có số kèm theo**.
 *
 * ★ Đo bằng vai **KHÔNG-admin**. `admin` bypass `requirePermission`, nên mọi
 *   con số về quyền đo bằng admin là số 0.
 *
 * ★ G65 — chạy bằng `playwright.dot22.config.ts` (`outputDir: .qa-dot22/`).
 *   Cấu hình GỐC sẽ XOÁ 5 ảnh lô C đang được git theo dõi trong `test-results/`.
 *
 * ★ G42 — `elementFromPoint` BỎ QUA `pointer-events:none`, nên nó KHÔNG dùng
 *   một mình để kết luận che khuất. Ở đây nó chỉ dùng kèm hộp + z-index thật.
 */

const VP_720 = { width: 1280, height: 720 };
const VP_1080 = { width: 1920, height: 1080 };

/**
 * ★★★ BA VAI, VÀ VIỆC CHIA CHÚNG RA LÀ MỘT PHÉP ĐO, KHÔNG PHẢI TIỆN TAY.
 *
 * ⚠⚠ ĐO ĐƯỢC 2026-09-08, và nó đổi cả thiết kế của suite này:
 *   `user_factory_assignments` chỉ có **4 hàng, thuộc ĐÚNG 2 người dùng** —
 *   `engineer1`(51) và `e2e_tai_loE`(21075). `operator1`(48) và
 *   `supervisor1`(49) **KHÔNG có hàng nào**, nên `twinCanh.canhThietKe` trả
 *   `scopeEmptyReason="no_factory_assignment"` và **mọi mảng đều rỗng**
 *   (đo trực tiếp qua tRPC: xuong 0 · chuyen 0 · tram 0 · may 0).
 *
 * ⇒ Chụp bố cục bằng `operator1` là chụp một màn **rỗng vì chưa được gán**,
 *   và mọi con số về vùng/cây/roll-up đo trên đó là **số 0 nguỵ trang**. Nên:
 *     · `CO_DU_LIEU` (`e2e_tai_loE`, supervisor, KHÔNG phải admin) — dùng cho
 *       mọi ảnh đo BỐ CỤC và CÂY. Đối chứng: xuong 1 · chuyen 3 · tram 36 ·
 *       may 42.
 *     · `CHI_XEM`/`SUA_DUOC` — chỉ dùng cho cặp đối chứng QUYỀN (A5/A6), nơi
 *       câu hỏi là "vào được vùng sửa không", không phải "thấy bao nhiêu máy".
 */
const CO_DU_LIEU = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const CHI_XEM = { username: "operator1", password: "User@123" };
const SUA_DUOC = { username: "engineer1", password: "User@123" };

const ra: Record<string, unknown> = {};

async function dangNhap(page: Page, tk: { username: string; password: string }) {
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
}

/**
 * Chờ cảnh SẴN SÀNG, rồi **kiểm** rằng nó thật sự sẵn sàng.
 *
 * ⚠ `waitForSelector` một mình KHÔNG đủ: khung có mặt trong khi bên trong vẫn
 *   là spinner. Ca dưới đây trả về cờ `coCanh`, và mọi test đòi nó `true` —
 *   đó là điều biến "đã chụp" thành "đã chụp CÁI GÌ ĐÓ".
 */
async function choCanhSan(page: Page) {
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page
    .waitForFunction(
      () =>
        document.querySelector("canvas") !== null ||
        document.querySelector('[data-testid="canh-2d"]') !== null,
      null,
      { timeout: 90_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(5_000);
}

/**
 * Đo hộp thật của mọi vùng đáng kể + z-index **đã tính** (không phải khai
 * trong class).
 *
 * ★ G41 — nhãn drei ở z-index 20 (`LopNhan.tsx` `zIndexRange={[20,0]}`), nên
 *   mọi lớp phủ DOM phải ≥ 20 hoặc chữ 3D sẽ xuyên qua. Ở đây ta ĐỌC
 *   `getComputedStyle(...).zIndex` — giá trị trình duyệt thật dùng — thay vì
 *   grep chuỗi `z-30` trong mã (một class Tailwind có thể bị ghi đè).
 */
async function doVung(page: Page) {
  return await page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const hop = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        z: cs.zIndex,
        hien: r.width > 0 && r.height > 0 && cs.visibility !== "hidden",
      };
    };
    const canvas =
      document.querySelector("canvas") ??
      (document.querySelector('[data-testid="canh-2d"] svg') as Element | null);
    return {
      khung: hop(q('[data-testid="man-twin-van-hanh"]')),
      canvas: hop(canvas),
      panelTrai: hop(q('[data-testid="panel-trai"]')),
      panelPhai: hop(q('[data-testid="panel-phai"]')),
      daiHopNhat: hop(q('[data-testid="dai-hop-nhat-khung"]')),
      cayKhoi: hop(q('[data-testid="khoi-cay-phan-cap"]')),
      cay: hop(q('[data-testid="cay-phan-cap-twin"]')),
      danhSachMay: hop(q('[data-testid="danh-sach-may"]')),
      nutSuaBoCuc: hop(q('[data-testid="nut-sua-bo-cuc"]')),
      vungSua: hop(q('[data-testid="vung-sua-nha-xuong"]')),
      // ★ Số hàng cây thật sự vẽ ra — 0 nghĩa là cây rỗng, và một ảnh có cây
      //   RỖNG trông y hệt một ảnh có cây hỏng.
      soHangCay: document.querySelectorAll('[role="treeitem"]').length,
      // ★ Badge roll-up thật sự hiện ra (Z4). Đây là thứ phân biệt "cây có mặt"
      //   với "cây có mặt VÀ roll-up đang nói gì đó".
      soBadgeMay: document.querySelectorAll('[data-testid^="so-may-"]').length,
      soBadgeCanhBao: document.querySelectorAll('[data-testid^="canh-bao-"]').length,
      // Nhãn badge đầu tiên, để đọc được con số trong log.
      badgeMayDau: (document.querySelector('[data-testid^="so-may-"]') as HTMLElement | null)
        ?.textContent,
    };
  });
}

function tiLe(v: { w: number; h: number } | null, vp: { width: number; height: number }) {
  if (!v) return 0;
  return Number((((v.w * v.h) / (vp.width * vp.height)) * 100).toFixed(1));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 1-3 · BỐN CẤP PHẠM VI, 1280×720, vai CÓ DỮ LIỆU (không-admin)                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("A1 — /twin mac dinh (cap nha may), 1280x720, e2e_tai_loE", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);

  const v = await doVung(page);
  expect(v.khung, "khung phai co mat").not.toBeNull();
  expect(v.canvas?.hien, "PHAI co canh that, khong phai spinner").toBe(true);

  ra.A1 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_720) };
  console.log(`   [A1] canvas ${v.canvas?.w}x${v.canvas?.h} = ${tiLe(v.canvas, VP_720)}% vp`);
  console.log(`   [A1] panelTrai=${JSON.stringify(v.panelTrai)} panelPhai=${JSON.stringify(v.panelPhai)}`);
  console.log(`   [A1] cayKhoi=${JSON.stringify(v.cayKhoi)} soHangCay=${v.soHangCay}`);
  await page.screenshot({ path: ".qa-dot22/A1-nhamay-720.png" });
});

test("A2 — /twin?pv=tang, cap tang", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CO_DU_LIEU);
  // Tầng 76 = FUYU-G T1 (dữ liệu thử `--240`). Nếu tầng không thuộc phạm vi
  // người dùng thì màn nói "chưa được gán" — cũng là một kết quả đọc được.
  await page.goto("/twin?pv=tang:76", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const v = await doVung(page);
  ra.A2 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_720) };
  console.log(`   [A2] canvas ${v.canvas?.w}x${v.canvas?.h} = ${tiLe(v.canvas, VP_720)}% vp · hangCay=${v.soHangCay}`);
  await page.screenshot({ path: ".qa-dot22/A2-tang-720.png" });
});

test("A3 — /twin?pv=line:1, cap line", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?pv=line:1", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const v = await doVung(page);
  expect(v.canvas?.hien, "cap line PHAI co canh").toBe(true);
  ra.A3 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_720) };
  console.log(`   [A3] canvas ${v.canvas?.w}x${v.canvas?.h} = ${tiLe(v.canvas, VP_720)}% vp · hangCay=${v.soHangCay}`);
  await page.screenshot({ path: ".qa-dot22/A3-line-720.png" });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 4 · PANEL MÁY MỞ                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("A4 — /twin?xem=machine:2, panel may MO", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?xem=machine:2", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const v = await doVung(page);
  ra.A4 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_720) };
  console.log(`   [A4] panelPhai=${JSON.stringify(v.panelPhai)} canvas=${JSON.stringify(v.canvas)}`);
  await page.screenshot({ path: ".qa-dot22/A4-panel-may-720.png" });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 5-6 · `?che-do=botri` HAI VAI — đối chứng hai chiều (QD-16)             */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("A5 — ?che-do=botri voi operator1 (CHI XEM) — phai bi HA cap", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin?che-do=botri", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const v = await doVung(page);
  // ★★★ CHỐNG CỔNG RỘNG: operator1 KHÔNG được vào vùng sửa dù gõ thẳng URL.
  expect(v.vungSua, "operator1 KHONG duoc vao vung sua").toBeNull();
  expect(v.nutSuaBoCuc, "operator1 KHONG duoc thay nut Sua bo cuc").toBeNull();
  ra.A5 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_720) };
  console.log(`   [A5] vungSua=${v.vungSua} nutSua=${v.nutSuaBoCuc} canvas=${JSON.stringify(v.canvas)}`);
  await page.screenshot({ path: ".qa-dot22/A5-botri-operator1-720.png" });
});

test("A6 — ★ DOI CHUNG DUONG: ?che-do=botri voi engineer1 (SUA DUOC)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, SUA_DUOC);
  await page.goto("/twin?che-do=botri", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForTimeout(8_000);
  const v = await doVung(page);
  // ★★★ G5 — nếu ca này CŨNG cho `vungSua === null` thì phép đo A5 chứng minh
  //   SỐ 0 (nó chỉ đo rằng vùng sửa không bao giờ hiện, với ai cũng vậy).
  expect(v.vungSua, "engineer1 PHAI vao duoc vung sua — doi chung duong").not.toBeNull();
  ra.A6 = v;
  console.log(`   [A6] vungSua=${JSON.stringify(v.vungSua)}`);
  await page.screenshot({ path: ".qa-dot22/A6-botri-engineer1-720.png" });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 7 · NGĂN MÔ PHỎNG                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("A7 — ngan Mo phong MO", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?tab=rf", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  let v = await doVung(page);
  // Ngăn mô phỏng có thể mở bằng nút; thử bấm nếu có.
  const nut = page.locator('[data-testid="nut-mo-phong"], [data-testid="ngan-mo-phong"]');
  if ((await nut.count()) > 0) {
    await nut.first().click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(3_000);
    v = await doVung(page);
  }
  const coNgan = await page.evaluate(
    () => document.querySelector('[data-testid="ngan-mo-phong"]') !== null,
  );
  ra.A7 = { ...v, coNganMoPhong: coNgan };
  console.log(`   [A7] coNganMoPhong=${coNgan} canvas=${JSON.stringify(v.canvas)}`);
  await page.screenshot({ path: ".qa-dot22/A7-mo-phong-720.png" });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 8-9 · 1920×1080 — MẪU SỐ ĐỔI, TỬ SỐ PHẢI ĐỔI THEO (G75)                */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("B1 — /twin mac dinh o 1920x1080", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_1080);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);
  const v = await doVung(page);
  expect(v.canvas?.hien, "1080p PHAI co canh").toBe(true);
  ra.B1 = { ...v, tiLeCanvas: tiLe(v.canvas, VP_1080) };
  console.log(`   [B1] canvas ${v.canvas?.w}x${v.canvas?.h} = ${tiLe(v.canvas, VP_1080)}% vp`);
  console.log(`   [B1] panelTrai=${JSON.stringify(v.panelTrai)}`);
  await page.screenshot({ path: ".qa-dot22/B1-nhamay-1080.png" });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 10 · ★ Z4 — CÂY MỞ, ROLL-UP ĐANG NÓI GÌ ĐÓ                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("Z4 — cay phan cap MO, roll-up hien so THAT", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_1080);
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);

  // ★ Trước khi bấm: DANH SÁCH đang hiện, CÂY chưa. Đây là tiền đề G5 — nếu
  //   cây đã hiện sẵn thì cú bấm dưới đây không chứng minh được gì.
  const truocBam = await doVung(page);
  expect(truocBam.danhSachMay?.hien, "mac dinh PHAI la DANH SACH").toBe(true);
  expect(truocBam.cay, "mac dinh CAY chua duoc dung").toBeNull();

  const moCay = page.locator('[data-testid="mo-cay-phan-cap"]');
  expect(await moCay.count(), "nut chuyen sang cay PHAI co mat").toBeGreaterThan(0);
  await moCay.first().click();
  await page.waitForTimeout(2_500);

  const v = await doVung(page);

  /*
   * ★★★ LOẠI TRỪ NHAU — vế mà bản đầu của Z4 làm SAI (xem docblock chỗ render).
   *   Ghim CẢ HAI chiều: cây hiện **VÀ** danh sách máy biến mất hẳn. Chỉ ghim
   *   vế đầu thì bản hỏng cũ (danh sách bị bóp về h=0 nhưng vẫn trong DOM) vẫn
   *   xanh — đúng thứ nghiệm thu thị giác vừa bắt được bằng mắt.
   */
  expect(v.danhSachMay, "danh sach may PHAI bien mat khi cay hien").toBeNull();
  // ★ Và chỉ còn ĐÚNG MỘT ô lọc trong panel trái (bản đầu có hai, chồng nhau).
  const soOLoc = await page.evaluate(
    () =>
      document.querySelectorAll('[data-testid="panel-trai"] input[type="text"], [data-testid="panel-trai"] input:not([type])')
        .length,
  );
  expect(soOLoc, "panel trai chi duoc co MOT o loc").toBeLessThanOrEqual(1);
  // ★★★ G5 — "cây có mặt" KHÁC "cây có nội dung". Ghim cả hai.
  expect(v.cay?.hien, "cay PHAI hien sau khi mo").toBe(true);
  expect(v.soHangCay, "cay PHAI co hang — cay rong trong y het cay hong").toBeGreaterThan(0);

  // Roll-up: mở hết nhánh bằng phím End rồi đọc badge.
  await page.locator('[role="treeitem"]').first().focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(800);
  const v2 = await doVung(page);

  ra.Z4 = { truoc: v, sau: v2 };
  console.log(`   [Z4] hangCay ${v.soHangCay} -> ${v2.soHangCay} (mo nhanh)`);
  console.log(`   [Z4] badgeMay=${v2.soBadgeMay} badgeCanhBao=${v2.soBadgeCanhBao} badgeMayDau="${v2.badgeMayDau}"`);
  console.log(`   [Z4] cay hop=${JSON.stringify(v2.cay)} danhSachMay=${JSON.stringify(v2.danhSachMay)}`);
  await page.screenshot({ path: ".qa-dot22/Z4-cay-mo-1080.png" });

  // ★ ĐIỀU HƯỚNG: bấm một node LINE phải đổi URL sang `?pv=line:`.
  const nodeLine = page.locator('[data-testid^="node-cay-line:"]').first();
  if ((await nodeLine.count()) > 0) {
    await nodeLine.click();
    await page.waitForTimeout(2_500);
    const url = page.url();
    ra.Z4dieuHuong = url;
    console.log(`   [Z4] bam node line => URL = ${url}`);
    await page.screenshot({ path: ".qa-dot22/Z4-sau-bam-line-1080.png" });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ẢNH 11 · ★★★ CHỖ BỐ CỤC MỚI **CHƯA DÙNG ĐƯỢC** — ghi bằng ảnh, không bằng lời */
/* ═══════════════════════════════════════════════════════════════════════════ */

test("C1 — operator1 thay MAN RONG: canh trong, cay 0 hang (chua duoc gan nha may)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize(VP_720);
  await dangNhap(page, CHI_XEM);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await choCanhSan(page);

  const moCay = page.locator('[data-testid="mo-cay-phan-cap"]');
  if ((await moCay.count()) > 0) {
    await moCay.first().click();
    await page.waitForTimeout(2_000);
  }
  const v = await doVung(page);

  /*
   * ★★★ ĐÂY LÀ MỘT CA **ĐO ĐƯỢC LÀ HỎNG**, và nó được ghim thành test để lần
   *   sau ai vá thì test này đỏ (chứ không lặng lẽ đúng lên).
   *
   *  KHÔNG có hàng nào trong , nên
   *  trả  và MỌI mảng
   * rỗng. Hệ quả người dùng thấy: vào  được (nav cho vào), khung dựng
   * lên, panel/dải/nút đều có — nhưng **cảnh không có máy nào và cây 0 hàng**.
   *
   * ⚠ Đây KHÔNG phải lỗi Z4 và KHÔNG phải lỗi bố cục Đợt 21: đo được rằng cây
   *   rỗng vì DỮ LIỆU rỗng, và cùng lượt hỏi ấy cũng làm cảnh rỗng. Nhưng nó
   *   là chỗ bố cục mới **chưa dùng được với vai này**, nên nó phải nằm trong
   *   báo cáo nghiệm thu chứ không bị lọc ra vì "không phải việc của đợt".
   */
  expect(v.soHangCay, "ghim hien trang: operator1 thay cay RONG").toBe(0);
  ra.C1 = { ...v, ghiChu: "operator1 khong co user_factory_assignments" };
  console.log(`   [C1] operator1: soHangCay=${v.soHangCay} canvas=${JSON.stringify(v.canvas)}`);
  console.log(`   [C1] cayKhoi=${JSON.stringify(v.cayKhoi)} panelTrai=${JSON.stringify(v.panelTrai)}`);
  await page.screenshot({ path: ".qa-dot22/C1-operator1-man-rong-720.png" });
});

test.afterAll(() => {
  fs.writeFileSync(".qa-dot22/do-dot22.json", JSON.stringify(ra, null, 2));
});

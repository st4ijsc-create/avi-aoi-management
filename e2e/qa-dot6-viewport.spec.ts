/**
 * THUONG-3 (Dot 6) — do bbox vs viewport o CA HAI kich thuoc (G18).
 *
 * "Chi trinh duyet moi thay": mot trang tran viewport KHONG lam test unit nao
 * do. Do duoc truoc ban va, tren trinh duyet that:
 *     1366x768  -> innerHeight=768  scrollHeight=845  TRAN 77px
 *     1280x1249 -> innerHeight=1249 scrollHeight=1326 TRAN 77px
 * CUNG mot con so 77px o HAI viewport rat khac nhau => sai lech KHONG phu thuoc
 * chieu cao man hinh, tuc no la mot HANG SO SAI chu khong phai hieu ung cuon:
 * khung bat dau o top=133 nhung CSS chi tru 5rem=80px, cong 24px dem duoi cua
 * <main> (p-6) => 133-80+24 = 77.
 *
 * Sau ban va: TRAN 0px o ca hai, moi dieu khien TRONG khung nhin.
 */
import { test, expect } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-tmp/shot` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     QA_E2E_ANH_DOT6=<thư mục>   npx playwright test e2e/qa-dot6-viewport.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-tmp/shot` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("QA_E2E_ANH_DOT6", ".qa-tmp/shot");

const KICH_THUOC = [
  { ten: "1280x1249", width: 1280, height: 1249 },
  { ten: "1366x768", width: 1366, height: 768 },
];

for (const kt of KICH_THUOC) {
  test(`THUONG-3 — moi dieu khien TRONG khung nhin o ${kt.ten}`, async ({ page }) => {
    await page.setViewportSize({ width: kt.width, height: kt.height });
    const res = await page.request.post("/api/auth/login", {
      data: { username: "engineer1", password: "User@123" },
    });
    console.log(`login status=${res.status()}`);

    await page.goto("/twin");
    await page.waitForTimeout(6000);

    const do_ = await page.evaluate(() => {
      const ids = ["man-twin-van-hanh", "khoi-canh-3d", "ngan-xu-ly", "khoi-tong-quan", "breadcrumb-twin", "dai-line"];
      const out: any = { innerHeight: window.innerHeight, innerWidth: window.innerWidth,
        scrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight, els: {} };
      for (const id of ids) {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        if (!el) { out.els[id] = null; continue; }
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out.els[id] = {
          top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
          overflowY: cs.overflowY,
          canScroll: el.scrollHeight > el.clientHeight + 1,
          trongKhungNhin: r.bottom <= window.innerHeight + 1 && r.top >= -1,
        };
      }
      out.tranDoc = document.documentElement.scrollHeight - window.innerHeight;
      return out;
    });

    console.log(`\n===== ${kt.ten} =====`);
    console.log(`innerHeight=${do_.innerHeight} scrollHeight=${do_.scrollHeight} TRAN DOC=${do_.tranDoc}px`);
    for (const [k, v] of Object.entries(do_.els)) {
      if (!v) { console.log(`  ${k}: (khong co tren man nay)`); continue; }
      const o: any = v;
      console.log(`  ${k}: top=${o.top} bottom=${o.bottom} h=${o.height} overflowY=${o.overflowY} canScroll=${o.canScroll} TRONG_KHUNG=${o.trongKhungNhin}`);
    }
    await page.screenshot({ path: `${taoThuMuc(ANH)}/dot6-viewport-${kt.ten}.png` });

    // TIEU CHI: khong tran doc, va moi dieu khien chinh trong khung nhin.
    expect(do_.tranDoc).toBeLessThanOrEqual(1);
    for (const id of ["man-twin-van-hanh", "khoi-canh-3d", "ngan-xu-ly", "breadcrumb-twin"]) {
      const o: any = do_.els[id];
      if (o) expect(o.trongKhungNhin, `${id} phai TRONG khung nhin`).toBe(true);
    }
  });
}

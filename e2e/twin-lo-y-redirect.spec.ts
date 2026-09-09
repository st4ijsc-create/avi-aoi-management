import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô Y (Đợt 21) — **14 URL CŨ ĐỀU TỚI ĐÍCH**, mỗi cái ≤1 chặng (§13b 14.2.3)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ★★★ VÌ SAO ĐO Ở TẦNG TRÌNH DUYỆT, khi đã có lưới node cho bảng ánh xạ:
 *
 *   `dinhTuyenTwinCu.unit.test.ts` chứng minh **bảng** đúng và **`App.tsx` chứa
 *   đúng chuỗi**. Nhưng cả hai đều là lời khai về MÃ NGUỒN. Cái chưa ai chứng
 *   minh là: gõ URL ấy vào trình duyệt thì **có thật sự tới nơi không** — router
 *   `wouter` có thể khớp nhầm thứ tự, `RouteGuard` có thể chặn trước redirect,
 *   một `<Route>` khác có thể ăn tranh đường. Đó là G16 ở tầng cao nhất: một
 *   bảng không ai đi qua là một bảng chưa xong.
 *
 * ★ Đo bằng vai **KHÔNG-admin** (`e2e_tai_loE`). Admin bypass `requirePermission`
 *   ⇒ mọi redirect sẽ "chạy được" và phép đo chứng minh SỐ 0 về quyền.
 *
 * ⚠ Đây là SPA (`wouter` + `<Redirect>`), nên chặng redirect xảy ra ở **phía
 *   client**, KHÔNG phải bằng HTTP 30x — `response.request().redirectedFrom()`
 *   mà §13b 14.10.B.4 đề nghị sẽ trả `null` cho MỌI đường và làm lưới xanh mà
 *   không đo gì. Nên phép đếm chặng ở đây dùng `history.length` của chính
 *   trang: `<Redirect>` của wouter gọi `replaceState` (không thêm mục lịch sử),
 *   nên một chuỗi hai chặng vẫn cho cùng số. ⇒ Cách đo ĐÚNG cho SPA là khẳng
 *   định **URL cuối** cộng **một `data-testid` đặc trưng của đích**, và khẳng
 *   định URL cuối KHÔNG phải một URL trung gian đã biết (`/digital-twin`).
 */

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

/**
 * 14 đường vào cũ (§13b 14.2.3) + đích mong đợi.
 *
 * `tid` là **dấu vân tay của ĐÍCH** — không có nó, khẳng định "URL đúng" cũng
 * xanh trên một trang 404 đã đổi URL.
 */
const BANG: ReadonlyArray<{ cu: string; urlChua: string; tid: string; ghiChu?: string }> = [
  { cu: "/digital-twin", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/digital-twin?tab=overview", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/digital-twin?tab=center", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/digital-twin?tab=map", urlChua: "/twin", tid: "man-twin-van-hanh" },
  {
    cu: "/digital-twin?tab=floor",
    urlChua: "/twin-studio",
    tid: "man-twin-studio",
    ghiChu:
      "★★★ QĐ-18 (§13c.2) trả đích về /twin-studio — ĐÚNG như §13b đề nghị ban đầu. " +
      "QĐ-16 từng đưa nó vào /twin?che-do=botri; chủ sở hữu đã đảo quyết định ấy.",
  },
  { cu: "/digital-twin?tab=layout", urlChua: "/twin-studio", tid: "man-twin-studio" },
  {
    cu: "/digital-twin?tab=cell",
    urlChua: "/twin",
    tid: "man-twin-van-hanh",
    ghiChu: "★ §13b ghi ?thu=moPhong — SAI, nó ĐÓNG ngăn Mô phỏng (xem dinhTuyenTwinCu.ts)",
  },
  { cu: "/digital-twin?tab=rf", urlChua: "/rf-test-cell", tid: "" },
  { cu: "/factory-live-map", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/factory-floor-editor", urlChua: "/twin-studio", tid: "man-twin-studio" },
  { cu: "/rf-test-cell", urlChua: "/rf-test-cell", tid: "", ghiChu: "★ tuyến THẬT trở lại, 0 chặng" },
  { cu: "/cell-twin", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/digital-twin-center", urlChua: "/twin", tid: "man-twin-van-hanh" },
  { cu: "/layout", urlChua: "/twin-studio", tid: "man-twin-studio" },
];

async function dangNhap(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.status(), "dang nhap non-admin").toBe(200);
}

test("Y-URL — 14 đường vào cũ đều tới đích, không đường nào chết", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await dangNhap(page);

  const bienBan: Array<Record<string, unknown>> = [];
  const hong: string[] = [];

  for (const d of BANG) {
    await page.goto(d.cu, { waitUntil: "domcontentloaded" });
    // Redirect của wouter chạy ở lượt render đầu — cho nó một nhịp, rồi chờ
    // dấu vân tay của đích (không chờ một khoảng thời gian đoán mò).
    await page.waitForTimeout(1_200);
    if (d.tid) {
      await page.waitForSelector(`[data-testid="${d.tid}"]`, { timeout: 60_000 }).catch(() => {});
    }
    const urlCuoi = new URL(page.url()).pathname + new URL(page.url()).search;
    const coTid = d.tid ? (await page.locator(`[data-testid="${d.tid}"]`).count()) > 0 : true;

    // ★ Trang 404 của app — nếu nó hiện, đường ĐÃ CHẾT dù URL trông ổn.
    const la404 = (await page.getByText(/404|not found|khong tim thay/i).count()) > 0;

    const dat = urlCuoi.startsWith(d.urlChua.split("?")[0]) && coTid && !la404;
    // ★★★ LUẬT ≤1 CHẶNG ở tầng trình duyệt: URL cuối KHÔNG được là một URL
    //   trung gian đã biết. Đây là cách đo thay cho `redirectedFrom()` (vô dụng
    //   với SPA — xem docblock đầu tệp).
    const conQuaTrungGian = urlCuoi.startsWith("/digital-twin");

    bienBan.push({ cu: d.cu, urlCuoi, coTid, la404, dat, conQuaTrungGian, ghiChu: d.ghiChu });
    console.log(
      `   [Y-URL] ${d.cu.padEnd(30)} → ${urlCuoi.padEnd(24)} tid=${coTid ? "✓" : "✗"} ${dat ? "ĐẠT" : "TRƯỢT"}`,
    );
    if (!dat) hong.push(`${d.cu} → ${urlCuoi} (tid=${coTid}, 404=${la404})`);
    if (conQuaTrungGian) hong.push(`${d.cu} DUNG LAI o URL trung gian ${urlCuoi}`);
  }

  fs.writeFileSync(".qa-loY/redirect.json", JSON.stringify(bienBan, null, 2));

  // ★ Ca DƯƠNG cho chính thiết bị đo: nếu vòng lặp không chạy, `hong` cũng rỗng.
  expect(bienBan.length, "phai do du 14 duong").toBe(14);
  expect(hong, "moi duong phai toi dich, ≤1 chang").toEqual([]);
});

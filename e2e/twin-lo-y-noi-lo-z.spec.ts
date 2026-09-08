import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Lô Y — **BA CHỖ NỐI CỦA LÔ Z THẬT SỰ SỐNG** (G16 đóng, đo trên trình duyệt)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Lô Z dựng ba module rồi dừng ở ranh giới phạm vi tệp (đúng luật — lô Y giữ
 * độc quyền `TwinVanHanh.tsx`). Hệ quả: `grep -c` ra **0 chỗ gọi**, tức cả ba
 * là **G16 — hàm không ai gọi = chưa xong**. Lô Y nối chúng.
 *
 * ★★★ VÌ SAO CÒN CẦN LƯỚI NÀY khi `grep` đã ra 3 chỗ gọi:
 *   `grep` chứng minh **mã nguồn** có lời gọi. Nó KHÔNG chứng minh lời gọi ấy
 *   chạy: một `useMemo` có thể ném, một truy vấn có thể 403, một prop có thể bị
 *   `undefined` nuốt. Đây đúng khuôn G16 mà sổ đã ghi — và cách duy nhất đóng
 *   nó là **đọc ĐẦU RA trên trang thật**, không đọc mã.
 *
 * ★ Đo bằng vai KHÔNG-admin (`e2e_tai_loE`): admin bypass `requirePermission`,
 *   nên `sucKhoeMay` sẽ trả dữ liệu cho admin kể cả khi cổng quyền hỏng.
 */

/**
 * ★★★ tRPC ở dự án này chạy **httpBatchLink**: một request GET mang NHIỀU thủ
 *   tục, và thân trả về là một **MẢNG** kết quả theo đúng thứ tự tên trong URL
 *   (`/api/trpc/a,b,c?batch=1&input={"0":…,"1":…}`).
 *
 * ⚠ Bản đầu của suite này lọc `url.includes("sucKhoeMay")` rồi đọc
 *   `j.result.data.json` — và ĐỎ. Không phải vì chỗ nối hỏng, mà vì **phép đo
 *   sai**: nó bắt đúng batch nhưng lấy kết quả của thủ tục **thứ nhất** trong
 *   batch (`factoryCommand.overview`), không phải của `sucKhoeMay`. Đúng lớp
 *   G44 — đếm nhầm đơn vị: một *request* ≠ một *thủ tục*.
 *
 * ⇒ Hàm này tách batch: lấy danh sách tên từ path, tìm CHỈ SỐ của thủ tục cần,
 *   rồi đọc đúng phần tử ấy của mảng.
 */
function locTuBatch(url: string, than: string, tenThuTuc: string): unknown | null {
  const path = new URL(url).pathname;
  const danh = decodeURIComponent(path.split("/api/trpc/")[1] ?? "").split(",");
  const i = danh.findIndex((n) => n.endsWith(tenThuTuc));
  if (i < 0) return null;
  let j: unknown;
  try {
    j = JSON.parse(than);
  } catch {
    return null;
  }
  const mang = Array.isArray(j) ? j : [j];
  const o = mang[i] as { result?: { data?: { json?: unknown } } } | undefined;
  return o?.result?.data?.json ?? null;
}

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

async function moTwin(page: Page) {
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.status()).toBe(200);
  await page.goto("/twin", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector("canvas") !== null, null, {
    timeout: 90_000,
  }).catch(() => {});
  await page.waitForTimeout(8_000);
}

test("NỐI-1 — B-3: huy hiệu CƠ CHẾ GIAO SỐ sống, và khai một trong 5 hạng", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await moTwin(page);

  const badge = page.getByTestId("co-che-giao-so");
  await expect(badge, "huy hieu co che phai HIEN").toBeVisible({ timeout: 30_000 });

  const coChe = await badge.getAttribute("data-co-che");
  const HANG = ["day", "hon_hop", "hoi", "lich_su", "chua_ro"];
  expect(HANG, `co che "${coChe}" phai la 1 trong 5 hang cua xuatXuNhip.ts`).toContain(coChe);

  /*
   * ★★★ CA DƯƠNG CHO CHÍNH PHÉP ĐO — `khaiNguonSo` phải THẬT SỰ CHẠY, không
   *   phải render một hằng số. `data-nhip-ms` do `nhipHieuLucMs(coChe)` sinh
   *   ra, nên nó ràng buộc với `coChe`: hạng `lich_su` cho `null`, mọi hạng
   *   khác cho một số. Kiểm ràng buộc đó là kiểm hàm đã chạy.
   */
  const nhip = await badge.getAttribute("data-nhip-ms");
  if (coChe === "lich_su") {
    expect(nhip, "lich_su khong tu lam moi ⇒ nhip rong").toBe("");
  } else if (coChe !== "chua_ro") {
    expect(Number(nhip), "hang song phai co nhip huu han").toBeGreaterThan(0);
  }

  // ★ Huy hiệu CŨ phải còn nguyên — đổi bố cục không được đổi hợp đồng đo.
  await expect(page.getByTestId("trang-thai-ket-noi"), "huy hieu cu PHAI con").toBeVisible();

  console.log(`   [NỐI-1] coChe=${coChe} nhipMs=${nhip} tuoiMs=${await badge.getAttribute("data-tuoi-ms")}`);
  await page.screenshot({ path: ".qa-loY/NOI-1-co-che-giao-so.png" });
});

test("NỐI-2 — A-4: truy vấn sucKhoeMay CHẠY và trả lời khai (đo qua mạng)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });

  /*
   * ★ Đo ở tầng MẠNG, không ở tầng DOM: vòng viền sức khoẻ được vẽ TRONG WebGL
   *   (`LopVienSucKhoe` là InstancedMesh), nên nó **vô hình với mọi selector**.
   *   Một lưới DOM ở đây sẽ luôn xanh và không đo gì — đúng lớp lỗi "đo trên
   *   tập rỗng". Bằng chứng đúng là: truy vấn có chạy, và nó trả lời khai.
   */
  const traLoi: Array<{ url: string; status: number; body: string }> = [];
  page.on("response", async (r) => {
    if (r.url().includes("sucKhoeMay")) {
      traLoi.push({ url: r.url(), status: r.status(), body: await r.text().catch(() => "") });
    }
  });

  await moTwin(page);

  expect(traLoi.length, "truy van sucKhoeMay PHAI duoc goi (G16)").toBeGreaterThan(0);
  const ok = traLoi.find((r) => r.status === 200);
  expect(ok, `sucKhoeMay phai tra 200 (thay: ${traLoi.map((r) => r.status).join(",")})`).toBeTruthy();

  // ★ 200 mà rỗng thì tính năng vẫn chưa sống — đọc SỐ, không đọc mã trạng thái.
  const kq = locTuBatch(ok!.url, ok!.body, "sucKhoeMay") as
    | { khai?: unknown[]; tong?: number; tongMayTrongPhamVi?: number }
    | null;
  expect(kq, "phai tach duoc phan sucKhoeMay trong batch").toBeTruthy();
  const soKhai = Array.isArray(kq!.khai) ? kq!.khai.length : 0;
  console.log(
    `   [NỐI-2] sucKhoeMay 200 · khai=${soKhai} · tong=${kq!.tong} · tongMayTrongPhamVi=${kq!.tongMayTrongPhamVi}`,
  );
  expect(soKhai, "phai co loi khai suc khoe (lo Z do: 43/43 may co hang)").toBeGreaterThan(0);

  fs.writeFileSync(
    ".qa-loY/noi-lo-z.json",
    JSON.stringify({ soKhai, tong: kq!.tong, tongMayTrongPhamVi: kq!.tongMayTrongPhamVi }, null, 2),
  );
});

test("NỐI-3 — A-6: nguồn VÙNG rỗng ⇒ cảnh không vẽ vùng, và đó là ĐÚNG", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });

  const traLoi: Array<{ url: string; body: string }> = [];
  page.on("response", async (r) => {
    if (r.url().includes("canhThietKe")) {
      traLoi.push({ url: r.url(), body: await r.text().catch(() => "") });
    }
  });

  await moTwin(page);

  /*
   * ★★★ LƯỚI NÀY KHẲNG ĐỊNH MỘT SỐ **BẰNG 0**, và nó phải nói rõ vì sao đó
   *   không phải một lưới rỗng vô nghĩa:
   *
   *   Lô Z đo `twin_vat_the` = **4 hàng, toàn `loai='tuong'`, 0 hàng `vung`**.
   *   Nên `vungTuDanhSach` ĐÚNG khi trả mảng rỗng, và cảnh ĐÚNG khi không vẽ
   *   vùng nào. Cái phải chứng minh ở đây không phải "có vùng", mà là **đường
   *   ống có thật**: truy vấn chạy, thân trả về CÓ khoá `vung`, và khoá ấy là
   *   một mảng (không phải `undefined` — `undefined` nghĩa là ta đọc nhầm tên).
   *
   * ⚠ ĐỪNG "sửa" bằng dữ liệu giả. Một vùng an toàn bịa ra là lời khai sai về
   *   chỗ người được đứng — hạng lỗi nặng hơn hẳn một cảnh trống.
   */
  expect(traLoi.length, "truy van canhThietKe phai chay").toBeGreaterThan(0);
  const kq = traLoi
    .map((r) => locTuBatch(r.url, r.body, "canhThietKe") as { vung?: unknown } | null)
    .find((x) => x != null);
  expect(kq, "phai tach duoc phan canhThietKe trong batch").toBeTruthy();
  expect(Array.isArray(kq!.vung), "`vung` phai la MANG (undefined = doc nham ten khoa)").toBe(true);
  console.log(
    `   [NỐI-3] canhThietKe.vung = ${(kq!.vung as unknown[]).length} hang (lo Z do: 0 hang loai='vung')`,
  );
});

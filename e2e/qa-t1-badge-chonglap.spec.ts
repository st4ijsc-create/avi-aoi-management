/**
 * T-1 — ĐO CHỒNG LẤN BADGE CẢNH BÁO trên trình duyệt thật, tài khoản KHÔNG-admin.
 *
 * ★★★ MÔ HÌNH ĐO ĐỘC LẬP VỚI MÃ (luật G11 + BG-127):
 * Spec này KHÔNG đọc `data-so-an` để kết luận. Nó lấy `getBoundingClientRect()`
 * của TỪNG badge trong DOM rồi tự quét mọi cặp — một mô hình rời hẳn thuật toán
 * `locBadge`. Nhờ vậy nó có thể BÁC BỎ mã. `data-so-an` chỉ được đọc để ĐỐI CHIẾU
 * (cổng 5), không phải để phán quyết.
 *
 * ⚠ Badge ngoài khung (`data-ngoai-khung="1"`) bị LOẠI khỏi phép đếm: §10.3 luật 3
 *   yêu cầu chúng bị kẹp về rìa, nên chúng chồng nhau là hành vi ĐÚNG.
 */
import { test, expect } from "@playwright/test";

test("T1 — badge canh bao KHONG con cap chong lap (bbox DOM that)", async ({ page }) => {
  const res = await page.request.post("/api/auth/login", {
    data: { username: "engineer1", password: "QaT1Eng!2026" },
  });
  expect(res.status()).toBe(200);

  await page.goto("/twin");
  await page.waitForTimeout(8000);

  const doDuoc = await page.evaluate(() => {
    const lop = document.querySelector('[data-testid="lop-canh-bao"]');
    const badges = Array.from(document.querySelectorAll('[data-testid^="badge-canh-bao-"]'));
    const hop = badges.map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return {
        id: el.getAttribute("data-testid"),
        ngoaiKhung: el.getAttribute("data-ngoai-khung") === "1",
        muc: el.getAttribute("data-muc"),
        trai: r.left, phai: r.right, tren: r.top, duoi: r.bottom,
        rong: r.width, cao: r.height,
        chu: (el.textContent ?? "").trim(),
      };
    });
    // Chỉ đếm cặp giữa badge TRONG khung.
    const tk = hop.filter((h) => !h.ngoaiKhung);
    const capChong: string[] = [];
    for (let i = 0; i < tk.length; i++) {
      for (let j = i + 1; j < tk.length; j++) {
        const a = tk[i], b = tk[j];
        // Chồng thật sự: giao nhau trên CẢ HAI trục (hình chữ nhật, không bán kính).
        if (a.trai < b.phai && b.trai < a.phai && a.tren < b.duoi && b.tren < a.duoi) {
          capChong.push(`${a.id}<>${b.id}`);
        }
      }
    }
    return {
      soBadge: hop.length,
      soTrongKhung: tk.length,
      soNgoaiKhung: hop.length - tk.length,
      soCapChong: capChong.length,
      capChong,
      soAnKhaiBoiMa: lop?.getAttribute("data-so-an") ?? null,
      soBadgeKhaiBoiMa: lop?.getAttribute("data-so-badge") ?? null,
      cuaSoDo: (window as unknown as { __demBadge?: unknown }).__demBadge ?? null,
      hop,
    };
  });

  console.log("DO-BBOX-DOM " + JSON.stringify(doDuoc, null, 2));
  await page.screenshot({ path: ".qa-tmp/shot/t1-badge.png", fullPage: false });

  // Phép đo phải chứng minh được cái gì đó: nếu 0 badge thì nó chứng minh SỐ 0.
  expect(doDuoc.soBadge, "phai co badge de do — neu 0 thi phep do chung minh SO 0").toBeGreaterThan(0);
  expect(doDuoc.soCapChong, `cap con chong: ${doDuoc.capChong.join(", ")}`).toBe(0);
});

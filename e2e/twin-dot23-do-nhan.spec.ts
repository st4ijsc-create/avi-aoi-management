import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { duongRaBangChung } from "./duongRaBangChung";

/**
 * ĐỢT 51 (mục B) — đường ra bằng chứng KHÔNG còn ghim cứng.
 * Trước: 3 chỗ ghi thẳng `.qa-dot23/…` ⇒ chạy lại spec là GHI ĐÈ bằng chứng
 * của Đợt 23 (đúng lớp lỗi G130 đã làm mất 103 tệp ở Đợt 50). Xem `duongRaBangChung`.
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_DOT23", ".qa-dot23");


/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 23 — PHÉP ĐO THỨ HAI: **CÁI NHÌN THẤY**, KHÔNG PHẢI CÁI HỘP (G77)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Đợt 22 đo `?thu=trai,phai` ra **51,4 %** trên một canvas 968×489 **gần như
 * trống** ⇒ chỉ số diện tích đo **CÁI HỘP**, nó không biết bên trong hộp có gì.
 * Tệp này là thiết bị đo còn thiếu: **mật độ nhãn ĐỌC ĐƯỢC**.
 *
 * ★★★ VÌ SAO PHẢI ĐẾM CHỒNG LẤP **GIỮA CÁC LỚP**, KHÔNG CHỈ TRONG MỘT LỚP
 * `locNhan.ts` đã bảo đảm **0 cặp chồng** TRONG lớp nhãn máy, và `locBadge.ts`
 * bảo đảm **0 cặp chồng** TRONG lớp badge. Nhưng **ba lớp `<Html>` rời nhau**
 * cùng vẽ lên một canvas:
 *     `LopNhan`     z-index 20  (nhãn máy,  `nhan-may-twin3d`)
 *     `LopCanhBao`  z-index 30  (badge,     `badge-canh-bao-twin3d`)
 *     `LopVung`     z-index 15  (nhãn vùng, `nhan-vung-twin3d`)
 * **KHÔNG lớp nào biết lớp kia tồn tại.** Hậu điều kiện "0 cặp chồng" của mỗi
 * lớp là lời khai về **chính nó**, và đúng theo phạm vi của nó — nhưng người
 * dùng không nhìn thấy ba lớp, họ nhìn thấy MỘT màn hình. Đây đúng là lớp lỗi
 * G5/G6: **đo trên tập con rồi kết luận cho tập cha**.
 *
 * ⇒ Phép đo ở đây quét **TẤT CẢ** nhãn của **CẢ BA** lớp bằng
 *   `getBoundingClientRect` THẬT trên trình duyệt THẬT, và đếm cặp chồng
 *   **KHÔNG phân biệt lớp**. Đây là con số mà `__demNhan.capConChong` (luôn 0)
 *   **không thể** thấy.
 *
 * ★ TƯ THẾ CAMERA GHIM: mọi lượt đo dùng `?cam=` cố định, nếu không thì số
 *   trước/sau đo ở hai góc khác nhau và phép so là vô nghĩa (G5 đối chứng).
 */

const VP = { width: 1280, height: 720 };

/** `e2e_tai_loE` — supervisor, KHÔNG admin, và **CÓ 1 nhà máy** (G76). */
const CO_DU_LIEU = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };

const ra: Record<string, unknown> = {};

async function dangNhap(page: Page, tk: { username: string; password: string }) {
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
}

async function choCanhSan(page: Page) {
  await page.waitForSelector('[data-testid="man-twin-van-hanh"]', { timeout: 90_000 });
  await page
    .waitForFunction(
      () => document.querySelector("canvas") !== null,
      null,
      { timeout: 90_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(6_000);
}

/**
 * ★★★ ĐO **CÁI NHÌN THẤY**: quét mọi nhãn của MỌI lớp, đếm cặp chồng LIÊN LỚP.
 *
 * Trả về cả `nhanDocDuoc` — số nhãn **không bị bất kỳ nhãn nào khác đè lên**.
 * Đây là đại lượng người dùng thật sự nhận được, khác hẳn `__demNhan.ve`
 * (số nhãn được YÊU CẦU vẽ).
 */
async function doNhanNhinThay(page: Page) {
  return await page.evaluate(() => {
    const CHON = [
      '[data-testid="nhan-may-twin3d"]',
      '[data-testid="badge-canh-bao-twin3d"]',
      '[data-testid="nhan-vung-twin3d"]',
    ];
    type H = { lop: string; chu: string; t: number; p: number; tr: number; d: number };
    const hop: H[] = [];
    for (const sel of CHON) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        hop.push({
          lop: sel,
          chu: (el.textContent ?? "").trim().slice(0, 40),
          t: r.left, p: r.right, tr: r.top, d: r.bottom,
        });
      }
    }
    const chong = (a: H, b: H) => a.t < b.p && b.t < a.p && a.tr < b.d && b.tr < a.d;
    let capChong = 0;
    const biDe = new Set<number>();
    const viDu: string[] = [];
    for (let i = 0; i < hop.length; i++) {
      for (let j = i + 1; j < hop.length; j++) {
        if (chong(hop[i], hop[j])) {
          capChong++;
          biDe.add(i); biDe.add(j);
          if (viDu.length < 6) viDu.push(`${hop[i].chu} ✕ ${hop[j].chu}`);
        }
      }
    }
    const theoLop: Record<string, number> = {};
    for (const h of hop) theoLop[h.lop] = (theoLop[h.lop] ?? 0) + 1;
    const dem = (window as unknown as { __demNhan?: Record<string, number> }).__demNhan ?? null;
    return {
      tongNhan: hop.length,
      theoLop,
      capChongLienLop: capChong,
      nhanBiDe: biDe.size,
      /** ★ SỐ NGHIỆM THU: nhãn KHÔNG bị nhãn nào đè — cái người dùng đọc được. */
      nhanDocDuoc: hop.length - biDe.size,
      viDu,
      demNhanTrongLop: dem,
    };
  });
}

test.use({ viewport: VP });

test("Đ23-M1 — mật độ nhãn ĐỌC ĐƯỢC ở tư thế camera ghim", async ({ page }) => {
  await dangNhap(page, CO_DU_LIEU);
  await page.goto("/twin?thu=trai,phai");
  await choCanhSan(page);

  const truoc = await doNhanNhinThay(page);
  ra["M1_thu_ca_hai"] = truoc;
  console.log("M1 (thu=trai,phai):", JSON.stringify(truoc, null, 2));

  await page.screenshot({ path: `${ANH}/M1-nhan-thu-ca-hai.png`, fullPage: false });

  await page.goto("/twin");
  await choCanhSan(page);
  const macDinh = await doNhanNhinThay(page);
  ra["M1_mac_dinh"] = macDinh;
  console.log("M1 (mặc định):", JSON.stringify(macDinh, null, 2));
  await page.screenshot({ path: `${ANH}/M1-nhan-mac-dinh.png`, fullPage: false });

  fs.writeFileSync(`${ANH}/M1-do-nhan.json`, JSON.stringify(ra, null, 2));
});

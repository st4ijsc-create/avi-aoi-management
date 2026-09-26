import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — smoke suite (Sprint S1 Q1).
 * Base URL configurable qua PLAYWRIGHT_BASE_URL (mặc định http://localhost:3000).
 * Khi chạy CI, đặt PLAYWRIGHT_BASE_URL trỏ tới server đã build/khởi động.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

const THU_MUC_E2E = join(dirname(fileURLToPath(import.meta.url)), "e2e");

/**
 * ★★★ ĐỢT 59 (mục D · G147) — **SỐ WORKER LÀ MỘT PHẦN CỦA PHÉP ĐO, KHÔNG PHẢI TUỲ CHỌN.**
 *
 * Đợt 58 chạy `twin-dot47-bam-canh` **không đặt `--workers`** ⇒ Playwright lấy **12 worker** ⇒
 * 12 trình duyệt WebGL cùng lúc ⇒ `waitForSelector` 90 s hết giờ, `soNhan=0` ⇒ **7/16 ĐỎ OAN**.
 * Cùng bản dựng, `--workers=1` ⇒ **16/16 XANH**. Tức cùng một mã nguồn cho hai phán quyết trái
 * ngược, và thứ quyết định KHÔNG nằm trong mã: nó nằm ở dòng lệnh người chạy gõ. Một tiêu chí
 * nghiệm thu mà kết quả phụ thuộc dòng lệnh thì **không tái lập được** — đúng lớp lỗi
 * "cửa sổ cố định dưới tải song song" đã đặt tên từ Đợt 30.
 *
 * ⇒ Đưa ràng buộc ấy VÀO CẤU HÌNH, để `npx playwright test <spec>` trần cũng đúng.
 *
 * ★ **BẤT BIẾN, KHÔNG DANH SÁCH.** Ranh giới không phải "17 tệp tôi liệt kê hôm nay" mà là
 *   *"spec nào lái một canvas WebGL"* — đọc thẳng từ nội dung spec. Một spec 3D MỚI vào thư mục
 *   `e2e/` tự động rơi đúng ngăn; một danh sách cứng thì lặng lẽ bỏ sót nó (G24/G110).
 * ★ Hai project **rời nhau** (`testIgnore` ↔ `testMatch` cùng một tập) ⇒ tổng số ca `--list`
 *   KHÔNG đổi: **151 ca / 30 tệp** trước và sau (đo Đợt 59).
 * ★ `workers` toàn cục = kích thước DÀN; `workers` của project = TRẦN cho project ấy. Spec
 *   không-3D vẫn chạy song song bằng cả dàn. `fullyParallel: true` giữ nguyên — nó nói về THỨ TỰ
 *   trong một tệp, không nói về số tiến trình.
 * ★ ĐO ĐƯỢC (Đợt 59), cả ba chiều, trên cùng bản dựng `dist-AC` + server 3059:
 *     cấu hình này, KHÔNG cờ            → "Running 16 tests using 1 worker"  → **16/16 XANH**
 *     cấu hình này, `--workers=12`      → "…using 1 worker" (trần KHÔNG dỡ được) → **16/16 XANH**
 *     cấu hình NỀN (1 project, 0 trần)  → "…using 12 workers"                → **4 ĐỎ OAN / 16**
 *   (`.qa-dot59/HQ-bamcanh-{mac-dinh,w12,nen}.log` · `.qa-dot59/pw-nen.config.ts`)
 */
const specCanh3D = readdirSync(THU_MUC_E2E)
  .filter((ten) => ten.endsWith(".spec.ts"))
  // "lái canvas WebGL" = có nhắc `canvas` trong mã spec; đó là thứ khiến 12 ngữ cảnh song song chết.
  .filter((ten) => readFileSync(join(THU_MUC_E2E, ten), "utf8").includes("canvas"))
  // Glob (không RegExp): tên tệp spec chỉ có chữ/số/`-`/`.`, mà trong glob dấu `.` là chữ thường — 0 ký tự phải thoát.
  .map((ten) => `**/${ten}`);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  /**
   * ★★★ ĐỢT 55 (C) — `outputDir` PHẢI NÓI RA, vì mặc định của Playwright là `test-results/`
   * và **Playwright DỌN SẠCH `outputDir` mỗi lượt chạy** (đúng G65 mà 5 config riêng của
   * các lô V/W/X/Y và Đợt 22/23 đã ghi). Cấu hình GỐC này lại là cái duy nhất chưa đặt.
   *
   * ĐO ĐƯỢC, không suy đoán (Đợt 55): đặt một tệp `sentinel.txt` vào một thư mục rồi chạy
   * `npx playwright test <spec> --output=<thư mục ấy>` ⇒ **sentinel BIẾN MẤT**. Nghĩa là
   * `npm run test:e2e` ở HEAD sẽ **xoá 5 ảnh lô C ĐÃ COMMIT trong `test-results/`** — đúng
   * lớp lỗi G130 đã làm mất 103 tệp ở Đợt 50, chỉ khác là lần này nó nằm trong config.
   * Lý do nó chưa nổ: `test:e2e` toàn bộ **chưa ai chạy** (sổ nợ Đợt 55, mục D).
   */
  outputDir: ".qa-pw-output",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      /** Spec KHÔNG lái canvas WebGL — chạy song song như cũ (không đổi một dòng hành vi nào). */
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: specCanh3D,
    },
    {
      /**
       * ★ Đợt 59 (D) — spec lái canvas WebGL: **trần 1 worker**, kể cả khi người chạy quên `--workers`.
       *   Chạy riêng nhóm này: `npm run test:e2e:canh-3d` (= `--project=chromium-canh-3d`).
       */
      name: "chromium-canh-3d",
      use: { ...devices["Desktop Chrome"] },
      testMatch: specCanh3D,
      workers: 1,
    },
  ],
});

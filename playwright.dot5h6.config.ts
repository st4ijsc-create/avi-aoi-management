import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * doc 81 Đợt 5 H6 (mục 10) — cấu hình RIÊNG cho e2e "lệnh DỪNG OT bị từ chối hiện câu đã dịch".
 *
 *   npx playwright test --config=playwright.dot5h6.config.ts
 *
 * globalSetup (e2e/dot5-h6/global-setup.ts) tự dựng instance TỪ MÃ NGUỒN trên CỔNG RIÊNG (H6_SERVER_PORT 3046 /
 * H6_VITE_PORT 5206), DB `aoi_management_test` CHỈ, gieo + dọn dữ liệu của chính nó (tiền tố h6e2e_) và ghi báo cáo
 * (đếm trước/sau, cổng sau khi tắt) vào outputDir. Không bao giờ :3000, không bao giờ dev DB.
 * outputDir `.qa-dot5h6/` (đã gitignore theo mẫu `.qa-*` của .gitignore) — ảnh/trace TẮT; không gì ở đây được commit.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "dot5-h6-ot-stop-refusal.spec.ts",
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  // H6_OUT_DIR (vd thư mục scratch) ⇒ MỌI đầu ra (báo cáo + pw-output) ở đó; mặc định `.qa-dot5h6/`.
  outputDir: process.env.H6_OUT_DIR ? path.join(process.env.H6_OUT_DIR, "pw-output") : ".qa-dot5h6/pw-output",
  globalSetup: "./e2e/dot5-h6/global-setup.ts",
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

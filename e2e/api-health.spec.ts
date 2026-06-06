import { test, expect } from "@playwright/test";

/**
 * Smoke: API health & external integration surface.
 * Không cần đăng nhập — kiểm tra server còn sống và endpoint công khai phản hồi.
 */
test.describe("API smoke", () => {
  test("GET /health trả về trạng thái ok", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Health endpoint trả diagnostics; tối thiểu phải có trường status.
    expect(body).toHaveProperty("status");
  });

  test("GET /api/oauth/providers trả danh sách provider (external API)", async ({ request }) => {
    const res = await request.get("/api/oauth/providers");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Có thể là mảng hoặc object bao providers; chỉ cần phản hồi JSON hợp lệ.
    expect(body).toBeTruthy();
  });
});

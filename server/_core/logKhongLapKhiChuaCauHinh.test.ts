/**
 * logKhongLapKhiChuaCauHinh.test.ts — **MỘT SỰ THẬT TĨNH CHỈ ĐƯỢC IN MỘT LẦN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐƯỢC GHIM — ĐO TRÊN ĐĨA, KHÔNG PHẢI SUY LUẬN
 * ════════════════════════════════════════════════════════════════════════════
 * 2026-09-21: `dist/e2e-3000.err.log` đạt **827 MB** và vẫn phình. Trong **2.000 dòng cuối**
 * có **1.000 dòng** đúng một câu:
 *
 *     [Notification] Notification service URL is not configured; skipping notifyOwner call.
 *
 * Nguồn: `offlineMonitor` chạy **mỗi 60 giây**, gọi `notifyOwner` cho **từng** máy offline
 * (~1.700 máy vì nhịp tim đã cũ). `notifyOwner` trả `false` ⇒ `markOfflineNotificationSent`
 * **không** chạy ⇒ chu kỳ sau lặp lại **toàn đội**. Hai dòng mỗi máy mỗi phút, vĩnh viễn.
 *
 * ★ Hậu quả không chỉ là đĩa. Một log **100 % nhiễu là một log không ai đọc** — dự án này đã
 *   học đúng bài ấy hai lần ở `BUILD-INFO` (*"một cảnh báo LUÔN kêu thì không ai nghe"*).
 *
 * ★ Và "chưa cấu hình" là một sự thật **TĨNH**: nó không đổi giữa hai lượt gọi. In lại là nhân
 *   bản một thứ đã biết.
 *
 * ⚠ Ca này ghim **một lần**, KHÔNG ghim **không lần nào**: im hẳn là giấu một khoảng trống cấu
 *   hình có thật. Ranh giới đúng là *nói một lần, rồi thôi*.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Không có URL/API key ⇒ đi đúng nhánh "chưa cấu hình". */
vi.mock("./env", () => ({ ENV: { forgeApiUrl: "", forgeApiKey: "" } }));

describe("★★★ cảnh báo 'chưa cấu hình' chỉ in MỘT LẦN cho mỗi tiến trình", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("★★★ 200 lượt gọi ⇒ ĐÚNG MỘT dòng cảnh báo (trước bản vá là 200)", async () => {
    const { notifyOwner } = await import("./notification");
    for (let i = 0; i < 200; i += 1) {
      await notifyOwner({ title: `t${i}`, content: `c${i}` });
    }
    const dong = warn.mock.calls.filter((c) => String(c[0]).includes("[Notification]"));
    expect(dong).toHaveLength(1);
  });

  it("★★★ ĐỐI CHỨNG: nó KHÔNG im hẳn — vẫn nói đúng một lần", async () => {
    // Nếu ca trên xanh vì cảnh báo bị xoá sạch thì nó xanh một cách vô nghĩa.
    const { notifyOwner } = await import("./notification");
    await notifyOwner({ title: "t", content: "c" });
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("[Notification]"))).toHaveLength(1);
  });

  it("★★★ và mỗi lượt gọi vẫn trả `false` — không giấu việc KHÔNG gửi được", async () => {
    // Im lặng về log là một chuyện; nói dối về kết quả gửi lại là chuyện khác hẳn.
    const { notifyOwner } = await import("./notification");
    expect(await notifyOwner({ title: "t", content: "c" })).toBe(false);
    expect(await notifyOwner({ title: "t", content: "c" })).toBe(false);
  });

  it("★★★ `notificationConfigured()` nói thật khi thiếu cấu hình", async () => {
    // Đây là thứ cho `offlineMonitor` quyết định MỘT LẦN mỗi chu kỳ thay vì một lần mỗi máy.
    const { notificationConfigured } = await import("./notification");
    expect(notificationConfigured()).toBe(false);
  });
});

describe("★★★ `offlineMonitor` hỏi một lần mỗi CHU KỲ, không một lần mỗi MÁY", () => {
  it("★★★ chỗ gọi phải gác bằng `coTheGui`, và chỉ ghi lỗi-từng-máy khi CÓ cấu hình", async () => {
    /*
     * ⚠ G93 — đột biến ở CHỖ GỌI sống sót mọi ca kiểm của module `notification`.
     *   `notifyOwner` có thể im lặng hoàn hảo mà `offlineMonitor` vẫn ghi một dòng
     *   "Failed to send notification for machine X" cho **từng** máy — tức vẫn 1.700
     *   dòng mỗi phút. Nên ca này ghim chính chỗ gọi.
     */
    const { docMaNguon } = await import("@shared/testing/docMaNguon");
    const { resolve } = await import("node:path");
    const ma = docMaNguon(resolve(__dirname, "offlineMonitor.ts"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(ma).toContain("const coTheGui = notificationConfigured();");
    // Bỏ hẳn bước gửi khi chưa cấu hình — không gọi rồi mới bỏ.
    expect(ma).toContain("const notificationSent = !coTheGui ? false : await notifyOwner({");
    // Dòng lỗi từng máy CHỈ khi dịch vụ có cấu hình mà vẫn hỏng — đó mới là tin.
    expect(ma).toContain("} else if (coTheGui) {");
    // Và một dòng TỔNG cho cả chu kỳ.
    expect(ma).toMatch(/skipping \$\{unnotifiedMachines\.length\} owner notification/);
  });
});

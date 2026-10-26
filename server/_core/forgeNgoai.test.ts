/**
 * ★ Đợt 10.3 (§12, backlog forge) — `BUILT_IN_FORGE_API_URL` RỖNG ⇒ 0 lời gọi mạng từ mọi điểm dùng forge (sinh ảnh, chuyển giọng
 * nói, dataApi, bản đồ, thông báo, kho tệp chế độ forge); đặt URL ⇒ cảnh báo khởi động một lần.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { canhBaoForgeKhiKhoiDong, forgeNgoaiBat, __datLaiCanhBaoForgeChoTest } from "./forgeNgoai";

const cu = { url: ENV.forgeApiUrl, key: ENV.forgeApiKey };
const goi: unknown[] = [];
beforeAll(() => {
  vi.stubGlobal("fetch", vi.fn(async (...a: unknown[]) => (goi.push(a), new Response("{}", { status: 200 }))));
});
afterEach(() => {
  ENV.forgeApiUrl = cu.url;
  ENV.forgeApiKey = cu.key;
  __datLaiCanhBaoForgeChoTest();
});
afterAll(() => vi.unstubAllGlobals());

describe("forge RỖNG ⇒ 0 lời gọi mạng", () => {
  it("mọi điểm dùng forge từ chối / trả lỗi cấu hình mà KHÔNG gọi fetch (kể cả khi có khoá)", async () => {
    ENV.forgeApiUrl = "";
    ENV.forgeApiKey = "khoa-gia";
    const cuMode = process.env.STORAGE_MODE;
    delete process.env.STORAGE_MODE; // mặc định "forge"
    try {
      const { generateImage } = await import("./imageGeneration");
      const { transcribeAudio } = await import("./voiceTranscription");
      const { callDataApi } = await import("./dataApi");
      const { notifyOwner, notificationConfigured } = await import("./notification");
      const { makeRequest } = await import("./map");
      const { storagePut, storageGet } = await import("../storage");
      const loi = (p: Promise<unknown>) => p.then((v) => v, (e: unknown) => e);
      await loi(generateImage({ prompt: "x" }));
      expect(await transcribeAudio({ audioUrl: "https://example.com/a.mp3" })).toMatchObject({ code: "SERVICE_ERROR" });
      await loi(callDataApi("Youtube/search"));
      expect(notificationConfigured()).toBe(false);
      await loi(notifyOwner({ title: "t", content: "c" }));
      await loi(makeRequest("/maps/api/geocode/json"));
      await loi(storagePut("a/b.txt", "x"));
      await loi(storageGet("a/b.txt"));
      expect(goi).toEqual([]);
      // đối chứng: CÙNG điểm gọi với URL đặt ⇒ fetch giả THẬT SỰ bị gọi (lưới không mù)
      ENV.forgeApiUrl = "https://forge.example.com/";
      await loi(callDataApi("Youtube/search"));
      await loi(generateImage({ prompt: "x" }));
      expect(goi.length).toBeGreaterThanOrEqual(2);
    } finally {
      if (cuMode === undefined) delete process.env.STORAGE_MODE;
      else process.env.STORAGE_MODE = cuMode;
    }
  });
});

describe("cảnh báo khởi động", () => {
  it("rỗng ⇒ không cảnh báo; đặt ⇒ cảnh báo MỘT lần, nêu host + §12", () => {
    const ghi: string[] = [];
    expect(canhBaoForgeKhiKhoiDong({ forgeApiUrl: "" }, (s) => ghi.push(s))).toBe(false);
    expect(forgeNgoaiBat({ forgeApiUrl: "  " })).toBe(false);
    expect(canhBaoForgeKhiKhoiDong({ forgeApiUrl: "https://forge.example.com/api" }, (s) => ghi.push(s))).toBe(true);
    expect(canhBaoForgeKhiKhoiDong({ forgeApiUrl: "https://forge.example.com/api" }, (s) => ghi.push(s))).toBe(false);
    expect(ghi).toHaveLength(1);
    expect(ghi[0]).toContain("forge.example.com");
    expect(ghi[0]).toContain("§12");
  });
});

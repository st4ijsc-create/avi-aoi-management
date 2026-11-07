import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { anBongBongTrenTuyen, TUYEN_AN_BONG_BONG, TUYEN_CO_NUT_DUNG } from "./bongBongTheoTuyen";

describe("Đợt 45 mục 1 — bong bóng chat ẩn trên họ tuyến twin", () => {
  it.each(["/twin", "/twin/line/2", "/twin/may/14", "/twin-studio", "/twin?pv=tang:28", "/ai-chat", "/andon", "/andon/wall"])(
    "ẩn ở %s",
    (d) => expect(anBongBongTrenTuyen(d)).toBe(true),
  );
  it.each(["/", "/dashboard", "/machine/14", "/factory-command", "/command-center", "/twinkle", "/settings"])(
    "CÒN ở %s (đo một tuyến ngoài twin trước/sau — không ẩn oan)",
    (d) => expect(anBongBongTrenTuyen(d)).toBe(false),
  );
  it.each([
    "/scada/diag",
    "/scada/config/channels",
    "/scada/journal",
    "/scada",
    "/command-console",
    "/line-view",
    "/line-view/3",
    "/giam-sat/may/12",
    "/ky-thuat/an-toan",
  ])("★ C0-2 — ẩn ở %s (tuyến có nút DỪNG MÁY)", (d) => expect(anBongBongTrenTuyen(d)).toBe(true));
  it.each(["/command-center", "/ky-thuat", "/ky-thuat/lap-trinh", "/scadabrowser-fake", "/line", "/machine/14"])(
    "★ C0-2 — CÒN ở %s (không ẩn oan tuyến gần giống)",
    (d) => expect(anBongBongTrenTuyen(d)).toBe(false),
  );
  it("★ C0-2 — mọi tuyến trong TUYEN_CO_NUT_DUNG đều nằm trong danh sách ẩn", () => {
    for (const t of TUYEN_CO_NUT_DUNG) expect(TUYEN_AN_BONG_BONG).toContain(t);
  });
  it("hai tuyến cũ (/ai-chat, /andon) vẫn nằm trong danh sách — không mất luật khi gom", () => {
    expect(TUYEN_AN_BONG_BONG).toContain("/ai-chat");
    expect(TUYEN_AN_BONG_BONG).toContain("/andon");
  });
  it("★ G16 — `AILocalChatBubble` GỌI vị từ này (không còn `startsWith` rời)", () => {
    const src = readFileSync(new URL("../components/AILocalChatBubble.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/anBongBongTrenTuyen\(location\)/);
    expect(src).not.toMatch(/location\.startsWith\("\/ai-chat"\)/);
    expect(src).not.toMatch(/location\.startsWith\("\/andon"\)/);
  });
});

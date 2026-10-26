/**
 * SCADA R1b-2b-1 Task 9 (mục 44) — `ghiSoCoHan`: một lượt ghi sổ trên đường trả lời của STOP HMI chờ tối đa `HAN_GHI_SO_STOP_HMI_MS`.
 *
 * Điều kiện điều phối C3: lượt ghi bị BỎ RƠI sau 500 ms mà ném MUỘN không được thành `unhandledRejection` (mặc định Node: sập tiến trình) —
 * và lỗi muộn đó phải được `ghiLoiChot` log (sổ thiếu dòng phải để lại dấu). Đo bằng `process.on("unhandledRejection")` (gỡ ở afterEach) +
 * spy `logger.error` (thân của `ghiLoiChot`). Đồng hồ THẬT (hạn 500 ms, ném lúc 800 ms — đúng kịch bản C3).
 * Đột biến bắt buộc: bỏ handler lỗi gắn vào `p` trong `ghiSoCoHan` ⇒ ca "ném muộn" ĐỎ (unhandledRejection + thiếu log lỗi muộn).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../logger";
import { ghiSoCoHan, HAN_GHI_SO_STOP_HMI_MS } from "./lenhHmi";

const ngu = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nemSau = (ms: number, msg: string) => new Promise<never>((_, j) => setTimeout(() => j(new Error(msg)), ms));
const xongSau = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let khongXuLy: unknown[] = [];
const nghe = (e: unknown) => void khongXuLy.push(e);
let loiLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  khongXuLy = [];
  process.on("unhandledRejection", nghe);
  loiLog = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
});
afterEach(() => {
  process.off("unhandledRejection", nghe);
  loiLog.mockRestore();
});

/** các lần ghiLoiChot (logger.error với `cho`) — [cho, err] */
const lanGhiLoiChot = () =>
  loiLog.mock.calls
    .map((c) => c[0] as { cho?: string; err?: string; requestId?: string })
    .filter((o) => typeof o?.cho === "string")
    .map((o) => ({ cho: o.cho, err: o.err, requestId: o.requestId }));

describe("R1b-2b-1 T9 — ghiSoCoHan", () => {
  it("hằng đúng giá trị brief", () => {
    expect(HAN_GHI_SO_STOP_HMI_MS).toBe(500);
  });

  it("xong trong hạn ⇒ trả ngay khi xong (không chờ hết hạn); không log", async () => {
    const t0 = Date.now();
    await ghiSoCoHan(xongSau(30), "x", "r1");
    const troi = Date.now() - t0;
    expect(troi).toBeGreaterThanOrEqual(25);
    expect(troi).toBeLessThan(HAN_GHI_SO_STOP_HMI_MS);
    expect(lanGhiLoiChot()).toEqual([]);
  });

  it("lỗi trong hạn ⇒ KHÔNG ném, ghiLoiChot(nhãn gốc)", async () => {
    await expect(ghiSoCoHan(nemSau(20, "ECONNRESET giả"), "attempts_hmi_stop", "r2")).resolves.toBeUndefined();
    expect(lanGhiLoiChot()).toEqual([{ cho: "attempts_hmi_stop", err: "ECONNRESET giả", requestId: "r2" }]);
  });

  it("★ C3: treo ⇒ trả sau ~500 ms; ném MUỘN lúc 800 ms ⇒ 0 unhandledRejection, ghiLoiChot log CẢ quá hạn lẫn lỗi muộn", async () => {
    const t0 = Date.now();
    await ghiSoCoHan(nemSau(800, "ghi muộn hỏng"), "attempts_hmi_stop_chua_ghim", "-");
    const troi = Date.now() - t0;
    // cận dưới: không bao giờ trả SỚM hơn hạn (hẹn giờ không bắn sớm). Cận trên là lưới DB (doLagBucleSuKien) — ở đây chỉ chặn "chờ tới 800".
    expect(troi).toBeGreaterThanOrEqual(HAN_GHI_SO_STOP_HMI_MS - 5);
    expect(troi).toBeLessThan(800);
    expect(lanGhiLoiChot().map((x) => x.cho)).toEqual(["attempts_hmi_stop_chua_ghim_qua_han"]);

    await ngu(500); // qua mốc 800 ms + vài nhịp để Node phát unhandledRejection nếu có
    expect(khongXuLy).toEqual([]);
    expect(lanGhiLoiChot()).toEqual([
      expect.objectContaining({ cho: "attempts_hmi_stop_chua_ghim_qua_han" }),
      { cho: "attempts_hmi_stop_chua_ghim_muon", err: "ghi muộn hỏng", requestId: "-" },
    ]);
  });

  it("treo vĩnh viễn ⇒ trả sau hạn, hẹn giờ không giữ gì (không ném, không unhandledRejection)", async () => {
    const t0 = Date.now();
    await ghiSoCoHan(new Promise(() => undefined), "hmi_stop_sau_dispatch", "r3");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(HAN_GHI_SO_STOP_HMI_MS - 5);
    expect(lanGhiLoiChot().map((x) => x.cho)).toEqual(["hmi_stop_sau_dispatch_qua_han"]);
    expect(khongXuLy).toEqual([]);
  });
});

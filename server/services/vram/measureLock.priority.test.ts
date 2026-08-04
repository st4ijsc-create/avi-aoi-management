/**
 * ★★★ Pha 2B Task 5 — CỔNG 2: hàng chờ của khoá cửa sổ đo BIẾT ƯU TIÊN.
 *
 * Trước task này hàng chờ là **FIFO thuần**: một lượt kiểm AOI mức `production` xếp sau một việc
 * nền, tối đa **180 s** (ngân sách chờ mặc định). Đây là đảo ngược ưu tiên ĐANG CHẠY, không phải
 * rủi ro tương lai.
 *
 * ⚠⚠ Và đây là lý do nửa sau của file này tồn tại: **ưu tiên trong hàng chờ DỄ GÂY CHẾT ĐÓI**.
 * Đổi một vấn đề ĐỘ TRỄ lấy một vấn đề TREO VĨNH VIỄN là một cuộc đổi chác tệ hơn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMeasureLockForTests, withMeasureWindow, MEASURE_QUEUE_PROMOTE_EVERY_MS,
} from "./vramMeasureLock";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
/**
 * ⚠ `setTimeout(0)` KHÔNG BAO GIỜ nổ dưới `vi.useFakeTimers()` nếu không ai đẩy đồng hồ — dùng
 * `tick()` trong một ca đồng hồ giả là tự treo chính mình (đã trả giá đúng một lượt chạy).
 */
const nhip = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  __resetMeasureLockForTests();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** Giữ khoá cho tới khi người gọi thả — dùng để dựng một hàng chờ có thật. */
function giuKhoa(nhatKy: string[], ten: string) {
  let tha!: () => void;
  const xong = withMeasureWindow(
    async () => { nhatKy.push(ten); await new Promise<void>((r) => { tha = r; }); },
    60_000, ten, "production",
  );
  return { xong, tha: () => tha() };
}

describe("cổng 2 — hàng chờ khoá cửa sổ đo BIẾT ƯU TIÊN", () => {
  it("★★ production ĐANG XẾP HÀNG được chạy TRƯỚC background vào hàng sớm hơn", async () => {
    const nhatKy: string[] = [];
    const a = giuKhoa(nhatKy, "A-dang-giu");
    await tick();

    const bg = withMeasureWindow(async () => { nhatKy.push("nen"); }, 60_000, "nen", "background");
    await tick();
    const prod = withMeasureWindow(async () => { nhatKy.push("aoi"); }, 60_000, "aoi", "production");
    await tick();

    expect(nhatKy).toEqual(["A-dang-giu"]);   // cả hai còn xếp hàng
    a.tha();
    await Promise.all([a.xong, bg, prod]);
    // FIFO thuần sẽ cho ["A-dang-giu", "nen", "aoi"] — đúng cái đảo ngược ưu tiên đang chạy.
    expect(nhatKy).toEqual(["A-dang-giu", "aoi", "nen"]);
  });

  it("CÙNG MỘT MỨC ⇒ vẫn FIFO (ưu tiên không được phá thứ tự công bằng trong mức)", async () => {
    const nhatKy: string[] = [];
    const a = giuKhoa(nhatKy, "A");
    await tick();
    const b1 = withMeasureWindow(async () => { nhatKy.push("b1"); }, 60_000, "b1", "interactive");
    await tick();
    const b2 = withMeasureWindow(async () => { nhatKy.push("b2"); }, 60_000, "b2", "interactive");
    await tick();
    a.tha();
    await Promise.all([a.xong, b1, b2]);
    expect(nhatKy).toEqual(["A", "b1", "b2"]);
  });

  it("KHÔNG khai mức ⇒ mặc định `background` (mặc định AN TOÀN: không ai chen được nhờ im lặng)", async () => {
    const nhatKy: string[] = [];
    const a = giuKhoa(nhatKy, "A");
    await tick();
    const khongKhai = withMeasureWindow(async () => { nhatKy.push("khong-khai"); }, 60_000, "khong-khai");
    await tick();
    const prod = withMeasureWindow(async () => { nhatKy.push("aoi"); }, 60_000, "aoi", "production");
    await tick();
    a.tha();
    await Promise.all([a.xong, khongKhai, prod]);
    expect(nhatKy).toEqual(["A", "aoi", "khong-khai"]);
  });

  describe("★★★ CHỐNG CHẾT ĐÓI — nâng hạng theo thời gian chờ", () => {
    it("background chờ đủ lâu ⇒ VƯỢT một production vừa tới (nếu không, đây là treo vĩnh viễn)", async () => {
      vi.useFakeTimers();
      const nhatKy: string[] = [];
      const a = giuKhoa(nhatKy, "A");
      await nhip();

      const bg = withMeasureWindow(async () => { nhatKy.push("nen-cho-lau"); }, 600_000, "nen", "background");
      await nhip();

      // Nền đã chờ đủ lâu để được nâng ít nhất HAI hạng (background → trên cả production).
      await vi.advanceTimersByTimeAsync(MEASURE_QUEUE_PROMOTE_EVERY_MS * 3);

      const prod = withMeasureWindow(async () => { nhatKy.push("aoi-vua-toi"); }, 600_000, "aoi", "production");
      await nhip();

      a.tha();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([a.xong, bg, prod]);
      expect(nhatKy).toEqual(["A", "nen-cho-lau", "aoi-vua-toi"]);
    });

    it("nâng hạng KHÔNG áp cho kẻ vừa tới (production mới vẫn thắng background mới)", async () => {
      vi.useFakeTimers();
      const nhatKy: string[] = [];
      const a = giuKhoa(nhatKy, "A");
      await nhip();
      const bg = withMeasureWindow(async () => { nhatKy.push("nen-moi"); }, 600_000, "nen", "background");
      await nhip();
      const prod = withMeasureWindow(async () => { nhatKy.push("aoi"); }, 600_000, "aoi", "production");
      await nhip();
      a.tha();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([a.xong, bg, prod]);
      expect(nhatKy).toEqual(["A", "aoi", "nen-moi"]);
    });

    it("dòng production LIÊN TỤC KHÔNG bỏ đói được việc nền (bằng chứng bằng vòng lặp)", async () => {
      vi.useFakeTimers();
      const nhatKy: string[] = [];
      const a = giuKhoa(nhatKy, "A");
      await nhip();
      const bg = withMeasureWindow(async () => { nhatKy.push("nen"); }, 600_000, "nen", "background");
      await nhip();

      // 10 lượt production nối đuôi nhau, mỗi lượt cách nhau một khoảng nâng hạng.
      const dsProd: Promise<unknown>[] = [];
      for (let i = 0; i < 10; i++) {
        dsProd.push(withMeasureWindow(async () => { nhatKy.push(`p${i}`); }, 600_000, `p${i}`, "production"));
        await nhip();
        await vi.advanceTimersByTimeAsync(MEASURE_QUEUE_PROMOTE_EVERY_MS);
      }
      a.tha();
      await vi.advanceTimersByTimeAsync(10);
      await Promise.all([a.xong, bg, ...dsProd]);
      // Việc nền KHÔNG được là kẻ chạy cuối cùng.
      expect(nhatKy[nhatKy.length - 1]).not.toBe("nen");
      expect(nhatKy).toContain("nen");
    });
  });

  it("ưu tiên KHÔNG đụng tới lá chắn chống bế tắc: hết ngân sách vẫn CHẠY TIẾP, mất phép đo", async () => {
    const nhatKy: string[] = [];
    const a = giuKhoa(nhatKy, "A");
    await tick();
    const bo = await withMeasureWindow(async () => "b", 0, "bo-cuoc", "production");
    expect(bo).toEqual({ value: "b", measurable: false });
    a.tha();
    await a.xong;
  });
});

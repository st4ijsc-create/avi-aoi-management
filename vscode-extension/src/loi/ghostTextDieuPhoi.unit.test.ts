/**
 * ★★★ ĐỢT 4C — gỡ dội (debounce) + huỷ khi gõ tiếp + nghỉ sau lỗi của ghost-text.
 * Gõ phím bắn một yêu cầu MỖI ký tự nếu không gỡ dội ⇒ model 1 slot nghẹt; lượt cũ phải bị HUỶ (AbortSignal) để
 * kết quả trễ không đè lên vị trí con trỏ mới.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DieuPhoiGoDoi, TrangThaiLoiGhost, NGHI_SAU_LOI_MANG_MS } from "./ghostTextDieuPhoi";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DieuPhoiGoDoi", () => {
  it("★★★ gõ liên tục ⇒ chỉ lượt CUỐI qua được, các lượt trước bị huỷ (signal aborted)", async () => {
    const dp = new DieuPhoiGoDoi(250);
    const a = dp.cho();
    vi.advanceTimersByTime(100);
    const b = dp.cho();
    vi.advanceTimersByTime(100);
    const c = dp.cho();
    vi.advanceTimersByTime(250);
    expect(await a).toBeUndefined();
    expect(await b).toBeUndefined();
    const sc = await c;
    expect(sc).toBeDefined();
    expect(sc!.aborted).toBe(false);
  });

  it("★★★ lượt đã qua gỡ dội (đang gọi mạng) bị HUỶ khi người dùng gõ tiếp", async () => {
    const dp = new DieuPhoiGoDoi(250);
    const p = dp.cho();
    vi.advanceTimersByTime(250);
    const s = (await p)!;
    expect(s.aborted).toBe(false);
    void dp.cho();
    expect(s.aborted).toBe(true);
  });

  it("★★ chưa đủ thời gian gỡ dội ⇒ chưa trả", async () => {
    const dp = new DieuPhoiGoDoi(250);
    let xong = false;
    void dp.cho().then(() => (xong = true));
    await vi.advanceTimersByTimeAsync(200);
    expect(xong).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(xong).toBe(true);
  });

  it("★★★ token huỷ của VSCode ⇒ huỷ lượt", async () => {
    const dp = new DieuPhoiGoDoi(250);
    let cb: (() => void) | undefined;
    const token = { isCancellationRequested: false, onCancellationRequested: (f: () => void) => ((cb = f), { dispose: () => undefined }) };
    const p = dp.cho(token);
    cb!();
    vi.advanceTimersByTime(300);
    expect(await p).toBeUndefined();
  });

  it("★★ token đã huỷ sẵn ⇒ không chờ, trả undefined", async () => {
    const dp = new DieuPhoiGoDoi(250);
    const token = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) };
    expect(await dp.cho(token)).toBeUndefined();
  });

  it("★★ độ trễ 0 (gọi tay Alt+\\) ⇒ trả ngay ở nhịp kế", async () => {
    const dp = new DieuPhoiGoDoi(250);
    const p = dp.cho(undefined, 0);
    vi.advanceTimersByTime(0);
    expect(await p).toBeDefined();
  });

  it("★ huyTatCa ⇒ lượt đang chờ bị huỷ", async () => {
    const dp = new DieuPhoiGoDoi(250);
    const p = dp.cho();
    dp.huyTatCa();
    vi.advanceTimersByTime(300);
    expect(await p).toBeUndefined();
  });
});

describe("TrangThaiLoiGhost — lỗi IM LẶNG nhưng không dội máy chủ", () => {
  it("★★★ lỗi mạng ⇒ nghỉ một quãng, hết quãng thì thử lại", () => {
    const tt = new TrangThaiLoiGhost();
    tt.ghiLoi("mang", 1000);
    expect(tt.dangNghi(1001)).toBe(true);
    expect(tt.dangNghi(1000 + NGHI_SAU_LOI_MANG_MS + 1)).toBe(false);
  });
  it("★★★ bị từ chối (401/403) ⇒ nghỉ tới khi đặt lại (đăng nhập lại / đổi cấu hình)", () => {
    const tt = new TrangThaiLoiGhost();
    tt.ghiLoi("tu-choi", 0);
    expect(tt.dangNghi(60 * 60_000)).toBe(true);
    tt.datLai();
    expect(tt.dangNghi(60 * 60_000)).toBe(false);
  });
  it("★★ thành công ⇒ xoá trạng thái lỗi", () => {
    const tt = new TrangThaiLoiGhost();
    tt.ghiLoi("mang", 0);
    tt.ghiThanhCong();
    expect(tt.dangNghi(1)).toBe(false);
  });
});

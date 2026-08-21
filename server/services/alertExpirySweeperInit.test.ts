/**
 * B3.3 — `initAlertExpirySweeper` phải thật sự gọi CẢ HAI việc mỗi nhịp.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ KHOẢNG TRỐNG NÀY ĐÃ ĐƯỢC ĐO, KHÔNG PHẢI SUY ĐOÁN
 * ══════════════════════════════════════════════════════════════════════════════════
 * Backlog B3 ghi: *"`initAlertExpirySweeper` có thật sự gọi `pruneOldOccurrences` không —
 * xoá dòng đó khỏi `setInterval` thì toàn bộ test vẫn xanh."*
 *
 * Đột biến 2026-08-22 xác nhận đúng như vậy: gỡ hẳn `void pruneOldOccurrences();` khỏi
 * `setInterval`, `alertExpirySweeper.test.ts` vẫn **7/7 XANH**. Bộ test đó khoá rất kỹ
 * hành vi của TỪNG HÀM (xoá đúng số dòng, không ném khi DB sập, bảng thiếu thì bỏ qua) —
 * nhưng không ca nào phát biểu về việc chúng có được GỌI hay không.
 *
 * ⇒ Lớp lỗi: **kiểm kỹ từng bộ phận không thay được việc kiểm rằng chúng ĐƯỢC LẮP VÀO.**
 *   Hậu quả nếu trôi: nhật ký lần-tái-diễn phình vô hạn (`ALERT_OCCURRENCE_RETENTION_DAYS`
 *   trở thành vô nghĩa) mà mọi cổng đều xanh và không ai thấy gì cả.
 *
 * ── VÌ SAO ĐO BẰNG ĐỒNG HỒ GIẢ, KHÔNG ĐỌC MÃ NGUỒN ─────────────────────────────
 * Ở đây thứ cần canh là một HÀNH VI quan sát được (tới nhịp thì hai hàm chạy), khác với
 * `timeframeGuard`/`weakAuthMetricQueue` — nơi cái cần canh là cấu trúc phòng vệ mà thời
 * điểm không quan sát tất định được. Đo được hành vi thì đừng đọc mã: lưới đọc mã sẽ
 * xanh cả khi ai đó đổi `setInterval` thành thứ không bao giờ chạy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const daGoi: string[] = [];

vi.mock("../db/connection", () => ({
  getDb: async () => {
    daGoi.push("getDb");
    return null; // cả hai hàm đều thoát sớm, không ném — đủ để đếm lời gọi
  },
}));

describe("B3.3 — nhịp quét phải gọi CẢ đóng-hết-hạn LẪN dọn-nhật-ký", () => {
  beforeEach(() => {
    daGoi.length = 0;
    vi.resetModules();
    vi.useFakeTimers();
    delete process.env.ALERT_EXPIRY_SWEEP_ENABLED;
    delete process.env.ALERT_EXPIRY_SWEEP_MINUTES;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cầu chì: chưa tới nhịp thì KHÔNG hàm nào chạy", () => {
    // Thiếu ca này, một `setInterval(fn, 0)` (hoặc gọi thẳng lúc khởi tạo) cũng làm ca
    // dưới xanh — tức lưới sẽ chứng nhận cho một thứ chạy SAI nhịp.
    return import("./alertExpirySweeper").then(async (m) => {
      process.env.ALERT_EXPIRY_SWEEP_MINUTES = "30";
      m.initAlertExpirySweeper();
      await vi.advanceTimersByTimeAsync(29 * 60_000);
      expect(daGoi.length).toBe(0);
    });
  });

  it("★★★ tới nhịp ⇒ CẢ HAI hàm cùng chạy — không được thiếu hàm nào", async () => {
    const m = await import("./alertExpirySweeper");
    process.env.ALERT_EXPIRY_SWEEP_MINUTES = "30";
    m.initAlertExpirySweeper();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 10);
    // Mỗi hàm gọi `getDb()` đúng một lần rồi thoát sớm ⇒ 2 lời gọi = 2 việc đã chạy.
    // Gỡ `void pruneOldOccurrences()` khỏi `setInterval` ⇒ còn 1 ⇒ ca này ĐỎ.
    expect(daGoi.length, "sweepExpiredAlerts + pruneOldOccurrences").toBe(2);
  });

  it("★★★ phải LẶP LẠI, không chỉ chạy một lần rồi im", async () => {
    // ⚠ Ca này thêm sau khi đột biến `setInterval → setTimeout` SỐNG SÓT: lưới chỉ tiến
    // đồng hồ MỘT nhịp nên không phân biệt được "quét định kỳ" với "quét đúng một lần
    // rồi thôi". Hỏng kiểu đó là hỏng câm nhất trong ba kiểu: sau lần đầu, mọi thứ trông
    // như đang chạy — nhật ký cứ phình, cảnh báo hết hạn không bao giờ đóng, và không có
    // lỗi nào để ai đó nhìn thấy.
    const m = await import("./alertExpirySweeper");
    process.env.ALERT_EXPIRY_SWEEP_MINUTES = "30";
    m.initAlertExpirySweeper();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 10);
    expect(daGoi.length, "nhịp 1").toBe(2);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(daGoi.length, "nhịp 2 — bộ quét phải còn sống").toBe(4);
  });

  it("★★★ `ALERT_EXPIRY_SWEEP_ENABLED=false` ⇒ KHÔNG đăng ký nhịp nào", async () => {
    // Đối trọng: nếu ai đó 'sửa' ca trên bằng cách gọi thẳng hai hàm lúc khởi tạo thì
    // công tắc tắt sẽ mất tác dụng. Ca này giữ cho công tắc còn nghĩa.
    const m = await import("./alertExpirySweeper");
    process.env.ALERT_EXPIRY_SWEEP_ENABLED = "false";
    m.initAlertExpirySweeper();
    await vi.advanceTimersByTimeAsync(120 * 60_000);
    expect(daGoi.length).toBe(0);
  });

  it("chỉ ĐÚNG chuỗi \"false\" mới tắt — mọi giá trị khác vẫn bật", async () => {
    // `ALERT_EXPIRY_SWEEP_ENABLED=0` / `no` / `FALSE` KHÔNG tắt. Đó là hành vi thật của
    // mã; ghi nó vào lưới để người vận hành gõ `0` rồi tưởng đã tắt sẽ có chỗ tra —
    // và `.env.example` (D1) nay cũng nói đúng điều này.
    const m = await import("./alertExpirySweeper");
    process.env.ALERT_EXPIRY_SWEEP_ENABLED = "0";
    process.env.ALERT_EXPIRY_SWEEP_MINUTES = "30";
    m.initAlertExpirySweeper();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 10);
    expect(daGoi.length).toBe(2);
  });
});

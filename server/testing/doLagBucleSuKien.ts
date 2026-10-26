/**
 * Phần thời gian máy KHÔNG chạy tiến trình test — để một cận trên bằng đồng hồ tường ("phải xong trong X ms") trả lại đúng phần
 * đó khi CPU bị tiến trình khác chiếm (lưới chạy song song, máy 99 %). Cận dưới (không bao giờ xong SỚM) giữ nguyên.
 *
 * KHÔNG được nới cho mã sản xuất tự chặn đồng bộ (readFileSync, crypto đồng bộ, vòng lặp bận): chặn đồng bộ làm vòng lặp sự kiện trễ NHƯNG tiến
 * trình vẫn ĐANG chạy ⇒ tốn CPU. Nên mỗi nhịp 5 ms ghi `trễ − CPU của chính tiến trình trong nhịp đó` (clamp ≥ 0), cộng dồn:
 *   • bị chiếm CPU: trễ lớn, CPU của ta nhỏ  ⇒ được nới;
 *   • tự chặn đồng bộ X ms: trễ ≈ X, CPU ≈ X ⇒ ≈ 0, KHÔNG nới (test vẫn đỏ);
 *   • chờ hẹn giờ (ngủ): không trễ ⇒ 0.
 * Điều kiện: vitest chạy mỗi tệp trong MỘT tiến trình con riêng (pool 'forks', vitest.config.ts) nên process.cpuUsage() là của tệp này;
 * với pool 'threads' nó tính cả tiến trình (CPU của luồng khác làm phần nới NHỎ đi — thiên về nghiêm, không về lỏng).
 * Dùng: `const lag = batDauDoLag(); … expect(troi).toBeLessThan(CAN + (await lag.dung()));` — và PHẢI có đột biến chèn vòng lặp bận
 * đồng bộ (CAN + 100) ms vào đường mã đo được ⇒ test phải đỏ. Không thay cho đếm công việc.
 */
export interface DoLag {
  /** Dừng đo và trả tổng ms "máy không chạy ta" trong khoảng đã đo (tối đa `tran` nếu có). Gọi SAU lần đo thời gian của test. */
  dung(tran?: number): Promise<number>;
}

export function batDauDoLag(buocMs = 5): DoLag {
  let tong = 0;
  let truoc = Date.now();
  let cpuTruoc = process.cpuUsage();
  const nhip = () => {
    const nay = Date.now();
    const cpu = process.cpuUsage();
    const cpuMs = (cpu.user - cpuTruoc.user + (cpu.system - cpuTruoc.system)) / 1000;
    tong += Math.max(0, nay - truoc - buocMs - cpuMs);
    truoc = nay;
    cpuTruoc = cpu;
  };
  const t = setInterval(nhip, buocMs);
  return {
    async dung(tran = Infinity) {
      // một nhịp cuối: nếu máy vừa bị chiếm ngay trước khi gọi, nhịp này ghi nhận
      await new Promise((r) => setTimeout(r, buocMs * 2));
      clearInterval(t);
      nhip();
      return Math.min(tran, Math.round(tong));
    },
  };
}

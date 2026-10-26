/**
 * Đo độ trễ vòng lặp sự kiện TRONG CÙNG lần chạy test — để một cận trên bằng đồng hồ tường ("phải xong trong X ms") trả lại đúng phần
 * thời gian mà máy KHÔNG chạy mã của test (CPU bị tiến trình khác chiếm: lưới chạy song song, máy 99 %). Cận dưới (không bao giờ xong SỚM) giữ nguyên.
 * Dùng: `const lag = batDauDoLag(); … expect(troi).toBeLessThanOrEqual(CAN + (await lag.dung()));`
 * Không thay cho đếm công việc: chỉ dùng khi chính điều khẳng định là một hạn giờ của mã sản xuất (không tách khỏi đồng hồ được).
 */
export interface DoLag {
  /** Dừng đo và trả độ trễ lớn nhất (ms) mà một lần hẹn giờ 5 ms đã bị chậm. Gọi SAU lần đo thời gian của test. */
  dung(): Promise<number>;
}

export function batDauDoLag(buocMs = 5): DoLag {
  let max = 0;
  let truoc = Date.now();
  const t = setInterval(() => {
    const nay = Date.now();
    max = Math.max(max, nay - truoc - buocMs);
    truoc = nay;
  }, buocMs);
  return {
    async dung() {
      // một nhịp cuối: nếu máy vừa bị chiếm ngay trước khi gọi, nhịp này ghi nhận
      await new Promise((r) => setTimeout(r, buocMs * 2));
      clearInterval(t);
      return Math.max(0, max);
    },
  };
}

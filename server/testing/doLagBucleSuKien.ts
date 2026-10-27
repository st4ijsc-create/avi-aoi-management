/**
 * Phần thời gian máy KHÔNG chạy tiến trình test — để một cận trên bằng đồng hồ tường ("phải xong trong X ms") trả lại đúng phần
 * đó khi CPU bị tiến trình khác chiếm (lưới chạy song song, máy 99 %). Cận dưới (không bao giờ xong SỚM) giữ nguyên.
 *
 * KHÔNG được nới cho mã sản xuất tự chặn đồng bộ (readFileSync, crypto đồng bộ, vòng lặp bận): chặn đồng bộ làm vòng lặp sự kiện trễ NHƯNG tiến
 * trình vẫn ĐANG chạy ⇒ tốn CPU. Nên mỗi nhịp ghi `khoảng nhịp − chu kỳ hẹn giờ lúc RẢNH − CPU của chính tiến trình trong nhịp` (clamp ≥ 0), cộng dồn:
 *   • bị chiếm CPU: trễ lớn, CPU của ta nhỏ  ⇒ được nới;
 *   • tự chặn đồng bộ X ms: trễ ≈ X, CPU ≈ X ⇒ ≈ 0, KHÔNG nới (test vẫn đỏ);
 *   • chờ hẹn giờ (ngủ): đúng chu kỳ ⇒ 0.
 *
 * ★ ĐỘ PHÂN GIẢI HẸN GIỜ THẬT (scada-master đo 2026-10-26): trên Windows `setInterval(5)` thực bắn mỗi ~15,6 ms (64 Hz). Bản đầu trừ `buocMs` = 5 ⇒ mỗi nhịp
 * cộng ~10 ms dù tiến trình rảnh ⇒ ngủ 1 000 ms nới ~690 ms (≈ 68 %). Nay trừ CHU KỲ RẢNH ĐO THẬT: phân vị 10 % của ~20 khoảng nhịp đo lúc nạp mô-đun
 * (tải chỉ làm khoảng nhịp DÀI thêm, nên phân vị thấp ≈ chu kỳ không tải).
 *
 * ★ TRẦN MẶC ĐỊNH: `dung()` kẹp ở `TRAN_MAC_DINH` (100 ms). Gọi không trần phải là lựa chọn TƯỜNG MINH `dung(Infinity)`. Mọi cận dùng helper này nên
 * chọn trần NHỎ HƠN biên lỗi mà test muốn bắt (và kèm đột biến chặn đồng bộ ⇒ phải đỏ).
 * Điều kiện: vitest chạy mỗi tệp trong MỘT tiến trình con riêng (pool 'forks') nên process.cpuUsage() là của tệp này; với 'threads' nó tính cả tiến trình
 * (phần nới NHỎ đi — thiên về nghiêm).
 */
export const TRAN_MAC_DINH = 100;

export interface DoLag {
  /** Dừng đo và trả tổng ms "máy không chạy ta" (kẹp ở `tran`, mặc định 100 ms; `Infinity` = không kẹp, chọn tường minh). Gọi SAU lần đo thời gian của test. */
  dung(tran?: number): Promise<number>;
}

export interface PhuThuocDoLag {
  now(): number;
  /** CPU (user+system) tích luỹ của tiến trình, ms. */
  cpuMs(): number;
  setInterval(f: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
  setTimeout(f: () => void, ms: number): unknown;
  /** Chu kỳ thật của `setInterval(buocMs)` lúc rảnh. */
  chuKyRanh(buocMs: number): Promise<number>;
  /** (tuỳ chọn) đo LẠI chu kỳ rảnh ngay lúc `dung()` — độ phân giải hẹn giờ Windows đổi theo thời điểm (tiến trình khác nâng/hạ), số đo lúc nạp mô-đun có thể cũ. */
  chuKyMoi?(buocMs: number): Promise<number>;
}

/** Phân vị 10 % của các khoảng nhịp đo được (đáy của phân phối = chu kỳ không tải). */
export async function hieuChuanChuKy(dep: Pick<PhuThuocDoLag, "now" | "setInterval" | "clearInterval">, buocMs: number, soMau = 20): Promise<number> {
  const khoang: number[] = [];
  await new Promise<void>((xong) => {
    let truoc = dep.now();
    const h = dep.setInterval(() => {
      const nay = dep.now();
      khoang.push(nay - truoc);
      truoc = nay;
      if (khoang.length >= soMau) {
        dep.clearInterval(h);
        xong();
      }
    }, buocMs);
  });
  const xep = [...khoang].sort((a, b) => a - b);
  return Math.max(buocMs, xep[Math.floor(xep.length * 0.1)] ?? buocMs);
}

const cpuTienTrinh = (): number => {
  const c = process.cpuUsage();
  return (c.user + c.system) / 1000;
};

/** Bản thật. `chuKyRanh` đo MỘT lần cho mỗi `buocMs` và nhớ (bắt đầu ngay lúc nạp mô-đun cho bước mặc định). */
const NHO_CHU_KY = new Map<number, Promise<number>>();
const depThat: PhuThuocDoLag = {
  now: () => Date.now(),
  cpuMs: cpuTienTrinh,
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (f, ms) => setTimeout(f, ms),
  chuKyMoi: (buocMs) => hieuChuanChuKy(depThat, buocMs, 10).catch(() => buocMs),
  chuKyRanh: (buocMs) => {
    let p = NHO_CHU_KY.get(buocMs);
    if (!p) {
      p = hieuChuanChuKy(depThat, buocMs).catch(() => buocMs);
      NHO_CHU_KY.set(buocMs, p);
    }
    return p;
  },
};
void depThat.chuKyRanh(5); // đo trước, song song với phần còn lại của việc nạp tệp test

export function batDauDoLag(buocMs = 5, dep: PhuThuocDoLag = depThat): DoLag {
  const mau: Array<{ khoang: number; cpuMs: number }> = [];
  let truoc = dep.now();
  let cpuTruoc = dep.cpuMs();
  const nhip = () => {
    const nay = dep.now();
    const cpu = dep.cpuMs();
    mau.push({ khoang: nay - truoc, cpuMs: cpu - cpuTruoc });
    truoc = nay;
    cpuTruoc = cpu;
  };
  const h = dep.setInterval(nhip, buocMs);
  return {
    async dung(tran = TRAN_MAC_DINH) {
      // một nhịp cuối: nếu máy vừa bị chiếm ngay trước khi gọi, nhịp này ghi nhận
      await new Promise<void>((xong) => dep.setTimeout(xong, buocMs * 3));
      dep.clearInterval(h);
      nhip();
      // lấy SỐ LỚN HƠN của số đo lúc nạp và số đo ngay bây giờ: số đo cũ thấp (hẹn giờ 1 ms lúc nạp, 15,6 ms lúc chạy) làm nới quá tay (đo thật: ngủ 800 ms bị tính 425–551 ms);
      // sai về phía chặt (trừ nhiều) chỉ làm nới ÍT đi — an toàn.
      const chuKy = Math.max(await dep.chuKyRanh(buocMs), (await dep.chuKyMoi?.(buocMs)) ?? 0);
      let tong = 0;
      for (const m of mau) tong += Math.max(0, m.khoang - chuKy - m.cpuMs);
      return Math.min(tran, Math.round(tong));
    },
  };
}

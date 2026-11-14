/**
 * Ca THỜI GIAN "tăng tuyến tính n→4n→8n" của bộ che AI ngoài (`cheDuLieu.cheChuoi`) — tách khỏi `cheDuLieu.test.ts` theo phương án B3
 * (chu-du-an-HST duyệt 14/11). Logic ca và trần 2 000 ms GIỮ NGUYÊN như bản A (8a51af347).
 *
 * ⚠ CHẠY DƯỚI TẢI CÓ THỂ ĐỎ OAN. Đây là phép đo ĐỒNG HỒ; khi máy bận (nhiều bản vitest song song, cổng gộp chạy các nhóm khác) tỉ lệ
 *   thời gian bị nhiễu. Số đo 14/11:
 *     · kiem-dinh: 2/12 lượt đỏ oan khi chạy 4 bản song song;
 *     · cổng gộp: đỏ oan 1/3 cổng hôm nay (13:33, họ "Ab."); thêm 1 lần 14:57 (họ "token=") khi chạy song song 4 tệp, chạy riêng xanh.
 *   Vì vậy CỔNG chạy tệp này MỘT MÌNH, SAU mọi nhóm khác (script cổng của dieu-phoi; thiếu tệp / 0 ca / không chạy ⇒ ĐỎ). Đỏ ở lượt
 *   thường mà chạy riêng xanh ⇒ chạy lại theo luật, ghi danh sách chập chờn; KHÔNG tắt ca, KHÔNG nới trần / hệ số.
 *   Phương án thay thế đã đo và KHÔNG đạt (14/11): đối chứng xen kẽ + MIN (4/12 đỏ oan dưới tải 3×4); thời gian CPU luồng
 *   (35/36 đỏ oan — độ phân giải Windows ~15,6 ms buộc dùng chuỗi nhiều MB, ở đó thời gian không còn tuyến tính).
 *
 * Phần TẤT ĐỊNH (lùi hàm mũ, bậc hai do gọi lặp) nằm ở `cheDuLieu.redos.test.ts`; tệp này lo phần còn lại: lùi bậc hai BÊN TRONG một
 * lần gọi regex và vòng bậc hai không dùng regex. Họ đầu vào xấu dùng chung: `hoXau.ts`.
 */
import { describe, expect, it } from "vitest";
import { cheChuoi } from "./cheDuLieu";
import { HO_XAU } from "./hoXau";

describe("thời gian TUYẾN TÍNH với đầu vào xấu (rà kiem-dinh F — ReDoS, cùng tiến trình với đường STOP)", () => {
  const HO = HO_XAU;
  const doMs = (s: string) => {
    const t0 = performance.now();
    cheChuoi(s);
    return performance.now() - t0;
  };
  // ★ 2026-11-14 (do-model, chu-du-an-HST quyết 13/11) — thay ca cũ "20k lần < 200 ms và t(2n)/t(n) < 3":
  //   · ngưỡng tuyệt đối 200 ms đỏ chập chờn khi máy tải (4 bản song song);
  //   · ca cũ cũng MÙ: đột biến bậc hai sống 4/25 họ (tỉ lệ ~3 lọt ngưỡng, hoặc t2 ≤ 20 ms nên miễn kiểm tỉ lệ).
  // Bản mới: tăng n tới khi t(n) ≥ 5 ms (thoát vùng chuỗi nhỏ cho tỉ lệ siêu tuyến tính giả), rồi so n→4n; tỉ lệ < 6 ⇒ đạt ngay;
  // ≥ 6 (tải hoặc bậc hai) ⇒ đo thêm 8n: tuyến tính ≈ 8, bậc hai ≈ 64 ⇒ ngưỡng 16 tách được cả dưới tải. Trung vị 5 mẫu mỗi điểm.
  // 8n tới ~10M ký tự chỉ đo được sau khi bỏ regex `(?<!\S)\S{8000,}` (tràn ngăn xếp ở ~5,6M, xem cheChuoiLienDai).
  const SO_MAU = 5;
  const SAN_MS = 5;
  const N_TRAN = 1_280_000;
  const trungViMs = (s: string) => {
    const xs = Array.from({ length: SO_MAU }, () => doMs(s)).sort((a, b) => a - b);
    return xs[(SO_MAU - 1) / 2]!;
  };
  it.each(HO)("%s: 20k lần < 2000 ms (chặn thô) và tăng tuyến tính n→4n→8n (trung vị 5 mẫu)", (_ten, sinh) => {
    doMs(sinh(1000)); // làm nóng JIT
    expect(trungViMs(sinh(20_000))).toBeLessThan(2000);
    let n = 10_000;
    let t1 = trungViMs(sinh(n));
    while (t1 < SAN_MS && n < N_TRAN) {
      n *= 2;
      t1 = trungViMs(sinh(n));
    }
    const t4 = trungViMs(sinh(4 * n));
    if (t4 / Math.max(t1, 1) < 6) return;
    expect(t4).toBeLessThan(4000);
    const t8 = trungViMs(sinh(8 * n));
    expect(t8 / Math.max(t1, 1)).toBeLessThan(16);
  }, 120_000);
});

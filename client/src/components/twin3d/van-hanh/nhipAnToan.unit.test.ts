/**
 * `nhipAnToan.unit.test.ts` — ★★★ BẤT BIẾN NHỊP AN TOÀN (Đợt 28, T-1 tầng 2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TỆP NÀY CANH MỘT LUẬT AN TOÀN, KHÔNG PHẢI MỘT CHI TIẾT CÀI ĐẶT
 * ════════════════════════════════════════════════════════════════════════════
 * Luật (Đợt 8): **nhịp thích nghi CHỈ ĐƯỢC RÚT NGẮN, KHÔNG ĐƯỢC KÉO DÀI.**
 *
 * Sự cố sinh ra nó: một bản vá áp thẳng `nhipHoiMs` vào `andon.active`, làm
 * truy vấn cảnh báo **chậm đi 20 → 30 s** mỗi khi socket khoẻ. `check` xanh,
 * toàn bộ test xanh, **không cổng nào đỏ** — thứ duy nhất đổi là người đứng
 * cạnh máy biết tin muộn hơn 10 giây.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO ĐO **GIÁ TRỊ THẬT**, KHÔNG ĐO VĂN BẢN MÃ NGUỒN
 * ════════════════════════════════════════════════════════════════════════════
 * Bất biến cũ (`noiChoGoi.unit.test.ts`) đếm chuỗi `"nhipHoiToiDa(coLuongDay,
 * 20_000)"` trong `TwinVanHanh.tsx`. Phép đo ấy đã cứu được ĐB-9, nhưng nó có
 * hai điểm mù **có thể chứng minh**:
 *
 *   ① Nó chết khi mã **dời nhà**. Đợt 28 tách bốn truy vấn sang
 *      `useTrangThaiSong.ts` và ca ấy lập tức đi tìm ở tệp cũ.
 *   ② Nó mù với **cách viết khác**. `nhipHoiToiDa(coLuongDay, 19_000 + 1_000)`
 *      hay một hằng trung gian tên khác đều thoả chuỗi… hoặc trượt chuỗi mà
 *      vẫn đúng luật. Nó đo **chính tả**, không đo **hành vi**.
 *
 * Nên tệp này đo thứ thật sự quan trọng: **con số mà react-query sẽ nhận**.
 * Nó gọi `nhipHoiToiDa` thật với hằng trần thật, ở CẢ HAI trạng thái socket, và
 * khẳng định kết quả **không bao giờ vượt trần**. Một đột biến `20_000 →
 * 30_000` đổi giá trị trả về ⇒ **đỏ**, bất kể mã được viết thế nào.
 *
 * ⚠ Giới hạn tự khai: tệp này chứng minh **luật về con số**. Việc mỗi chỗ gọi
 *   dùng ĐÚNG hằng của hạng mình là một câu khác, và nó được canh ở
 *   `useTrangThaiSong.unit.test.ts` (neo từng trần vào từng thủ tục).
 */
import { describe, it, expect } from "vitest";
import { nhipHoiToiDa, nhipHoiMs, NHIP_CO_LUONG_MS, NHIP_KHONG_LUONG_MS } from "./nguonDuLieu";
import { TRAN_NHIP_AN_TOAN_MS, TRAN_NHIP_SUC_KHOE_MS } from "./useTrangThaiSong";

describe("★★★ BẤT BIẾN AN TOÀN — trần nhịp KHÔNG BAO GIỜ bị vượt", () => {
  it("★★★ trần hạng an toàn ĐÚNG BẰNG 20 s — nới trần là hồi quy an toàn", () => {
    // Ca này là đích của phép tiêm đột biến `20_000 → 30_000`.
    expect(TRAN_NHIP_AN_TOAN_MS).toBe(20_000);
  });

  it("★★★ trần sức khoẻ máy ĐÚNG BẰNG 60 s", () => {
    expect(TRAN_NHIP_SUC_KHOE_MS).toBe(60_000);
  });

  it("★★★ trần an toàn phải NGẶT HƠN nhịp tổng quan — nếu không nó vô nghĩa", () => {
    // Đây là ca chứng minh trần CÓ TÁC DỤNG. `nhipHoiMs(true)` = 30 s; nếu trần
    // ≥ 30 s thì `Math.min` không bao giờ cắt gì và cả bất biến này chỉ là trang
    // trí. Ca này đỏ ngay khi ai đó nới trần lên bằng/quá nhịp tổng quan.
    expect(TRAN_NHIP_AN_TOAN_MS).toBeLessThan(NHIP_CO_LUONG_MS);
    expect(TRAN_NHIP_AN_TOAN_MS).toBeLessThan(nhipHoiMs(true));
  });

  it("★★★ SOCKET KHOẺ: cảnh báo/E-STOP ở lại 20 s, KHÔNG trôi lên 30 s", () => {
    // Đây chính xác là hồi quy Đợt 8, đo bằng GIÁ TRỊ chứ không bằng chính tả.
    const nhip = nhipHoiToiDa(true, TRAN_NHIP_AN_TOAN_MS);
    expect(nhip).toBe(20_000);
    expect(nhip).toBeLessThanOrEqual(TRAN_NHIP_AN_TOAN_MS);
    expect(nhip).toBeLessThan(nhipHoiMs(true));
  });

  it("★★★ SOCKET CHẾT: nhịp RÚT NGẮN xuống 5 s — trần không cản đường", () => {
    // Chiều kia của luật: trần là chặn trên, không phải giá trị cố định. Nếu ai
    // đó cài `nhipHoiToiDa` thành `Math.max` thì ca trên vẫn xanh, ca này đỏ.
    const nhip = nhipHoiToiDa(false, TRAN_NHIP_AN_TOAN_MS);
    expect(nhip).toBe(NHIP_KHONG_LUONG_MS);
    expect(nhip).toBeLessThan(TRAN_NHIP_AN_TOAN_MS);
  });

  it("★★★ SỨC KHOẺ MÁY không bao giờ vượt 60 s ở BẤT KỲ trạng thái socket nào", () => {
    for (const coLuong of [true, false]) {
      const nhip = nhipHoiToiDa(coLuong, TRAN_NHIP_SUC_KHOE_MS);
      expect(nhip, `coLuong=${coLuong}`).toBeLessThanOrEqual(TRAN_NHIP_SUC_KHOE_MS);
      expect(nhip, `coLuong=${coLuong}`).toBeGreaterThan(0);
    }
  });

  it("★★★ BẤT BIẾN TỔNG QUÁT — với MỌI trạng thái socket, nhịp ≤ trần đã khai", () => {
    // Không liệt kê ca; khẳng định tính chất. Đây là hàng rào cuối nếu ai đó
    // thêm một hạng nhịp mới: luật phải đúng cho mọi cặp (socket, trần).
    for (const tran of [TRAN_NHIP_AN_TOAN_MS, TRAN_NHIP_SUC_KHOE_MS]) {
      for (const coLuong of [true, false]) {
        expect(nhipHoiToiDa(coLuong, tran), `tran=${tran} coLuong=${coLuong}`).toBeLessThanOrEqual(
          tran,
        );
      }
    }
  });
});

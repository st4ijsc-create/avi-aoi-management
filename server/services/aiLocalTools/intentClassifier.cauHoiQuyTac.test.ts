/**
 * ★★★ CÂU HỎI QUY TẮC vs CÂU HỎI TRẠNG THÁI — lưới hai chiều cho `laCauHoiQuyTac`.
 *
 * ── VÌ SAO LƯỚI NÀY TỒN TẠI ────────────────────────────────────────────────────────────────
 * Chủ dự án khai bảy quy trình nhà máy vào ba thẻ vận hành đã duyệt (2026-08-18). Phép đo sau đó:
 * **truy hồi 7/7** nhưng **trả lời 4/7**. Ba câu hỏng KHÔNG phải vì thẻ thiếu chữ — chứng minh
 * bằng cách hỏi cùng một sự kiện theo hai cách:
 *
 *     "Gọi Andon bao lâu mà chưa ai tới thì coi là bất thường?"  → "Không có bất thường nào."   ✗
 *     "Thời gian phản hồi cam kết cho một lượt gọi Andon?"       → "1 phút, nhanh nhất 30 giây" ✓
 *     "Ai được phép dời lịch hoặc huỷ đơn hàng sản xuất?"        → "Bạn muốn tra cứu lô nào?"   ✗
 *     "Theo quy trình nhà máy, vai trò nào được dời lịch?"       → "Quản lý và người lập lịch"  ✓
 *
 * Cùng một sự kiện, cùng một thẻ, chỉ khác cách hỏi. ⇒ lỗi nằm ở ĐỊNH TUYẾN, không ở tri thức.
 *
 * ── CHIỀU NGUY HIỂM CỦA CHÍNH BẢN VÁ ───────────────────────────────────────────────────────
 * Một vị từ "câu này hỏi quy tắc" quá rộng sẽ **giết `list_anomalies`** cho những câu hỏi TRẠNG
 * THÁI thật, và triệu chứng sẽ là "trợ lý không còn xem được dữ liệu sống" — tệ hơn lỗi nó đi
 * chữa. Vì thế §2 dưới đây có số ca **nhiều hơn** §1: chặn đúng thì dễ, không chặn nhầm mới khó.
 */
import { describe, it, expect } from "vitest";
import { laCauHoiQuyTac, classifyToolIntent } from "./intentClassifier";

// ── §1 — PHẢI nhận là câu hỏi QUY TẮC (nhường cho tri thức) ─────────────────────────────────
const QUY_TAC: ReadonlyArray<[string, string]> = [
  ["A2 — đo được, hỏng thật", "Gọi Andon bao lâu mà chưa ai tới thì coi là bất thường?"],
  ["C2 — đo được, hỏng thật", "Sai lệch WIP bao nhiêu phần trăm thì coi là bất thường?"],
  ["C1 — đo được, hỏng thật", "Ai được phép dời lịch hoặc huỷ đơn hàng sản xuất?"],
  ["thẩm quyền", "Ai có quyền chỉnh ngưỡng cảnh báo?"],
  ["thẩm quyền, hỏi theo vai", "Vai trò nào được phép huỷ lệnh sản xuất?"],
  ["ngưỡng — hỏi con số quy định", "Ngưỡng sai lệch WIP là bao nhiêu?"],
  ["định nghĩa", "Thế nào là một lượt kiểm NG?"],
  ["chính sách", "Theo quy trình nhà máy, thời gian phản hồi Andon quy định là bao lâu?"],
  ["KHÔNG DẤU — phải bắt được y hệt", "Sai lech WIP bao nhieu phan tram thi coi la bat thuong?"],
  ["không dấu, thẩm quyền", "Ai duoc phep doi lich san xuat?"],
];

// ── §2 — TUYỆT ĐỐI KHÔNG được nhận nhầm: đây là câu hỏi TRẠNG THÁI, tool phải chạy ──────────
const TRANG_THAI: ReadonlyArray<[string, string]> = [
  ["hỏi có hay không", "Có bất thường nào không?"],
  ["hỏi danh sách", "Danh sách bất thường gần đây"],
  ["hỏi máy nào", "Máy nào đang bất thường?"],
  ["hỏi số hiện tại", "WIP hiện tại của line 2 là bao nhiêu?"],
  ["hỏi số hiện tại, có 'ngưỡng' nhưng hỏi TRẠNG THÁI", "Có điểm nào đang vượt ngưỡng không?"],
  ["OEE hôm nay", "OEE line 2 hôm nay là bao nhiêu?"],
  ["đếm", "Hôm nay có bao nhiêu lượt kiểm NG?"],
  ["tra cứu cụ thể", "Lô L20260505-001 sao rồi?"],
  ["hỏi ai ĐANG làm — người, không phải thẩm quyền", "Ai đang trực ca này?"],
  ["không dấu, trạng thái", "Co bat thuong nao khong?"],
  ["đếm không dấu", "Hom nay co bao nhieu luot kiem NG?"],
];

describe("§1 — câu hỏi QUY TẮC phải nhường cho tri thức", () => {
  it.each(QUY_TAC)("%s: %s", (_nhan, q) => {
    expect(laCauHoiQuyTac(q), `"${q}" phải được nhận là câu hỏi QUY TẮC`).toBe(true);
  });

  it("và bộ phân loại KHÔNG chọn tool, CŨNG KHÔNG phát câu hỏi lại", () => {
    for (const [, q] of QUY_TAC) {
      const d = classifyToolIntent(q);
      expect(d.tool, `"${q}" không được chọn tool`).toBeNull();
      expect(d.reason, `"${q}"`).toBe("CAU_HOI_QUY_TAC");
      // ⚠ Nửa thứ hai của bản vá. Một câu hỏi lại đòi "mã lệnh sản xuất" cho câu
      // "ai được phép huỷ đơn" chôn mất thẻ y hệt một tool rỗng: `answerQuestion`
      // trả thẳng `clarifyMessage` khi không có `toolResult`.
      expect(d.clarifyMessage ?? null, `"${q}" không được hỏi lại`).toBeNull();
    }
  });
});

describe("§2 — câu hỏi TRẠNG THÁI KHÔNG được nhận nhầm (chiều nguy hiểm của bản vá)", () => {
  it.each(TRANG_THAI)("%s: %s", (_nhan, q) => {
    expect(
      laCauHoiQuyTac(q),
      `"${q}" hỏi TRẠNG THÁI hiện tại — nhận nhầm là quy tắc sẽ giết đường dữ liệu sống`,
    ).toBe(false);
  });

  it("★ cầu chì: 'bất thường' vẫn chọn được list_anomalies khi hỏi TRẠNG THÁI", () => {
    // Nếu ca này đỏ, bản vá đã đi quá tay: triệu chứng ngoài đời sẽ là "trợ lý không
    // còn xem được dữ liệu sống nữa" — tệ hơn chính lỗi nó đi chữa.
    const d = classifyToolIntent("Có bất thường nào không?");
    expect(d.reason).not.toBe("CAU_HOI_QUY_TAC");
  });
});

describe("§3 — cầu chì cho chính lưới này", () => {
  it("hai tập KHÔNG giao nhau (một câu không thể vừa quy tắc vừa trạng thái)", () => {
    const a = new Set(QUY_TAC.map(([, q]) => q));
    const trung = TRANG_THAI.filter(([, q]) => a.has(q));
    expect(trung, "câu trùng giữa hai tập làm lưới tự mâu thuẫn").toEqual([]);
  });

  it("vị từ KHÔNG chỉ trả về một hằng số (nếu không §1 hoặc §2 tự thoả)", () => {
    expect(QUY_TAC.length).toBeGreaterThan(0);
    expect(TRANG_THAI.length).toBeGreaterThan(0);
    expect(laCauHoiQuyTac(QUY_TAC[0]![1])).not.toBe(laCauHoiQuyTac(TRANG_THAI[0]![1]));
  });
});

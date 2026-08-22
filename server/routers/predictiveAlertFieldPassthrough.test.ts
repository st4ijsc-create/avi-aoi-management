/**
 * B2 — mọi trường mà giao diện CẦN phải THẬT SỰ đi qua `.map()` của `predictiveAlert.list`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỚP LỖI NÀY ĐÃ XẢY RA HAI LẦN, CẢ HAI LẦN ĐỀU KHÔNG CÓ CỔNG NÀO BẮT
 * ══════════════════════════════════════════════════════════════════════════════════
 * Thủ tục này KHÔNG trả thẳng hàng CSDL — nó liệt kê từng cột BẰNG TAY trong một
 * `.map()`. Cột nào không được gõ ra thì client nhận `undefined` **VĨNH VIỄN**, dù CSDL
 * có dữ liệu đầy đủ và migration đã chạy xong.
 *
 * Đã trả giá:
 *   • Wave 3 Task 7 — thiếu `occurrenceCount` + `lastOccurredAt`: tính năng "gộp lần tái
 *     diễn" hoạt động đúng ở CSDL nhưng giao diện không bao giờ hiện được con số;
 *   • Wave 4 Task 6 — thiếu `resolutionNotes`: `alertExpirySweeper` ghi lý do đóng bằng
 *     tiếng người vào cột đó, và không client nào đọc được lý do ấy.
 *
 * Cả hai lần đều chỉ được phát hiện bằng MẮT NGƯỜI. Backlog B2 ghi đúng: *"hiện chỉ được
 * canh bằng mắt người."*
 *
 * ── VÌ SAO KHÔNG ĐỌC MÃ NGUỒN MÀ GỌI THẬT ────────────────────────────────────────
 * Một lưới đọc mã (`src.includes("occurrenceCount")`) sẽ XANH cả khi trường bị gõ nhầm
 * chỗ, nằm trong comment, hay bị một `.map()` sau đó ghi đè. Thứ cần khoá là **giá trị có
 * ra tới đầu ra hay không** — nên gọi thủ tục thật với một hàng giả và đọc kết quả.
 *
 * ⚠ Đây cũng là lý do ca cuối cùng KHÔNG liệt kê tên trường bằng tay: nó so với hàng đầu
 *   vào. Liệt kê tay ở đây là tái hiện đúng lỗi mà nó đang canh, một tầng cao hơn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let hangGia: Record<string, unknown>[] = [];

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: async () => hangGia }) }),
      }),
    }),
  }),
}));

/** Một hàng `predictive_alerts` ĐỦ trường mà giao diện đang dùng. */
const HANG = {
  id: 42,
  alertType: "MACHINE_FAILURE",
  severity: "HIGH",
  title: "Máy MC-01 sắp hỏng",
  description: "mô tả",
  predictedValue: "12.50",
  currentValue: "9.00",
  threshold: "10.00",
  confidenceScore: "88.00",
  predictedTimeframe: "48h",
  machineId: 7,
  machineCode: "MC-01",
  productModelId: null,
  status: "EXPIRED",
  acknowledgedAt: null,
  // ── ba trường đã từng bị đánh rơi ──
  occurrenceCount: 23,
  lastOccurredAt: new Date("2026-08-20T03:00:00.000Z"),
  resolutionNotes: "Tự đóng: tình trạng đã thôi tái diễn trước khi hết hạn cảnh báo.",
  createdAt: new Date("2026-07-20T03:00:00.000Z"),
  updatedAt: new Date("2026-08-21T03:00:00.000Z"),
};

async function goiList() {
  const { predictiveAlertRouter } = await import("./aiRouters");
  const caller = predictiveAlertRouter.createCaller({
    user: { id: 1, username: "t", role: "admin" },
  } as never);
  return (await caller.list({ status: "EXPIRED" } as never)) as Record<string, unknown>[];
}

describe("B2 — trường phải đi HẾT đường tới client, không chỉ tồn tại trong CSDL", () => {
  beforeEach(() => {
    hangGia = [{ ...HANG }];
  });

  it("cầu chì: thủ tục trả đúng MỘT hàng — không thì mọi ca dưới đọc mảng rỗng", async () => {
    const ra = await goiList();
    expect(ra).toHaveLength(1);
    expect(ra[0].id).toBe(42);
  });

  it("★★★ `occurrenceCount` tới được client — số nguyên, KHÔNG bị ép kiểu", async () => {
    // Wave 3 Task 7: thiếu trường này ⇒ tính năng gộp lần-tái-diễn vô hình với giao diện.
    const ra = await goiList();
    expect(ra[0].occurrenceCount).toBe(23);
    expect(typeof ra[0].occurrenceCount).toBe("number");
  });

  it("★★★ `lastOccurredAt` và `resolutionNotes` tới được client", async () => {
    // Wave 4 Task 6: thiếu `resolutionNotes` ⇒ lý do sweeper tự đóng cảnh báo KHÔNG ĐỌC
    // ĐƯỢC từ bất kỳ client nào — người vận hành thấy dòng biến mất mà không biết vì sao.
    const ra = await goiList();
    expect(ra[0].lastOccurredAt).toEqual(HANG.lastOccurredAt);
    expect(ra[0].resolutionNotes).toBe(HANG.resolutionNotes);
  });

  it("★★★ `updatedAt` tới được client — mục 'vừa đóng' sắp theo nó (C3)", async () => {
    const ra = await goiList();
    expect(ra[0].updatedAt).toEqual(HANG.updatedAt);
  });

  it("★★★ null phải đi qua NGUYÊN VẸN, không hoá thành undefined", async () => {
    // Khác biệt có thật với giao diện: `null` = "không có lý do"; `undefined` = "trường
    // này không tồn tại" và thường in ra chữ "undefined" trên màn hình.
    hangGia = [{ ...HANG, resolutionNotes: null, lastOccurredAt: null }];
    const ra = await goiList();
    expect(ra[0]).toHaveProperty("resolutionNotes");
    expect(ra[0].resolutionNotes).toBeNull();
    expect(ra[0].lastOccurredAt).toBeNull();
  });

  it("★★★ KHÔNG trường nào của hàng bị ĐÁNH RƠI — kiểm theo TẬP, không liệt kê tay", async () => {
    // Ca then chốt. Bốn ca trên khoá đúng những trường ĐÃ từng mất; ca này bắt trường
    // TIẾP THEO bị đánh rơi — thứ mà một danh sách viết tay không bao giờ đoán trước được.
    //
    // Vài trường đổi KIỂU có chủ đích (decimal → number qua `parseFloat`), nên chỉ so
    // TÊN chứ không so giá trị.
    const ra = await goiList();
    const thieu = Object.keys(HANG).filter((k) => !(k in ra[0]));
    expect(thieu, "trường có trong hàng CSDL nhưng KHÔNG tới client").toEqual([]);
  });
});

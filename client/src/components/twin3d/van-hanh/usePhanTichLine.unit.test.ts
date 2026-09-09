/**
 * Lưới cho T-1 **TẦNG 3** (`usePhanTichLine`) — §15.5.2 / Đợt 28.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐỐI CHỨNG CỦA TẦNG 3 — G5/G32
 * ════════════════════════════════════════════════════════════════════════════
 * Thứ một lần tách có thể làm mất mà **không cổng nào đỏ** ở tầng này là **sự
 * KHÁC NHAU giữa hai nhịp**. `check` xanh với cả hai bản, và mọi test hành vi
 * cũng vậy — vì cả hai nhịp đều là số hợp lệ.
 *
 * Nên tệp này đo đúng chỗ ấy: từng nhịp neo vào ĐÚNG thủ tục của nó. Một phép
 * đếm tổng ("có 2 refetchInterval") vẫn thoả được bằng hai nhịp **đặt nhầm
 * chỗ** — đúng bài học ĐB-9 ở `noiChoGoi.unit.test` (G9: "có ít nhất một"
 * không phải là "cả hai").
 *
 * ⚠ Giới hạn tự khai: phép đo VĂN BẢN trên mã nguồn (xem lý lẽ đầy đủ ở
 *   `useMoPhongTwin.unit.test.ts`). Nó không chứng minh hook fetch đúng; nó
 *   chặn đúng chế độ hỏng của một lần dời nhà.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

const HOOK = doc("src/components/twin3d/van-hanh/usePhanTichLine.ts");
const TRANG = doc("src/pages/TwinVanHanh.tsx");

/** Tước chú thích trước khi đo — xem `useMoPhongTwin.unit.test.ts`. */
const MA = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOOK_MA = MA(HOOK);

/**
 * ★★★ CẮT KHỐI THEO DẤU KẾT, KHÔNG THEO ĐỘ DÀI CỐ ĐỊNH.
 *
 * Bản đầu của tệp này cắt `slice(i, i + 400)` và ca "`wipFlowState` KHÔNG được
 * đóng băng" ĐỎ ngay lần chạy đầu — **không phải vì mã sai**: cửa sổ 400 ký tự
 * tính từ `wipFlowState` **tràn xuống** chỗ gọi `lineBalance` ngay bên dưới và
 * đọc luôn `NHIP_CO_LUONG_MS` của hàng xóm.
 *
 * Đây là lớp lỗi "phép đếm chỉ đúng trong phạm vi mẫu của nó" (G9) đội lốt một
 * hằng số vô hại. Nguy hiểm ở chiều NGƯỢC LẠI: cùng cửa sổ tràn ấy làm ca
 * "`lineBalance` KHÔNG được thích nghi hoá" có thể XANH GIẢ, vì nó đọc phải
 * đoạn mã của truy vấn kia. Nên cắt tới `);` kết thúc lời gọi, không đếm ký tự.
 */
const KET_GOI = String.fromCharCode(10) + "  );";
const khoiGoi = (src: string, moc: string) => {
  const i = src.indexOf(moc);
  if (i < 0) return "";
  const het = src.indexOf(KET_GOI, i);
  return src.slice(i, het < 0 ? src.length : het);
};

describe("★★★ TẦNG 3 — hai truy vấn ĐÃ RỜI TRANG và VẪN ĐƯỢC GỌI", () => {
  it("★★★ cả hai `useQuery` nằm trong hook, KHÔNG còn trong trang", () => {
    for (const thu of ["trpc.digitalTwin.wipFlowState.useQuery", "trpc.wip.lineBalance.useQuery"]) {
      expect(HOOK, `${thu}: không có trong hook`).toContain(thu);
      expect(TRANG, `${thu}: CÒN SÓT ở trang`).not.toContain(thu);
    }
  });

  it("★★★ trang GỌI hook theo TÊN HÀM và nhận CẢ HAI kết quả", () => {
    expect(TRANG).toContain("usePhanTichLine({ lineDangXem, nhipTongQuanMs })");
    expect(TRANG).toContain("const { wipQ, canBangQ } =");
  });

  it("★★★ kết quả vẫn CÓ NGƯỜI TIÊU THỤ — không tách rồi bỏ rơi (G16)", () => {
    // `wipQ` nuôi cột WIP 3D + bảng 2D; `canBangQ` nuôi nút thắt + nhịp chuyền
    // + đầu vào what-if. Mất chỗ dùng = tính năng giao số 0 mà cổng vẫn xanh.
    expect(TRANG).toContain("wipQ.isSuccess");
    expect(TRANG).toContain("canBangQ.data?.[0]");
    expect(TRANG).toContain("canBangQ.isSuccess");
  });
});

describe("★★★ TẦNG 3 — HAI NHỊP KHÁC NHAU phải giữ nguyên sự khác nhau", () => {
  it("★★★ ĐÍCH DANH: `wipFlowState` nhịp THÍCH NGHI, `lineBalance` nhịp CỐ ĐỊNH", () => {
    // Đây là ca trung tâm của tầng 3. Đếm tổng KHÔNG đủ: hai nhịp đặt nhầm chỗ
    // vẫn cho đúng 2 `refetchInterval` (G9/ĐB-9). Neo từng cái vào thủ tục.
    for (const [ten, moc, nhip] of [
      ["wipFlowState", "trpc.digitalTwin.wipFlowState.useQuery", "refetchInterval: nhipTongQuanMs"],
      ["lineBalance", "trpc.wip.lineBalance.useQuery", "refetchInterval: NHIP_CO_LUONG_MS"],
    ] as const) {
      expect(HOOK_MA.indexOf(moc), `${ten}: không tìm thấy chỗ gọi`).toBeGreaterThan(0);
      const khoi = khoiGoi(HOOK_MA, moc);
      expect(khoi, `${ten}: mất/đổi nhịp`).toContain(nhip);
    }
  });

  it("★★★ `lineBalance` KHÔNG được thích nghi hoá", () => {
    // Chiều hỏng thực tế: "dọn cho nhất quán" bằng cách cho cả hai dùng
    // `nhipTongQuanMs`. Khi socket chết nó hỏi 5 giây/lần để đọc lại ĐÚNG MỘT
    // HÀNG tổng hợp theo kỳ — tốn băng thông, không đổi một chữ số nào.
    const khoi = khoiGoi(HOOK_MA, "trpc.wip.lineBalance.useQuery");
    expect(khoi).not.toContain("nhipTongQuanMs");
    expect(khoi).not.toContain("nhipHoiToiDa");
  });

  it("★★★ `wipFlowState` KHÔNG được đóng băng thành hằng", () => {
    // Chiều hỏng ngược lại: cho WIP dùng nhịp cố định. WIP đổi theo từng chiếc
    // rời trạm; socket chết mà không rút ngắn thì màn đứng im một cách im lặng.
    const khoi = khoiGoi(HOOK_MA, "trpc.digitalTwin.wipFlowState.useQuery");
    expect(khoi).not.toContain("NHIP_CO_LUONG_MS");
  });
});

describe("★★★ TẦNG 3 — CỬA NGỮ NGHĨA `lineDangXem` còn nguyên trên CẢ HAI", () => {
  it("★★★ cả hai truy vấn TẮT khi không ở phạm vi line", () => {
    // Đếm, và neo. Mất cửa ⇒ thủ tục nhận `lineId: 0` (một chuyền không tồn
    // tại) và màn khai WIP của hư vô ở cấp Tầng/Xưởng.
    const soCua = (HOOK_MA.match(/enabled: lineDangXem !== null/g) ?? []).length;
    expect(soCua).toBe(2);
  });

  it("★★★ `?? 0` chỉ là chỗ giữ kiểu — KHÔNG phải cửa", () => {
    // `lineId: lineDangXem ?? 0` an toàn CHỈ VÌ `enabled` đã chặn. Nếu ai đó gỡ
    // `enabled` mà giữ `?? 0`, truy vấn bắn thật với chuyền 0.
    expect(HOOK_MA).toContain("lineId: lineDangXem ?? 0");
  });
});

describe("★★★ TẦNG 3 — G37 + tiền đề an toàn", () => {
  it("★★★ hook KHÔNG tự đọc route", () => {
    expect(HOOK_MA).not.toMatch(/useSearch\s*\(/);
    expect(HOOK_MA).not.toMatch(/useRoute\s*\(/);
  });

  it("★★★ TẦNG 3 KHÔNG gọi `nhipHoiToiDa` — nó không chạm trần an toàn", () => {
    // Tiền đề khiến tầng 3 an toàn để đi trước tầng 2. Nếu một ngày một truy
    // vấn hạng an toàn dọn về đây, tiền đề hết đúng và phải xét lại cùng luật
    // trần 20 s/60 s của tầng 2.
    expect(HOOK_MA).not.toContain("nhipHoiToiDa");
  });
});

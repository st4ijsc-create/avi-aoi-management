/**
 * Lưới cho T-1 **TẦNG 2** (`useTrangThaiSong`) — §15.5.2 / Đợt 28.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI PHÉP ĐO CHO MỘT LUẬT — VÀ VÌ SAO CẦN CẢ HAI
 * ════════════════════════════════════════════════════════════════════════════
 * `nhipAnToan.unit.test.ts` chứng minh **luật về con số**: `nhipHoiToiDa` với
 * trần đã khai không bao giờ trả ra giá trị vượt trần. Đó là phép đo mạnh nhất
 * vì nó đo GIÁ TRỊ THẬT, và nó bắt được đột biến `20_000 → 30_000`.
 *
 * Nhưng nó **không** trả lời được một câu: *truy vấn nào dùng trần nào?* Một
 * bản vá cho `andon.active` dùng `TRAN_NHIP_SUC_KHOE_MS` (60 s) sẽ giữ nguyên
 * mọi khẳng định của tệp kia — mọi con số vẫn ≤ trần của chính nó — trong khi
 * cảnh báo an toàn vừa chậm đi **gấp ba**.
 *
 * ⇒ Tệp này neo **từng trần vào từng thủ tục**. Đây đúng bài học ĐB-9
 *   (`noiChoGoi.unit.test.ts`): một phép đếm tổng vẫn thoả được bằng các trần
 *   **đặt nhầm chỗ**, nên "có đủ số lượng" không phải là "đúng chỗ" (G9).
 *
 * ⚠ Giới hạn tự khai: phép đo VĂN BẢN, cùng họ với `noiChoGoi.unit.test.ts`.
 *   Nó đo chỗ nối, không đo hành vi fetch. Cặp đôi (giá trị + chỗ nối) mới đủ.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

const HOOK = doc("src/components/twin3d/van-hanh/useTrangThaiSong.ts");
const TRANG = doc("src/pages/TwinVanHanh.tsx");

/** Tước chú thích trước khi đo — xem `useMoPhongTwin.unit.test.ts`. */
const MA = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOOK_MA = MA(HOOK);

/**
 * Cắt khối theo dấu kết lời gọi, KHÔNG theo độ dài — xem `usePhanTichLine.unit.test.ts`.
 *
 * ⚠ Ở tầng 2 có HAI kiểu đóng khác nhau và bản đầu của tệp này chỉ biết một:
 *   `useQuery(a, b)` đóng bằng `
  );`, còn `useQuery(undefined, {…})` đóng
 *   bằng `
  });`. Vì chỉ tìm dạng thứ nhất, cửa sổ của `andon.active` **tràn
 *   xuống** `anToanRobot` và ca "andon không có `enabled`" đỏ oan.
 *
 * ★ Nguy hiểm nằm ở chiều NGƯỢC LẠI (lần thứ ba trong đợt này): cùng cửa sổ
 *   tràn ấy có thể làm một ca `toContain` XANH GIẢ nhờ đọc đúng chữ mình tìm
 *   trong mã của truy vấn KẾ BÊN. Nên lấy dấu kết GẦN NHẤT trong hai dạng.
 */
const KET_GOI = [String.fromCharCode(10) + "  );", String.fromCharCode(10) + "  });"];
const khoiGoi = (src: string, moc: string) => {
  const i = src.indexOf(moc);
  if (i < 0) return "";
  const moc2 = KET_GOI.map((k) => src.indexOf(k, i)).filter((v) => v >= 0);
  return src.slice(i, moc2.length === 0 ? src.length : Math.min(...moc2));
};

describe("★★★ TẦNG 2 — bốn truy vấn ĐÃ RỜI TRANG và VẪN ĐƯỢC GỌI", () => {
  it("★★★ cả bốn `useQuery` nằm trong hook, KHÔNG còn trong trang", () => {
    for (const thu of [
      "trpc.factoryCommand.overview.useQuery",
      "trpc.andon.active.useQuery",
      "trpc.twinCanh.anToanRobot.useQuery",
      "trpc.twinCanh.sucKhoeMay.useQuery",
    ]) {
      expect(HOOK, `${thu}: không có trong hook`).toContain(thu);
      expect(TRANG, `${thu}: CÒN SÓT ở trang`).not.toContain(thu);
    }
  });

  it("★★★ trang GỌI hook theo TÊN HÀM và nhận CẢ BỐN kết quả", () => {
    expect(TRANG).toContain("useTrangThaiSong({");
    expect(TRANG).toContain("const { overviewQ, andonQ, anToanQ, sucKhoeQ } =");
  });

  it("★★★ kết quả vẫn CÓ NGƯỜI TIÊU THỤ — kể cả `refetch` thủ công (G16)", () => {
    // `.refetch()` là chỗ dễ rụng nhất khi dời nhà: nó không nằm trong JSX nên
    // mắt dễ bỏ qua, và mất nó thì nút "làm mới" im lặng không làm gì.
    expect(TRANG).toContain("void andonQ.refetch()");
    expect(TRANG).toContain("void overviewQ.refetch()");
    expect(TRANG).toContain("overviewQ.dataUpdatedAt");
    expect(TRANG).toContain("anToanQ.data?.robot");
    expect(TRANG).toContain("sucKhoeQ.data?.khai");
  });
});

describe("★★★ TẦNG 2 — TỪNG TRẦN NEO VÀO ĐÚNG THỦ TỤC CỦA NÓ", () => {
  it("★★★ ĐÍCH DANH: hai truy vấn hạng AN TOÀN mang trần 20 s", () => {
    // Đích danh, không đếm tổng: hai trần đặt nhầm chỗ (cả hai ở cùng một truy
    // vấn, hoặc đổi cho nhau với trần 60 s) vẫn cho đúng số lượng.
    for (const [ten, moc] of [
      ["andon.active", "trpc.andon.active.useQuery"],
      ["anToanRobot", "trpc.twinCanh.anToanRobot.useQuery"],
    ] as const) {
      const khoi = khoiGoi(HOOK_MA, moc);
      expect(khoi, `${ten}: không tìm thấy chỗ gọi`).not.toBe("");
      expect(khoi, `${ten}: MẤT trần an toàn`).toContain(
        "nhipHoiToiDa(coLuongDay, TRAN_NHIP_AN_TOAN_MS)",
      );
      // …và KHÔNG được mượn trần của hạng chậm hơn.
      expect(khoi, `${ten}: dùng nhầm trần SỨC KHOẺ (chậm gấp ba)`).not.toContain(
        "TRAN_NHIP_SUC_KHOE_MS",
      );
    }
  });

  it("★★★ ĐÍCH DANH: `sucKhoeMay` mang trần 60 s, KHÔNG mượn trần an toàn", () => {
    const khoi = khoiGoi(HOOK_MA, "trpc.twinCanh.sucKhoeMay.useQuery");
    expect(khoi).toContain("nhipHoiToiDa(coLuongDay, TRAN_NHIP_SUC_KHOE_MS)");
  });

  it("★★★ `overview` KHÔNG có trần — nó được phép chạy tới 30 s", () => {
    // Chiều ngược của luật: thêm trần cho số liệu tổng quan không làm gì hỏng
    // về an toàn, nhưng nó xoá mất sự PHÂN HẠNG — và chính sự phân hạng ấy là
    // thứ khiến trần 20 s có nghĩa. Ghim lại để phân hạng không lặng lẽ tan.
    const khoi = khoiGoi(HOOK_MA, "trpc.factoryCommand.overview.useQuery");
    expect(khoi).toContain("refetchInterval: nhipTongQuanMs");
    expect(khoi).not.toContain("nhipHoiToiDa");
  });

  it("★★★ KHÔNG còn số trần VIẾT CỨNG trong chỗ gọi — trần chỉ đến từ hằng", () => {
    // Số rải rác là thứ làm bất biến cũ phải đếm chính tả. Sau Đợt 28, mọi trần
    // đi qua hằng có tên; một chữ số ở chỗ gọi nghĩa là ai đó vừa mở lại đường
    // cũ.
    expect(HOOK_MA).not.toMatch(/nhipHoiToiDa\([^)]*\d{2}_\d{3}\)/);
  });

  it("★★★ ĐÚNG HAI truy vấn mang trần an toàn — không thừa, không thiếu", () => {
    // Bổ trợ cho ca đích danh: bắt trường hợp ai đó THÊM một truy vấn hạng an
    // toàn mà quên, hoặc gỡ một cái đi.
    const so = (HOOK_MA.match(/nhipHoiToiDa\(coLuongDay, TRAN_NHIP_AN_TOAN_MS\)/g) ?? []).length;
    expect(so).toBe(2);
  });
});

describe("★★★ TẦNG 2 — G37 + cửa `factoryId`", () => {
  it("★★★ hook KHÔNG tự đọc route và KHÔNG tự đọc trạng thái kết nối", () => {
    expect(HOOK_MA).not.toMatch(/useSearch\s*\(/);
    expect(HOOK_MA).not.toMatch(/useRoute\s*\(/);
    // `coLuongDay` phải là THAM SỐ: hook tự đọc socket thì hai màn nhúng cạnh
    // nhau sẽ có hai câu trả lời khác nhau cho cùng một câu hỏi.
    expect(HOOK_MA).not.toMatch(/coLuongTheoKetNoi\s*\(/);
    expect(HOOK).toContain("coLuongDay: boolean");
  });

  it("★★★ ba truy vấn theo nhà máy TẮT khi chưa chọn nhà máy", () => {
    // `andon.active` KHÔNG có `enabled` (nó không nhận `factoryId`) — đó là
    // hành vi nguyên bản và phải giữ: cảnh báo là toàn cục.
    const so = (HOOK_MA.match(/enabled: factoryId !== null/g) ?? []).length;
    expect(so).toBe(3);
    const khoiAndon = khoiGoi(HOOK_MA, "trpc.andon.active.useQuery");
    expect(khoiAndon).not.toContain("enabled:");
  });
});

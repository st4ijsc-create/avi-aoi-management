/**
 * Lưới cho T-1 **TẦNG 4** (`useMoPhongTwin`) — §15.5.2 / Đợt 28.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐỐI CHỨNG CỦA TẦNG 4 — G5/G32
 * ════════════════════════════════════════════════════════════════════════════
 * Refactor ĐÚNG thì **mọi phép đo giữ nguyên**. Nên tệp này không đo "hook chạy
 * được" (điều đó `check` đã nói); nó đo đúng thứ một lần tách có thể làm mất
 * mà **không cổng nào đỏ**: bốn luật `enabled`/reset đã trả giá để học.
 *
 * ⚠ Giới hạn tự khai — nói thẳng vì nó quyết định tệp này chứng minh được gì:
 *   đây là phép đo **VĂN BẢN** trên mã nguồn, cùng họ với `noiChoGoi.unit.test`.
 *   Dựng `useMoPhongTwin` thật trong jsdom đòi một `trpc` provider + QueryClient,
 *   và khi ấy thứ được đo là **dàn mock** chứ không phải luật (G20: *"xoá sạch
 *   mã sản phẩm, test này có đỏ không?"* — với dàn mock đủ dày, câu trả lời là
 *   KHÔNG). Phép đo văn bản thì trả lời được: xoá luật ⇒ đỏ.
 *   Nó **không** chứng minh hook render đúng; nó chặn đúng chế độ hỏng đã xảy
 *   ra thật — một luật `enabled` biến mất trong lúc dời nhà.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

const HOOK = doc("src/components/twin3d/van-hanh/useMoPhongTwin.ts");
/**
 * ★★★ Đợt 34 (QĐ-24) — TRANG GỌI HOOK NAY LÀ `TwinLine.tsx`, KHÔNG còn `TwinVanHanh.tsx`.
 *   Đo Đợt 33 K11: sau QĐ-23 `/twin` không bao giờ ở cấp Line ⇒ `lineDangXem` luôn `null` ⇒ ngăn chỉ
 *   nói `chua_chon_line`; `/twin/line/:id` lại 0 ngăn ⇒ tính năng #30/#35 mất lối vào. Hook nhận
 *   `lineDangXem` qua tham số (G37) nên dời được nguyên vẹn — mọi luật `enabled`/reset dưới đây đo trên
 *   HOOK, không đổi; chỉ chỗ gọi đổi. `TRANG_CU` giữ lại để ghim chiều NGƯỢC (không còn hai bản chạy).
 */
const TRANG = doc("src/pages/TwinLine.tsx");
const TRANG_CU = doc("src/pages/TwinVanHanh.tsx");

/**
 * ★★★ BỎ CHÚ THÍCH TRƯỚC KHI ĐO — thiết bị đo tự bắn vào chân mình.
 *
 * Ba ca đầu tiên của tệp này ĐỎ ở lần chạy đầu, và **không phải vì mã sai**:
 * docblock của `useMoPhongTwin.ts` có nhắc chữ `useSearch()`, `refetchInterval`
 * và `coQuyenXemQuyTrinh` để GIẢI THÍCH vì sao chúng vắng mặt. Phép đo văn bản
 * thô đọc cả lời giải thích lẫn mã, rồi kết luận ngược.
 *
 * Đây đúng lớp lỗi "âm-tính-giả nằm ở THIẾT BỊ ĐO": nếu ba ca ấy được vá bằng
 * cách xoá chữ khỏi chú thích, tệp này sẽ xanh trong khi **vẫn không đo được**
 * chuyện mã có `useSearch()` hay không. Nên vá đúng chỗ: đo trên MÃ, sau khi
 * tước chú thích.
 */
const MA = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOOK_MA = MA(HOOK);

describe("★★★ TẦNG 4 — ba truy vấn mô phỏng ĐÃ RỜI TRANG và VẪN ĐƯỢC GỌI", () => {
  it("★★★ cả ba `useQuery` nằm trong hook, KHÔNG còn trong trang", () => {
    for (const thu of [
      "trpc.digitalTwin.whatIf.useQuery",
      "trpc.orchestration.listWorkflows.useQuery",
      "trpc.orchestration.simulate.useQuery",
    ]) {
      expect(HOOK, `${thu}: không có trong hook`).toContain(thu);
      // G16 chiều ngược: còn sót ở trang = tách nửa vời, hai bản cùng chạy.
      expect(TRANG, `${thu}: CÒN SÓT ở trang`).not.toContain(thu);
      expect(TRANG_CU, `${thu}: CÒN SÓT ở /twin`).not.toContain(thu);
    }
  });

  it("★★★ trang GỌI hook theo TÊN HÀM — không chỉ import tệp", () => {
    // Bẫy G16 nguyên bản (L-1, Đợt 7): grep theo TÊN TỆP báo "đã nối" trong khi
    // grep theo TÊN HÀM ra 0. Đo tên hàm tại chỗ gọi.
    expect(TRANG).toContain("useMoPhongTwin({");
    expect(TRANG).toContain('from "@/components/twin3d/van-hanh/useMoPhongTwin"');
    // ★ Đợt 34 (QĐ-24): màn Line truyền ĐÚNG `lineId` của route làm `lineDangXem` — không còn nhánh
    //   `phamVi.cap === "line" ? … : null`, tức không còn đường nào ra `chua_chon_line` ở màn này.
    expect(TRANG).toContain("lineDangXem: lineId");
    expect(TRANG).toContain("<NganMoPhong");
    // Chiều ngược (G5): `/twin` KHÔNG còn gọi — mã, không phải chú thích.
    const MA_CU = TRANG_CU.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(MA_CU).not.toContain("useMoPhongTwin({");
    expect(MA_CU).not.toContain("<NganMoPhong");
  });

  it("★★★ Đợt 34 (QĐ-24) — `?thu=moPhongMo` đọc ở VỎ (G37) rồi TRUYỀN xuống thân làm trạng thái ban đầu", () => {
    // Cùng khoá `thu=` và cùng tên chiều-ngược `moPhongMo` của Đợt 23 M2 (G40: không đẻ khoá thứ bảy).
    expect(TRANG).toContain('docTrangThaiUrl(search).thu.includes("moPhongMo")');
    expect(TRANG).toContain("moPhongMoBanDau={moPhongMoBanDau}");
    expect(TRANG).toContain("useState(moPhongMoBanDau)");
  });

  it("★★★ mọi giá trị hook trả về đều CÓ NGƯỜI TIÊU THỤ ở trang", () => {
    // Một hook trả 7 thứ mà trang chỉ dùng 5 nghĩa là hai tính năng vừa lặng lẽ
    // rụng. Neo từng cái vào chỗ dùng thật.
    for (const ten of ["whatIfQ", "dsWorkflowQ", "phatLaiQ", "daBamChay", "workflowRef"]) {
      expect(TRANG, `${ten}: hook trả ra mà trang không dùng`).toContain(ten);
    }
    expect(TRANG).toContain("onChayWhatIf={() => datDaBamChay(true)}");
    expect(TRANG).toContain("onDoiWorkflow={datWorkflowRef}");
  });
});

describe("★★★ TẦNG 4 — BỐN LUẬT `enabled`/reset phải sống sót lần dời nhà", () => {
  it("★★★ `whatIf` giữ CỬA GẤP ĐÔI: đầu vào dựng được VÀ đã bấm Chạy", () => {
    // Mất vế `daBamChay` ⇒ mở màn là chạy mô phỏng. Mất vế `dungWhatIf.chay` ⇒
    // zod ném 400 cho một trạng thái hoàn toàn bình thường.
    expect(HOOK).toContain("enabled: dungWhatIf.chay && daBamChay");
  });

  it("★★★ đối số GIẢ khi chưa chạy vẫn còn — `enabled:false` KHÔNG miễn zod", () => {
    expect(HOOK).toContain("{ stations: [{ stationId: 0, cycleTimeSec: 1 }], horizonHours: 1 }");
  });

  it("★★★ cờ 'đã bấm Chạy' HẠ XUỐNG khi đổi chuyền/tham số", () => {
    // Không có nó: kết quả của chuyền TRƯỚC nằm lại dưới nhãn chuyền MỚI — lời
    // khai sai mà KHÔNG lỗi nào nổ.
    const i = HOOK.indexOf("datDaBamChay(false)");
    expect(i, "mất useEffect hạ cờ").toBeGreaterThan(0);
    const khoi = HOOK.slice(i, i + 200);
    for (const khoa of ["lineDangXem", "horizonHours", "heSoCycle"]) {
      expect(khoi, `mất khoá reset ${khoa}`).toContain(khoa);
    }
  });

  it("★★★ `simulate` dùng `workflowRef !== null`, KHÔNG phải truthy", () => {
    // `""` là `workflowRef` hợp lệ về kiểu và phải KHÔNG bắn; `?? ""` chỉ là
    // chỗ giữ kiểu cho đối số, không phải cửa.
    expect(HOOK).toContain("coQuyenXemQuyTrinh && workflowRef !== null");
  });

  it("★★★ CỔNG QUYỀN còn nguyên trên CẢ HAI truy vấn orchestration", () => {
    // Đếm, không `toContain`: bài học ĐB-9 ở `noiChoGoi.unit.test` — một chuỗi
    // còn sót ở call site KIA đủ để thoả `toContain`, nên "có ít nhất một"
    // không phải là "cả hai" (G9).
    const soCong = (HOOK_MA.match(/enabled: coQuyenXemQuyTrinh/g) ?? []).length;
    expect(soCong).toBe(2);
  });
});

describe("★★★ TẦNG 4 — G37: hook KHÔNG tự đọc ngữ cảnh của trang cha", () => {
  it("★★★ KHÔNG `useSearch()` / `useRoute()` trong hook", () => {
    expect(HOOK_MA).not.toMatch(/useSearch\s*\(/);
    expect(HOOK_MA).not.toMatch(/useRoute\s*\(/);
  });

  it("★★★ KHÔNG tự gọi `hasPermission` — quyền đi vào qua THAM SỐ", () => {
    // Mảnh tự đọc quyền có thể bắn truy vấn người dùng không được phép gọi, và
    // 403 duy nhất hiện ra là một ngăn trống trông hệt "chưa có quy trình nào".
    expect(HOOK_MA).not.toMatch(/hasPermission\s*\(/);
    expect(HOOK).toContain("coQuyenXemQuyTrinh: boolean");
    // …và trang là nơi đọc quyền rồi truyền xuống.
    expect(TRANG).toContain('hasPermission("machine_monitoring", "canView")');
  });

  it("★★★ TẦNG 4 KHÔNG mang `refetchInterval` — nó không chạm nhịp an toàn", () => {
    // Đây là tiền đề khiến tầng 4 an toàn để đi trước. Nếu một ngày ai đó thêm
    // poll vào đây, tiền đề ấy hết đúng và phải xét lại cùng luật của tầng 2.
    expect(HOOK_MA).not.toContain("refetchInterval");
  });
});

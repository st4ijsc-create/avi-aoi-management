/**
 * F14 — ĐIỀU TRA DÂN SỐ lớp nợ MỚI: **chuỗi lỗi thô đi ra bằng cửa THÀNH CÔNG**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ BỐN CỔNG i18n LỖI ĐỀU XANH, ĐỀU THÀNH THẬT — VÀ ĐỀU MÙ VỚI LỚP NÀY
 * ══════════════════════════════════════════════════════════════════════════════════
 * Cả bộ máy i18n lỗi của dự án đứng trên một giả định chưa ai nói ra: **lỗi thì được NÉM**.
 *   • `appError()` + `errorFormatter` gắn `appCode` — chỉ cho thứ được ném;
 *   • `mapTrpcError` phía client — chỉ chạy trong `onError`;
 *   • `rawErrorCensus` (F3) — chỉ đếm `throw new Error(`;
 *   • `rawErrorMessageCensus` (F1) — chỉ quét `client/src`.
 *
 * Nhưng rất nhiều thủ tục **bắt lỗi rồi TRẢ VỀ nó như dữ liệu**:
 *     return { ok: false, latencyMs: 0, error: err.message }
 * Đó là phản hồi 200 OK. `onError` không chạy. `appCode` không tồn tại. Chuỗi tiếng Anh
 * của driver đi thẳng vào `res` rồi lên màn hình.
 *
 * ── BẰNG CHỨNG ĐO ĐƯỢC (2026-08-22) ─────────────────────────────────────────────
 * `DeviceOnboardingWizard.tsx` — CÙNG MỘT Ô, hai đường:
 *     onError:   setTestResult({ ok: false, …, error: mapTrpcError(e) })   ← ĐÃ DỊCH
 *     onSuccess: setTestResult(res)                                        ← `res.error` THÔ
 * Dòng 369 render `testResult.error`. Đường HAY XẢY RA hơn — driver không nối được, chuyện
 * thường ngày ở nhà máy — chính là đường chưa dịch: người vận hành đọc
 * *"ModbusDriver: not connected"*.
 *
 * ⇒ Bài học đáng giữ hơn con số: **một bất biến chỉ đúng trong phạm vi cái nó PHÁT BIỂU.**
 *   Không cổng nào ở trên nói dối; chúng chỉ chưa bao giờ nói gì về cửa "thành công".
 *
 * ── VÌ SAO BA NGÂN SÁCH TÁCH RIÊNG, KHÔNG PHẢI MỘT SỐ TỔNG ──────────────────────
 * Phép đo đầu ra 164 chỗ. Nhưng **95 chỗ trong đó là phản hồi REST** (`res.json`) — khách
 * hàng là MÁY và hệ tích hợp, tiếng Anh là quy ước ĐÚNG, dịch đi là phá hợp đồng API.
 * Gộp chung thì con số to hơn mà vô dụng: người đọc sẽ lập kế hoạch sửa cả những chỗ
 * SỬA LÀ HỎNG. Đây cũng là lý do cổng này không có một con số "tổng".
 */
import { describe, it, expect } from "vitest";
import { demDataError, duyetTs, DAU_MIEN_TRU } from "../../scripts/dataErrorStringScan.mjs";

/**
 * Kênh tRPC — tới thẳng màn hình người dùng. CHỈ ĐƯỢC GIẢM.
 * `20 → 18`: `deviceAdapter.testConnection` (2 chỗ) nay trả KÈM `errorCode` +
 * `errorParams`, client dịch qua `translateAppError`; chuỗi thô được GIỮ LẠI có chủ đích
 * làm dòng chi tiết kỹ thuật (`data-raw-ok:`) vì "ECONNREFUSED 10.0.0.5:502" là thứ duy
 * nhất nói được hỏng ở đâu. Trả CẢ HAI, không đánh đổi thông tin lấy ngôn ngữ.
 */
const ALLOWED_TRPC_DATA_ERROR = 18;

/**
 * Kênh service — cần TRUY VẾT từng chỗ mới biết nó nổi lên đâu (có chỗ chỉ vào log,
 * có chỗ đi tiếp vào phản hồi tRPC). CHỈ ĐƯỢC GIẢM. Mốc đo 2026-08-22: **49 chỗ**.
 *
 * ⚠ Đừng "trả" ngân sách này bằng cách đổi `.message` thành `String(err)` — cùng chuỗi
 *   tiếng Anh, chỉ khác cách viết. Ai làm vậy thì cổng xanh mà người dùng không đỡ hơn
 *   một chữ nào.
 */
const ALLOWED_SERVICE_DATA_ERROR = 49;

describe("F14 — chuỗi lỗi thô trả về như DỮ LIỆU (cửa THÀNH CÔNG)", () => {
  it("cầu chì: phép quét phải THẤY file, không thì nó đang canh tập rỗng", () => {
    expect(duyetTs("server").length).toBeGreaterThan(200);
  });

  it("★★★ cầu chì 2: bộ PHÂN LOẠI phải còn thấy kênh REST", () => {
    // Nếu phép nhận diện `res.json` hỏng, 95 chỗ REST sẽ bị xếp nhầm sang service/trpc và
    // hai ngân sách dưới đây ĐỎ — tức lưới tự bảo vệ. Nhưng nếu nó hỏng theo chiều NGƯỢC
    // (nhận nhầm mọi thứ là REST) thì hai ngân sách xanh một cách giả tạo. Ca này canh
    // đúng chiều nguy hiểm đó.
    const rest = demDataError().filter((x) => x.kenh === "rest");
    expect(rest.length).toBeGreaterThan(50);
    // ⚠ Bản đầu của ca này liệt kê ĐƯỜNG DẪN được phép chứa REST (`/routes/`,
    // `_core/index.ts`) và ĐỎ ngay: tuyến REST còn nằm ở `_core/oauth.ts`,
    // `_core/samlProvider.ts`, `_core/machineProxyError.ts`. Danh sách trắng theo đường
    // dẫn là thứ luôn lạc hậu.
    // Phép kiểm đúng phải nói về TÍNH CHẤT, và không được vòng quanh (không hỏi lại chính
    // bộ phân loại): **router tRPC không bao giờ gọi `res.json`** — nên nếu có chỗ nào
    // trong `server/routers/**` bị xếp là REST thì bộ phân loại đang nhận nhầm, và đó
    // đúng là chiều nguy hiểm (nhận nhầm thành REST ⇒ ngân sách xanh giả).
    expect(rest.filter((x) => x.file.includes("/routers/"))).toEqual([]);
  });

  it(`kênh tRPC còn tối đa ${ALLOWED_TRPC_DATA_ERROR} chỗ`, () => {
    const t = demDataError().filter((x) => x.kenh === "trpc");
    if (t.length > ALLOWED_TRPC_DATA_ERROR) console.error("[F14] nợ tRPC phình ở:", t.slice(0, 10));
    expect(t.length).toBeLessThanOrEqual(ALLOWED_TRPC_DATA_ERROR);
  });

  it("ngân sách tRPC phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(ALLOWED_TRPC_DATA_ERROR).toBe(demDataError().filter((x) => x.kenh === "trpc").length);
  });

  it(`kênh service còn tối đa ${ALLOWED_SERVICE_DATA_ERROR} chỗ`, () => {
    expect(demDataError().filter((x) => x.kenh === "service").length).toBeLessThanOrEqual(
      ALLOWED_SERVICE_DATA_ERROR,
    );
  });

  it("★★★ dấu miễn trừ phải KÈM LÝ DO — không cho tắt cổng bằng một từ", () => {
    expect(DAU_MIEN_TRU.test("// data-raw-ok")).toBe(false);
    expect(DAU_MIEN_TRU.test("// data-raw-ok: khách của tuyến này là máy")).toBe(true);
  });
});

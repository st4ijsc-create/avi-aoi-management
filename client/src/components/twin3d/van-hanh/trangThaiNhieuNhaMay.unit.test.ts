/**
 * trangThaiNhieuNhaMay.unit.test.ts — **PH-45 / PH-48**, nửa phía trình duyệt.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT ĐANG VÁ, BẰNG SỐ ĐO ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Sau Task 19/20, `?pv=tapdoan` nạp `napNhaMay.gui` (ba công ty QATD) cho truy
 * vấn HÌNH HỌC (`canhThietKe` + `toaNhaTangNhieuNhaMay`) nhưng ba truy vấn TRẠNG
 * THÁI vẫn hỏi một `factoryId`. Đo được (`.qa-tapdoan/t21-sau.json`, vai
 * `qatd_giamdoc`):
 *   · PH-45 — **737/1.108** máy được vẽ mà không có lời khai trạng thái ⇒ "chưa rõ";
 *   · PH-48 — thẻ `Metrics` in `"371 machines / Công ty A · Toà 1 · Tầng 1"`.
 *
 * ⇒ Hai triệu chứng, một gốc. Lưới này canh BA khớp nối mà bản vá tạo ra, cộng
 *   hai lời khai cũ phải chết theo.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ GIỚI HẠN TỰ KHAI — và vì sao lưới này vẫn đáng có
 * ════════════════════════════════════════════════════════════════════════════
 * Phần lớn ô dưới đây là phép đo **VĂN BẢN** (cùng họ `noiChoGoi.unit.test.ts`):
 * nó đo CHỖ NỐI, không đo hành vi fetch. Hàng rào thật và hành vi thật được đo ở
 * `server/routers/trangThaiNhieuNhaMayPhamVi.db.test.ts` (32 ca, CSDL thật) và
 * trên trình duyệt thật qua cổng 3064. Ba tầng, ba điểm mù khác nhau.
 *
 * ⚠ Ô văn bản dễ mù nhất ở chiều "đã nối chưa" (G16): một `factoryIds` khai
 *   trong interface mà KHÔNG chỗ nào truyền xuống vẫn cho hook biên dịch được và
 *   mọi cổng xanh. Nên mỗi khớp nối được đo ở CẢ HAI đầu — nơi khai và nơi gọi.
 */
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docMaNguon } from "@shared/testing/docMaNguon";

import { TRAN_NHA_MAY_MOT_LUOT, nhaMayDeNap, nhanTapNhaMay } from "./canhTapDoan";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const doc = (p: string) => docMaNguon(resolve(GOC, p));

const HOOK = doc("src/components/twin3d/van-hanh/useTrangThaiSong.ts");
const TRANG = doc("src/pages/TwinVanHanh.tsx");
const MAN_LINE = doc("src/pages/TwinLine.tsx");
const MAN_MAY = doc("src/pages/TwinMay.tsx");
const ROUTER_TWIN = doc("../server/routers/twinCanhRouter.ts");
const ROUTER_FC = doc("../server/routers/factoryCommandRouter.ts");

/** Tước chú thích trước khi đo — một `factoryIds` trong docblock KHÔNG phải mã nối. */
const MA = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HOOK_MA = MA(HOOK);
const TRANG_MA = MA(TRANG);

/**
 * Cắt khối một lời gọi theo dấu kết GẦN NHẤT — nguyên văn khuôn của
 * `useTrangThaiSong.unit.test.ts`. Dùng lại thay vì viết bản thứ hai: hai bộ cắt
 * lệch nhau sẽ cho hai ô cùng tên nói hai điều khác nhau (G12).
 */
const KET_GOI = [String.fromCharCode(10) + "  );", String.fromCharCode(10) + "  });"];
const khoiGoi = (src: string, moc: string) => {
  const i = src.indexOf(moc);
  if (i < 0) return "";
  const moc2 = KET_GOI.map((k) => src.indexOf(k, i)).filter((v) => v >= 0);
  return src.slice(i, moc2.length === 0 ? src.length : Math.min(...moc2));
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. `nhanTapNhaMay` — HÀM THUẦN, NỬA "NHÃN" CỦA PH-48                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-48 — `nhanTapNhaMay`: nhãn nói ĐÚNG TẬP mà mẫu số đếm trên", () => {
  const MUC = [
    { id: 41, nhan: "Công ty A" },
    { id: 42, nhan: "Công ty B" },
    { id: 43, nhan: "Công ty C" },
  ];

  it("★★★ ba nhà máy ⇒ nhãn nêu ĐỦ BA TÊN, theo đúng thứ tự `gui`", () => {
    // Ràng buộc KÍCH THƯỚC trước: một `MUC` rỗng sẽ làm mọi ô dưới tự thoả (G5).
    expect(MUC).toHaveLength(3);
    expect(nhanTapNhaMay([41, 42, 43], MUC)).toBe("Công ty A · Công ty B · Công ty C");
    // Thứ tự đi theo `gui`, KHÔNG theo thứ tự của `muc` — `gui` là thứ cảnh nạp.
    expect(nhanTapNhaMay([43, 41], MUC)).toBe("Công ty C · Công ty A");
  });

  it("★★★ ĐỐI CHỨNG — một nhà máy cho nhãn KHÁC ba nhà máy (không phải hằng)", () => {
    // Nếu hàm trả một chuỗi cố định ("Tập đoàn") thì mọi ô trên vẫn xanh được.
    expect(nhanTapNhaMay([41], MUC)).toBe("Công ty A");
    expect(nhanTapNhaMay([41], MUC)).not.toBe(nhanTapNhaMay([41, 42, 43], MUC));
  });

  it("★★★ mã không tra được TÊN bị BỎ, không hoá thành `#id`", () => {
    // `#99` không giúp ai nhận ra nhà máy nào; nó chỉ làm nhãn dài thêm và trông
    // như một sự thật. Bỏ đi là câu đúng hơn.
    expect(nhanTapNhaMay([41, 99], MUC)).toBe("Công ty A");
    expect(nhanTapNhaMay([41, 99], MUC)).not.toContain("99");
  });

  it("★★★ rỗng / toàn mã lạ ⇒ `null` (rỗng KHÁC chuỗi rỗng — NT-3.5)", () => {
    // `""` sẽ làm `BangKpiNoi` in một dòng nhãn TRỐNG; `null` làm nó không in gì.
    expect(nhanTapNhaMay([], MUC)).toBeNull();
    expect(nhanTapNhaMay([98, 99], MUC)).toBeNull();
  });

  it("★★★ hàm KHÔNG sửa đầu vào", () => {
    const gui = [41, 42];
    const muc = [...MUC];
    nhanTapNhaMay(gui, muc);
    expect(gui).toEqual([41, 42]);
    expect(muc).toHaveLength(3);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. HOOK — `factoryIds` ĐI TỚI ĐÚNG BA TRUY VẤN, VÀ CHỈ BA                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-45 — `useTrangThaiSong` nhận DANH SÁCH và truyền xuống ba truy vấn", () => {
  it("★★★ ô `factoryIds` CÓ trong tham số, và nó là TUỲ CHỌN (đường cũ không phải đổi)", () => {
    expect(HOOK).toContain("factoryIds?: readonly number[] | null;");
    expect(HOOK_MA).toContain("factoryIds,");
  });

  it("★★★ G16 — `factoryIds` KHÔNG chỉ được khai: nó dựng ĐÚNG MỘT đối số dùng chung", () => {
    // Chiều mù nhất của lưới văn bản: khai xong không nối. Ô này đòi có một biến
    // dẫn xuất TỪ `factoryIds`, và ô kế đòi đúng ba chỗ tiêu thụ nó.
    expect(HOOK_MA).toMatch(/const doiSoNhaMay =[\s\S]{0,200}factoryIds/);
  });

  it("★★★ ĐÍCH DANH: cả BA truy vấn theo nhà máy dùng `doiSoNhaMay`, mỗi cái một lần", () => {
    // Đếm tổng vẫn thoả được bằng ba lần dùng ở MỘT truy vấn (bài học ĐB-9/G9).
    for (const [ten, moc] of [
      ["overview", "trpc.factoryCommand.overview.useQuery"],
      ["anToanRobot", "trpc.twinCanh.anToanRobot.useQuery"],
      ["sucKhoeMay", "trpc.twinCanh.sucKhoeMay.useQuery"],
    ] as const) {
      const khoi = khoiGoi(HOOK_MA, moc);
      expect(khoi, `${ten}: không tìm thấy chỗ gọi`).not.toBe("");
      expect(khoi, `${ten}: KHÔNG nhận danh sách nhà máy`).toContain("doiSoNhaMay ??");
    }
    const so = (HOOK_MA.match(/doiSoNhaMay \?\?/g) ?? []).length;
    expect(so, "số chỗ tiêu thụ `doiSoNhaMay` không phải 3").toBe(3);
  });

  it("★★★ `andon.active` VẪN KHÔNG nhận nhà máy — nó là cảnh báo TOÀN PHẠM VI TÀI KHOẢN", () => {
    /*
     * ⚠ Chiều ngược của bản vá, và nó quan trọng không kém: `andon.active` cố ý
     *   không nhận `factoryId` (`andonRouter.ts:348-358`) để một màn giám sát
     *   không bao giờ tự nuốt cảnh báo của nhà máy khác. Thêm `doiSoNhaMay` vào
     *   đây nhân danh "cho nhất quán" là THU HẸP một dải an toàn.
     */
    const khoi = khoiGoi(HOOK_MA, "trpc.andon.active.useQuery");
    expect(khoi).not.toBe("");
    expect(khoi).not.toContain("doiSoNhaMay");
    expect(khoi).not.toContain("factoryIds");
  });

  it("★★★ danh sách RỖNG rơi về đường MỘT MÃ — không bao giờ gửi `factoryIds: []`", () => {
    // `[]` gặp Zod `.min(1)` ⇒ `BAD_REQUEST` ⇒ cả ba lớp trạng thái tắt CÂM.
    expect(HOOK_MA).toMatch(/factoryIds != null && factoryIds\.length > 0/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. TRANG — HỎI **CÙNG TẬP** VỚI TRUY VẤN HÌNH HỌC                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-45 — `/twin` truyền `napNhaMay.gui` cho CẢ hình học LẪN trạng thái", () => {
  it("★★★ trang truyền `factoryIds` vào hook", () => {
    const khoi = khoiGoi(TRANG_MA, "useTrangThaiSong({");
    expect(khoi).not.toBe("");
    expect(khoi, "hook có ô danh sách mà trang không truyền (G16)").toContain(
      "factoryIds: dsNhaMayTrangThai",
    );
  });

  it("★★★ ĐÚNG MỘT NGUỒN — `dsNhaMayTrangThai` đọc CHÍNH `napNhaMay.gui`", () => {
    /*
     * Đây là bất biến thật của PH-45: trạng thái và hình học phải hỏi CÙNG một
     * mảng. Một `factories.map(f => f.id)` dựng riêng ở đây trông vô hại nhưng là
     * nguồn sự thật thứ hai — nó bỏ qua trần 8 của `nhaMayDeNap`, và lúc ấy cảnh
     * vẽ 8 nhà máy trong khi trạng thái hỏi 12 (Zod ném, cả ba lớp tắt câm).
     */
    const i = TRANG_MA.indexOf("const dsNhaMayTrangThai");
    expect(i, "không tìm thấy `dsNhaMayTrangThai`").toBeGreaterThan(0);
    const khoi = TRANG_MA.slice(i, i + 400);
    expect(khoi).toContain("napNhaMay.gopKhuonVien");
    expect(khoi).toContain("napNhaMay.gui");
    expect(khoi, "cấp thường phải là `null`, KHÔNG phải `[factoryId]`").toContain("null");
  });

  it("★★★ CÙNG MỘT MẢNG với hai truy vấn hình học của Task 19/20", () => {
    // `canhThietKe` và `toaNhaTangNhieuNhaMay` đã hỏi `napNhaMay.gui` từ Task 19.
    expect(TRANG_MA).toContain("{ factoryIds: napNhaMay.gui }");
    expect(TRANG_MA).toContain("{ factoryIds: napNhaMay.gui, tangIds: tangIdsHoi }");
  });

  it("★★★ ĐỐI CHỨNG ÂM — `TwinLine`/`TwinMay` là màn MỘT nhà máy, KHÔNG được đổi", () => {
    /*
     * ⚠ Hai màn này gọi CÙNG hook. Nếu bản vá làm chúng gửi danh sách thì hai màn
     *   một nhà máy bắt đầu kéo dữ liệu của cả tập đoàn — vá quá tay theo chiều
     *   không ai nhìn. Ô này giữ chúng ĐỨNG YÊN.
     */
    for (const [ten, src] of [
      ["TwinLine", MA(MAN_LINE)],
      ["TwinMay", MA(MAN_MAY)],
    ] as const) {
      const khoi = khoiGoi(src, "useTrangThaiSong({");
      expect(khoi, `${ten}: không tìm thấy chỗ gọi hook`).not.toBe("");
      expect(khoi, `${ten}: đã bị kéo sang đường danh sách`).not.toContain("factoryIds");
    }
  });

  it("★★★ PH-48 — nhãn thẻ `Metrics` ở cấp Tập đoàn đi qua `nhanTapNhaMay`", () => {
    const i = TRANG_MA.indexOf("const nhanPhamViKpi");
    expect(i).toBeGreaterThan(0);
    const khoi = TRANG_MA.slice(i, i + 900);
    expect(khoi).toContain("napNhaMay.gopKhuonVien");
    expect(khoi).toContain("nhanTapNhaMay(napNhaMay.gui, mucNhaMay)");
    // …và nhánh cũ (nhà máy · toà · tầng) VẪN CÒN cho cấp thường.
    expect(khoi).toContain("mucToaNha.find");
    expect(khoi).toContain("mucTang.find");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 4. HAI LỜI KHAI CŨ PHẢI CHẾT THEO (QĐ-18)                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-45 — lời khai hạn chế cũ ĐÃ GỠ, không phải tắt", () => {
  it("★★★ `banner-trang-thai-mot-nha-may` và phép đếm nuôi nó KHÔNG còn trong mã chạy", () => {
    /*
     * ⚠ Đo trên mã ĐÃ TƯỚC CHÚ THÍCH: docblock giải thích vì sao banner chết VẪN
     *   được phép nhắc tên nó — và phải được phép, nếu không thì bản vá thành một
     *   lần gỡ CÂM và người đọc sau không biết chuyện gì đã xảy ra.
     */
    expect(TRANG_MA).not.toContain("banner-trang-thai-mot-nha-may");
    expect(TRANG_MA).not.toContain("soMayChuaCoTrangThaiSong");
    // …nhưng LÝ DO gỡ phải ĐỌC ĐƯỢC trong mã (cùng luật `banner-ha-cap` của Task 19).
    expect(TRANG).toContain("banner-trang-thai-mot-nha-may");
    expect(TRANG).toContain("QĐ-18");
  });

  it("★★★ ba khoá i18n của banner ấy gỡ ở CẢ BA locale — không để lại khoá mồ côi", () => {
    for (const loc of ["vi", "en", "zh"] as const) {
      const src = doc(`src/i18n/locales/${loc}.json`);
      // Ràng buộc kích thước trước: đọc nhầm một tệp rỗng sẽ làm ô này tự thoả.
      expect(src.length, `${loc}: tệp i18n quá ngắn, có thể đọc nhầm`).toBeGreaterThan(100_000);
      expect(src, `${loc}: còn khoá mồ côi`).not.toContain("trangThaiMotNhaMay");
      // …và một khoá LÁNG GIỀNG vẫn còn, chứng minh phép gỡ không cắt nhầm cả cụm.
      expect(src, `${loc}: cắt nhầm cụm banner`).toContain("nhaMayVuotTran");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 5. TRẦN CLIENT ↔ TRẦN SERVER (ba thủ tục MỚI)                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ PH-45 — trần nhà máy của BA thủ tục trạng thái khớp trần client", () => {
  it("★★★ `twinCanhRouter` khai trần bằng HẰNG CÓ TÊN, và giá trị khớp client", () => {
    /*
     * ⚠⚠ Ô chặn DRIFT, cùng khuôn ô "TRẦN CLIENT PHẢI KHỚP `.max()` CỦA SERVER" ở
     *   `canhTapDoan.unit.test.ts`. Ba truy vấn trạng thái và hai truy vấn hình học
     *   phục vụ CÙNG MỘT khung hình: hai trần khác nhau tạo ra một khoảng trong đó
     *   cảnh vẽ đủ 8 khối mà trạng thái chỉ về được 5 — tức PH-45 quay lại ở dạng
     *   nhỏ hơn và khó thấy hơn.
     */
    const khop = ROUTER_TWIN.match(/const TRAN_NHA_MAY_MOT_LUOT = (\d+);/);
    expect(khop, "không đọc được hằng trần của twinCanhRouter").not.toBeNull();
    expect(Number(khop![1])).toBe(TRAN_NHA_MAY_MOT_LUOT);
    // …và hằng ấy THẬT SỰ được dùng trong schema, không chỉ được khai.
    expect(ROUTER_TWIN).toContain(".min(1).max(TRAN_NHA_MAY_MOT_LUOT).optional()");
  });

  it("★★★ `factoryCommandRouter.overview` mang CÙNG trần", () => {
    const khop = ROUTER_FC.match(
      /factoryIds:\s*z\.array\(z\.number\(\)\.int\(\)\.positive\(\)\)\.min\(1\)\.max\((\d+)\)\.optional\(\)/,
    );
    expect(khop, "không đọc được trần `factoryIds` của overview").not.toBeNull();
    expect(Number(khop![1])).toBe(TRAN_NHA_MAY_MOT_LUOT);
  });

  it("★★★ ĐỐI CHỨNG — `nhaMayDeNap` cắt ĐÚNG ở trần ấy, và NÓI RA phần bị cắt", () => {
    // Nối trần server với hành vi client thật: quá trần thì client cắt TRƯỚC khi
    // gửi (và kêu), nên Zod không bao giờ phải ném cho một lượt xem hợp lệ.
    const day = Array.from({ length: TRAN_NHA_MAY_MOT_LUOT + 1 }, (_, i) => i + 41);
    const kq = nhaMayDeNap("tapDoan", day, 41);
    expect(kq.gui).toHaveLength(TRAN_NHA_MAY_MOT_LUOT);
    expect(kq.biCat).toBe(1);
  });
});

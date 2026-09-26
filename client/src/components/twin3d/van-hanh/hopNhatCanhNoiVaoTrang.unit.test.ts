/**
 * `hopNhatCanhNoiVaoTrang.unit.test.ts` — Đợt 29, **lỗ do chính đợt này đo ra**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI: BA ĐỘT BIẾN SỐNG SÓT CẢ 1998 TEST
 * ════════════════════════════════════════════════════════════════════════════
 * Sau khi nối `TwinVanHanh.tsx` vào `hopNhatCanh.ts`, ablation ở TRANG cho kết
 * quả **1998 passed** trên cả ba đột biến dưới đây — tức là **không phép đo nào
 * nhìn thấy trang nối module SAI**:
 *
 *   W1  `tangId: tangIdCuaDatCho` → `tangId`
 *       Phạm vi tính theo tầng ĐANG XEM thay vì tầng của HÀNG ĐẶT CHỖ. Máy đặt
 *       ở tầng khác sẽ được coi là "trong phạm vi" ⇒ tô đậm sai, và
 *       `mờ-12%-cho-ngoài-phạm-vi` (§10C) mất hiệu lực đúng ở chỗ nó cần nhất.
 *
 *   W2  `idDuocNap: new Set(tapDs.idMay)` → mọi máy
 *       Đúng lỗi **F2** mà `khuChoVaNhanLine.ts` đã trả giá để học: 373 máy của
 *       tầng khác dựng thành 373 khối trong khu chờ của tầng đang xem — một lời
 *       nói dối bằng hình khối, mà người dùng còn tin hơn chữ.
 *
 *   W3  `gopNhan(nhan, nhanLine)` → `gopNhan(nhan, [])`
 *       Nhãn tên chuyền (#54) biến mất khỏi cảnh. Không gì nổ.
 *
 * ⚠⚠ **Lưới của MODULE không cứu được chuyện này.** `hopNhatCanh.unit.test.ts`
 *    chứng minh các hàm ĐÚNG khi được gọi đúng; nó không thể biết trang gọi
 *    chúng bằng đối số nào. Đây chính là lớp lỗi "có mã + có test + không giao
 *    hàng" — và một lần tách khối làm nó DỄ XẢY RA HƠN, vì trước khi tách thì
 *    `tangId` và `tapDs.idMay` nằm ngay trong thân biểu thức, còn sau khi tách
 *    chúng thành **đối số truyền tay** — thêm đúng một chỗ để nối nhầm.
 *
 * ⇒ Nên cái giá của việc tách phải trả ngay tại đây: phép đo VĂN BẢN ghim ba
 *   khớp nối ấy. Hạng thấp hơn đo-bằng-giá-trị, nhưng nó là hạng CAO NHẤT có
 *   được cho một khớp nối nằm trong thân `useMemo` của một trang 3.5 nghìn dòng
 *   không dựng nổi trong `environment: "node"`.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");

/** G92 — TƯỚC CHÚ THÍCH trước khi đo: docblock của trang nhắc mọi tên ở dưới. */
const MA = docMaNguon(resolve(GOC, "src/pages/TwinVanHanh.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

/**
 * ★ Đợt 64 — đọc NGUYÊN VĂN, cố ý KHÔNG tước chú thích (khác `MA` ở trên).
 *
 * Hợp đồng "toà đã được dời sao cho góc trái-dưới của khuôn viên nằm ở `(0,0)`"
 * sống trong docblock của `KhuonVien.toaNha`, và chính nó là thứ làm neo `null`
 * ở nhánh khuôn viên trở nên hợp lệ. Tước chú thích ở đây sẽ làm ca W4 mất đúng
 * mảnh bằng chứng mà ngoại lệ của nó dựa vào.
 */
const MA_KHUON_VIEN = docMaNguon(resolve(GOC, "src/components/twin3d/van-hanh/canhTapDoan.ts"));

/**
 * Cắt thân một `useMemo` theo DẤU KẾT của chính nó, không theo độ dài cố định.
 * (Bài học `usePhanTichLine.unit.test.ts`: cửa sổ cố định đọc lấn hàng xóm và
 * cho ra một ca đỏ oan — hoặc tệ hơn, một ca xanh oan.)
 */
function than(tenBien: string): string {
  const i = MA.indexOf(`const ${tenBien} = useMemo`);
  expect(i, `không tìm thấy \`${tenBien}\` trong trang`).toBeGreaterThan(-1);
  const ketThuc = MA.indexOf("\n  );", i);
  const ketThuc2 = MA.indexOf("\n  }, [", i);
  const j = [ketThuc, ketThuc2].filter((k) => k > i).sort((a, b) => a - b)[0];
  expect(j, `không tìm thấy dấu kết của \`${tenBien}\``).toBeGreaterThan(i);
  return MA.slice(i, j);
}

describe("★★★ W1 — phạm vi phải tính theo tầng của HÀNG ĐẶT CHỖ", () => {
  it("`mayVe` truyền `tangIdCuaDatCho`, KHÔNG phải `tangId` của bộ chọn", () => {
    const t = than("mayVe");
    expect(t).toContain("tangId: tangIdCuaDatCho");
    // `tangId,` trần (shorthand của biến toàn cục) là chính đột biến W1.
    expect(t).not.toMatch(/\btangId,\s*$/m);
  });

  it("★ callback nhận tầng qua THAM SỐ, không đóng gói biến ngoài", () => {
    expect(than("mayVe")).toMatch(/trongPhamVi:\s*\(\s*mv\s*,\s*tangIdCuaDatCho\s*\)\s*=>/);
  });
});

describe("★★★ W2 — F2: khu chờ chỉ nhận máy của LƯỢT NẠP", () => {
  it("`idDuocNap` dựng từ `tapDs.idMay`, không từ toàn bộ `mayVanHanh`", () => {
    const t = than("mayKhuCho");
    expect(t).toContain("idDuocNap: new Set(tapDs.idMay)");
    expect(t).not.toMatch(/idDuocNap:\s*new Set\(mayVanHanh/);
  });

  it("★ neo khu chờ đi qua `mepMatBang(mayVe)` — cùng tập đang được VẼ", () => {
    expect(than("mayKhuCho")).toContain("mepMatBang(mayVe)");
  });
});

describe("★★★ W3 — nhãn Line không được rơi khỏi lớp nhãn", () => {
  it("`nhanTatCa` gộp `nhan` VỚI `nhanLine`, không với hằng rỗng", () => {
    const t = than("nhanTatCa");
    expect(t).toContain("gopNhan(nhan, nhanLine)");
    expect(t).not.toMatch(/gopNhan\([^)]*,\s*\[\s*\]\s*\)/);
  });
});

describe("★ khớp nối còn lại — mỗi useMemo GỌI đúng hàm của nó", () => {
  it.each([
    ["mayVe", "dungMayVe("],
    ["mayKhuCho", "idMayChuaDat("],
    ["nhan", "dungNhanMay("],
    ["nhanTatCa", "gopNhan("],
    ["canhBao3D", "dungCanhBao3D("],
  ])("`%s` gọi `%s`", (bien, ham) => {
    expect(than(bien)).toContain(ham);
  });

  it("★★★ trang KHÔNG còn tự viết phép hoán vị trục (hai `mmSangMet` cùng dòng)", () => {
    const dongVietTay = MA.split("\n").filter(
      (d) => (d.match(/mmSangMet\(/g) ?? []).length >= 2,
    );
    expect(dongVietTay).toEqual([]);
  });

  it("★ hằng kích thước dự phòng dùng CHUNG, không viết lại số", () => {
    expect(MA).not.toMatch(/rongMm:\s*1000,\s*caoMm:\s*1800,\s*sauMm:\s*1000/);
    expect(MA).toContain("CO_DU_PHONG");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ Task 17c — HAI KHỚP NỐI MỚI, TỨC HAI BỀ MẶT LỖI MỚI (G93)              */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠⚠ Cùng lý do đã ghi ở đầu tệp: `hopNhatCanh.unit.test.ts` chứng minh
 *    `dungMayVe`/`gocToaTheoTang`/`tangIdsDeHoi` ĐÚNG khi được gọi đúng — nó
 *    **không biết trang gọi bằng đối số nào**. Task 17c thêm đúng hai chỗ nối
 *    tay, nên hai chỗ ấy phải được ghim ngay tại đây.
 *
 *    W4  `gocToaTheoTang: gocToa` bị bỏ khỏi `dungMayVe` ⇒ cảnh trở lại trạng
 *        thái không cộng gốc toà. Tệ hơn: truyền `new Map()` thì `tsc` XANH và
 *        mọi lưới module vẫn XANH — đúng lớp "mặc định mới là hàng rào".
 *
 *    W5  `tangIdsDeHoi(...)` bị thay lại bằng `.slice(0, 50)` ⇒ cắt IM LẶNG trở
 *        lại và banner không bao giờ hiện. Phần bị cắt biến mất không tiếng động.
 */
describe("★★★ W4 (Task 17c) — cảnh phải CỘNG GỐC TOÀ NHÀ", () => {
  it("`mayVe` truyền `gocToaTheoTang: gocToa`, KHÔNG phải một Map rỗng", () => {
    const t = than("mayVe");
    expect(t).toContain("gocToaTheoTang: gocToa");
    // Bản vá "cho qua kiểu" — `new Map()` tại chỗ gọi — là đột biến nguy hiểm
    // nhất vì nó xanh ở MỌI cổng khác.
    expect(t).not.toMatch(/gocToaTheoTang:\s*new Map\(\s*\)/);
  });

  it("★ `gocToa` dựng bằng `gocToaTheoTang(...)` và NEO vào toà đang chọn", () => {
    const t = than("gocToa");
    expect(t).toContain("gocToaTheoTang(");
    expect(t).toContain("toaNhaId");

    /* ════════════════════════════════════════════════════════════════════════
     * ★★★ ĐỢT 64 (Task 19) — LỆNH CẤM ĐƯỢC THU HẸP, CHỦ ĐỢT PHÂN XỬ.
     * ════════════════════════════════════════════════════════════════════════
     * Bản Task 17c cấm MỌI `gocToaTheoTang(…, null)` với lý do: "neo `null`
     * (toạ độ tuyệt đối) sẽ đẩy máy ra khỏi mặt sàn, vì `CanhVanHanh.San` vẽ ở
     * gốc toạ độ và không nhận vị trí toà".
     *
     * Lệnh cấm ấy viết theo HÌNH DẠNG MÃ, nên nó bắt cả một ca hợp lệ mà Task 19
     * sinh ra. TIỀN ĐỀ của nó đã được xử lý **ở đúng chỗ nó nói**, và đo được:
     *   (1) `khuonVienTapDoan` dời mọi toà sao cho góc trái-dưới của khuôn viên
     *       nằm ở `(0, 0)` — xem docblock `KhuonVien.toaNha`. Toạ độ "tuyệt đối"
     *       ở nhánh này là tuyệt đối TRONG KHUNG ĐÃ DỜI, không phải toạ độ CSDL.
     *   (2) `sanRongMm`/`sanSauMm` (TwinVanHanh:2786-2787) nay lấy từ
     *       `khuonVien.rongMm`/`sauMm` khi đang ở chế độ khuôn viên, nên sàn
     *       trải đúng bằng khuôn viên chứ không bằng một tầng.
     * Neo vào MỘT toà ở nhánh khuôn viên mới là cái sai: nó đẩy nhà máy C ra
     * khỏi sàn. Tức hai nhánh cần hai neo NGƯỢC nhau.
     *
     * Vì vậy lệnh cấm được THU HẸP về đúng nhánh nó bảo vệ, và kèm hai khẳng
     * định DƯƠNG cho nhánh mới — bỏ một trong hai là mất chỗ đứng của ngoại lệ.
     */
    // ① nhánh MỘT TOÀ vẫn tuyệt đối không được neo `null`.
    expect(t).not.toMatch(/gocToaTheoTang\(\s*dsTang\s*,[^)]*,\s*null\s*\)/);
    // ② nhánh khuôn viên neo `null` — và chỉ hợp lệ vì hai điều dưới đây.
    expect(t).toMatch(/gocToaTheoTang\(\s*kvTang\s*,\s*khuonVien\.toaNha\s*,\s*null\s*\)/);
    // ③ toà đã được dời về gốc khuôn viên (nguồn của tính hợp lệ, ở tệp kia).
    expect(MA_KHUON_VIEN).toContain("góc trái-dưới của khuôn viên nằm ở `(0, 0)`");
    // ④ sàn lấy kích thước từ KHUÔN VIÊN, không từ một tầng — nếu ai đó trả về
    //    `tangDau.rongMm` thì neo `null` lập tức thành cái lỗi Task 17c đã cấm.
    expect(MA).toContain("khuonVien !== null ? khuonVien.rongMm :");
    expect(MA).toContain("khuonVien !== null ? khuonVien.sauMm :");
  });

  it("★★★ trang KHÔNG tự viết phép cộng gốc toà — một luật, một chỗ", () => {
    // Một bản sao thứ hai của phép cộng ở trang sẽ lệch với `hopNhatCanh.ts` và
    // không cổng nào đỏ (cùng lý lẽ với phép hoán vị trục ở ca trên).
    expect(MA).not.toMatch(/viTriXMm\s*\+\s*/);
    expect(MA).not.toMatch(/\+\s*toaNhaDangChon\?\.viTriXMm/);
  });
});

describe("★★★ W5 (Task 17c) — trần tầng: KHÔNG được cắt im lặng", () => {
  it("★★★ `.slice(0, 50)` đã BIẾN MẤT khỏi trang", () => {
    // Đây là chính lỗi: `slice` vứt 34/84 tầng mà không một dòng nào kêu.
    expect(MA).not.toMatch(/\.slice\(\s*0\s*,\s*50\s*\)/);
  });

  it("`tangIdsHoi` đi qua `tangIdsDeHoi`, và trang giữ lại phần BỊ CẮT", () => {
    expect(MA).toContain("tangIdsDeHoi(");
    // Giữ cả đối tượng (`tangDeHoi`) chứ không chỉ `.gui`: không giữ thì con số
    // bị cắt không tồn tại để mà nói ra.
    expect(MA).toMatch(/const tangDeHoi\s*=/);
    expect(MA).toContain("tangDeHoi.gui");
  });

  it("★★★ có BANNER nói ra, và nó gắn vào con số bị cắt — không phải một cờ hằng", () => {
    expect(MA).toContain('testId: "banner-tang-vuot-tran"');
    expect(MA).toMatch(/hien:\s*tangDeHoi\.biCat\s*>\s*0/);
    // Một banner `hien: true` luôn hiện, hoặc `hien: false` không bao giờ hiện,
    // đều xanh ở ca "có banner". Ràng buộc vào `biCat` là thứ phân biệt chúng.
    expect(MA).not.toMatch(/testId: "banner-tang-vuot-tran"[\s\S]{0,200}?hien:\s*(true|false)\b/);
  });

  it("★★★ banner nêu ĐỦ BA con số thật — cần / trần / thiếu", () => {
    // "Dữ liệu có thể chưa đủ" là một câu không hành động được. Người dùng phải
    // đọc được CẦN bao nhiêu, TRẦN bao nhiêu, THIẾU bao nhiêu.
    const i = MA.indexOf('testId: "banner-tang-vuot-tran"');
    expect(i).toBeGreaterThan(-1);
    const khoi = MA.slice(i, i + 900);
    expect(khoi).toContain("twin3d.vanHanh.tangVuotTran");
    expect(khoi).toContain("tong: tangDeHoi.tong");
    expect(khoi).toContain("tran: tangDeHoi.tran");
    expect(khoi).toContain("thieu: tangDeHoi.biCat");
  });

  it("★★★ CHỮ người dùng đọc CÓ ĐỦ ba ô thay số, ở CẢ BA ngôn ngữ", () => {
    // Đo bản dịch THẬT, không đo khoá: một bản dịch thiếu `{{thieu}}` cho ra một
    // câu cảnh báo không nói được thiếu bao nhiêu — cổng i18n không bắt việc
    // banner mất nghĩa, nó chỉ so khớp ô thay số giữa ba tệp.
    for (const ngu of ["vi", "en", "zh"] as const) {
      const json = JSON.parse(docMaNguon(resolve(GOC, `src/i18n/locales/${ngu}.json`)));
      const cau = json.twin3d?.vanHanh?.tangVuotTran;
      expect(cau, `thiếu khoá tangVuotTran ở ${ngu}.json`).toBeTruthy();
      for (const o of ["{{tong}}", "{{tran}}", "{{thieu}}"]) {
        expect(cau, `${ngu}.json thiếu ${o}`).toContain(o);
      }
    }
  });
});

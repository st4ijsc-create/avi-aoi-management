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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");

/** G92 — TƯỚC CHÚ THÍCH trước khi đo: docblock của trang nhắc mọi tên ở dưới. */
const MA = readFileSync(resolve(GOC, "src/pages/TwinVanHanh.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

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

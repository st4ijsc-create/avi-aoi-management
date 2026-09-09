/**
 * `hopNhatCanhKhongTachThem.unit.test.ts` — **G91**: biến ba câu TỪ CHỐI của
 * Đợt 29 thành phép đo CHẠY ĐƯỢC, thay vì ba dòng trong báo cáo sẽ bay hơi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT LỜI TỪ CHỐI PHẢI LÀ MỘT LƯỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Đợt 28 đã trả giá cho bài học này (`tang1KhongTachDuoc.unit.test.ts`): một
 * câu "phần X không tách được vì Y" nằm trong báo cáo sẽ **không sống sót** đến
 * đợt sau. Đợt sau đọc mã, thấy X trông tách được, tách nó, và Y quay lại.
 * Một lưới thì ĐỎ khi ai đó làm điều mà lý lẽ cấm.
 *
 * ⚠ Ba ca dưới đây đo LÝ LẼ, không đo hành vi người dùng. Chúng là phép đo VĂN
 *   BẢN — hạng thấp hơn `hopNhatCanh.unit.test.ts` (đo giá trị trả về thật).
 *   Chúng chỉ được dùng cho những câu mà giá trị trả về **không nói được**.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(resolve(GOC, p), "utf8");

/** G92 — TƯỚC CHÚ THÍCH trước khi đo. Docblock của tệp này nhắc mọi tên ở dưới. */
const MA = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TRANG = MA(doc("src/pages/TwinVanHanh.tsx"));
const KHOI = MA(doc("src/components/twin3d/van-hanh/hopNhatCanh.ts"));
const WIP = MA(doc("src/components/twin3d/van-hanh/wipTram.ts"));

describe("★ TỪ CHỐI 1 — `cotWipCanh`/`bangWip`/`nhipChuyenMs` ĐÃ tách rồi", () => {
  /**
   * Brief Đợt 29 liệt ba tên này như phần "cần tách". Đo lại thì chúng **đã** là
   * lời gọi MỘT DÒNG tới hàm thuần của `wipTram.ts`. Kéo chúng qua `hopNhatCanh`
   * chỉ thêm một lớp bọc không mang bất biến nào — và một lớp bọc rỗng là chỗ
   * cho phiên bản thứ hai của cùng một luật mọc lên (G12).
   */
  it("ba hàm thuần SỐNG ở `wipTram.ts`, không ở `hopNhatCanh.ts`", () => {
    for (const ten of ["cotWip", "xepHangWip", "nhipTuCanBang"]) {
      expect(WIP).toMatch(new RegExp(`export function ${ten}\\b`));
      expect(KHOI).not.toMatch(new RegExp(`export function ${ten}\\b`));
    }
  });

  it("★ trang GỌI chúng chứ không CÀI LẠI chúng — thân useMemo là một lời gọi", () => {
    for (const [bien, ham] of [
      ["cotWipCanh", "cotWip"],
      ["bangWip", "xepHangWip"],
    ] as const) {
      const i = TRANG.indexOf(`const ${bien} = useMemo(`);
      expect(i, `${bien} phải còn ở trang`).toBeGreaterThan(-1);
      // Cắt tới dấu đóng của chính useMemo ấy, không cắt theo độ dài cố định
      // (bài học `usePhanTichLine.unit.test.ts`: cửa sổ cố định đọc lấn hàng xóm).
      const than = TRANG.slice(i, TRANG.indexOf("\n", TRANG.indexOf("]);", i)));
      expect(than).toContain(`${ham}(`);
      // Không có vòng lặp/nhánh ⇒ không có luật thứ hai nấp trong thân.
      expect(than).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|\bif\s*\(/);
    }
  });
});

describe("★★★ TỪ CHỐI 2 — `mayVeTatCa` PHẢI ở lại trang: nó là điểm nối, không phải phép biến đổi", () => {
  /**
   * `mayVeTatCa = [...mayVe, ...mayKhuCho]` trông như ứng viên tách hoàn hảo.
   * Nhưng `mayKhuCho` dựng bằng `xepKhuCho()` của `khuChoVaNhanLine.ts` — một
   * module ĐÃ tách. Gộp hai mảng đã dựng là ĐIỂM NỐI của trang, và một hàm
   * `gopMay(a, b)` một dòng chỉ đổi chỗ dấu `...` chứ không dời được bất biến
   * nào. Bất biến thật ("hai tập rời nhau") ĐÃ được đo ở `hopNhatCanh.unit.test`
   * bằng giá trị trả về — chỗ đúng của nó.
   */
  it("`xepKhuCho` vẫn là nguồn duy nhất của toạ độ khu chờ", () => {
    expect(KHOI).not.toContain("export function xepKhuCho");
    expect(MA(doc("src/components/twin3d/van-hanh/khuChoVaNhanLine.ts"))).toContain(
      "export function xepKhuCho",
    );
  });

  it("★ RB-4 — máy đặt + máy khu chờ vào CÙNG một lô vẽ, không hai lô", () => {
    expect(TRANG).toContain("const mayVeTatCa");
    // Một `<LoBatchMay` thứ hai = một `BatchedMesh` thứ hai = phá RB-4.
    expect((TRANG.match(/<LoBatchMay/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});

describe("★★★ TỪ CHỐI 3 — HOÁN VỊ TRỤC chỉ được viết ở MỘT chỗ", () => {
  /**
   * Đây là lời từ chối quan trọng nhất của đợt: từ chối **copy** phép hoán vị
   * sang màn Line và màn Machine. `heToaDo.ts` tự khai *"không nơi nào khác được
   * chia 1000"*; `hopNhatCanh.ts` gọi `mmSangScene()` thay vì viết tay ba lời
   * gọi `mmSangMet` như bản cũ trong trang.
   */
  it("`hopNhatCanh` dùng `mmSangScene`, KHÔNG tự dựng `{x:…,y:…,z:…}` từ ba mmSangMet", () => {
    expect(KHOI).toContain("mmSangScene(");
    // Chữ ký của phép hoán vị viết tay: ba `mmSangMet(` trên CÙNG một dòng.
    const dongVietTay = KHOI.split("\n").filter(
      (d) => (d.match(/mmSangMet\(/g) ?? []).length >= 2,
    );
    expect(dongVietTay).toEqual([]);
  });

  it("★ `neoTrenNoc` cộng chiều cao vào ĐÚNG một trục — và trục ấy là `y`", () => {
    const i = KHOI.indexOf("export function neoTrenNoc");
    const than = KHOI.slice(i, KHOI.indexOf("\n}", i));
    // caoMm chỉ được xuất hiện trong vế của `y`.
    expect(than).toMatch(/y:\s*m\.viTri\.y\s*\+\s*mmSangMet\(m\.kichThuocMm\.caoMm\)/);
    expect(than).toMatch(/x:\s*m\.viTri\.x\s*,/);
    expect(than).toMatch(/z:\s*m\.viTri\.z\s*,/);
    expect((than.match(/caoMm/g) ?? []).length).toBe(1);
  });
});

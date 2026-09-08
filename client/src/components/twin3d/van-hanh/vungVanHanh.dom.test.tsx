// @vitest-environment jsdom
//
/**
 * vungVanHanh.dom.test.tsx — ★★★ A-6 TRÊN MÀN VẬN HÀNH (§14.5.1, F-16, mục G-4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NGUỒN RỖNG — VÀ VÌ SAO ĐIỀU ĐÓ LÀM PHÉP ĐO KHÓ HƠN, KHÔNG DỄ HƠN
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được 2026-09-08 (lặp lại phép đo §11c.4 của Đợt 7, KHÔNG kế thừa lời khai):
 *
 *   twin_vat_the  = 4 hàng · TOÀN `loai='tuong'` · **0 hàng `loai='vung'`**
 *   (id 41–44, đều ở tầng 28: Tường Bắc/Nam/Tây/Đông)
 *
 * ⇒ Nếu chỉ mở `/twin` và nhìn, ta thấy **không vùng nào** — và màn hình đó
 *   TRÔNG Y HỆT nhau dù mã đúng hay hỏng hoàn toàn. Đó chính là G5/G22: *cổng
 *   xanh trên tập rỗng trùng khít cổng xanh của hệ đúng*. Cùng lớp lỗi mà
 *   §14.5.6 bắt `andon_events` (0 hàng `raised`) phải dựng ca dương bằng tay.
 *
 * ⇒ Nên lô này DỰNG CA DƯƠNG THẬT trong CSDL, đo, rồi KHÔI PHỤC BYTE-EXACT.
 *   Hàng ca dương (id 48, `LO-Z-CA-DUONG-TAM`, tầng 28, polygon 6000×4000 mm)
 *   đã được chèn, đọc lại qua đúng câu của `traVungAnToan`, và xoá; đối chứng
 *   `tong=4 maxid=44 md5=db6eb57633fdac7cd29b32af2a11da3b` khớp TRƯỚC và SAU.
 *
 * Tệp này ghim phần đo được **mà không cần CSDL**: đúng HÀNG THẬT đó, chạy qua
 * đúng chuỗi biến đổi mà màn Vận hành chạy, và khẳng định nó ra hình học vẽ được.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ G12 — TÁI DÙNG `LopVung`, KHÔNG VIẾT BẢN THỨ HAI
 * ════════════════════════════════════════════════════════════════════════════
 * `thiet-ke/vungAnToan.ts` (49 test) đã giải bẫy hoán vị trục và điểm đặt nhãn
 * vùng lõm. Việc của lô này là **đưa nó lên màn Vận hành**, nên phép đo phải
 * khẳng định đúng điều đó: cùng module, cùng hàm, chỉ khác chỗ dựng.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { polygonHopLe, vungTuDanhSach, vungTuHang, type HangVung } from "../thiet-ke/vungAnToan";

const GOC = resolve(__dirname, "../../../..");
const CANH = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/CanhVanHanh.tsx"), "utf8");

/**
 * ★★★ HÀNG THẬT — nguyên văn ca dương đã chèn vào `twin_vat_the` id 48.
 *
 * Không phải một polygon bịa cho vừa test: đây là hàng đã đi qua CSDL thật, đã
 * được `traVungAnToan` đọc ra (đo được: `48|LO-Z-CA-DUONG-TAM|#f59e0b|[[0,0],
 * [6000,0],[6000,4000],[0,4000]]`), rồi mới bị xoá để khôi phục.
 */
const HANG_THAT: HangVung = {
  id: 48,
  ten: "LO-Z-CA-DUONG-TAM",
  diemDa: [
    [0, 0],
    [6000, 0],
    [6000, 4000],
    [0, 4000],
  ],
  /*
   * ★ CHỈ `viTriZMm` — và đó là một sự thật về mô hình, không phải cắt gọt cho
   *   vừa test. `HangVung` (`vungAnToan.ts:73`) KHÔNG có `viTriXMm`/`viTriYMm`:
   *   mặt bằng của một vùng nằm TRONG chính `diemDa`, còn `viTriZMm` là CAO ĐỘ
   *   SÀN mà vùng đặt lên. Bản viết đầu của tôi bê nguyên ba cột của CSDL vào
   *   đây và `npm run check` bác bỏ — đúng việc của nó.
   */
  viTriZMm: 0,
  caoMm: null,
  mau: "#f59e0b",
  hienThi: true,
};

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("TẦNG 1 — chỗ nối A-6 trong cảnh VẬN HÀNH", () => {
  it("★★★ cảnh Vận hành DỰNG `<LopVung>` — đây là toàn bộ việc của mục G-4", () => {
    expect(CANH).toMatch(/<LopVung\s+vung=\{/);
    // Và nó tái dùng module của màn Thiết kế, không phải một bản chép.
    expect(CANH).toMatch(/import \{ LopVung \} from "\.\.\/thiet-ke\/LopVung"/);
  });

  it("★★★ VẬN HÀNH CHỈ ĐỌC — KHÔNG truyền `onChon` xuống vùng (NT-2)", () => {
    const dong = CANH.slice(CANH.indexOf("<LopVung"), CANH.indexOf("<LopVung") + 200);
    // Một cú bấm trúng vùng phải rơi xuống MÁY, không cướp selection.
    expect(dong).not.toContain("onChon");
  });

  it("`tatNhan` được chuyển tiếp — bậc `tat_nhan` của `matDoKhungHinh` tắt được cả nhãn vùng", () => {
    expect(CANH).toMatch(/<LopVung\s+vung=\{vungAT\}\s+tatNhan=\{tatNhan\}/);
  });

  it("★ vùng vẽ SÁT SÀN NHẤT — dưới cả vòng sức khoẻ, vì nó là NỀN bối cảnh", () => {
    const iVung = CANH.indexOf("<LopVung");
    const iVien = CANH.indexOf("<LopVienSucKhoe");
    const iMay = CANH.indexOf("<LoBatchMay");
    expect(iVung).toBeGreaterThan(-1);
    expect(iVung).toBeLessThan(iVien);
    expect(iVien).toBeLessThan(iMay);
  });

  it("`vung` là prop CÔNG KHAI — tầng trên có đường truyền vào", () => {
    expect(CANH).toMatch(/vung\?:\s*readonly VungVe\[\]/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("TẦNG 2 — CA DƯƠNG THẬT chạy qua đúng chuỗi biến đổi của màn Vận hành", () => {
  it("★★★ TIỀN ĐỀ G5/G22 — hàng thật CÓ polygon hợp lệ. Không có dòng này thì mọi test dưới đo trên rỗng", () => {
    expect(HANG_THAT.diemDa).not.toBeNull();
    expect(HANG_THAT.diemDa!.length).toBe(4);
    expect(
      polygonHopLe(HANG_THAT.diemDa!.map(([x, y]) => ({ xMm: x, yMm: y }))),
    ).toBe(true);
  });

  it("★★★ hàng THẬT của CSDL ⇒ MỘT vùng vẽ được — không `null`, không rỗng", () => {
    const v = vungTuHang(HANG_THAT);
    expect(v).not.toBeNull();
    expect(v!.khoa).toBe("vung:48");
    expect(v!.ten).toBe("LO-Z-CA-DUONG-TAM");
    expect(v!.dinh).toHaveLength(4);
  });

  it("★★★ diện tích ĐÚNG SỐ — 6000×4000 mm = 24 m², không phải 24.000.000", () => {
    const v = vungTuHang(HANG_THAT)!;
    // G9 (đơn vị của con số): mm² vs m² lệch nhau 10⁶ lần và cả hai "trông hợp lý".
    expect(v.dienTichM2).toBeCloseTo(24, 6);
  });

  it("★★★ BẪY HOÁN VỊ TRỤC — xMm→scene.x và yMm→scene.z, KHÔNG lẫn nhau", () => {
    const v = vungTuHang(HANG_THAT)!;
    // Polygon 6000 (theo x) × 4000 (theo y). Sau biến đổi: rộng 6 m theo X, 4 m theo Z.
    const xs = v.dinh.map((d) => d.x);
    const zs = v.dinh.map((d) => d.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 6);
    // ★ Nếu hoán vị thì hai số này ĐỔI CHỖ — và không có gì nổ, đúng lớp lỗi
    //   "tấm ván dựng đứng giữa xưởng" mà `LopVung` docblock cảnh báo.
    expect(Math.max(...xs) - Math.min(...xs)).not.toBeCloseTo(4, 6);
  });

  it("★ nhãn nằm TRONG vùng và NỔI TRÊN mặt — không bị chính mặt translucent nhuộm", () => {
    const v = vungTuHang(HANG_THAT)!;
    expect(v.nhan.x).toBeGreaterThan(0);
    expect(v.nhan.x).toBeLessThan(6);
    expect(v.nhan.z).toBeGreaterThan(0);
    expect(v.nhan.z).toBeLessThan(4);
    expect(v.nhan.y).toBeGreaterThan(v.caoDoY + v.dayM);
  });

  it("màu của hàng được GIỮ — không bị thay bằng mặc định", () => {
    expect(vungTuHang(HANG_THAT)!.mau).toBe("#f59e0b");
  });

  it("★★★ ABLATION — `hienThi=false` ⇒ KHÔNG vẽ. Chỉ báo phải biết KÊU", () => {
    expect(vungTuHang({ ...HANG_THAT, hienThi: false })).toBeNull();
  });

  it("★★★ ABLATION — polygon dưới 3 đỉnh ⇒ KHÔNG vẽ, không dựng mesh rác", () => {
    expect(
      vungTuHang({
        ...HANG_THAT,
        diemDa: [
          [0, 0],
          [1000, 0],
        ],
      }),
    ).toBeNull();
  });

  it("danh sách: hàng vẽ được và hàng không vẽ được TRỘN LẪN ⇒ chỉ cái vẽ được đi tiếp", () => {
    const ds: HangVung[] = [
      HANG_THAT,
      { ...HANG_THAT, id: 49, hienThi: false },
      { ...HANG_THAT, id: 50, diemDa: null },
    ];
    // Tiền đề: đầu vào có CẢ HAI loại, nếu không phép lọc không được đo.
    expect(ds).toHaveLength(3);
    const ra = vungTuDanhSach(ds);
    expect(ra).toHaveLength(1);
    expect(ra[0].khoa).toBe("vung:48");
  });

  it("★ ĐỐI CHỨNG NGUỒN RỖNG — danh sách rỗng ⇒ 0 vùng. Đây là TRẠNG THÁI THẬT của hệ hôm nay", () => {
    /*
     * Đo được: `twin_vat_the` có 0 hàng `loai='vung'`. Nên trên `/twin` thật, lớp
     * này render `null` và KHÔNG có vùng nào hiện — đúng, và phải nói ra.
     * Test này ghim rằng "0 vùng" là hệ quả của NGUỒN RỖNG, không phải của mã
     * hỏng: cùng mã đó, cho một hàng thật vào (ca dương ở trên) thì nó vẽ.
     */
    expect(vungTuDanhSach([])).toHaveLength(0);
  });
});

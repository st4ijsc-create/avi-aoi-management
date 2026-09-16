/**
 * nhanSaBanNoiVao.unit.test.ts — ★★★ GHIM **CHỖ NỐI** CỦA LUẬT ĐẶT NHÃN SA BÀN.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TỒN TẠI
 * ════════════════════════════════════════════════════════════════════════════
 * `datNhanSaBan.unit.test.ts` ghim LUẬT (hàm thuần). Nhưng một bộ luật đúng mà
 * không bề mặt nào gọi thì màn vẫn hỏng y như cũ, và **mọi ô lưới vẫn xanh** —
 * đúng lớp lỗi mà V-32 vừa bắt được ở đoạn `sr-only` của cảnh: xoá nó đi thì
 * `tsc` xanh, `i18n:check` xanh, 3.0xx ca twin3d xanh, người dùng mất sạch mô tả
 * cảnh mà không cổng nào kêu.
 *
 * Ở đây rủi ro ấy CAO HƠN bình thường vì hai lẽ đo được:
 *   ① jsdom KHÔNG dựng bố cục ⇒ `getBBox()`/`offsetWidth` đều 0 ⇒ toàn bộ nhánh
 *     đặt-nhãn rơi vào đường "thiếu dữ kiện, giữ nguyên neo" (G8). Không một ca
 *     DOM nào trong repo chạy được nhánh THẬT.
 *   ② Lớp 3D nằm trong `<Html>` của drei, thứ không render nổi trong jsdom.
 * ⇒ Phần duy nhất kiểm được ở tầng lưới là: **ai gọi ai, và màn có ĐẾM RA không**.
 *   Con số hành vi thật nằm ở trình duyệt (`.qa-tapdoan/n1-do.mjs`), đã chạy.
 *
 * ★ Và một bẫy đã MẮC THẬT trong chính lượt vá này, ghim lại để không tái sinh:
 *   bản đầu đo cỡ hộp chữ trong một `useEffect`. Nó chạy khi `ref` của các nhãn
 *   còn RỖNG (drei `<Html>` portal con ở lượt commit sau), nên `co = {0,0}` và
 *   phép trượt đặt tâm nhãn thiếu đúng nửa dòng chữ — `qatd_giamdoc` 3D "Toà 1"
 *   vẫn bị thẻ `Metrics` phủ 16,7 %, `qatd_kythuat` "Công ty A" 22,7 %.
 *   Lưới không thấy gì cả. Nay cỡ chữ đo LƯỜI, ngay trong vòng khung.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname);
const doc = (ten: string) => docMaNguon(resolve(GOC, ten));

const LUAT = doc("datNhanSaBan.ts");
const LOP_3D = doc("LopSaBan.tsx");
const CANH_2D = doc("CanhVanHanh2D.tsx");
const HOOK_2D = doc("nhanSaBan2D.ts");

describe("★★★ ① MỘT bộ luật, hai chế độ cùng gọi — không có bộ luật thứ hai", () => {
  it("bản 3D (`LopSaBan`) nhập và gọi `datNhanSaBan`", () => {
    expect(LOP_3D).toMatch(/import \{ datNhanSaBan[^}]*\} from "\.\/datNhanSaBan"/);
    expect(LOP_3D).toContain("datNhanSaBan(");
  });

  it("bản 2D đi qua hook, và hook gọi CHÍNH hàm ấy", () => {
    expect(CANH_2D).toMatch(/import \{ useDatNhanSaBan2D[^}]*\} from "\.\/nhanSaBan2D"/);
    expect(CANH_2D).toContain("useDatNhanSaBan2D(svgRef, nhanRef, mucNhan, oNhin)");
    expect(HOOK_2D).toMatch(/import \{ datNhanSaBan[^}]*\} from "\.\/datNhanSaBan"/);
    expect(HOOK_2D).toContain("datNhanSaBan(hopPx, co, [...vungCam, ...daDat], khung, m.uuTien)");
  });

  it("★ vùng cấm của CẢ HAI chế độ đọc từ CÙNG `layVungCam` — không chép bộ thứ hai", () => {
    expect(LOP_3D).toContain("layVungCam(gl.domElement)");
    expect(HOOK_2D).toContain("layVungCam(svg)");
    expect(HOOK_2D).toMatch(/import \{ layVungCam, THUOC_TINH_CHE_NHAN \} from "\.\.\/loi\/LopNhan"/);
  });

  it("★ chỉ ĐÚNG hai bề mặt gọi luật này — thêm bề mặt thứ ba phải là quyết định có ý thức", () => {
    const goi = [LOP_3D, HOOK_2D].filter((s) => s.includes("datNhanSaBan("));
    expect(goi).toHaveLength(2);
    expect(CANH_2D).not.toContain("datNhanSaBan(");
  });
});

describe("★★★ ② Nhãn bị ẩn phải ĐƯỢC ĐẾM RA — ở cả hai chế độ (§4)", () => {
  it("3D: `soNhan()` trả `ve + an === tong`, và tách rõ HAI lý do ẩn", () => {
    expect(LOP_3D).toContain("anVungCam");
    expect(LOP_3D).toContain("anNgoaiKhung");
    expect(LOP_3D).toMatch(/return \{ ve, an: anVungCam \+ anNgoaiKhung, anVungCam, anNgoaiKhung, tong: toa\.length \+ cum\.length \}/);
  });

  it("★★★ 3D: nhánh KHÔNG CHIẾU ĐƯỢC cũng phải cộng `an` — chỗ bộ đếm từng nói dối", () => {
    /*
     * Trước bản vá, cả hai nhánh `hopChieu === null` và `tam.z > 1` chỉ đặt
     * `display = "none"` rồi `return`. Ở `qatd_admin` (khuôn viên 30,8 km) điều
     * đó cho `soNhan() = {ve:0, an:0, tong:19}` trong khi **cả 19 nhãn** đều ẩn
     * và canvas ĐEN HOÀN TOÀN.
     */
    const nhanhAn = LUAT ? LOP_3D.match(/el\.style\.display = "none";\n(\s*)(anNgoaiKhung|anVungCam) \+= 1;/g) : null;
    expect(nhanhAn, "mọi nhánh ẩn nhãn đều phải cộng một bộ đếm").not.toBeNull();
    expect(nhanhAn!.length).toBeGreaterThanOrEqual(4);
    // …và không còn nhánh nào ẩn mà im lặng.
    const anImLang = LOP_3D.match(/el\.style\.display = "none";\n\s*return;/g) ?? [];
    expect(anImLang, `còn ${anImLang.length} nhánh ẩn nhãn KHÔNG đếm ra`).toHaveLength(0);
  });

  it("2D: số đếm nằm trên DOM (`lop-sa-ban-2d`), không cần `?do=1` mới đọc được", () => {
    expect(CANH_2D).toContain('data-nhan-ve={datNhan.dem.ve}');
    expect(CANH_2D).toContain('data-nhan-an={datNhan.dem.an}');
    expect(CANH_2D).toContain('data-nhan-tong={datNhan.dem.tong}');
    expect(HOOK_2D).toContain("dem: { ve, an: an.size, tong: ds.length }");
  });

  it("2D: nhãn bị ẩn dùng `visibility`, KHÔNG `display`/không-render — nếu không sẽ mất hộp chữ", () => {
    expect(CANH_2D).toContain('visibility: an ? ("hidden" as const) : undefined');
    expect(CANH_2D).toContain('"data-an": an ? "1" : "0"');
  });
});

describe("★★★ ②b Nhãn ĐÃ ĐẶT là vùng cấm của nhãn sau — hazard do CHÍNH bản vá sinh ra", () => {
  /*
   * Bản vá cứu được nhãn khỏi lớp phủ ⇒ thả THÊM chữ vào cùng khoảng trống. Đo:
   * cặp nhãn đè nhau có dính TÊN CÔNG TY tăng **1 → 5**, nặng nhất **437 px²**
   * (`qatd_quanly` "Công ty A" × "Toà 3"). Tức bản vá suýt hỏng đúng thứ nó bảo vệ.
   */
  it("3D: đặt CỤM TRƯỚC, TOÀ SAU — thứ tự là quyết định, không phải tình cờ", () => {
    const iCum = LOP_3D.indexOf("cum.forEach((c, i) => {", LOP_3D.indexOf("const daDat: HopPx[] = []"));
    const iToa = LOP_3D.indexOf("toa.forEach((v, i) => {", LOP_3D.indexOf("const daDat: HopPx[] = []"));
    expect(iCum).toBeGreaterThan(0);
    expect(iToa).toBeGreaterThan(0);
    expect(iCum, "nhãn cụm (tên công ty) phải giữ chỗ TRƯỚC nhãn toà").toBeLessThan(iToa);
  });

  it("2D: `mucNhan` xếp cụm trước toà — cùng luật ưu tiên", () => {
    const iCum = CANH_2D.indexOf("...saBanCum.map((c) => ({");
    const iToa = CANH_2D.indexOf("...saBan.map((v) => ({");
    expect(iCum).toBeGreaterThan(0);
    expect(iToa).toBeGreaterThan(0);
    expect(iCum).toBeLessThan(iToa);
  });

  it("cả hai chế độ đều nạp nhãn đã đặt vào vùng cấm", () => {
    expect(LOP_3D).toContain("[...vungCam, ...daDat]");
    expect(HOOK_2D).toContain("[...vungCam, ...daDat]");
    expect(LOP_3D).toContain("ghiDaDat(d, coCum);");
    expect(LOP_3D).toContain("ghiDaDat(d, coToa);");
  });

  it("★ nhãn CỤM chỉ tránh LỚP PHỦ, không tránh nhãn khác — nó là thứ giữ chỗ", () => {
    expect(LOP_3D).toContain('const d = datNhanSaBan(diem, coCum, vungCam, khung, "duoi");');
  });
});

describe("★★★ ③ Cỡ HỘP CHỮ phải đo được thật — cái bẫy đã mắc một lần", () => {
  it("3D đo LƯỜI trong vòng khung, không đo trong `useEffect` (ref của drei `<Html>` gắn muộn)", () => {
    expect(LOP_3D).toContain("doConThieu(oToaRef.current, coNhanRef.current.toa)");
    expect(LOP_3D).toContain("doConThieu(oCumRef.current, coNhanRef.current.cum)");
    // `useEffect` chỉ được phép XOÁ kho cỡ, không được đọc bố cục trong đó.
    expect(LOP_3D).toContain("coNhanRef.current = { toa: [], cum: [] };");
  });

  it("★ lượt ĐỌC bố cục đứng TRƯỚC mọi lượt ghi `style` — không xen kẽ (layout thrash)", () => {
    const iDoc = LOP_3D.indexOf("doConThieu(oToaRef.current");
    const iGhi = LOP_3D.indexOf("el.style.transform = `translate(-50%, -50%)");
    expect(iDoc).toBeGreaterThan(0);
    expect(iGhi).toBeGreaterThan(0);
    expect(iDoc).toBeLessThan(iGhi);
  });

  it("2D đo hộp chữ bằng `getBBox()` — thứ KHÔNG đổi theo `transform` của chính nó", () => {
    expect(HOOK_2D).toContain("el.getBBox()");
    expect(CANH_2D).toContain("transform: d ? `translate(${d.dx} ${d.dy})` : undefined");
  });
});

describe("★ ④ Thiếu bố cục ⇒ giữ nguyên bản cũ (G8) — đường mà jsdom và lưới DOM đi", () => {
  it("hook thoát sớm khi `<svg>` chưa có kích thước, KHÔNG ẩn ai", () => {
    expect(HOOK_2D).toContain("if (!(r.width > 0) || !(r.height > 0) || !(o.rong > 0) || !(o.sau > 0)) return;");
  });

  it("luật trả neo ưu tiên khi khung 0×0", () => {
    expect(LUAT).toContain("if (!(khung.rong > 0) || !(khung.cao > 0)) return { x: xDau, y: yDau, ma: maDau };");
  });
});

describe("★ ⑤ Lớp phủ DỜI CHỖ mà không đổi cỡ — bản 2D phải có cả hai cảm biến", () => {
  /** QA lần 10: panel thu rồi mở lại làm tay nắm trượt 288 px, `ResizeObserver` im lặng. */
  it("hook nghe cả `ResizeObserver` lẫn `transitionend`/`transitioncancel`", () => {
    expect(HOOK_2D).toContain("new ResizeObserver(");
    expect(HOOK_2D).toContain('document.addEventListener("transitionend", nghe, true)');
    expect(HOOK_2D).toContain('document.addEventListener("transitioncancel", nghe, true)');
    expect(HOOK_2D).toMatch(/import \{ taoBoNgheDoiCho \} from "\.\.\/loi\/theoDoiDoiCho"/);
  });

  it("có dọn: gỡ observer và gỡ listener khi rời màn", () => {
    expect(HOOK_2D).toContain("ro.disconnect();");
    expect(HOOK_2D).toContain('document.removeEventListener("transitionend", nghe, true)');
  });
});

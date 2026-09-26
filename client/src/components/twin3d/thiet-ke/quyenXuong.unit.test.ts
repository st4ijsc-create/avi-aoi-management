/**
 * quyenXuong.unit.test.ts — LƯỚI CHO PH-15 (QA lần 11, ô E6): *"Studio gác mọi
 * công cụ GHI bằng MỘT cờ `canEdit`, bỏ qua `canCreate`"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỖI ĐƯỢC ĐO — VAI CÓ SỬA MÀ KHÔNG CÓ TẠO VẪN THẤY NÚT TẠO
 * ════════════════════════════════════════════════════════════════════════════
 * `XuongThietKe.tsx:173` (bản cũ) `const coQuyenSua = quyenSettings.canEdit ||
 * quyenMayMoc.canEdit;` — **một cờ duy nhất** gác cả gizmo lẫn nút "Sinh tự
 * động" lẫn khối tải ảnh nền/model/bản ghi. `grep canCreate` trên cả
 * `thiet-ke/*.tsx` + `TwinStudio.tsx` = **0 dòng**.
 *
 * Server thì KHÔNG gác như thế (`server/routers/twinCanhRouter.ts`):
 *   · `dungNhaXuong` / `taiAnhNen` / `taiModelMay` / `luuBanGhi` → `canCreate`
 *   · `sinhTuDong` → **`adminProcedure`**
 *   · `luuHangLoat` / `luuVungAnToan` / `xuatBanBanGhi` → `canEdit`
 *   · `goKhoiMatBang` / `xoaVungAnToan` / `xoaBanGhi` → `canDelete`
 *
 * Đo được (`qatd_quanly`: có `machine_control` V+E, **canCreate = false**):
 * `nut-mo-sinh` "Generate" **render + enabled**, và tab "Add building" đi hết 3
 * bước tới `nut-tao` "Create building" **render + enabled** ⇒ người dùng bấm
 * xong mới nhận 403. Đúng lớp lỗi *"một lối vào rồi TỪ CHỐI"* (họ G149).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ BẢNG NÚT × CỔNG SERVER LÀ MỘT BẤT BIẾN ĐỌC TỪ ĐĨA, KHÔNG PHẢI LỜI KHAI
 * ════════════════════════════════════════════════════════════════════════════
 * Khối ④ dưới đây MỞ `server/routers/twinCanhRouter.ts` và đọc cổng THẬT của
 * từng thủ tục trong bảng. Một bảng chép tay là chỗ để hai bên lệch nhau lần
 * nữa — và lệch âm thầm, vì mọi test "UI ẩn nút" vẫn xanh khi bảng sai.
 *
 * ⚠ G150 — lưới đọc mã nguồn từ ĐĨA phải chuẩn hoá EOL (`docMaNguon`), nếu
 *   không nó đo TRẠNG THÁI CHECKOUT chứ không đo nội dung đã commit.
 *
 * ★★★ MỖI CA ÂM KÈM MỘT CA DƯƠNG. "Vai X không thấy nút Y" là xanh cả khi hàm
 *   trả rỗng cho MỌI người — tức chứng minh SỐ 0. Nên mỗi ca ẩn ở đây đi kèm
 *   một vai khác THẤY đúng nút ấy trên cùng phép đo.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { docMaNguon } from "@shared/testing/docMaNguon";

import {
  BANG_CONG_CU_XUONG,
  congCuHienThi,
  tinhQuyenXuong,
  type CoQuyenModule,
  type MaCongCu,
  type QuyenXuong,
} from "./quyenXuong";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Bốn vai — dựng theo QUYỀN ĐO ĐƯỢC TỪ DB (`.qa-tapdoan/BANG-DE.md` §quyền)   */
/* ═══════════════════════════════════════════════════════════════════════════ */

const KHONG: CoQuyenModule = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
};
const co = (s: string): CoQuyenModule => ({
  canView: s.includes("V"),
  canCreate: s.includes("C"),
  canEdit: s.includes("E"),
  canDelete: s.includes("D"),
});

/** `qatd_kythuat` (engineer): settings_factory V,C,E,D · machine_control V,C,E. */
const KYTHUAT = tinhQuyenXuong({
  settingsFactory: co("VCED"),
  machineControl: co("VCE"),
  laAdmin: false,
});

/**
 * `qatd_quanly` (supervisor): machine_control **V,E** (canCreate = FALSE),
 * 0 `settings_factory`. ĐÂY LÀ VAI CỦA Ô E6 — vai làm lộ ra PH-15.
 */
const QUANLY = tinhQuyenXuong({
  settingsFactory: KHONG,
  machineControl: co("VE"),
  laAdmin: false,
});

/** Vai chỉ xem — có canView, 0 quyền ghi nào. */
const CHI_XEM = tinhQuyenXuong({
  settingsFactory: KHONG,
  machineControl: co("V"),
  laAdmin: false,
});

/** Admin — `usePermissions` bypass cho tất cả true, và `adminProcedure` mở. */
const ADMIN = tinhQuyenXuong({
  settingsFactory: co("VCED"),
  machineControl: co("VCED"),
  laAdmin: true,
});

const tap = (q: QuyenXuong): Set<MaCongCu> => new Set(congCuHienThi(q));

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ① HỢP QUYỀN LÀ **HOẶC** GIỮA HAI MODULE — khớp `requireAnyPermission`        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("① hợp quyền hai module là HOẶC, và HOẶC theo TỪNG hành động", () => {
  it("chỉ `settings_factory` có canEdit ⇒ sửa được", () => {
    expect(tinhQuyenXuong({ settingsFactory: co("E"), machineControl: KHONG, laAdmin: false }).sua)
      .toBe(true);
  });

  it("chỉ `machine_control` có canEdit ⇒ sửa được (viết thành VÀ sẽ chặn nhầm)", () => {
    expect(tinhQuyenXuong({ settingsFactory: KHONG, machineControl: co("E"), laAdmin: false }).sua)
      .toBe(true);
  });

  it("★★★ HOẶC theo TỪNG hành động, không gộp: E ở module này + C ở module kia", () => {
    // Bản cũ chỉ có MỘT cờ nên không phân biệt được ca này. Ở đây `sua` và `tao`
    // phải bật độc lập, mỗi cái từ module cấp nó.
    const q = tinhQuyenXuong({
      settingsFactory: co("C"),
      machineControl: co("E"),
      laAdmin: false,
    });
    expect(q.tao).toBe(true);
    expect(q.sua).toBe(true);
    expect(q.xoa).toBe(false);
  });

  it("không quyền nào ⇒ mọi cờ tắt, kể cả `xem`", () => {
    const q = tinhQuyenXuong({ settingsFactory: KHONG, machineControl: KHONG, laAdmin: false });
    expect(q).toEqual({ xem: false, tao: false, sua: false, xoa: false, sinh: false });
  });

  it("★ `sinh` KHÔNG suy được từ canCreate — nó là `adminProcedure`", () => {
    // Ca dương của chính lỗi: đủ C+E+D ở CẢ HAI module mà không phải admin thì
    // `sinhTuDong` vẫn phải tắt, vì server gác bằng vai chứ không bằng module.
    expect(KYTHUAT.tao).toBe(true);
    expect(KYTHUAT.xoa).toBe(true);
    expect(KYTHUAT.sinh).toBe(false);
    expect(ADMIN.sinh).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ② ★★★ MA TRẬN QUYỀN → TẬP NÚT HIỂN THỊ                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② PH-15 — ca `canEdit` mà KHÔNG `canCreate` (vai qatd_quanly, ô E6)", () => {
  it("KHÔNG có nút SINH TỰ ĐỘNG (`nut-mo-sinh`) — server gác bằng adminProcedure", () => {
    expect(tap(QUANLY).has("sinhTuDong")).toBe(false);
  });

  it("KHÔNG có đường DỰNG NHÀ XƯỞNG (`nut-tao`) — server gác bằng canCreate", () => {
    expect(tap(QUANLY).has("dungNhaXuong")).toBe(false);
  });

  it("KHÔNG có ba khối TẠO: ảnh nền, tải model, lưu bản ghi", () => {
    const t = tap(QUANLY);
    expect(t.has("anhNenTang")).toBe(false);
    expect(t.has("taiModelMay")).toBe(false);
    expect(t.has("luuBanGhi")).toBe(false);
  });

  it("★ NHƯNG VẪN CÓ công cụ SỬA — nếu không, bản vá đã chặn nhầm người đúng", () => {
    // Đây là ca DƯƠNG bắt buộc: ô E6 ghi *"gizmo ✓"* cho vai này. Một bản vá
    // gác tất cả bằng `canCreate` sẽ làm bốn ca trên xanh và ca này ĐỎ.
    const t = tap(QUANLY);
    expect(t.has("cheDoGizmo")).toBe(true);
    expect(t.has("batDinh")).toBe(true);
    expect(t.has("luuBoCuc")).toBe(true);
    expect(t.has("suaThuocTinh")).toBe(true);
    expect(t.has("veVungAnToan")).toBe(true);
  });

  it("★ và KHÔNG có nút XOÁ (vai này 0 canDelete) — cổng thứ ba, không phải hai", () => {
    const t = tap(QUANLY);
    expect(t.has("goKhoiMatBang")).toBe(false);
    expect(t.has("xoaVungAnToan")).toBe(false);
    expect(t.has("xoaBanGhi")).toBe(false);
  });
});

describe("② ma trận đầy đủ — bốn vai, cùng một phép đo", () => {
  it("vai CHỈ XEM ⇒ 0 nút GHI, nhưng vẫn đọc được danh sách bản ghi", () => {
    const t = tap(CHI_XEM);
    const ghi = BANG_CONG_CU_XUONG.filter((c) => c.cong !== "canView").map((c) => c.ma);
    for (const ma of ghi) expect(t.has(ma), `chỉ-xem không được thấy ${ma}`).toBe(false);
    // Ca dương của chính thước: nó KHÔNG trả rỗng cho mọi thứ.
    expect(t.has("danhSachBanGhi")).toBe(true);
  });

  it("vai 0 QUYỀN GÌ ⇒ tập rỗng tuyệt đối", () => {
    const q = tinhQuyenXuong({ settingsFactory: KHONG, machineControl: KHONG, laAdmin: false });
    expect(congCuHienThi(q)).toEqual([]);
  });

  it("vai KỸ THUẬT (V,C,E,D không admin) ⇒ đủ mọi công cụ TRỪ sinh tự động", () => {
    const t = tap(KYTHUAT);
    const thieu = BANG_CONG_CU_XUONG.filter((c) => !t.has(c.ma)).map((c) => c.ma);
    expect(thieu).toEqual(["sinhTuDong"]);
  });

  it("★ ADMIN thấy ĐỦ bảng — đối chứng dương chứng minh phép đo không trả rỗng", () => {
    expect(tap(ADMIN).size).toBe(BANG_CONG_CU_XUONG.length);
  });

  it("★★★ bốn vai cho BỐN tập KHÁC NHAU — nếu hai vai trùng thì cổng nào đó chết", () => {
    const ky = congCuHienThi(KYTHUAT).join(",");
    const ql = congCuHienThi(QUANLY).join(",");
    const cx = congCuHienThi(CHI_XEM).join(",");
    const ad = congCuHienThi(ADMIN).join(",");
    expect(new Set([ky, ql, cx, ad]).size).toBe(4);
  });

  it("★ đơn điệu: quyền nhiều hơn ⇒ tập nút là tập CHA, không bao giờ mất nút", () => {
    const con = tap(QUANLY);
    const cha = tap(KYTHUAT);
    for (const ma of con) expect(cha.has(ma), `kythuat phải có ${ma}`).toBe(true);
    expect(cha.size).toBeGreaterThan(con.size);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ③ BẢNG PHẢI ĐẦY ĐỦ VÀ KHÔNG TRÙNG                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("③ bảng công cụ — mỗi mã đúng một hàng, mỗi hàng đủ ba cột", () => {
  it("không mã nào trùng", () => {
    const ma = BANG_CONG_CU_XUONG.map((c) => c.ma);
    expect(new Set(ma).size).toBe(ma.length);
  });

  it("mọi hàng khai đủ testid + thủ tục + cổng", () => {
    for (const c of BANG_CONG_CU_XUONG) {
      expect(c.testid, `${c.ma} thiếu testid`).toBeTruthy();
      expect(c.thuTuc, `${c.ma} thiếu thủ tục`).toMatch(/^twinCanh\.[a-zA-Z]+$/);
      expect(["canView", "canCreate", "canEdit", "canDelete", "admin"]).toContain(c.cong);
    }
  });

  it("★ bảng phủ CẢ BỐN mức cổng + admin — thiếu mức nào là thiếu một cửa", () => {
    const mucCo = new Set(BANG_CONG_CU_XUONG.map((c) => c.cong));
    expect([...mucCo].sort()).toEqual(["admin", "canCreate", "canDelete", "canEdit", "canView"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ④ ★★★ BẤT BIẾN ĐỌC TỪ ĐĨA — CỔNG TRONG BẢNG = CỔNG THẬT CỦA ROUTER          */
/* ═══════════════════════════════════════════════════════════════════════════ */

const GOC = resolve(__dirname, "../../../../..");
const ROUTER = docMaNguon(resolve(GOC, "server/routers/twinCanhRouter.ts"));

/**
 * Đọc cổng THẬT của một thủ tục trong `twinCanhRouter`.
 *
 * Khuôn của router là ổn định và đọc được bằng mắt:
 *     `  <ten>: protectedProcedure\n    .use(quyenThietKe("<hanhDong>"))\n    .input(`
 *     `  <ten>: adminProcedure\n    .input(`
 * ⇒ cắt từ tên thủ tục tới `.input(` ĐẦU TIÊN sau nó là lấy đúng phần khai cổng,
 *   không dính thủ tục kế tiếp.
 */
function congThatCua(ten: string): string {
  const i = ROUTER.indexOf(`\n  ${ten}: `);
  if (i < 0) return "KHONG-TIM-THAY";
  const j = ROUTER.indexOf(".input(", i);
  const khai = ROUTER.slice(i, j < 0 ? i + 400 : j);
  if (/adminProcedure/.test(khai)) return "admin";
  const m = /quyenThietKe\("(canView|canCreate|canEdit|canDelete)"\)/.exec(khai);
  return m ? m[1] : "khong-gac";
}

describe("★★★ ④ cổng khai trong bảng phải KHỚP `server/routers/twinCanhRouter.ts` trên đĩa", () => {
  it("thước tự kiểm được: đọc đúng ba ca đã biết bằng mắt", () => {
    // Nếu khuôn router đổi, ba dòng này đỏ TRƯỚC — ta biết thước hỏng chứ không
    // kết luận nhầm rằng bảng sai (bài học: phép đo phải tự chứng minh mình sống).
    expect(congThatCua("sinhTuDong")).toBe("admin");
    expect(congThatCua("dungNhaXuong")).toBe("canCreate");
    expect(congThatCua("luuHangLoat")).toBe("canEdit");
  });

  it("★★★ mọi thủ tục trong bảng có cổng ĐÚNG như bảng khai", () => {
    const lech: string[] = [];
    for (const c of BANG_CONG_CU_XUONG) {
      const ten = c.thuTuc.replace(/^twinCanh\./, "");
      const that = congThatCua(ten);
      if (that !== c.cong) lech.push(`${c.ma}: bảng=${c.cong} router=${that}`);
    }
    expect(lech).toEqual([]);
  });

  it("★ đối chứng ÂM: một cổng bịa ra KHÔNG khớp (thước biết kêu)", () => {
    expect(congThatCua("taiAnhNen")).toBe("canCreate");
    expect(congThatCua("taiAnhNen")).not.toBe("canEdit");
    expect(congThatCua("thuTucKhongCoThat")).toBe("KHONG-TIM-THAY");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ⑤ ẨN, KHÔNG DISABLE — cưỡng chế trên MÃ THẬT của `XuongThietKe`/`TwinStudio` */
/* ═══════════════════════════════════════════════════════════════════════════ */

const XUONG = docMaNguon(resolve(GOC, "client/src/components/twin3d/thiet-ke/XuongThietKe.tsx"));
const STUDIO = docMaNguon(resolve(GOC, "client/src/pages/TwinStudio.tsx"));

describe("★★★ ⑤ chỗ gọi THẬT — hai màn phải ĐỌC quyền tách, không còn một cờ duy nhất", () => {
  it("`XuongThietKe` đọc `canCreate` (bản cũ: 0 dòng trong cả thư mục)", () => {
    expect(XUONG).toContain("canCreate");
  });

  it("`XuongThietKe` dùng `tinhQuyenXuong`, không tự hợp quyền tại chỗ", () => {
    expect(XUONG).toContain("tinhQuyenXuong");
  });

  it("★ nút Sinh tự động gác bằng cờ ADMIN, không bằng cờ sửa", () => {
    // Cắt quanh `nut-mo-sinh` và đòi cờ `sinh` có mặt trong khối bao nó.
    const i = XUONG.indexOf('data-testid="nut-mo-sinh"');
    expect(i).toBeGreaterThan(-1);
    const truoc = XUONG.slice(Math.max(0, i - 900), i);
    expect(truoc).toMatch(/quyen\.sinh/);
  });

  it("★ `TwinStudio` gác tab dựng nhà xưởng bằng cờ TẠO", () => {
    expect(STUDIO).toContain("canCreate");
    const i = STUDIO.indexOf('data-testid="tab-con-duong-b"');
    expect(i).toBeGreaterThan(-1);
  });

  it("★★★ ẨN chứ không DISABLE: 0 chỗ nào viết `disabled={!quyen.`", () => {
    // Luật sản phẩm §6.4 + `nganXuLyLogic.ts:102-111`. Một nút xám vẫn nói
    // "chức năng này thuộc về bạn" — với người KHÔNG BAO GIỜ có quyền, câu đó SAI.
    expect(XUONG).not.toMatch(/disabled=\{!?\s*quyen\./);
    expect(STUDIO).not.toMatch(/disabled=\{!?\s*quyen\./);
  });
});

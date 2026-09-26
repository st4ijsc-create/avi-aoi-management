// @vitest-environment jsdom
//
/**
 * vienSucKhoeDoDuoc.dom.test.tsx — ★★★ TASK 12: **ĐO ĐƯỢC LỚP PHỦ MÀU**, và nối
 * `xepHangSucKhoe` vào một bảng người đọc được.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI — 11 ĐỢT QA KHÔNG AI ĐO ĐƯỢC VÒNG SỨC KHOẺ
 * ════════════════════════════════════════════════════════════════════════════
 * A-4 (vòng viền đế máy) đã GIAO: `vienSucKhoe()` có, `LopVienSucKhoe` có, và
 * vòng đỏ/hổ phách nhìn thấy trên ảnh QA. Nhưng **không có cách nào ĐẾM** chúng:
 *
 *   · đọc điểm ảnh bị CẤM — `preserveDrawingBuffer` không bật, nên
 *     `toDataURL()`/`readPixels` trên canvas WebGL trả **0 điểm ảnh khác nền**,
 *     giống hệt một canvas trống. Một phép đo không phân biệt được "vẽ đủ" với
 *     "không vẽ gì" là phép đo MÙ (G5), và 11 đợt QA đã trả giá cho điều đó;
 *   · `__demNhan` / `__demBadge` đếm NHÃN và BADGE — hai lớp khác, hai đại
 *     lượng khác. Không lớp nào nói một chữ nào về vòng.
 *
 * ⇒ `window.__demVien` (`KhungCanh.tsx`, đúng khuôn `__demTuongTac`: chỉ bật ở
 *   chế độ đo) khai `{ tong, theoHang }`. Tệp này ghim **bốn** điều, vì một bộ
 *   đếm chỉ đáng tin khi cả bốn cùng đúng:
 *
 *   TẦNG 1 — HÀNH VI: bộ đếm **BIẾT KÊU**. Đổi đầu vào ⇒ con số đổi theo; tập
 *            rỗng ⇒ **0 chứ KHÔNG `undefined`** (một `undefined` nói "bộ đếm
 *            không tồn tại", và đó là câu trả lời của mọi bản vá hỏng);
 *            ngoài chế độ đo ⇒ KHÔNG gắn gì (sản phẩm không đổi).
 *   TẦNG 2 — CHỖ NỐI: bộ đếm đếm **ĐÚNG MẢNG** mà cảnh nhận. Hai trang truyền
 *            CÙNG một định danh vào `useDemVienSucKhoe(...)` và vào
 *            `<CanhVanHanh vienSucKhoe={...}>`. Không có ca này, bộ đếm có thể
 *            đếm một mảng mà cảnh không hề nhận — đúng lớp lỗi `wip={[]}`.
 *   TẦNG 3 — BẢNG XẾP HẠNG 2D (§11.5): `xepHangSucKhoe` (có từ Đợt 21, **0 chỗ
 *            gọi** cho tới Task 12) nay chảy vào một bảng trong panel trái, và
 *            bảng ấy dùng CÙNG `hangSucKhoe()` với vòng — hai bản cài đặt rời
 *            sẽ lệch và không ai biết tin cái nào (G12).
 *   TẦNG 4 — QUYỀN HAI MÀN KHÔNG ĐƯỢC LỆCH: màn Máy dựng `QuyenXuLy` bằng bốn
 *            dòng cũ nên nút "Báo sự cố" (Task 9) **ẩn** ở đó. Ghim hai màn khai
 *            CÙNG một tập quyền để lần sau thêm hành động mới thì lưới KÊU.
 *
 * ⚠ jsdom KHÔNG có bộ dựng bố cục: `getBoundingClientRect()` trả 0 ở mọi phần
 *   tử. Không ca nào ở đây đo hình học — TẦNG 1 đo **số**, TẦNG 2/4 đo **văn
 *   bản chỗ nối**, TẦNG 3 đo **hàm thuần**.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { resolve } from "node:path";
import { docMaNguon } from "@shared/testing/docMaNguon";

import { useDemVienSucKhoe, type CuaSoDoTwin3d } from "../loi/KhungCanh";
import {
  MOI_HANG_CO_VIEN,
  MOI_HANG_SUC_KHOE,
  demTheoHangSucKhoe,
  hangSucKhoe,
  mauVienSucKhoe,
  vienSucKhoe,
  xepHangSucKhoe,
  type ChoDatVien,
  type HangSucKhoe,
  type KhaiSucKhoe,
} from "./sucKhoeMay";

const GOC = resolve(__dirname, "../../../..");
const KHUNG_CANH = docMaNguon(resolve(GOC, "src/components/twin3d/loi/KhungCanh.tsx"));
const VAN_HANH = docMaNguon(resolve(GOC, "src/pages/TwinVanHanh.tsx"));
const MAN_MAY = docMaNguon(resolve(GOC, "src/pages/TwinMay.tsx"));

/** Mốc thời gian của dữ kiện nền — cùng mốc với `vienSucKhoe.dom.test.tsx`. */
const BAY_GIO = Date.parse("2026-09-08T09:40:00.000Z");
const GIO = 3_600_000;

function khai(p: Partial<KhaiSucKhoe> & { machineId: number }): KhaiSucKhoe {
  return { diem: 95, nguyCo: 0, mucKhan: "LOW", mocMs: BAY_GIO - GIO, ...p };
}

function cho(machineId: number): ChoDatVien {
  return { machineId, viTri: { x: machineId, z: 0 }, kichThuocMm: { rong: 1200, sau: 800 } };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* DỮ KIỆN NỀN — SÁU MÁY, SÁU HẠNG. Mọi con số dưới đây suy từ đây.             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★ G5 — KHÔNG đo trên tập rỗng. Sáu máy phủ đủ sáu hạng, trong đó **bốn** hạng
 *   có vòng (`nguy_kich`, `canh`, `theo_doi`, `het_han`) và **hai** hạng không
 *   (`khoe`, `chua_do`). Nhờ thế mọi ca dưới đây phân biệt được "đếm đúng" với
 *   "đếm tất" và với "đếm 0".
 */
const SAU_MAY: KhaiSucKhoe[] = [
  khai({ machineId: 1, diem: 55 }), // nguy_kich
  khai({ machineId: 2, diem: 72 }), // canh
  khai({ machineId: 3, diem: 85 }), // theo_doi
  khai({ machineId: 4, diem: 96 }), // khoe        → KHÔNG vòng
  khai({ machineId: 5, diem: 31, mocMs: BAY_GIO - 18 * 24 * GIO }), // het_han
  khai({ machineId: 6, diem: null, nguyCo: null, mucKhan: null }), // chua_do → KHÔNG vòng
];
const SAU_CHO: ChoDatVien[] = [1, 2, 3, 4, 5, 6].map(cho);

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 1 — HÀNH VI CỦA `window.__demVien`                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Bọc hook trong một component thật: hook chỉ chạy trong vòng đời React. */
function ThuDem({
  vien,
  cheDoDo = true,
}: {
  vien: readonly { hang: string }[];
  cheDoDo?: boolean;
}) {
  useDemVienSucKhoe(vien, MOI_HANG_CO_VIEN, cheDoDo);
  return <i data-testid="da-mount" />;
}

const cuaSo = () => (window as Window & CuaSoDoTwin3d).__demVien;

afterEach(() => {
  cleanup();
  delete (window as Window & CuaSoDoTwin3d).__demVien;
});

describe("TẦNG 1 — `__demVien` đếm vòng sức khoẻ, và BIẾT KÊU", () => {
  it("★ dữ kiện nền: `vienSucKhoe()` trả ĐÚNG 4 vòng cho 6 máy (2 hạng không vẽ vòng)", () => {
    const vien = vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO);
    expect(vien.length).toBe(4);
    expect(vien.map((v) => v.hang).sort()).toEqual(["canh", "het_han", "nguy_kich", "theo_doi"]);
  });

  it("★★★ bộ đếm khai đúng số vòng ĐÃ dựng — trên chính đầu ra của `vienSucKhoe()`", () => {
    const vien = vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO);
    render(<ThuDem vien={vien} />);
    expect(cuaSo()?.tong).toBe(4);
    expect(cuaSo()?.theoHang.nguy_kich).toBe(1);
    expect(cuaSo()?.theoHang.canh).toBe(1);
    expect(cuaSo()?.theoHang.theo_doi).toBe(1);
    expect(cuaSo()?.theoHang.het_han).toBe(1);
  });

  it("★★★ BẤT BIẾN ĐỐI CHIẾU TỔNG (BG-127): tổng `theoHang` = `tong` — hạng mới mà quên khai sẽ KÊU", () => {
    const vien = vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO);
    render(<ThuDem vien={vien} />);
    const d = cuaSo()!;
    const cong = Object.values(d.theoHang).reduce((a, b) => a + b, 0);
    expect(cong).toBe(d.tong);
  });

  it("★★★ KHÔNG máy nào ⇒ bộ đếm là **0**, KHÔNG `undefined` (tập rỗng phải nói được)", () => {
    render(<ThuDem vien={[]} />);
    // Hai khẳng định TÁCH RỜI: cái thứ nhất nói bộ đếm CÓ MẶT, cái thứ hai nói
    // nó bằng 0. `expect(cuaSo()?.tong).toBe(0)` KHÔNG phân biệt được hai điều
    // ấy khi bản vá hỏng — `undefined?.tong` cũng là `undefined`, không phải 0.
    expect(cuaSo()).toBeDefined();
    expect(cuaSo()!.tong).toBe(0);
    // Mọi hạng CÓ VÒNG phải đọc ra 0, không phải `undefined`: rỗng vì yên ổn
    // phải khác rỗng vì chưa đo được (NT-3).
    for (const h of MOI_HANG_CO_VIEN) expect(cuaSo()!.theoHang[h], h).toBe(0);
  });

  it("★★★ BIẾT KÊU — đổi ĐẦU VÀO thì con số ĐỔI THEO (bộ đếm không phải hằng viết cứng)", () => {
    const r = render(<ThuDem vien={vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO)} />);
    expect(cuaSo()!.tong).toBe(4);
    expect(cuaSo()!.theoHang.nguy_kich).toBe(1);

    // Thêm HAI máy nguy kịch nữa ⇒ tổng 4 → 6 và riêng `nguy_kich` 1 → 3.
    const themHai = [...SAU_MAY, khai({ machineId: 7, diem: 20 }), khai({ machineId: 8, diem: 41 })];
    r.rerender(<ThuDem vien={vienSucKhoe(themHai, [...SAU_CHO, cho(7), cho(8)], BAY_GIO)} />);
    expect(cuaSo()!.tong).toBe(6);
    expect(cuaSo()!.theoHang.nguy_kich).toBe(3);

    // Bỏ máy nguy kịch duy nhất của tập gốc ⇒ 3 vòng, `nguy_kich` về **0**.
    r.rerender(
      <ThuDem vien={vienSucKhoe(SAU_MAY.slice(1), SAU_CHO.slice(1), BAY_GIO)} />,
    );
    expect(cuaSo()!.tong).toBe(3);
    expect(cuaSo()!.theoHang.nguy_kich).toBe(0);
  });

  it("★★★ ĐỐI CHỨNG — NGOÀI chế độ đo: KHÔNG gắn gì (sản phẩm không đổi vì một cửa sổ đo)", () => {
    render(<ThuDem vien={vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO)} cheDoDo={false} />);
    expect(cuaSo()).toBeUndefined();
  });

  it("★ rời màn ⇒ cửa sổ đo được DỌN — không để lại con số cũ cho phép đo sau đọc nhầm", () => {
    const r = render(<ThuDem vien={vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO)} />);
    expect(cuaSo()!.tong).toBe(4);
    r.unmount();
    expect(cuaSo()).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 2 — CHỖ NỐI: bộ đếm đếm ĐÚNG MẢNG mà cảnh nhận                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("TẦNG 2 — chỗ nối (chống 'đếm một mảng mà cảnh không hề nhận')", () => {
  it("★ tiền đề: đọc được ba tệp nguồn và chúng KHÔNG rỗng", () => {
    expect(KHUNG_CANH.length).toBeGreaterThan(1000);
    expect(VAN_HANH.length).toBeGreaterThan(1000);
    expect(MAN_MAY.length).toBeGreaterThan(1000);
  });

  it("★★★ `KhungCanh.tsx` khai `__demVien` trong hợp đồng cửa sổ đo và XUẤT hook", () => {
    expect(KHUNG_CANH).toMatch(/__demVien\?:\s*\{/);
    expect(KHUNG_CANH).toContain("export function useDemVienSucKhoe");
  });

  it("★★★ bộ đếm gác sau `laCheDoDo()` — đúng khuôn `__demTuongTac`, không mở ở sản phẩm", () => {
    const than = KHUNG_CANH.slice(KHUNG_CANH.indexOf("export function useDemVienSucKhoe"));
    expect(than).toContain("laCheDoDo()");
  });

  it("★★★ `/twin` — CÙNG định danh đi vào bộ đếm và vào cảnh", () => {
    expect(VAN_HANH).toMatch(/useDemVienSucKhoe\(\s*vienSucKhoeCanh/);
    expect(VAN_HANH).toMatch(/vienSucKhoe=\{vienSucKhoeCanh\}/);
  });

  it("★★★ `/twin/may/:id` — CÙNG định danh đi vào bộ đếm và vào cảnh", () => {
    expect(MAN_MAY).toMatch(/useDemVienSucKhoe\(\s*vienSucKhoeCanh/);
    expect(MAN_MAY).toMatch(/vienSucKhoe=\{vienSucKhoeCanh\}/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 3 — BẢNG XẾP HẠNG 2D SONG SONG (§11.5)                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("TẦNG 3 — bảng xếp hạng sức khoẻ trong panel trái", () => {
  it("★ `MOI_HANG_SUC_KHOE` phủ ĐỦ sáu hạng, tệ nhất lên đầu", () => {
    expect([...MOI_HANG_SUC_KHOE].sort()).toEqual(
      ["canh", "chua_do", "het_han", "khoe", "nguy_kich", "theo_doi"].sort(),
    );
    expect(MOI_HANG_SUC_KHOE[0]).toBe("nguy_kich");
  });

  it("★★★ thứ tự bảng = thứ tự THẬT `xepHangSucKhoe` sắp ra (không phải hai thứ tự rời nhau)", () => {
    // `MOI_HANG_SUC_KHOE` là một literal, còn thứ tự xếp hạng đến từ `THU_TU_HANG`
    // (riêng tư trong module). Ca này so hai thứ ấy trên dữ kiện nền đủ sáu hạng:
    // đổi một trong hai mà quên cái kia ⇒ ĐỎ. Không có nó, bảng có thể in
    // "khoẻ" trước "nguy kịch" trong khi hàm vẫn xếp đúng.
    const thuTuThat = [...new Set(xepHangSucKhoe(SAU_MAY, [], BAY_GIO).map((d) => d.hang))];
    expect(thuTuThat.length).toBe(6);
    expect(thuTuThat).toEqual([...MOI_HANG_SUC_KHOE]);
  });

  it("★★★ `MOI_HANG_CO_VIEN` = đúng những hạng `mauVienSucKhoe()` trả MÀU — đổi màu là KÊU", () => {
    const suyTuMau = MOI_HANG_SUC_KHOE.filter((h) => mauVienSucKhoe(h) !== null);
    expect([...MOI_HANG_CO_VIEN]).toEqual(suyTuMau);
  });

  it("★★★ đếm theo hạng trên dữ kiện nền: 6 hàng, mỗi hạng ĐÚNG 1 máy", () => {
    const bang = demTheoHangSucKhoe(xepHangSucKhoe(SAU_MAY, [1, 2, 3, 4, 5, 6], BAY_GIO));
    expect(bang.length).toBe(6);
    expect(bang.map((o) => o.hang)).toEqual([...MOI_HANG_SUC_KHOE]);
    for (const o of bang) expect(o.so, o.hang).toBe(1);
  });

  it("★★★ BẤT BIẾN: tổng các hạng = số máy CÓ lời khai (không nuốt, không đếm hai lần)", () => {
    const dong = xepHangSucKhoe(SAU_MAY, [1, 2, 3], BAY_GIO);
    const bang = demTheoHangSucKhoe(dong);
    expect(bang.reduce((a, o) => a + o.so, 0)).toBe(dong.length);
    expect(dong.length).toBe(SAU_MAY.length);
  });

  it("★★★ BIẾT KÊU — một máy đổi điểm 55 → 96 thì `nguy_kich` −1 và `khoe` +1", () => {
    const truoc = demTheoHangSucKhoe(xepHangSucKhoe(SAU_MAY, [], BAY_GIO));
    const sau = demTheoHangSucKhoe(
      xepHangSucKhoe([khai({ machineId: 1, diem: 96 }), ...SAU_MAY.slice(1)], [], BAY_GIO),
    );
    const lay = (b: ReturnType<typeof demTheoHangSucKhoe>, h: HangSucKhoe) =>
      b.find((o) => o.hang === h)!.so;
    expect(lay(truoc, "nguy_kich")).toBe(1);
    expect(lay(sau, "nguy_kich")).toBe(0);
    expect(lay(truoc, "khoe")).toBe(1);
    expect(lay(sau, "khoe")).toBe(2);
  });

  it("★★★ tập rỗng: vẫn ĐỦ 6 hàng, mỗi hàng số **0** — 'chưa có máy nào' phải nói được", () => {
    const bang = demTheoHangSucKhoe([]);
    expect(bang.length).toBe(6);
    for (const o of bang) expect(o.so, o.hang).toBe(0);
  });

  it("★★★ §11.5 SONG SONG — bảng và vòng cho CÙNG một hạng trên cùng một máy", () => {
    const vien = vienSucKhoe(SAU_MAY, SAU_CHO, BAY_GIO);
    const dong = xepHangSucKhoe(SAU_MAY, [1, 2, 3, 4, 5, 6], BAY_GIO);
    expect(vien.length).toBeGreaterThan(0);
    for (const v of vien) {
      const d = dong.find((x) => x.machineId === v.machineId)!;
      expect(d.hang, `máy ${v.machineId}`).toBe(v.hang);
      expect(d.hang).toBe(hangSucKhoe(SAU_MAY.find((k) => k.machineId === v.machineId)!, BAY_GIO));
    }
  });

  it("★★★ `/twin` DỰNG bảng từ `xepHangSucKhoe` — không phải đếm lại bằng bản cài đặt thứ hai", () => {
    expect(VAN_HANH).toContain("xepHangSucKhoe(");
    expect(VAN_HANH).toContain("demTheoHangSucKhoe(");
    expect(VAN_HANH).toContain('data-testid="bang-suc-khoe"');
    // Mỗi hạng một ô đọc được, mang số ở thuộc tính để e2e đọc theo NGHĨA.
    expect(VAN_HANH).toMatch(/data-testid=\{`o-suc-khoe-\$\{/);
    expect(VAN_HANH).toMatch(/data-so=/);
  });

  it("★★★ bảng dùng ĐÚNG sáu khoá i18n tên hạng mà màn Máy đã dùng (hai màn một bảng chữ)", () => {
    const khoa = (s: string) =>
      [...s.matchAll(/twin3d\.may\.hang\.([A-Za-z]+)/g)].map((m) => m[1]).sort();
    const cuaMay = [...new Set(khoa(MAN_MAY))];
    const cuaVanHanh = [...new Set(khoa(VAN_HANH))];
    expect(cuaMay.length).toBe(6);
    expect(cuaVanHanh).toEqual(cuaMay);
  });

  it("★★★ tiêu đề bảng có khoá i18n ở CẢ BA ngôn ngữ, en/zh KHÔNG lọt dấu tiếng Việt", async () => {
    const RE_VI =
      /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
    for (const ngon of ["en", "vi", "zh"] as const) {
      const j = (await import(`../../../i18n/locales/${ngon}.json`)).default as Record<
        string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any
      >;
      const tieuDe = j.twin3d.vanHanh.bangSucKhoe;
      expect(typeof tieuDe, `${ngon}:bangSucKhoe`).toBe("string");
      expect((tieuDe as string).length).toBeGreaterThan(0);
      for (const h of ["nguyKich", "canh", "theoDoi", "khoe", "hetHan", "chuaDo"]) {
        expect(typeof j.twin3d.may.hang[h], `${ngon}:hang.${h}`).toBe("string");
      }
      if (ngon !== "vi") {
        expect(RE_VI.test(tieuDe as string), `${ngon} lọt dấu tiếng Việt`).toBe(false);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 4 — HAI MÀN KHAI CÙNG MỘT TẬP QUYỀN                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Rút khối `const quyen: QuyenXuLy = { … };` của một trang thành bảng
 * `tênQuyền → "module/hành động"`.
 *
 * ★ Đọc VĂN BẢN chứ không render trang: `ThanTwinVanHanh` cần tRPC + i18n +
 *   router, và ba thứ ấy không nói gì về câu hỏi ở đây. Câu hỏi là *"hai trang
 *   có khai CÙNG một tập quyền không"*, và tập ấy nằm nguyên văn trong mã.
 */
function bangQuyen(nguon: string, tenTep: string): Record<string, string> {
  const i = nguon.indexOf("const quyen: QuyenXuLy = {");
  expect(i, `${tenTep}: không tìm thấy khối \`const quyen: QuyenXuLy = {\``).toBeGreaterThan(-1);
  const j = nguon.indexOf("\n  };", i);
  expect(j, `${tenTep}: khối quyền không đóng`).toBeGreaterThan(i);
  const khoi = nguon.slice(i, j);
  const ra: Record<string, string> = {};
  for (const m of khoi.matchAll(/^\s*([A-Za-z]+):\s*hasPermission\("([^"]+)",\s*"([^"]+)"\)/gm)) {
    ra[m[1]] = `${m[2]}/${m[3]}`;
  }
  return ra;
}

describe("TẦNG 4 — `QuyenXuLy` của màn Máy và màn Vận hành KHÔNG được lệch", () => {
  it("★ tiền đề: rút được khối quyền ở CẢ HAI trang, mỗi khối ≥ 4 dòng (không đo trên tập rỗng)", () => {
    expect(Object.keys(bangQuyen(VAN_HANH, "TwinVanHanh")).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(bangQuyen(MAN_MAY, "TwinMay")).length).toBeGreaterThanOrEqual(4);
  });

  it("★★★ HAI MÀN CÙNG TẬP TÊN QUYỀN — thêm hành động mới mà quên một màn ⇒ ca này ĐỎ", () => {
    const a = bangQuyen(VAN_HANH, "TwinVanHanh");
    const b = bangQuyen(MAN_MAY, "TwinMay");
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  });

  it("★★★ CÙNG TÊN ⇒ CÙNG module/hành động — hai màn hỏi cùng một câu ở cùng một mức", () => {
    const a = bangQuyen(VAN_HANH, "TwinVanHanh");
    const b = bangQuyen(MAN_MAY, "TwinMay");
    expect(b).toEqual(a);
  });

  it("★★★ `baoSuCo` = `andon`/`canCreate` ở CẢ HAI màn — đúng mức `andon.quickReport` đòi", () => {
    for (const [ten, bang] of [
      ["TwinVanHanh", bangQuyen(VAN_HANH, "TwinVanHanh")],
      ["TwinMay", bangQuyen(MAN_MAY, "TwinMay")],
    ] as const) {
      expect(bang.baoSuCo, `${ten}.baoSuCo`).toBe("andon/canCreate");
    }
  });
});

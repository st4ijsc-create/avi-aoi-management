/**
 * saBanNoiVaoTrang.unit.test.ts — **TASK 20**: sa bàn quy hoạch đã được NỐI, và
 * lời khai trên màn đã đi theo bản vá TRONG CÙNG MỘT LƯỢT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY PHẢI TỒN TẠI RIÊNG
 * ════════════════════════════════════════════════════════════════════════════
 * `canhTapDoan.unit.test.ts` chứng minh `saBanTapDoan` TRẢ VỀ đúng — nó **không
 * biết** trang có gọi hàm ấy không, `CanhVanHanh` có render lớp mới không, và
 * banner có còn nói câu cũ không. Đó đúng là chỗ G16 đã cắn nhiều lần trong dự
 * án này: một prop "có mặt" trong kiểu, `tsc` xanh, mọi lưới module xanh, và
 * `grep` ra **0 chỗ truyền** — tính năng chưa từng chạy.
 *
 * ⚠ Đây là phép đo VĂN BẢN — hạng thấp hơn phép đo giá trị trả về. Nó chỉ được
 *   dùng cho những câu mà giá trị trả về không nói được (trang bọc `trpc`, cảnh
 *   bọc WebGL). Kết cục pixel do `.qa-tapdoan/t20-do.mjs` đo trên trình duyệt
 *   thật; tệp này chỉ canh các khớp nối giữa hai đầu ấy.
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => docMaNguon(resolve(GOC, p));
/** G92 — TƯỚC CHÚ THÍCH trước khi đo: docblock ở dưới nhắc mọi tên cần tìm. */
const TUOC = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TRANG = TUOC(doc("src/pages/TwinVanHanh.tsx"));
const CANH = TUOC(doc("src/components/twin3d/van-hanh/CanhVanHanh.tsx"));
const LOP = TUOC(doc("src/components/twin3d/van-hanh/LopSaBan.tsx"));

const NGU = ["vi", "en", "zh"] as const;
const banDich = (ngu: string) =>
  JSON.parse(readFileSync(resolve(GOC, `src/i18n/locales/${ngu}.json`), "utf8")) as Record<
    string,
    unknown
  >;
const chuoi = (ngu: string, khoa: string): string | undefined => {
  let cur: unknown = banDich(ngu);
  for (const manh of khoa.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[manh];
  }
  return typeof cur === "string" ? cur : undefined;
};

describe("★ dữ kiện nền — không đo trên chuỗi rỗng", () => {
  it("đọc được cả ba tệp và chúng đúng là thứ cần đo", () => {
    expect(TRANG.length).toBeGreaterThan(50_000);
    expect(CANH.length).toBeGreaterThan(10_000);
    expect(LOP.length).toBeGreaterThan(2_000);
    expect(TRANG).toContain("<CanhVanHanh");
    expect(LOP).toContain("export function LopSaBan");
  });
});

describe("★★★ S1 — TRANG dựng sa bàn, không còn dựng khuôn viên toạ độ thật", () => {
  it("`khuonVien` gọi `saBanTapDoan(kvToaNha)`", () => {
    const i = TRANG.indexOf("const khuonVien = useMemo");
    expect(i).toBeGreaterThan(-1);
    const than = TRANG.slice(i, TRANG.indexOf("  );", i));
    expect(than).toContain("saBanTapDoan(kvToaNha)");
  });

  it("★★★ trang KHÔNG gọi thẳng `khuonVienTapDoan` nữa — hai bố cục cùng lúc là hai sự thật", () => {
    // `saBanTapDoan` gọi hàm cũ TỪ BÊN TRONG (để giữ `soCapChong`/kích thước
    // thật). Một lời gọi THỨ HAI ở trang nghĩa là trang tự chọn bố cục lần nữa.
    expect(TRANG).not.toMatch(/\bkhuonVienTapDoan\s*\(/);
  });

  it("★ sàn VẪN lấy kích thước từ `khuonVien` (W4 ④) — nay là kích thước SA BÀN", () => {
    expect(TRANG).toContain("khuonVien !== null ? khuonVien.rongMm :");
    expect(TRANG).toContain("khuonVien !== null ? khuonVien.sauMm :");
  });
});

describe("★★★ S2 — PROP `saBan` ĐI ĐỦ ĐƯỜNG (G16: 'có mặt' ≠ 'được truyền')", () => {
  it("trang dựng `saBanVe` bằng `dungSaBanVe(` và truyền xuống cảnh", () => {
    const i = TRANG.indexOf("const saBanVe = useMemo");
    expect(i).toBeGreaterThan(-1);
    const than = TRANG.slice(i, TRANG.indexOf("  }, [", i));
    expect(than).toContain("dungSaBanVe(");
    // Rỗng ⇒ hằng module ổn định, KHÔNG `[]` literal mỗi render.
    expect(TRANG).toContain("saBanVe?.toa ?? SA_BAN_RONG");
    expect(TRANG).toContain("saBanVe?.cum ?? SA_BAN_CUM_RONG");
    expect(TRANG).toContain("saBan={saBanToa}");
    expect(TRANG).toContain("saBanCum={saBanCum}");
  });

  it("★★★ `CanhVanHanh` ghim prop mới ở CẢ BA chỗ — thiếu một là prop không tới thân", () => {
    // Bài học Đợt 45/49 (G5): kiểu `PropsDuLieu` + bộ ổn định theo giá trị + chỗ
    // truyền xuống `CanhVanHanhOnDinh`. Thiếu chỗ thứ hai ⇒ mỗi nhịp poll dựng
    // mảng mới cùng giá trị ⇒ `frameloop="demand"` thành vòng lặp im lặng.
    expect(CANH).toMatch(/\|\s*"saBan"/);
    expect(CANH).toMatch(/\|\s*"saBanCum"/);
    expect(CANH).toContain("useOnDinhTheoGiaTri(props.saBan, khoaGiaTri(props.saBan))");
    expect(CANH).toContain("useOnDinhTheoGiaTri(props.saBanCum, khoaGiaTri(props.saBanCum))");
    expect(CANH).toContain("saBan={saBan}");
    expect(CANH).toContain("saBanCum={saBanCum}");
  });
});

describe("★★★ S3 — SA BÀN **THAY** LỚP MÁY, không đứng cạnh nó", () => {
  it("`LopSaBan` và `LoBatchMay` ở hai nhánh của MỘT biểu thức ba ngôi", () => {
    expect(CANH).toContain("<LopSaBan");
    // Nhánh điều kiện: `veSaBan ? <LopSaBan …/> : (<>… <LoBatchMay …/> …</>)`.
    const i = CANH.indexOf("veSaBan ?");
    expect(i, "phải có nhánh `veSaBan ?`").toBeGreaterThan(-1);
    const j = CANH.indexOf("<LopSaBan", i);
    const k = CANH.indexOf("<LoBatchMay", i);
    expect(j).toBeGreaterThan(i);
    expect(k).toBeGreaterThan(j);
    // RB-4 vẫn chỉ MỘT lô máy trong cả tệp.
    expect((CANH.match(/<LoBatchMay/g) ?? []).length).toBe(1);
    expect((CANH.match(/<LopSaBan/g) ?? []).length).toBe(1);
  });

  it("★★★ ĐỐI CHỨNG ÂM — rỗng ⇒ cây CŨ, và `veSaBan` suy từ ĐỘ DÀI chứ không từ một cờ", () => {
    // `/twin` một nhà máy là đường đang dùng được; nó chỉ không đổi khi `saBan`
    // rỗng cho ra đúng cây cũ. Một cờ boolean riêng sẽ tách "có dữ liệu" khỏi
    // "vẽ lớp nào" và mở đúng khe cho một cảnh trắng im lặng.
    expect(CANH).toContain("const veSaBan = saBan.length > 0;");
    expect(CANH).toContain("props.saBan ?? EMPTY_SA_BAN");
    expect(CANH).toContain("props.saBanCum ?? EMPTY_SA_BAN_CUM");
  });

  it("★ cửa sổ đo `__demSaBan` CHỈ gắn ở chế độ đo, và có dọn", () => {
    expect(LOP).toContain("laCheDoDo()");
    expect(LOP).toContain("w.__demSaBan = {");
    expect(LOP).toContain("delete w.__demSaBan;");
  });

  it("★ RB-7 — geometry/material tự cấp phát đều `dispose()`", () => {
    expect(LOP).toContain("hinhToa.dispose()");
    expect(LOP).toContain("vlToa.dispose()");
    expect(LOP).toContain("hinhNen.dispose()");
    expect(LOP).toContain("vlNen.dispose()");
  });

  it("★ RB-8.3 — lớp trong cây Canvas KHÔNG gọi `t()`", () => {
    expect(LOP).not.toMatch(/\bt\(\s*["']/);
    expect(LOP).not.toContain("useTranslation");
  });
});

describe("★★★ S4 — LỜI KHAI ĐI THEO BẢN VÁ TRONG CÙNG MỘT LƯỢT", () => {
  it("★★★ banner bật theo `laSoDo` (LUÔN ở cấp tập đoàn), không theo `daRaiLuoi`", () => {
    const i = TRANG.indexOf('testId: "banner-vi-tri-tam-sinh"');
    expect(i).toBeGreaterThan(-1);
    const khoi = TRANG.slice(i, i + 1_400);
    expect(khoi).toMatch(/hien:\s*khuonVien !== null && khuonVien\.laSoDo/);
    // Điều kiện cũ làm lời khai thành NỬA SỰ THẬT khi vị trí luôn là sơ đồ.
    expect(khoi).not.toContain("khuonVien.daRaiLuoi");
    expect(khoi).toContain("twin3d.vanHanh.viTriSoDo");
  });

  it("★★★ banner nêu SỐ THẬT, không nêu tính từ — CHÍN ô thay số có mặt ở chỗ gọi", () => {
    const i = TRANG.indexOf('testId: "banner-vi-tri-tam-sinh"');
    const khoi = TRANG.slice(i, i + 2_600);
    for (const o of ["soToa:", "soKhoi:", "rongThat:", "rongSoDo:"]) {
      expect(khoi, `thiếu ${o}`).toContain(o);
    }
    // ★ PH-50 — cỡ cũng thành sơ đồ, nên banner phải nêu CỠ ĐANG VẼ và CẠNH THẬT.
    for (const o of ["rongBieuTuong:", "sauBieuTuong:", "canhNho:", "canhLon:"]) {
      expect(khoi, `thiếu ${o}`).toContain(o);
    }
    /*
     * ★★★ 2026-09-21 — Ô THỨ CHÍN: `sanCao`.
     *   Chủ dự án chốt nâng sàn chiều cao 6 → 20 m để đạt 24 px (1/14 toà bị nâng). Câu banner
     *   cũ kết bằng *"chiều cao của mỗi khối là số thật"* — với sàn ấy nó **thành sai** cho toà
     *   24 (cao thật 8 m). Cùng luật đã ghi ở ô trước: lời khai phải rộng ra TRONG CÙNG LƯỢT
     *   với bản vá sinh ra nó.
     */
    expect(khoi, "thiếu sanCao:").toContain("sanCao:");
    /*
     * ⚠ G12 — phải ĐỌC TỪ HẰNG, không chép con số. Chép "20" vào đây thì đổi hằng sẽ làm banner
     *   nói dối mà không ca kiểm nào đỏ.
     */
    expect(khoi).toContain("mmSangMet(BIEU_TUONG_CAO_TOI_THIEU_MM)");
    expect(khoi).not.toMatch(/sanCao:\s*\d/);
    expect(khoi).toContain("khuonVien?.thatRongMm");
    expect(khoi).toContain("khuonVien?.bieuTuongRongMm");
    expect(khoi).toContain("khuonVien?.thatCanhLonNhatMm");
    // `data-*` để phép đo ngoài trang đọc được con số, không phải đọc câu chữ.
    expect(khoi).toContain('"data-so-toa"');
    expect(khoi).toContain('"data-rong-that-mm"');
    expect(khoi).toContain('"data-rong-so-do-mm"');
    expect(khoi).toContain('"data-bieu-tuong-rong-mm"');
    expect(khoi).toContain('"data-that-canh-lon-mm"');
  });

  /**
   * ★★★ PH-50 — Ô NÀY ĐỔI TỪ "BỐN Ô" SANG "TÁM Ô", ghi rõ vì sao.
   *   Từ PH-50 `saBanTapDoan` vẽ MỌI mặt bằng cùng một cỡ. Câu banner cũ chỉ khai
   *   *vị trí* là sơ đồ; để nguyên thì màn khoe biểu tượng mà giấu việc đã bỏ mất
   *   tỉ số kích thước 101 lần (`qatd_admin`: cạnh thật 29,6 m … 3.000 m). Lời
   *   khai phải rộng ra **trong cùng lượt** với bản vá sinh ra nó.
   */
  it("★★★ CHỮ người dùng đọc có ĐỦ CHÍN ô thay số ở CẢ BA ngôn ngữ", () => {
    for (const ngu of NGU) {
      const s = chuoi(ngu, "twin3d.vanHanh.viTriSoDo");
      expect(s, `${ngu} thiếu khoá viTriSoDo`).toBeTruthy();
      for (const o of [
        "{{soToa}}",
        "{{soKhoi}}",
        "{{rongThat}}",
        "{{rongSoDo}}",
        "{{rongBieuTuong}}",
        "{{sauBieuTuong}}",
        "{{canhNho}}",
        "{{canhLon}}",
        "{{sanCao}}",
      ]) {
        expect(s, `${ngu} thiếu ${o}`).toContain(o);
      }
      expect(chuoi(ngu, "twin3d.vanHanh.toaKhongTen"), `${ngu} thiếu toaKhongTen`).toContain(
        "{{id}}",
      );
    }
  });

  it("★★★ KHOÁ CŨ ĐÃ BỊ GỠ — QĐ-18: lời khai không bao giờ đúng nữa thì GỠ, không TẮT", () => {
    for (const ngu of NGU) {
      expect(chuoi(ngu, "twin3d.vanHanh.viTriTamSinh"), `${ngu} còn khoá chết`).toBeUndefined();
    }
    expect(TRANG).not.toContain("viTriTamSinh");
  });

  it("★ en/zh KHÔNG lọt dấu tiếng Việt (cùng luật mọi chuỗi mới của dự án)", () => {
    const dauViet = /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/;
    for (const ngu of ["en", "zh"] as const) {
      for (const khoa of ["twin3d.vanHanh.viTriSoDo", "twin3d.vanHanh.toaKhongTen"]) {
        expect(dauViet.test(chuoi(ngu, khoa) ?? ""), `${ngu}.${khoa}`).toBe(false);
      }
    }
  });
});

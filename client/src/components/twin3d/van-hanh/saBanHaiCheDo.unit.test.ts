/**
 * saBanHaiCheDo.unit.test.ts — ★★★ SA BÀN ĐÃ ĐƯỢC NỐI VÀO **CẢ HAI** CHẾ ĐỘ,
 * và mọi lời khai của màn đi theo trong CÙNG MỘT LƯỢT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỆP NÀY TỒN TẠI RIÊNG VỚI `saBan2D.dom.test.tsx`
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp `.dom.` chứng minh `CanhVanHanh2D` **biết** vẽ sa bàn khi được đưa dữ
 * liệu. Nó không biết trang có đưa hay không — đúng khe G16 mà Task 20 đã phải
 * dựng `saBanNoiVaoTrang.unit.test.ts` để bịt cho bản 3D: prop có mặt trong
 * kiểu, `tsc` xanh, mọi lưới module xanh, `grep` ra **0 chỗ truyền**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỜI KHAI SAI THỨ NĂM — ĐANG SỐNG, ĐO ĐƯỢC, VÀ TỆP NÀY ĐÓNG NÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Đo trên `dist-ph45` (trình duyệt thật, `?pv=tapdoan`, vai `qatd_giamdoc`),
 * `.qa-tapdoan/b1-loikhai-truoc.json` — NGUYÊN VĂN hai bề mặt ở chế độ **2D**:
 *
 *   `aria-label` = "2D factory map: **1108 machines**, 55 open alarms, 1108
 *                  machines with no signal"
 *   `banner-vi-tri-tam-sinh` = "The corporate scene is a SCHEMATIC SITE MODEL:
 *                  **each building is an icon**, and 12 buildings across 3
 *                  factories are grouped into clusters…"
 *
 * Hai câu ấy đứng CẠNH NHAU trên cùng một màn và loại trừ nhau: cảnh 2D lúc đó
 * vẽ 1.108 khối máy và **0** biểu tượng toà. Banner nói về sa bàn của bản 3D.
 * Đó là lời khai sai cùng lớp với bốn cái đợt này đã vá — và người dùng gặp nó
 * chỉ bằng một cú bấm nút 2D.
 *
 * ⇒ Bản vá: cho 2D vẽ đúng biểu tượng ⇒ câu banner thành THẬT ở **cả hai** chế
 *   độ (không phải thêm một câu thứ năm để chống chế cho câu thứ tư), và đổi
 *   `aria-label` ở cấp sa bàn sang câu nói đúng biểu tượng toà.
 *
 * ⚠⚠ ĐÍNH CHÍNH LỜI KHAI CỦA CHÍNH TỆP NÀY (bản nháp đầu viết sai, sửa sau khi
 *   đo): bản nháp khai *"chế độ 3D `aria-label` = 3D factory scene: 1108
 *   machines"*. SAI. Đo lại (`b1-loikhai-truoc.json`, và census nguồn: `grep
 *   ariaLabel CanhVanHanh.tsx` ra ĐÚNG hai dòng — khai kiểu ở `:143` và truyền
 *   xuống ở `:927` — còn `KhungCanh.tsx` KHÔNG có chữ `aria` nào):
 *
 *     chế độ 3D · `aria-label` = **null** — cảnh 3D KHÔNG có tên khả truy cập
 *                 nào cả. Chuỗi `canhAria` đi hết `CanhVanHanh` → `NoiDung` rồi
 *                 bị RƠI: prop có mặt, `tsc` xanh, 0 chỗ tiêu thụ (đúng khuôn
 *                 G16).
 *
 *   Đó là một khuyết tật RIÊNG, có TRƯỚC lượt này, và **bản vá này KHÔNG chữa**:
 *   chữa nó phải đụng `KhungCanh.tsx` (dùng chung 4 màn) và cách hiển nhiên
 *   nhất — thêm `role="img"` lên khung bọc — sẽ BIẾN MỌI LỚP PHỦ BÊN TRONG
 *   thành presentational, tức đổi một khuyết tật lấy một khuyết tật nặng hơn.
 *   Ghi ra đây để lượt sau không phải đo lại. Khoá `canhAriaSaBan` (nhánh 3D)
 *   vẫn được thêm cho đối xứng với chỗ gọi đã có, và hôm nay nó chưa hiển thị.
 *
 * ⚠ Đây là phép đo VĂN BẢN (hạng thấp hơn phép đo giá trị trả về) — chỉ dùng cho
 *   những khớp nối mà giá trị trả về không nói được. Kết cục pixel do
 *   `.qa-tapdoan/b1-do-2d.mjs` đo trên trình duyệt thật.
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { docMaNguon } from "@shared/testing/docMaNguon";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => docMaNguon(resolve(GOC, p));
/** G92 — TƯỚC CHÚ THÍCH trước khi đo: docblock phía trên nhắc mọi tên cần tìm. */
const TUOC = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TRANG = TUOC(doc("src/pages/TwinVanHanh.tsx"));
const HAI_D = TUOC(doc("src/components/twin3d/van-hanh/CanhVanHanh2D.tsx"));
const LOP = TUOC(doc("src/components/twin3d/van-hanh/LopSaBan.tsx"));
const HOP = TUOC(doc("src/components/twin3d/van-hanh/hopNhatCanh.ts"));

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
  it("đọc được cả bốn tệp và chúng đúng là thứ cần đo", () => {
    expect(TRANG.length).toBeGreaterThan(50_000);
    expect(HAI_D.length).toBeGreaterThan(2_000);
    expect(LOP.length).toBeGreaterThan(2_000);
    expect(HOP.length).toBeGreaterThan(5_000);
    expect(TRANG).toContain("<CanhVanHanh2D");
    expect(HAI_D).toContain("export function CanhVanHanh2D");
  });
});

describe("★★★ K1 — TRANG TRUYỀN SA BÀN XUỐNG **CẢ HAI** CẢNH", () => {
  it("`saBan={saBanToa}` và `saBanCum={saBanCum}` xuất hiện ĐÚNG HAI lần mỗi cái", () => {
    // Hai chỗ = `<CanhVanHanh>` (3D, Task 20) + `<CanhVanHanh2D>` (bản vá này).
    // Đếm CHÍNH XÁC chứ không `toContain`: `toContain` xanh ngay cả khi bản 2D
    // vẫn chưa được nối — đúng thứ G16 sinh ra để bắt.
    expect([...TRANG.matchAll(/saBan=\{saBanToa\}/g)]).toHaveLength(2);
    expect([...TRANG.matchAll(/saBanCum=\{saBanCum\}/g)]).toHaveLength(2);
  });

  it("★★★ chỗ truyền thứ hai nằm TRONG khối `<CanhVanHanh2D`, không lạc sang chỗ khác", () => {
    const i = TRANG.indexOf("<CanhVanHanh2D");
    expect(i).toBeGreaterThan(-1);
    const khoi = TRANG.slice(i, TRANG.indexOf("/>", i));
    expect(khoi).toContain("saBan={saBanToa}");
    expect(khoi).toContain("saBanCum={saBanCum}");
  });
});

describe("★★★ K2 — BẢN 2D: SA BÀN **THAY** LỚP MÁY, suy từ ĐỘ DÀI", () => {
  it("`veSaBan` suy từ `saBan.length > 0`, không từ một cờ riêng", () => {
    // Một cờ boolean riêng tách "có dữ liệu" khỏi "vẽ lớp nào" và mở đúng khe
    // cho một cảnh trắng im lặng — cùng lý lẽ `CanhVanHanh.tsx` đã ghi cho 3D.
    expect(HAI_D).toContain("saBan.length > 0");
  });

  it("★★★ hai nhánh loại trừ nhau: không bao giờ vừa vẽ máy vừa vẽ biểu tượng", () => {
    expect(HAI_D).toContain("veSaBan ?");
    const iVe = HAI_D.indexOf("veSaBan ?");
    const iToa = HAI_D.indexOf("toa-2d-sa-ban", iVe);
    const iMay = HAI_D.indexOf("may-2d-", iVe);
    expect(iToa).toBeGreaterThan(iVe);
    expect(iMay).toBeGreaterThan(iToa);
  });

  it("★ prop mới có mặc định RỖNG bằng HẰNG MODULE — `[]` literal dựng mảng mới mỗi render", () => {
    expect(HAI_D).toMatch(/saBan\s*=\s*SA_BAN_2D_RONG/);
    expect(HAI_D).toMatch(/saBanCum\s*=\s*SA_BAN_2D_CUM_RONG/);
  });
});

describe("★★★ K3 — MỘT BẢNG MÀU, MỘT NGUỒN (không dựng bản thứ hai cho 2D)", () => {
  it("bảng màu sa bàn nằm ở `hopNhatCanh.ts` và ĐƯỢC XUẤT", () => {
    expect(HOP).toContain("export const MAU_BIEU_TUONG_TOA");
    expect(HOP).toContain("export const NEN_CUM_SANG");
    expect(HOP).toContain("export const NEN_CUM_TOI");
  });

  it("★★★ `LopSaBan` (3D) THÔI tự khai bảng màu — nó phải NHẬP từ nguồn chung", () => {
    // Nếu 3D giữ bảng riêng thì hai chế độ lại tách ra lần nữa, lần này ở MÀU:
    // đúng lớp lỗi mà cả bản vá này sinh ra để đóng, chỉ khác trục.
    expect(LOP).not.toMatch(/const\s+NEN_CUM_SANG\s*=/);
    expect(LOP).not.toMatch(/const\s+NEN_CUM_TOI\s*=/);
    expect(LOP).toMatch(/NEN_CUM_SANG[\s\S]{0,400}from "\.\/hopNhatCanh"|hopNhatCanh[\s\S]{0,400}NEN_CUM_SANG/);
  });

  it("★ bản 2D cũng nhập từ đó, không chép hex vào tệp mình", () => {
    expect(HAI_D).toContain("MAU_BIEU_TUONG_TOA");
    expect(HAI_D).toContain("NEN_CUM_SANG");
    // Không một mã màu sa bàn nào được viết tay trong tệp 2D.
    for (const hex of ["#9aa8ba", "#7e8ea4", "#cbd5e1", "#27364b"]) {
      expect(HAI_D, `chép tay ${hex}`).not.toContain(hex);
    }
  });
});

describe("★★★ K4 — `aria-label` NÓI ĐÚNG ĐƠN VỊ VẼ (lời khai sai thứ năm)", () => {
  it("trang chọn khoá aria theo CÓ SA BÀN HAY KHÔNG, không chỉ theo 2D/3D", () => {
    const i = TRANG.indexOf("const ariaLabel = ");
    expect(i).toBeGreaterThan(-1);
    const khoi = TRANG.slice(i, i + 900);
    expect(khoi).toContain("veSaBan");
    expect(khoi).toContain("canhAriaSaBan");
  });

  it("★★★ `veSaBan` của TRANG suy từ chính mảng được truyền xuống cảnh", () => {
    // Không được suy từ `phamVi.cap === 'tapdoan'`: hai đường có thể lệch nhau
    // (hạ cấp phạm vi), và lúc lệch thì câu aria lại sai lần nữa.
    expect(TRANG).toMatch(/const veSaBan = saBanToa\.length > 0;/);
  });

  it("★★★ BỐN khoá aria tồn tại ở CẢ BA ngôn ngữ và mang đủ ô thay số", () => {
    for (const ngu of NGU) {
      for (const khoa of ["canhAria", "canhAria2D"]) {
        expect(chuoi(ngu, `twin3d.vanHanh.${khoa}`), `${ngu}.${khoa}`).toContain("{{may}}");
      }
      for (const khoa of ["canhAriaSaBan", "canhAriaSaBan2D"]) {
        const s = chuoi(ngu, `twin3d.vanHanh.${khoa}`);
        expect(s, `${ngu} thiếu ${khoa}`).toBeTruthy();
        for (const o of ["{{soToa}}", "{{soKhoi}}", "{{canhBao}}"]) {
          expect(s, `${ngu}.${khoa} thiếu ${o}`).toContain(o);
        }
        // ★★★ Câu mới KHÔNG được nhắc "{{may}}": đó chính là con số đã nói dối.
        expect(s, `${ngu}.${khoa} còn nói số máy`).not.toContain("{{may}}");
      }
    }
  });

  it("★ en/zh KHÔNG lọt dấu tiếng Việt (luật chung cho mọi chuỗi mới)", () => {
    const dauViet =
      /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/;
    for (const ngu of ["en", "zh"] as const) {
      for (const khoa of ["canhAriaSaBan", "canhAriaSaBan2D"]) {
        expect(dauViet.test(chuoi(ngu, `twin3d.vanHanh.${khoa}`) ?? ""), `${ngu}.${khoa}`).toBe(
          false,
        );
      }
    }
  });
});

describe("★★★ K5 — ĐỐI CHỨNG ÂM Ở TẦNG NGUỒN: đường một nhà máy không bị đụng", () => {
  it("`may={mayVeTatCa}` vẫn ĐÚNG HAI chỗ — bản vá không đổi nguồn máy của cảnh", () => {
    // `nguonKpiTheoTang.unit.test.ts` ghim cùng con số; lặp ở đây để bản vá này
    // tự biết nếu nó làm lệch, thay vì để một tệp khác đỏ và phải đi truy ngược.
    expect([...TRANG.matchAll(/may=\{mayVeTatCa\}/g)]).toHaveLength(2);
  });

  it("★ bản 2D vẫn nhận đủ prop cũ — không prop nào bị bản vá nuốt", () => {
    const i = TRANG.indexOf("<CanhVanHanh2D");
    const khoi = TRANG.slice(i, TRANG.indexOf("/>", i));
    for (const p of [
      "may={mayVeTatCa}",
      "trangThaiTheoMay={trangThaiTheoMay}",
      "maTheoMay={maTheoMay}",
      "machineIdChon={machineIdNgan}",
      "onChonMay={chonMay}",
      "sanRongM={sanRongM}",
      "sanSauM={sanSauM}",
      "ariaLabel={ariaLabel}",
    ]) {
      expect(khoi, `thiếu ${p}`).toContain(p);
    }
  });
});

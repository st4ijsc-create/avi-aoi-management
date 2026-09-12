/**
 * ════════════════════════════════════════════════════════════════════════════
 * `cheNhan.unit.test.ts` — ĐỢT 35 (Pareto #5): LỚP PHỦ DOM TỰ KHAI `data-che-nhan`, CHIP SỰ CỐ NỐI VÀO TRANG
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `locNhan.unit.test.ts` chứng minh kit BỎ nhãn dưới vùng cấm khi được TRUYỀN vùng cấm. Tệp này hỏi câu G93
 * còn lại: **ai truyền, và lớp phủ nào tự khai?** Thiếu một dấu `data-che-nhan` trên một panel mới = nhãn
 * lại nằm dưới panel ấy, im lặng. Hạng B (văn bản đã tước chú thích — G92) vì các thẻ này nằm trong JSX có
 * `<Canvas>`; e2e E5 (`.qa-dot35`) đo kết cục thật.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { THUOC_TINH_CHE_NHAN } from "../loi/LopNhan";

const GOC = resolve(__dirname, "../../../..");
const tuoc = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const doc = (p: string) => tuoc(readFileSync(resolve(GOC, p), "utf8"));
/** Thẻ mở của phần tử mang `data-testid="<id>"` (từ `<` gần nhất trước nó tới `>` sau nó). */
function theMo(ma: string, testId: string): string {
  const i = ma.indexOf(`data-testid="${testId}"`);
  expect(i, `không thấy data-testid="${testId}"`).toBeGreaterThan(-1);
  const dau = ma.lastIndexOf("<", i);
  const cuoi = ma.indexOf(">", i);
  return ma.slice(dau, cuoi + 1);
}

const LOP_NHAN = doc("src/components/twin3d/loi/LopNhan.tsx");
const CANH = doc("src/components/twin3d/van-hanh/CanhVanHanh.tsx");
const LINE = doc("src/pages/TwinLine.tsx");
const VAN_HANH = doc("src/pages/TwinVanHanh.tsx");
const MAY = doc("src/pages/TwinMay.tsx");
const KPI = doc("src/components/twin3d/van-hanh/BangKpiNoi.tsx");
const MO_PHONG = doc("src/components/twin3d/van-hanh/NganMoPhong.tsx");

describe("★★★ ① Lớp phủ ĐÈ canvas tự khai `data-che-nhan` — mỗi cái đo được từ QA Đợt 32", () => {
  it("hằng thuộc tính là `data-che-nhan` (LopNhan đọc đúng chuỗi này)", () => {
    expect(THUOC_TINH_CHE_NHAN).toBe("data-che-nhan");
    expect(LOP_NHAN).toMatch(/querySelectorAll<HTMLElement>\(`\[\$\{THUOC_TINH_CHE_NHAN\}\]`\)/);
  });
  it.each([
    ["BangKpiNoi (Metrics, che nhãn 43–83 % ở Line/`/twin`)", KPI, "bang-kpi-noi"],
    ["NganMoPhong (góc phải màn Line)", MO_PHONG, "ngan-mo-phong"],
    ["/twin panel trái NỔI ĐÈ", VAN_HANH, "panel-trai"],
    ["/twin panel phải NỔI ĐÈ", VAN_HANH, "panel-phai"],
    ["/twin lớp phủ dòng thời gian (đáy)", VAN_HANH, "lop-phu-dong-thoi-gian"],
    ["/twin/may chip máy (góc trái trên canvas)", MAY, "chip-may"],
  ])("%s mang `data-che-nhan`", (_ten, ma, tid) => {
    expect(theMo(ma, tid)).toMatch(/data-che-nhan="1"/);
  });
  it("★ ĐỐI CHỨNG — phép đo thẻ mở BIẾT KÊU: một thẻ không có thuộc tính thì không khớp", () => {
    expect(theMo(LINE, "thanh-tren-line")).not.toMatch(/data-che-nhan/);
  });
});

describe("★★★ ② LopNhan — bỏ biên ±10 %, truyền khung canvas + vùng cấm DOM thật xuống `locNhan`", () => {
  it("không còn biên `0.1 * size.width` / `1.1 * size.width`; `ngoaiKhung` = neo ngoài canvas", () => {
    expect(LOP_NHAN).not.toMatch(/0\.1 \* size\.width/);
    expect(LOP_NHAN).not.toMatch(/1\.1 \* size\.(width|height)/);
    expect(LOP_NHAN).toMatch(/mh === null \|\| mh\.x < 0 \|\| mh\.x > size\.width \|\| mh\.y < 0 \|\| mh\.y > size\.height/);
  });
  it("gọi `locNhan(ungVien, { …, khungCanvas: { rong: size.width, cao: size.height }, vungCam })` với `vungCam = layVungCam(gl.domElement)`", () => {
    expect(LOP_NHAN).toMatch(/const vungCam = layVungCam\(gl\.domElement\)/);
    expect(LOP_NHAN).toMatch(/khungCanvas: \{ rong: size\.width, cao: size\.height \}/);
    expect(LOP_NHAN).toMatch(/locNhan\(ungVien, \{[\s\S]*?vungCam,[\s\S]*?\}\)/);
  });
  it("cửa sổ đo `__demNhan` mang `vuotMep` · `biChe` · `soVungCam` · `suCoNgoaiKhung` (e2e đọc đúng khoá)", () => {
    for (const k of ["vuotMep: kq.soVuotMep", "biChe: kq.soBiChe", "soVungCam: vungCam.length", "suCoNgoaiKhung: kq.soBatThuongNgoaiKhung"]) {
      expect(LOP_NHAN).toContain(k);
    }
  });
  it("chip `chip-su-co-ngoai-khung` có `data-so`, chỉ render khi có chữ đã dịch (`chuSuCoNgoaiKhung`) và số > 0", () => {
    expect(LOP_NHAN).toMatch(/chuSuCoNgoaiKhung && soSuCoNgoai > 0 \? \(/);
    expect(LOP_NHAN).toMatch(/data-testid="chip-su-co-ngoai-khung"\s+data-so=\{soSuCoNgoai\}/);
    // số sự cố đi vào CHỮ KÝ setState — xoay camera đưa máy ra/vào khung phải đổi chip ngay.
    // ★ Đợt 49 (mục D) — chữ ký nay có thêm `soAnBadge` (số CẢNH BÁO bị giấu, đọc từ sổ chung
    //   `docSoAn`): badge cuối cùng tìm được chỗ mà tập nhãn không đổi thì chip phải tắt ngay,
    //   không chờ một khung khác. Ba số, một chữ ký — đúng lý do `soBiGiau` đã ở đây từ Đợt 23.
    expect(LOP_NHAN).toMatch(
      /`\$\{kq\.soBiGiau\}#\$\{kq\.soBatThuongNgoaiKhung\}#\$\{soAnBadge\}#`/,
    );
  });
});

describe("★★★ ③ Chip sự cố NỐI VÀO TRANG: CanhVanHanh chuyển tiếp, Line + `/twin` gọi `t()` (RB-8.3)", () => {
  it("`CanhVanHanh` truyền `chuSuCoNgoaiKhung={props.chuSuCoNgoaiKhung}` xuống `<LopNhan`", () => {
    expect(CANH).toMatch(/<LopNhan[\s\S]*?chuSuCoNgoaiKhung=\{props\.chuSuCoNgoaiKhung\}/);
  });
  it.each([
    ["TwinLine", LINE],
    ["TwinVanHanh (/twin)", VAN_HANH],
  ])("%s truyền `chuSuCoNgoaiKhung` với khoá `twin3d.vanHanh.suCoNgoaiKhung`", (_t, ma) => {
    expect(ma).toMatch(/<CanhVanHanh[\s\S]*?chuSuCoNgoaiKhung=\{\(n\) =>\s*t\("twin3d\.vanHanh\.suCoNgoaiKhung"/);
  });
  it("khoá i18n có ở CẢ ba ngôn ngữ, mang `{{n}}` (không chuỗi rác)", () => {
    for (const l of ["en", "vi", "zh"]) {
      const j = JSON.parse(readFileSync(resolve(GOC, `src/i18n/locales/${l}.json`), "utf8")) as { twin3d: { vanHanh: Record<string, string> } };
      expect(j.twin3d.vanHanh.suCoNgoaiKhung, l).toContain("{{n}}");
    }
  });
});

describe("★★★ ④ Máy có ANDON ⇒ nhãn `batThuong` — nối vào cả hai trang (không thì chip sự cố đếm 0 mãi)", () => {
  it("`dungNhanMay` đọc `ts.andonTheoMay?.has(m.machineId)` (kit)", () => {
    const HOP_NHAT = doc("src/components/twin3d/van-hanh/hopNhatCanh.ts");
    expect(HOP_NHAT).toMatch(/batThuong: kieu\.laBatThuong \|\| \(ts\.andonTheoMay\?\.has\(m\.machineId\) \?\? false\)/);
  });
  it.each([
    ["TwinLine", LINE],
    ["TwinVanHanh (/twin)", VAN_HANH],
  ])("%s truyền `andonTheoMay` vào `dungNhanMay` — tập id máy có andon CHƯA resolved", (_t, ma) => {
    expect(ma).toMatch(/dungNhanMay\(\{[\s\S]*?andonTheoMay[\s\S]*?\}\)/);
    expect(ma).toMatch(/const andonTheoMay = useMemo\(/);
  });
});

describe("★ ⑤ LopNhan BẬT xếp tầng (`xepTang: true`) — opt-in của kit, chỗ bật duy nhất", () => {
  it("`locNhan(ungVien, { …, xepTang: true })`", () => {
    expect(LOP_NHAN).toMatch(/locNhan\(ungVien, \{[\s\S]*?xepTang: true,[\s\S]*?\}\)/);
  });
});

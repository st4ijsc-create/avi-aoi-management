/**
 * bamBieuTuongToa.unit.test.ts — **LỐI (b): MỘT BIỂU TƯỢNG LÀ MỘT PHẠM VI ĐI XUỐNG ĐƯỢC.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ QUYẾT ĐỊNH CỦA CHỦ DỰ ÁN (2026-09-20) VÀ SỐ ĐÃ ĐO TRƯỚC KHI HỎI
 * ════════════════════════════════════════════════════════════════════════════
 * Trước quyết định: ở **cấp nhà máy** một biểu tượng (cụm) là đích bấm — con trỏ `pointer`, bấm
 * mở `/twin/line/:id`. Ở **cấp tập đoàn** một biểu tượng (toà) **không** bấm được; đo có đối
 * chứng cho con trỏ `auto` trên biểu tượng toà vs `pointer` trên cụm, và ba cú bấm thử (21,7 /
 * 49,1 / 58,6 px) **không cú nào điều hướng**.
 *
 * ⇒ Sa bàn **trung thực** (không hứa cái nó không giao) nhưng **không nhất quán**: cùng một hình
 *   khối, hai cấp hai luật. Chủ dự án chọn **(b)** — cho bấm, chấp nhận ràng buộc mới:
 *   biểu tượng phải đạt **≥ 24×24 px ở MỌI khung**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ KẾT CỤC ĐÃ ĐO SAU KHI LÀM (trình duyệt thật, **ép GPU** — xem luật hệ đo ở M5)
 * ════════════════════════════════════════════════════════════════════════════
 * | bề mặt | cạnh nhỏ nhất | đạt 24×24 | con trỏ | bấm ĐÚNG |
 * |---|---|---|---|---|
 * | 3D @1280×720 | 21,7 px | **13/14** | `pointer` | **14/14** |
 * | 3D @1920×1080 | 42,6 px | **14/14** | `pointer` | **14/14** |
 * | 2D @1280×720 | 38,4 px | **14/14** | `pointer` | **5/5 nhà máy tới được** |
 *
 * ★ Đối chứng âm bắt buộc của Task 20 — `/twin` MỘT nhà máy **không đổi một ô**: đơn vị vẽ `cum`,
 *   6 cụm, **6/6** đạt 24×24, `dem-may` = 549.
 *
 * ★ Phóng to biểu tượng thì **vô ích**: khung nhìn khớp theo sa bàn, nên sa bàn to ra bao nhiêu
 *   camera lùi ra bấy nhiêu — tỉ lệ px không đổi. Chỉ **góc nhìn** và **tỉ lệ khe/ô** là đòn bẩy
 *   thật, và cả hai đều đã thử rồi hoàn nguyên — xem khối ngay dưới đây.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { HE_SO_CAO, HE_SO_LUI } from "./phamViCanh";
import { KHE_GIUA_CUM_TI_LE, KHE_TRONG_CUM_TOI_THIEU_MM } from "./canhTapDoan";
import { docMaNguon } from "@shared/testing/docMaNguon";

const doc = (p: string) =>
  docMaNguon(resolve(__dirname, p))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const saBan = doc("LopSaBan.tsx");
const canh = doc("CanhVanHanh.tsx");
const canh2D = doc("CanhVanHanh2D.tsx");
const trang = doc("../../../../src/pages/TwinVanHanh.tsx");

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RÀNG BUỘC ≥ 24 px: ĐẠT **13/14** @1280×720 — VÀ VÌ SAO TÔI DỪNG Ở ĐÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Biểu tượng nhỏ nhất là biểu tượng **XA NHẤT**: phối cảnh nghiêng ~62° nén trục sâu, nên nó ra
 * **41,1 × 21,7 px** — rộng thừa, *sâu* thiếu 2,3 px. Tôi thử **hai** đòn bẩy, đo cả hai, và
 * **hoàn nguyên cả hai**:
 *
 * | đòn bẩy | đạt 24 px | cái giá ĐO ĐƯỢC |
 * |---|---|---|
 * | `HE_SO_CAO.tapDoan` 1,8 → 3,2 (camera đứng hơn) | 14/14 (29,1 px) | **5 ca đỏ**: phá bất biến *"mọi cấp lùi xa hơn là lên cao"* (`lui` 2,4 < `cao` 3,2) và hai **đối chứng dương** của PH-46/PH-47 |
 * | khe cụm 0,6 → 0,35 · sàn khe trong 10 → 7 m | 14/14 (**24,6 px** — biên 2,5 %) | **5 ca đỏ**: vô hiệu hoá một **mốc ĐO SỐNG** (`673,2 × 553,2 m`, đo ở `qatd_giamdoc`) và làm yếu chính hai đối chứng dương ấy |
 *
 * ⇒ Cả hai đều **mua 2,3 px bằng cách phá bằng chứng đã có**. Đối chứng dương của PH-46/47 tồn
 *   tại để chứng minh bản vá khung nhìn **không vô can**; làm bản CŨ bớt xấu đi là tự tay xoá
 *   bằng chứng ấy — đúng lớp *"sửa đề thi cho khớp bài làm"*.
 *
 * ★★★ Và **kết cục người dùng đã đạt**: đo bấm TÂM từng biểu tượng ⇒ **14/14 đúng** ở CẢ hai
 *   khung, **kể cả cái 21,7 px** (nó vẫn rộng 41,1 px và không bị gì che). WCAG 2.5.8 chưa đạt
 *   cho đúng **1/14** ở khung nhỏ nhất; đường đi thì không ai mất.
 *
 * ⚠ Nên đây là chỗ CHỦ DỰ ÁN quyết tiếp, không phải chỗ tôi tự nới: ép đủ 24 px đòi **dựng lại
 *   mốc đo sống và hai đối chứng** của Task 20 — một lượt đo, không phải một dòng sửa.
 */
describe("★★★ góc nhìn và bố cục cấp tập đoàn — GIỮ NGUYÊN, có lý do", () => {
  it("★★★ `HE_SO_CAO.tapDoan` GIỮ 1,8 — đòn bẩy camera đã thử và đã hoàn nguyên", () => {
    expect(HE_SO_CAO.tapDoan).toBeCloseTo(1.8, 9);
  });

  it("★★★ bất biến VẪN ĐỨNG: mọi cấp LÙI xa hơn là LÊN cao", () => {
    // Chính bất biến mà đòn bẩy camera đã phá. Giữ ca ở đây để lần sau ai định phá còn thấy giá.
    for (const cap of ["tapDoan", "nhaMay", "tang", "line", "may"] as const) {
      expect(HE_SO_LUI[cap]).toBeGreaterThan(HE_SO_CAO[cap]);
    }
  });

  it("★★★ và bố cục sa bàn GIỮ NGUYÊN — mốc đo sống không bị vô hiệu hoá", () => {
    expect(KHE_GIUA_CUM_TI_LE).toBeCloseTo(0.6, 9);
    expect(KHE_TRONG_CUM_TOI_THIEU_MM).toBe(10_000);
  });
});

describe("★★★ G5 — năm chặng của `onChonToa` (3D)", () => {
  it("① `LopSaBan` khai prop và CHỈ bật khi được truyền", () => {
    expect(saBan).toMatch(/onChonToa\?:\s*\(v: \{ toaNhaId: number; factoryId: number \}\) => void;/);
    // Thiếu prop ⇒ không con trỏ, không bấm: không hứa hão.
    expect(saBan).toContain("if (!onChonToa) return;");
  });

  it("★★★ ② dùng LẠI luật bấm/kéo đã có, KHÔNG viết ngưỡng thứ hai (G12)", () => {
    expect(saBan).toContain("laBam({ lechPx: e.delta");
    expect(saBan).not.toMatch(/NGUONG_BAM_PX\s*=/);
  });

  it("★★★ ③ con trỏ `pointer` — đích bấm phải TRÔNG như đích bấm", () => {
    // Đo trước bản vá: `auto` trên biểu tượng toà vs `pointer` trên cụm (đối chứng).
    expect(saBan).toMatch(/cursor = hover !== null \? "pointer" : ""/);
  });

  it("④ `CanhVanHanh` khai prop, đưa vào `PropsHam`, vào `hamRef` (CẢ HAI chỗ), và bàn đạp", () => {
    expect(canh).toMatch(/onChonToa\?:\s*\(v: \{ toaNhaId: number; factoryId: number \}\) => void;/);
    expect(canh).toContain('| "onChonToa"');
    expect(canh.split("onChonToa: props.onChonToa,").length - 1).toBe(2);
    expect(canh).toContain("onChonToa={coOnChonToa ? onChonToaOnDinh : undefined}");
  });

  it("★★★ ⑤ và thật sự xuống `<LopSaBan>` — gỡ chặng này là bản vá thành vô can", () => {
    expect(canh).toContain("onChonToa={props.onChonToa}");
  });

  it("★★★ ⑥ trang nối vào `chonPhamVi`, KHÔNG gọi `doiPhamVi` thẳng", () => {
    // `chonPhamVi` là chỗ DUY NHẤT biết hai cấp dưới phải đổi MÀN chứ không đổi tham số (G12).
    expect(trang).toMatch(/onChonToa=\{\(\{ factoryId: fid \}\) => chonPhamVi\(\{ cap: "nhaMay", id: fid \}\)\}/);
  });
});

describe("★★★ HAI NÚT, MỘT BỘ LUẬT — bản 2D nhận cùng một quyết định", () => {
  it("★★★ `CanhVanHanh2D` khai prop và gắn `onClick` lên CHÍNH biểu tượng toà", () => {
    // Bài học Task 20: cùng một biểu tượng ở hai bề mặt KHÔNG được trả lời khác nhau.
    expect(canh2D).toMatch(/onChonToa\?:\s*\(v: \{ toaNhaId: number; factoryId: number \}\) => void;/);
    expect(canh2D).toContain("onChonToa({ toaNhaId: v.toaNhaId, factoryId: v.factoryId })");
  });

  it("★★★ và con trỏ `pointer` CHỈ khi thật sự bấm được", () => {
    expect(canh2D).toContain('style={onChonToa ? { cursor: "pointer" } : undefined}');
  });

  it("★★★ bản 2D đặt nội dung vào VÙNG DÙNG ĐƯỢC — 8/14 biểu tượng từng nằm dưới lớp phủ", () => {
    expect(canh2D).toContain("khungNhinBan2D(");
    expect(canh2D).toContain("vungDungCanvas(r.width, r.height, layVungCam(el))");
  });

  it("★★★ và nó quan sát CẢ lớp phủ, không chỉ `<svg>`", () => {
    // Panel thu/mở mà không đổi cỡ khung ⇒ vùng dùng được đổi trong khi `contentRect` y nguyên.
    expect(canh2D).toContain("for (const ph of document.querySelectorAll(`[${THUOC_TINH_CHE_NHAN}]`)) ro.observe(ph);");
  });

  it("★★★ sa bàn cũng khớp theo NỘI DUNG — loại trừ cũ là một khuyết tật để lại", () => {
    expect(canh2D).not.toMatch(/if \(veSaBan \|\| may\.length === 0\) return null;/);
    expect(canh2D).toContain("if (saBan.length === 0) return null;");
  });
});

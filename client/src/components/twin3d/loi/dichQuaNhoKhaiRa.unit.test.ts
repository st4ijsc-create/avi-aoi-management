/**
 * dichQuaNhoKhaiRa.unit.test.ts — **AFFORDANCE KHÔNG CÓ CHỨC NĂNG PHẢI ĐƯỢC KHAI RA.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT — ĐO KẾT CỤC, KHÔNG ĐO CƠ CHẾ
 * ════════════════════════════════════════════════════════════════════════════
 * Trên `/twin/may/:id`, mỗi khối hàng xóm là một **đích bấm thật** (§15.3.3 đường ra ⑥: *"chọn
 * máy khác — thay tại chỗ, không chồng lớp"*), và màn ấy **không có một link `/twin/may/:id`
 * nào** — bấm khối 3D là đường đổi máy tại chỗ **duy nhất**.
 *
 * Bấm TÂM từng hàng xóm ở `/twin/may/8019` @1280×720 (n = 38, đo trên trình duyệt thật):
 *
 *   | cạnh nhỏ | bấm đúng |
 *   |---|---|
 *   | **≥ 24×24 px** | **5/5 = 100 %** |
 *   | **< 24×24 px** | **3/33 = 9 %** |
 *
 * ⇒ **30/38** khối trông như đích bấm mà bấm thì **không đi đâu cả, im lặng**.
 * ★ Và ngưỡng WCAG 2.5.8 hoá ra **gần đúng bằng** chỗ phép bấm bắt đầu hỏng — một xác nhận
 *   THỰC NGHIỆM cho con số mà cả đợt này đã dùng, thay vì một quy ước mượn về.
 *
 * Bản vá **không** làm chúng bấm được (phóng to hàng xóm là phá chính ngữ cảnh *"máy nào cạnh
 * máy nào"* mà §10C.2 cố ý giữ). Nó biến một hỏng **im lặng** thành một hỏng **có tên và có
 * đường đi**: chip chỉ sang màn Chuyền, nơi đích bấm nay đạt **39/39**.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { demDichQuaNho } from "./locNhan";
import { docMaNguon } from "@shared/testing/docMaNguon";

const hop = (machineId: number, canh: number) => ({
  machineId,
  hop: { trai: 0, phai: canh, tren: 0, duoi: canh },
});

describe("demDichQuaNho", () => {
  it("★★★ đếm đúng số khối DƯỚI ngưỡng", () => {
    expect(demDichQuaNho([hop(1, 4), hop(2, 10), hop(3, 60)], null, 24)).toBe(2);
  });

  it("★★★ ĐÚNG 24 px là ĐẠT — chip nói quá cũng là khai sai, chỉ lệch chiều", () => {
    expect(demDichQuaNho([hop(1, 24)], null, 24)).toBe(0);
    expect(demDichQuaNho([hop(1, 23.9)], null, 24)).toBe(1);
  });

  it("★★★ CẠNH NHỎ, không phải diện tích: 4×200 px vẫn là đích không bấm được", () => {
    // Một hộp dài mà mỏng có diện tích lớn nhưng không ai bấm trúng nó.
    expect(demDichQuaNho([{ machineId: 1, hop: { trai: 0, phai: 200, tren: 0, duoi: 4 } }], null, 24)).toBe(1);
  });

  it("★★★ BỎ QUA khối ĐANG CHỌN — nó là tiêu điểm, không phải đích để đổi sang", () => {
    expect(demDichQuaNho([hop(7, 4), hop(8, 4)], 7, 24)).toBe(1);
    expect(demDichQuaNho([hop(7, 4)], 7, 24)).toBe(0);
  });

  it("★★★ ngưỡng RÁC ⇒ 0 — và ca phân biệt là `Infinity`, KHÔNG phải `NaN`", () => {
    /*
     * ⚠⚠ Bản đầu của ca này chỉ thử `NaN`, và đột biến **gỡ hẳn hàng rào** `Number.isFinite`
     *    vẫn XANH: với `NaN` thì `4 < NaN` đã là `false`, nên hàng rào **chưa bao giờ được
     *    chạm tới**. Một hàng rào mà không đột biến nào bắt được là một hàng rào chưa ai chứng
     *    minh là còn sống — đúng lớp "phòng thủ nhiều lớp che đột biến của chính nó".
     *
     * `Infinity` mới phân biệt: không hàng rào ⇒ `4 < Infinity` đúng ⇒ đếm HẾT và chip khai
     * "1 máy quá nhỏ" từ một ngưỡng rác. Có hàng rào ⇒ **0**, tức không khai gì cả.
     */
    expect(demDichQuaNho([hop(1, 4)], null, Number.NaN)).toBe(0);
    expect(demDichQuaNho([hop(1, 4), hop(2, 999)], null, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("★ tập rỗng ⇒ 0", () => {
    expect(demDichQuaNho([], null, 24)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ G5 — NĂM CHẶNG, VÀ TÔI ĐÃ ĐỨT HAI CHẶNG TRONG CHÍNH LƯỢT NÀY            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Lượt này đứt **hai** chặng, mỗi lần hỏng một kiểu khác và **không lần nào `tsc` đỏ**:
 *   ① điều kiện bọc ngoài của HÀNG chip chưa liệt kê chip mới ⇒ đếm ra 33 mà **DOM trống**;
 *   ② `hamRef` chưa mang hàm ⇒ chip hiện, `data-so=33` đúng, mà **chữ rỗng**.
 * Đó là lý do tệp này ghim **từng chặng một**, không ghim "có xuất hiện đâu đó trong tệp".
 */
const canh = docMaNguon(resolve(__dirname, "../van-hanh/CanhVanHanh.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const lop = docMaNguon(resolve(__dirname, "LopNhan.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const trang = docMaNguon(resolve(__dirname, "../../../../src/pages/TwinMay.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("★★★ G5 — năm chặng của `chuDichQuaNho`", () => {
  it("① `CanhVanHanhProps` khai prop", () => {
    expect(canh).toMatch(/chuDichQuaNho\?:\s*\(n: number\) => string;/);
  });

  it("② `PropsHam` liệt kê nó (thiếu ⇒ `hamRef` mất kiểu, rồi mất giá trị)", () => {
    expect(canh).toContain('| "chuDichQuaNho"');
  });

  it("★★★ ③ `hamRef` mang hàm — CẢ khởi tạo LẪN gán mỗi render", () => {
    // Đây là chặng đã đứt: chip hiện, `data-so` đúng, mà chữ RỖNG.
    expect(canh.split("chuDichQuaNho: props.chuDichQuaNho,").length - 1).toBe(2);
  });

  it("④ bàn đạp chuyền bản ỔN ĐỊNH xuống, giữ `undefined` là `undefined`", () => {
    expect(canh).toContain("chuDichQuaNho={coChuDichQuaNho ? chuDichQuaNhoOnDinh : undefined}");
  });

  it("⑤ `<LopNhan>` nhận cả chữ LẪN ngưỡng (ngưỡng truyền XUỐNG, `loi/` không đọc ngược)", () => {
    expect(canh).toContain("chuDichQuaNho={props.chuDichQuaNho}");
    expect(canh).toContain("nguongDichBamPx={NGUONG_CANH_NHO_PX}");
  });

  it("★★★ ⑥ HÀNG chip phải liệt kê chip mới — nếu không: đếm đúng mà DOM TRỐNG", () => {
    // Chặng đứt thứ hai của lượt này. Một chip dựng xong, đếm xong, và không bao giờ render.
    expect(lop).toContain("(chuDichQuaNho && soDichQuaNho > 0) ||");
  });

  it("★★★ ⑦ guard `return null` tính cả chip mới (lớp nhãn rỗng vẫn phải hiện chip)", () => {
    expect(lop).toMatch(/soDichQuaNho === 0/);
  });

  it("★★★ ⑧ trang Máy cấp chữ qua `t()` — cảnh KHÔNG gọi i18n (RB-8.3)", () => {
    expect(trang).toContain("chuDichQuaNho=");
    expect(trang).toContain("twin3d.may.dichQuaNho");
    expect(canh).not.toContain("twin3d.may.dichQuaNho");
  });
});

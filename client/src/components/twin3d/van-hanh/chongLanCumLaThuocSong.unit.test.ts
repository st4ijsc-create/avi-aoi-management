/**
 * chongLanCumLaThuocSong.unit.test.ts — `demCapChongNhau` PHẢI ĐƯỢC GỌI Ở ĐƯỜNG SẢN PHẨM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MÃ CHẾT CÓ LƯỚI VẪN LÀ MÃ CHẾT
 * ════════════════════════════════════════════════════════════════════════════
 * `demCapChongNhau` có từ lượt dựng bậc cụm và có lưới đơn vị riêng — nhưng **chưa ai gọi nó ở
 * đường sản phẩm**. Hậu quả: con số nghiệm thu *"6/6 đơn vị vẽ đạt 24×24 px"* đứng cạnh một câu
 * hỏi mà **không ai trả lời được từ bên ngoài** — *biểu tượng có đè nhau không?* Một lưới xanh
 * cho một hàm không ai gọi chứng minh đúng một điều: hàm ấy đúng khi được gọi.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ HAI THƯỚC, HAI CÂU HỎI — VÀ TÔI SUÝT KHAI CHÚNG LÀ MỘT
 * ════════════════════════════════════════════════════════════════════════════
 * Nối xong rồi đo sống mới thấy con số này ra **0** ở cả hai khung, trong khi phép đo ngoài
 * trang đếm **3/15 cặp @1280×720**. Cả hai đều đúng, vì chúng đo hai thứ khác nhau:
 *
 * | thước | hỏi gì | 1280×720 | 1600×900 | 1920×1080 |
 * |---|---|---|---|---|
 * | `demCapChongNhau` (MẶT BẰNG) | hai cụm có giẫm lên nhau **trên sàn**? | **0** | — | **0** |
 * | hộp bao 2D của khối ĐÃ VẼ | hai biểu tượng có đè nhau **trên màn**? | **3/15** (6,1 %) | 2/15 (1,1 %) | **0** |
 *
 * Mặt bằng sạch (`dungCumTram` không đặt hai cụm đè nhau); cái đè trên màn đến từ **chiều cao
 * khối + phối cảnh**, và ở 1920×1080 nó tự hết. Gọi cả hai là *"chồng lấn"* là đúng lớp lỗi
 * *"phép đo tự sinh ra kết cục"* mà vòng này đã dính bốn lần — nên trường khai rõ **`MatBang`**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ KẾT CỤC NGƯỜI DÙNG — MỘT SỐ **ÂM TÍNH**, GHI LẠI ĐỂ KHỎI ĐO LẠI
 * ════════════════════════════════════════════════════════════════════════════
 * Bấm TÂM từng cụm ⇒ **6/6 mở đúng 6 line riêng** (511…516) ở **cả hai** khung.
 * ⇒ Dù đếm theo thước nào, chồng lấn cũng **không làm hỏng kết cục**. Nên bố cục **KHÔNG** bị
 *   giãn ra: sửa một con số trung gian trong khi kết cục vốn đã đúng là mua một hồi quy mà
 *   không ai trả tiền. Thứ đổi là ta **đo được** nó từ nay, không phải ta vá nó.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

import { demCapChongNhau, type CumTram } from "./cumTram";
import { docMaNguon } from "@shared/testing/docMaNguon";

const MA = docMaNguon(resolve(__dirname, "CanhVanHanh.tsx"))
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

function cum(x: number, z: number, rong = 2, sau = 2): CumTram {
  return {
    lineId: 1,
    soMay: 1,
    soBatThuong: 0,
    viTri: { x, y: 0, z },
    rongM: rong,
    caoM: 2,
    sauM: sau,
    thatRongM: rong,
    thatSauM: sau,
    machineIds: [1],
  };
}

describe("★★★ `demCapChongNhau` được gọi ở ĐƯỜNG SẢN PHẨM, không chỉ trong lưới", () => {
  it("★★★ `CanhVanHanh` gọi nó và công bố qua cửa sổ đo, TÊN khai rõ nó đo MẶT BẰNG", () => {
    expect(MA).toContain("demCapChongNhau(");
    expect(MA).toContain("capCumChongNhauMatBang");
  });

  it("★★★ nó đọc CHÍNH tập cụm đang vẽ (`cumVe`), không một tập dựng lại", () => {
    // Dựng lại một tập thứ hai để đo là đo một cảnh KHÁC cảnh đang hiện — đúng lớp lỗi
    // "phép đo tự sinh ra kết cục" mà vòng này đã dính bốn lần.
    expect(MA).toMatch(/capCumChongNhauMatBang:\s*cumVe\s*\?\s*demCapChongNhau\(\[\.\.\.cumVe\.theoId\.values\(\)\]\)/);
  });

  it("★★★ nó là THƯỚC, không phải hàng rào — nằm trong khối `laCheDoDo()`", () => {
    const iGac = MA.indexOf("laCheDoDo()");
    const iDem = MA.indexOf("capCumChongNhauMatBang");
    expect(iGac).toBeGreaterThan(-1);
    expect(iDem).toBeGreaterThan(iGac);
  });
});

describe("demCapChongNhau — hợp đồng", () => {
  it("★★★ hai cụm RỜI NHAU ⇒ 0; KỀ SÁT (chạm mép) cũng ⇒ 0", () => {
    expect(demCapChongNhau([cum(0, 0), cum(10, 0)])).toBe(0);
    // Khoảng cách đúng bằng nửa tổng bề rộng ⇒ chạm mép, chưa đè.
    expect(demCapChongNhau([cum(0, 0), cum(2, 0)])).toBe(0);
  });

  it("★★★ CA NGHỊCH — đè nhau THẬT ⇒ đếm đúng số CẶP, không phải số cụm", () => {
    expect(demCapChongNhau([cum(0, 0), cum(1, 0)])).toBe(1);
    // Ba cụm cùng chỗ ⇒ 3 cặp (không phải 3 cụm).
    expect(demCapChongNhau([cum(0, 0), cum(0.5, 0), cum(1, 0)])).toBe(3);
  });

  it("★★★ chồng MỘT trục thôi thì KHÔNG tính là đè", () => {
    // Trùng x nhưng cách xa theo z: hai hộp rời nhau.
    expect(demCapChongNhau([cum(0, 0), cum(0, 10)])).toBe(0);
  });

  it("★ 0 hoặc 1 cụm ⇒ 0 cặp, không ném", () => {
    expect(demCapChongNhau([])).toBe(0);
    expect(demCapChongNhau([cum(0, 0)])).toBe(0);
  });
});

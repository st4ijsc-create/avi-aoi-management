/**
 * ★★★ ĐỢT G / TASK G3 / B1 — LƯỚI CHO VỊ TỪ THUẦN CỦA BA MỨC QUYỀN.
 *
 * Tệp này CHỈ đo logic THUẦN (`loi/mucQuyen.ts`) — không `vscode`, không đĩa, không webview. Hai
 * lớp đo THẬT của B2 (chặn tại điểm ghi, đĩa không đổi byte nào) và B3 (từng hàng rào ở `tu_ghi`,
 * đo trên đĩa thật) nằm ở `ui/apBanVa.mucQuyen.unit.test.ts` — cố ý KHÔNG lặp lại ở đây, vì một
 * lưới THUẦN không thể chứng minh được "đĩa có đổi byte nào không".
 */
import { describe, it, expect } from "vitest";
import {
  MUC_QUYEN_MAC_DINH,
  laMucQuyenHopLe,
  chuanHoaMucQuyen,
  duocPhepGhiTheoMucQuyen,
  boQuaBuocHoi,
  KHOA_MUC_QUYEN,
  NHAN_MUC_QUYEN,
  type MucQuyen,
} from "./mucQuyen";

describe("laMucQuyenHopLe", () => {
  it("★★★ BA giá trị hợp lệ ⇒ true", () => {
    expect(laMucQuyenHopLe("chi_doc")).toBe(true);
    expect(laMucQuyenHopLe("hoi_truoc_khi_ghi")).toBe(true);
    expect(laMucQuyenHopLe("tu_ghi")).toBe(true);
  });

  it("★★★ mọi hình dạng KHÁC ⇒ false — không đoán một giá trị lạ thành một mức", () => {
    expect(laMucQuyenHopLe(undefined)).toBe(false);
    expect(laMucQuyenHopLe(null)).toBe(false);
    expect(laMucQuyenHopLe("")).toBe(false);
    expect(laMucQuyenHopLe("TU_GHI")).toBe(false); // hoa/thường khác nhau, không tự chuẩn hoá
    expect(laMucQuyenHopLe("tu ghi")).toBe(false); // dấu cách thay vì gạch dưới
    expect(laMucQuyenHopLe(123)).toBe(false);
    expect(laMucQuyenHopLe({})).toBe(false);
    expect(laMucQuyenHopLe([])).toBe(false);
    expect(laMucQuyenHopLe(true)).toBe(false);
  });
});

describe("chuanHoaMucQuyen — ★★★ B4: kho rỗng/hỏng PHẢI rơi về MẶC ĐỊNH AN TOÀN, KHÔNG BAO GIỜ 'tu_ghi'", () => {
  it("★★★ ba giá trị hợp lệ ⇒ giữ NGUYÊN, không bị ép về mặc định", () => {
    expect(chuanHoaMucQuyen("chi_doc")).toBe("chi_doc");
    expect(chuanHoaMucQuyen("hoi_truoc_khi_ghi")).toBe("hoi_truoc_khi_ghi");
    expect(chuanHoaMucQuyen("tu_ghi")).toBe("tu_ghi");
  });

  it("★★★ LƯỚI BẮT BUỘC — kho RỖNG (`undefined`, chưa từng lưu) ⇒ MUC_QUYEN_MAC_DINH ('hoi_truoc_khi_ghi')", () => {
    const kq = chuanHoaMucQuyen(undefined);
    expect(kq).toBe(MUC_QUYEN_MAC_DINH);
    expect(kq).toBe("hoi_truoc_khi_ghi");
    expect(kq).not.toBe("tu_ghi"); // khẳng định TƯỜNG MINH — không rơi về mức mạnh nhất
  });

  it("★★★ LƯỚI BẮT BUỘC — kho HỎNG (sai kiểu: null/số/chuỗi lạ/object/mảng) ⇒ CŨNG rơi về mặc định, KHÔNG rơi về 'tu_ghi'", () => {
    const dauVaoHong: unknown[] = [null, 123, "", "tu_ghi_lon", { mucQuyen: "tu_ghi" }, ["tu_ghi"], false];
    for (const gt of dauVaoHong) {
      const kq = chuanHoaMucQuyen(gt);
      expect(kq, `đầu vào hỏng ${JSON.stringify(gt)} phải rơi về mặc định`).toBe(MUC_QUYEN_MAC_DINH);
      expect(kq).not.toBe("tu_ghi");
    }
  });
});

describe("duocPhepGhiTheoMucQuyen — ★★★ B2: HÀNG RÀO THẬT (gọi bên trong apBanVa)", () => {
  it("★★★ 'chi_doc' ⇒ ok:false, lý do nhắc rõ 'Chỉ đọc' và 'ĐIỂM GHI' (không phải chỉ nói 'nút')", () => {
    const kq = duocPhepGhiTheoMucQuyen("chi_doc");
    expect(kq.ok).toBe(false);
    expect(kq.ok === false && kq.lyDo).toContain("Chỉ đọc");
    expect(kq.ok === false && kq.lyDo).toContain("ĐIỂM GHI");
  });

  it("★★ 'hoi_truoc_khi_ghi' ⇒ ok:true (mặc định — đúng hành vi hôm nay, không bị chặn)", () => {
    expect(duocPhepGhiTheoMucQuyen("hoi_truoc_khi_ghi")).toEqual({ ok: true });
  });

  it("★★ 'tu_ghi' ⇒ ok:true (tự trị KHÔNG có nghĩa 'chỉ đọc' — nó vẫn được PHÉP ghi, chỉ khác ở bước hỏi)", () => {
    expect(duocPhepGhiTheoMucQuyen("tu_ghi")).toEqual({ ok: true });
  });
});

describe("boQuaBuocHoi — ★★★ B3: CHỈ quyết định bỏ bước HỎI, không liên quan hàng rào", () => {
  it("★★★ 'tu_ghi' ⇒ true", () => {
    expect(boQuaBuocHoi("tu_ghi")).toBe(true);
  });

  it("★★★ NHÁNH KIA — hai mức còn lại ⇒ false (vẫn phải hỏi/hiện thẻ)", () => {
    expect(boQuaBuocHoi("hoi_truoc_khi_ghi")).toBe(false);
    expect(boQuaBuocHoi("chi_doc")).toBe(false);
  });
});

describe("hằng số dùng chung", () => {
  it("★ KHOA_MUC_QUYEN là một chuỗi khoá ổn định (đổi giá trị này làm MẤT mức đã lưu của mọi workspace cũ)", () => {
    expect(KHOA_MUC_QUYEN).toBe("aviAiLocal.mucQuyen");
  });

  it("★ NHAN_MUC_QUYEN có ĐỦ VÀ ĐÚNG ba nhãn, không thiếu không thừa", () => {
    const mucList: MucQuyen[] = ["chi_doc", "hoi_truoc_khi_ghi", "tu_ghi"];
    for (const m of mucList) {
      expect(typeof NHAN_MUC_QUYEN[m]).toBe("string");
      expect(NHAN_MUC_QUYEN[m].length).toBeGreaterThan(0);
    }
    expect(Object.keys(NHAN_MUC_QUYEN).sort()).toEqual(mucList.slice().sort());
  });
});

import { describe, it, expect } from "vitest";
import fs from "node:fs";
// @ts-expect-error — module .mjs thuần, không có khai báo kiểu
import { phanLoaiTraLoi, chamMot } from "./_phan-loai-tra-loi.mjs";

// Mở đầu THẬT lấy từ báo cáo đầu–cuối đã lưu (docs/superpowers/reports/pdca-kb-dau-cuoi-2026-09-24/), không bịa.
const MEM = {
  N31: "(1) Tóm tắt Tài liệu hiện tại không mô tả cơ chế MES gửi lệnh sản xuất (command) xuống máy AOI. Thay vào đó, tài liệu chỉ rõ máy AOI tự động gửi kết quả (data) lên MES qua API sau mỗi bảng.",
  N21: "(1) Tóm tắt Tài liệu hiện tại không liệt kê danh sách cụ thể các sản phẩm bắt buộc phải kiểm tra X-ray mối hàn BGA. Thông tin này thường được xác định dựa trên quy định chất lượng nội bộ.",
  T42: "(1) Không có thông tin về việc sửa pad bị bong tróc tại chỗ trong quy trình xử lý sản phẩm NG. (2) Trong tài liệu hiện có, chỉ có hướng dẫn xử lý lỗi ở các phần như danh mục lỗi.",
  T46: "(1) Lỗi E050 không được liệt kê trong tài liệu hướng dẫn xử lý sự cố AOI. Không có thông tin cụ thể về mã lỗi này trong các phần từ [1] đến [5].",
  TQ02: "(1) Tóm tắt **Tài liệu hiện tại** không cung cấp thông tin về chu kỳ tự làm mới (auto-refresh) cụ thể của biểu đồ kiểm soát SPC.",
};
// Câu trả lời THẬT có một vế "không có" — KHÔNG được thành từ chối (census 2026-09-24).
const THAT = {
  S07: "(1) Tóm tắt: Theo dữ liệu hệ thống, hiện có 129 máy báo lỗi và 1699 máy offline. Tuy nhiên, tài liệu kỹ thuật không liệt kê chi tiết mã lỗi cụ thể cho từng máy.",
  S09: "Dựa trên tài liệu cung cấp, không có một con số cố định duy nhất cho \"tỷ lệ NG ca\" vì nó phụ thuộc vào mục tiêu chất lượng (KPI).",
  TL03: "(1) Tỷ lệ NG (Not Good) được tính theo công thức ngRate = ngCount / inspectedCount × 100% và cập nhật mỗi 60 giây [3]. Hệ thống hiện tại không có dữ liệu thực tế.",
  S05: "1. Tổng số mục được liệt kê: 0 2. Danh sách đầy đủ: - Không có dữ liệu OEE cho máy \"line1\" trong kỳ này.",
  GS03: "(1) Tỷ lệ rework tháng này là 0%, không có dữ liệu về số lượng bảng kiểm tra hoặc lỗi cần xử lý.",
  // (câu DỰNG — chủ ngữ là DỮ LIỆU sống, động từ "ghi": khoá riêng luật "chủ ngữ phải là TÀI LIỆU")
  DUNG_DU_LIEU: "(1) Dữ liệu hiện tại không ghi nhận lỗi NG nào trên line 2 trong 7 ngày qua. (2) Có thể xem chi tiết ở Pareto.",
  N22: "(1) IPC-A-610 Class 3 có yêu cầu nghiêm ngặt hơn về mối hàn so với Class 2, đặc biệt trong các tiêu chí như độ đầy đủ.",
};

describe("phanLoaiTraLoi — hình dạng câu trả lời", () => {
  it("★ câu từ chối CHUẨN ở bất kỳ đâu", () => {
    expect(phanLoaiTraLoi("Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.")).toBe("tu-choi");
  });
  it("★★★ câu ĐẦU nói tài liệu không có ⇒ tu-choi-mem (N21 N31 T42 T46 TQ02)", () => {
    for (const [id, t] of Object.entries(MEM)) expect(phanLoaiTraLoi(t), id).toBe("tu-choi-mem");
  });
  it("★★★ câu trả lời THẬT có vế 'không có' ở giữa / chủ ngữ là DỮ LIỆU sống ⇒ null", () => {
    for (const [id, t] of Object.entries(THAT)) expect(phanLoaiTraLoi(t), id).toBeNull();
  });
  it("★ câu hỏi lại ngắn ⇒ hoi-lai; câu trả lời dài mở bằng 'Bạn muốn…?' thì không", () => {
    expect(phanLoaiTraLoi("Bạn muốn xem trạng thái máy nào hoặc toàn bộ máy đang offline? Hãy nêu rõ tên máy/line.")).toBe("hoi-lai");
    expect(phanLoaiTraLoi("Bạn muốn xem OEE? " + "Theo tài liệu, OEE = Availability × Performance × Quality. ".repeat(10))).toBeNull();
  });
});

describe("chamMot — đáp án đúng thắng hình dạng", () => {
  const cau = { id: "T1", cauHoi: "?", nguon: ["a.md"], dapAnTraLoi: { regex: "2 lần" } };
  it("★ câu trong corpus: khớp đáp án ⇒ dung, dù mở đầu bằng lời từ chối (T16 T18 T43)", () => {
    expect(chamMot(cau, "Tôi không có thông tin chính xác… Tuy nhiên tài liệu ghi sau **2 lần** rework thì loại.")).toBe("dung");
  });
  it("★ câu trong corpus không khớp: hình dạng, còn lại sai", () => {
    expect(chamMot(cau, MEM.N31)).toBe("tu-choi-mem");
    expect(chamMot(cau, THAT.N22)).toBe("sai");
  });
  it("★ câu ngoài corpus: trả lời thật ⇒ tra-loi", () => {
    expect(chamMot({ id: "N", cauHoi: "?", nguon: [] }, THAT.N22)).toBe("tra-loi");
  });
});

describe("★★★ chấm lại lượt vòng 7 đã lưu — chỉ đổi đúng những câu đã soát tay", () => {
  const D = "docs/superpowers/reports/pdca-kb-dau-cuoi-2026-09-24/";
  const vang = Object.fromEntries(fs.readFileSync("knowledge/studio-golden/st4i-may-aoi.jsonl", "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).map((c) => [c.id, c]));
  it("v7b-st4i: N21 N31 tra-loi→tu-choi-mem; không câu 'dung' hay 'tu-choi' chuẩn nào đổi", () => {
    const r = JSON.parse(fs.readFileSync(D + "kb-dau-cuoi-v7b-st4i.json", "utf8"));
    const doi = r.ra.map((x: { id: string; kq: string; traLoi: string }) => ({ id: x.id, cu: x.kq, moi: chamMot(vang[x.id], x.traLoi) })).filter((x: { cu: string; moi: string }) => x.cu !== x.moi);
    expect(doi.filter((x: { cu: string }) => x.cu === "dung" || x.cu === "tu-choi")).toEqual([]);
    expect(doi.map((x: { id: string; moi: string }) => `${x.id}:${x.moi}`).sort()).toEqual(["N21:tu-choi-mem", "N31:tu-choi-mem"]);
  });
});

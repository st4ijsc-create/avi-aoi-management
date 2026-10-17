/**
 * Đợt 5.1 — lưới cho phần THUẦN của phản hồi agent (`shared/phanHoiAgent.ts`): khối trả lời, diff hợp nhất, mẫu bộ dữ liệu.
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "./agentCore/kieu";
import {
  apDiffHopNhat,
  diffHopNhat,
  khoiTraLoiTuSuKien,
  mauBoDuLieuTuHang,
  traLoiCuoiTuSuKien,
  TRAN_DONG_DIFF,
  TRAN_KY_TU_CAU_HOI_CLIENT,
  TRAN_KY_TU_TRA_LOI_CLIENT,
  TRAN_KY_TU_LY_DO,
} from "./phanHoiAgent";

describe("khoiTraLoiTuSuKien — khối trả lời theo ĐÚNG luật gộp của dòng thời gian client", () => {
  it("gộp `chu` liền nhau; sự kiện KHÔNG lên dòng thời gian (usage, ke-hoach, dang-cho-model, checkpoint) không cắt khối", () => {
    const es: SuKienAgent[] = [
      { loai: "bat-dau", runId: "r", cheDo: "sua" },
      { loai: "chu", noiDung: "Xin " },
      { loai: "usage", vao: 1, ra: 1 },
      { loai: "chu", noiDung: "chào" },
      { loai: "ke-hoach", viec: [] },
      { loai: "dang-cho-model", phiaTruoc: 0 },
      { loai: "chu", noiDung: "!" },
    ];
    expect(khoiTraLoiTuSuKien(es)).toEqual(["Xin chào!"]);
  });

  it("nghi / goi-tool / can-duyet / de-xuat-nho / loi CẮT khối", () => {
    const es: SuKienAgent[] = [
      { loai: "chu", noiDung: "A" },
      { loai: "nghi", noiDung: "..." },
      { loai: "chu", noiDung: "B" },
      { loai: "goi-tool", goi: { id: "1", ten: "read_file", thamSo: {} }, luot: 1 },
      { loai: "chu", noiDung: "C" },
      { loai: "can-duyet", id: "2", deXuat: { ten: "edit_file", thamSo: {}, moTa: "" } },
      { loai: "chu", noiDung: "D" },
      { loai: "de-xuat-nho", id: "n1", note: "x", scope: "project" },
      { loai: "chu", noiDung: "E" },
      { loai: "loi", ma: "X", thongDiep: "y" },
      { loai: "chu", noiDung: "F" },
    ];
    expect(khoiTraLoiTuSuKien(es)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("nhận cả dạng SỔ (`{seq, suKien}`) của `ai_agent_runs.suKien`; mục méo bị bỏ qua", () => {
    const so = [{ seq: 1, suKien: { loai: "chu", noiDung: "x" } }, null, 7, { seq: 2, suKien: { loai: "chu", noiDung: "y" } }];
    expect(khoiTraLoiTuSuKien(so as never)).toEqual(["xy"]);
  });
});

describe("diffHopNhat — unified diff một khối (cắt đầu/đuôi chung) + áp lại được", () => {
  it("không đổi ⇒ chuỗi rỗng", () => {
    expect(diffHopNhat("a.ts", "x\ny\n", "x\ny\n")).toBe("");
  });

  it("sửa một dòng giữa tệp ⇒ tiêu đề + @@ đúng số dòng + 3 dòng ngữ cảnh", () => {
    const truoc = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n") + "\n";
    const sau = truoc.replace("5\n", "NAM\n");
    const d = diffHopNhat("src/a.ts", truoc, sau)!;
    expect(d).toBe(["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -2,7 +2,7 @@", " 2", " 3", " 4", "-5", "+NAM", " 6", " 7", " 8", ""].join("\n"));
    expect(apDiffHopNhat(truoc, d)).toBe(sau);
  });

  it("tệp MỚI (trước rỗng) ⇒ /dev/null + toàn bộ dòng thêm", () => {
    const d = diffHopNhat("moi.py", "", "print(1)\nprint(2)\n")!;
    expect(d.split("\n").slice(0, 3)).toEqual(["--- /dev/null", "+++ b/moi.py", "@@ -0,0 +1,2 @@"]);
    expect(apDiffHopNhat("", d)).toBe("print(1)\nprint(2)\n");
  });

  it("CRLF được giữ nguyên khi áp lại (không đổi kiểu xuống dòng của tệp)", () => {
    const truoc = "a\r\nb\r\nc\r\n";
    const sau = "a\r\nB\r\nc\r\n";
    expect(apDiffHopNhat(truoc, diffHopNhat("x.cs", truoc, sau)!)).toBe(sau);
  });

  it(`quá ${TRAN_DONG_DIFF} dòng thay đổi ⇒ null (không xuất một diff cụt như thể trọn vẹn)`, () => {
    const lon = Array.from({ length: TRAN_DONG_DIFF + 10 }, (_, i) => `d${i}`).join("\n");
    expect(diffHopNhat("lon.txt", "", lon)).toBeNull();
  });
});

describe("mauBoDuLieuTuHang — chỉ cặp (chỉ dẫn → diff ĐƯỢC DUYỆT), đã che, không tệp cấm", () => {
  const coBan = {
    loai: "diff",
    quyetDinh: "duyet",
    danhGia: null,
    cauHoi: "Thêm hàm cộng",
    noiDung: "--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+x\n",
    duongDan: "a.ts",
    projectId: "repo",
    runId: "11111111-1111-1111-1111-111111111111",
    actionId: "act-1",
    lyDo: null,
  };
  const duongOk = () => true;
  const khongChe = (s: string) => s;

  it("hàng duyệt hợp lệ ⇒ mẫu {chiDan, duong, diff, …}", () => {
    expect(mauBoDuLieuTuHang(coBan, { duongDuocPhep: duongOk, che: khongChe })).toEqual({
      chiDan: "Thêm hàm cộng",
      duong: "a.ts",
      diff: coBan.noiDung,
      duAn: "repo",
      danhGia: null,
      runId: coBan.runId,
      actionId: "act-1",
      nguon: "web",
    });
  });

  it("(Đợt 5.1 VSCode) mẫu ghi rõ NGUỒN; hàng nguồn khác `web` (văn bản client tự khai) KHÔNG vào bộ dữ liệu diff", () => {
    const o = { duongDuocPhep: duongOk, che: khongChe };
    expect(mauBoDuLieuTuHang({ ...coBan, nguon: "web" }, o)?.nguon).toBe("web");
    expect(mauBoDuLieuTuHang({ ...coBan, nguon: "vscode" }, o)).toBeNull();
  });

  it("bị bác / 👎 / không chỉ dẫn / không diff / không phải diff ⇒ null", () => {
    const o = { duongDuocPhep: duongOk, che: khongChe };
    expect(mauBoDuLieuTuHang({ ...coBan, quyetDinh: "bac" }, o)).toBeNull();
    expect(mauBoDuLieuTuHang({ ...coBan, quyetDinh: null, danhGia: 1 }, o)).toBeNull();
    expect(mauBoDuLieuTuHang({ ...coBan, danhGia: -1 }, o)).toBeNull();
    expect(mauBoDuLieuTuHang({ ...coBan, cauHoi: "  " }, o)).toBeNull();
    expect(mauBoDuLieuTuHang({ ...coBan, noiDung: null }, o)).toBeNull();
    expect(mauBoDuLieuTuHang({ ...coBan, loai: "tra-loi" }, o)).toBeNull();
  });

  it("đường bị chính sách hộp cát từ chối (vd .env) ⇒ null — DÙ diff đã được duyệt", () => {
    expect(mauBoDuLieuTuHang({ ...coBan, duongDan: ".env.local" }, { duongDuocPhep: (d) => !d.startsWith(".env"), che: khongChe })).toBeNull();
  });

  it("che bí mật chạy LẦN NỮA lúc xuất trên chỉ dẫn + diff (phòng hàng ghi trước khi có lớp che)", () => {
    const che = (s: string) => s.replace(/sk-[a-z0-9]+/g, "[REDACTED]");
    const m = mauBoDuLieuTuHang({ ...coBan, cauHoi: "dùng sk-abc123", noiDung: coBan.noiDung + "+k=sk-zzz9\n" }, { duongDuocPhep: duongOk, che });
    expect(m?.chiDan).toBe("dùng [REDACTED]");
    expect(m?.diff).toContain("+k=[REDACTED]");
    expect(JSON.stringify(m)).not.toMatch(/sk-/);
  });
});

describe("(Đợt 5.1 VSCode) traLoiCuoiTuSuKien + trần độ dài dùng chung extension ⇄ máy chủ", () => {
  it("khối CUỐI theo đúng luật gộp của khoiTraLoiTuSuKien; chỉ số = số khối − 1; không chữ ⇒ null", () => {
    const es: SuKienAgent[] = [
      { loai: "chu", noiDung: "Đọc " },
      { loai: "chu", noiDung: "mã." },
      { loai: "goi-tool", goi: { id: "g", ten: "read_file", thamSo: {} }, luot: 1 },
      { loai: "chu", noiDung: "Xong: " },
      { loai: "usage", vao: 1, ra: 1 },
      { loai: "chu", noiDung: "đã sửa." },
    ];
    expect(traLoiCuoiTuSuKien(es)).toEqual({ chiSoKhoi: 1, vanBan: "Xong: đã sửa." });
    expect(traLoiCuoiTuSuKien([{ loai: "goi-tool", goi: { id: "g", ten: "x", thamSo: {} }, luot: 1 }])).toBeNull();
    expect(traLoiCuoiTuSuKien([{ loai: "chu", noiDung: "   " }])).toBeNull();
  });
  it("trần: câu hỏi ≤ câu trả lời ≤ trần nội dung sổ; lý do 2000 (cột varchar(2000))", () => {
    expect(TRAN_KY_TU_CAU_HOI_CLIENT).toBeGreaterThan(0);
    expect(TRAN_KY_TU_CAU_HOI_CLIENT).toBeLessThanOrEqual(TRAN_KY_TU_TRA_LOI_CLIENT);
    expect(TRAN_KY_TU_TRA_LOI_CLIENT).toBeLessThanOrEqual(200_000);
    expect(TRAN_KY_TU_LY_DO).toBe(2000);
  });
});

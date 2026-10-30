/**
 * Đợt 5.1 — LƯỚI CHÉO: khối `chu` thứ i trên dòng thời gian CLIENT (`giamNhieu`) PHẢI là khối thứ i máy chủ lấy ra bằng
 * `khoiTraLoiTuSuKien` (shared). Lệch ⇒ người chấm câu này mà sổ ghi câu khác. Chuỗi sự kiện phủ MỌI loại `SuKienAgent`.
 * Thêm một loại sự kiện mới mà quên một bên ⇒ lưới này đỏ (ca ngẫu nhiên có mọi loại).
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { LOAI_CAT_KHOI_TRA_LOI, khoiTraLoiTuSuKien } from "@shared/phanHoiAgent";
import { chuanHoaKetQuaPhanHoi, chuanHoaPhanHoiCuaToi, phieuTraLoiCuaToi } from "@/lib/agentApi";
import { TRANG_THAI_RONG, batDauGui, giamNhieu, viTriTraLoiCuoi } from "./trangThaiAgent";

/**
 * MỘT mẫu cho MỖI loại sự kiện — kiểu `Record` ép đầy đủ lúc biên dịch: thêm loại mới vào `SuKienAgent` mà quên mẫu ⇒ tsc đỏ.
 * (Trước 2026-10-31 danh sách viết tay bỏ sót canh-bao-du-lieu / ha-tu-tri / con-bat-dau — đúng ba loại làm hai bên lệch khối.)
 */
const MAU: Record<SuKienAgent["loai"], SuKienAgent> = {
  "bat-dau": { loai: "bat-dau", runId: "r", cheDo: "sua" },
  chu: { loai: "chu", noiDung: "a" },
  nghi: { loai: "nghi", noiDung: "n" },
  "goi-tool": { loai: "goi-tool", goi: { id: "g1", ten: "read_file", thamSo: {} }, luot: 1 },
  "ket-qua-tool": { loai: "ket-qua-tool", id: "g1", ten: "read_file", ok: true, tomTat: "ok" },
  "can-duyet": { loai: "can-duyet", id: "d1", deXuat: { ten: "edit_file", thamSo: {} } },
  "da-duyet": { loai: "da-duyet", id: "d1" },
  "bi-bac": { loai: "bi-bac", id: "d1", lyDo: "x" },
  "ke-hoach": { loai: "ke-hoach", viec: [] },
  "de-xuat-nho": { loai: "de-xuat-nho", id: "n1", note: "x", scope: "project" },
  "canh-bao-du-lieu": { loai: "canh-bao-du-lieu", id: "c1", ten: "read_file", nguon: "a.md", mau: ["ignore_instructions"] },
  "ha-tu-tri": { loai: "ha-tu-tri", lyDo: "noi-dung-dang-ngo", nguon: "a.md", mau: ["x"] },
  checkpoint: { loai: "checkpoint", checkpointId: "c", tep: [] },
  usage: { loai: "usage", vao: 1, ra: 1 },
  "buoc-do": { loai: "buoc-do", luot: 1, bamHeThong: "00000000", soTin: 2, tokenUoc: 1, nen: null, nhacDaChen: [] },
  "dang-cho-model": { loai: "dang-cho-model", phiaTruoc: 1 },
  "ngu-canh-day": { loai: "ngu-canh-day", phanTram: 81 },
  "ke-hoach-cho-duyet": { loai: "ke-hoach-cho-duyet", viec: [], bam: "b" },
  "ke-hoach-da-duyet": { loai: "ke-hoach-da-duyet", bam: "b", luc: "2026-10-31T00:00:00Z" },
  "ke-hoach-khong-duyet": { loai: "ke-hoach-khong-duyet", bam: "b", lyDo: "bac" },
  "con-bat-dau": { loai: "con-bat-dau", runIdCon: "k1", agent: "a", nguon: "dungSan", sau: 1, cheDo: "hoi", nhiemVu: "n" },
  "con-xong": { loai: "con-xong", runIdCon: "k1", lyDo: "hoan-thanh" },
  "su-kien-con": { loai: "su-kien-con", runIdCon: "k1", suKien: { loai: "chu", noiDung: "con" } },
  xong: { loai: "xong", lyDo: "hoan-thanh" },
  loi: { loai: "loi", ma: "E", thongDiep: "e" },
};
const MOI_LOAI: SuKienAgent[] = Object.values(MAU);
/**
 * Loại mà máy chủ ĐÃ cắt khối nhưng reducer client CHƯA thêm mục (luong-ui đang làm thẻ "Kế hoạch chờ duyệt", cổng kế hoạch mặc định TẮT ⇒ chưa
 * có sự kiện thật). Hai lưới "chen giữa" bên dưới bỏ qua chúng cho tới khi client có mục; lưới census (một chiều) vẫn canh phần còn lại.
 * Khi luong-ui xong: XOÁ phần tử khỏi mảng này — test "mảng chờ không chứa loại client đã xử lý" sẽ đỏ nếu quên.
 */
const CHO_CLIENT: ReadonlyArray<SuKienAgent["loai"]> = ["ke-hoach-cho-duyet"];

function khoiClient(es: SuKienAgent[]): string[] {
  return giamNhieu(TRANG_THAI_RONG, es)
    .dongThoiGian.filter((m) => m.kieu === "chu")
    .map((m) => (m as { noiDung: string }).noiDung);
}

/** PRNG có hạt — chuỗi lặp lại được khi lưới đỏ. */
function prng(hat: number) {
  let x = hat >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("khối trả lời: client ⇄ máy chủ cùng luật gộp", () => {
  it("mỗi loại sự kiện chen giữa hai mảnh `chu`: hai bên cùng kết quả", () => {
    for (const e of MOI_LOAI) {
      if (e.loai === "chu" || CHO_CLIENT.includes(e.loai)) continue;
      const es: SuKienAgent[] = [{ loai: "chu", noiDung: "X" }, e, { loai: "chu", noiDung: "Y" }];
      expect(khoiTraLoiTuSuKien(es), `chen ${e.loai}`).toEqual(khoiClient(es));
    }
  });

  it("300 chuỗi ngẫu nhiên (hạt cố định) trên mọi loại: hai bên trùng từng khối", () => {
    const r = prng(51);
    for (let lan = 0; lan < 300; lan++) {
      const es: SuKienAgent[] = [];
      const n = 1 + Math.floor(r() * 25);
      for (let i = 0; i < n; i++) {
        const mau = MOI_LOAI[Math.floor(r() * MOI_LOAI.length)]!;
        if (CHO_CLIENT.includes(mau.loai)) continue;
        // id đề xuất nhớ phải MỚI mỗi lần, như máy chủ phát — client bỏ qua id trùng (không lên dòng thời gian).
        es.push(mau.loai === "chu" ? { loai: "chu", noiDung: String(i) } : mau.loai === "de-xuat-nho" ? { ...mau, id: `n${i}` } : mau);
      }
      expect(khoiTraLoiTuSuKien(es)).toEqual(khoiClient(es));
    }
  });
});

describe("★★★ census: loại nào làm reducer client THÊM mục dòng thời gian (ngoài chu) thì máy chủ PHẢI cắt khối", () => {
  const themMuc = (e: SuKienAgent): boolean => {
    const truoc = giamNhieu(TRANG_THAI_RONG, [{ loai: "chu", noiDung: "X" }]);
    const sau = giamNhieu(truoc, [e]);
    return sau.dongThoiGian.length > truoc.dongThoiGian.length;
  };
  it("client thêm mục ⇒ có trong LOAI_CAT_KHOI_TRA_LOI (suy từ MỘT hằng chung, không danh sách viết tay)", () => {
    for (const e of MOI_LOAI) {
      if (e.loai === "chu" || !themMuc(e)) continue;
      expect(LOAI_CAT_KHOI_TRA_LOI.has(e.loai), `client thêm mục cho '${e.loai}' nhưng máy chủ không cắt khối`).toBe(true);
    }
  });
  it("chiều ngược: loại máy chủ cắt mà client không thêm mục chỉ được nằm trong CHO_CLIENT (luong-ui sẽ làm)", () => {
    for (const loai of LOAI_CAT_KHOI_TRA_LOI) {
      if (themMuc(MAU[loai])) continue;
      expect(CHO_CLIENT, `máy chủ cắt '${loai}' mà client không thêm mục`).toContain(loai);
    }
  });
  it("mảng chờ không chứa loại client đã xử lý (quên xoá ⇒ đỏ)", () => {
    for (const loai of CHO_CLIENT) expect(themMuc(MAU[loai]), `'${loai}' đã có mục ở client — xoá khỏi CHO_CLIENT`).toBe(false);
  });
  it("mọi loại trong hằng chung là loại sự kiện có thật", () => {
    for (const loai of LOAI_CAT_KHOI_TRA_LOI) expect(Object.keys(MAU)).toContain(loai);
  });
});

describe("chuanHoaKetQuaPhanHoi", () => {
  it("ok ⇒ danhGia của PHIẾU máy chủ; từ chối ⇒ mã; rác ⇒ LOI", () => {
    expect(chuanHoaKetQuaPhanHoi({ ok: true, note: null, phieu: { danhGia: -1 } })).toEqual({ ok: true, ma: null, danhGia: -1 });
    expect(chuanHoaKetQuaPhanHoi({ ok: true, note: null, phieu: null })).toEqual({ ok: true, ma: null, danhGia: null });
    expect(chuanHoaKetQuaPhanHoi({ ok: false, note: "NOT_FOUND", phieu: null })).toEqual({ ok: false, ma: "NOT_FOUND", danhGia: null });
    expect(chuanHoaKetQuaPhanHoi("x")).toEqual({ ok: false, ma: "LOI", danhGia: null });
  });
});

describe("viTriTraLoiCuoi (chỗ gắn nút) ⇄ khối máy chủ", () => {
  it("300 lượt ngẫu nhiên ĐÃ XONG: chiSoTin = khối CUỐI máy chủ, cùng văn bản; không chữ ⇒ null", () => {
    const r = prng(77);
    for (let lan = 0; lan < 300; lan++) {
      const es: SuKienAgent[] = [{ loai: "bat-dau", runId: "r", cheDo: "sua" }];
      const n = Math.floor(r() * 20);
      for (let i = 0; i < n; i++) {
        const mau = MOI_LOAI[Math.floor(r() * MOI_LOAI.length)]!;
        if (mau.loai === "xong" || mau.loai === "bat-dau") continue;
        es.push(mau.loai === "chu" ? { loai: "chu", noiDung: String(i) } : mau.loai === "de-xuat-nho" ? { ...mau, id: `n${i}` } : mau);
      }
      es.push({ loai: "xong", lyDo: "hoan-thanh" });
      const s = giamNhieu(batDauGui("hỏi", "sua"), es);
      const khoi = khoiTraLoiTuSuKien(es);
      const v = viTriTraLoiCuoi(s);
      if (!khoi.length) {
        expect(v).toBeNull();
        continue;
      }
      expect(v).not.toBeNull();
      expect(v!.runId).toBe("r");
      expect(v!.chiSoTin).toBe(khoi.length - 1);
      expect(s.dongThoiGian[v!.iDong]).toEqual({ kieu: "chu", noiDung: khoi[khoi.length - 1] });
    }
  });

  it("đang chạy / chưa có runId ⇒ null", () => {
    const dang = giamNhieu(batDauGui("hỏi", "sua"), [{ loai: "bat-dau", runId: "r", cheDo: "sua" }, { loai: "chu", noiDung: "a" }]);
    expect(viTriTraLoiCuoi(dang)).toBeNull();
    const khongRun = giamNhieu(batDauGui("hỏi", "sua"), [{ loai: "chu", noiDung: "a" }, { loai: "xong", lyDo: "huy" }]);
    expect(viTriTraLoiCuoi(khongRun)).toBeNull();
    expect(viTriTraLoiCuoi(TRANG_THAI_RONG)).toBeNull();
  });
});

describe("chuanHoaPhanHoiCuaToi / phieuTraLoiCuaToi", () => {
  it("ok ⇒ phiếu hợp lệ; ok:false / rác ⇒ []; khớp đúng (runId, chiSoTin, loai tra-loi)", () => {
    const ds = chuanHoaPhanHoiCuaToi({
      ok: true,
      note: null,
      phieu: [
        { loai: "tra-loi", runId: "r", chiSoTin: 1, actionId: null, danhGia: -1 },
        { loai: "diff", runId: "r", chiSoTin: null, actionId: "a", danhGia: 1 },
        { loai: "la", runId: "r", chiSoTin: 0, danhGia: 1 },
        null,
      ],
    });
    expect(ds).toHaveLength(2);
    expect(phieuTraLoiCuaToi(ds, "r", 1)).toBe(-1);
    expect(phieuTraLoiCuaToi(ds, "r", 0)).toBeNull();
    expect(phieuTraLoiCuaToi(ds, "khac", 1)).toBeNull();
    expect(chuanHoaPhanHoiCuaToi({ ok: false, note: "PERMISSION_DENIED", phieu: [] })).toEqual([]);
    expect(chuanHoaPhanHoiCuaToi("x")).toEqual([]);
  });
});

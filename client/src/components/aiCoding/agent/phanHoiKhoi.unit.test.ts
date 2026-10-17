/**
 * Đợt 5.1 — LƯỚI CHÉO: khối `chu` thứ i trên dòng thời gian CLIENT (`giamNhieu`) PHẢI là khối thứ i máy chủ lấy ra bằng
 * `khoiTraLoiTuSuKien` (shared). Lệch ⇒ người chấm câu này mà sổ ghi câu khác. Chuỗi sự kiện phủ MỌI loại `SuKienAgent`.
 * Thêm một loại sự kiện mới mà quên một bên ⇒ lưới này đỏ (ca ngẫu nhiên có mọi loại).
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { khoiTraLoiTuSuKien } from "@shared/phanHoiAgent";
import { chuanHoaKetQuaPhanHoi, chuanHoaPhanHoiCuaToi, phieuTraLoiCuaToi } from "@/lib/agentApi";
import { TRANG_THAI_RONG, batDauGui, giamNhieu, viTriTraLoiCuoi } from "./trangThaiAgent";

const MOI_LOAI: SuKienAgent[] = [
  { loai: "bat-dau", runId: "r", cheDo: "sua" },
  { loai: "chu", noiDung: "a" },
  { loai: "nghi", noiDung: "n" },
  { loai: "goi-tool", goi: { id: "g1", ten: "read_file", thamSo: {} }, luot: 1 },
  { loai: "ket-qua-tool", id: "g1", ten: "read_file", ok: true, tomTat: "ok" },
  { loai: "can-duyet", id: "d1", deXuat: { ten: "edit_file", thamSo: {} } },
  { loai: "da-duyet", id: "d1" },
  { loai: "bi-bac", id: "d1", lyDo: "x" },
  { loai: "ke-hoach", viec: [] },
  { loai: "de-xuat-nho", id: "n1", note: "x", scope: "project" },
  { loai: "checkpoint", checkpointId: "c", tep: [] },
  { loai: "usage", vao: 1, ra: 1 },
  { loai: "dang-cho-model", phiaTruoc: 1 },
  { loai: "loi", ma: "E", thongDiep: "e" },
  { loai: "xong", lyDo: "hoan-thanh" },
];

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
      if (e.loai === "chu") continue;
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
        // id đề xuất nhớ phải MỚI mỗi lần, như máy chủ phát — client bỏ qua id trùng (không lên dòng thời gian).
        es.push(mau.loai === "chu" ? { loai: "chu", noiDung: String(i) } : mau.loai === "de-xuat-nho" ? { ...mau, id: `n${i}` } : mau);
      }
      expect(khoiTraLoiTuSuKien(es)).toEqual(khoiClient(es));
    }
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

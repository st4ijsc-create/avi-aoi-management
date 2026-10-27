/**
 * SCADA R1b-2b-1 Task 1 fix round 1 (điều phối M4 phương án b, 2026-10-26) — bảng ánh xạ kết quả khảo sát khả năng dừng ⇒ gợi ý cấp máy
 * `tongHopDungKhanCap` ("du" | "mot_phan" | "khong_toi" | "khong_ro"). Cùng phân loại với HMI (`tongHopKhaNang`): chỉ `duoc` là tới thiết bị
 * thật; mô phỏng / qua edge / mất kết nối / ghim cũ / chưa ghim / ghim mức cao đều KHÔNG tới. Không kiểm được ⇒ "khong_ro", KHÔNG BAO GIỜ "du".
 */
import { describe, expect, it } from "vitest";
import { tongHopDungKhanCap, tongHopKhaNang, type KhaNangDungAdapter, type KhaNangDungMay } from "./khaNangDung";

const ad = (id: number, trangThai: KhaNangDungAdapter["trangThai"], o: Partial<KhaNangDungAdapter> = {}): KhaNangDungAdapter => ({
  adapterId: id,
  code: `A${id}`,
  trangThai,
  ...o,
});
const may = (adapters: KhaNangDungAdapter[], o: Partial<KhaNangDungMay> = {}): KhaNangDungMay => ({
  machineId: 1,
  adapters,
  tongHop: tongHopKhaNang(adapters),
  ...o,
});

describe("tongHopDungKhanCap — một khảo sát, cùng phân loại HMI", () => {
  it("★★★ mọi adapter duoc ⇒ du", () => {
    expect(tongHopDungKhanCap(may([ad(1, "duoc"), ad(2, "duoc")]))).toBe("du");
  });

  it("★★★ một phần duoc ⇒ mot_phan (kể cả phần kia mô phỏng / qua edge / mất kết nối / chưa ghim)", () => {
    for (const khac of ["mo_phong", "qua_edge", "mat_ket_noi", "ghim_cu", "chua_ghim", "ghim_muc_cao"] as const) {
      expect(tongHopDungKhanCap(may([ad(1, "duoc"), ad(2, khac)])), khac).toBe("mot_phan");
    }
  });

  it("★★★ MÔ PHỎNG không tới thiết bị thật ⇒ khong_toi (cả ot_control_tat lẫn chua_nghiem_thu)", () => {
    expect(tongHopDungKhanCap(may([ad(1, "mo_phong", { lyDo: "ot_control_tat" })]))).toBe("khong_toi");
    expect(tongHopDungKhanCap(may([ad(1, "mo_phong", { lyDo: "chua_nghiem_thu" })]))).toBe("khong_toi");
  });

  it("★★★ qua edge / mất kết nối / ghim cũ / chưa ghim / ghim mức cao / không adapter bật ⇒ khong_toi", () => {
    expect(tongHopDungKhanCap(may([ad(1, "qua_edge", { edgeCode: "E1", edgeToiDuoc: true })]))).toBe("khong_toi");
    expect(tongHopDungKhanCap(may([ad(1, "mat_ket_noi"), ad(2, "ghim_cu")]))).toBe("khong_toi");
    expect(tongHopDungKhanCap(may([ad(1, "chua_ghim"), ad(2, "ghim_muc_cao")]))).toBe("khong_toi");
    expect(tongHopDungKhanCap(may([]))).toBe("khong_toi");
  });

  it("★★★ KHÔNG kiểm được ⇒ khong_ro, KHÔNG BAO GIỜ du: khảo sát lỗi / quá hạn (loiKhaoSat), vắng, adapter khong_kiem_duoc", () => {
    expect(tongHopDungKhanCap(may([], { loiKhaoSat: true }))).toBe("khong_ro");
    // loiKhaoSat thắng cả khi tongHop (lỗi thời) nói "duoc"
    expect(tongHopDungKhanCap(may([ad(1, "duoc")], { loiKhaoSat: true, tongHop: "duoc" }))).toBe("khong_ro");
    expect(tongHopDungKhanCap(undefined)).toBe("khong_ro");
    expect(tongHopDungKhanCap(may([ad(1, "duoc"), ad(2, "khong_kiem_duoc")]))).toBe("khong_ro");
    expect(tongHopDungKhanCap(may([ad(1, "khong_kiem_duoc")]))).toBe("khong_ro");
    // tongHop lạ (máy chủ khác phiên bản) ⇒ khong_ro
    expect(tongHopDungKhanCap(may([], { tongHop: "la" as never }))).toBe("khong_ro");
  });
});

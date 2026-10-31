// Đợt 11.3-C (UX-D02) — bộ giảm cho thẻ "Kế hoạch chờ duyệt": ke-hoach-cho-duyet / -da-duyet / -khong-duyet, hết hiệu lực khi lượt kết thúc,
// phát lại không nhân đôi, đồng bộ với keHoachDangCho (không đụng soSuKien), và bất biến "thẻ đã quyết không bị kéo ngược".
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import {
  TRANG_THAI_RONG,
  capNhatKeHoachDuyet,
  dongBoKeHoachMayChu,
  giamSuKien,
  type MucKeHoachDuyet,
  type TrangThaiAgent,
} from "./trangThaiAgent";

const B1 = "a".repeat(64);
const B2 = "b".repeat(64);
const VIEC = [{ noiDung: "Đọc a.ts", trangThai: "cho" as const }, { noiDung: "Sửa a.ts", trangThai: "cho" as const }];
const chay = (es: SuKienAgent[]): TrangThaiAgent => es.reduce(giamSuKien, TRANG_THAI_RONG);
const BD = { loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent;
const CHO = (bam: string, viec = VIEC) => ({ loai: "ke-hoach-cho-duyet", viec, bam }) as SuKienAgent;
const the = (s: TrangThaiAgent): MucKeHoachDuyet[] => s.dongThoiGian.filter((m): m is MucKeHoachDuyet => m.kieu === "ke-hoach-duyet");

describe("ke-hoach-cho-duyet", () => {
  it("thêm thẻ 'cho' + choDuyet=true; băm sai định dạng ⇒ bỏ qua (nhưng vẫn đếm soSuKien)", () => {
    const s = chay([BD, CHO(B1)]);
    expect(the(s)).toEqual([{ kieu: "ke-hoach-duyet", bam: B1, viec: VIEC, trangThai: "cho" }]);
    expect(s.choDuyet).toBe(true);
    const x = chay([BD, CHO("xyz")]);
    expect(the(x)).toHaveLength(0);
    expect(x.soSuKien).toBe(2);
  });
  it("phát lại cùng băm ⇒ KHÔNG nhân đôi và KHÔNG kéo thẻ đã quyết về 'cho'", () => {
    const s = chay([BD, CHO(B1), { loai: "ke-hoach-da-duyet", bam: B1, luc: "2026-10-31T01:00:00.000Z" } as SuKienAgent, CHO(B1)]);
    expect(the(s)).toHaveLength(1);
    expect(the(s)[0]!.trangThai).toBe("da-duyet");
    expect(s.choDuyet).toBe(false);
  });
  it("kế hoạch mới (băm khác) khi thẻ cũ còn chờ ⇒ thẻ cũ het-hieu-luc, thẻ mới cho", () => {
    const s = chay([BD, CHO(B1), CHO(B2)]);
    expect(the(s).map((m) => m.trangThai)).toEqual(["het-hieu-luc", "cho"]);
  });
});

describe("ke-hoach-da-duyet / ke-hoach-khong-duyet", () => {
  it("da-duyet mang luc; khong-duyet bac / het-gio; băm lạ ⇒ không đổi gì", () => {
    expect(the(chay([BD, CHO(B1), { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" } as SuKienAgent]))[0]).toMatchObject({ trangThai: "da-duyet", luc: "L" });
    expect(the(chay([BD, CHO(B1), { loai: "ke-hoach-khong-duyet", bam: B1, lyDo: "bac" } as SuKienAgent]))[0]!.trangThai).toBe("bac");
    expect(the(chay([BD, CHO(B1), { loai: "ke-hoach-khong-duyet", bam: B1, lyDo: "het-gio" } as SuKienAgent]))[0]!.trangThai).toBe("het-gio");
    expect(the(chay([BD, CHO(B1), { loai: "ke-hoach-da-duyet", bam: B2, luc: "L" } as SuKienAgent]))[0]!.trangThai).toBe("cho");
  });
  it("xoá sạch maLoi khi quyết định tới", () => {
    let s = chay([BD, CHO(B1)]);
    s = capNhatKeHoachDuyet(s, B1, { trangThai: "cho", maLoi: "LOI_CSDL" });
    expect(the(s)[0]!.maLoi).toBe("LOI_CSDL");
    s = giamSuKien(s, { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" } as SuKienAgent);
    expect(the(s)[0]).not.toHaveProperty("maLoi");
  });
});

describe("choDuyet", () => {
  it("thẻ kế hoạch còn chờ giữ choDuyet=true khi một thẻ ghi khác được quyết; quyết xong kế hoạch ⇒ false", () => {
    const duyetGhi = { loai: "can-duyet", id: "t1", deXuat: { tool: "edit_file", tomTat: "x" } } as unknown as SuKienAgent;
    let s = chay([BD, CHO(B1), duyetGhi, { loai: "da-duyet", id: "t1" } as SuKienAgent]);
    expect(s.choDuyet).toBe(true);
    s = capNhatKeHoachDuyet(s, B1, { trangThai: "dang-gui" });
    expect(s.choDuyet).toBe(true);
    s = giamSuKien(s, { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" } as SuKienAgent);
    expect(s.choDuyet).toBe(false);
  });
});

describe("kết thúc lượt", () => {
  it("xong ⇒ thẻ cho / dang-gui thành het-hieu-luc; thẻ đã quyết giữ nguyên", () => {
    let s = chay([BD, CHO(B1)]);
    s = capNhatKeHoachDuyet(s, B1, { trangThai: "dang-gui" });
    s = giamSuKien(s, { loai: "xong", lyDo: "huy" } as SuKienAgent);
    expect(the(s)[0]!.trangThai).toBe("het-hieu-luc");
    const d = chay([BD, CHO(B1), { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" } as SuKienAgent, { loai: "xong", lyDo: "hoan-thanh" } as SuKienAgent]);
    expect(the(d)[0]!.trangThai).toBe("da-duyet");
  });
});

describe("capNhatKeHoachDuyet — bất biến", () => {
  it("thẻ đã quyết KHÔNG bị lời gọi muộn kéo ngược; băm lạ ⇒ trả NGUYÊN s", () => {
    const s0 = chay([BD, CHO(B1), { loai: "ke-hoach-khong-duyet", bam: B1, lyDo: "bac" } as SuKienAgent]);
    expect(the(capNhatKeHoachDuyet(s0, B1, { trangThai: "cho" }))[0]!.trangThai).toBe("bac");
    expect(capNhatKeHoachDuyet(s0, B2, { trangThai: "cho" })).toBe(s0);
  });
});

describe("dongBoKeHoachMayChu (keHoachDangCho)", () => {
  it("không đụng soSuKien; trạng thái lạ ⇒ 'cho' (không bao giờ tự duyệt)", () => {
    const s0 = chay([BD]);
    const s = dongBoKeHoachMayChu(s0, { bam: B1, trangThai: "la-hoac", viec: VIEC });
    expect(s.soSuKien).toBe(s0.soSuKien);
    expect(the(s)[0]).toMatchObject({ bam: B1, trangThai: "cho" });
  });
  it("máy chủ nói 'duyet' cho thẻ đang chờ ⇒ da-duyet; thẻ mới băm khác khi cũ còn chờ ⇒ cũ da-doi", () => {
    let s = chay([BD, CHO(B1)]);
    s = dongBoKeHoachMayChu(s, { bam: B1, trangThai: "duyet", viec: VIEC });
    expect(the(s)[0]!.trangThai).toBe("da-duyet");
    let t = chay([BD, CHO(B1)]);
    t = dongBoKeHoachMayChu(t, { bam: B2, trangThai: "cho", viec: [{ noiDung: "Khác", trangThai: "cho" }] });
    expect(the(t).map((m) => m.trangThai)).toEqual(["da-doi", "cho"]);
  });
  it("băm null / sai ⇒ trả NGUYÊN s; đã quyết mà chưa có thẻ ⇒ không thêm thẻ", () => {
    const s = chay([BD]);
    expect(dongBoKeHoachMayChu(s, { bam: null, trangThai: "cho", viec: [] })).toBe(s);
    expect(dongBoKeHoachMayChu(s, { bam: B1, trangThai: "bac", viec: VIEC })).toBe(s);
  });
});

describe("agent con", () => {
  it("con-xong làm thẻ kế hoạch còn chờ trong con hết hiệu lực (không phải thẻ treo)", () => {
    const es = [
      BD,
      { loai: "con-bat-dau", runIdCon: "c1", agent: "rv", nguon: "dungSan", sau: 1, cheDo: "sua", nhiemVu: "x" },
      { loai: "su-kien-con", runIdCon: "c1", suKien: CHO(B1) },
      { loai: "con-xong", runIdCon: "c1", lyDo: "hoan-thanh" },
    ] as SuKienAgent[];
    const s = chay(es);
    const con = s.dongThoiGian.find((m) => m.kieu === "con");
    expect(con && con.kieu === "con" && (con.tt.dongThoiGian[0] as MucKeHoachDuyet).trangThai).toBe("het-hieu-luc");
    expect(s.choDuyet).toBe(false);
  });
});

/**
 * Đợt 11.8 — bộ giảm sự kiện: `ngu-canh-day` (banner 80 %) và AGENT CON (`con-bat-dau` / `su-kien-con` / `con-xong`).
 * Bất biến: sự kiện của con KHÔNG BAO GIỜ chạm trạng thái điều khiển của cha (dangChay/ketThuc/keHoach/usage/runId); `choDuyet` của cha tính cả thẻ của con;
 * phát lại cùng chuỗi ⇒ cùng trạng thái, không nhân đôi con.
 */
import { describe, expect, it } from "vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { giamSuKien, TRAN_AGENT_CON, TRANG_THAI_RONG, type MucAgentCon, type TrangThaiAgent } from "./trangThaiAgent";

const chay = (es: SuKienAgent[], dau: TrangThaiAgent = TRANG_THAI_RONG) => es.reduce((s, e) => giamSuKien(s, e), dau);
const BAT_DAU: SuKienAgent = { loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent;
const CON: SuKienAgent = { loai: "con-bat-dau", runIdCon: "c1", agent: "reviewer", nguon: "tuRepo", sau: 1, cheDo: "hoi", nhiemVu: "Soát <b>hàm</b> Divide" };
const DUYET_CON: SuKienAgent = {
  loai: "su-kien-con",
  runIdCon: "c1",
  suKien: { loai: "can-duyet", id: "act-9", deXuat: { ten: "run_command", thamSo: { command: "ls" } } } as never,
};
const con = (s: TrangThaiAgent, id = "c1") => s.dongThoiGian.find((m): m is MucAgentCon => m.kieu === "con" && m.runIdCon === id)!;

describe("ngu-canh-day (UX-C06)", () => {
  it("đặt nguCanhDay; giá trị không phải số hữu hạn ⇒ bỏ qua", () => {
    expect(chay([{ loai: "ngu-canh-day", phanTram: 83 }]).nguCanhDay).toBe(83);
    expect(chay([{ loai: "ngu-canh-day", phanTram: Number.NaN }]).nguCanhDay).toBeNull();
    expect(chay([{ loai: "ngu-canh-day", phanTram: "90" as never }]).nguCanhDay).toBeNull();
  });
});

describe("agent con", () => {
  it("con-bat-dau tạo mục con (chữ thô, không biến đổi); phát lại không nhân đôi", () => {
    const s = chay([BAT_DAU, CON, CON]);
    const cs = s.dongThoiGian.filter((m) => m.kieu === "con");
    expect(cs).toHaveLength(1);
    expect(con(s)).toMatchObject({ agent: "reviewer", nguon: "tuRepo", sau: 1, cheDo: "hoi", nhiemVu: "Soát <b>hàm</b> Divide", trangThai: "chay" });
    expect(con(s).tt.dangChay).toBe(true);
  });

  it("nguon lạ ⇒ dungSan (không tin nhãn tuRepo giả); thiếu runIdCon ⇒ bỏ", () => {
    expect(con(chay([{ ...CON, nguon: "x" as never }])).nguon).toBe("dungSan");
    const s = chay([{ ...CON, runIdCon: "" }]);
    expect(s.dongThoiGian).toEqual([]);
  });

  it("★ sự kiện của con KHÔNG chạm điều khiển của cha: xong/ke-hoach/usage/bat-dau/chu đi vào tt của con", () => {
    const cha = chay([BAT_DAU, CON, { loai: "ke-hoach", viec: [{ noiDung: "cha", trangThai: "dang-lam" }] } as never]);
    const sau = chay(
      [
        { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "ke-hoach", viec: [{ noiDung: "con", trangThai: "xong" }] } as never },
        { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "usage", vao: 999, ra: 999 } as never },
        { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "bat-dau", runId: "GIA", cheDo: "sua" } as never },
        { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "chu", noiDung: "xin chào" } as never },
        { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "xong", lyDo: "hoan-thanh", tomTat: "con tự xong" } },
      ],
      cha,
    );
    expect(sau.dangChay).toBe(true);
    expect(sau.ketThuc).toBeNull();
    expect(sau.runId).toBe("r1");
    expect(sau.keHoach).toEqual([{ noiDung: "cha", trangThai: "dang-lam" }]);
    expect(sau.usage).toBeNull();
    expect(con(sau).tt.ketThuc).toMatchObject({ lyDo: "hoan-thanh" });
    expect(con(sau).tt.keHoach).toEqual([{ noiDung: "con", trangThai: "xong" }]);
    expect(con(sau).tt.dongThoiGian).toEqual([{ kieu: "chu", noiDung: "xin chào" }]);
  });

  it("su-kien-con của con không tồn tại ⇒ bỏ qua (không tạo con ma)", () => {
    const s = chay([BAT_DAU, { loai: "su-kien-con", runIdCon: "khong-co", suKien: { loai: "chu", noiDung: "x" } as never }]);
    expect(s.dongThoiGian.filter((m) => m.kieu === "con")).toHaveLength(0);
  });

  it("★ choDuyet của cha tính cả thẻ của con; con duyệt xong ⇒ hết; cha còn thẻ riêng ⇒ vẫn true", () => {
    const a = chay([BAT_DAU, CON, DUYET_CON]);
    expect(a.choDuyet).toBe(true);
    expect(con(a).tt.dongThoiGian).toEqual([expect.objectContaining({ kieu: "duyet", id: "act-9", trangThai: "cho" })]);
    const b = giamSuKien(a, { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "da-duyet", id: "act-9" } as never });
    expect(b.choDuyet).toBe(false);
    expect(con(b).tt.dongThoiGian[0]).toMatchObject({ trangThai: "da-duyet" });
    const c = chay([{ loai: "can-duyet", id: "cha-1", deXuat: { ten: "delete_file", thamSo: { path: "a" } } } as never], a);
    const d = giamSuKien(c, { loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "bi-bac", id: "act-9" } as never });
    expect(d.choDuyet).toBe(true); // thẻ của cha còn chờ
  });

  it("con-xong đóng mục con (lyDo + tomTat chữ thô) và tính lại choDuyet", () => {
    const s = chay([BAT_DAU, CON, DUYET_CON, { loai: "con-xong", runIdCon: "c1", lyDo: "huy", tomTat: "<script>x</script>" }]);
    expect(con(s)).toMatchObject({ trangThai: "xong", lyDo: "huy", tomTat: "<script>x</script>" });
    expect(s.choDuyet).toBe(false);
  });

  it("★ xong của cha ⇒ thẻ còn chờ của CON cũng hết hiệu lực", () => {
    const s = chay([BAT_DAU, CON, DUYET_CON, { loai: "xong", lyDo: "huy" }]);
    expect(s.choDuyet).toBe(false);
    expect(con(s).tt.dongThoiGian[0]).toMatchObject({ kieu: "duyet", trangThai: "het-hieu-luc" });
  });

  it("trần số con và trần độ sâu: không phình, không đệ quy vô hạn", () => {
    const nhieu = Array.from({ length: TRAN_AGENT_CON + 10 }, (_, i) => ({ ...CON, runIdCon: `c${i}` }) as SuKienAgent);
    expect(chay(nhieu).dongThoiGian.filter((m) => m.kieu === "con")).toHaveLength(TRAN_AGENT_CON);
    let e: SuKienAgent = { loai: "chu", noiDung: "sâu" };
    for (let i = 0; i < 8; i++) e = { loai: "su-kien-con", runIdCon: "c1", suKien: e };
    expect(() => chay([CON, e])).not.toThrow();
  });

  it("★ con-xong: thẻ duyệt còn 'cho' của CON hết hiệu lực (UI không được nói dối là còn bấm được); thẻ cha không đụng", () => {
    const CHA: SuKienAgent = { loai: "can-duyet", id: "cha-1", deXuat: { ten: "delete_file", thamSo: { path: "p" } } } as SuKienAgent;
    const s = chay([BAT_DAU, CHA, CON, DUYET_CON, { loai: "con-xong", runIdCon: "c1", lyDo: "hoan-thanh" }]);
    expect(con(s).tt.dongThoiGian[0]).toMatchObject({ kieu: "duyet", id: "act-9", trangThai: "het-hieu-luc" });
    expect(s.dongThoiGian.find((m) => m.kieu === "duyet")).toMatchObject({ id: "cha-1", trangThai: "cho" });
    expect(s.choDuyet).toBe(true); // thẻ của cha vẫn chờ
  });

  it("★ trần độ sâu TRAN_DO_SAU_CON=3: sự kiện ở tầng lồng thứ 4 bị bỏ (chuỗi con lồng tối đa 4 mức)", () => {
    const boc = (k: number, e: SuKienAgent): SuKienAgent => {
      let x = e;
      for (let i = 0; i < k; i++) x = { loai: "su-kien-con", runIdCon: "c1", suKien: x };
      return x;
    };
    let s = chay([BAT_DAU, CON]);
    for (let k = 1; k <= 5; k++) s = giamSuKien(s, boc(k, CON));
    const sau = (t: TrangThaiAgent): number => {
      const c = t.dongThoiGian.find((m): m is MucAgentCon => m.kieu === "con");
      return c ? 1 + sau(c.tt) : 0;
    };
    expect(sau(s)).toBe(4);
  });

  it("phát lại cùng chuỗi ⇒ cùng trạng thái (nối lại luồng)", () => {
    const es: SuKienAgent[] = [BAT_DAU, CON, DUYET_CON, { loai: "con-xong", runIdCon: "c1", lyDo: "hoan-thanh" }, { loai: "ngu-canh-day", phanTram: 81 }];
    expect(chay(es)).toEqual(chay(es));
  });
});

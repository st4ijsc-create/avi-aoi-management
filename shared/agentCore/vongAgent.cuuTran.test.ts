/**
 * Đợt 12 · H1.3 — CỨU khi tràn ngữ cảnh: model báo `CONTEXT_OVERFLOW` ⇒ lõi nén MẠNH (`nenManh`) rồi gọi lại MỘT lần mỗi lượt, chỉ khi
 * ước lượng thực sự giảm; không thì dừng `loi-model` như cũ. Cờ `cuuTranNguCanh` vắng ⇒ như cũ từng byte.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { nenManh, uocLuongTinNhan } from "./nguCanh";
import { LoiModel, MA_LOI_TRAN_NGU_CANH, type BoThucThi, type GoiModel, type ManhModel, type SuKienAgent, type TinNhan } from "./kieu";

const KET_QUA = "x".repeat(2800);
const tran = (ma = MA_LOI_TRAN_NGU_CANH) => new LoiModel("request (80000 tokens) exceeds the available context size (65536 tokens)", { tamThoi: false, ma });

interface KichBan {
  /** lượt gọi (0-based, đếm MỌI lần gọi kể cả gọi lại) nào ném tràn */
  tranTai: number[];
  soCapTool?: number;
  cuu?: boolean;
  giuNghi?: boolean;
  /** mã lỗi ném (mặc định CONTEXT_OVERFLOW) */
  maLoi?: string;
}
async function chay(k: KichBan) {
  const suKien: SuKienAgent[] = [];
  const yeuCau: TinNhan[][] = [];
  let goi = 0;
  const goiModel: GoiModel = (v) => {
    yeuCau.push(structuredClone(v.tinNhan));
    const lan = goi++;
    const soTool = v.tinNhan.filter((m) => m.role === "assistant").length;
    return (async function* (): AsyncGenerator<ManhModel> {
      if (k.tranTai.includes(lan)) throw tran(k.maLoi);
      const xong = soTool >= (k.soCapTool ?? 4);
      yield {
        loai: "xong",
        toolCalls: xong ? [] : [{ id: `c${lan}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${lan}` }) } }],
        ...(k.giuNghi ? {} : {}),
        usage: { vao: 100, ra: 10 },
      } as ManhModel;
    })();
  };
  const bo: BoThucThi = { congCu: (c) => congCuTheoCheDo(c), chay: async () => ({ ok: true, choModel: KET_QUA }) };
  const ket = await chayVongAgent({
    cauHoi: "q",
    cheDo: "hoi",
    runId: "r",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { nganSachNguCanhToken: 1_000_000, soLuotToiDa: 20 },
    ...(k.cuu ? { cuuTranNguCanh: true } : {}),
    ...(k.giuNghi ? { giuNghiTrongLichSu: true } : {}),
  });
  return { suKien, yeuCau, ket };
}
const buocDo = (ds: SuKienAgent[]) => ds.flatMap((e) => (e.loai === "buoc-do" ? [e] : []));

describe("cuuTranNguCanh", () => {
  it("★★★ tràn ở lượt 3 (đã có kết quả tool cũ) ⇒ nén mạnh, gọi lại, lượt chạy HOÀN THÀNH; yêu cầu gọi lại NHỎ hơn lần tràn", async () => {
    const r = await chay({ tranTai: [3], cuu: true });
    expect(r.ket.lyDo).toBe("hoan-thanh");
    const lanTran = r.yeuCau[3]!;
    const lanLai = r.yeuCau[4]!;
    expect(uocLuongTinNhan(lanLai)).toBeLessThan(uocLuongTinNhan(lanTran));
    expect(lanLai.length).toBe(lanTran.length); // không xoá tin
    // mọi kết quả tool trước bước cuối bị rút; bước cuối (assistant cuối + tin sau) nguyên văn
    const iCuoi = lanLai.map((m) => m.role).lastIndexOf("assistant");
    for (const [i, m] of lanLai.entries()) if (m.role === "tool" && i < iCuoi) expect(m.content.startsWith("[compacted:")).toBe(true);
    expect(lanLai.slice(iCuoi)).toEqual(lanTran.slice(iCuoi));
    const loi = r.suKien.filter((e) => e.loai === "loi");
    expect(loi).toHaveLength(1);
    expect(loi[0]).toMatchObject({ ma: MA_LOI_TRAN_NGU_CANH });
  });

  it("★ buoc-do của lượt được cứu mang cuuTran:true và số đo lần nén mạnh; lượt khác không có", async () => {
    const r = await chay({ tranTai: [3], cuu: true });
    const bd = buocDo(r.suKien);
    const cuu = bd.filter((e) => e.cuuTran);
    expect(cuu).toHaveLength(1);
    expect(cuu[0]!.nen!.tokenSau).toBeLessThan(cuu[0]!.nen!.tokenTruoc);
    expect(bd.filter((e) => !e.cuuTran).every((e) => !("cuuTran" in e))).toBe(true);
  });

  it("★★★ tràn LẦN HAI trong cùng lượt (sau khi đã cứu) ⇒ dừng loi-model, không lặp vô hạn", async () => {
    const r = await chay({ tranTai: [3, 4], cuu: true });
    expect(r.ket.lyDo).toBe("loi-model");
    expect(r.yeuCau.length).toBe(5);
  });

  it("★ ước lượng KHÔNG giảm được (chưa có gì để rút) ⇒ không gọi lại, dừng loi-model", async () => {
    const r = await chay({ tranTai: [0], cuu: true });
    expect(r.ket.lyDo).toBe("loi-model");
    expect(r.yeuCau.length).toBe(1);
    const loi = r.suKien.filter((e) => e.loai === "loi");
    expect(loi[0]).toMatchObject({ ma: MA_LOI_TRAN_NGU_CANH });
    expect(String((loi[0] as { thongDiep: string }).thongDiep)).not.toMatch(/retrying/);
  });

  it("★★★ KHÔNG bật cờ ⇒ như cũ: lỗi tràn dừng lượt, không gọi lại", async () => {
    const r = await chay({ tranTai: [3], cuu: false });
    expect(r.ket.lyDo).toBe("loi-model");
    expect(r.yeuCau.length).toBe(4);
  });

  it("★ lỗi model KHÁC mã tràn (dù lịch sử còn rút được) ⇒ KHÔNG cứu: dừng loi-model, không gọi lại", async () => {
    const r = await chay({ tranTai: [3], cuu: true, maLoi: "MODEL_LOI" });
    expect(r.ket.lyDo).toBe("loi-model");
    expect(r.yeuCau.length).toBe(4);
    expect(r.suKien.some((e) => e.loai === "buoc-do" && e.cuuTran)).toBe(false);
  });
});

describe("nenManh (thuần)", () => {
  const ds = (): TinNhan[] => {
    const a: TinNhan[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "q" },
    ];
    for (let i = 0; i < 4; i++) {
      a.push({ role: "assistant", content: "", reasoning_content: "r".repeat(700), tool_calls: [{ id: `c${i}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${i}` }) } }] });
      a.push({ role: "tool", tool_call_id: `c${i}`, name: "read_file", content: KET_QUA });
    }
    return a;
  };
  it("rút suy luận + kết quả tool cũ, giữ bước cuối nguyên văn, giữ số tin và tool_call_id", () => {
    const vao = ds();
    const r = nenManh(vao);
    expect(r.tinNhan.length).toBe(vao.length);
    expect(r.tokenSau).toBeLessThan(r.tokenTruoc);
    const iCuoi = vao.map((m) => m.role).lastIndexOf("assistant");
    expect(r.tinNhan.slice(iCuoi)).toEqual(vao.slice(iCuoi));
    expect(r.tinNhan.slice(0, 2)).toEqual(vao.slice(0, 2));
    for (const [i, m] of r.tinNhan.entries()) {
      if (i < iCuoi && m.role === "assistant") expect(m.reasoning_content).toBeUndefined();
      if (m.role === "tool") expect(m.tool_call_id).toBe(vao[i]!.tool_call_id);
    }
    expect(r.soNen).toBe(3 + 3); // 3 suy luận + 3 kết quả tool cũ
  });
  it("không đột biến đầu vào; chạy lần hai không rút thêm (idempotent về số tin, tokenSau không tăng)", () => {
    const vao = ds();
    const bao = structuredClone(vao);
    const r1 = nenManh(vao);
    expect(vao).toEqual(bao);
    const r2 = nenManh(r1.tinNhan);
    expect(r2.tokenSau).toBeLessThanOrEqual(r1.tokenSau);
    expect(r2.soNen).toBe(0);
  });
  it("không có assistant nào ⇒ không rút gì", () => {
    const r = nenManh([{ role: "system", content: "s" }, { role: "user", content: "q" }]);
    expect(r.soNen).toBe(0);
    expect(r.tokenSau).toBe(r.tokenTruoc);
  });
});

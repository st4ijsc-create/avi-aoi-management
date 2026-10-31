/**
 * Đợt 12 · H1.2 — vòng agent với `demNguCanhSoThat`: quyết định nén dùng SỐ THẬT `usage.vao + ra` của lượt trước + ước lượng phần thêm.
 * Số đo lấy từ `buoc-do.nen.tokenTruoc` (khẳng định chính xác từng token, không "xấp xỉ").
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { uocLuongTinNhan } from "./nguCanh";
import type { BoThucThi, GoiModel, ManhModel, SuKienAgent, TinNhan } from "./kieu";

const KET_QUA = "x".repeat(2800); // 1000 token ước lượng + 4 phụ phí = 1004
const TOKEN_TIN_TOOL = uocLuongTinNhan([{ role: "tool", tool_call_id: "c", name: "read_file", content: KET_QUA }]);

interface Buoc {
  vao?: number;
  ra?: number;
  nghi?: number;
}
async function chay(o: { buoc: Buoc[]; bat: boolean; giuNghi?: boolean; nganSach?: number }) {
  const suKien: SuKienAgent[] = [];
  let i = 0;
  const goiModel: GoiModel = () => {
    const k = i++;
    const b = o.buoc[k] ?? {};
    const cuoi = k >= o.buoc.length - 1;
    return (async function* (): AsyncGenerator<ManhModel> {
      yield {
        loai: "xong",
        toolCalls: cuoi ? [] : [{ id: `c${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${k}` }) } }],
        ...(b.vao !== undefined ? { usage: { vao: b.vao, ra: b.ra ?? 0, ...(b.nghi !== undefined ? { nghi: b.nghi } : {}) } } : {}),
      } as ManhModel;
    })();
  };
  const bo: BoThucThi = { congCu: (c) => congCuTheoCheDo(c), chay: async () => ({ ok: true, choModel: KET_QUA }) };
  await chayVongAgent({
    cauHoi: "q",
    cheDo: "hoi",
    runId: "r",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { nganSachNguCanhToken: o.nganSach ?? 10_000, soLuotToiDa: 20 },
    ...(o.bat ? { demNguCanhSoThat: true } : {}),
    ...(o.giuNghi ? { giuNghiTrongLichSu: true } : {}),
  });
  return suKien.flatMap((e) => (e.loai === "buoc-do" ? [e] : []));
}

describe("demNguCanhSoThat", () => {
  it("★★★ tokenTruoc của lần nén = vao + ra của lượt trước + ước lượng CHỈ tin tool thêm sau đó (chính xác từng token)", async () => {
    // ngưỡng 7000. Lượt 0–2 nhỏ; lượt 3 báo vao=6000 ra=100 ⇒ 6000+100+1004 = 7104 > 7000 ⇒ nén ở lượt gọi kế
    const bd = await chay({ bat: true, buoc: [{ vao: 1000 }, { vao: 2000 }, { vao: 3000 }, { vao: 6000, ra: 100 }, { vao: 6500 }, {}] });
    const nen = bd.filter((e) => e.nen);
    expect(nen.length).toBeGreaterThan(0);
    expect(nen[0]!.luot).toBe(5);
    expect(nen[0]!.nen!.tokenTruoc).toBe(6000 + 100 + TOKEN_TIN_TOOL);
  });

  it("★ cùng kịch bản KHÔNG bật cờ ⇒ ước lượng thuần: không nén (nội dung nhỏ hơn ngưỡng 7000)", async () => {
    const bd = await chay({ bat: false, buoc: [{ vao: 1000 }, { vao: 2000 }, { vao: 3000 }, { vao: 6000, ra: 100 }, { vao: 6500 }, {}] });
    expect(bd.filter((e) => e.nen).length).toBe(0);
  });

  it("★ suy luận KHÔNG giữ trong lịch sử ⇒ trừ khỏi ra khi neo; giữ ⇒ tính nguyên", async () => {
    const kb: Buoc[] = [{ vao: 1000 }, { vao: 2000 }, { vao: 3000 }, { vao: 6000, ra: 300, nghi: 120 }, { vao: 6500 }, {}];
    const khong = await chay({ bat: true, buoc: kb, giuNghi: false });
    expect(khong.filter((e) => e.nen)[0]!.nen!.tokenTruoc).toBe(6000 + (300 - 120) + TOKEN_TIN_TOOL);
    const giu = await chay({ bat: true, buoc: kb, giuNghi: true });
    expect(giu.filter((e) => e.nen)[0]!.nen!.tokenTruoc).toBe(6000 + 300 + TOKEN_TIN_TOOL);
  });

  it("★ lượt model KHÔNG báo usage ⇒ bỏ neo, về ước lượng thuần (không dùng số cũ đã lạc hậu)", async () => {
    // lượt 0 báo vao=6900 (neo cao); lượt 1 KHÔNG usage ⇒ neo bỏ; lượt 2 ước lượng thuần (nhỏ) ⇒ không nén. Neo cũ giữ lại sẽ cho 6900+... > 7000 ⇒ nén.
    const bd = await chay({ bat: true, buoc: [{ vao: 6900 }, {}, {}, {}] });
    expect(bd.filter((e) => e.nen).length).toBe(0);
  });

  it("usage.vao = 0 ⇒ không neo (không tin số 0 giả)", async () => {
    const bd = await chay({ bat: true, buoc: [{ vao: 100 }, { vao: 200 }, { vao: 0, ra: 9000 }, {}, {}] });
    expect(bd.filter((e) => e.nen).length).toBe(0);
  });

  it("★★★ byte gửi model KHÔNG đổi khi chưa tới ngưỡng: bật cờ hay không, yêu cầu giống hệt", async () => {
    const lay = async (bat: boolean) => {
      const yeuCau: TinNhan[][] = [];
      let i = 0;
      const goiModel: GoiModel = (v) => {
        yeuCau.push(structuredClone(v.tinNhan));
        const k = i++;
        return (async function* (): AsyncGenerator<ManhModel> {
          yield { loai: "xong", toolCalls: k >= 3 ? [] : [{ id: `c${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${k}` }) } }], usage: { vao: 100 * (k + 1), ra: 10 } } as ManhModel;
        })();
      };
      await chayVongAgent({
        cauHoi: "q",
        cheDo: "hoi",
        runId: "r",
        nguCanhDuAn: "",
        goiModel,
        boThucThi: { congCu: (c) => congCuTheoCheDo(c), chay: async () => ({ ok: true, choModel: KET_QUA }) },
        phat: () => undefined,
        signal: new AbortController().signal,
        gioiHan: { nganSachNguCanhToken: 1_000_000 },
        ...(bat ? { demNguCanhSoThat: true } : {}),
      });
      return JSON.stringify(yeuCau);
    };
    expect(await lay(true)).toBe(await lay(false));
  });
});

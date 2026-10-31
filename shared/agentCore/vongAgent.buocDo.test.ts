/**
 * Đợt 12 · H0.2 — sự kiện `buoc-do`: bản ghi MỖI lượt gọi model (băm system+tools, số tin, token ước lượng vs thật,
 * cache_n/prompt_n, nén, mã khối chèn) và BẤT BIẾN "không đổi một byte gửi model".
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { bamNgan, MA_KHOI_CHEN } from "./buocDo";
import { CAU_NHAC_LUOT_CAT_KHONG_TOOL, cauNhacTomTatNguCanh, dungLoiNhacHeThong } from "./loiNhac";
import type { BoThucThi, CheDoAgent, GoiModel, ManhModel, SuKienAgent, TinNhan } from "./kieu";

type Buoc = { vaoVang?: boolean; toolCall?: string; ghi?: string; biCat?: boolean; vao?: number; cacheN?: number; promptN?: number; ketQuaDai?: boolean };

function chay(o: { cauHoi?: string; congCuBot?: boolean; buoc: Buoc[]; cheDo?: CheDoAgent; nhac?: boolean; nganSach?: number; chiTool?: (n: number) => string }) {
  const suKien: SuKienAgent[] = [];
  const yeuCau: string[] = [];
  let i = 0;
  const goiModel: GoiModel = (v) => {
    yeuCau.push(JSON.stringify({ tinNhan: v.tinNhan, congCu: v.congCu }));
    const b = o.buoc[i] ?? {};
    const cuoi = i >= o.buoc.length - 1;
    const k = i++;
    return (async function* (): AsyncGenerator<ManhModel> {
      yield {
        loai: "xong",
        toolCalls: b.ghi && !cuoi
          ? [{ id: `w${k}`, type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: b.ghi, content: "x" }) } }]
          : b.toolCall && !cuoi
            ? [{ id: `c${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: b.toolCall }) } }]
            : [],
        ...(b.biCat ? { biCat: true } : {}),
        usage: { ...(b.vaoVang ? {} : { vao: b.vao ?? 10 }), ra: 5, ...(b.cacheN !== undefined ? { cacheN: b.cacheN } : {}), ...(b.promptN !== undefined ? { promptN: b.promptN } : {}) },
      } as ManhModel;
    })();
  };
  const bo: BoThucThi = {
    congCu: (c) => (o.congCuBot ? congCuTheoCheDo(c).slice(1) : congCuTheoCheDo(c)),
    chay: async () => ({ ok: true, choModel: "x".repeat(o.nganSach ? 3000 : 1) }),
  };
  return chayVongAgent({
    cauHoi: o.cauHoi ?? "q",
    cheDo: o.cheDo ?? "sua",
    runId: "r",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { nganSachNguCanhToken: o.nganSach ?? 1000 },
    ...(o.nhac !== undefined ? { nhacTomTatKhiDay: o.nhac } : {}),
  }).then(() => ({ suKien, yeuCau }));
}

const buocDo = (ds: SuKienAgent[]) => ds.flatMap((e) => (e.loai === "buoc-do" ? [e] : []));

describe("buoc-do", () => {
  it("MỖI lượt gọi model phát đúng một bản ghi, ngay sau usage của lượt đó", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a", vao: 100 }, { toolCall: "b", vao: 150 }, { vao: 200 }] });
    const bd = buocDo(suKien);
    expect(bd.map((e) => e.luot)).toEqual([1, 2, 3]);
    expect(bd.map((e) => e.vaoThat)).toEqual([100, 150, 200]);
    for (const [k, e] of suKien.entries()) {
      if (e.loai === "buoc-do") expect(suKien[k - 1]!.loai).toBe("usage");
    }
  });

  it("★ bamHeThong ổn định giữa các lượt và = băm system+tools; soTin tăng theo lịch sử; tokenUoc > 0", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a" }, { toolCall: "b" }, {}] });
    const bd = buocDo(suKien);
    expect(new Set(bd.map((e) => e.bamHeThong)).size).toBe(1);
    expect(bd[0]!.bamHeThong).toMatch(/^[0-9a-f]{8}$/);
    expect(bd.map((e) => e.soTin)).toEqual([2, 4, 6]);
    expect(bd.every((e) => e.tokenUoc > 0)).toBe(true);
    const he = dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi", congCu: congCuTheoCheDo("sua").map((t) => t.function.name).concat("todo_write") });
    expect(bd[0]!.bamHeThong).not.toBe(bamNgan(he)); // băm gồm cả schema công cụ
  });

  it("★ ghi 2 tệp chưa chạy test ⇒ khối ghi-chua-test được ghi mã ở lượt model kế", async () => {
    const { suKien } = await chay({ cauHoi: "sửa rồi chạy `npm test`", buoc: [{ ghi: "a.ts" }, { ghi: "b.ts" }, { toolCall: "a.ts" }, {}] });
    expect(buocDo(suKien).map((e) => e.nhacDaChen)).toEqual([[], [], ["ghi-chua-test"], []]);
  });

  it("★ tokenUoc gồm schema công cụ: lớn hơn chỉ-tin-nhắn đúng bằng phần công cụ", async () => {
    const { suKien } = await chay({ buoc: [{}] });
    const e = buocDo(suKien)[0]!;
    const tools = JSON.stringify(congCuTheoCheDo("sua"));
    expect(e.tokenUoc).toBeGreaterThan(Math.ceil((tools.length * 10) / 28));
  });

  it("★ bamHeThong đổi khi bộ công cụ đổi (cùng system)", async () => {
    const a = buocDo((await chay({ buoc: [{}] })).suKien)[0]!.bamHeThong;
    const b = buocDo((await chay({ buoc: [{}], congCuBot: true })).suKien)[0]!.bamHeThong;
    expect(a).not.toBe(b);
  });

  it("★ usage thiếu vao (hoặc vao = 0) ⇒ buoc-do KHÔNG có vaoThat (không 0 giả); vao thật được giữ", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a", vao: 0 }, { toolCall: "b", vao: 77 }, { toolCall: "c", vaoVang: true }, {}] });
    const [a0, b0, c0] = buocDo(suKien);
    expect("vaoThat" in a0!).toBe(false);
    expect(b0!.vaoThat).toBe(77);
    expect("vaoThat" in c0!).toBe(false);
  });

  it("cacheN/promptN chỉ có khi nguồn báo SỐ; vắng ⇒ không có khoá (KHÔNG BIẾT ≠ 0)", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a", cacheN: 0, promptN: 80 }, {}] });
    const [a, b] = buocDo(suKien);
    expect(a).toMatchObject({ cacheN: 0, promptN: 80 });
    expect("cacheN" in b!).toBe(false);
    expect("promptN" in b!).toBe(false);
  });

  it("nhacDaChen: mã khối chèn TRƯỚC lượt model đó; nhắc tóm tắt có mã, lượt kế sạch", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a", vao: 900 }, { toolCall: "b", vao: 900 }, {}], nhac: true });
    expect(buocDo(suKien).map((e) => e.nhacDaChen)).toEqual([[], ["tom-tat-ngu-canh"], []]);
  });

  it("nhắc lượt bị cắt: mã cat-khong-tool", async () => {
    const { suKien } = await chay({ buoc: [{ biCat: true }, {}] });
    expect(buocDo(suKien).map((e) => e.nhacDaChen)).toEqual([[], ["cat-khong-tool"]]);
  });

  it("nen: null khi không nén; có số liệu khi vượt ngưỡng", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "a" }, { toolCall: "b" }, { toolCall: "c" }, { toolCall: "d" }, {}], nganSach: 600 });
    const bd = buocDo(suKien);
    expect(bd[0]!.nen).toBeNull();
    const co = bd.filter((e) => e.nen);
    expect(co.length).toBeGreaterThan(0);
    expect(co[0]!.nen!.tokenTruoc).toBeGreaterThan(co[0]!.nen!.tokenSau);
    expect(co[0]!.nen!.soNen).toBeGreaterThan(0);
  });

  it("không có nội dung tin nhắn trong bản ghi (chỉ số + mã)", async () => {
    const { suKien } = await chay({ buoc: [{ toolCall: "secret-path" }, {}] });
    expect(JSON.stringify(buocDo(suKien))).not.toContain("secret-path");
  });

  it("★★★ BYTE gửi model KHÔNG đổi: yêu cầu = đúng dựng tay từ system + câu hỏi + (nhắc) — đột biến 1 ký tự ⇒ đỏ", async () => {
    const { yeuCau } = await chay({ buoc: [{ biCat: true }, {}] });
    const tools = congCuTheoCheDo("sua");
    const lanDau = JSON.parse(yeuCau[0]!) as { tinNhan: TinNhan[]; congCu: unknown[] };
    const lanHai = JSON.parse(yeuCau[1]!) as { tinNhan: TinNhan[] };
    expect(lanDau.tinNhan.map((m) => m.role)).toEqual(["system", "user"]);
    expect(lanDau.congCu.length).toBe(tools.length);
    expect(lanHai.tinNhan.at(-1)).toEqual({ role: "user", content: CAU_NHAC_LUOT_CAT_KHONG_TOOL });
    expect(lanHai.tinNhan.at(-2)).toMatchObject({ role: "assistant" });
    // nhắc tóm tắt: byte đúng của cauNhacTomTatNguCanh
    return chay({ buoc: [{ toolCall: "a", vao: 900 }, { toolCall: "b" }, {}], nhac: true }).then((r) => {
      const t = (JSON.parse(r.yeuCau[1]!) as { tinNhan: TinNhan[] }).tinNhan;
      expect(t.at(-1)).toEqual({ role: "user", content: cauNhacTomTatNguCanh(90) });
    });
  });
});

describe("census MA_KHOI_CHEN", () => {
  it("mọi mã đều là chuỗi kebab duy nhất", () => {
    expect(new Set(MA_KHOI_CHEN).size).toBe(MA_KHOI_CHEN.length);
    for (const m of MA_KHOI_CHEN) expect(m).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

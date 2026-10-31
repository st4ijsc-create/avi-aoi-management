/**
 * Đợt 12 · H5.3 — lõi: móc `luuDauRaDai` cho kết quả tool vượt trần quan sát. Vắng móc ⇒ như cũ từng byte.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { bamNoiDung, type DinhNghiaAgent } from "./dinhNghiaAgent";
import { QUY_TAC_DAU_RA_DAI, dungLoiNhacHeThong } from "./loiNhac";
import type { CauHinhGiaoViec } from "./giaoViec";
import type { BoThucThi, GoiModel, KetQuaTool, ManhModel, SuKienAgent, TinNhan } from "./kieu";

const TRAN = 12_000;
const DAI = (n: number) => `${"a".repeat(100)}\n`.repeat(Math.ceil(n / 101)).slice(0, n);

interface Luot {
  chu?: string;
  tool?: Array<{ ten: string; args: Record<string, unknown> }>;
}
function modelGia(kb: Luot[], vao?: Array<{ congCu: string[]; tinNhan: TinNhan[] }>): GoiModel {
  let i = 0;
  return (v) => {
    const l = kb[i] ?? { chu: "(het)" };
    const stt = i++;
    vao?.push({ congCu: v.congCu.map((t) => t.function.name), tinNhan: structuredClone(v.tinNhan) });
    return (async function* (): AsyncGenerator<ManhModel> {
      if (l.chu) yield { loai: "chu", noiDung: l.chu };
      yield { loai: "xong", toolCalls: (l.tool ?? []).map((t, k) => ({ id: `c${stt}_${k}`, type: "function" as const, function: { name: t.ten, arguments: JSON.stringify(t.args) } })) };
    })();
  };
}

async function chay(o: {
  kb: Luot[];
  tra: (ten: string) => string;
  luu?: (y: { id: string; ten: string; runId: string; noiDung: string }) => string | null;
  congCuThem?: string[];
}) {
  const suKien: SuKienAgent[] = [];
  const vao: Array<{ congCu: string[]; tinNhan: TinNhan[] }> = [];
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c, (o.congCuThem ?? []) as never),
    async chay(goi): Promise<KetQuaTool> {
      return { ok: true, choModel: o.tra(goi.ten) };
    },
  };
  const kq = await chayVongAgent({
    cauHoi: "q",
    cheDo: "hoi",
    runId: "run-1",
    nguCanhDuAn: "",
    goiModel: modelGia(o.kb, vao),
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    ...(o.luu ? { luuDauRaDai: o.luu } : {}),
  });
  return { kq, suKien, vao };
}
const toolMsg = (m: { kq: { tinNhan: TinNhan[] } }, ten: string) => m.kq.tinNhan.find((t) => t.role === "tool" && t.name === ten)!.content;

describe("luuDauRaDai", () => {
  it("★★★ vượt trần + có móc ⇒ móc nhận ĐÚNG chuỗi đầy đủ; model thấy đầu+đuôi + dòng mã tham chiếu", async () => {
    const day = DAI(30_000);
    const goi: Array<{ id: string; ten: string; runId: string; noiDung: string }> = [];
    const m = await chay({
      kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }],
      tra: () => day,
      luu: (y) => {
        goi.push(y);
        return "out-1a2b3c4d";
      },
    });
    expect(goi).toHaveLength(1);
    expect(goi[0]).toMatchObject({ ten: "grep", runId: "run-1", id: "c0_0" });
    expect(goi[0]!.noiDung).toBe(day); // KHÔNG phải bản đã cắt
    const t = toolMsg(m, "grep");
    expect(t).toContain("chars omitted");
    expect(t.endsWith("\n[full output saved as out-1a2b3c4d; read it with read_output (start_line/end_line or grep)]")).toBe(true);
    expect(t.length).toBeLessThan(TRAN + 400);
  });

  it("★★★ KHÔNG móc ⇒ như cũ từng byte (không dòng ref)", async () => {
    const day = DAI(30_000);
    const co = await chay({ kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }], tra: () => day, luu: () => "out-00000000" });
    const khong = await chay({ kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }], tra: () => day });
    const tK = toolMsg(khong, "grep");
    expect(tK).not.toContain("full output");
    expect(toolMsg(co, "grep").startsWith(tK)).toBe(true); // chỉ THÊM đuôi, phần trước giống từng byte
  });

  it("dưới trần ⇒ móc KHÔNG được gọi", async () => {
    let n = 0;
    await chay({ kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }], tra: () => DAI(TRAN), luu: () => (n++, "out-11111111") });
    expect(n).toBe(0);
  });

  it("móc trả null / ném ⇒ nói thật '(could not be saved)', lượt chạy KHÔNG hỏng", async () => {
    for (const luu of [() => null, () => { throw new Error("disk full"); }]) {
      const m = await chay({ kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }], tra: () => DAI(30_000), luu });
      expect(toolMsg(m, "grep").endsWith("\n[full output could not be saved]")).toBe(true);
      expect(m.kq.lyDo).toBe("hoan-thanh");
    }
  });

  it("read_file (phân trang riêng) · read_output · todo_write KHÔNG bị lưu dù dài", async () => {
    let n = 0;
    const luu = () => (n++, "out-22222222");
    await chay({ kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { tool: [{ ten: "read_output", args: { ref: "out-22222222" } }] }, { chu: "ok" }], tra: () => DAI(30_000), luu, congCuThem: ["read_output"] });
    expect(n).toBe(0);
  });

  it("★ dòng ref nằm SAU phần cắt: đầu+đuôi giữ nguyên (đuôi vẫn sống)", async () => {
    const day = `HEAD-MARK\n${DAI(30_000)}\nTAIL-MARK`;
    const m = await chay({ kb: [{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "ok" }], tra: () => day, luu: () => "out-33333333" });
    const t = toolMsg(m, "grep");
    expect(t).toContain("HEAD-MARK");
    expect(t).toContain("TAIL-MARK");
    expect(t.indexOf("TAIL-MARK")).toBeLessThan(t.indexOf("[full output saved"));
  });

  it("quy tắc 17 chỉ khi congCu có read_output (system giống từng byte khi vắng)", async () => {
    const co = await chay({ kb: [{ chu: "ok" }], tra: () => "", congCuThem: ["read_output"] });
    expect(co.vao[0]!.tinNhan[0]!.content).toContain(QUY_TAC_DAU_RA_DAI);
    const khong = await chay({ kb: [{ chu: "ok" }], tra: () => "" });
    expect(khong.vao[0]!.tinNhan[0]!.content).not.toContain(QUY_TAC_DAU_RA_DAI);
    expect(khong.vao[0]!.tinNhan[0]!.content).toBe(dungLoiNhacHeThong({ cheDo: "hoi", ngonNgu: "vi", congCu: khong.vao[0]!.congCu }));
  });
});

describe("agent con dùng chung móc, khoá theo runId của vòng gọi", () => {
  const dn = (): DinhNghiaAgent => ({ ten: "kham-pha", moTa: "x", congCu: ["grep", "read_file"], model: "auto", cheDo: "hoi", than: "You explore.", bam: bamNoiDung("x"), nguon: "dungSan" });
  it("★★★ con gọi móc với runId CỦA CON; con thấy read_output khi cha có; cha có thể không có ⇒ con không có", async () => {
    const goi: Array<{ runId: string; ten: string }> = [];
    const vaoCon: Array<{ congCu: string[] }> = [];
    for (const chaCoDocDauRa of [true, false]) {
      goi.length = 0;
      vaoCon.length = 0;
      const bo: BoThucThi = {
        congCu: (c) => congCuTheoCheDo(c, ["delegate", ...(chaCoDocDauRa ? ["read_output" as const] : [])]),
        async chay() {
          return { ok: true, choModel: DAI(30_000) };
        },
      };
      const cfg: CauHinhGiaoViec = {
        doSauHienTai: 0,
        async tra() {
          return { ok: true, dn: dn() };
        },
        async batDauCon() {
          return { ok: true, runId: "con-9", goiModel: modelGia([{ tool: [{ ten: "grep", args: { pattern: "a" } }] }, { chu: "xong" }], vaoCon as never), ketThuc: () => undefined };
        },
      };
      await chayVongAgent({
        cauHoi: "q",
        cheDo: "sua",
        runId: "cha-1",
        nguCanhDuAn: "",
        goiModel: modelGia([{ tool: [{ ten: "delegate", args: { agent: "kham-pha", task: "t" } }] }, { chu: "ok" }]),
        boThucThi: bo,
        phat: () => undefined,
        signal: new AbortController().signal,
        giaoViec: cfg,
        luuDauRaDai: (y) => (goi.push({ runId: y.runId, ten: y.ten }), `out-${String(goi.length).padStart(8, "0")}`),
      });
      expect(goi.every((g) => g.runId === "con-9")).toBe(true);
      expect(goi.length).toBeGreaterThan(0);
      expect(vaoCon[0]!.congCu.includes("read_output")).toBe(chaCoDocDauRa);
    }
  });
});

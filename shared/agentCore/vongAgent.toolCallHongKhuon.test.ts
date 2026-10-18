/**
 * ★★★ (2026-10-19, bộ ngẫu nhiên `NN-b-agent-3`, bài `js-ud1-router-rest`, run 9fde5efe…) — MẢNH THẺ TOOL CALL
 * KHÔNG GOM ĐƯỢC KHÔNG PHẢI CÂU TRẢ LỜI CUỐI.
 *
 * Đo được (sổ `ai_agent_runs.suKien`): lượt 2 model nghĩ 11 998 token (chạm `--reasoning-budget 12000`) rồi `content`
 * chỉ còn `</tool_call>` (5 token), 0 `tool_calls` ⇒ lõi coi là câu trả lời cuối ⇒ `hoan-thanh` sau 5 tool, 0 tệp
 * được ghi, 0/16 test. Bộ gom (`gomToolCallTuVanBan`) đúng khi KHÔNG vớt: không có khối đủ thẻ mở/đóng.
 *
 * Bất biến canh ở đây:
 * - Chữ của lượt KHÔNG có tool call mà mang mảnh thẻ tool call (`<tool_call>`, `</tool_call>`, `<function=`, `</function>`,
 *   `<parameter=`) ở NGOÀI khối mã ⇒ vòng KHÔNG kết thúc; model nhận quan sát "lời gọi hỏng khuôn — gọi lại bằng tool
 *   call thật".
 * - Chữ hỏng KHÔNG BAO GIỜ thành hành động (không vớt/đoán tham số) — bộ thực thi không được gọi.
 * - Đếm vào chuỗi hỏng liên tiếp (`THAM_SO_HONG_LAP`): 3 lượt liền ⇒ dừng `lap-lai`, không đốt tới trần lượt.
 * - Câu trả lời thật NHẮC tới thẻ trong khối mã/backtick (vd giải thích khuôn Qwen) vẫn là câu trả lời cuối.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent, coManhToolCallHongKhuon } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import type { BoThucThi, GoiModel, LoiGoiTool, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "./kieu";

type Luot = { tool?: Array<{ ten: string; args: string }>; chu?: string };

function modelGia(kichBan: (i: number) => Luot) {
  const vao: TinNhan[][] = [];
  const goiModel: GoiModel = (v) => {
    const i = vao.length;
    vao.push(structuredClone(v.tinNhan));
    return (async function* (): AsyncGenerator<ManhModel> {
      const l = kichBan(i);
      if (l.chu) yield { loai: "chu", noiDung: l.chu };
      const toolCalls: WireToolCall[] = (l.tool ?? []).map((t, k) => ({
        id: `call_${i}_${k}`,
        type: "function",
        function: { name: t.ten, arguments: t.args },
      }));
      yield { loai: "xong", toolCalls };
    })();
  };
  return { goiModel, vao };
}

function boThucThiGia() {
  const goi: LoiGoiTool[] = [];
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c),
    async chay(g) {
      goi.push(g);
      return { ok: true, choModel: `ok ${g.ten}` };
    },
  };
  return { bo, goi };
}

function chay(goiModel: GoiModel, bo: BoThucThi) {
  const suKien: SuKienAgent[] = [];
  const p = chayVongAgent({
    cauHoi: "Viết src/router.mjs",
    cheDo: "tu-dong",
    runId: "run-hk",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
  });
  return { p, suKien };
}

/** Đúng hình dạng đo được ở run 9fde5efe: content CHỈ là thẻ đóng. */
const CHI_THE_DONG = "</tool_call>";
/** Khuôn XML Qwen bị cắt giữa chừng (thiếu `</function>`) — bộ gom trả null, KHÔNG được vớt. */
const XML_DO = '<tool_call>\n<function=write_file>\n<parameter=path>\nsrc/router.mjs\n</parameter>\n<parameter=content>\nexport class Router {';

describe("coManhToolCallHongKhuon", () => {
  it.each([
    CHI_THE_DONG,
    XML_DO,
    "<function=read_file>\n<parameter=path>\na.ts\n</parameter>",
    'Tôi sẽ ghi tệp.\n<tool_call>\n{"name":"write_file","arguments":{"path":"a"',
    "   </function>\n</tool_call>  ",
  ])("nhận mảnh thẻ ngoài khối mã: %j", (s) => {
    expect(coManhToolCallHongKhuon(s)).toBe(true);
  });

  it.each([
    "",
    "Đã xong: router.mjs và sanPham.mjs đã viết, 16/16 test qua.",
    "Qwen phát lời gọi dạng `<tool_call>{…}</tool_call>` trong content.",
    "Ví dụ khuôn:\n```xml\n<tool_call>\n<function=read_file>\n</function>\n</tool_call>\n```\nHết.",
    "So sánh a <function b — không phải thẻ.",
  ])("KHÔNG nhận câu trả lời thường / thẻ trong khối mã: %j", (s) => {
    expect(coManhToolCallHongKhuon(s)).toBe(false);
  });
});

describe("★★★ câu trả lời cuối chỉ là mảnh thẻ tool call — KHÔNG kết thúc lượt", () => {
  it("content = `</tool_call>`, 0 tool call ⇒ không hoan-thanh; model nhận quan sát; lượt sau làm tiếp", async () => {
    const { goiModel, vao } = modelGia((i) =>
      i === 0
        ? { chu: CHI_THE_DONG }
        : i === 1
          ? { tool: [{ ten: "read_file", args: '{"path":"src/router.mjs"}' }] }
          : { chu: "Đã xong." },
    );
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;

    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(3);
    expect(goi.map((g) => g.ten)).toEqual(["read_file"]);
    expect(suKien.filter((e) => e.loai === "loi")).toEqual([]);
    const xong = suKien.find((e) => e.loai === "xong") as Extract<SuKienAgent, { loai: "xong" }>;
    expect(xong.tomTat).toBe("Đã xong.");

    // lượt 2 nhận: assistant (chữ hỏng) rồi MỘT tin user mang quan sát
    const cuoi = vao[1][vao[1].length - 1];
    expect(cuoi.role).toBe("user");
    expect(cuoi.content).toMatch(/malformed/i);
    expect(cuoi.content).toMatch(/nothing was executed/i);
    expect(cuoi.content).toMatch(/tool call/i);
  });

  it("khuôn XML Qwen dở (thiếu `</function>`) ⇒ KHÔNG vớt thành hành động, không kết thúc", async () => {
    const { goiModel, vao } = modelGia((i) => (i === 0 ? { chu: XML_DO } : { chu: "Xong." }));
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(2);
    expect(goi).toHaveLength(0);
    // lịch sử không có tool_calls bịa từ chữ hỏng
    expect(kq.tinNhan.some((m) => m.tool_calls?.length)).toBe(false);
  });

  it("hỏng khuôn 3 lượt liên tiếp ⇒ dừng lap-lai có THAM_SO_HONG_LAP, không đốt tới trần lượt", async () => {
    const { goiModel, vao } = modelGia(() => ({ chu: CHI_THE_DONG }));
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("lap-lai");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
    expect(suKien.some((e) => e.loai === "loi" && e.ma === "THAM_SO_HONG_LAP")).toBe(true);
  });

  it("chuỗi hỏng tính CHUNG với tham số JSON hỏng (2 tham số hỏng + 1 khuôn hỏng ⇒ dừng)", async () => {
    const kb: Luot[] = [
      { tool: [{ ten: "write_file", args: '{"path":"a.mjs","content":"x' }] },
      { tool: [{ ten: "write_file", args: '{"path":"a.mjs","content":"xy' }] },
      { chu: CHI_THE_DONG },
      { chu: "không tới" },
    ];
    const { goiModel, vao } = modelGia((i) => kb[i]);
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("lap-lai");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
    expect(suKien.some((e) => e.loai === "loi" && e.ma === "THAM_SO_HONG_LAP")).toBe(true);
  });

  it("một lời gọi hợp lệ chen giữa ⇒ đếm về 0", async () => {
    const kb: Luot[] = [
      { chu: CHI_THE_DONG },
      { chu: CHI_THE_DONG },
      { tool: [{ ten: "read_file", args: '{"path":"a.ts"}' }] },
      { chu: CHI_THE_DONG },
      { chu: CHI_THE_DONG },
      { chu: "ok" },
    ];
    const { goiModel } = modelGia((i) => kb[i]);
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(1);
  });

  it("câu trả lời thật giải thích khuôn trong khối mã ⇒ vẫn là câu trả lời cuối (1 lượt)", async () => {
    const chu = "Khuôn Qwen:\n```\n<tool_call>\n<function=read_file>\n</function>\n</tool_call>\n```";
    const { goiModel, vao } = modelGia(() => ({ chu }));
    const { bo } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(1);
  });
});

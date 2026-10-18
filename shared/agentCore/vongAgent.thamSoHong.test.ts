/**
 * ★★★ Đợt 4 (V-dot4-2, bài `js-doi-ten` lượt 3) — THAM SỐ TOOL CALL HỎNG KHÔNG ĐƯỢC ĐẦU ĐỘC LỊCH SỬ.
 *
 * Đo được: model phát `write_file` với nội dung RẤT DÀI, lượt bị cắt ở trần `max_tokens` ⇒ `arguments` là JSON dở
 * (`{"path":…,"content":"/** Bỏ dấu tiếng Việt…` — thiếu dấu nháy đóng). Lõi trả đúng `THAM_SO_SAI` cho model, NHƯNG
 * đẩy NGUYÊN chuỗi hỏng vào `assistant.tool_calls` của lịch sử. llama.cpp b9814 (`common/chat.cpp`
 * `func_args_not_string`) `json::parse` MỌI `tool_calls[].function.arguments` của YÊU CẦU trước khi áp chat template ⇒
 * HTTP 500 "Failed to parse tool call arguments as JSON … column 30901 … missing closing quote" ở MỌI lượt sau (hỏi lại
 * nghĩ tắt cũng vậy — lịch sử y hệt) ⇒ vòng chết `loi-model`.
 *
 * Bất biến canh ở đây:
 * - Lịch sử gửi model chỉ mang `arguments` là MỘT object JSON chặt (llama.cpp parse được, template Qwen `|items` được).
 * - Chữ hỏng KHÔNG BAO GIỜ thành hành động (không vớt/đoán tham số): bộ thực thi không được gọi; lịch sử ghi `{}`.
 * - Model nhận quan sát nói rõ "đã bị cắt / quá dài ⇒ ghi từng phần, dùng edit_file".
 * - Hỏng lặp liên tiếp ⇒ dừng có giới hạn (không đốt 30 lượt).
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import {
  LoiModel,
  type BoThucThi,
  type GoiModel,
  type LoiGoiTool,
  type ManhModel,
  type SuKienAgent,
  type TinNhan,
  type WireToolCall,
} from "./kieu";

/** Bắt chước `func_args_not_string` của llama.cpp b9814 + template Qwen (`arguments|items` ⇒ phải là object). */
function llamaCppNhanLichSu(ds: TinNhan[]): void {
  for (const m of ds) {
    for (const tc of m.tool_calls ?? []) {
      let v: unknown;
      try {
        v = JSON.parse(tc.function.arguments);
      } catch (e) {
        throw new LoiModel(
          `[llamaServer] stream HTTP 500: {"error":{"code":500,"message":"Failed to parse tool call arguments as JSON: ${(e as Error).message}"}}`,
          { tamThoi: true },
        );
      }
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new LoiModel("[llamaServer] stream HTTP 500: template", { tamThoi: true });
    }
  }
}

type Luot = { tool?: Array<{ ten: string; args: string }>; chu?: string; biCat?: boolean };

function modelGia(kichBan: (i: number) => Luot) {
  const vao: TinNhan[][] = [];
  const goiModel: GoiModel = (v) => {
    const i = vao.length;
    vao.push(structuredClone(v.tinNhan));
    return (async function* (): AsyncGenerator<ManhModel> {
      llamaCppNhanLichSu(v.tinNhan);
      const l = kichBan(i);
      if (l.chu) yield { loai: "chu", noiDung: l.chu };
      const toolCalls: WireToolCall[] = (l.tool ?? []).map((t, k) => ({
        id: `call_${i}_${k}`,
        type: "function",
        function: { name: t.ten, arguments: t.args },
      }));
      yield { loai: "xong", toolCalls, ...(l.biCat ? { biCat: true } : {}) };
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
    cauHoi: "Đổi tên tienIch.mjs thành vanBan.mjs",
    cheDo: "tu-dong",
    runId: "run-th",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
  });
  return { p, suKien };
}

/** Đúng hình dạng đo được: JSON dở giữa chuỗi `content`, ~31 k ký tự. */
const ARGS_CAT_CUT = `{"path":"src/vanBan.mjs","content":"${"/** Bỏ dấu tiếng Việt, giữ nguyên hoa/thường. */\\nexport const a = 1;\\n".repeat(450)}`;

describe("★★★ tham số tool call hỏng — lịch sử không bị đầu độc", () => {
  it("write_file bị cắt cụt (JSON dở, ~31k ký tự) ⇒ không thực thi; lượt sau llama.cpp parse được lịch sử; vòng TIẾP TỤC tới hoan-thanh", async () => {
    expect(ARGS_CAT_CUT.length).toBeGreaterThan(30_000);
    const { goiModel, vao } = modelGia((i) =>
      i === 0 ? { tool: [{ ten: "write_file", args: ARGS_CAT_CUT }] } : { chu: "Đã xong." },
    );
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;

    expect(suKien.filter((e) => e.loai === "loi")).toEqual([]);
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(0); // chữ hỏng KHÔNG thành hành động
    expect(vao).toHaveLength(2);

    // lịch sử gửi lượt 2: assistant.tool_calls mang `{}` — KHÔNG mang mảnh nội dung hỏng
    const asst = vao[1].find((m) => m.role === "assistant" && m.tool_calls?.length)!;
    expect(asst.tool_calls![0].function).toEqual({ name: "write_file", arguments: "{}" });
    expect(JSON.stringify(vao[1])).not.toContain("Bỏ dấu tiếng Việt");

    // quan sát cho model: nói rõ hỏng/cắt + cách làm tiếp (ghi từng phần, edit_file)
    const tool = vao[1].find((m) => m.role === "tool")!;
    expect(tool.content).toMatch(/not valid JSON/i);
    expect(tool.content).toMatch(/nothing was (written|executed)/i);
    expect(tool.content).toMatch(/cut off|truncated|too long/i);
    expect(tool.content).toMatch(/edit_file/);
  });

  it("tham số hợp lệ giữ NGUYÊN từng byte trong lịch sử (prefix-cache không trượt)", async () => {
    const args = '{ "path" : "a.ts",  "start_line": 1 }';
    const { goiModel, vao } = modelGia((i) => (i === 0 ? { tool: [{ ten: "read_file", args }] } : { chu: "ok" }));
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(1);
    expect(vao[1].find((m) => m.tool_calls?.length)!.tool_calls![0].function.arguments).toBe(args);
  });

  it("tham số được lõi chấp nhận nhưng KHÔNG phải JSON chặt (rào ```json, rỗng) ⇒ lịch sử ghi đúng object ĐÃ chạy, dạng chuẩn", async () => {
    const { goiModel, vao } = modelGia((i) =>
      i === 0
        ? { tool: [{ ten: "read_file", args: '```json\n{"path":"a.ts"}\n```' }, { ten: "todo_write", args: "" }] }
        : { chu: "ok" },
    );
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi.map((g) => g.thamSo)).toEqual([{ path: "a.ts" }]);
    const calls = vao[1].find((m) => m.tool_calls?.length)!.tool_calls!;
    expect(calls.map((c) => c.function.arguments)).toEqual(['{"path":"a.ts"}', "{}"]);
  });

  it("JSON hợp lệ nhưng KHÔNG phải object (mảng) ⇒ lịch sử `{}` (template Qwen cần object), không thực thi", async () => {
    const { goiModel, vao } = modelGia((i) => (i === 0 ? { tool: [{ ten: "read_file", args: '["a.ts"]' }] } : { chu: "ok" }));
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(0);
    expect(vao[1].find((m) => m.tool_calls?.length)!.tool_calls![0].function.arguments).toBe("{}");
  });

  it("hỏng LẶP 3 lượt liên tiếp (mỗi lượt một chuỗi khác) ⇒ dừng lap-lai có báo lỗi, không đốt tới trần 30 lượt", async () => {
    const { goiModel, vao } = modelGia((i) => ({ tool: [{ ten: "write_file", args: `${ARGS_CAT_CUT.slice(0, 5_000 + i * 100)}` }] }));
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("lap-lai");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
    expect(suKien.some((e) => e.loai === "loi" && e.ma === "THAM_SO_HONG_LAP")).toBe(true);
    // lịch sử trả về vẫn hợp lệ và sạch
    for (const m of kq.tinNhan) for (const tc of m.tool_calls ?? []) expect(tc.function.arguments).toBe("{}");
  });

  it("một lượt hợp lệ chen giữa ⇒ đếm hỏng về 0 (hai lần hỏng rời nhau không dừng vòng)", async () => {
    const kb: Luot[] = [
      { tool: [{ ten: "write_file", args: ARGS_CAT_CUT.slice(0, 900) }] },
      { tool: [{ ten: "write_file", args: ARGS_CAT_CUT.slice(0, 1900) }] },
      { tool: [{ ten: "read_file", args: '{"path":"a.ts"}' }] },
      { tool: [{ ten: "write_file", args: ARGS_CAT_CUT.slice(0, 2900) }] },
      { tool: [{ ten: "write_file", args: ARGS_CAT_CUT.slice(0, 3900) }] },
      { chu: "ok" },
    ];
    const { goiModel } = modelGia((i) => kb[i]);
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(1);
  });
});

/**
 * ★★★ Lượt bị CẮT ở trần token (`finish_reason:"length"`) mà CÓ tool call. Tham số có thể DỞ dù trông hợp lệ — vd JSON
 * đủ ngoặc (bộ phân giải của llama.cpp tự đóng) nhưng `content` của write_file bị cụt giữa chừng. Trước bản vá máy chủ
 * đổi `length` thành `tool_calls` ⇒ lõi không biết, thực thi ⇒ ghi tệp CỤT xuống đĩa.
 */
describe("★★★ lượt bị cắt ở trần token (biCat) có tool call — KHÔNG thực thi", () => {
  /** JSON hợp lệ, đủ ngoặc — nhưng nội dung tệp bị cụt giữa một hàm. */
  const ARGS_HOP_LE_MA_CUT = JSON.stringify({ path: "src/vanBan.mjs", content: "export function boDau(s) {\n  return s.normal" });

  it("write_file tham số HỢP LỆ trong lượt bị cắt ⇒ bộ thực thi KHÔNG được gọi; quan sát nói bị cắt + chia nhỏ; vòng tiếp tục", async () => {
    const { goiModel, vao } = modelGia((i) =>
      i === 0 ? { tool: [{ ten: "write_file", args: ARGS_HOP_LE_MA_CUT }], biCat: true } : { chu: "Đã xong." },
    );
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(goi).toHaveLength(0); // KHÔNG ghi tệp cụt
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao).toHaveLength(2);
    const tool = vao[1].find((m) => m.role === "tool")!;
    expect(tool.tool_call_id).toBe("call_0_0");
    expect(tool.content).toMatch(/cut off|truncated/i);
    expect(tool.content).toMatch(/output token limit/i);
    expect(tool.content).toMatch(/nothing was executed/i);
    expect(tool.content).toMatch(/write_file/);
    expect(tool.content).toMatch(/edit_file/);
    // UI thấy kết quả lỗi có mã riêng
    expect(suKien.some((e) => e.loai === "ket-qua-tool" && e.ok === false && e.ma === "LUOT_BI_CAT")).toBe(true);
    // lịch sử vẫn hợp lệ: assistant.tool_calls đi kèm đủ tin tool cùng id
    const asst = vao[1].find((m) => m.role === "assistant" && m.tool_calls?.length)!;
    expect(asst.tool_calls![0].id).toBe("call_0_0");
  });

  it("nhiều tool call trong lượt bị cắt (kể cả read_file vô hại) ⇒ KHÔNG cái nào chạy, mỗi cái một tin tool", async () => {
    const { goiModel, vao } = modelGia((i) =>
      i === 0
        ? { tool: [{ ten: "read_file", args: '{"path":"a.ts"}' }, { ten: "write_file", args: ARGS_HOP_LE_MA_CUT }], biCat: true }
        : { chu: "ok" },
    );
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(goi).toHaveLength(0);
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(vao[1].filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["call_0_0", "call_0_1"]);
  });

  it("bị cắt 3 lượt liên tiếp ⇒ dừng lap-lai (THAM_SO_HONG_LAP), không đốt tới trần lượt", async () => {
    const { goiModel, vao } = modelGia((i) => ({
      tool: [{ ten: "write_file", args: JSON.stringify({ path: `a${i}.ts`, content: "x".repeat(10 + i) }) }],
      biCat: true,
    }));
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("lap-lai");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
    expect(suKien.some((e) => e.loai === "loi" && e.ma === "THAM_SO_HONG_LAP")).toBe(true);
  });

  it("lượt KHÔNG bị cắt với cùng tham số ⇒ chạy bình thường (không chặn oan)", async () => {
    const { goiModel } = modelGia((i) => (i === 0 ? { tool: [{ ten: "write_file", args: ARGS_HOP_LE_MA_CUT }] } : { chu: "ok" }));
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(goi).toHaveLength(1);
  });

  // ★ (2026-10-19) ĐỔI hành vi: trước đây `hoan-thanh` với chữ cụt (3/36 bài trượt bộ ngẫu nhiên) — nay chưa xong,
  //   nhắc tối đa 2 lần rồi `het-token` (chi tiết: vongAgent.tienTrinh.test.ts).
  it("lượt bị cắt KHÔNG có tool call ⇒ KHÔNG hoan-thanh; chữ cụt không thành hành động", async () => {
    const { goiModel, vao } = modelGia(() => ({ chu: "Câu trả lời dài bị cụt", biCat: true }));
    const { bo, goi } = boThucThiGia();
    const kq = await chay(goiModel, bo).p;
    expect(kq.lyDo).toBe("het-token");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
  });

  it("xen kẽ cắt CÓ tool call và cắt KHÔNG tool call 3 lượt liền ⇒ vẫn dừng lap-lai (chuỗi hỏng chung)", async () => {
    const { goiModel, vao } = modelGia((i) =>
      i === 1 ? { chu: "cụt", biCat: true } : { tool: [{ ten: "write_file", args: ARGS_HOP_LE_MA_CUT }], biCat: true },
    );
    const { bo, goi } = boThucThiGia();
    const { p, suKien } = chay(goiModel, bo);
    const kq = await p;
    expect(kq.lyDo).toBe("lap-lai");
    expect(vao).toHaveLength(3);
    expect(goi).toHaveLength(0);
    expect(suKien.some((e) => e.loai === "loi" && e.ma === "THAM_SO_HONG_LAP")).toBe(true);
  });
});

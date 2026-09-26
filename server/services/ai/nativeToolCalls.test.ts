/**
 * G2-B — lưới cho `nativeToolCalls.ts`, module LÁ của đường tool-calling GỐC.
 *
 * ⚠ VÌ SAO LƯỚI NÀY TỒN TẠI RIÊNG: mọi thứ ở đây là phép biến đổi THUẦN trên hình dạng dây
 * (wire shape) đã ĐO ĐƯỢC trên `llama-server` b9814 đang chạy (`:8091`). Chúng được tách khỏi
 * gateway để đột biến bắt được: một `return []` chen vào bất kỳ hàm nào dưới đây phải làm ĐỎ,
 * chứ không phải "gateway vẫn trả 200 với `tool_calls` rỗng" — đúng lớp lỗi mà `_core/llm.ts`
 * đã sống chung suốt (`tool_calls: []` là HẰNG SỐ).
 */
import { describe, it, expect } from "vitest";
import {
  chuanHoaTools,
  chuanHoaToolChoice,
  LoiToolCallKhongHopLe,
  LoiToolChoiceKhongCuongCheDuoc,
  BoGomToolCallLuong,
  gomToolCallTuVanBan,
  docToolCallTuMessage,
  toolCallHopLe,
  MO_TA_HANH_VI_TOOL_CHOICE,
  timGioiHanGrammar,
  veSchemaAnToanChoGrammar,
  TRAN_MAXLENGTH_GRAMMAR,
} from "./nativeToolCalls";

// ─────────────────────────────────────────────────────────────────────────────
// 1. chuanHoaTools — cổng vào. Rác KHÔNG được đi tiếp dưới lốt một mảng rỗng.
// ─────────────────────────────────────────────────────────────────────────────
describe("chuanHoaTools", () => {
  it("trả undefined khi caller KHÔNG gửi tools (phân biệt với 'gửi mảng rỗng')", () => {
    expect(chuanHoaTools(undefined)).toBeUndefined();
    expect(chuanHoaTools(null)).toBeUndefined();
  });

  it("mảng RỖNG là undefined — không có tool nào thì không được bật nhánh tool", () => {
    expect(chuanHoaTools([])).toBeUndefined();
  });

  it("chấp nhận một tool hợp lệ và giữ NGUYÊN parameters", () => {
    const out = chuanHoaTools([
      {
        type: "function",
        function: {
          name: "get_machine_oee",
          description: "lấy OEE",
          parameters: { type: "object", properties: { machineId: { type: "string" } } },
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].function.name).toBe("get_machine_oee");
    expect(out![0].function.parameters).toEqual({
      type: "object",
      properties: { machineId: { type: "string" } },
    });
  });

  it("NÉM khi `tools` không phải mảng", () => {
    expect(() => chuanHoaTools({ type: "function" })).toThrow(LoiToolCallKhongHopLe);
  });

  it("NÉM khi thiếu function.name — KHÔNG bỏ qua im lặng phần tử hỏng", () => {
    expect(() => chuanHoaTools([{ type: "function", function: { description: "x" } }])).toThrow(
      LoiToolCallKhongHopLe,
    );
  });

  it("NÉM khi type ≠ 'function'", () => {
    expect(() => chuanHoaTools([{ type: "retrieval", function: { name: "a" } }])).toThrow(
      LoiToolCallKhongHopLe,
    );
  });

  it("NÉM khi tên tool TRÙNG nhau (model không phân biệt được hai tool cùng tên)", () => {
    expect(() =>
      chuanHoaTools([
        { type: "function", function: { name: "a" } },
        { type: "function", function: { name: "a" } },
      ]),
    ).toThrow(LoiToolCallKhongHopLe);
  });

  it("NÉM khi tên tool sai khuôn OpenAI (^[A-Za-z0-9_.-]{1,64}$)", () => {
    expect(() => chuanHoaTools([{ type: "function", function: { name: "có dấu" } }])).toThrow(
      LoiToolCallKhongHopLe,
    );
    expect(() => chuanHoaTools([{ type: "function", function: { name: "a".repeat(65) } }])).toThrow(
      LoiToolCallKhongHopLe,
    );
  });

  it("NÉM khi parameters không phải object (chat template làm `tool | tojson` trên nó)", () => {
    expect(() =>
      chuanHoaTools([{ type: "function", function: { name: "a", parameters: 123 } }]),
    ).toThrow(LoiToolCallKhongHopLe);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. chuanHoaToolChoice — ⚠ ĐO SỐNG 2026-08-17 trên b9814-487a6cc16 + template Qwen3:
//    "auto" CƯỠNG CHẾ ĐƯỢC · "none"/"required"/tên-cụ-thể thì KHÔNG.
//    Xem MO_TA_HANH_VI_TOOL_CHOICE.
// ─────────────────────────────────────────────────────────────────────────────
describe("chuanHoaToolChoice", () => {
  it("undefined/null ⇒ undefined (gateway coi như 'auto')", () => {
    expect(chuanHoaToolChoice(undefined)).toBeUndefined();
    expect(chuanHoaToolChoice(null)).toBeUndefined();
  });

  it("'auto' đi qua", () => {
    expect(chuanHoaToolChoice("auto")).toBe("auto");
  });

  it("'none' đi qua — gateway cưỡng chế nó bằng cách KHÔNG gửi tools lên server", () => {
    expect(chuanHoaToolChoice("none")).toBe("none");
  });

  it("'required' NÉM lỗi RIÊNG — engine không cưỡng chế được, và im lặng bỏ qua là nói dối", () => {
    expect(() => chuanHoaToolChoice("required")).toThrow(LoiToolChoiceKhongCuongCheDuoc);
  });

  it("tool_choice theo TÊN cũng NÉM lỗi RIÊNG (đo sống: model vẫn trả chữ thường)", () => {
    expect(() =>
      chuanHoaToolChoice({ type: "function", function: { name: "get_machine_oee" } }),
    ).toThrow(LoiToolChoiceKhongCuongCheDuoc);
  });

  it("giá trị rác NÉM lỗi ĐẦU VÀO (khác lỗi 'không cưỡng chế được')", () => {
    expect(() => chuanHoaToolChoice("banana")).toThrow(LoiToolCallKhongHopLe);
    expect(() => chuanHoaToolChoice(7)).toThrow(LoiToolCallKhongHopLe);
  });

  it("bảng mô tả hành vi khai ĐÚNG bốn dạng và cái nào cưỡng chế được", () => {
    expect(MO_TA_HANH_VI_TOOL_CHOICE.auto.cuongCheDuoc).toBe(true);
    expect(MO_TA_HANH_VI_TOOL_CHOICE.none.cuongCheDuoc).toBe(true);
    expect(MO_TA_HANH_VI_TOOL_CHOICE.required.cuongCheDuoc).toBe(false);
    expect(MO_TA_HANH_VI_TOOL_CHOICE.named.cuongCheDuoc).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BoGomToolCallLuong — gộp mảnh `delta.tool_calls` của SSE.
//    Khuôn dây ĐO SỐNG: mảnh đầu mang {index,id,type,function:{name,arguments:"{"}},
//    các mảnh sau CHỈ mang {index,function:{arguments:"…"}}.
// ─────────────────────────────────────────────────────────────────────────────
describe("BoGomToolCallLuong", () => {
  it("gộp nhiều mảnh của MỘT lượt gọi thành một tool_call hoàn chỉnh", () => {
    const bo = new BoGomToolCallLuong();
    bo.nap([{ index: 0, id: "call_1", type: "function", function: { name: "f", arguments: "{" } }]);
    bo.nap([{ index: 0, function: { arguments: '"a":' } }]);
    bo.nap([{ index: 0, function: { arguments: "1}" } }]);
    const ra = bo.ketThuc();
    expect(ra).toEqual([
      { id: "call_1", type: "function", function: { name: "f", arguments: '{"a":1}' } },
    ]);
  });

  it("giữ ĐÚNG thứ tự và tách bạch NHIỀU lượt gọi song song theo `index`", () => {
    const bo = new BoGomToolCallLuong();
    bo.nap([{ index: 1, id: "b", type: "function", function: { name: "g", arguments: "{}" } }]);
    bo.nap([{ index: 0, id: "a", type: "function", function: { name: "f", arguments: "{}" } }]);
    const ra = bo.ketThuc();
    expect(ra.map((t) => t.id)).toEqual(["a", "b"]);
    expect(ra.map((t) => t.function.name)).toEqual(["f", "g"]);
  });

  it("`coToolCall` là false TRƯỚC khi nạp mảnh nào và true ngay sau mảnh đầu", () => {
    const bo = new BoGomToolCallLuong();
    expect(bo.coToolCall).toBe(false);
    bo.nap([{ index: 0, id: "x", type: "function", function: { name: "f", arguments: "{}" } }]);
    expect(bo.coToolCall).toBe(true);
  });

  it("bỏ qua mảnh méo (không có index) mà KHÔNG làm hỏng lượt còn lại", () => {
    const bo = new BoGomToolCallLuong();
    bo.nap([{ function: { arguments: "rác" } } as any]);
    bo.nap([{ index: 0, id: "x", type: "function", function: { name: "f", arguments: "{}" } }]);
    expect(bo.ketThuc()).toHaveLength(1);
  });

  it("sinh id thay thế khi server KHÔNG khai id (vòng đời cần tool_call_id để khớp)", () => {
    const bo = new BoGomToolCallLuong();
    bo.nap([{ index: 0, type: "function", function: { name: "f", arguments: "{}" } }]);
    const ra = bo.ketThuc();
    expect(ra[0].id).toMatch(/^call_/);
    expect(ra[0].id.length).toBeGreaterThan(6);
  });

  it("KHÔNG trả lượt gọi thiếu tên — một tool_call vô danh là rác, không phải kết quả", () => {
    const bo = new BoGomToolCallLuong();
    bo.nap([{ index: 0, id: "x", type: "function", function: { arguments: "{}" } }]);
    expect(bo.ketThuc()).toEqual([]);
  });

  it("ketThuc() trên bộ gom TRỐNG trả mảng rỗng — và `coToolCall` vẫn false", () => {
    const bo = new BoGomToolCallLuong();
    expect(bo.ketThuc()).toEqual([]);
    expect(bo.coToolCall).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. gomToolCallTuVanBan — bộ VỚT. Cùng model + cùng server, khi bộ phân giải
//    phía server KHÔNG chạy (build cũ, hoặc `tool_choice:"none"` — đo sống: server
//    vẫn nhét tools vào prompt, chỉ TẮT bộ phân giải) thì `<tool_call>…</tool_call>`
//    NGUYÊN VĂN rơi vào `content` và đi thẳng ra màn hình người dùng.
// ─────────────────────────────────────────────────────────────────────────────
describe("gomToolCallTuVanBan", () => {
  it("vớt một khối <tool_call> và LẤY NÓ RA khỏi chữ hiển thị", () => {
    const raw = 'Để tôi tra.\n<tool_call>\n{"name": "f", "arguments": {"a": 1}}\n</tool_call>';
    const ra = gomToolCallTuVanBan(raw);
    expect(ra.toolCalls).toHaveLength(1);
    expect(ra.toolCalls[0].function.name).toBe("f");
    expect(JSON.parse(ra.toolCalls[0].function.arguments)).toEqual({ a: 1 });
    expect(ra.vanBan).toBe("Để tôi tra.");
    expect(ra.vanBan).not.toContain("tool_call");
  });

  it("vớt NHIỀU khối", () => {
    const raw =
      '<tool_call>{"name":"f","arguments":{}}</tool_call><tool_call>{"name":"g","arguments":{}}</tool_call>';
    const ra = gomToolCallTuVanBan(raw);
    expect(ra.toolCalls.map((t) => t.function.name)).toEqual(["f", "g"]);
    expect(ra.vanBan).toBe("");
  });

  it("chữ KHÔNG có khối nào ⇒ trả NGUYÊN VĂN và mảng rỗng", () => {
    const ra = gomToolCallTuVanBan("chỉ là câu trả lời bình thường");
    expect(ra.vanBan).toBe("chỉ là câu trả lời bình thường");
    expect(ra.toolCalls).toEqual([]);
  });

  it("khối JSON HỎNG bị BỎ QUA nhưng chữ vẫn được dọn — không đẩy rác ra người dùng", () => {
    const ra = gomToolCallTuVanBan("<tool_call>{không phải json}</tool_call>xong");
    expect(ra.toolCalls).toEqual([]);
    expect(ra.vanBan).toBe("xong");
  });

  it("`arguments` dạng CHUỖI (một số build) được giữ nguyên chuỗi", () => {
    const ra = gomToolCallTuVanBan('<tool_call>{"name":"f","arguments":"{\\"a\\":2}"}</tool_call>');
    expect(JSON.parse(ra.toolCalls[0].function.arguments)).toEqual({ a: 2 });
  });

  it("khối thiếu `name` KHÔNG sinh ra tool_call", () => {
    const ra = gomToolCallTuVanBan('<tool_call>{"arguments":{}}</tool_call>');
    expect(ra.toolCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. docToolCallTuMessage — đọc `message.tool_calls` của đáp ứng KHÔNG-stream.
// ─────────────────────────────────────────────────────────────────────────────
describe("docToolCallTuMessage", () => {
  it("đọc đúng khuôn ĐO SỐNG của b9814 (arguments là CHUỖI)", () => {
    const ra = docToolCallTuMessage({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          type: "function",
          function: { name: "get_machine_oee", arguments: '{"machineId": "AOI-01"}' },
          id: "xdCz0uVG",
        },
      ],
    });
    expect(ra).toHaveLength(1);
    expect(ra[0]).toEqual({
      id: "xdCz0uVG",
      type: "function",
      function: { name: "get_machine_oee", arguments: '{"machineId": "AOI-01"}' },
    });
  });

  it("message KHÔNG có tool_calls ⇒ mảng rỗng (không phải undefined)", () => {
    expect(docToolCallTuMessage({ role: "assistant", content: "xin chào" })).toEqual([]);
  });

  it("`arguments` dạng OBJECT được đóng gói lại thành CHUỖI JSON (hợp đồng OpenAI)", () => {
    const ra = docToolCallTuMessage({
      tool_calls: [{ id: "a", type: "function", function: { name: "f", arguments: { x: 1 } } }],
    });
    expect(typeof ra[0].function.arguments).toBe("string");
    expect(JSON.parse(ra[0].function.arguments)).toEqual({ x: 1 });
  });

  it("`arguments` VẮNG ⇒ '{}' chứ không phải undefined", () => {
    const ra = docToolCallTuMessage({ tool_calls: [{ id: "a", function: { name: "f" } }] });
    expect(ra[0].function.arguments).toBe("{}");
  });

  it("phần tử thiếu tên bị loại, phần tử hợp lệ cùng mảng vẫn giữ", () => {
    const ra = docToolCallTuMessage({
      tool_calls: [{ id: "a", function: {} }, { id: "b", function: { name: "f" } }],
    });
    expect(ra.map((t) => t.id)).toEqual(["b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Giới hạn bộ sinh grammar — ĐO NHỊ PHÂN SỐNG trên b9814 (:8091, 2026-08-17).
//    Một tool lỗi ⇒ HTTP 400 cho CẢ yêu cầu, và câu lỗi gốc KHÔNG nói tool nào.
// ─────────────────────────────────────────────────────────────────────────────
describe("timGioiHanGrammar", () => {
  const T = (params: unknown) => [{ type: "function" as const, function: { name: "t", parameters: params as any } }];

  it("schema sạch ⇒ mảng rỗng", () => {
    expect(timGioiHanGrammar(T({ type: "object", properties: { a: { type: "string", maxLength: 500 } } }))).toEqual([]);
  });

  it("maxLength 1999 CHẠY (đúng ranh giới đo được)", () => {
    expect(timGioiHanGrammar(T({ type: "object", properties: { a: { type: "string", maxLength: 1999 } } }))).toEqual([]);
  });

  it("maxLength 2000 HỎNG — và câu lỗi nêu ĐÍCH DANH tool + đường + giá trị", () => {
    const loi = timGioiHanGrammar(T({ type: "object", properties: { a: { type: "string", maxLength: 2000 } } }));
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("t:");
    expect(loi[0]).toContain("2000");
  });

  it("bắt được ở schema LỒNG NHAU (không chỉ tầng một)", () => {
    const loi = timGioiHanGrammar(
      T({ type: "object", properties: { a: { type: "object", properties: { b: { type: "string", maxLength: 99999 } } } } }),
    );
    expect(loi).toHaveLength(1);
  });

  it("pattern có neo, không dấu \\\\ ⇒ ĐI ĐƯỢC", () => {
    expect(timGioiHanGrammar(T({ type: "object", properties: { a: { pattern: "^[A-Za-z0-9_-]+$" } } }))).toEqual([]);
  });

  it("pattern có \\\\ thoát ⇒ HỎNG (đo sống: '^[A-Za-z0-9_\\\\-]+$' trả 400)", () => {
    expect(timGioiHanGrammar(T({ type: "object", properties: { a: { pattern: "^[A-Za-z0-9_\\-]+$" } } }))).toHaveLength(1);
  });

  it("pattern KHÔNG neo ⇒ HỎNG (đo sống: '[a-z]+' trả 400)", () => {
    expect(timGioiHanGrammar(T({ type: "object", properties: { a: { pattern: "[a-z]+" } } }))).toHaveLength(1);
  });

  it("tools rỗng/undefined ⇒ mảng rỗng", () => {
    expect(timGioiHanGrammar(undefined)).toEqual([]);
    expect(timGioiHanGrammar([])).toEqual([]);
  });
});

describe("veSchemaAnToanChoGrammar", () => {
  it("kẹp maxLength về trần và BỎ pattern không an toàn", () => {
    const ra = veSchemaAnToanChoGrammar({
      type: "object",
      properties: { a: { type: "string", maxLength: 1_000_000, pattern: "^\\d+$" }, b: { type: "string", maxLength: 10 } },
    }) as any;
    expect(ra.properties.a.maxLength).toBe(TRAN_MAXLENGTH_GRAMMAR);
    expect(ra.properties.a).not.toHaveProperty("pattern");
    expect(ra.properties.b.maxLength).toBe(10);
  });

  it("GIỮ pattern an toàn", () => {
    const ra = veSchemaAnToanChoGrammar({ properties: { a: { pattern: "^[A-Z]+$" } } }) as any;
    expect(ra.properties.a.pattern).toBe("^[A-Z]+$");
  });

  it("đầu ra của nó LUÔN qua được timGioiHanGrammar (bất biến khép kín)", () => {
    const ban = {
      type: "object",
      properties: {
        a: { type: "string", maxLength: 200000, pattern: "[a-z]+" },
        b: { type: "array", items: { type: "string", maxLength: 5000 } },
      },
    };
    const sach = veSchemaAnToanChoGrammar(ban);
    expect(timGioiHanGrammar([{ type: "function", function: { name: "t", parameters: sach as any } }])).toEqual([]);
    // và KHÔNG đụng vào bản gốc
    expect((ban.properties.a as any).maxLength).toBe(200000);
  });
});

describe("toolCallHopLe", () => {
  it("đúng khuôn ⇒ true", () => {
    expect(toolCallHopLe({ id: "a", type: "function", function: { name: "f", arguments: "{}" } })).toBe(true);
  });
  it("thiếu tên ⇒ false", () => {
    expect(toolCallHopLe({ id: "a", type: "function", function: { arguments: "{}" } })).toBe(false);
  });
  it("arguments không phải chuỗi ⇒ false", () => {
    expect(toolCallHopLe({ id: "a", type: "function", function: { name: "f", arguments: {} } })).toBe(false);
  });
});

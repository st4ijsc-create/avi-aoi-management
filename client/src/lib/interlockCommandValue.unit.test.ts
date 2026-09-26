/**
 * Fix round 2 (doc 80 Task 2, coordinator re-review) — the round 1 fix closed the
 * OBJECT-corruption case but NOT the finding as a whole: a stored string "1"/"true"
 * still silently became the number 1 / boolean true on ANY edit (even a pure
 * rename), because `commandValueOrNull` always re-guessed the type from raw text.
 * `server/services/interlock/interlockEngine.ts:284` sends that value straight to
 * `dispatch()` — a wrong type is a wrong command payload.
 *
 * Design (controller direction):
 *   1. Preserve-if-untouched — `resolveCommandValueForSubmit` returns the ORIGINAL
 *      raw value byte-for-byte whenever `currentText === initialText`, regardless
 *      of `selectedType`. A rename (or any unrelated edit) can NEVER alter the
 *      command payload — this is a passthrough, not a re-parse.
 *   2. Explicit type when the operator DOES edit the field — `parseCommandValueByType`
 *      parses strictly per an explicit selector (text/number/boolean/json), so
 *      there is no more auto-detection ambiguity.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ nhánh preserve-if-untouched trong
 * `resolveCommandValueForSubmit` (luôn parse theo `selectedType`) ⇒ các ca dưới
 * dùng `selectedType: "text"` CỐ Ý SAI (khác kiểu gốc) phải ĐỎ — vì lúc đó hàm
 * không còn "trả lại y nguyên bất kể selectedType" mà lại lệ thuộc đúng vào nó.
 */
import { describe, it, expect } from "vitest";
import {
  serializeCommandValueForEdit,
  inferCommandValueType,
  parseCommandValueByType,
  resolveCommandValueForSubmit,
  CommandValueParseError,
  type CommandValueType,
} from "./interlockCommandValue";

describe("inferCommandValueType — khởi tạo bộ chọn Kiểu giá trị từ giá trị đã lưu", () => {
  it.each([
    ["1", "text"],
    ["true", "text"],
    ["STOP_LINE", "text"],
    [1, "number"],
    [true, "boolean"],
    [{ a: 1 }, "json"],
    [[1, 2], "json"],
    [null, "text"],
  ] as Array<[unknown, CommandValueType]>)("inferCommandValueType(%j) === %s", (v, expected) => {
    expect(inferCommandValueType(v)).toBe(expected);
  });
});

describe("★★★ Fix round 2 — KHÔNG sửa ô commandValue ⇒ gửi lại giá trị GỐC y nguyên, BẤT KỂ selectedType", () => {
  // `selectedType: "text"` CỐ Ý dùng cho MỌI ca (kể cả khi giá trị gốc là số/bool/
  // object) để chứng minh preserve-if-untouched KHÔNG lệ thuộc vào bộ chọn kiểu
  // khi text chưa đổi — đây chính là bất biến "rename không bao giờ đổi payload".
  const WRONG_TYPE: CommandValueType = "text";

  const cases: Array<{ label: string; raw: unknown }> = [
    { label: 'chuỗi "1"', raw: "1" },
    { label: 'chuỗi "true"', raw: "true" },
    { label: 'chuỗi "STOP_LINE"', raw: "STOP_LINE" },
    { label: "number 1", raw: 1 },
    { label: "boolean true", raw: true },
    { label: "object", raw: { targetSpeedPct: 40, reason: "giảm tốc" } },
    { label: "null", raw: null },
  ];

  for (const { label, raw } of cases) {
    it(`${label} — text không đổi ⇒ y nguyên (typeof + giá trị)`, () => {
      const initialText = serializeCommandValueForEdit(raw);
      const result = resolveCommandValueForSubmit({
        actionIsAlert: false,
        currentText: initialText, // người dùng KHÔNG đụng vào ô này
        initialText,
        initialRaw: raw,
        selectedType: WRONG_TYPE,
      });
      expect(result).toStrictEqual(raw);
      expect(typeof result).toBe(typeof raw);
    });
  }

  it("cũng đúng khi selectedType KHỚP kiểu gốc (kịch bản UI bình thường qua inferCommandValueType)", () => {
    const raw = { a: 1 };
    const initialText = serializeCommandValueForEdit(raw);
    const result = resolveCommandValueForSubmit({
      actionIsAlert: false,
      currentText: initialText,
      initialText,
      initialRaw: raw,
      selectedType: inferCommandValueType(raw),
    });
    expect(result).toStrictEqual(raw);
  });
});

describe("Fix round 2 — action='alert' luôn gửi null, kể cả khi text đã đổi", () => {
  it("action alert ⇒ null bất kể currentText/initialText", () => {
    const result = resolveCommandValueForSubmit({
      actionIsAlert: true,
      currentText: "42",
      initialText: "1",
      initialRaw: 1,
      selectedType: "number",
    });
    expect(result).toBeNull();
  });
});

describe("Fix round 2 — sửa ô (text KHÁC initial) ⇒ parse NGHIÊM NGẶT theo Kiểu đã chọn", () => {
  it("type=number, text='55' ⇒ number 55", () => {
    const r = resolveCommandValueForSubmit({
      actionIsAlert: false, currentText: "55", initialText: "42", initialRaw: 42, selectedType: "number",
    });
    expect(r).toBe(55);
    expect(typeof r).toBe("number");
  });

  it("type=boolean, text='false' ⇒ boolean false", () => {
    const r = resolveCommandValueForSubmit({
      actionIsAlert: false, currentText: "false", initialText: "true", initialRaw: true, selectedType: "boolean",
    });
    expect(r).toBe(false);
  });

  it("type=json, text='{\"a\":2}' ⇒ object {a:2}", () => {
    const r = resolveCommandValueForSubmit({
      actionIsAlert: false, currentText: '{"a":2}', initialText: "", initialRaw: null, selectedType: "json",
    });
    expect(r).toEqual({ a: 2 });
  });

  it("type=text, text='1' ⇒ CHUỖI \"1\" (không tự suy diễn thành số — đây là điểm khác round 1)", () => {
    const r = resolveCommandValueForSubmit({
      actionIsAlert: false, currentText: "1", initialText: "0", initialRaw: 0, selectedType: "text",
    });
    expect(r).toBe("1");
    expect(typeof r).toBe("string");
  });

  it("text đổi thành RỖNG (bất kỳ type) ⇒ null", () => {
    const r = resolveCommandValueForSubmit({
      actionIsAlert: false, currentText: "   ", initialText: "abc", initialRaw: "abc", selectedType: "json",
    });
    expect(r).toBeNull();
  });
});

describe("Fix round 2 — nhập sai với Kiểu đã chọn ⇒ ném CommandValueParseError (không âm thầm nhận sai)", () => {
  it("type=number, text='abc' ⇒ invalid_number", () => {
    expect(() => parseCommandValueByType("abc", "number")).toThrow(CommandValueParseError);
    try {
      parseCommandValueByType("abc", "number");
      throw new Error("khong nem loi");
    } catch (e) {
      expect((e as CommandValueParseError).code).toBe("invalid_number");
    }
  });

  it("type=boolean, text='yes' ⇒ invalid_boolean", () => {
    expect(() => parseCommandValueByType("yes", "boolean")).toThrow(CommandValueParseError);
    try {
      parseCommandValueByType("yes", "boolean");
    } catch (e) {
      expect((e as CommandValueParseError).code).toBe("invalid_boolean");
    }
  });

  it("type=json, text='{invalid' ⇒ invalid_json", () => {
    expect(() => parseCommandValueByType("{invalid", "json")).toThrow(CommandValueParseError);
    try {
      parseCommandValueByType("{invalid", "json");
    } catch (e) {
      expect((e as CommandValueParseError).code).toBe("invalid_json");
    }
  });

  it("resolveCommandValueForSubmit cũng ném lỗi khi text đã đổi và parse thất bại (không âm thầm gửi rác)", () => {
    expect(() =>
      resolveCommandValueForSubmit({
        actionIsAlert: false, currentText: "abc", initialText: "1", initialRaw: 1, selectedType: "number",
      }),
    ).toThrow(CommandValueParseError);
  });
});

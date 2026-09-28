/**
 * doc 81 Đợt 1D Task 1 — `matchPinnedStop` / `validateStopValue` (THUẦN, không I-O).
 *
 * Oracle độc lập: mọi giá trị kỳ vọng là LITERAL viết tay theo quyết định chủ dự án (doc 81 §8 QĐ1 +
 * plan Đợt 1D Task 1): một lệnh DỪNG chỉ được miễn preflight an toàn khi nó ghi ĐÚNG các cặp
 * (tagKey, giá trị) đã ghim; giá trị trả về là GIÁ TRỊ GHIM, không bao giờ là giá trị người gọi gửi.
 */
import { describe, it, expect } from "vitest";
import { loadStopPins, matchPinnedStop, validateStopValue, type StopPin, type StopPinDb } from "./stopPin";

const PINS: StopPin[] = [
  { tagKey: "stop_cmd", value: true },
  { tagKey: "run_speed", value: 0 },
  { tagKey: "mode", value: "STOP" },
];

describe("matchPinnedStop", () => {
  it("ghi đúng cặp đã ghim ⇒ ok, trả GIÁ TRỊ GHIM", () => {
    const r = matchPinnedStop(PINS, [{ tagKey: "stop_cmd", value: true }]);
    expect(r).toEqual({ ok: true, writes: [{ tagKey: "stop_cmd", value: true }] });
  });

  it("một tập con nhiều tag ghim (mỗi ghi khớp ghim của chính nó) ⇒ ok", () => {
    const r = matchPinnedStop(PINS, [
      { tagKey: "run_speed", value: 0 },
      { tagKey: "mode", value: "STOP" },
    ]);
    expect(r).toEqual({ ok: true, writes: [{ tagKey: "run_speed", value: 0 }, { tagKey: "mode", value: "STOP" }] });
  });

  it("thêm một tag KHÔNG ghim ⇒ unpinned_tag", () => {
    const r = matchPinnedStop(PINS, [
      { tagKey: "stop_cmd", value: true },
      { tagKey: "start_cmd", value: true },
    ]);
    expect(r).toEqual({ ok: false, reason: "unpinned_tag" });
  });

  it("đúng tag ghim nhưng giá trị khác ⇒ value_mismatch", () => {
    expect(matchPinnedStop(PINS, [{ tagKey: "stop_cmd", value: false }])).toEqual({ ok: false, reason: "value_mismatch" });
    expect(matchPinnedStop(PINS, [{ tagKey: "run_speed", value: 1500 }])).toEqual({ ok: false, reason: "value_mismatch" });
    expect(matchPinnedStop(PINS, [{ tagKey: "mode", value: "RUN" }])).toEqual({ ok: false, reason: "value_mismatch" });
  });

  it("writes rỗng ⇒ empty_writes", () => {
    expect(matchPinnedStop(PINS, [])).toEqual({ ok: false, reason: "empty_writes" });
  });

  it("không có ghim nào ⇒ no_pins", () => {
    expect(matchPinnedStop([], [{ tagKey: "stop_cmd", value: true }])).toEqual({ ok: false, reason: "no_pins" });
  });

  it("cùng một tag hai lần ⇒ duplicate_tag (kể cả hai lần đều đúng giá trị ghim)", () => {
    const r = matchPinnedStop(PINS, [
      { tagKey: "stop_cmd", value: true },
      { tagKey: "stop_cmd", value: true },
    ]);
    expect(r).toEqual({ ok: false, reason: "duplicate_tag" });
  });

  it("ghim bool `true`, người gọi gửi `1` trên tag bool ⇒ ok, trả `true` (giá trị ghim)", () => {
    const r = matchPinnedStop(PINS, [{ tagKey: "stop_cmd", value: 1 }]);
    expect(r).toEqual({ ok: true, writes: [{ tagKey: "stop_cmd", value: true }] });
    if (r.ok) expect(r.writes[0].value).toBe(true); // KHÔNG phải số 1 của người gọi
  });

  it("ghim bool `true`: `0`, `2`, \"1\", \"true\" đều ⇒ value_mismatch", () => {
    for (const v of [0, 2, "1", "true", null, undefined]) {
      expect(matchPinnedStop(PINS, [{ tagKey: "stop_cmd", value: v }]), String(v)).toEqual({ ok: false, reason: "value_mismatch" });
    }
  });

  it("ghim float `0`, người gọi gửi \"0\" ⇒ value_mismatch (so khớp chặt ngoài bool)", () => {
    expect(matchPinnedStop(PINS, [{ tagKey: "run_speed", value: "0" }])).toEqual({ ok: false, reason: "value_mismatch" });
    expect(matchPinnedStop(PINS, [{ tagKey: "run_speed", value: false }])).toEqual({ ok: false, reason: "value_mismatch" });
  });

  it("ghim số `1` (tag int) — người gọi gửi `true` ⇒ value_mismatch (1 ≡ true CHỈ với tag bool)", () => {
    const pins: StopPin[] = [{ tagKey: "brake", value: 1 }];
    expect(matchPinnedStop(pins, [{ tagKey: "brake", value: true }])).toEqual({ ok: false, reason: "value_mismatch" });
    expect(matchPinnedStop(pins, [{ tagKey: "brake", value: 1 }])).toEqual({ ok: true, writes: [{ tagKey: "brake", value: 1 }] });
  });

  it("tagKey khác hoa/thường hoặc có khoảng trắng ⇒ unpinned_tag (khớp CHÍNH XÁC như dispatcher tra tag)", () => {
    expect(matchPinnedStop(PINS, [{ tagKey: "STOP_CMD", value: true }])).toEqual({ ok: false, reason: "unpinned_tag" });
    expect(matchPinnedStop(PINS, [{ tagKey: " stop_cmd", value: true }])).toEqual({ ok: false, reason: "unpinned_tag" });
  });

  it("writes trả về là đối tượng MỚI mang giá trị ghim — sửa kết quả không đổi được ghim", () => {
    const pins: StopPin[] = [{ tagKey: "mode", value: "STOP" }];
    const r = matchPinnedStop(pins, [{ tagKey: "mode", value: "STOP" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      (r.writes[0] as { value: unknown }).value = "RUN";
      expect(pins[0].value).toBe("STOP");
    }
  });
});

describe("validateStopValue", () => {
  it("bool: true/false; 1/0 chuẩn hoá thành boolean", () => {
    expect(validateStopValue("bool", true)).toEqual({ ok: true, value: true });
    expect(validateStopValue("bool", false)).toEqual({ ok: true, value: false });
    expect(validateStopValue("bool", 1)).toEqual({ ok: true, value: true });
    expect(validateStopValue("bool", 0)).toEqual({ ok: true, value: false });
  });

  it("bool: \"true\", 2, null ⇒ không hợp lệ", () => {
    for (const v of ["true", "1", 2, null, undefined, {}]) {
      expect(validateStopValue("bool", v).ok, String(v)).toBe(false);
    }
  });

  it("int: số nguyên hữu hạn; 1.5, \"1\", true, NaN ⇒ không hợp lệ", () => {
    expect(validateStopValue("int", 0)).toEqual({ ok: true, value: 0 });
    expect(validateStopValue("int", -3)).toEqual({ ok: true, value: -3 });
    for (const v of [1.5, "1", true, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(validateStopValue("int", v).ok, String(v)).toBe(false);
    }
  });

  it("float: số hữu hạn; \"0\", true, NaN, Infinity ⇒ không hợp lệ", () => {
    expect(validateStopValue("float", 0)).toEqual({ ok: true, value: 0 });
    expect(validateStopValue("float", 12.5)).toEqual({ ok: true, value: 12.5 });
    for (const v of ["0", true, Number.NaN, Number.NEGATIVE_INFINITY, null]) {
      expect(validateStopValue("float", v).ok, String(v)).toBe(false);
    }
  });

  it("string: chuỗi (≤ 255 ký tự); số / bool ⇒ không hợp lệ", () => {
    expect(validateStopValue("string", "STOP")).toEqual({ ok: true, value: "STOP" });
    expect(validateStopValue("string", 0).ok).toBe(false);
    expect(validateStopValue("string", true).ok).toBe(false);
    expect(validateStopValue("string", "x".repeat(256)).ok).toBe(false);
  });

  it("json / kiểu lạ ⇒ không hợp lệ (giá trị DỪNG phải là vô hướng có kiểu rõ)", () => {
    expect(validateStopValue("json", { a: 1 }).ok).toBe(false);
    expect(validateStopValue("json", "x").ok).toBe(false);
    expect(validateStopValue("double", 1).ok).toBe(false);
  });
});

describe("loadStopPins — lớp lọc ở JS (độc lập với mệnh đề WHERE)", () => {
  it("db trả cả hàng tắt / không ghi được / chưa ghim / ghim lệch kiểu ⇒ chỉ ghim hợp lệ lọt qua", async () => {
    // db giả BỎ QUA điều kiện SQL (trả mọi hàng) ⇒ đo đúng lớp lọc JS — lớp an toàn khi WHERE bị sửa sai.
    const rows = [
      { tagKey: "a_ok", dataType: "bool", stopValue: true, writable: true, isEnabled: true },
      { tagKey: "b_off", dataType: "bool", stopValue: true, writable: true, isEnabled: false },
      { tagKey: "c_ro", dataType: "bool", stopValue: true, writable: false, isEnabled: true },
      { tagKey: "d_null", dataType: "bool", stopValue: null, writable: true, isEnabled: true },
      { tagKey: "e_lech", dataType: "int", stopValue: 1.5, writable: true, isEnabled: true },
      { tagKey: "f_json", dataType: "json", stopValue: "x", writable: true, isEnabled: true },
      { tagKey: "g_bool01", dataType: "bool", stopValue: 0, writable: true, isEnabled: true },
    ];
    const fake = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) } as unknown as StopPinDb;
    expect(await loadStopPins(fake, 1)).toEqual([
      { tagKey: "a_ok", value: true },
      { tagKey: "g_bool01", value: false },
    ]);
  });
});

/**
 * doc 81 Đợt 4 Task D1 — danh sách trắng `shared/uiPrefs.ts`. Oracle: khoá do CHÍNH `userLayoutKey` (client) sinh ra —
 * regex phải nhận đúng định dạng đó, không rộng hơn.
 */
import { describe, it, expect } from "vitest";
import { checkUiPrefsPatch, uiPrefKeyKind, UI_PREFS_MAX_BYTES, UI_PREF_PANEL_PX_MAX, SHOW_LABS_LAYOUT_ID, SHOW_LABS_PART } from "./uiPrefs";
import { userLayoutKey } from "../client/src/components/patterns/layoutKitHooks";

describe("shared/uiPrefs — danh sách trắng", () => {
  it("khoá bố cục do userLayoutKey sinh ra (các layoutId thật) được nhận, đúng layoutId/userId/part", () => {
    for (const id of ["engineering", "ir-editor", "pou-studio", "orchestration-studio", "recipes", "interlock-rules", "eq-standards-types"]) {
      for (const part of ["hpx", "vpx", "bottomCollapsed"] as const) {
        const k = userLayoutKey(id, 42, part)!;
        expect(uiPrefKeyKind(k)).toEqual({ kind: "layout", layoutId: id, userId: "42", part });
      }
    }
  });

  it("khoá cục bộ của Labs, part `split`, khoá không có người dùng, id 0 ⇒ KHÔNG thuộc danh sách", () => {
    expect(uiPrefKeyKind(userLayoutKey(SHOW_LABS_LAYOUT_ID, 42, SHOW_LABS_PART)!)).toBeNull();
    expect(uiPrefKeyKind(userLayoutKey("ide", 42, "split")!)).toBeNull();
    expect(uiPrefKeyKind("layoutKit:ide:u:hpx")).toBeNull();
    expect(uiPrefKeyKind("layoutKit:ide:u0:hpx")).toBeNull();
    expect(uiPrefKeyKind("layoutKit:ide:u42:hpx:x")).toBeNull();
    expect(uiPrefKeyKind(" showLabs")).toBeNull();
    expect(uiPrefKeyKind(`layoutKit:${"a".repeat(65)}:u42:hpx`)).toBeNull();
  });

  it("bản vá hợp lệ ⇒ ok, giữ nguyên giá trị", () => {
    const patch = {
      showLabs: false,
      "layoutKit:ide:u7:hpx": { left: { px: 0, pct: 0 }, right: { px: UI_PREF_PANEL_PX_MAX, pct: 100 } },
      "layoutKit:ide:u7:vpx": { bottom: { px: 200, pct: 25.5 } },
      "layoutKit:ide:u7:bottomCollapsed": true,
    };
    expect(checkUiPrefsPatch(patch, 7)).toEqual({ ok: true, value: patch });
    expect(checkUiPrefsPatch({}, 7)).toEqual({ ok: true, value: {} });
  });

  it.each([
    ["không phải object", [1], null, "notObject"],
    ["null", null, null, "notObject"],
    ["khoá lạ", { theme: "dark" }, "theme", "unknownKey"],
    ["khoá của người khác", { "layoutKit:ide:u8:hpx": {} }, "layoutKit:ide:u8:hpx", "otherUser"],
    ["showLabs số", { showLabs: 1 }, "showLabs", "badValue"],
    ["px NaN-ish chuỗi", { "layoutKit:ide:u7:hpx": { left: { px: "1", pct: 1 } } }, "layoutKit:ide:u7:hpx", "badValue"],
    ["px vô cực", { "layoutKit:ide:u7:hpx": { left: { px: Infinity, pct: 1 } } }, "layoutKit:ide:u7:hpx", "badValue"],
    ["px > trần", { "layoutKit:ide:u7:hpx": { left: { px: UI_PREF_PANEL_PX_MAX + 1, pct: 1 } } }, "layoutKit:ide:u7:hpx", "badValue"],
    ["pct âm", { "layoutKit:ide:u7:vpx": { bottom: { px: 1, pct: -0.1 } } }, "layoutKit:ide:u7:vpx", "badValue"],
    ["thiếu pct", { "layoutKit:ide:u7:vpx": { bottom: { px: 1 } } }, "layoutKit:ide:u7:vpx", "badValue"],
    ["vpx mang left", { "layoutKit:ide:u7:vpx": { left: { px: 1, pct: 1 } } }, "layoutKit:ide:u7:vpx", "badValue"],
    ["hpx là mảng", { "layoutKit:ide:u7:hpx": [] }, "layoutKit:ide:u7:hpx", "badValue"],
    ["bottomCollapsed null", { "layoutKit:ide:u7:bottomCollapsed": null }, "layoutKit:ide:u7:bottomCollapsed", "badValue"],
  ])("từ chối: %s", (_ten, patch, key, reason) => {
    expect(checkUiPrefsPatch(patch, 7)).toEqual({ ok: false, key, reason });
  });

  it(`bản vá > ${UI_PREFS_MAX_BYTES} byte ⇒ tooLarge`, () => {
    const patch: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) patch[`layoutKit:l${i}:u7:hpx`] = { left: { px: 260, pct: 20 }, right: { px: 380, pct: 25 } };
    expect(checkUiPrefsPatch(patch, 7)).toEqual({ ok: false, key: null, reason: "tooLarge" });
  });
});

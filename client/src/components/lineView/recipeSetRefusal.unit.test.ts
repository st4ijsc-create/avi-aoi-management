/**
 * doc 81 Đợt 1C Task 2 — câu hiển thị mục recipe set bị cổng chặt từ chối (vi/en/zh).
 * Oracle = câu gõ tay theo đúng văn bản đã duyệt trong locale (không lấy từ chính hàm).
 * i18next THẬT + bundle THẬT, giống errorCodes.lazyLocale.unit.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import "../../i18n";
import i18n from "i18next";
import { describeRecipeSetItemRefusal, type RecipeSetItemResultView } from "./recipeSetRefusal";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const superseded: RecipeSetItemResultView = {
  machineId: 3,
  machineCode: "AOI-03",
  recipeCode: "PASTE-01",
  recipeVersion: 1,
  status: "failed",
  error: "Recipe #30 (PASTE-01 v1) is archived — create a new version instead of promoting an archived one.",
  reason: "recipeArchived",
  hint: "updateSetToCurrentVersion",
  currentVersion: 3,
};

beforeAll(() => {
  for (const l of ["vi", "en", "zh"]) {
    i18n.addResourceBundle(l, "translation", localeJson(`../../i18n/locales/${l}.json`), true, true);
  }
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

describe("describeRecipeSetItemRefusal", () => {
  it("vi — lý do dịch từ errors.reason.recipeArchived + gợi ý cập nhật sang v3", async () => {
    await i18n.changeLanguage("vi");
    expect(describeRecipeSetItemRefusal(superseded)).toEqual({
      text: "AOI-03 · PASTE-01 v1: bị từ chối — Phiên bản công thức này đã lưu trữ — hãy tạo phiên bản mới thay vì đưa bản đã lưu trữ vào chạy.",
      hint: "Phiên bản ghim trong set đã bị thay — hãy cập nhật set sang phiên bản hiện hành v3.",
    });
  });

  it("en — same item in English, no Vietnamese leaks", async () => {
    await i18n.changeLanguage("en");
    expect(describeRecipeSetItemRefusal(superseded)).toEqual({
      text: "AOI-03 · PASTE-01 v1: refused — This recipe version is archived — create a new version instead of putting an archived one into production.",
      hint: "The version pinned in the set has been replaced — update the set to the current version v3.",
    });
  });

  it("zh — same item in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(describeRecipeSetItemRefusal(superseded)).toEqual({
      text: "AOI-03 · PASTE-01 v1：被拒绝——此配方版本已归档——请创建新版本，而不是将已归档版本投入生产。",
      hint: "集合中固定的版本已被替换——请将集合更新为当前版本 v3。",
    });
  });

  it("sai loại máy ⇒ lý do riêng, KHÔNG gợi ý đổi phiên bản; mục không bị từ chối ⇒ null", async () => {
    await i18n.changeLanguage("en");
    const r = describeRecipeSetItemRefusal({
      ...superseded,
      machineCode: null,
      reason: "recipeMachineTypeMismatch",
      hint: undefined,
      currentVersion: undefined,
    });
    expect(r).toEqual({
      text: "#3 · PASTE-01 v1: refused — This recipe is for a different machine type than the target machine — it cannot be deployed there.",
      hint: null,
    });
    expect(describeRecipeSetItemRefusal({ ...superseded, status: "deployed" })).toBeNull();
    expect(describeRecipeSetItemRefusal({ ...superseded, status: "already_active" })).toBeNull();
  });

  it("lỗi ngoài cổng (không reason) ⇒ dùng nguyên error của server", async () => {
    await i18n.changeLanguage("en");
    const r = describeRecipeSetItemRefusal({ ...superseded, reason: undefined, hint: undefined, currentVersion: undefined, error: "connection reset" });
    expect(r).toEqual({ text: "AOI-03 · PASTE-01 v1: refused — connection reset", hint: null });
  });
});

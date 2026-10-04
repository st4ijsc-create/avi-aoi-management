/**
 * Doc 81 Đợt 2 Task 3 — mọi khoá `layoutKit.*` mà bộ layout dùng chung gọi qua `t()` phải có ở CẢ
 * vi/en/zh (plan Global Constraint 5). Đếm bằng cách đọc mã nguồn các tệp của bộ layout (không
 * dựng component), nên một khoá mới quên thêm vào locale sẽ đỏ ở đây — kể cả khi chuỗi dự phòng
 * tiếng Anh trong `t(key, fallback)` che mất nó trên giao diện.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vi from "../../i18n/locales/vi.json";
import en from "../../i18n/locales/en.json";
import zh from "../../i18n/locales/zh.json";

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "patterns/PageHeaderCompact.tsx",
  "patterns/NoticeChip.tsx",
  "patterns/StatusChipStrip.tsx",
  "patterns/FlyoutHost.tsx",
  "patterns/UnsavedChangesConfirm.tsx",
  "patterns/DetailSheet.tsx",
  "patterns/WizardDialog.tsx",
  "patterns/JsonDiffView.tsx",
  "patterns/VersionHistoryPanel.tsx",
  "patterns/RollbackConfirm.tsx",
  "patterns/ApprovalQueue.tsx",
  "patterns/SplitListDetail.tsx",
  "patterns/CockpitLayout.tsx",
  "patterns/WorkbenchShell.tsx",
  "engineering/shell/EngineeringShell.tsx",
];

function lookup(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function keysIn(src: string): string[] {
  return [...src.matchAll(/["'](layoutKit\.[A-Za-z0-9_.]+)["']/g)].map((m) => m[1]);
}

describe("layoutKit i18n — đủ vi/en/zh", () => {
  const all = new Set<string>();
  for (const f of FILES) for (const k of keysIn(fs.readFileSync(path.join(ROOT, f), "utf8"))) all.add(k);

  it("đọc được khoá từ mã nguồn (thước không rỗng)", () => {
    expect(all.size).toBeGreaterThan(60);
  });

  for (const [lng, dict] of [["vi", vi], ["en", en], ["zh", zh]] as const) {
    it(`mọi khoá có chuỗi không rỗng trong ${lng}.json`, () => {
      const missing = [...all].filter((k) => {
        const v = lookup(dict, k);
        return typeof v !== "string" || v.trim() === "";
      });
      expect(missing).toEqual([]);
    });
  }

  it("ba ngôn ngữ có CÙNG tập khoá layoutKit (không lệch)", () => {
    const flat = (o: unknown, p = ""): string[] =>
      o && typeof o === "object"
        ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k))
        : [p];
    const v = flat(lookup(vi, "layoutKit")).sort();
    expect(flat(lookup(en, "layoutKit")).sort()).toEqual(v);
    expect(flat(lookup(zh, "layoutKit")).sort()).toEqual(v);
  });
});

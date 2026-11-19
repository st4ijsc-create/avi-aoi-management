/**
 * Lớp che RIÊNG của cheDuLieu (`RE_KHOA_THEM`) — đo khi `aiSafety.redactSecretsAndPII` bị vô hiệu.
 *
 * Vì sao tệp riêng (lô mauBiMat, 2026-11-14): trong `cheVanBan`, `RE_KHOA_THEM` chạy NGAY TRƯỚC `redactSecretsAndPII`, mà
 * hai lớp dùng cùng nguồn mẫu Anthropic (`shared/mauBiMat.ts`), cùng chỗ thay `[REDACTED_SECRET]`, cùng loại `api_key`.
 * Đột biến "trả biên trái cho mẫu Anthropic trong cheDuLieu" vì vậy SỐNG ở mọi test đầu-cuối (đầu ra y hệt) — lớp này chỉ
 * có ích khi aiSafety đổi/hỏng. Tệp này ghim lớp ấy độc lập: `vi.mock` áp cả tệp nên không gộp vào `cheDuLieu.test.ts`.
 * Khoá trong tệp là GIẢ.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const goiAiSafety = vi.hoisted(() => ({ n: 0 }));
vi.mock("../aiSafety", () => ({
  redactSecretsAndPII: (text: string) => {
    goiAiSafety.n += 1;
    return { text, redactions: [] };
  },
}));

import { cheChuoi } from "./cheDuLieu";

const LOI = "Kq7Zx2Wm9Rt4_Lp-".repeat(6);
const KHOA_API = `sk-ant-api03-${LOI}`;
const KHOA_ADMIN = `sk-ant-admin01-${LOI}`;

beforeEach(() => {
  goiAiSafety.n = 0;
});

describe("cheDuLieu — lớp RE_KHOA_THEM tự che khoá Anthropic khi aiSafety không che gì", () => {
  it.each([
    ["trần", `dau ${KHOA_API} cuoi`, "dau [REDACTED_SECRET] cuoi"],
    ["quản trị", `dau ${KHOA_ADMIN} cuoi`, "dau [REDACTED_SECRET] cuoi"],
    ["dính chữ thường", `dau e${KHOA_API} cuoi`, "dau e[REDACTED_SECRET] cuoi"],
    ["dính sau task-", `dau task-${KHOA_API} cuoi`, "dau task-[REDACTED_SECRET] cuoi"],
    ["dính số", `dau 9${KHOA_API} cuoi`, "dau 9[REDACTED_SECRET] cuoi"],
  ])("%s", (_nhan, vao, ra) => {
    const r = cheChuoi(vao);
    expect(goiAiSafety.n).toBeGreaterThanOrEqual(1); // mock thật sự thay aiSafety
    expect(r.giaTri).toBe(ra);
    expect(r.theoLoai).toEqual({ api_key: 1 });
  });

  it("dính chữ trong JSON ⇒ lõi không còn, đếm api_key 1", () => {
    const r = cheChuoi(`{"x":"abc${KHOA_API}"}`);
    expect(r.giaTri).not.toContain(LOI.slice(0, 16));
    expect(r.giaTri).toContain("abc[REDACTED_SECRET]");
    expect(r.theoLoai.api_key).toBe(1);
  });

  it("ca âm: tên tự nhiên gần tiền tố và sk- trần không bị lớp này che", () => {
    for (const s of ["task-admin-dashboard-settings-2026-11-14", "desk-proj-booking-calendar-floor-3-west", "task-v9-probe-abcdefghijklmnop", "sk-"]) {
      expect(cheChuoi(s).giaTri).toBe(s);
    }
  });
});

/**
 * ★★★ 2026-09-01 · ĐỢT C — LƯỚI CHO **MIỄN-TRỪ-HẸP THEO BĂM** của hàng rào tệp-bẩn (`soBamHITL`).
 *
 * Lỗi đã đo trên UI thật (PDCA): lượt `apply_diff` THỨ HAI vào cùng tệp luôn chết `FILE_DIRTY` vì
 * chính lượt thứ nhất làm tệp git-bẩn — vòng *ghi→test→sửa tiếp*, sửa-tay-liên-tiếp và Hoàn tác
 * đều nghẽn ở lượt 2. Bản vá: miễn trừ CHỈ khi băm đĩa ≡ băm lượt HITL trước vừa ghi vào sổ.
 *
 * BA RANH GIỚI phải đo (trên repo git THẬT dựng tạm — cùng lý do với `applyDiff.census.test.ts`):
 *   §1 DƯƠNG: ghi HITL #1 (tệp sạch) → tệp bẩn-vì-HITL → ghi HITL #2 PHẢI ĐI (đột biến gỡ sổ ⇒ ĐỎ);
 *   §2 ÂM-then-chốt: NGƯỜI sửa tay chen giữa ⇒ băm lệch sổ ⇒ `FILE_DIRTY` y như trước — sự cố
 *      2026-08-18 (mất 123 dòng chưa commit) vẫn bị chặn NGUYÊN hàng rào;
 *   §3 ÂM: tệp bẩn mà sổ RỖNG (chưa từng ghi HITL trong tiến trình) ⇒ `FILE_DIRTY` — tức ca §B của
 *      census cũ không hề được nới (chống-vá-quá-tay).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const proposeActionMock = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  proposeAction: (...a: unknown[]) => proposeActionMock(...a),
}));

import "./index"; // đăng ký tool (side-effect)
import { listTools, type Tool } from "./toolRegistry";
import { xoaSoNganSach } from "./repoSandbox";
import { _xoaSoBamHITL } from "./writeHandlers/applyDiff";

const CTX = { user: { id: 7, role: "engineer", name: "T" }, lang: "vi" as const };

let REPO = "";
function git(...args: string[]): string {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
}
function ghiCommit(rel: string, noiDung: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", `add ${rel}`);
}
function docDia(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}
function tool(): Tool<any, any> {
  return listTools().find((t) => t.name === "apply_diff")!;
}

beforeAll(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mien-hitl-"));
  REPO = fs.realpathSync(tmp);
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  ghiCommit("src/chuoi.ts", "export const V = 1;\n");
  ghiCommit("src/nguoi-chen.ts", "export const N = 1;\n");
  ghiCommit("src/so-rong.ts", "export const R = 1;\n");
});

afterAll(() => {
  delete process.env.AI_REPO_SANDBOX_ROOT;
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

beforeEach(() => {
  proposeActionMock.mockReset();
  xoaSoNganSach();
  _xoaSoBamHITL();
  process.env.AI_REPO_SANDBOX_ROOT = REPO;
});

describe("§1 DƯƠNG — chuỗi HITL liên tiếp trên CÙNG tệp phải đi trọn", () => {
  it("★★★ ghi #1 (sạch) OK → tệp bẩn-vì-HITL → ghi #2 OK → đĩa đúng bản #2 (gỡ sổ ⇒ ĐỎ ngay đây)", async () => {
    const v1 = docDia("src/chuoi.ts");
    const v2 = v1 + "export const V2 = 2;\n";
    const v3 = v2 + "export const V3 = 3;\n";

    const r1 = await tool().execute!({ path: "src/chuoi.ts", original: v1, modified: v2 } as never, CTX as never);
    expect(r1.note, `ghi #1 phải đi: ${r1.textSummary}`).toBeUndefined();
    expect(docDia("src/chuoi.ts")).toBe(v2);

    // Tệp giờ git-BẨN (thay đổi chưa commit là sản phẩm của lượt HITL #1).
    const r2 = await tool().execute!({ path: "src/chuoi.ts", original: v2, modified: v3 } as never, CTX as never);
    expect(r2.note, `ghi #2 phải được MIỄN-TRỪ-HẸP (băm đĩa ≡ sổ): ${r2.textSummary}`).toBeUndefined();
    expect(docDia("src/chuoi.ts")).toBe(v3);

    git("checkout", "--", "src/chuoi.ts");
  });
});

describe("§2 ÂM then chốt — NGƯỜI chen một byte giữa hai lượt ⇒ hàng rào ĐÓNG lại", () => {
  it("★★★ HITL #1 OK → người sửa tay → HITL #2 (original = bản người sửa) ⇒ FILE_DIRTY, đĩa nguyên vẹn", async () => {
    const v1 = docDia("src/nguoi-chen.ts");
    const v2 = v1 + "export const N2 = 2;\n";
    const r1 = await tool().execute!({ path: "src/nguoi-chen.ts", original: v1, modified: v2 } as never, CTX as never);
    expect(r1.note).toBeUndefined();

    // NGƯỜI chen: sửa tay một dòng chưa commit — đây đúng là 123-dòng của sự cố 2026-08-18.
    const cuaNguoi = v2 + "// cong-viec-cua-nguoi chua commit\n";
    fs.writeFileSync(path.join(REPO, "src/nguoi-chen.ts"), cuaNguoi);

    // Tác nhân đọc lại tệp (original = bản MỚI NHẤT — nên KHÔNG phải BASE_MISMATCH) rồi đề xuất.
    const r2 = await tool().execute!(
      { path: "src/nguoi-chen.ts", original: cuaNguoi, modified: cuaNguoi + "export const N3 = 3;\n" } as never,
      CTX as never,
    );
    expect(r2.note, "băm đĩa ≠ sổ HITL ⇒ độ bẩn KHÔNG thuần-HITL ⇒ phải TỪ CHỐI").toBe("FILE_DIRTY");
    expect(docDia("src/nguoi-chen.ts"), "đĩa phải NGUYÊN VẸN").toBe(cuaNguoi);

    git("checkout", "--", "src/nguoi-chen.ts");
  });
});

describe("§3 ÂM — sổ rỗng (chưa từng ghi HITL) ⇒ luật cũ giữ nguyên từng chữ", () => {
  it("★★★ tệp bẩn thuần-tay + sổ rỗng ⇒ FILE_DIRTY (ca §B của census cũ KHÔNG bị nới)", async () => {
    const goc = docDia("src/so-rong.ts");
    const ban = goc + "// sua tay\n";
    fs.writeFileSync(path.join(REPO, "src/so-rong.ts"), ban);

    const r = await tool().execute!({ path: "src/so-rong.ts", original: ban, modified: ban + "// them\n" } as never, CTX as never);
    expect(r.note).toBe("FILE_DIRTY");
    expect(docDia("src/so-rong.ts")).toBe(ban);

    git("checkout", "--", "src/so-rong.ts");
  });
});

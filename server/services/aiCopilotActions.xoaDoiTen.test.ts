/**
 * ★★★ Đợt 1 · T2 (2026-10-14) — `delete_file` / `rename_file` đi qua ĐƯỜNG DUYỆT THẬT:
 * `proposeAction` (preview + hàng `ai_pending_actions` + audit PROPOSED) → `confirmAction` (RBAC lại,
 * args ĐỌC TỪ CSDL, `execute()` chạy lại mọi hàng rào) — khuôn `aiCopilotActions.tuChoiGhi.test.ts`.
 *
 * CSDL THẬT (vitest.setup ép DATABASE_URL sang bản `_test`), repo git THẬT, người dùng THẬT; không model.
 * Bất biến đo ở đây:
 *   1. propose KHÔNG chạm đĩa; confirm mới xoá/dời — và cột `status` nói đúng sự thật ('executed').
 *   2. tệp bị người sửa giữa propose và confirm ⇒ 'bi_tu_choi_ghi', tệp NGUYÊN VẸN (TOCTOU tại confirm).
 *   3. gốc dự án của lượt propose được dùng lại ở confirm (`__projectRoot` trong previewJson).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

import { proposeAction, confirmAction } from "./aiCopilotActions";
import { deleteFileTool, renameFileTool } from "./aiLocalTools/writeHandlers/xoaDoiTenTep";
import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { createLocalUser } from "../db/auth";

let REPO = "";
let uid = 0;

function git(...a: string[]): string {
  return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
}
function ghiCommit(rel: string, noiDung: string): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("commit", "-q", "-m", `add ${rel}`);
}
const co = (rel: string) => fs.existsSync(path.join(REPO, rel));
const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su xoa doi ten" });
const CTX = () => ({ user: NGUOI(), lang: "vi" as const, projectRoot: REPO });

async function docHang(id: string) {
  const db = await getDb();
  const [hang] = await db!.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return hang;
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "xoa-doi-ten-duyet-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  ghiCommit("src/se-xoa.ts", "export const XOA = 1;\n");
  ghiCommit("src/se-doi.ts", "export const DOI = 1;\n");
  ghiCommit("src/bi-sua-giua.ts", "export const GIUA = 1;\n");

  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `t2-xoa-doi-ten-${Date.now()}`,
    passwordHash: await bcrypt.hash("Mk-xoa-doi-ten!1", 10),
    name: "Ky su xoa doi ten",
    role: "admin",
  });
  uid = kq.id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (db && uid > 0) {
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  try {
    if (REPO) fs.rmSync(REPO, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}, 60_000);

describe("delete_file — propose → confirm thật", () => {
  it("★★★ propose KHÔNG xoá; confirm xoá; status 'executed'; kết quả chỉ mang BĂM", async () => {
    const r = await proposeAction(deleteFileTool as never, { path: "src/se-xoa.ts" }, CTX());
    expect(r.ok, r.message ?? "propose phải xanh").toBe(true);
    expect(co("src/se-xoa.ts"), "propose KHÔNG được chạm đĩa").toBe(true);
    const id = r.pendingAction!.actionId;
    const hang = await docHang(id);
    expect(hang?.status).toBe("proposed");
    expect((hang?.previewJson as Record<string, unknown>).__projectRoot).toBe(REPO);

    const kq = await confirmAction(id, id, NGUOI(), "vi");
    expect(kq.status, JSON.stringify(kq.result)).toBe("executed");
    expect(co("src/se-xoa.ts")).toBe(false);
    const data = (kq.result as { data: Record<string, unknown> }).data;
    expect(data.bamTruoc).toBe(bam("export const XOA = 1;\n"));
    expect(JSON.stringify(kq.result)).not.toContain("export const XOA");
    expect((await docHang(id))?.status).toBe("executed");
    git("checkout", "--", "src/se-xoa.ts");
  }, 60_000);

  it("★★★ người sửa tay GIỮA propose và confirm ⇒ 'bi_tu_choi_ghi', tệp NGUYÊN VẸN", async () => {
    const r = await proposeAction(deleteFileTool as never, { path: "src/bi-sua-giua.ts" }, CTX());
    expect(r.ok, r.message ?? "").toBe(true);
    const id = r.pendingAction!.actionId;
    const ban = "export const GIUA = 1;\n// cong viec chua commit\n";
    fs.writeFileSync(path.join(REPO, "src/bi-sua-giua.ts"), ban);

    const kq = await confirmAction(id, id, NGUOI(), "vi");
    expect((kq.result as { note?: string }).note).toBe("FILE_DIRTY");
    expect(kq.status).toBe("bi_tu_choi_ghi");
    expect(fs.readFileSync(path.join(REPO, "src/bi-sua-giua.ts"), "utf8")).toBe(ban);
    git("checkout", "--", "src/bi-sua-giua.ts");
  }, 60_000);
});

describe("rename_file — propose → confirm thật", () => {
  it("★★★ propose KHÔNG dời; confirm dời đúng nội dung; status 'executed'", async () => {
    const r = await proposeAction(renameFileTool as never, { from: "src/se-doi.ts", to: "src/moi/da-doi.ts" }, CTX());
    expect(r.ok, r.message ?? "").toBe(true);
    expect(co("src/se-doi.ts")).toBe(true);
    expect(co("src/moi/da-doi.ts")).toBe(false);
    const id = r.pendingAction!.actionId;

    const kq = await confirmAction(id, id, NGUOI(), "vi");
    expect(kq.status, JSON.stringify(kq.result)).toBe("executed");
    expect(co("src/se-doi.ts")).toBe(false);
    expect(fs.readFileSync(path.join(REPO, "src/moi/da-doi.ts"), "utf8")).toBe("export const DOI = 1;\n");
    const data = (kq.result as { data: Record<string, unknown> }).data;
    expect(data.thayDoi).toEqual([
      { duong: "src/moi/da-doi.ts", loai: "doi-ten", tuDuong: "src/se-doi.ts", bamSau: bam("export const DOI = 1;\n") },
    ]);
  }, 60_000);

  it("★★★ đích bị ai đó tạo GIỮA propose và confirm ⇒ 'bi_tu_choi_ghi' DEST_EXISTS, không ghi đè", async () => {
    ghiCommit("src/nguon-2.ts", "export const N2 = 1;\n");
    const r = await proposeAction(renameFileTool as never, { from: "src/nguon-2.ts", to: "src/dich-2.ts" }, CTX());
    expect(r.ok, r.message ?? "").toBe(true);
    const id = r.pendingAction!.actionId;
    fs.writeFileSync(path.join(REPO, "src/dich-2.ts"), "cua nguoi\n");

    const kq = await confirmAction(id, id, NGUOI(), "vi");
    expect((kq.result as { note?: string }).note).toBe("DEST_EXISTS");
    expect(kq.status).toBe("bi_tu_choi_ghi");
    expect(fs.readFileSync(path.join(REPO, "src/dich-2.ts"), "utf8")).toBe("cua nguoi\n");
    expect(co("src/nguon-2.ts")).toBe(true);
  }, 60_000);
});

/**
 * ★★★ ĐỢT B · TASK 6 (2026-08-29) — **CỘT `status` NÓI DỐI: TỪ CHỐI GHI VẪN ĐƯỢC DÁN NHÃN `executed`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỆNH ĐÃ GHI HAI LẦN Ở REPO NÀY — ĐÂY LÀ LẦN THỨ BA, VÀ LÀ Ở GỐC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `shared/aiCodingLoop.ts:325-360` và `server/services/aiCodingCli/cli.ts:284-301` đã kể: khi băm
 * neo lệch (`BASE_MISMATCH`) hoặc tệp bẩn (`FILE_DIRTY`), `apply_diff.execute()` TỪ CHỐI GHI đúng
 * như thiết kế và trả một `ToolResult` mang `note`. Nhưng `confirmAction` (file này lưới) vẫn đặt
 * `status='executed'` VÔ ĐIỀU KIỆN sau `tool.execute()` — bất kể `note` có mặt hay không. CLI và
 * web đã phải tự đoán lại sự thật bằng `daBiTuChoiGhi()` vì KHÔNG tin được cột `status`. Lưới này
 * đo đúng GỐC RỄ: cột `status` trong CSDL, không phải một trong các nơi phải tự đoán lại nó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ LƯỚI VÒNG-THẬT (khuôn `aiCopilotActions.chonKhoi.test.ts`), KHÔNG PHẢI MOCK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mệnh đề trung tâm là VỀ CỘT `status` TRONG CSDL — một CSDL giả tự thoả đúng câu hỏi nó được hỏi.
 * Nên: CSDL THẬT (vitest.setup ép DATABASE_URL sang bản `_test`), REPO GIT THẬT (băm TOCTOU của
 * `applyDiff` neo vào byte thật trên đĩa), NGƯỜI DÙNG THẬT. Không gọi model — propose/confirm của
 * `apply_diff` không cần model.
 * ⚠ `sandbox-projects/**` là ĐỀ THI — file này không chạm nó.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";

import { proposeAction, confirmAction } from "./aiCopilotActions";
import { applyDiffTool } from "./aiLocalTools/writeHandlers/applyDiff";
import { getDb } from "../db/connection";
import { aiPendingActions } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";
import { createLocalUser } from "../db/auth";

let REPO = "";
let uid = 0;
const R_TEP = "src/tu_choi_ghi.ts";
const GOC = "const A = 1;\n";
/** Bản `original` mà đề xuất MANG THEO — cố tình khớp đĩa LÚC PROPOSE, lệch đĩa LÚC CONFIRM. */
const MODIFIED = "const A = 2;\n";
/** Ai đó COMMIT một bản KHÁC lên đĩa sau propose — băm(đĩa) ≠ băm(original) ⇒ BASE_MISMATCH.
 *  ⚠ COMMIT (không phải để dở dang) để cây làm việc SẠCH: cô lập đúng BASE_MISMATCH, không lẫn
 *  với hàng rào TỆP BẨN (FILE_DIRTY) — hai lớp lỗi khác nhau, không được trộn trong MỘT ca. */
const DA_DOI_DUOI_CHAN = "const A = 999; // ai do sua duoi chan\n";

function git(...a: string[]): string {
  return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
}
function docDia(): string {
  return fs.readFileSync(path.join(REPO, R_TEP), "utf8");
}

const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su tu choi ghi" });
const CTX = () => ({ user: NGUOI(), lang: "vi" as const, projectRoot: REPO });

async function docHang(id: string) {
  const db = await getDb();
  const [hang] = await db!.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return hang;
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tu-choi-ghi-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // ⚠ Windows core.autocrlf=true làm băm lệch vì kiểu xuống dòng, không vì nội dung.
  git("config", "core.autocrlf", "false");
  const abs = path.join(REPO, R_TEP);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, GOC);
  git("add", "--", R_TEP);
  git("commit", "-q", "-m", "goc");

  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `dotb-tu-choi-ghi-${Date.now()}`,
    passwordHash: await bcrypt.hash("Mk-tu-choi-ghi!1", 10),
    name: "Ky su tu choi ghi",
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

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — apply_diff TỪ CHỐI GHI (BASE_MISMATCH) ⇒ status KHÔNG được là 'executed'", () => {
  it("★★★ execute() trả note='BASE_MISMATCH', 0 byte đổi ⇒ ConfirmResult.status VÀ hàng CSDL PHẢI khác 'executed'", async () => {
    // Propose khi đĩa == GOC (khớp `original`).
    const r = await proposeAction(applyDiffTool as never, { path: R_TEP, original: GOC, modified: MODIFIED }, CTX());
    expect(r.ok, r.message ?? "propose phải xanh").toBe(true);
    const id = r.pendingAction!.actionId;

    // Ai đó COMMIT một bản khác lên đĩa GIỮA propose và confirm — băm neo lệch, cây làm việc sạch.
    fs.writeFileSync(path.join(REPO, R_TEP), DA_DOI_DUOI_CHAN);
    git("add", "--", R_TEP);
    git("commit", "-q", "-m", "ai do sua duoi chan");

    const kq = await confirmAction(id, id, NGUOI(), "vi");

    // Bằng chứng TỪ CHỐI GHI: đúng quy ước máy-đọc-được của cả nhóm tool.
    const result = kq.result as { note?: string } | null;
    expect(result?.note, "phải là một lượt TỪ CHỐI GHI thật, không phải lỗi khác").toBe("BASE_MISMATCH");

    // ĐĨA KHÔNG ĐỔI MỘT BYTE — bằng chứng độc lập rằng đây thật sự là "không ghi", không phải suy diễn.
    expect(docDia()).toBe(DA_DOI_DUOI_CHAN);

    // ★★★ MỆNH ĐỀ TRUNG TÂM — đây là chỗ PHẢI ĐỎ trên mã cũ (mã cũ trả cứng "executed").
    expect(kq.status, "ConfirmResult.status không được nói 'đã thực thi' cho một lượt 0 byte vào đĩa").not.toBe("executed");
    const hang = await docHang(id);
    expect(hang?.status, "hàng CSDL không được nói 'đã thực thi' cho một lượt 0 byte vào đĩa").not.toBe("executed");

    // Giá trị THẬT phải là trạng thái mới (đo cụ thể, không chỉ "khác executed" — tránh lưới xanh giả
    // vì một mã lỗi vu vơ khác).
    expect(kq.status).toBe("bi_tu_choi_ghi");
    expect(hang?.status).toBe("bi_tu_choi_ghi");
  }, 60_000);

  it("★★ confirm-lại (idempotent) sau khi đã bị từ chối ⇒ vẫn trả 'bi_tu_choi_ghi' từ cache, KHÔNG chạy execute() lần hai", async () => {
    const r = await proposeAction(applyDiffTool as never, { path: R_TEP, original: DA_DOI_DUOI_CHAN, modified: MODIFIED }, CTX());
    expect(r.ok, r.message ?? "").toBe(true);
    const id = r.pendingAction!.actionId;

    fs.writeFileSync(path.join(REPO, R_TEP), "const A = 12345; // lech lan nua\n");
    git("add", "--", R_TEP);
    git("commit", "-q", "-m", "lech lan nua");

    const lan1 = await confirmAction(id, id, NGUOI(), "vi");
    expect(lan1.status).toBe("bi_tu_choi_ghi");

    // Đánh dấu đĩa BẰNG TAY — nếu confirm-lại chạy execute() lần hai, dấu này biến mất.
    const DAU = "const A = 12345; // lech lan nua\n// dau-tay\n";
    fs.writeFileSync(path.join(REPO, R_TEP), DAU);

    const lan2 = await confirmAction(id, id, NGUOI(), "vi");
    expect(lan2.ok, "cache-return vẫn ok:true — 'ok' nói vòng đời HITL chạy hết chặng, không nói byte đã ghi").toBe(true);
    expect(lan2.status).toBe("bi_tu_choi_ghi");
    expect(docDia(), "không một byte nào được ghi thêm ở lượt cache-return").toBe(DAU);
  }, 60_000);
});

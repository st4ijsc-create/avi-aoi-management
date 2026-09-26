/**
 * ★★★ ĐỢT 3 (2026-08-23) — **DUYỆT THEO KHỐI THẬT: byte trên đĩa = `projectHunks(đúng tập đã chọn)`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT LƯỚI VÒNG-THẬT (khuôn `cliVongThat.test.ts`), KHÔNG PHẢI MỘT LƯỚI MOCK
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mệnh đề trung tâm của đợt này là một mệnh đề VỀ ĐĨA: *"người duyệt bỏ chọn khối 2 trong 3 ⇒ byte
 * trên đĩa đúng TỪNG KÝ TỰ bằng phép chiếu của tập {1,3}"*. Một CSDL giả + một tool giả chứng minh
 * được đúng cái giả — bài học đã cắn ba lượt liên tiếp (doc 83). Nên ở đây:
 *   • **CSDL THẬT** (vitest.setup ép DATABASE_URL sang bản `_test`): `proposeAction` ghi hàng
 *     `ai_pending_actions` thật, `confirmAction` giành quyền bằng UPDATE có điều kiện thật (đúng
 *     guard đua ĐỢT 0 — §6 chứng minh nó còn sống với đường mới), audit vào `audit_logs` thật.
 *   • **REPO GIT THẬT** dựng tạm: hàng rào tệp-bẩn hỏi `git status` thật, băm TOCTOU neo byte thật.
 *   • **NGƯỜI DÙNG THẬT** tự tạo rồi xoá đúng hàng của mình.
 *   • **KHÔNG một lượt gọi model nào** — propose/confirm của `apply_diff` không cần model, nên
 *     không có gì phải chặn (không chạm llama-server :8091, không chạm card).
 * ⚠ `sandbox-projects/**` là ĐỀ THI — file này không chạm tới nó một byte nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN ĐÃ CHẠY TRÊN LƯỚI NÀY (xem báo cáo đợt) — mỗi mệnh đề dưới đây phải ĐỎ ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (a) server BỎ xác thực chỉ số (nuốt id lạ/trùng)             ⇒ §3 ĐỎ
 *   (b) server lấy `modified` từ request thay vì CSDL             ⇒ §8 (census schema) ĐỎ
 *   (c) cho 0 khối đi qua (chiếu tập rỗng = ghi y nguyên tệp)     ⇒ §4 ĐỎ
 *   (d) bỏ điều kiện trạng thái khỏi UPDATE giành quyền           ⇒ §6 ĐỎ (2 lượt execute)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { proposeAction, confirmAction, HUNK_REJECT_REASONS } from "./aiCopilotActions";
import { applyDiffTool } from "./aiLocalTools/writeHandlers/applyDiff";
import { applyDiffBatchTool } from "./aiLocalTools/writeHandlers/applyDiffBatch";
import { xoaSoNganSach } from "./aiLocalTools/repoSandbox";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "./auditTrailService";
import { createLocalUser } from "../db/auth";
import { getDb } from "../db/connection";
import { aiPendingActions, auditLogs } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";

// ════════════════════════════════════════════════════════════════════════════════════════════════
// REPO GIT THẬT + NGƯỜI DÙNG THẬT
// ════════════════════════════════════════════════════════════════════════════════════════════════
let REPO = "";
let uid = 0;
const R_TEP = "src/ba_khoi.ts";

/**
 * ★ Ba khối thay đổi TÁCH RỜI (mỗi khối một dòng, ngăn nhau bằng dòng giữ nguyên) ⇒
 * `keHoachKhoiDuyet` cho đúng 3 khối, chỉ số 0/1/2 theo thứ tự trên xuống.
 */
const GOC = "const A = 1;\nconst giu1 = 0;\nconst B = 2;\nconst giu2 = 0;\nconst C = 3;\n";
const SUA = "const A = 10;\nconst giu1 = 0;\nconst B = 20;\nconst giu2 = 0;\nconst C = 30;\n";
/**
 * ⚠ ORACLE VIẾT TAY, không sinh từ `projectHunks` — một kỳ vọng sinh bằng chính hàm đang đo là một
 * mệnh đề TỰ THOẢ. Chọn {0, 2} (bỏ khối giữa) ⇒ A và C đổi, B giữ nguyên:
 */
const ORACLE_0_2 = "const A = 10;\nconst giu1 = 0;\nconst B = 2;\nconst giu2 = 0;\nconst C = 30;\n";
/** Chọn {1} ⇒ chỉ B đổi. */
const ORACLE_1 = "const A = 1;\nconst giu1 = 0;\nconst B = 20;\nconst giu2 = 0;\nconst C = 3;\n";

function git(...a: string[]): string {
  return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
}
function docDia(): string {
  return fs.readFileSync(path.join(REPO, R_TEP), "utf8");
}
function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su chon khoi" });
const CTX = () => ({ user: NGUOI(), lang: "vi" as const, projectRoot: REPO });

/** Tạo một đề xuất `apply_diff` THẬT (qua đúng `proposeAction` mà web/CLI/MCP dùng) rồi trả id. */
async function deXuat(modified = SUA): Promise<string> {
  const r = await proposeAction(applyDiffTool as never, { path: R_TEP, original: GOC, modified }, CTX());
  expect(r.ok, r.message ?? "propose phải xanh").toBe(true);
  expect(r.pendingAction?.actionId).toBeTruthy();
  return r.pendingAction!.actionId;
}

/** Đọc lại hàng CSDL của một action — lời khai thật, không phải giá trị trả về. */
async function docHang(id: string) {
  const db = await getDb();
  const [hang] = await db!.select().from(aiPendingActions).where(eq(aiPendingActions.id, id)).limit(1);
  return hang;
}

/** Các hàng audit EXECUTED của ĐÚNG action này (details là chuỗi JSON — parse rồi lọc theo actionId). */
async function auditExecuted(actionId: string) {
  const db = await getDb();
  const rows = await db!
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, AUDIT_ACTIONS.AI_ACTION_EXECUTED),
        eq(auditLogs.entityType, ENTITY_TYPES.AI_ACTION),
        // Lọc theo NGƯỜI của chính file này — CSDL test dùng chung, không đếm hàng của ai khác.
        eq(auditLogs.userId, uid),
      ),
    );
  return rows
    .map((r) => ({ row: r, details: JSON.parse(String(r.details ?? "{}")) as Record<string, any> }))
    .filter((x) => x.details?.metadata?.actionId === actionId);
}

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "chon-khoi-")));
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  // ⚠ Windows `core.autocrlf=true` làm băm lệch vì kiểu xuống dòng, không vì nội dung.
  git("config", "core.autocrlf", "false");
  const abs = path.join(REPO, R_TEP);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, GOC);
  git("add", "--", R_TEP);
  git("commit", "-q", "-m", "goc");

  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `dot3-chon-khoi-${Date.now()}`,
    passwordHash: await bcrypt.hash("Mk-chon-khoi!1", 10),
    name: "Ky su chon khoi",
    // ★ `admin` để `checkPermission` đi nhánh cho-qua — RBAC vẫn CHẠY THẬT hai lần; ca RBAC-từ-chối
    //   là việc của applyDiff.census/toolPermissionQuantifier, không lặp lại ở đây.
    role: "admin",
  });
  uid = kq.id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (db && uid > 0) {
    // ⚠ XOÁ CÓ GIỚI HẠN — đúng hàng của chính file này. audit_logs là WORM, để nguyên (lọc theo
    //   actionId uuid nên các ca không nhiễu nhau và không nhiễu ai).
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

beforeEach(() => {
  delete process.env.AI_AUTONOMY_ENABLED;
  delete process.env.ADVICE_CONTRACT_ENABLED;
  xoaSoNganSach();
  // Trả tệp về bản đã commit — mỗi ca bắt đầu từ một cây SẠCH (hàng rào tệp-bẩn đòi thế).
  git("checkout", "-q", "--", R_TEP);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — chọn TẬP CON {0,2} ⇒ đĩa = phép chiếu đúng TỪNG KÝ TỰ, băm/audit nói THẬT", () => {
  it("★★★ đĩa = oracle viết tay; resultJson + audit mang băm của BYTE THẬT, khai 'đã áp 2/3 khối'", async () => {
    const id = await deXuat();
    const kq = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0, 2]);

    expect(kq.ok, kq.message ?? "").toBe(true);
    expect(kq.status).toBe("executed");
    // ★ PHÉP ĐO CUỐI CÙNG: BYTE TRÊN ĐĨA — so toàn chuỗi, không so "có chứa".
    expect(docDia()).toBe(ORACLE_0_2);

    // Kết quả tool: băm SAU = băm(byte thật trên đĩa) — KHÔNG phải băm của bản áp-tất-cả.
    const data = (kq.result as { data?: Record<string, unknown> })?.data as Record<string, unknown>;
    expect(data.sha256After).toBe(sha256(ORACLE_0_2));
    expect(data.sha256After).not.toBe(sha256(SUA));
    expect(data.hunksApplied).toEqual({ selected: [0, 2], total: 3 });
    // Câu báo người đọc: nói rõ k/n.
    expect(String((kq.result as { textSummary?: string })?.textSummary)).toContain("2/3 khối");

    // Hàng CSDL: argsJson.modified = bản chiếu (đúng "args from DB"), kèm dấu server-owned.
    const hang = await docHang(id);
    expect(hang?.status).toBe("executed");
    expect((hang?.argsJson as Record<string, unknown>).modified).toBe(ORACLE_0_2);
    expect((hang?.argsJson as Record<string, unknown>).__hunksApplied).toEqual({ selected: [0, 2], total: 3 });
    // ⚠ `original` KHÔNG được đổi — nó là điểm neo TOCTOU.
    expect((hang?.argsJson as Record<string, unknown>).original).toBe(GOC);

    // Audit EXECUTED: đúng MỘT hàng, metadata khai tập chọn, và `changes.sha256After` đã được vá
    // bằng băm THẬT (không còn là băm áp-tất-cả của preview).
    const audits = await auditExecuted(id);
    expect(audits.length).toBe(1);
    expect(audits[0].details.metadata.hunksApplied).toEqual({ selected: [0, 2], total: 3 });
    const doiBam = (audits[0].details.changes as Array<{ field: string; newValue: unknown }>).find(
      (c) => c.field === "sha256After",
    );
    expect(doiBam?.newValue).toBe(sha256(ORACLE_0_2));
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — KHÔNG gửi lựa chọn ⇒ áp TẤT CẢ, hành vi cũ không đổi một byte", () => {
  it("★★★ confirm không có selectedHunkIds ⇒ đĩa = `modified` nguyên văn, không dấu __hunksApplied", async () => {
    const id = await deXuat();
    const kq = await confirmAction(id, id, NGUOI(), "vi");
    expect(kq.ok).toBe(true);
    expect(docDia()).toBe(SUA);
    const hang = await docHang(id);
    expect((hang?.argsJson as Record<string, unknown>).modified).toBe(SUA);
    expect("__hunksApplied" in (hang?.argsJson as Record<string, unknown>)).toBe(false);
    const data = (kq.result as { data?: Record<string, unknown> })?.data as Record<string, unknown>;
    expect(data.hunksApplied).toBeNull();
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — chỉ số LẠ / TRÙNG / KHÔNG NGUYÊN ⇒ từ chối CÓ MÃ, đĩa không đổi MỘT byte, thử lại được", () => {
  it("★★★ ngoài khoảng [0,7] ⇒ HUNK_IDS_INVALID; hàng vẫn `proposed`; sau đó chọn hợp lệ [1] vẫn ghi được", async () => {
    const id = await deXuat();
    const bamTruoc = sha256(docDia());

    const loi = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0, 7]);
    expect(loi.ok).toBe(false);
    expect(loi.status).toBe("invalid");
    expect(loi.reason).toBe(HUNK_REJECT_REASONS.HUNK_IDS_INVALID);
    expect(sha256(docDia()), "đĩa không được đổi một byte").toBe(bamTruoc);
    expect((await docHang(id))?.status, "hàng để nguyên proposed — người duyệt sửa lựa chọn rồi thử lại").toBe("proposed");

    // Đường thử-lại SỐNG: cùng action, tập hợp lệ ⇒ ghi đúng phép chiếu {1}.
    const ok = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [1]);
    expect(ok.ok, ok.message ?? "").toBe(true);
    expect(docDia()).toBe(ORACLE_1);
  }, 60_000);

  it("★★ trùng [1,1] và không-nguyên [0.5] ⇒ cùng mã HUNK_IDS_INVALID, đĩa nguyên vẹn", async () => {
    const id = await deXuat();
    for (const xau of [[1, 1], [0.5]]) {
      const kq = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, xau);
      expect(kq.ok, JSON.stringify(xau)).toBe(false);
      expect(kq.reason, JSON.stringify(xau)).toBe(HUNK_REJECT_REASONS.HUNK_IDS_INVALID);
    }
    expect(docDia()).toBe(GOC);
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — 0 khối ⇒ NO_HUNKS_SELECTED, KHÔNG phải 'ghi tệp không đổi'", () => {
  it("★★★ mảng rỗng ⇒ từ chối có mã; đĩa không đổi; KHÔNG có hàng audit EXECUTED nào", async () => {
    const id = await deXuat();
    const kq = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, []);
    expect(kq.ok).toBe(false);
    expect(kq.reason).toBe(HUNK_REJECT_REASONS.NO_HUNKS_SELECTED);
    expect(docDia()).toBe(GOC);
    // "Ghi y nguyên tệp" vẫn đẻ một dòng audit "đã ghi" — mệnh đề này canh đúng lời nói dối ấy.
    expect((await auditExecuted(id)).length).toBe(0);
    expect((await docHang(id))?.status).toBe("proposed");
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — confirm-lại sau khi ĐÃ ghi tập con ⇒ trả CACHE, không ghi lần hai", () => {
  it("★★★ lượt hai (kể cả với tập chọn KHÁC) trả kết quả đã lưu; vết sửa tay trên đĩa còn nguyên", async () => {
    const id = await deXuat();
    const lan1 = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0, 2]);
    expect(lan1.ok).toBe(true);
    expect(docDia()).toBe(ORACLE_0_2);

    // Đánh dấu đĩa BẰNG TAY — nếu lượt confirm-lại ghi lần nữa, dấu này biến mất.
    const DAU = ORACLE_0_2 + "// dau-tay-sau-luot-mot\n";
    fs.writeFileSync(path.join(REPO, R_TEP), DAU);

    const lan2 = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [1]);
    expect(lan2.ok).toBe(true);
    expect(lan2.status).toBe("executed");
    expect(lan2.message).toContain("trước đó");
    expect(docDia(), "không một byte nào được ghi thêm").toBe(DAU);
    // Và kết quả cache vẫn là lời khai của lượt MỘT (2/3 khối), không phải của tập [1] gửi sau.
    const data = (lan2.result as { data?: Record<string, unknown> })?.data as Record<string, unknown>;
    expect(data.hunksApplied).toEqual({ selected: [0, 2], total: 3 });
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — guard đua ĐỢT 0 không bị đường mới PHÁ: hai confirm song song ⇒ MỘT lượt execute", () => {
  /**
   * ⚠⚠ PHẠM VI NÓI THẲNG (đo bằng đột biến, không đoán): ca này chứng minh *"đường mới (argsJson
   * vào CÙNG câu UPDATE giành quyền) KHÔNG làm hỏng bất biến một-lần-execute"* — nó **KHÔNG** phải
   * thước đo cho chính cái guard. Đột biến gỡ điều kiện `status` khỏi UPDATE đã được chạy: ca này
   * VẪN XANH (trên Postgres thật, hai lượt của `Promise.all` chạy nối đuôi — không có điểm nhường
   * luồng đủ dài trong cửa sổ SELECT→UPDATE của vai admin), còn `aiCopilotActions.giandQuyen.test.ts`
   * §A ĐỎ đúng 2 ca — vì lưới ấy TIÊM một `await` thật vào `checkPermission` để dựng lại cửa sổ.
   * ⇒ Chủ của mệnh đề "guard đỏ được" là giandQuyen (cùng §C chống-tự-thoả của nó); chủ của mệnh
   *   đề "đường mới không phá guard + đĩa đúng oracle dưới song song" là ca này. Hai lưới bọc nhau.
   */
  it("★★★ hai lượt cùng tập {0,2} chạy song song trên CSDL thật ⇒ đúng MỘT hàng audit EXECUTED, đĩa đúng oracle", async () => {
    const id = await deXuat();
    const [a, b] = await Promise.all([
      confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0, 2]),
      confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0, 2]),
    ]);
    expect(docDia()).toBe(ORACLE_0_2);
    // Ít nhất một lượt thắng; lượt thua hoặc nhận cache hoặc nói thật "một lượt khác đang xử lý".
    expect([a, b].filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    expect((await auditExecuted(id)).length, "execute() phải chạy ĐÚNG MỘT lần").toBe(1);
    expect((await docHang(id))?.status).toBe("executed");
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — `apply_diff_batch` GIỮ áp-tất-cả: gửi lựa chọn khối cho lô ⇒ TỪ CHỐI, không âm thầm lọc", () => {
  it("★★★ selectedHunkIds trên một đề xuất LÔ ⇒ HUNK_IDS_INVALID, 0 byte chạm đĩa", async () => {
    const r = await proposeAction(
      applyDiffBatchTool as never,
      { files: [{ path: R_TEP, original: GOC, modified: SUA }] },
      CTX(),
    );
    expect(r.ok, r.message ?? "").toBe(true);
    const id = r.pendingAction!.actionId;
    const kq = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, undefined, [0]);
    expect(kq.ok).toBe(false);
    expect(kq.reason).toBe(HUNK_REJECT_REASONS.HUNK_IDS_INVALID);
    expect(docDia()).toBe(GOC);
    // Và KHÔNG gửi lựa chọn thì lô vẫn đi đường cũ bình thường (tương thích ngược của chính lô).
    const ok = await confirmAction(id, id, NGUOI(), "vi");
    expect(ok.ok, ok.message ?? "").toBe(true);
    expect(docDia()).toBe(SUA);
  }, 60_000);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§8 — CENSUS DÂY MẠNG: schema confirm chỉ nhận SỐ, không bao giờ nhận BYTE nội dung", () => {
  /**
   * ⚠ Đây là lưới cho đột biến (b) của brief: *"server lấy `modified` từ request thay vì DB"*. Cách
   * rẻ nhất để lỗ ấy mở lại là ai đó thêm một ô nội dung vào input schema của mutation — census này
   * đọc ĐÚNG khối schema ấy trong mã nguồn router và đỏ ngay khi hình dạng dây đổi.
   */
  const NGUON_ROUTER = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "routers", "aiCopilotRouter.ts"),
    "utf8",
  );

  it("★★★ input của `confirmAction` có `selectedHunkIds` kiểu SỐ NGUYÊN, và KHÔNG có ô nội dung nào", () => {
    const dau = NGUON_ROUTER.indexOf("confirmAction: protectedProcedure");
    const cuoi = NGUON_ROUTER.indexOf(".mutation", dau);
    expect(dau).toBeGreaterThan(-1);
    expect(cuoi).toBeGreaterThan(dau);
    const khoi = NGUON_ROUTER.slice(dau, cuoi);
    expect(khoi).toContain("selectedHunkIds");
    expect(khoi).toContain("z.number().int()");
    // Ba cái tên mà một "đường tắt gửi byte" sẽ dùng — cấm cả ba trong schema của mutation này.
    for (const cam of ['modified:', 'original:', 'content:']) {
      expect(khoi, `schema confirm không được mang ô nội dung \`${cam}\``).not.toContain(cam);
    }
  });

  it("★★ đường truyền xuống service mang `input.selectedHunkIds`, không mang một ô byte nào", () => {
    expect(NGUON_ROUTER).toContain("input.selectedHunkIds");
    expect(NGUON_ROUTER).not.toContain("input.modified");
    expect(NGUON_ROUTER).not.toContain("input.original");
  });
});

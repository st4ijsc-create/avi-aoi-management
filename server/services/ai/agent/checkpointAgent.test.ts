/**
 * ★★★ Đợt 1 · T3 (2026-10-17) — CHECKPOINT + HOÀN TÁC của vòng agent, đo trên ĐƯỜNG GHI THẬT.
 *
 * CSDL THẬT (vitest.setup ép DATABASE_URL sang bản `_test`), repo git THẬT trong thư mục tạm, người
 * dùng THẬT; không model, không mock thứ đang kiểm. Mỗi lượt "agent ghi" ở đây đi đúng đường T4 sẽ
 * đi: `chupTruocGhi` → `executeDecision` (propose) → `confirmAction` → `chotSauGhi` (băm SAU lấy từ
 * kết quả tool qua `thayDoiTuKetQuaGhi`). Hoàn tác thì đi CHÍNH tool ghi — nên mọi khẳng định ở đây
 * là khẳng định về byte trên đĩa (sha256 của BUFFER thô, không phải chuỗi đã giải mã).
 *
 * Bất biến:
 *   1. sửa / tạo / xoá / đổi tên ⇒ hoàn tác trả ĐÚNG byte (kể cả CRLF) — sha256 thô bằng trước-agent;
 *   2. người sửa tiếp sau agent ⇒ XUNG ĐỘT, byte của người NGUYÊN VẸN;
 *   3. cả lượt chạy nhiều checkpoint ⇒ hoàn tác theo thứ tự NGƯỢC seq;
 *   4. mỗi lượt khôi phục có hàng `ai_pending_actions` (đi cửa HITL) + một hàng audit tổng mỗi lần hoàn tác;
 *   5. lưu trữ ngoài dự án, bản sao đặt tên theo BĂM, trần dung lượng, dọn lượt chạy cũ.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import {
  chupTruocGhi,
  chotSauGhi,
  danhSachCheckpoint,
  donCheckpointCu,
  hoanTac,
  thayDoiTuKetQuaGhi,
  LY_DO_HOAN_TAC,
  LoiCheckpoint,
  thuMucKhoCheckpoint,
} from "./checkpointAgent";
import { confineDirUnder, confineTargetUnder } from "../../aiLocalTools/readToolsProgramming";
import { gocRepoChinh } from "../../aiCodingTuTriGhi";
import { executeDecision } from "../../aiLocalTools";
import { confirmAction } from "../../aiCopilotActions";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { daBiTuChoiGhi } from "@shared/aiCodingLoop";
import { getDb } from "../../../db/connection";
import { aiPendingActions, auditLogs } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

let REPO = "";
let KHO = "";
let KHOA_CU: string | undefined;
let uid = 0;

function git(...a: string[]): string {
  return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" });
}
function ghiCommit(rel: string, noiDung: string | Buffer): void {
  const abs = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, noiDung);
  git("add", "--", rel);
  git("commit", "-q", "-m", `add ${rel}`);
}
const abs = (rel: string) => path.join(REPO, rel);
const co = (rel: string) => fs.existsSync(abs(rel));
/** sha256 của BYTE THÔ trên đĩa — thước của cổng "hoàn tác đúng byte". */
const bamTho = (rel: string) => createHash("sha256").update(fs.readFileSync(abs(rel))).digest("hex");
const bamBuf = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const doc = (rel: string) => fs.readFileSync(abs(rel), "utf8");

const NGUOI = () => ({ id: uid, role: "admin", name: "Ky su hoan tac" });
const CTX = () => ({ user: NGUOI(), lang: "vi" as const, projectRoot: REPO });

/**
 * Một lượt ghi của agent — ĐÚNG chuỗi T4 sẽ chạy (chụp → đề xuất → xác nhận → chốt). `tuDong` ⇒
 * xác nhận kiểu chế độ `tu-dong` (`{reason:"AI_AGENT_TU_DONG"}`), để đo câu hỏi "tệp AI tạo qua
 * đường tự động có vào sổ băm HITL không" bằng chính một lượt hoàn tác sau đó.
 */
async function agentGhi(
  runId: string,
  seq: number,
  tool: "apply_diff" | "delete_file" | "rename_file",
  args: Record<string, unknown>,
  duongs: string[],
  tuDong = false,
) {
  const cp = await chupTruocGhi({ runId, seq, gocDuAn: REPO, duongs });
  const out = await executeDecision({ tool, args }, CTX());
  expect(out.pendingAction, `đề xuất ${tool} phải ra pending action: ${out.error ?? out.denied?.message ?? ""}`).toBeTruthy();
  const id = out.pendingAction!.actionId;
  const kq = await confirmAction(id, id, NGUOI(), "vi", undefined, {}, tuDong ? { reason: "AI_AGENT_TU_DONG" } : undefined);
  expect(daBiTuChoiGhi(kq.result), `lượt ghi của agent phải VÀO ĐĨA: ${JSON.stringify(kq.result)}`).toBe(false);
  await chotSauGhi(cp.id, thayDoiTuKetQuaGhi(tool, kq.result));
  return cp;
}

const runMoi = () => randomUUID();
const hoan = (runId: string, checkpointId?: string) =>
  hoanTac({ runId, ...(checkpointId ? { checkpointId } : {}), execCtx: CTX(), user: NGUOI(), lang: "vi" });

beforeAll(async () => {
  REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-agent-repo-")));
  KHO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-agent-kho-")));
  process.env.AI_CHECKPOINT_DIR = KHO;
  // Manifest checkpoint KÝ HMAC (rà bảo mật a5f56d089): lưới không nạp .env ⇒ đặt bí mật server riêng cho lưới.
  KHOA_CU = process.env.SECRET_ENCRYPTION_KEY;
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  ghiCommit("README.md", "# repo thu\n");

  const bcrypt = await import("bcryptjs");
  const kq = await createLocalUser({
    username: `t3-checkpoint-${Date.now()}`,
    passwordHash: await bcrypt.hash("Mk-checkpoint!1", 10),
    name: "Ky su hoan tac",
    role: "admin",
  });
  uid = kq.id;
}, 60_000);

beforeEach(() => {
  delete process.env.AI_CHECKPOINT_TRAN_BYTE;
});

afterAll(async () => {
  delete process.env.AI_CHECKPOINT_DIR;
  if (KHOA_CU === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = KHOA_CU;
  const db = await getDb();
  if (db && uid > 0) {
    await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, uid));
    await db.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await db.delete(users).where(eq(users.id, uid));
  }
  for (const d of [REPO, KHO]) {
    try {
      if (d) fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}, 60_000);

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — sửa / tạo / xoá / đổi tên ⇒ hoàn tác trả ĐÚNG byte", () => {
  it("★★★ SỬA ⇒ hoàn tác qua apply_diff trả đúng byte; có pending action + audit hoàn tác", async () => {
    const goc = "export const A = 1;\n";
    ghiCommit("src/a.ts", goc);
    const truoc = bamTho("src/a.ts");
    const runId = runMoi();
    const cp = await agentGhi(runId, 1, "apply_diff", { path: "src/a.ts", original: goc, modified: "export const A = 2;\n" }, ["src/a.ts"]);
    expect(doc("src/a.ts")).toBe("export const A = 2;\n");

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    expect(kq.khoiPhuc).toEqual(["src/a.ts"]);
    expect(bamTho("src/a.ts")).toBe(truoc);
    expect(git("status", "--porcelain", "--", "src/a.ts"), "khôi phục về đúng HEAD ⇒ git sạch").toBe("");

    // Đi cửa HITL thật: có hàng ai_pending_actions cho lượt hoàn tác (apply_diff, đã thực thi).
    const db = await getDb();
    const hang = await db!.select().from(aiPendingActions).where(and(eq(aiPendingActions.userId, uid), eq(aiPendingActions.tool, "apply_diff")));
    const hoanTacRow = hang.find((h) => (h.argsJson as { modified?: string }).modified === goc);
    expect(hoanTacRow?.status).toBe("executed");

    // Audit: đúng MỘT hàng tổng cho lần hoàn tác này.
    const au = await db!.select().from(auditLogs).where(and(eq(auditLogs.action, "ai_agent_hoan_tac"), eq(auditLogs.entityName, runId)));
    expect(au.length).toBe(1);
    const meta = JSON.parse(au[0].details ?? "{}").metadata;
    expect(meta.runId).toBe(runId);
    expect(meta.checkpoints).toEqual([cp.id]);
    expect(meta.khoiPhuc).toEqual(["src/a.ts"]);
    expect(meta.xungDot).toEqual([]);
    expect(meta.lyDo).toBe(LY_DO_HOAN_TAC);
    expect(meta.nguoiBam).toBe(uid);
    expect(au[0].userId).toBe(uid);
    // Lượt ghi khôi phục mang nhãn AI_AGENT_HOAN_TAC trong audit EXECUTED của confirmAction.
    const ex = await db!.select().from(auditLogs).where(eq(auditLogs.action, "ai_action_executed"));
    const exRow = ex.find((r) => JSON.parse(r.details ?? "{}").metadata?.actionId === hoanTacRow?.id);
    expect(JSON.parse(exRow?.details ?? "{}").metadata?.autonomyReason).toBe(LY_DO_HOAN_TAC);
  }, 60_000);

  it("★★★ TẠO (qua đường tu-dong) ⇒ hoàn tác XOÁ tệp — tệp AI tạo tự động vẫn vào sổ băm HITL", async () => {
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/moi/tao.ts", original: "", modified: "export const T = 1;\n" }, ["src/moi/tao.ts"], true);
    expect(co("src/moi/tao.ts")).toBe(true);

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    expect(kq.khoiPhuc).toEqual(["src/moi/tao.ts"]);
    expect(co("src/moi/tao.ts")).toBe(false);
  }, 60_000);

  it("★★★ XOÁ ⇒ hoàn tác TẠO LẠI đúng byte", async () => {
    const goc = "export const X = 1;\n// giu nguyen\n";
    ghiCommit("src/se-xoa.ts", goc);
    const truoc = bamTho("src/se-xoa.ts");
    const runId = runMoi();
    await agentGhi(runId, 1, "delete_file", { path: "src/se-xoa.ts" }, ["src/se-xoa.ts"]);
    expect(co("src/se-xoa.ts")).toBe(false);

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    expect(kq.khoiPhuc).toEqual(["src/se-xoa.ts"]);
    expect(bamTho("src/se-xoa.ts")).toBe(truoc);
    expect(git("status", "--porcelain", "--", "src/se-xoa.ts")).toBe("");
  }, 60_000);

  it("★★★ ĐỔI TÊN ⇒ hoàn tác dời NGƯỢC qua rename_file", async () => {
    const goc = "export const D = 1;\n";
    ghiCommit("src/doi.ts", goc);
    const truoc = bamTho("src/doi.ts");
    const runId = runMoi();
    await agentGhi(runId, 1, "rename_file", { from: "src/doi.ts", to: "src/khac/da-doi.ts" }, ["src/doi.ts", "src/khac/da-doi.ts"]);
    expect(co("src/doi.ts")).toBe(false);
    expect(co("src/khac/da-doi.ts")).toBe(true);

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    expect(kq.khoiPhuc).toEqual(["src/doi.ts"]);
    expect(co("src/khac/da-doi.ts")).toBe(false);
    expect(bamTho("src/doi.ts")).toBe(truoc);
    expect(git("status", "--porcelain", "--", "src")).toBe("");
  }, 60_000);

  it("★★★ CRLF giữ nguyên TỪNG BYTE (sửa CRLF→LF rồi hoàn tác)", async () => {
    const gocBuf = Buffer.from("line 1\r\nline 2\r\n\r\nend\r\n", "utf8");
    ghiCommit("src/crlf.ts", gocBuf);
    const gocStr = gocBuf.toString("utf8");
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/crlf.ts", original: gocStr, modified: "line 1\nline 2\n" }, ["src/crlf.ts"]);
    expect(fs.readFileSync(abs("src/crlf.ts")).includes(0x0d)).toBe(false);

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    expect(bamTho("src/crlf.ts")).toBe(bamBuf(gocBuf));
    expect(fs.readFileSync(abs("src/crlf.ts")).equals(gocBuf)).toBe(true);
  }, 60_000);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — xung đột: người sửa tiếp sau agent ⇒ KHÔNG ghi đè", () => {
  it("★★★ sửa của người sau agent ⇒ xungDot, byte của người NGUYÊN VẸN, không đề xuất ghi nào", async () => {
    const goc = "export const N = 1;\n";
    ghiCommit("src/nguoi.ts", goc);
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/nguoi.ts", original: goc, modified: "export const N = 2;\n" }, ["src/nguoi.ts"]);
    const cuaNguoi = "export const N = 2;\n// nguoi viet them\n";
    fs.writeFileSync(abs("src/nguoi.ts"), cuaNguoi);

    const db = await getDb();
    const demTruoc = (await db!.select().from(aiPendingActions).where(eq(aiPendingActions.userId, uid))).length;
    const kq = await hoan(runId);
    expect(kq.khoiPhuc).toEqual([]);
    expect(kq.xungDot.map((x) => x.duong)).toEqual(["src/nguoi.ts"]);
    expect(kq.xungDot[0].lyDo).toMatch(/BAM_HIEN_TAI_KHAC/);
    expect(doc("src/nguoi.ts")).toBe(cuaNguoi);
    const demSau = (await db!.select().from(aiPendingActions).where(eq(aiPendingActions.userId, uid))).length;
    expect(demSau, "xung đột phải phát hiện TRƯỚC cửa ghi — không một đề xuất nào").toBe(demTruoc);
    git("checkout", "--", "src/nguoi.ts");
  }, 60_000);

  it("★★ người TẠO lại tệp agent đã xoá ⇒ xungDot, tệp của người giữ nguyên", async () => {
    ghiCommit("src/xoa-roi-tao.ts", "export const R = 1;\n");
    const runId = runMoi();
    await agentGhi(runId, 1, "delete_file", { path: "src/xoa-roi-tao.ts" }, ["src/xoa-roi-tao.ts"]);
    fs.writeFileSync(abs("src/xoa-roi-tao.ts"), "cua nguoi\n");
    const kq = await hoan(runId);
    expect(kq.xungDot.map((x) => x.duong)).toEqual(["src/xoa-roi-tao.ts"]);
    expect(doc("src/xoa-roi-tao.ts")).toBe("cua nguoi\n");
    fs.unlinkSync(abs("src/xoa-roi-tao.ts"));
    git("checkout", "--", "src/xoa-roi-tao.ts");
  }, 60_000);

  it("★★ restart (sổ băm HITL rỗng) ⇒ cửa ghi TỪ CHỐI (FILE_DIRTY) và hoàn tác KHAI xung đột, không nới hàng rào", async () => {
    const goc = "export const S = 1;\n";
    ghiCommit("src/restart.ts", goc);
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/restart.ts", original: goc, modified: "export const S = 2;\n" }, ["src/restart.ts"]);
    _xoaSoBamHITL();
    const kq = await hoan(runId);
    expect(kq.khoiPhuc).toEqual([]);
    expect(kq.xungDot).toHaveLength(1);
    expect(kq.xungDot[0].lyDo).toMatch(/FILE_DIRTY/);
    expect(doc("src/restart.ts")).toBe("export const S = 2;\n");
    git("checkout", "--", "src/restart.ts");
  }, 60_000);

  it("★★ gốc dự án của lượt hoàn tác ≠ gốc đã chụp ⇒ xung đột mọi mục, không ghi", async () => {
    const goc = "export const G = 1;\n";
    ghiCommit("src/goc.ts", goc);
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/goc.ts", original: goc, modified: "export const G = 2;\n" }, ["src/goc.ts"]);
    const khac = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-goc-khac-")));
    const kq = await hoanTac({ runId, execCtx: { ...CTX(), projectRoot: khac }, user: NGUOI(), lang: "vi" });
    expect(kq.khoiPhuc).toEqual([]);
    expect(kq.xungDot[0].lyDo).toMatch(/GOC_DU_AN_KHAC/);
    expect(doc("src/goc.ts")).toBe("export const G = 2;\n");
    fs.rmSync(khac, { recursive: true, force: true });
    // dọn: hoàn tác đúng gốc
    expect((await hoan(runId)).khoiPhuc).toEqual(["src/goc.ts"]);
  }, 60_000);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — cả lượt chạy nhiều checkpoint ⇒ thứ tự NGƯỢC", () => {
  it("★★★ sửa 2 lần cùng tệp + tạo + đổi tên ⇒ hoàn tác cả lượt về đúng trạng thái trước lượt chạy", async () => {
    const v0 = "export const M = 0;\n";
    const v1 = "export const M = 1;\n";
    const v2 = "export const M = 2;\n";
    ghiCommit("src/m.ts", v0);
    ghiCommit("src/c.ts", "export const C = 1;\n");
    const bamM = bamTho("src/m.ts");
    const bamC = bamTho("src/c.ts");
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/m.ts", original: v0, modified: v1 }, ["src/m.ts"]);
    await agentGhi(runId, 2, "apply_diff", { path: "src/m.ts", original: v1, modified: v2 }, ["src/m.ts"]);
    await agentGhi(runId, 3, "apply_diff", { path: "src/b.ts", original: "", modified: "export const B = 1;\n" }, ["src/b.ts"]);
    await agentGhi(runId, 4, "rename_file", { from: "src/c.ts", to: "src/d.ts" }, ["src/c.ts", "src/d.ts"]);

    const ds = await danhSachCheckpoint(runId);
    expect(ds.map((c) => c.seq)).toEqual([1, 2, 3, 4]);

    // Chỉ một checkpoint GIỮA (seq 1) ⇒ bị chồng bởi seq 2 ⇒ xung đột, không ghi.
    const motCp = await hoan(runId, ds[0].id);
    expect(motCp.xungDot.map((x) => x.duong)).toEqual(["src/m.ts"]);
    expect(doc("src/m.ts")).toBe(v2);

    const kq = await hoan(runId);
    expect(kq.xungDot).toEqual([]);
    // Thứ tự khôi phục = ngược seq: 4 (đổi tên) → 3 (tạo) → 2 → 1.
    expect(kq.khoiPhuc).toEqual(["src/c.ts", "src/b.ts", "src/m.ts", "src/m.ts"]);
    expect(bamTho("src/m.ts")).toBe(bamM);
    expect(bamTho("src/c.ts")).toBe(bamC);
    expect(co("src/b.ts")).toBe(false);
    expect(co("src/d.ts")).toBe(false);
    expect(git("status", "--porcelain", "--", "src")).toBe("");

    // Hoàn tác LẦN HAI: mọi thứ đã ở trạng thái trước ⇒ bỏ qua, không xung đột, không ghi.
    const lan2 = await hoan(runId);
    expect(lan2.khoiPhuc).toEqual([]);
    expect(lan2.xungDot).toEqual([]);
    expect(lan2.boQua.length).toBeGreaterThan(0);
  }, 120_000);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§D — lưu trữ: ngoài dự án, theo băm, trần dung lượng, dọn cũ", () => {
  it("★★ manifest ở <AI_CHECKPOINT_DIR>/<runId>/<seq>/manifest.json; bản sao đặt tên theo BĂM; không gì vào dự án", async () => {
    const goc = "export const L = 1;\n";
    ghiCommit("src/luu.ts", goc);
    const runId = runMoi();
    const cp = await chupTruocGhi({ runId, seq: 7, gocDuAn: REPO, duongs: ["src/luu.ts", "src/chua-co.ts"] });
    const thuMuc = path.join(KHO, runId, "7");
    const man = JSON.parse(fs.readFileSync(path.join(thuMuc, "manifest.json"), "utf8"));
    expect(man.id).toBe(cp.id);
    expect(man.muc).toEqual([
      { duong: "src/luu.ts", tonTai: true, bamTruoc: bamBuf(goc) },
      { duong: "src/chua-co.ts", tonTai: false, bamTruoc: null },
    ]);
    const tep = fs.readdirSync(thuMuc).sort();
    expect(tep).toEqual([`${bamBuf(goc)}.bin`, "manifest.json"]);
    expect(fs.readFileSync(path.join(thuMuc, `${bamBuf(goc)}.bin`)).equals(Buffer.from(goc))).toBe(true);
    expect(git("status", "--porcelain"), "chụp checkpoint KHÔNG được để lại gì trong dự án").toBe("");

    // Chưa chốt + tệp không đổi ⇒ hoàn tác bỏ qua.
    const kq = await hoan(runId);
    expect(kq.khoiPhuc).toEqual([]);
    expect(kq.xungDot).toEqual([]);
    expect(kq.boQua.sort()).toEqual(["src/chua-co.ts", "src/luu.ts"]);
  }, 60_000);

  it("★★ seq trùng ⇒ từ chối (không ghi đè checkpoint cũ)", async () => {
    const runId = runMoi();
    await chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["README.md"] });
    await expect(chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["README.md"] })).rejects.toMatchObject({ ma: "DA_TON_TAI" });
  });

  it("★★ runId/seq lạ (đường thoát) ⇒ LoiCheckpoint, không tạo gì ngoài kho", async () => {
    await expect(chupTruocGhi({ runId: "../thoat", seq: 1, gocDuAn: REPO, duongs: [] })).rejects.toBeInstanceOf(LoiCheckpoint);
    await expect(chupTruocGhi({ runId: runMoi(), seq: -1, gocDuAn: REPO, duongs: [] })).rejects.toBeInstanceOf(LoiCheckpoint);
    await expect(chupTruocGhi({ runId: runMoi(), seq: 1, gocDuAn: "tuong-doi", duongs: [] })).rejects.toBeInstanceOf(LoiCheckpoint);
    expect(fs.existsSync(path.join(KHO, "..", "thoat"))).toBe(false);
  });

  it("★★ đường bị hộp cát từ chối ⇒ ghi nhận mục bị từ chối, không đọc ngoài gốc", async () => {
    const runId = runMoi();
    const cp = await chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["../ngoai.ts", "src/../../x.ts"] });
    expect(cp.muc.every((m) => m.tonTai === false && m.bamTruoc === null)).toBe(true);
    expect(cp.muc.every((m) => typeof m.tuChoi === "string")).toBe(true);
  });

  it("★★ vượt trần dung lượng mỗi lượt chạy ⇒ VUOT_TRAN (fail-closed: T4 không được ghi)", async () => {
    ghiCommit("src/to.ts", "x".repeat(5_000) + "\n");
    process.env.AI_CHECKPOINT_TRAN_BYTE = "8000";
    const runId = runMoi();
    await chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["src/to.ts"] });
    await expect(chupTruocGhi({ runId, seq: 2, gocDuAn: REPO, duongs: ["src/to.ts"] })).rejects.toMatchObject({ ma: "VUOT_TRAN" });
    // Không để lại thư mục seq 2 dở dang.
    expect(fs.existsSync(path.join(KHO, runId, "2"))).toBe(false);
  });

  it("★★ donCheckpointCu xoá lượt chạy cũ hơn 7 ngày, giữ lượt mới", async () => {
    const cu = runMoi();
    const moi = runMoi();
    // ⚠ Manifest nay KÝ HMAC — sửa tay `taoLuc` là giả mạo (bị từ chối). Lượt "cũ" được chụp ĐÚNG lúc 8 ngày trước
    //   bằng đồng hồ giả (chỉ `Date`), nên manifest của nó ký thật với mốc cũ.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() - 8 * 86_400_000);
      await chupTruocGhi({ runId: cu, seq: 1, gocDuAn: REPO, duongs: ["README.md"] });
    } finally {
      vi.useRealTimers();
    }
    await chupTruocGhi({ runId: moi, seq: 1, gocDuAn: REPO, duongs: ["README.md"] });
    const kq = await donCheckpointCu();
    expect(kq.daXoa).toContain(cu);
    expect(fs.existsSync(path.join(KHO, cu))).toBe(false);
    expect(fs.existsSync(path.join(KHO, moi))).toBe(true);
  });

  it("★★ bản sao bị sửa trong kho (băm không khớp manifest) ⇒ xung đột, không ghi nội dung lạ", async () => {
    const goc = "export const K = 1;\n";
    ghiCommit("src/kho-hong.ts", goc);
    const runId = runMoi();
    const cp = await agentGhi(runId, 1, "apply_diff", { path: "src/kho-hong.ts", original: goc, modified: "export const K = 2;\n" }, ["src/kho-hong.ts"]);
    const bin = path.join(KHO, runId, String(cp.seq), `${bamBuf(goc)}.bin`);
    fs.writeFileSync(bin, "noi dung la\n");
    const kq = await hoan(runId);
    expect(kq.xungDot[0].lyDo).toMatch(/BAN_SAO_HONG/);
    expect(doc("src/kho-hong.ts")).toBe("export const K = 2;\n");
    git("checkout", "--", "src/kho-hong.ts");
  }, 60_000);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ Rà bảo mật a5f56d089 · phát hiện 2 — "agent-writable undo manifest". Hai lớp:
 *   (a) kho NGOÀI mọi gốc dự án (mặc định = thư mục dữ liệu ứng dụng của người dùng, không phải repo); kho cấu hình
 *       rơi vào trong gốc dự án/repo ⇒ TỪ CHỐI dùng; hàng rào đường của hộp cát coi kho là CẤM đọc/ghi;
 *   (b) manifest ký HMAC-SHA256 (khoá HKDF từ bí mật server) — sửa/thiếu chữ ký ⇒ hoàn tác TỪ CHỐI; không khoá ⇒
 *       checkpoint KHÔNG dùng được (bộ thực thi ⇒ CHECKPOINT_LOI ⇒ không ghi).
 */
describe("§E — toàn vẹn kho checkpoint (manifest ký HMAC, kho ngoài dự án)", () => {
  const manifestCua = (runId: string, seq: number) => path.join(KHO, runId, String(seq), "manifest.json");

  it("★★★ manifest bị SỬA (đổi đường đích) ⇒ hoàn tác từ chối CHU_KY_SAI, KHÔNG ghi gì", async () => {
    const goc = "export const S = 1;\n";
    ghiCommit("src/ky.ts", goc);
    ghiCommit("src/nan-nhan.ts", "export const NAN = 1;\n");
    const runId = runMoi();
    await agentGhi(runId, 1, "apply_diff", { path: "src/ky.ts", original: goc, modified: "export const S = 2;\n" }, ["src/ky.ts"]);
    const p = manifestCua(runId, 1);
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    m.muc[0].duong = "src/nan-nhan.ts";
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    await expect(hoan(runId)).rejects.toMatchObject({ ma: "CHU_KY_SAI" });
    await expect(hoan(runId, `${runId}.1`)).rejects.toMatchObject({ ma: "CHU_KY_SAI" });
    expect(doc("src/ky.ts")).toBe("export const S = 2;\n");
    expect(doc("src/nan-nhan.ts")).toBe("export const NAN = 1;\n");
    git("checkout", "--", "src/ky.ts");
  }, 60_000);

  it("★★★ manifest THIẾU chữ ký (giả mạo viết tay) ⇒ CHU_KY_SAI; chotSauGhi cũng từ chối manifest giả", async () => {
    const runId = runMoi();
    const cp = await chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["README.md"] });
    const p = manifestCua(runId, 1);
    const m = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(typeof m.mac, "manifest phải mang chữ ký").toBe("string");
    delete m.mac;
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
    await expect(hoan(runId)).rejects.toMatchObject({ ma: "CHU_KY_SAI" });
    await expect(chotSauGhi(cp.id, [])).rejects.toMatchObject({ ma: "CHU_KY_SAI" });
  });

  it("★★★ không có bí mật server (SECRET_ENCRYPTION_KEY/JWT_SECRET) ⇒ KHONG_CO_KHOA: không chụp được, không hoàn tác được", async () => {
    const runId = runMoi();
    await chupTruocGhi({ runId, seq: 1, gocDuAn: REPO, duongs: ["README.md"] });
    const cu = { s: process.env.SECRET_ENCRYPTION_KEY, j: process.env.JWT_SECRET };
    delete process.env.SECRET_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    try {
      await expect(chupTruocGhi({ runId: runMoi(), seq: 1, gocDuAn: REPO, duongs: ["README.md"] })).rejects.toMatchObject({ ma: "KHONG_CO_KHOA" });
      await expect(hoan(runId)).rejects.toMatchObject({ ma: "KHONG_CO_KHOA" });
    } finally {
      if (cu.s !== undefined) process.env.SECRET_ENCRYPTION_KEY = cu.s;
      if (cu.j !== undefined) process.env.JWT_SECRET = cu.j;
    }
  });

  it("★★★ AI_CHECKPOINT_DIR TRONG gốc dự án / repo chính ⇒ KHO_KHONG_HOP_LE, không tạo thư mục nào", async () => {
    const trongDuAn = path.join(REPO, "kho-trong-du-an");
    const trongRepo = path.join(gocRepoChinh(), "tmp", `__kho_${randomUUID().slice(0, 8)}`);
    for (const kho of [trongDuAn, trongRepo]) {
      process.env.AI_CHECKPOINT_DIR = kho;
      try {
        await expect(chupTruocGhi({ runId: runMoi(), seq: 1, gocDuAn: REPO, duongs: ["README.md"] }), kho).rejects.toMatchObject({ ma: "KHO_KHONG_HOP_LE" });
        await expect(hoan(runMoi()), kho).rejects.toMatchObject({ ma: "KHO_KHONG_HOP_LE" });
        expect(fs.existsSync(kho), kho).toBe(false);
      } finally {
        process.env.AI_CHECKPOINT_DIR = KHO;
      }
    }
  });

  it("★★ kho MẶC ĐỊNH nằm NGOÀI repo chính và ngoài cwd (thư mục dữ liệu ứng dụng, ổn định qua restart)", () => {
    delete process.env.AI_CHECKPOINT_DIR;
    try {
      const kho = thuMucKhoCheckpoint();
      expect(path.isAbsolute(kho)).toBe(true);
      for (const goc of [gocRepoChinh(), process.cwd()]) {
        const rel = path.relative(goc, kho);
        expect(rel.startsWith("..") || path.isAbsolute(rel), `${kho} phải ngoài ${goc}`).toBe(true);
      }
      expect(kho.startsWith(os.tmpdir()), "không dùng thư mục tạm (bị dọn ⇒ mất điểm khôi phục)").toBe(false);
    } finally {
      process.env.AI_CHECKPOINT_DIR = KHO;
    }
  });

  it("★★★ hàng rào đường: thư mục kho là CẤM đọc/ghi/liệt kê dù (cấu hình sai) nằm dưới gốc dự án", () => {
    const kho = path.join(REPO, "kho-cam");
    fs.mkdirSync(path.join(kho, "r1", "1"), { recursive: true });
    fs.writeFileSync(path.join(kho, "r1", "1", "manifest.json"), "{}");
    process.env.AI_CHECKPOINT_DIR = kho;
    try {
      const doc1 = confineTargetUnder(REPO, "kho-cam/r1/1/manifest.json");
      expect(doc1).toMatchObject({ ok: false, kind: "PATH_REJECTED", reason: "CHECKPOINT_STORE" });
      const moi = confineTargetUnder(REPO, "kho-cam/r2/1/manifest.json");
      expect(moi).toMatchObject({ ok: false, kind: "PATH_REJECTED", reason: "CHECKPOINT_STORE" });
      expect(confineDirUnder(REPO, "kho-cam/r1")).toMatchObject({ ok: false, kind: "PATH_REJECTED", reason: "CHECKPOINT_STORE" });
      expect(confineDirUnder(REPO, "kho-cam")).toMatchObject({ ok: false, kind: "PATH_REJECTED", reason: "CHECKPOINT_STORE" });
      // Ngoài kho vẫn bình thường.
      expect(confineTargetUnder(REPO, "README.md")).toMatchObject({ ok: true });
    } finally {
      process.env.AI_CHECKPOINT_DIR = KHO;
      fs.rmSync(kho, { recursive: true, force: true });
    }
  });
});

/**
 * ★★★ Đợt 3a (Q3) — VÒNG AGENT trên DỰ ÁN CÁ NHÂN, đầu–cuối phía server: dự án tạo THẬT (khuôn node-ts, git + commit
 * đầu, hàng CSDL `_test` mig 0393) ⇒ `taoLuotChay` chế độ `tu-dong` của CHỦ (kỹ sư, KHÔNG admin) ⇒ model giả sửa tệp
 * ⇒ tệp THẬT đổi (Q1 chỉ chặn repo chính — dự án cá nhân KHÔNG bị chặn) ⇒ hoàn tác trả đúng byte.
 * Người khác (cùng quyền) mở lượt chạy trên dự án ấy ⇒ PROJECT_NOT_FOUND, đĩa 0 đổi.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";

import type { GoiModel, ManhModel, WireToolCall } from "@shared/agentCore";
import { taoQuanLyLuotChay } from "./quanLyLuotChay";
import { taoDuAnCaNhan } from "../duAnCaNhan/duAnCaNhan";
import { phanGiaiGoc } from "../../aiLocalTools/repoProjects";
import { _xoaSoBamHITL } from "../../aiLocalTools/writeHandlers/applyDiff";
import { xoaSoNganSach } from "../../aiLocalTools/repoSandbox";
import { getDb } from "../../../db/connection";
import { aiAgentRuns, aiCodingSessions, aiPendingActions, aiRepoDuAn } from "../../../../drizzle/schema";
import { users, userSecrets, permissions } from "../../../../drizzle/schema/auth";
import { createLocalUser } from "../../../db/auth";

const BIEN = ["AI_CHECKPOINT_DIR", "SECRET_ENCRYPTION_KEY", "AI_REPO_SANDBOX_ROOTS", "AI_REPO_SANDBOX_ROOT", "AI_CODING_TU_TRI_GHI", "AI_PROJECTS_ROOT"];
const CU: Record<string, string | undefined> = {};
let TAM = "";
let uChu = 0;
let uKhac = 0;
let idDuAn = "";
let gocDuAn = "";

const tc = (id: string, name: string, args: Record<string, unknown>): WireToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
function modelKichBan(kichBan: Array<{ chu?: string; toolCalls?: WireToolCall[] }>): GoiModel {
  let i = 0;
  return async function* (): AsyncGenerator<ManhModel> {
    const b = kichBan[Math.min(i++, kichBan.length - 1)]!;
    if (b.chu) yield { loai: "chu", noiDung: b.chu };
    yield { loai: "xong", toolCalls: b.toolCalls ?? [], usage: { vao: 100, ra: 10, nghi: 0 } };
  };
}

/** Đúng bộ quyền một engineer có trên CSDL thật: 0330 (đọc) + 0331 (`ai_repo_exec/canCreate`) + 0332 (`ai_repo_read/canEdit`). */
async function capQuyen(uid: number): Promise<void> {
  const db = await getDb();
  for (const [m, v, c, e] of [["ai_repo_read", true, false, true], ["ai_repo_exec", false, true, false]] as const) {
    await db!.insert(permissions).values({ userId: uid, category: "settings", moduleName: m, canView: v, canCreate: c, canEdit: e, canDelete: false, canExport: false });
  }
}

beforeAll(async () => {
  for (const k of BIEN) CU[k] = process.env[k];
  TAM = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dot3a-agent-")));
  const hopCat = path.join(TAM, "hop-cat");
  fs.mkdirSync(hopCat);
  process.env.AI_CHECKPOINT_DIR = path.join(TAM, "kho");
  process.env.SECRET_ENCRYPTION_KEY = "luoi-checkpoint-khoa-thu-0123456789abcdef";
  process.env.AI_REPO_SANDBOX_ROOT = hopCat;
  process.env.AI_REPO_SANDBOX_ROOTS = `hopcat3a=Hộp cát|${hopCat}`;
  process.env.AI_CODING_TU_TRI_GHI = "1";
  process.env.AI_PROJECTS_ROOT = path.join(TAM, "AI-Projects");
  const bcrypt = await import("bcryptjs");
  const hash = await bcrypt.hash("Mk-dot3a-agent!1", 10);
  uChu = (await createLocalUser({ username: `dot3a-chu-${Date.now()}`, passwordHash: hash, name: "Chu", role: "engineer" })).id;
  uKhac = (await createLocalUser({ username: `dot3a-khac-${Date.now()}`, passwordHash: hash, name: "Khac", role: "engineer" })).id;
  await capQuyen(uChu);
  await capQuyen(uKhac);
  const kq = await taoDuAnCaNhan({ userId: uChu, ten: "Agent 3a", cachTao: "khuon", khuon: "node-ts" });
  if (!kq.ok) throw new Error(`tạo dự án hỏng: ${JSON.stringify(kq)}`);
  idDuAn = kq.id;
  const pg = phanGiaiGoc(idDuAn, { id: uChu, role: "engineer" });
  if (!pg.ok || !pg.goc) throw new Error("không phân giải được dự án của chủ");
  gocDuAn = pg.goc;
  xoaSoNganSach();
  _xoaSoBamHITL();
}, 90_000);

afterAll(async () => {
  const db = await getDb();
  if (db) {
    const ids = [uChu, uKhac].filter((x) => x > 0);
    await db.delete(aiRepoDuAn).where(inArray(aiRepoDuAn.chuSoHuu, ids.length ? ids : [-1]));
    for (const u of ids) {
      await db.delete(aiAgentRuns).where(eq(aiAgentRuns.userId, u));
      await db.delete(aiCodingSessions).where(eq(aiCodingSessions.userId, u));
      await db.delete(aiPendingActions).where(eq(aiPendingActions.userId, u));
      await db.delete(permissions).where(eq(permissions.userId, u));
      await db.delete(userSecrets).where(eq(userSecrets.userId, u));
      await db.delete(users).where(eq(users.id, u));
    }
  }
  for (const k of BIEN) {
    if (CU[k] === undefined) delete process.env[k];
    else process.env[k] = CU[k]!;
  }
  try { fs.rmSync(TAM, { recursive: true, force: true }); } catch { /* best-effort */ }
}, 60_000);

const SUA = [
  { toolCalls: [tc("c1", "read_file", { path: "src/index.ts" })] },
  { chu: "Đổi lời chào.", toolCalls: [tc("c2", "edit_file", { path: "src/index.ts", edits: [{ old_string: "Xin chào", new_string: "Chào bạn" }] })] },
  { chu: "Đã đổi lời chào." },
];

describe("§1 — tu-dong trên dự án cá nhân: Q1 KHÔNG chặn (không phải repo chính)", () => {
  it("★★★ chủ (kỹ sư) chạy tu-dong ⇒ tệp THẬT đổi; hoàn tác ⇒ đúng byte cũ", async () => {
    const tep = path.join(gocDuAn, "src", "index.ts");
    const truoc = fs.readFileSync(tep, "utf8");
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan(SUA) });
    const kq = await ql.taoLuotChay({ user: { id: uChu, role: "engineer", name: "Chu" }, cauHoi: "đổi lời chào", projectId: idDuAn, cheDo: "tu-dong" });
    expect(kq.ok, JSON.stringify(kq)).toBe(true);
    if (!kq.ok) return;
    const nghe: unknown[] = [];
    ql.nghe(kq.luot.id, uChu, 0, (m) => nghe.push(m));
    await kq.luot.xong;
    const nhatKy = JSON.stringify({ trangThai: kq.luot.trangThai, lyDo: kq.luot.lyDoDung, nghe }).slice(0, 3000);
    expect(fs.readFileSync(tep, "utf8"), nhatKy).toContain("Chào bạn");
    const ht = await ql.hoanTac({ runId: kq.luot.id, user: { id: uChu, role: "engineer", name: "Chu" }, lang: "vi" });
    expect(ht.ok, JSON.stringify(ht)).toBe(true);
    expect(fs.readFileSync(tep, "utf8")).toBe(truoc);
  });
});

describe("§2 — người khác KHÔNG chạy được agent trên dự án cá nhân", () => {
  it("★★★ kỹ sư khác (cùng quyền) ⇒ PROJECT_NOT_FOUND, đĩa 0 đổi", async () => {
    const tep = path.join(gocDuAn, "src", "index.ts");
    const truoc = fs.readFileSync(tep, "utf8");
    const ql = taoQuanLyLuotChay({ goiModel: modelKichBan(SUA) });
    const kq = await ql.taoLuotChay({ user: { id: uKhac, role: "engineer", name: "Khac" }, cauHoi: "đổi lời chào", projectId: idDuAn, cheDo: "tu-dong" });
    expect(kq).toMatchObject({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(fs.readFileSync(tep, "utf8")).toBe(truoc);
  });
});

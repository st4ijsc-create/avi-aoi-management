/**
 * ★★★ Đợt 11.8 · T7 — PHIÊN HỢP NHẤT trên CSDL THẬT (`_test`, mig 0440/0443), HAI tài khoản + người không quyền:
 * phạm vi chủ sở hữu (mọi thủ tục), tách `kind`, khoá lạc quan, runIds lọc chủ, trần số phiên, lan truyền coLuotNgoai, chat chỉ-đọc.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { getDb } from "../db/connection";
import { aiAgentRuns, aiCodingSessions, permissions, users } from "../../drizzle/schema";
import * as kho from "../db/aiPhien";
import { danhSachPhien as cuDanhSach, moPhien as cuMo } from "../db/aiCodingSessions";
import { aiPhienRouter } from "./aiPhienRouter";
import { randomUUID } from "node:crypto";

const TAG = `aiph_${Date.now()}`;
const DU_AN = "repo";
let idA = 0;
let idB = 0;
let idKhongQuyen = 0;
let coDb = false;
const uuidLa = "00000000-0000-4000-8000-0000000000aa";

const caller = (id: number, role = "engineer") => aiPhienRouter.createCaller({ user: { id, role } } as never);

async function mkUser(tag: string, capQuyen: boolean): Promise<number> {
  const db = await getDb();
  const [u] = await db!.insert(users).values({ openId: `${TAG}_${tag}`, username: `${TAG}_${tag}`, name: `phien ${tag}`, role: "engineer", loginMethod: "local" }).returning({ id: users.id });
  if (capQuyen) {
    await db!.insert(permissions).values({ userId: u!.id, category: "settings", moduleName: "ai_repo_read", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false });
  }
  return u!.id;
}
async function mkRun(userId: number, projectId = DU_AN): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db!.insert(aiAgentRuns).values({ id, userId, projectId, cheDo: "sua", cauHoi: "q", trangThai: "xong" });
  return id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  idA = await mkUser("a", true);
  idB = await mkUser("b", true);
  idKhongQuyen = await mkUser("kq", false);
});

afterAll(async () => {
  const db = await getDb();
  if (!db || !coDb) return;
  const ids = [idA, idB, idKhongQuyen];
  await db.delete(aiCodingSessions).where(inArray(aiCodingSessions.userId, ids));
  await db.delete(aiAgentRuns).where(inArray(aiAgentRuns.userId, ids));
  await db.execute(sql`DELETE FROM ai_chat_conversations WHERE "userId" IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  await db.delete(permissions).where(inArray(permissions.userId, ids));
  await db.delete(users).where(inArray(users.id, ids));
});

const tao = async (u: number, kind: "coding" | "agent" = "coding", title = "") => {
  const r = await kho.tao(u, { projectId: DU_AN, kind, source: "web", title });
  if (!r.ok) throw new Error(r.ma);
  return r;
};

describe("kho — phạm vi CHỦ SỞ HỮU (mọi hàm)", () => {
  it("★★★ A tạo ⇒ B không thấy ở danh sách, không mở/ghi/đổi tên/nhân bản/nộp tóm tắt/xoá được (cùng NOT_FOUND); A vẫn nguyên", async () => {
    if (!coDb) return;
    const a = await tao(idA, "coding", "phien cua A");
    await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "bi mat cua A" }] });
    expect((await kho.danhSach(idB, { projectId: DU_AN })).map((s) => s.id)).not.toContain(a.id);
    expect(await kho.mo(idB, a.id)).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.themLuot(idB, { sessionId: a.id, expectedVersion: 2, luot: [{ role: "user", content: "x" }] })).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.doiTen(idB, { sessionId: a.id, title: "chiem" })).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.nhanBan(idB, a.id)).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.nopTomTat(idB, { sessionId: a.id, expectedVersion: 2, tomTat: "x" })).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.xoa(idB, a.id)).toEqual({ ok: false, ma: "NOT_FOUND" });
    const sau = await kho.mo(idA, a.id);
    expect(sau.ok && sau.phien.title).toBe("phien cua A");
    expect(sau.ok && sau.phien.turns).toEqual([{ role: "user", content: "bi mat cua A" }]);
  });
  it("id méo / user 0 ⇒ NOT_FOUND hoặc THAM_SO_SAI, không ném", async () => {
    expect(await kho.mo(0, uuidLa)).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.mo(idA, "khong-phai-uuid")).toEqual({ ok: false, ma: "NOT_FOUND" });
    expect(await kho.tao(0, { projectId: DU_AN, kind: "coding", source: "web" })).toMatchObject({ ok: false, ma: "THAM_SO_SAI" });
    expect(await kho.tao(idA, { projectId: "D:/x", kind: "coding", source: "web" })).toMatchObject({ ok: false, ma: "THAM_SO_SAI" });
    expect(await kho.tao(idA, { projectId: DU_AN, kind: "chat" as never, source: "web" })).toMatchObject({ ok: false, ma: "THAM_SO_SAI" });
    expect(await kho.tao(idA, { projectId: DU_AN, kind: "coding", source: "tivi" as never })).toMatchObject({ ok: false, ma: "THAM_SO_SAI" });
  });
});

describe("kho — tách kind (M8a)", () => {
  it("★★★ phiên agent KHÔNG hiện/mở được qua API phiên CŨ (kind='coding'); danh sách mới lọc đúng kind", async () => {
    if (!coDb) return;
    const c = await tao(idA, "coding", "ma-coding");
    const g = await tao(idA, "agent", "ma-agent");
    const cu = (await cuDanhSach(idA, DU_AN)).map((s) => s.id);
    expect(cu).toContain(c.id);
    expect(cu).not.toContain(g.id);
    expect(await cuMo(idA, g.id)).toBeNull();
    const ds = async (kind: "coding" | "agent" | "all") => (await kho.danhSach(idA, { projectId: DU_AN, kind })).map((s) => s.id);
    expect(await ds("coding")).toContain(c.id);
    expect(await ds("coding")).not.toContain(g.id);
    expect(await ds("agent")).toContain(g.id);
    expect(await ds("agent")).not.toContain(c.id);
    expect(await ds("all")).toEqual(expect.arrayContaining([c.id, g.id]));
  });
});

describe("kho — khoá lạc quan (expectedVersion)", () => {
  it("★★★ ghi đúng version ⇒ version+1; version cũ ⇒ CONFLICT kèm versionHienTai, KHÔNG ghi", async () => {
    if (!coDb) return;
    const a = await tao(idA);
    const r1 = await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "một" }] });
    expect(r1).toMatchObject({ ok: true, version: 2, turnCount: 1 });
    const r2 = await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "hai-lạc" }] });
    expect(r2).toEqual({ ok: false, ma: "CONFLICT", versionHienTai: 2 });
    const m = await kho.mo(idA, a.id);
    expect(m.ok && m.phien.turns.map((t) => t.content)).toEqual(["một"]);
  });
  it("★★★ HAI ghi song song cùng version ⇒ đúng MỘT thắng, không mất cập nhật", async () => {
    if (!coDb) return;
    const a = await tao(idA);
    const [x, y] = await Promise.all([
      kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "X" }] }),
      kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "Y" }] }),
    ]);
    expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    const m = await kho.mo(idA, a.id);
    expect(m.ok && m.phien.turns.length).toBe(1);
    expect(m.ok && m.phien.version).toBe(2);
  });
  it("lượt lạ (actionId/token/role tool) bị chiếu bỏ ở cửa GHI; nhãn tự suy từ câu hỏi đầu; contextPct ghi lại", async () => {
    if (!coDb) return;
    const a = await tao(idA);
    const r = await kho.themLuot(idA, {
      sessionId: a.id,
      expectedVersion: 1,
      luot: [{ role: "user", content: "Sửa lỗi đăng nhập", actionId: "x", token: "y" }, { role: "tool", content: "KQ" }, { role: "assistant", content: "Xong" }],
      contextPct: 83,
    });
    expect(r).toMatchObject({ ok: true, turnCount: 2 });
    const m = await kho.mo(idA, a.id);
    expect(m.ok && m.phien.turns).toEqual([{ role: "user", content: "Sửa lỗi đăng nhập" }, { role: "assistant", content: "Xong" }]);
    expect(m.ok && m.phien.title).toBe("Sửa lỗi đăng nhập");
    expect(m.ok && m.phien.contextPct).toBe(83);
  });
  it("tham số méo ⇒ THAM_SO_SAI (version 0, luot rỗng, quá 40 lượt, contextPct ngoài khoảng)", async () => {
    if (!coDb) return;
    const a = await tao(idA);
    const L = [{ role: "user", content: "x" }];
    expect(await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 0, luot: L })).toMatchObject({ ma: "THAM_SO_SAI" });
    expect(await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [] })).toMatchObject({ ma: "THAM_SO_SAI" });
    expect(await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: Array.from({ length: 41 }, () => L[0]) })).toMatchObject({ ma: "THAM_SO_SAI" });
    expect(await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: L, contextPct: 500 })).toMatchObject({ ma: "THAM_SO_SAI" });
  });
  it("doiTen có expectedVersion lệch ⇒ CONFLICT; không có ⇒ đổi được; rỗng ⇒ về nhãn suy", async () => {
    if (!coDb) return;
    const a = await tao(idA);
    await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "Câu đầu" }] });
    expect(await kho.doiTen(idA, { sessionId: a.id, title: "Tên mới", expectedVersion: 1 })).toMatchObject({ ok: false, ma: "CONFLICT", versionHienTai: 2 });
    expect(await kho.doiTen(idA, { sessionId: a.id, title: "Tên mới" })).toEqual({ ok: true, title: "Tên mới" });
    expect(await kho.doiTen(idA, { sessionId: a.id, title: "  " })).toEqual({ ok: true, title: "Câu đầu" });
  });
});

describe("kho — runIds (M8b) + xoá không đụng sổ kiểm toán", () => {
  it("★★★ ganLuotChay: lượt CỦA MÌNH cùng dự án ⇒ gắn (idempotent); lượt của NGƯỜI KHÁC / khác dự án / không có ⇒ không gắn", async () => {
    if (!coDb) return;
    const a = await tao(idA, "agent");
    const runA = await mkRun(idA);
    const runB = await mkRun(idB);
    const runAKhacDa = await mkRun(idA, "du-an-khac");
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: runA })).toBe(true);
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: runA })).toBe(false); // đã có
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: runB })).toBe(false);
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: runAKhacDa })).toBe(false);
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: randomUUID() })).toBe(false);
    expect(await kho.ganLuotChay(idB, { sessionId: a.id, runId: runB })).toBe(false); // phiên của A
    const m = await kho.mo(idA, a.id);
    expect(m.ok && m.phien.runIds).toEqual([runA]);
  });
  it("★★★ runIds BỊ ĐẦU ĐỘC bằng SQL thẳng (lượt của người khác) ⇒ `mo` lọc lại theo chủ, không rò", async () => {
    if (!coDb) return;
    const a = await tao(idA, "agent");
    const runA = await mkRun(idA);
    const runB = await mkRun(idB);
    const db = await getDb();
    await db!.execute(sql`UPDATE ai_coding_sessions SET "runIds" = ${JSON.stringify([runA, runB, "rac"])}::jsonb WHERE id = ${a.id}::uuid`);
    const m = await kho.mo(idA, a.id);
    expect(m.ok && m.phien.runIds).toEqual([runA]);
  });
  it("trần 50 lượt chạy mỗi phiên", async () => {
    if (!coDb) return;
    const a = await tao(idA, "agent");
    const db = await getDb();
    const day = Array.from({ length: kho.TRAN_LUOT_CHAY_MOI_PHIEN }, () => randomUUID());
    await db!.execute(sql`UPDATE ai_coding_sessions SET "runIds" = ${JSON.stringify(day)}::jsonb WHERE id = ${a.id}::uuid`);
    expect(await kho.ganLuotChay(idA, { sessionId: a.id, runId: await mkRun(idA) })).toBe(false);
  });
  it("★★★ xoá phiên KHÔNG xoá ai_agent_runs (sổ kiểm toán)", async () => {
    if (!coDb) return;
    const a = await tao(idA, "agent");
    const run = await mkRun(idA);
    await kho.ganLuotChay(idA, { sessionId: a.id, runId: run });
    expect(await kho.xoa(idA, a.id)).toEqual({ ok: true });
    const db = await getDb();
    const r = await db!.select({ id: aiAgentRuns.id }).from(aiAgentRuns).where(eq(aiAgentRuns.id, run));
    expect(r.length).toBe(1);
    expect(await kho.mo(idA, a.id)).toEqual({ ok: false, ma: "NOT_FOUND" });
  });
});

describe("kho — nhân bản / nộp tóm tắt / coLuotNgoai lan truyền", () => {
  it("★★★ nhanBan sao turns + kind + parentSessionId; coLuotNgoai=true ⇒ true; gốc không đổi", async () => {
    if (!coDb) return;
    const a = await tao(idA, "agent", "goc");
    await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "dẫn từ nội dung ngoài" }] });
    const db = await getDb();
    await db!.execute(sql`UPDATE ai_coding_sessions SET "coLuotNgoai" = true WHERE id = ${a.id}::uuid`);
    const b = await kho.nhanBan(idA, a.id);
    if (!b.ok) throw new Error(b.ma);
    const m = await kho.mo(idA, b.id);
    expect(m.ok && m.phien).toMatchObject({ kind: "agent", parentSessionId: a.id, coLuotNgoai: true, turnCount: 1 });
    expect(m.ok && m.phien.title).toBe("goc (bản sao)");
    const goc = await kho.mo(idA, a.id);
    expect(goc.ok && goc.phien.version).toBe(2);
  });
  it("★★★ nopTomTat: phiên mới (cha = cũ, cùng kind, coLuotNgoai sao nguyên), phiên cũ giữ nguyên; version lệch ⇒ CONFLICT", async () => {
    if (!coDb) return;
    const a = await tao(idA, "coding", "dài");
    await kho.themLuot(idA, { sessionId: a.id, expectedVersion: 1, luot: [{ role: "user", content: "x" }] });
    const db = await getDb();
    await db!.execute(sql`UPDATE ai_coding_sessions SET "coLuotNgoai" = true WHERE id = ${a.id}::uuid`);
    expect(await kho.nopTomTat(idA, { sessionId: a.id, expectedVersion: 1, tomTat: "tóm tắt" })).toMatchObject({ ok: false, ma: "CONFLICT", versionHienTai: 2 });
    const r = await kho.nopTomTat(idA, { sessionId: a.id, expectedVersion: 2, tomTat: "Đã sửa A, còn B." });
    if (!r.ok) throw new Error(r.ma);
    const m = await kho.mo(idA, r.id);
    expect(m.ok && m.phien).toMatchObject({ kind: "coding", parentSessionId: a.id, coLuotNgoai: true });
    expect(m.ok && m.phien.turns[0]).toMatchObject({ role: "assistant" });
    expect(m.ok && m.phien.turns[0]!.content).toContain("Đã sửa A, còn B.");
    const cu = await kho.mo(idA, a.id);
    expect(cu.ok && cu.phien.turnCount).toBe(1);
    expect(await kho.nopTomTat(idA, { sessionId: a.id, expectedVersion: 2, tomTat: "" })).toMatchObject({ ma: "THAM_SO_SAI" });
    expect(await kho.nopTomTat(idA, { sessionId: a.id, expectedVersion: 2, tomTat: "x".repeat(kho.TRAN_KY_TU_TOM_TAT_PHIEN + 1) })).toMatchObject({ ma: "THAM_SO_SAI" });
  });
});

describe("kho — trần số phiên mỗi người (không xoá ngầm)", () => {
  it("★★★ đủ 500 ⇒ tao / nhanBan / nopTomTat đều QUA_TRAN_PHIEN; không phiên nào bị xoá", async () => {
    if (!coDb) return;
    const db = await getDb();
    const a = await tao(idB, "coding", "giu-lai");
    await db!.execute(sql`
      INSERT INTO ai_coding_sessions ("userId", "projectId", kind, source)
      SELECT ${idB}, ${DU_AN}, 'coding', 'web' FROM generate_series(1, ${kho.TRAN_PHIEN_MOI_NGUOI})`);
    expect(await kho.tao(idB, { projectId: DU_AN, kind: "agent", source: "web" })).toEqual({ ok: false, ma: "QUA_TRAN_PHIEN" });
    expect(await kho.nhanBan(idB, a.id)).toEqual({ ok: false, ma: "QUA_TRAN_PHIEN" });
    expect(await kho.nopTomTat(idB, { sessionId: a.id, expectedVersion: 1, tomTat: "x" })).toEqual({ ok: false, ma: "QUA_TRAN_PHIEN" });
    const con = await kho.mo(idB, a.id);
    expect(con.ok).toBe(true);
    await db!.execute(sql`DELETE FROM ai_coding_sessions WHERE "userId" = ${idB}`);
    expect((await kho.tao(idB, { projectId: DU_AN, kind: "coding", source: "cli" })).ok).toBe(true);
  }, 60_000);
});

describe("kho — chat CHỈ ĐỌC (phép chiếu)", () => {
  it("★★★ danhSachChat: chỉ cuộc chat CỦA MÌNH, id 'chat:<n>', cờ coLuotNgoai; không ghi gì", async () => {
    if (!coDb) return;
    const db = await getDb();
    await db!.execute(sql`INSERT INTO ai_chat_conversations ("userId", title, "messageCount", "coLuotNgoai") VALUES (${idA}, 'chat cua A', 3, true), (${idB}, 'chat cua B', 1, false)`);
    const a = await kho.danhSachChat(idA);
    expect(a.map((c) => c.title)).toContain("chat cua A");
    expect(a.map((c) => c.title)).not.toContain("chat cua B");
    const mot = a.find((c) => c.title === "chat cua A")!;
    expect(mot).toMatchObject({ kind: "chat", source: "web", projectId: null, turnCount: 3, coLuotNgoai: true, version: 0 });
    expect(mot.id).toMatch(/^chat:\d+$/);
    const sau = await db!.execute(sql`SELECT count(*)::int AS n FROM ai_coding_sessions WHERE kind = 'chat'`);
    expect((sau as unknown as Array<{ n: number }>)[0]!.n).toBe(0);
  });
});

describe("router aiPhien — quyền, chat, zod strict", () => {
  it("★★★ không có ai_repo_read ⇒ PERMISSION_DENIED ở mọi thủ tục coding/agent; 'all' ⇒ chỉ phần chat, không lỗi", async () => {
    if (!coDb) return;
    const c = caller(idKhongQuyen);
    expect(await c.mo({ sessionId: uuidLa })).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await c.tao({ projectId: DU_AN, kind: "coding", source: "web" })).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    expect(await c.themLuot({ sessionId: uuidLa, expectedVersion: 1, luot: [{ role: "user", content: "x" }] })).toMatchObject({ note: "PERMISSION_DENIED" });
    expect(await c.xoa({ sessionId: uuidLa })).toMatchObject({ note: "PERMISSION_DENIED" });
    expect(await c.danhSach({ projectId: DU_AN, kind: "coding" })).toMatchObject({ ok: false, note: "PERMISSION_DENIED" });
    const db = await getDb();
    await db!.execute(sql`INSERT INTO ai_chat_conversations ("userId", title, "messageCount") VALUES (${idKhongQuyen}, 'chat kq', 2)`);
    const all = await c.danhSach({ projectId: DU_AN, kind: "all" });
    expect(all.ok).toBe(true);
    expect(all.sessions.map((s) => s.title)).toEqual(["chat kq"]);
  });
  it("id 'chat:*' ở mo/themLuot/doiTen/nhanBan/xoa/nopTomTat ⇒ NOT_FOUND (client dùng aiChat.*)", async () => {
    if (!coDb) return;
    const c = caller(idA);
    expect(await c.mo({ sessionId: "chat:5" })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await c.themLuot({ sessionId: "chat:5", expectedVersion: 1, luot: [{ role: "user", content: "x" }] })).toMatchObject({ note: "NOT_FOUND" });
    expect(await c.doiTen({ sessionId: "chat:5", title: "x" })).toMatchObject({ note: "NOT_FOUND" });
    expect(await c.nhanBan({ sessionId: "chat:5" })).toMatchObject({ note: "NOT_FOUND" });
    expect(await c.xoa({ sessionId: "chat:5" })).toMatchObject({ note: "NOT_FOUND" });
    expect(await c.nopTomTat({ sessionId: "chat:5", expectedVersion: 1, tomTat: "x" })).toMatchObject({ note: "NOT_FOUND" });
  });
  it("★★★ một lượt mang actionId/token ⇒ zod .strict() TỪ CHỐI CẢ LƯỢT GỌI; role tool bị từ chối; kind chat không tạo được", async () => {
    if (!coDb) return;
    const c = caller(idA);
    const t = await c.tao({ projectId: DU_AN, kind: "agent", source: "vscode" });
    if (!t.ok || !t.id) throw new Error("tao");
    await expect(c.themLuot({ sessionId: t.id, expectedVersion: 1, luot: [{ role: "user", content: "x", actionId: "a" } as never] })).rejects.toThrow();
    await expect(c.themLuot({ sessionId: t.id, expectedVersion: 1, luot: [{ role: "tool", content: "x" } as never] })).rejects.toThrow();
    await expect(c.tao({ projectId: DU_AN, kind: "chat" as never, source: "web" })).rejects.toThrow();
    await expect(c.tao({ projectId: DU_AN, kind: "coding", source: "tivi" as never })).rejects.toThrow();
  });
  it("★★★ luồng đầy đủ qua router + chéo tài khoản: A tạo/ghi/đổi tên/nhân bản/xoá; B chỉ thấy NOT_FOUND", async () => {
    if (!coDb) return;
    const a = caller(idA);
    const b = caller(idB);
    const t = await a.tao({ projectId: DU_AN, kind: "coding", source: "cli", title: "qua router" });
    if (!t.ok || !t.id) throw new Error("tao");
    expect(await a.themLuot({ sessionId: t.id, expectedVersion: 1, luot: [{ role: "user", content: "hi" }], contextPct: 10 })).toMatchObject({ ok: true, version: 2 });
    expect(await a.themLuot({ sessionId: t.id, expectedVersion: 1, luot: [{ role: "user", content: "lac" }] })).toMatchObject({ ok: false, note: "CONFLICT", versionHienTai: 2 });
    expect(await b.mo({ sessionId: t.id })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await b.xoa({ sessionId: t.id })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect((await b.danhSach({ projectId: DU_AN, kind: "coding" })).sessions.map((s) => s.id)).not.toContain(t.id);
    const dup = await a.nhanBan({ sessionId: t.id });
    expect(dup.ok).toBe(true);
    expect(await a.doiTen({ sessionId: t.id, title: "Tên" })).toMatchObject({ ok: true, title: "Tên" });
    expect(await a.xoa({ sessionId: t.id })).toMatchObject({ ok: true });
    expect(await a.mo({ sessionId: t.id })).toMatchObject({ ok: false, note: "NOT_FOUND" });
  });
  it("dự án ngoài danh sách trắng ⇒ PROJECT_NOT_FOUND; chưa đăng nhập ⇒ ném", async () => {
    if (!coDb) return;
    expect(await caller(idA).tao({ projectId: "khong-co-du-an-nay", kind: "coding", source: "web" })).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
    await expect(aiPhienRouter.createCaller({ user: null } as never).danhSach({ projectId: DU_AN })).rejects.toThrow();
  });
});

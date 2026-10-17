/**
 * ★★★ Đợt 3a — LƯỚI VÒNG THẬT (CSDL `_test` đã áp 0393 + hệ tệp tạm + git thật) cho bốn thủ tục dự án CÁ NHÂN của
 * `repoWorkspaceRouter` và cách chúng nối vào cửa phân giải dự án:
 *   §1 RBAC: kỹ sư có `ai_repo_read` + `ai_repo_exec` tạo được (KHÔNG cần admin/2FA); thiếu `ai_repo_exec` ⇒
 *      PERMISSION_DENIED và KHÔNG hàng nào; không `ai_repo_read` ⇒ không xem được danh sách.
 *   §2 tạo xong ⇒ hàng CSDL mang chủ + cách tạo; `listProjects` của CHỦ có ngay (không restart); của người khác KHÔNG.
 *   §3 cách ly qua tuyến THẬT: người khác `readFile`/`listFiles`/`luuPhien` trên dự án ấy ⇒ PROJECT_NOT_FOUND; chủ đọc
 *      được; admin thấy trong `danhSachDayDu` kèm `chuSoHuu`.
 *   §4 đổi tên / xoá (thùng rác) qua tuyến; người khác không đổi/xoá được.
 * ⚠ Dọn GIỚI HẠN theo đúng id người dùng file này tạo (vitest chạy song song trên MỘT CSDL test).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inArray } from "drizzle-orm";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { getDb } from "../db/connection";
import { users, permissions, aiRepoDuAn, aiCodingSessions } from "../../drizzle/schema";
import { repoWorkspaceRouter } from "./repoWorkspaceRouter";
import { phanGiaiGoc } from "../services/aiLocalTools/repoProjects";
import { BIEN_GOC_DU_AN_CA_NHAN } from "../services/aiLocalTools/gocDuAnCaNhan";

const TAG = `dacn${Date.now().toString(36)}`;
let GOC = "";
let idA = 0;
let idB = 0;
let idChiDoc = 0;
let idAdmin = 0;
let coDb = false;
let gocCu: string | undefined;

const caller = (id: number, role = "engineer") =>
  repoWorkspaceRouter.createCaller({ user: { id, role, twoFactorEnabled: false } } as never);

async function mkUser(tag: string, role: "engineer" | "admin", quyen: Array<"ai_repo_read" | "ai_repo_exec">): Promise<number> {
  const db = await getDb();
  const [u] = await db!
    .insert(users)
    .values({ openId: `${TAG}_${tag}`, username: `${TAG}_${tag}`, name: `dacn ${tag}`, role, loginMethod: "local" })
    .returning({ id: users.id });
  for (const q of quyen) {
    await db!.insert(permissions).values({
      userId: u!.id,
      category: "settings",
      moduleName: q,
      canView: q === "ai_repo_read",
      canCreate: q === "ai_repo_exec",
      canEdit: false,
      canDelete: false,
      canExport: false,
    });
  }
  return u!.id;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) return;
  coDb = true;
  GOC = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "dacn-router-")));
  gocCu = process.env[BIEN_GOC_DU_AN_CA_NHAN];
  process.env[BIEN_GOC_DU_AN_CA_NHAN] = GOC;
  idA = await mkUser("a", "engineer", ["ai_repo_read", "ai_repo_exec"]);
  idB = await mkUser("b", "engineer", ["ai_repo_read", "ai_repo_exec"]);
  idChiDoc = await mkUser("chidoc", "engineer", ["ai_repo_read"]);
  idAdmin = await mkUser("admin", "admin", []);
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    const ids = [idA, idB, idChiDoc, idAdmin].filter((x) => x > 0);
    if (ids.length > 0) {
      await db.delete(aiRepoDuAn).where(inArray(aiRepoDuAn.chuSoHuu, ids));
      await db.delete(aiCodingSessions).where(inArray(aiCodingSessions.userId, ids));
      await db.delete(permissions).where(inArray(permissions.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
  }
  if (gocCu === undefined) delete process.env[BIEN_GOC_DU_AN_CA_NHAN];
  else process.env[BIEN_GOC_DU_AN_CA_NHAN] = gocCu;
  try { fs.rmSync(GOC, { recursive: true, force: true }); } catch { /* best-effort */ }
});

let idDuAn = "";

it("★ thiết bị đo: CSDL `_test` CÓ MẶT (nếu không, mọi ca dưới `return` sớm và xanh vì lý do sai)", () => {
  expect(coDb).toBe(true);
});

describe("§1 — RBAC: kỹ sư (không admin/2FA) tạo được; thiếu ai_repo_exec ⇒ từ chối", () => {
  it("★★★ chỉ có ai_repo_read ⇒ PERMISSION_DENIED, KHÔNG hàng, KHÔNG thư mục", async () => {
    if (!coDb) return;
    const r = await caller(idChiDoc).taoDuAnCaNhan({ ten: "x", cachTao: "rong" });
    expect(r).toMatchObject({ ok: false, ma: "PERMISSION_DENIED" });
    const db = await getDb();
    expect(await db!.select().from(aiRepoDuAn).where(inArray(aiRepoDuAn.chuSoHuu, [idChiDoc]))).toEqual([]);
    expect(fs.existsSync(path.join(GOC, `u${idChiDoc}`))).toBe(false);
    const ds = await caller(idChiDoc).duAnCuaToi();
    expect(ds).toMatchObject({ ok: true, coQuyenTao: false });
  });

  it("★★★ kỹ sư A (engineer, CHƯA 2FA) tạo dự án từ khuôn python ⇒ ok, hàng mang chủ + cách tạo", async () => {
    if (!coDb) return;
    const r = await caller(idA).taoDuAnCaNhan({ ten: "Dự án của A", cachTao: "khuon", khuon: "python" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    idDuAn = r.id!;
    const db = await getDb();
    const hang = await db!.select().from(aiRepoDuAn).where(inArray(aiRepoDuAn.id, [idDuAn]));
    expect(hang).toHaveLength(1);
    expect(hang[0]).toMatchObject({ chuSoHuu: idA, cachTao: "khuon", ten: "Dự án của A", nguoiTao: idA });
    expect(hang[0]!.goc.toLowerCase().startsWith(path.join(GOC, `u${idA}`).toLowerCase())).toBe(true);
  });
});

describe("§2 — danh sách theo người gọi (không restart)", () => {
  it("★★★ listProjects của A có dự án (cuaToi); của B KHÔNG; duAnCuaToi của A có, của B rỗng", async () => {
    if (!coDb || !idDuAn) return;
    const la = await caller(idA).listProjects();
    expect(la.projects.find((p) => p.id === idDuAn)).toMatchObject({ caNhan: true, cuaToi: true, name: "Dự án của A" });
    const lb = await caller(idB).listProjects();
    expect(lb.projects.map((p) => p.id)).not.toContain(idDuAn);
    expect((await caller(idA).duAnCuaToi()).projects.map((p) => p.id)).toEqual([idDuAn]);
    expect((await caller(idB).duAnCuaToi()).projects).toEqual([]);
  });

  it("★★ admin thấy dự án cá nhân (hậu tố chủ) và `danhSachDayDu` mang chuSoHuu", async () => {
    if (!coDb || !idDuAn) return;
    const l = await caller(idAdmin, "admin").listProjects();
    expect(l.projects.find((p) => p.id === idDuAn)).toMatchObject({ caNhan: true, cuaToi: false, name: `Dự án của A · u${idA}` });
    const full = await repoWorkspaceRouter
      .createCaller({ user: { id: idAdmin, role: "admin", twoFactorEnabled: true } } as never)
      .danhSachDayDu();
    expect(full.projects.find((p) => p.id === idDuAn)).toMatchObject({ chuSoHuu: idA, nguon: "db" });
  });
});

describe("§3 — CÁCH LY qua tuyến THẬT", () => {
  it("★★★ B đọc tệp / liệt kê / lưu phiên trên dự án của A ⇒ PROJECT_NOT_FOUND; A đọc được", async () => {
    if (!coDb || !idDuAn) return;
    const ra = await caller(idA).readFile({ path: "main.py", projectId: idDuAn });
    expect(ra.ok, JSON.stringify(ra)).toBe(true);
    expect(ra.data?.content).toContain("Xin chào");

    expect(await caller(idB).readFile({ path: "main.py", projectId: idDuAn })).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
    expect(await caller(idB).listFiles({ projectId: idDuAn })).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
    expect(await caller(idB).listFiles({ projectId: idDuAn, phang: true })).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
    const lp = await caller(idB).luuPhien({ projectId: idDuAn, sessionId: null, turns: [{ role: "user", content: "x" }] });
    expect(lp).toMatchObject({ ok: false, note: "PROJECT_NOT_FOUND" });
  });

  it("★★★ phanGiaiGoc trực tiếp: chủ ok · admin ok · B / null ⇒ PROJECT_NOT_FOUND", () => {
    if (!coDb || !idDuAn) return;
    expect(phanGiaiGoc(idDuAn, { id: idA, role: "engineer" }).ok).toBe(true);
    expect(phanGiaiGoc(idDuAn, { id: idAdmin, role: "admin" }).ok).toBe(true);
    expect(phanGiaiGoc(idDuAn, { id: idB, role: "engineer" })).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    expect(phanGiaiGoc(idDuAn, null)).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
  });
});

describe("§4 — đổi tên / xoá qua tuyến", () => {
  it("★★★ B không đổi tên/xoá được (KHONG_TIM_THAY); A đổi tên ⇒ CSDL đổi (quyền UPDATE(ten) của 0393)", async () => {
    if (!coDb || !idDuAn) return;
    expect(await caller(idB).doiTenDuAnCaNhan({ id: idDuAn, ten: "Cướp" })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await caller(idB).xoaDuAnCaNhan({ id: idDuAn })).toEqual({ ok: false, ma: "KHONG_TIM_THAY" });
    expect(await caller(idA).doiTenDuAnCaNhan({ id: idDuAn, ten: "Tên mới" })).toEqual({ ok: true, ma: null });
    const la = await caller(idA).listProjects();
    expect(la.projects.find((p) => p.id === idDuAn)?.name).toBe("Tên mới");
  });

  it("★★★ A xoá ⇒ thư mục vào `.thung-rac`, hàng biến mất, dự án không phân giải được nữa", async () => {
    if (!coDb || !idDuAn) return;
    const truoc = phanGiaiGoc(idDuAn, { id: idA, role: "engineer" });
    expect(truoc.ok).toBe(true);
    expect(await caller(idA).xoaDuAnCaNhan({ id: idDuAn })).toEqual({ ok: true, ma: null });
    const rac = fs.readdirSync(path.join(GOC, ".thung-rac"));
    expect(rac.some((t) => t.endsWith(`__${idDuAn}`))).toBe(true);
    if (truoc.ok) expect(fs.existsSync(truoc.goc!)).toBe(false);
    expect(phanGiaiGoc(idDuAn, { id: idA, role: "engineer" })).toEqual({ ok: false, ma: "PROJECT_NOT_FOUND" });
    const db = await getDb();
    expect(await db!.select().from(aiRepoDuAn).where(inArray(aiRepoDuAn.id, [idDuAn]))).toEqual([]);
  });
});

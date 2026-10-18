/**
 * ★★★ Đợt 5.1 — tầng dữ liệu `ai_agent_feedback` (mig 0397) trên CSDL `_test` THẬT, vai `avi_app`.
 *
 * Canh BẤT BIẾN, không canh danh sách:
 *   • MỘT phiếu cho mỗi (người × khối trả lời) / (người × đề xuất ghi) — bấm lại là SỬA, không nhân bản;
 *   • PHẠM VI CHỦ: người B không thấy, không sửa được phiếu của A (cùng runId/actionId ⇒ B có hàng RIÊNG);
 *   • quyết định duyệt/bác (từ cửa duyệt thật) và phiếu (từ nút) GỘP vào một hàng, không đè nhau;
 *   • bộ đọc xuất: CHỈ diff ĐƯỢC DUYỆT, không 👎; `null` = mọi người (admin), id = chỉ người đó;
 *   • tìm lượt chạy theo đề xuất: chỉ trong lượt chạy CỦA người gọi.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { createLocalUser } from "./auth";
import {
  danhSachPhanHoiCuaToi,
  docHangChoXuat,
  ghiPhieuDiff,
  ghiPhieuTraLoi,
  ghiQuyetDinhDiff,
  timRunTheoAction,
  tongHopPhanHoi,
} from "./aiAgentFeedback";
import { aiAgentFeedback, aiAgentRuns } from "../../drizzle/schema";
import { users, userSecrets } from "../../drizzle/schema/auth";

let uA = 0;
let uB = 0;
let tenDb = "(chưa đo)";
const RUN = randomUUID();
const ACT = `t51-${Date.now().toString(36)}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("không có CSDL");
  const [d] = (await db.execute(sql`SELECT current_database() AS d`)) as unknown as Array<{ d: string }>;
  tenDb = d!.d;
  const t = Date.now();
  uA = (await createLocalUser({ username: `t51-a-${t}`, passwordHash: "x", name: "A", role: "engineer" })).id;
  uB = (await createLocalUser({ username: `t51-b-${t}`, passwordHash: "x", name: "B", role: "engineer" })).id;
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ds = [uA, uB].filter((x) => x > 0);
  if (ds.length) {
    await db.delete(aiAgentFeedback).where(inArray(aiAgentFeedback.userId, ds));
    await db.delete(aiAgentRuns).where(inArray(aiAgentRuns.userId, ds));
    await db.delete(userSecrets).where(inArray(userSecrets.userId, ds));
    await db.delete(users).where(inArray(users.id, ds));
  }
}, 60_000);

async function demHang(userId: number): Promise<number> {
  const db = (await getDb())!;
  return (await db.select().from(aiAgentFeedback).where(eq(aiAgentFeedback.userId, userId))).length;
}

describe(`§1 phiếu câu trả lời — upsert một hàng, bỏ phiếu = xoá (CSDL đo: current_database())`, () => {
  it("CSDL là bản _test", () => {
    expect(tenDb).toMatch(/_test$/);
  });

  it("ghi 👍 rồi đổi 👎 + lý do ⇒ VẪN một hàng; bỏ phiếu ⇒ 0 hàng", async () => {
    const goc = { userId: uA, runId: RUN, chiSoTin: 0, projectId: "repo", lyDo: null, cauHoi: "Hỏi gì", noiDung: "Trả lời" };
    const k1 = await ghiPhieuTraLoi({ ...goc, danhGia: 1 });
    expect(k1.ok && k1.hang?.danhGia).toBe(1);
    const k2 = await ghiPhieuTraLoi({ ...goc, danhGia: -1, lyDo: "sai API" });
    expect(k2.ok && k2.hang).toMatchObject({ danhGia: -1, lyDo: "sai API", loai: "tra-loi", chiSoTin: 0 });
    expect(await demHang(uA)).toBe(1);
    const k3 = await ghiPhieuTraLoi({ ...goc, danhGia: null });
    expect(k3).toEqual({ ok: true, hang: null });
    expect(await demHang(uA)).toBe(0);
  });

  it("B bỏ phiếu CÙNG runId/khối ⇒ hàng RIÊNG của B; phiếu của A không đổi; danh sách mỗi người chỉ thấy của mình", async () => {
    await ghiPhieuTraLoi({ userId: uA, runId: RUN, chiSoTin: 1, projectId: "repo", danhGia: 1, lyDo: null, cauHoi: "q", noiDung: "a" });
    await ghiPhieuTraLoi({ userId: uB, runId: RUN, chiSoTin: 1, projectId: "repo", danhGia: -1, lyDo: "B ghét", cauHoi: "q", noiDung: "a" });
    const cuaA = await danhSachPhanHoiCuaToi(uA);
    const cuaB = await danhSachPhanHoiCuaToi(uB);
    expect(cuaA.map((h) => h.danhGia)).toEqual([1]);
    expect(cuaB.map((h) => h.danhGia)).toEqual([-1]);
    expect(JSON.stringify(cuaA)).not.toContain("B ghét");
  });
});

describe("§2 diff — phiếu (nút) + quyết định (cửa duyệt thật) gộp MỘT hàng", () => {
  const coBan = { runId: RUN, projectId: "repo", cauHoi: "Sửa hàm cộng", noiDung: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n", duongDan: "a.ts" };

  it("quyết định 'bac' + lý do trước, phiếu 👎 sau ⇒ một hàng mang CẢ HAI", async () => {
    const q = await ghiQuyetDinhDiff({ userId: uA, actionId: `${ACT}-1`, quyetDinh: "bac", lyDoBac: "đổi tên sai", ...coBan });
    expect(q.ok).toBe(true);
    const p = await ghiPhieuDiff({ userId: uA, actionId: `${ACT}-1`, danhGia: -1, lyDo: "model bịa", ...coBan });
    expect(p.ok && p.hang).toMatchObject({ quyetDinh: "bac", lyDoBac: "đổi tên sai", danhGia: -1, lyDo: "model bịa", duongDan: "a.ts" });
    expect((await danhSachPhanHoiCuaToi(uA)).filter((h) => h.actionId === `${ACT}-1`)).toHaveLength(1);
  });

  it("bỏ phiếu trên hàng CÓ quyết định ⇒ hàng còn (giữ quyết định); trên hàng KHÔNG quyết định ⇒ xoá", async () => {
    const p0 = await ghiPhieuDiff({ userId: uA, actionId: `${ACT}-1`, danhGia: null, lyDo: null, ...coBan });
    expect(p0.ok && p0.hang).toMatchObject({ quyetDinh: "bac", danhGia: null });
    await ghiPhieuDiff({ userId: uA, actionId: `${ACT}-2`, danhGia: 1, lyDo: null, ...coBan });
    const p1 = await ghiPhieuDiff({ userId: uA, actionId: `${ACT}-2`, danhGia: null, lyDo: null, ...coBan });
    expect(p1).toEqual({ ok: true, hang: null });
    expect((await danhSachPhanHoiCuaToi(uA)).some((h) => h.actionId === `${ACT}-2`)).toBe(false);
  });

  it("quyết định ghi lần hai KHÔNG đè ảnh chụp đã có (chỉ dẫn/diff đầu tiên giữ nguyên)", async () => {
    await ghiQuyetDinhDiff({ userId: uA, actionId: `${ACT}-3`, quyetDinh: "duyet", lyDoBac: null, ...coBan });
    const k = await ghiQuyetDinhDiff({ userId: uA, actionId: `${ACT}-3`, quyetDinh: "duyet", lyDoBac: null, ...coBan, cauHoi: "KHÁC", noiDung: "KHÁC" });
    expect(k.ok && k.hang).toMatchObject({ quyetDinh: "duyet" });
    const [h] = await docHangChoXuat(uA);
    expect(h).toMatchObject({ actionId: `${ACT}-3`, cauHoi: "Sửa hàm cộng" });
  });
});

describe("§3 xuất + tổng hợp + tìm lượt chạy", () => {
  it("docHangChoXuat: chỉ diff DUYỆT, không 👎; null ⇒ mọi người; id ⇒ chỉ người đó", async () => {
    await ghiQuyetDinhDiff({ userId: uB, actionId: `${ACT}-b1`, quyetDinh: "duyet", lyDoBac: null, runId: null, projectId: "repo", cauHoi: "q", noiDung: "d", duongDan: "b.ts" });
    await ghiQuyetDinhDiff({ userId: uB, actionId: `${ACT}-b2`, quyetDinh: "duyet", lyDoBac: null, runId: null, projectId: "repo", cauHoi: "q", noiDung: "d", duongDan: "c.ts" });
    await ghiPhieuDiff({ userId: uB, actionId: `${ACT}-b2`, danhGia: -1, lyDo: "tệ", runId: null, projectId: "repo", cauHoi: "q", noiDung: "d", duongDan: "c.ts" });
    const tatCa = (await docHangChoXuat(null)).filter((h) => String(h.actionId).startsWith(ACT));
    expect(tatCa.map((h) => h.actionId).sort()).toEqual([`${ACT}-3`, `${ACT}-b1`]);
    expect((await docHangChoXuat(uB)).map((h) => h.actionId)).toEqual([`${ACT}-b1`]);
  });

  it("tongHopPhanHoi đếm theo loại / phiếu / quyết định (≥ số hàng lưới vừa tạo)", async () => {
    const t = await tongHopPhanHoi();
    expect(t).not.toBeNull();
    expect(t!.traLoi.len + t!.traLoi.xuong).toBeGreaterThanOrEqual(2);
    expect(t!.diff.duyet).toBeGreaterThanOrEqual(2);
    expect(t!.diff.bac).toBeGreaterThanOrEqual(1);
    expect(t!.soNguoi).toBeGreaterThanOrEqual(2);
  });

  it("timRunTheoAction: tìm lượt chạy CỦA MÌNH có thẻ can-duyet mang pendingActionId; người khác ⇒ null", async () => {
    const db = (await getDb())!;
    const runId = randomUUID();
    const actionId = randomUUID();
    await db.insert(aiAgentRuns).values({
      id: runId,
      userId: uA,
      projectId: "repo",
      cheDo: "sua",
      cauHoi: "Đổi tên biến x",
      suKien: [
        { seq: 1, suKien: { loai: "chu", noiDung: "ok" } },
        { seq: 2, suKien: { loai: "can-duyet", id: "g1", deXuat: { ten: "edit_file", thamSo: {}, pendingActionId: actionId } } },
      ],
    });
    expect(await timRunTheoAction(uA, actionId)).toEqual({ id: runId, projectId: "repo", cauHoi: "Đổi tên biến x" });
    expect(await timRunTheoAction(uB, actionId)).toBeNull();
    expect(await timRunTheoAction(uA, randomUUID())).toBeNull();
  });
});

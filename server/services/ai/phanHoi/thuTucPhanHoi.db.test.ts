/**
 * ★★★ Đợt 5.1 — đầu–cuối trên CSDL `_test` THẬT (vai `avi_app`), phụ thuộc THẬT (không tiêm):
 *   hàng `ai_pending_actions` (apply_diff, mang bí mật) + sổ `ai_agent_runs` (thẻ can-duyet trỏ tới hàng đó)
 *   ⇒ `ghiQuyetDinhTuCuaDuyet` (như cửa duyệt gọi) ⇒ `ai_agent_feedback` ⇒ `thuTucXuatBoDuLieu` ra JSONL đã che;
 *   ⇒ `thuTucPhanHoi` (tra-loi) đọc khối trả lời từ SỔ (lượt chạy không còn trong bộ nhớ) đúng chỉ số.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { createLocalUser } from "../../../db/auth";
import { aiAgentFeedback, aiAgentRuns, aiPendingActions } from "../../../../drizzle/schema";
import { users, userSecrets } from "../../../../drizzle/schema/auth";
import { danhSachPhanHoiCuaToi } from "../../../db/aiAgentFeedback";
import { ghiQuyetDinhTuCuaDuyet, thuTucPhanHoi, thuTucXuatBoDuLieu } from "./thuTucPhanHoi";

const BI_MAT = "sk-live-0123456789abcdefghijklmnop";
let uid = 0;
let uKhac = 0;
const RUN = randomUUID();
const ACT = randomUUID();

beforeAll(async () => {
  const t = Date.now();
  uid = (await createLocalUser({ username: `t51e-${t}`, passwordHash: "x", name: "A", role: "admin" })).id;
  uKhac = (await createLocalUser({ username: `t51e-k-${t}`, passwordHash: "x", name: "K", role: "admin" })).id;
  const db = (await getDb())!;
  await db.insert(aiPendingActions).values({
    id: ACT,
    tool: "apply_diff",
    argsJson: { path: "src/cong.ts", original: "export const a = 1;\n", modified: `export const a = 1;\nexport const KHOA = "api_key=${BI_MAT}";\n` },
    userId: uid,
    userRole: "admin",
    summary: "thêm hằng",
    status: "executed",
    idempotencyKey: `t51e-${ACT}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.insert(aiAgentRuns).values({
    id: RUN,
    userId: uid,
    projectId: "repo",
    cheDo: "sua",
    cauHoi: "Thêm hằng KHOA vào src/cong.ts",
    trangThai: "xong",
    suKien: [
      { seq: 1, suKien: { loai: "chu", noiDung: "Tôi sẽ " } },
      { seq: 2, suKien: { loai: "usage", vao: 1, ra: 1 } },
      { seq: 3, suKien: { loai: "chu", noiDung: "thêm hằng." } },
      { seq: 4, suKien: { loai: "can-duyet", id: "g1", deXuat: { ten: "edit_file", thamSo: {}, pendingActionId: ACT } } },
      { seq: 5, suKien: { loai: "chu", noiDung: "Đã xong." } },
    ],
  });
}, 60_000);

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  const ds = [uid, uKhac].filter((x) => x > 0);
  await db.delete(aiAgentFeedback).where(inArray(aiAgentFeedback.userId, ds));
  await db.delete(aiAgentRuns).where(inArray(aiAgentRuns.userId, ds));
  await db.delete(aiPendingActions).where(inArray(aiPendingActions.userId, ds));
  await db.delete(userSecrets).where(inArray(userSecrets.userId, ds));
  await db.delete(users).where(inArray(users.id, ds));
}, 60_000);

describe("đầu–cuối: cửa duyệt ⇒ sổ phản hồi ⇒ JSONL", () => {
  it("quyết định 'duyet' ghi ảnh chụp: chỉ dẫn TRỌN từ sổ lượt chạy, diff đã che, đường tương đối", async () => {
    await ghiQuyetDinhTuCuaDuyet({ id: uid, role: "admin" }, ACT, "duyet", null);
    const [h] = (await danhSachPhanHoiCuaToi(uid)).filter((x) => x.actionId === ACT);
    expect(h).toMatchObject({ loai: "diff", quyetDinh: "duyet", runId: RUN, projectId: "repo", duongDan: "src/cong.ts" });
    expect(h!.trichNoiDung).toContain("+export const KHOA");
    expect(h!.trichNoiDung).not.toContain(BI_MAT);
  });

  it("người KHÁC gọi cùng actionId ⇒ không ghi gì cho họ (hàng ai_pending_actions lọc chủ)", async () => {
    await ghiQuyetDinhTuCuaDuyet({ id: uKhac, role: "admin" }, ACT, "duyet", null);
    expect(await danhSachPhanHoiCuaToi(uKhac)).toEqual([]);
  });

  it("xuất JSONL của mình: 1 mẫu {chiDan, duong, diff}, không bí mật", async () => {
    const kq = await thuTucXuatBoDuLieu({ id: uid, role: "admin" }, {});
    expect(kq).toMatchObject({ ok: true, soMau: 1 });
    const m = JSON.parse(kq.jsonl.trim());
    expect(m).toMatchObject({ chiDan: "Thêm hằng KHOA vào src/cong.ts", duong: "src/cong.ts", runId: RUN, actionId: ACT });
    expect(m.diff).toMatch(/^--- a\/src\/cong\.ts/);
    expect(kq.jsonl).not.toContain(BI_MAT);
  });

  it("phiếu câu trả lời: khối 0 = 'Tôi sẽ thêm hằng.' (usage không cắt khối), khối 1 = 'Đã xong.'; khối 2 ⇒ NOT_FOUND", async () => {
    const k0 = await thuTucPhanHoi({ id: uid, role: "admin" }, { loai: "tra-loi", runId: RUN, chiSoTin: 0, danhGia: 1 });
    expect(k0).toMatchObject({ ok: true, phieu: { trichNoiDung: "Tôi sẽ thêm hằng.", danhGia: 1 } });
    const k1 = await thuTucPhanHoi({ id: uid, role: "admin" }, { loai: "tra-loi", runId: RUN, chiSoTin: 1, danhGia: -1, lyDo: "chưa chạy test" });
    expect(k1).toMatchObject({ ok: true, phieu: { trichNoiDung: "Đã xong.", lyDo: "chưa chạy test" } });
    expect(await thuTucPhanHoi({ id: uid, role: "admin" }, { loai: "tra-loi", runId: RUN, chiSoTin: 2, danhGia: 1 })).toMatchObject({ ok: false, note: "NOT_FOUND" });
    expect(await thuTucPhanHoi({ id: uKhac, role: "admin" }, { loai: "tra-loi", runId: RUN, chiSoTin: 0, danhGia: 1 })).toMatchObject({ ok: false, note: "NOT_FOUND" });
  });
});

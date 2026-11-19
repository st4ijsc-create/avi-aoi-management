/**
 * KIỂM THIẾT BỊ ĐO: `demHangRoRi` không MÙ. Phép đếm mặc định dùng kết nối riêng nên chỉ thấy hàng đã commit ⇒ "0 hàng" có thể là "không rò" HOẶC "bộ đếm mù" (sai bảng/cột/userId).
 * Ca này chèn 1 `audit_logs` + 1 `ai_pending_actions` mang userId thử TRONG giao dịch ROLLBACK rồi đếm TRONG chính giao dịch (bộ thực thi = `tx`) ⇒ phải ra 1 + 1; kết nối riêng cùng lúc phải ra 0 + 0
 * (hàng chưa commit không thấy được — đúng giả định của phát hiện rò rỉ). CSDL: chỉ `aoi_management_test` (skipIf). Mọi ghi nằm trong giao dịch luôn ROLLBACK; không DELETE / TRUNCATE.
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../db/connection";
import { aiPendingActions, auditLogs, users } from "../../drizzle/schema";
import { RollbackPhatLai, nuotRollback } from "./kenhGiaoDich";
import { demHangRoRi } from "./kiemRoRiDb";

const co = /aoi_management_test/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!co)("demHangRoRi — bộ đếm KHÔNG mù", () => {
  it("★★★ chèn 1 audit_logs + 1 ai_pending_actions mang userId thử trong giao dịch ROLLBACK: đếm bằng tx ⇒ 1 + 1; kết nối riêng ⇒ 0 + 0; userId khác ⇒ 0 + 0", async () => {
    const db = await getDb();
    if (!db) throw new Error("cần CSDL _test (DATABASE_URL)");
    const ket: { trongTx?: Awaited<ReturnType<typeof demHangRoRi>>; rieng?: Awaited<ReturnType<typeof demHangRoRi>>; khac?: Awaited<ReturnType<typeof demHangRoRi>> } = {};
    try {
      await db.transaction(async (tx) => {
        const ten = `kiemrori_${process.pid}_${Date.now()}`;
        const [nguoi] = await tx.insert(users).values({ openId: ten, username: ten, name: "người dùng kiểm bộ đếm", role: "admin", loginMethod: "local" }).returning({ id: users.id });
        const uid = nguoi!.id;
        await tx.insert(auditLogs).values({ userId: uid, action: "kiem_bo_dem_ro_ri", entityType: "test" });
        await tx.insert(aiPendingActions).values({
          id: `kiemrori-${process.pid}-${Date.now()}`,
          tool: "apply_diff",
          argsJson: {},
          userId: uid,
          userRole: "admin",
          summary: "kiểm bộ đếm rò rỉ",
          idempotencyKey: `kiemrori-${process.pid}-${Date.now()}`,
          expiresAt: new Date(Date.now() + 60_000),
        });
        ket.trongTx = await demHangRoRi(uid, undefined, tx);
        ket.rieng = await demHangRoRi(uid);
        ket.khac = await demHangRoRi(uid + 1_000_000, undefined, tx);
        throw new RollbackPhatLai();
      });
    } catch (e) {
      nuotRollback(e);
    }
    expect(ket.trongTx, "bộ đếm trong giao dịch phải thấy đúng hàng đã chèn").toEqual({ audit_logs: 1, ai_pending_actions: 1, tong: 2 });
    expect(ket.rieng, "kết nối riêng không thấy hàng chưa commit").toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
    expect(ket.khac, "đếm theo userId: người khác ⇒ 0").toEqual({ audit_logs: 0, ai_pending_actions: 0, tong: 0 });
  }, 60_000);
});

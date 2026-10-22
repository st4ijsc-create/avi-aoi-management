/**
 * Bộ dọn dữ liệu cho các test `*.db.test.ts` của Luồng AI — DÙNG Ở `beforeAll` (và `afterAll`).
 *
 * VÌ SAO (rà 2026-10-21): các test dùng id/tiền tố CỐ ĐỊNH (`t8lh-…`, `h2qdF`…) mà chỉ dọn ở `afterAll`. Khi một lượt chạy bị NGẮT
 * (kill, timeout cả bộ, máy sập) thì `afterAll` không chạy và hàng của lượt đó ở lại; lượt sau dựng lại cùng id ⇒ `23505` (nhà máy/bí
 * mật trùng mã), số phiên bản luồng lệch (`version` 3 thay vì 1), lượt `dang-chay` còn sót làm trần `maxConcurrentRuns` từ chối lượt
 * đầu… — những lỗi KHÔNG tự hết (đo: bản sao vô hiệu afterAll chạy hai lần ⇒ 11/24 tệp đỏ ở lượt hai và vẫn đỏ ở lượt thứ ba).
 * Dọn Ở ĐẦU (idempotent) làm mỗi lượt tự phục hồi từ trạng thái bẩn; dọn ở cuối vẫn giữ để không để rác.
 */
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowCredentials, aiFlowRuns, aiFlows } from "../../../drizzle/schema";

/** Xoá mọi lượt, luồng (kéo theo phiên bản/webhook/hàng chờ qua khoá ngoại) và bí mật có id bắt đầu bằng `tienTo`. */
export async function donLuongTheoTienTo(tienTo: string): Promise<void> {
  const d = await getDb();
  if (!d) return;
  const runs = await d.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${tienTo}%`));
  if (runs.length) await d.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await d.delete(aiFlows).where(like(aiFlows.id, `${tienTo}%`));
  await d.delete(aiFlowCredentials).where(like(aiFlowCredentials.id, `${tienTo}%`));
}

/**
 * Xoá nhà máy mã `maNhaMay` cùng các người dùng test (openId bắt đầu bằng `tienToOpenId`) và phân công của họ. Thứ tự: phân công →
 * người dùng → nhà máy (khoá ngoại). Hàng người dùng bị kiểm toán WORM giữ khoá ngoại thì không xoá được — khi đó chỉ GHI CẢNH BÁO
 * (người dùng cũ vô hại vì openId có hậu tố thời gian; nhà máy vẫn xoá được nhờ đã bỏ phân công).
 */
export async function donNhaMayVaNguoiTheoMa(maNhaMay: string, tienToOpenId: string): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d.execute(sql`DELETE FROM user_factory_assignments WHERE "factoryCode" = ${maNhaMay} OR "userId" IN (SELECT id FROM users WHERE "openId" LIKE ${tienToOpenId + "%"})`);
  try {
    await d.execute(sql`DELETE FROM users WHERE "openId" LIKE ${tienToOpenId + "%"}`);
  } catch (e) {
    console.warn(`[donDuLieuTest] không xoá được người dùng test "${tienToOpenId}%" (khoá ngoại): ${(e as Error).message.split("\n")[0]}`);
  }
  await d.execute(sql`DELETE FROM factories WHERE code = ${maNhaMay}`);
}

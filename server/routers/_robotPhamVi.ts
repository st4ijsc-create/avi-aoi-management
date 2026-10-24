/**
 * ★★★ 2026-10-24 — phạm vi nhà máy của MỘT ROBOT do client gửi id (rà bảo mật lô W2, kiểm định phamViGhi).
 * Luật (cùng `safety.sourceHealth`): robot thuộc phạm vi ⇔ phạm vi toàn quyền (admin), HOẶC chuyền của nó và chuyền của trạm của nó
 * (mỗi cái đã đặt) đều trong tập chuyền của người gọi và có ít nhất một (robot chưa đặt chỗ thì không có gì trong phạm vi).
 * Ngoài phạm vi ≡ không tồn tại: cùng MỘT NOT_FOUND (không lộ sự tồn tại). Danh tính LUÔN từ `ctx.user`. Không phân giải được phạm vi ⇒ NÉM (fail-closed).
 */
import { eq } from "drizzle-orm";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { idsTrongPhamVi } from "../db/hierarchy";
import { robots, stations } from "../../drizzle/schema";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

export const khongThayRobot = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "robot" }, "Robot not found");

/** Robot `robotId` phải trong phạm vi người gọi; không thì NOT_FOUND. Phạm vi toàn quyền ⇒ không kiểm (không cả tồn tại). */
export async function robotTrongPhamVi(ctx: CoDanhTinh, robotId: number): Promise<void> {
  const lineIds = await idsTrongPhamVi("line", phamViCua(ctx), { strict: true });
  if (lineIds === null) return;
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [r] = await d
    .select({ lineId: robots.lineId, stationLine: stations.lineId })
    .from(robots)
    .leftJoin(stations, eq(stations.id, robots.stationId))
    .where(eq(robots.id, robotId))
    .limit(1);
  const lines = [r?.lineId ?? null, r?.stationLine ?? null].filter((x): x is number => x != null);
  if (lines.length === 0 || !lines.every((l) => lineIds.includes(l))) throw khongThayRobot();
}

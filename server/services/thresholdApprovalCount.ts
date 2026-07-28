/**
 * Wave 2 đường A — đếm đề xuất ngưỡng ĐANG CHỜ theo từng điểm đo của một sản phẩm.
 *
 * Vì sao cần: đo trên DB ngày 2026-07-28 có 150 dòng threshold_approvals, TẤT CẢ
 * status='requested', 0 quyết định — vì chúng chỉ hiện ở /threshold-approvals, một
 * trang KHÁC với /products nơi kỹ sư thực sự chỉnh điểm đo. Hàm này cấp dữ liệu để
 * gắn badge ngay tại chỗ làm việc.
 *
 * MỘT truy vấn gộp cho cả sản phẩm (không N+1). Fail-safe tuyệt đối: mọi lỗi ⇒ rỗng,
 * vì đây là tính năng PHỤ — không bao giờ được chặn màn hình chính.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { thresholdApprovals, measurementPointDefs } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

export interface PendingByPointResult {
  byPoint: Record<number, number>;
  total: number;
}

const EMPTY: PendingByPointResult = { byPoint: {}, total: 0 };

export async function countPendingByPoint(productModelId: number): Promise<PendingByPointResult> {
  const db = await getDb();
  if (!db) return EMPTY;
  try {
    // Đợt A: MỘT truy vấn cho cả sản phẩm — trả về mỗi dòng threshold_approvals
    // đang 'requested' (join lọc theo productModelId), rồi gộp theo pointDefId
    // ở tầng JS ngay bên dưới. (Không dùng SQL GROUP BY ở đây — driver bọc kết
    // quả `.where()` khác nhau tuỳ ORM/mock; gộp ở JS vừa đơn giản vừa đủ nhanh
    // vì số đề xuất đang chờ của một sản phẩm luôn nhỏ.)
    const rows = (await db
      .select({
        pointDefId: thresholdApprovals.pointDefId,
      })
      .from(thresholdApprovals)
      .innerJoin(measurementPointDefs, eq(measurementPointDefs.id, thresholdApprovals.pointDefId))
      .where(and(
        eq(measurementPointDefs.productModelId, productModelId),
        eq(thresholdApprovals.status, "requested"),
      ))) as Array<{ pointDefId: number }>;

    const byPoint: Record<number, number> = {};
    let total = 0;
    for (const r of rows ?? []) {
      byPoint[r.pointDefId] = (byPoint[r.pointDefId] ?? 0) + 1;
      total += 1;
    }
    return { byPoint, total };
  } catch (err) {
    if (isMissingTable(err)) {
      // Dự kiến được: môi trường chưa chạy migration cho threshold_approvals.
      console.warn("[thresholdApprovalCount] đếm thất bại — ẩn badge, màn điểm đo vẫn chạy:", (err as any)?.message ?? err);
    } else {
      // BẤT NGỜ — không phải "thiếu bảng". Log nguyên đối tượng lỗi (không rút
      // gọn về String/.message) để giữ stack + err.cause (DrizzleQueryError bọc
      // lỗi driver thật trong .cause) cho việc điều tra sau này. Vẫn trả EMPTY —
      // đây là tính năng phụ, không được chặn màn hình chính — nhưng KHÔNG được
      // im lặng như trường hợp "không có đề xuất nào" (suy giảm phải trung thực).
      console.error(
        "[thresholdApprovalCount] unexpected failure — pending-suggestion badges will be hidden for this product:",
        err,
      );
    }
    return EMPTY;
  }
}

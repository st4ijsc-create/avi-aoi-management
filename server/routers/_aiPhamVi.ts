/**
 * ★ Điều kiện phạm vi nhà máy DÙNG CHUNG cho các thủ tục ĐỌC nhóm AI (lô L6b, 2026-10-25) — mỗi hàm trả `SQL | undefined` (undefined = toàn quyền).
 * Dữ liệu AI định vị bằng MÁY hoặc LẦN KIỂM TRA; cùng luật `dieuKienDoiTuongTrongPhamVi` (_adapterPhamVi.ts): hàng không định vị được chỉ toàn quyền thấy.
 */
import { chuanHoaKhoaAnh } from "../utils/safeImagePath";
import { sql, type SQL } from "drizzle-orm";
import { aiLabelQueue, aiSuggestions, edgeDeployments, edgeInferenceSync, inferenceResults, modelRollbackEvents, predictiveAlerts, robotBehaviorAnomalies, rootCauseAnalysis } from "../../drizzle/schema";
import { idsTrongPhamVi } from "../db/hierarchy";
import { dieuKienDoiTuongTrongPhamVi, dieuKienViTriTrongPhamVi, idsMayTrongPhamVi } from "./_adapterPhamVi";
import { phamViCua, type CoDanhTinh } from "./_phamViNguoiXem";

/** Gợi ý AI theo lần kiểm tra. */
export const congGoiY = (ctx: CoDanhTinh): Promise<SQL | undefined> => dieuKienDoiTuongTrongPhamVi(ctx, { lanKiem: aiSuggestions.inspectionId });

/** Kết quả suy luận: lần kiểm tra trực tiếp, hoặc qua kết quả đo. */
export const congInference = (ctx: CoDanhTinh): Promise<SQL | undefined> =>
  dieuKienDoiTuongTrongPhamVi(ctx, {
    lanKiem: sql`COALESCE(${inferenceResults.inspectionId}, (SELECT mr."inspectionId" FROM measurement_results mr WHERE mr."id" = ${inferenceResults.measurementResultId}))`,
  });

/** Triển khai edge theo máy (machineId NULL ⇒ chỉ toàn quyền). */
export const congEdge = (ctx: CoDanhTinh): Promise<SQL | undefined> => dieuKienDoiTuongTrongPhamVi(ctx, { may: edgeDeployments.machineId });

/** Kết quả suy luận đồng bộ từ edge: máy của triển khai + lần kiểm tra. */
export const congEdgeSuy = (ctx: CoDanhTinh): Promise<SQL | undefined> =>
  dieuKienDoiTuongTrongPhamVi(ctx, {
    may: sql`(SELECT ed."machineId" FROM edge_deployments ed WHERE ed."id" = ${edgeInferenceSync.deploymentId})`,
    lanKiem: edgeInferenceSync.inspectionId,
  });

/** Số liệu huấn luyện: hàng đợi gán nhãn + gợi ý/phản hồi. undefined khi toàn quyền. */
export async function pvTrainStats(ctx: CoDanhTinh): Promise<{ hangDoi?: SQL; goiY?: SQL } | undefined> {
  const hangDoi = await dieuKienDoiTuongTrongPhamVi(ctx, { may: aiLabelQueue.machineId, lanKiem: aiLabelQueue.inspectionId });
  if (!hangDoi) return undefined;
  return { hangDoi, goiY: await congGoiY(ctx) };
}

/** Cảnh báo dự đoán theo máy / nhà máy (hàng không định vị chỉ toàn quyền). */
export async function congCanhBaoDuDoan(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { machineId: predictiveAlerts.machineId, factoryId: predictiveAlerts.factoryId });
}

/**
 * Phân tích nguyên nhân gốc đã lưu (cùng luật `phanTichTrongPhamVi` của GHI): có máy ⇒ máy trong phạm vi; có nhà máy ⇒ nhà máy trong phạm vi;
 * không có cả hai ⇒ chỉ người yêu cầu. undefined khi toàn quyền.
 */
export async function congPhanTichNguyenNhan(ctx: CoDanhTinh & { user: { id: number } }): Promise<SQL | undefined> {
  const viTri = await dieuKienViTriTrongPhamVi(phamViCua(ctx), { machineId: rootCauseAnalysis.machineId, factoryId: rootCauseAnalysis.factoryId });
  if (!viTri) return undefined;
  return sql`(${viTri} OR (${rootCauseAnalysis.machineId} IS NULL AND ${rootCauseAnalysis.factoryId} IS NULL AND ${rootCauseAnalysis.requestedBy} = ${ctx.user.id}))`;
}

/** Bất thường hành vi robot theo robot (robot ⇒ chuyền / trạm của nó trong phạm vi). */
export async function congBatThuongRobot(ctx: CoDanhTinh): Promise<SQL | undefined> {
  return dieuKienViTriTrongPhamVi(phamViCua(ctx), { robotId: robotBehaviorAnomalies.robotId });
}

/** Sự kiện rollback mô hình: factoryId NULL = cấp mô hình ⇒ chung; có factoryId ⇒ nhà máy trong phạm vi. */
export async function congRollbackMoHinh(ctx: CoDanhTinh): Promise<SQL | undefined> {
  const ids = await idsTrongPhamVi("factory", phamViCua(ctx), { strict: true });
  if (ids === null) return undefined;
  const ds = sql.join((ids.length > 0 ? ids : [-1]).map((x) => sql`${x}`), sql`, `);
  return sql`(${modelRollbackEvents.factoryId} IS NULL OR ${modelRollbackEvents.factoryId} IN (${ds}))`;
}

/**
 * Ảnh theo `imageKey` (đường dẫn trong thư mục uploads) có thuộc phạm vi người gọi không (L6b, dieu-phoi: explainHeatmap đọc ảnh theo khoá không phân nhà máy).
 * Ảnh thấy được ⇔ toàn quyền, HOẶC khoá thuộc `temp/` (ảnh tạm CHÍNH người dùng vừa tải lên), HOẶC khoá khớp ảnh của một kết quả đo (imageKey / imageUrl / defectCropKey / defectCropUrl)
 * thuộc lần kiểm tra của máy trong phạm vi, HOẶC một embedding ảnh / mặt nạ khuyết tật có máy / lần kiểm tra trong phạm vi. Khoá không tra ngược được ⇒ KHÔNG thấy (fail-closed).
 */
export async function anhTrongPhamVi(ctx: CoDanhTinh, imageKey: string): Promise<boolean> {
  const k = chuanHoaKhoaAnh(imageKey); // MỘT lần chuẩn hoá — router đọc tệp bằng ĐÚNG chuỗi này
  if (k === null) return false;
  const ids = await idsMayTrongPhamVi(ctx);
  if (ids === null) return true;
  // ảnh tạm: chỉ MỘT tệp phẳng do aiImageSearch.uploadTemp sinh ra (không thư mục con). Cơ chế đó KHÔNG ghi chủ tải lên ⇒ chưa phân biệt được người.
  // 2026-10-25 (dieu-phoi): uploadForSearch nay ghi temp/u<userId>/ ⇒ CHỈ chính chủ đọc lại; khoá phẳng kiểu cũ temp/tmp_… (không biết chủ, tự xoá sau 1 giờ) ⇒ không thấy.
  const tam = /^temp\/u(\d+)\/tmp_\d+_[a-z0-9]+\.[a-z0-9]+$/i.exec(k);
  if (tam) return ctx.user?.id != null && Number(tam[1]) === ctx.user.id;
  if (/^temp\//i.test(k)) return false;
  const { getDb } = await import("../db/connection");
  const d = await getDb();
  if (!d) return false;
  const bienThe = [k, "uploads/" + k, "/uploads/" + k];
  const dsK = sql.join(bienThe.map((x) => sql`${x}`), sql`, `);
  const dsM = sql.join((ids.length > 0 ? ids : [-1]).map((x) => sql`${x}`), sql`, `);
  const rows = (await d.execute(sql`SELECT 1 AS ok WHERE
    EXISTS (SELECT 1 FROM measurement_results mr JOIN product_inspections pi ON pi."id" = mr."inspectionId"
            WHERE (mr."imageKey" IN (${dsK}) OR mr."imageUrl" IN (${dsK}) OR mr."defectCropKey" IN (${dsK}) OR mr."defectCropUrl" IN (${dsK})) AND pi."machineId" IN (${dsM}))
    OR EXISTS (SELECT 1 FROM ai_image_embeddings e WHERE e."imageUrl" IN (${dsK}) AND e."machineId" IN (${dsM}))
    OR EXISTS (SELECT 1 FROM defect_segmentations ds JOIN product_inspections pi ON pi."id" = ds."inspectionId" WHERE ds."imageUrl" IN (${dsK}) AND pi."machineId" IN (${dsM}))`)) as unknown as Array<{ ok: number }>;
  return rows.length > 0;
}

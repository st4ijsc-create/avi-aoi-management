/**
 * Khối B — Task 2 (B-3): ĐƯỜNG GHI **CÂY DẠY** của máy vào BỐN bảng ĐÃ CÓ SẴN.
 *
 * `surfaces[] → positions[] → captures[] → components[]` (hợp đồng
 * `server/contracts/machineTemplateContract.ts`, Task 1) đổ vào
 * `product_surfaces` → `product_positions` → `product_captures` →
 * `measurement_point_defs`. **Không migration nào** — bốn bảng và mọi cột đích
 * đã tồn tại từ migration 0338/0340.
 *
 * ⚠ Đây là hàm ĐƯỢC GỌI **SAU** `authenticateMachine` (cửa
 * `machineApiRouter.submitMachineTemplate`). Nó KHÔNG tự xác thực gì — mọi lời
 * gọi mới phải tự bảo đảm điều đó (bài học I-4: một lượt ghi CSDL đặt trước xác
 * thực là một lượt ghi người lạ điều khiển được).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHOÁ HỘI TỤ TỪNG CẤP — đo từ `pg_indexes`, KHÔNG chép từ kế hoạch
 * ════════════════════════════════════════════════════════════════════════════
 * Đẩy LẠI cùng một cây phải cho CÙNG số hàng, không nhân bản. Khoá hội tụ của
 * mỗi cấp phải là một **unique index THẬT**, nếu không `ON CONFLICT` không có
 * đích. Đo `pg_indexes` bằng vai `avi_app`, 2026-09-03, CÙNG kết quả ở CẢ HAI
 * DB (`current_database()` = `'aoi_management'` và `'aoi_management_test'`):
 *
 * | Cấp       | Kế hoạch khai           | Unique index THẬT                                          |
 * |-----------|-------------------------|------------------------------------------------------------|
 * | surface   | (productModelId, surfaceExtId) | ❌ **KHÔNG TỒN TẠI** — chỉ có `uq_product_surfaces_model_name` (productModelId, **surfaceName**). ⚠ Task 5 (0347) THAY nó bằng `uq_product_surfaces_model_may_name` (productModelId, **machineId**, surfaceName) |
 * | position  | (surfaceRowId, positionId)     | ✅ `uq_product_positions_surface_posid`               |
 * | capture   | (positionRowId, captureExtId)  | ✅ `uq_product_captures_position_extid`               |
 * | component | (captureRowId, componentExtId) | ✅ `uq_point_defs_capture_component` (PARTIAL: cả hai NOT NULL và `deletedAt IS NULL`) |
 *
 * ⇒ **SỐ ĐO BÁC BỎ kế hoạch ở cấp surface.** Không có index nào trên
 * `(productModelId, surfaceExtId)` ⇒ không `ON CONFLICT` được vào đó. Cách xử ở
 * đây, khai rõ để không ai đọc nhầm là "đã hội tụ theo extId ở tầng DB":
 *   1. SELECT hàng theo `(productModelId, surfaceExtId)` — hội tụ theo **extId**
 *      ở TẦNG ỨNG DỤNG (đây là thứ giữ đúng hàng khi máy ĐỔI TÊN một mặt).
 *   2. Không thấy ⇒ INSERT `ON CONFLICT (productModelId, machineId, surfaceName) DO UPDATE`
 *      — hội tụ theo **TÊN** ở TẦNG DB (đây là khoá DB thật sự cưỡng chế, VÀ là
 *      khoá mà KẾT QUẢ nối bằng: payload kết quả chỉ mang `name`, không mang
 *      `surfaceId`).
 * ⚠ Bước 1 KHÔNG chống được đua: hai lượt đẩy ĐỒNG THỜI cùng model có thể cùng
 * không thấy hàng rồi cùng INSERT — nhưng bước 2 biến cuộc đua đó thành một lượt
 * UPDATE, không phải hai hàng. Cái KHÔNG có bảo đảm là "hai extId khác nhau,
 * cùng một `surfaceName`": lúc đó hàng thứ hai sẽ GHI ĐÈ `surfaceExtId` của hàng
 * thứ nhất. Cửa chặn ca này bằng phép kiểm trùng `surfaceName` TRONG payload
 * (`machineApiRouters.ts`), nhưng KHÔNG chặn được giữa HAI lượt đẩy khác nhau
 * CỦA CÙNG MỘT MÁY. ⚠ Task 5 (0347) THU HẸP nợ này chứ không xoá nó: hai lượt đẩy
 * của HAI MÁY khác nhau nay KHÔNG còn đụng nhau (khoá có `machineId`); còn lại
 * đúng ca "cùng máy, đổi `surfaceExtId` mà giữ nguyên `surfaceName`", và ca đó
 * nay sinh một PHIÊN BẢN mới (checksum đổi) nên nó ĐỂ LẠI DẤU VẾT tra được.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SÁU CỘT NOT NULL của `measurement_point_defs` mà cây dạy KHÔNG có
 * ════════════════════════════════════════════════════════════════════════════
 * Đo `information_schema.columns` (NOT NULL, không default), CẢ HAI DB:
 * `productModelId` · `code` · `name` · `measurementType` · `positionX` · `positionY`.
 * Cây dạy chỉ cấp `name`. Bốn cột còn lại phải SUY RA — và mỗi phép suy là một
 * lời khai, nên khai ở đây:
 *   · `productModelId` — từ `productModelCode` ở cửa (tra `product_models`).
 *   · `code` = `componentExtId`. Sức chứa `code` là **varchar(50)** còn
 *     `componentExtId` là **varchar(64)** ⇒ id dài 51..64 ký tự sẽ vỡ `[22001]`
 *     Ở CỘT `code` (không phải ở cột nó nhắm). Cửa chặn TRƯỚC bằng
 *     `TRAN_MA_DIEM_DO`; xem `machineApiRouters.ts`.
 *   · `measurementType` = `"VISUAL"` — máy AOI/AVI là máy kiểm QUANG HỌC, và cây
 *     dạy KHÔNG mang đơn vị/giới hạn nào để một giá trị `DIMENSION` là thật. Đây
 *     là một MẶC ĐỊNH, không phải một phép đo: nếu sau này cây dạy mang loại đo
 *     thật, sửa ở ĐÂY (một chỗ).
 *   · `positionX`/`positionY` = **TÂM của ROI** (`roi.x + roi.width/2`, làm tròn).
 *     ⚠ Hai cột này là hình học CŨ (điểm-đo PHẲNG, đường tròn `radius`); hình học
 *     THẬT của cấp component là `roiX/roiY/roiWidth/roiHeight` (mig 0338). Đặt
 *     TÂM để một hộ đọc CŨ rơi vào TRONG ROI thật thay vì vào `(0,0)`.
 * ⚠ `shape`/`radius`/`cropWidth`/`cropHeight` CỐ Ý **không** ghi — giữ mặc định
 * DB (`'circle'`/20/100/100). Ghi `shape='rect'` mà không ghi `geometry` (hoặc
 * ngược lại) tạo hai nguồn sự thật hình học lệch nhau; ghi CẢ HAI thì ROI bị chép
 * ra hai chỗ, đúng lớp lỗi "hai nguồn sự thật" dự án này đã tốn 8 lượt review để
 * dọn. Hệ quả PHẢI biết: với hàng cây dạy, `shape='circle'` + `radius=20` là
 * **DI SẢN VÔ NGHĨA**, đừng đọc chúng — đọc `roi*`.
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ Task 5 (0347) — CHIỀU **MÁY** VÀ CHIỀU **PHIÊN BẢN** (nợ Task 2 bàn giao)
 * ════════════════════════════════════════════════════════════════════════════
 * Task 2 CỐ Ý để `machineId` NULL vì ba cấp trên KHÔNG có chiều máy nào, và gắn
 * máy ở riêng cấp bốn là một "chiều NỬA VỜI" (hai nguồn sự thật về phạm vi).
 * Quyết định đó ĐÚNG — migration 0347 không lật nó, nó đóng CẢ BỐN CẤP cùng lúc:
 *
 *   product_surfaces."machineId"        NOT NULL   ← GỐC của chiều máy
 *   product_positions."machineId"       NOT NULL   ← FK GHÉP (surfaceRowId, machineId)
 *   product_captures."machineId"        NOT NULL   ← FK GHÉP (positionRowId, machineId)
 *   measurement_point_defs."machineId"  (nullable, vì điểm PHẲNG cũ không có máy)
 *                                       ← FK GHÉP (captureRowId, machineId)
 *                                       + CHECK `ck_point_defs_cay_phai_co_may`
 *
 * ⇒ Một hàng con KHÔNG THỂ mang `machineId` khác cha nó (`23503`, ĐỎ TO). Đó là
 *   khác biệt giữa "thêm một cột máy vào ba bảng" (ba lời khai có thể lệch nhau)
 *   và "một chiều máy DUY NHẤT hiện diện ở bốn cấp".
 * ⚠ Cấp 2/3 KHÔNG thêm `machineId` vào khoá hội tụ: `surfaceRowId`/`positionRowId`
 *   ĐÃ thuộc phạm vi một máy, nên `machineId` ở đó là HÀM của cột kia.
 * ⚠ Cấp 4 có index RIÊNG cho hàng cây (`uq_point_defs_cay_may_code`, có
 *   `COALESCE("machineId",0)`). Không có nó thì máy thứ hai dạy CÙNG sản phẩm với
 *   CÙNG bộ UUID linh kiện (clone bản dạy) sẽ vỡ `23505` ở
 *   `uq_point_defs_product_variant_code` — một index KHÔNG AI NHẮM.
 *
 * ── PHIÊN BẢN: `machine_template_versions`, phạm vi `(máy, model)` ───────────
 * Mỗi lượt đẩy tra `checksum` của cây với BẢN HIỆN HÀNH:
 *   · trùng   ⇒ KHÔNG sinh phiên bản, chỉ chạm `lastSeenAt` (giữ bất biến HỘI TỤ
 *              Task 2 dựng; một máy khởi động lại và đẩy lại cây y hệt là chuyện
 *              thường, không được đẻ ra một phiên bản mỗi lần).
 *   · khác    ⇒ đóng khoảng bản cũ (`supersededAt = now()`) và mở bản mới
 *              (`version + 1`, `previousVersionId` = bản cũ). KHÔNG xoá hàng nào.
 * `snapshot` (jsonb) giữ cây NGUYÊN VĂN lúc đẩy. Đây là thứ DUY NHẤT trả lời được
 * *"bo CŨ chấm theo bản dạy nào"*: hàng `measurement_point_defs` bị lượt đẩy sau
 * GHI ĐÈ TẠI CHỖ (giá của bất biến hội tụ), nên không chụp lại thì nghĩa của dữ
 * liệu ĐÃ GHI sẽ đổi khi đẩy bản mới. Tra bằng `traBanDayTaiThoiDiem` (KHOẢNG
 * `[pushedAt, supersededAt)`) — KHÔNG thêm cột nào vào `measurement_results`, vốn
 * là hypertable ĐÃ NÉN (đo `timescaledb_information.hypertables`).
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { measurementPointDefs, measurementPointVersions, machines } from "../../drizzle/schema";
import {
  productSurfaces,
  productPositions,
  productCaptures,
  machineTemplateVersions,
  type MachineTemplateVersion,
} from "../../drizzle/schema/productConfigTree";
import type { MachineTemplate } from "../contracts/machineTemplateContract";
// Khối B Task 4 (BG-92) — CHỈ nhập KIỂU: `pointResultEvaluator` là module THUẦN
// (0 I/O), nhưng `import type` bị xoá lúc biên dịch nên file này không nhận thêm
// một phụ thuộc runtime nào, và `specGateCayV2.ts` (import ngược `khoaCapComponent`
// từ đây) không tạo vòng chạy.
import type { PointLimitSnapshot, PointLimitSource } from "../services/pointResultEvaluator";
// Task 7 Khối C (QĐ-3) — MỘT nguồn sự thật cho 18 cột giới hạn, thay cho danh
// sách chép tay trước đây (xem docblock `shared/pointLimitSpec.ts`).
import { POINT_LIMIT_SPEC } from "@shared/pointLimitSpec";
// Task 9 Khối C (QĐ-6) — CHỈ nhập KIỂU (như `pointResultEvaluator` ở trên): không có
// vòng import thật giữa `hierarchy.ts` và file này (đo bằng grep, 2026-09-03), nhưng
// `type` giữ nguyên quy ước `product.ts` đã theo — các HÀM runtime của `hierarchy.ts`
// (`trongPhamVi`/`idsTrongPhamVi`) vẫn nhập ĐỘNG (`await import`) ở nơi dùng.
import type { PhamViNguoiXem } from "./hierarchy";

/** Loại đo mặc định cho một component của cây dạy — xem docblock đầu file. */
export const LOAI_DO_MAC_DINH_CAY_DAY = "VISUAL" as const;

/**
 * Số hàng ĐÃ CHẠM ở mỗi cấp trong MỘT lượt đẩy (insert HOẶC update — đây là số
 * hàng cây dạy MÔ TẢ, không phải số hàng MỚI SINH; lượt đẩy thứ hai của cùng một
 * cây cho CÙNG bộ số, đó chính là điều mệnh đề 2 canh).
 */
export interface KetQuaGhiCayDay {
  readonly surfaces: number;
  readonly positions: number;
  readonly captures: number;
  readonly components: number;
  /** Số điểm đo bị XOÁ MỀM vì biến mất khỏi một capture CÓ TRONG payload. */
  readonly componentsXoaMem: number;
  /** `machine_template_versions.id` mà lượt đẩy này ghi vào. */
  readonly templateVersionId: number;
  /** `machine_template_versions.version` — đơn điệu theo `(máy, model)`. */
  readonly templateVersion: number;
  /**
   * `true` = lượt đẩy này SINH một phiên bản mới (checksum khác bản hiện hành);
   * `false` = cây Y HỆT bản hiện hành, chỉ chạm `lastSeenAt`. ⚠ Đây là chỗ brief
   * bị phép đo sửa — xem docblock đầu file.
   */
  readonly phienBanMoi: boolean;
  /** sha256 ổn định của cây — khoá chống-đẻ-phiên-bản. */
  readonly checksum: string;
}

/**
 * sha256 ỔN ĐỊNH (khoá sắp xếp) của cây dạy.
 *
 * ⚠ `stableStringify` ở đây là BẢN SAO THỨ SÁU trong repo (`machineRecipe.ts`,
 * `configDriftService.ts`, `schemaRegistry.ts`, `inspectionProgramService.ts`,
 * `mappingAsCode.ts`). CỐ Ý theo quy ước đang có thay vì kéo cả
 * `inspectionProgramService` (audit + goldenSample + faiGate) vào một module `db/`.
 * Nợ khai rõ: một `shared/stableStringify.ts` sẽ đúng hơn, nhưng gộp 6 bản sao là
 * một lượt việc riêng, không phải việc của Task 5.
 */
function chuoiOnDinh(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(chuoiOnDinh).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${chuoiOnDinh(obj[k])}`).join(",")}}`;
}

/** sha256 của cây dạy — hai cây khác nhau ⇒ hai checksum khác nhau. */
export function bamCayDay(cay: MachineTemplate): string {
  return createHash("sha256").update(chuoiOnDinh(cay), "utf8").digest("hex");
}

/**
 * ★★★ Đếm điểm đo LIVE của một sản phẩm, TÁCH theo neo cây (`captureRowId`).
 *
 * Dùng để cưỡng chế BẤT BIẾN đã có lưới canh (`server/db/cayCauHinhBatBien.db.test.ts`):
 * *một `productModelId` HOẶC đã chuyển sang cây (mọi điểm LIVE có `captureRowId`),
 * HOẶC còn phẳng (mọi điểm LIVE `captureRowId IS NULL`)*. Trạng thái NỬA VỜI là
 * "nguồn của lỗi phân giải KHÔNG THỂ CHẨN ĐOÁN" — nguyên văn lưới đó.
 *
 * ⚠ Trước Task này, KHÔNG đường ghi nào tạo được điểm đo neo cây, nên bất biến
 * xanh một cách tầm thường. Cửa `submitMachineTemplate` là đường ghi ĐẦU TIÊN có
 * thể tạo ra nửa vời ⇒ nó phải tự chặn, ngay tại cửa, chứ không để một lưới ở
 * tầng khác phát hiện sau khi dữ liệu đã vào.
 */
export async function demDiemDoTheoNeo(
  productModelId: number,
): Promise<{ phang: number; cay: number }> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  const r: any = await d.execute(sql`
    SELECT count(*) FILTER (WHERE "captureRowId" IS NULL)     ::int AS phang,
           count(*) FILTER (WHERE "captureRowId" IS NOT NULL) ::int AS cay
      FROM measurement_point_defs
     WHERE "productModelId" = ${productModelId}
       AND "deletedAt" IS NULL`);
  const hang = ((r.rows ?? r) as Array<{ phang: number; cay: number }>)[0];
  return { phang: Number(hang?.phang ?? 0), cay: Number(hang?.cay ?? 0) };
}

/** `numeric(p,s)` của drizzle nhận CHUỖI. `undefined` ⇒ không ghi cột. */
function soThapPhan(v: number | undefined): string | undefined {
  return v === undefined ? undefined : String(v);
}

/**
 * Cấp 1 — `product_surfaces`. Trả về `id` hàng. Xem docblock đầu file cho lý do
 * hai bước (khoá kế hoạch khai KHÔNG có index thật).
 */
async function ghiSurface(
  tx: TxCayDay,
  productModelId: number,
  machineId: number,
  thuTu: number,
  s: MachineTemplate["surfaces"][number],
): Promise<number> {
  // ⚠⚠ `machineId` PHẢI có trong mệnh đề WHERE này. Không có nó, máy B đẩy cùng
  // `surfaceExtId` sẽ tìm thấy hàng của máy A rồi UPDATE ĐÈ LÊN — đúng lỗ mà Task 5
  // sinh ra để bịt, và cái lỗ đó nằm ở TẦNG ỨNG DỤNG chứ không ở index.
  const daCo = await tx
    .select({ id: productSurfaces.id })
    .from(productSurfaces)
    .where(and(
      eq(productSurfaces.productModelId, productModelId),
      eq(productSurfaces.machineId, machineId),
      eq(productSurfaces.surfaceExtId, s.surfaceId),
    ))
    .limit(1);

  const giaTri = {
    surfaceName: s.surfaceName,
    templateImageUrl: s.surfaceTemplateImagePath ?? null,
    orderIndex: thuTu,
    updatedAt: new Date(),
  };

  const idDaCo = daCo[0]?.id;
  if (idDaCo !== undefined) {
    await tx.update(productSurfaces).set(giaTri).where(eq(productSurfaces.id, idDaCo));
    return idDaCo;
  }

  const [hang] = await tx
    .insert(productSurfaces)
    .values({ productModelId, machineId, surfaceExtId: s.surfaceId, ...giaTri })
    .onConflictDoUpdate({
      // Đích = `uq_product_surfaces_model_may_name` (0347). Bỏ `machineId` khỏi đây
      // là `42P10` (không còn index nào khớp) — ĐỎ TO, không im lặng.
      target: [productSurfaces.productModelId, productSurfaces.machineId, productSurfaces.surfaceName],
      set: { surfaceExtId: s.surfaceId, ...giaTri },
    })
    .returning({ id: productSurfaces.id });
  return hang.id;
}

/** Cấp 2 — `product_positions`, hội tụ theo `uq_product_positions_surface_posid`. */
async function ghiPosition(
  tx: TxCayDay,
  surfaceRowId: number,
  machineId: number,
  p: MachineTemplate["surfaces"][number]["positions"][number],
): Promise<number> {
  const giaTri = {
    positionIndex: p.positionIndex,
    name: p.name,
    shape: p.shape ?? null,
    markerWidth: soThapPhan(p.markerWidth) ?? null,
    markerHeight: soThapPhan(p.markerHeight) ?? null,
    markerRadius: soThapPhan(p.markerRadius) ?? null,
    relX: soThapPhan(p.relX) ?? null,
    relY: soThapPhan(p.relY) ?? null,
    templateImageUrl: p.templateImagePath ?? null,
    updatedAt: new Date(),
  };
  const [hang] = await tx
    .insert(productPositions)
    // `machineId` KHÔNG phải một lời khai thứ hai: FK GHÉP `fk_positions_surface_may`
    // (0347) làm cho một giá trị khác cha là `23503`.
    .values({ surfaceRowId, machineId, positionId: p.positionId, ...giaTri })
    .onConflictDoUpdate({
      target: [productPositions.surfaceRowId, productPositions.positionId],
      set: giaTri,
    })
    .returning({ id: productPositions.id });
  return hang.id;
}

/** Cấp 3 — `product_captures`, hội tụ theo `uq_product_captures_position_extid`. */
async function ghiCapture(
  tx: TxCayDay,
  positionRowId: number,
  machineId: number,
  thuTu: number,
  c: MachineTemplate["surfaces"][number]["positions"][number]["captures"][number],
): Promise<number> {
  const giaTri = {
    captureName: c.name,
    captureIndex: thuTu,
    templateImageUrl: c.templateImagePath ?? null,
    updatedAt: new Date(),
  };
  const [hang] = await tx
    .insert(productCaptures)
    .values({ positionRowId, machineId, captureExtId: c.id, ...giaTri })
    .onConflictDoUpdate({
      target: [productCaptures.positionRowId, productCaptures.captureExtId],
      set: giaTri,
    })
    .returning({ id: productCaptures.id });
  return hang.id;
}

/**
 * Cấp 4 — `measurement_point_defs`. Hội tụ theo `uq_point_defs_capture_component`
 * — index **PARTIAL**, nên `targetWhere` PHẢI lặp lại NGUYÊN VĂN vị từ của index,
 * nếu không Postgres không nhận ra đích và ném `42P10`.
 *
 * ⚠ `componentExtId` là THỨ CẢ KHỐI B TỒN TẠI ĐỂ ĐỔ ĐẦY (nền đo được §3: 0/110 và
 * 0/2834 ở hai DB trước Task này). Bỏ nó khỏi `.values()` ⇒ `uq_point_defs_capture_component`
 * không còn đích (cột NULL nằm ngoài vị từ partial) ⇒ đẩy lại NHÂN BẢN, và Task 3/4
 * không có gì để join. Đột biến bắt buộc của Task 2 chính là phép bỏ đó.
 */
async function ghiComponent(
  tx: TxCayDay,
  productModelId: number,
  machineId: number,
  templateVersionId: number,
  captureRowId: number,
  thuTu: number,
  k: MachineTemplate["surfaces"][number]["positions"][number]["captures"][number]["components"][number],
): Promise<void> {
  const giaTri = {
    name: k.componentName,
    description: k.description ?? null,
    referenceImageUrl: k.templateImagePath ?? null,
    roiX: k.roi.x,
    roiY: k.roi.y,
    roiWidth: k.roi.width,
    roiHeight: k.roi.height,
    // Hình học CŨ, NOT NULL — TÂM của ROI. Xem docblock đầu file.
    positionX: Math.round(k.roi.x + k.roi.width / 2),
    positionY: Math.round(k.roi.y + k.roi.height / 2),
    orderIndex: thuTu,
    lastModifiedAt: new Date(),
    updatedAt: new Date(),
    // ⚠⚠ Task 5 — hai cột này PHẢI nằm trong `giaTri` (dùng cho CẢ insert LẪN update):
    // một hàng đã tồn tại từ lượt đẩy trước mà không được cập nhật `templateVersionId`
    // sẽ khai SAI bản dạy nào ghi nó lần cuối, và lời khai sai đó không có cổng nào bắt.
    machineId,
    templateVersionId,
  };
  await tx
    .insert(measurementPointDefs)
    .values({
      productModelId,
      captureRowId,
      componentExtId: k.id,
      code: k.id,
      measurementType: LOAI_DO_MAC_DINH_CAY_DAY,
      ...giaTri,
    })
    .onConflictDoUpdate({
      target: [measurementPointDefs.captureRowId, measurementPointDefs.componentExtId],
      // ⚠ NGUYÊN VĂN vị từ của `uq_point_defs_capture_component` (đo `pg_indexes`):
      // Postgres chỉ nhận ra một partial index làm đích khi vị từ ta đưa **kéo theo**
      // vị từ của index. Bỏ bớt một vế ⇒ `42P10 there is no unique or exclusion
      // constraint matching the ON CONFLICT specification`, tức ĐỎ TO, không im lặng.
      targetWhere: and(
        isNotNull(measurementPointDefs.captureRowId),
        isNotNull(measurementPointDefs.componentExtId),
        isNull(measurementPointDefs.deletedAt),
      ),
      set: giaTri,
    });
}

/**
 * ★★★ CÂY CO LẠI ⇒ **XOÁ MỀM**, KHÔNG xoá cứng (`measurement_point_defs.deletedAt`).
 * Kết quả cũ (`measurement_results`) trỏ vào các hàng này — DELETE cứng làm mất
 * chính thứ Task 3/4 sắp join tới.
 *
 * ⚠⚠⚠ PHẠM VI XOÁ MỀM BỊ CHẶN CÓ CHỦ ĐÍCH ở đúng các **capture CÓ TRONG payload**.
 * Đây là câu trả lời cho cái bẫy Task 1 bàn giao ("payload rỗng xoá mềm cả bản
 * dạy"): một capture KHÔNG xuất hiện trong lượt đẩy này thì component của nó
 * KHÔNG bị đụng. Hệ quả — cả hai chiều, khai rõ:
 *   · Máy dạy lại MỘT capture và bỏ 3 linh kiện ⇒ đúng 3 hàng xoá mềm. ✅
 *   · Máy XOÁ HẲN một capture khỏi cây ⇒ component của capture đó **CÒN SỐNG**
 *     (mồ côi logic: `product_captures` cũ vẫn còn, xem dưới). Đây là nợ ĐÃ BIẾT,
 *     KHÔNG phải quên: dọn nó cần biết "bản dạy nào là bản hiện hành" = Task 5.
 * ⚠ Ba cấp trên (`surface/position/capture`) **KHÔNG** có cột `deletedAt` và
 * KHÔNG bị xoá gì cả — DELETE cứng ở đó CASCADE xuống position/capture và làm
 * `measurement_point_defs.captureRowId` bị `SET NULL` (FK thật của mig 0338) ⇒
 * điểm đo mất neo IM LẶNG. Một hàng thừa ở ba cấp trên thì vô hại; một điểm đo
 * mất neo thì không.
 */
async function xoaMemComponentBienMat(
  tx: TxCayDay,
  captureRowId: number,
  maConLai: readonly string[],
  phienBanLucXoa: number | null,
): Promise<number> {
  const dieuKien = maConLai.length > 0
    ? and(
        eq(measurementPointDefs.captureRowId, captureRowId),
        isNull(measurementPointDefs.deletedAt),
        notInArray(measurementPointDefs.componentExtId, [...maConLai]),
      )
    : and(
        eq(measurementPointDefs.captureRowId, captureRowId),
        isNull(measurementPointDefs.deletedAt),
      );

  const daXoa = await tx
    .update(measurementPointDefs)
    .set({ deletedAt: new Date(), deletedAtVersion: phienBanLucXoa, updatedAt: new Date() })
    .where(dieuKien)
    .returning({ id: measurementPointDefs.id });
  return daXoa.length;
}

/** Kiểu runner (transaction) — hẹp đúng những gì bốn hàm trên dùng. */
type TxCayDay = Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0];

/**
 * ★★★ MỞ (hoặc TÁI DÙNG) một bản dạy cho `(máy, model)` — trong CÙNG transaction
 * với cây, TRƯỚC khi ghi hàng nào.
 *
 * Ba nhánh, mỗi nhánh một quyết định khai rõ:
 *
 *  (1) CHƯA CÓ bản nào  ⇒ mở `version = 1`.
 *  (2) checksum TRÙNG bản hiện hành ⇒ **KHÔNG sinh phiên bản mới**, chỉ chạm
 *      `lastSeenAt`. ⚠ Đây là chỗ brief bị phép đo sửa: brief viết *"mỗi lượt đẩy
 *      ⇒ một phiên bản"*, nhưng chính brief cũng đòi *"đẩy lại cùng cây cùng máy ⇒
 *      số hàng không đổi"*. Một máy khởi động lại và đẩy lại cây Y HỆT là chuyện
 *      thường; sinh phiên bản mỗi lượt sẽ làm sổ phình vô hạn mà KHÔNG một nghĩa
 *      nào đổi, và biến `traBanDayTaiThoiDiem` thành một hàng khác nhau mỗi phút.
 *      `checksum` chính là cơ chế `inspection_program_releases` (0182) đã lập cho
 *      đúng việc này ("stable sha256 for dedup/diff/tamper-evidence").
 *  (3) checksum KHÁC ⇒ ĐÓNG khoảng bản cũ (`supersededAt = now()`) rồi MỞ bản mới
 *      (`version + 1`, `previousVersionId` = bản cũ). **KHÔNG XOÁ HÀNG NÀO** — sổ
 *      này append-only, đúng như `inspection_program_releases`.
 *
 * ⚠ `uq_mtv_hien_hanh` (partial unique trên `(machineId, productModelId) WHERE
 *   supersededAt IS NULL`) là cầu chì: nếu bước (3) quên đóng bản cũ thì INSERT bản
 *   mới vỡ `23505` — ĐỎ TO, chứ không phải hai bản "hiện hành" cùng lúc.
 * ⚠ `SELECT … FOR UPDATE` khoá bản hiện hành: hai lượt đẩy ĐỒNG THỜI của cùng một
 *   máy phải nối đuôi nhau, không được cùng đọc `version = N` rồi cùng ghi `N+1`.
 */
async function moBanDay(
  tx: TxCayDay,
  opts: { machineId: number; productModelId: number; checksum: string; cay: MachineTemplate },
): Promise<{ id: number; version: number; moi: boolean }> {
  const [hienHanh] = await tx
    .select({
      id: machineTemplateVersions.id,
      version: machineTemplateVersions.version,
      checksum: machineTemplateVersions.checksum,
    })
    .from(machineTemplateVersions)
    .where(and(
      eq(machineTemplateVersions.machineId, opts.machineId),
      eq(machineTemplateVersions.productModelId, opts.productModelId),
      isNull(machineTemplateVersions.supersededAt),
    ))
    .limit(1)
    .for("update");

  // (2) Cây Y HỆT bản hiện hành — không có gì mới để ghi vào sổ.
  if (hienHanh && hienHanh.checksum === opts.checksum) {
    // ⚠ `now()` của DB, KHÔNG phải `new Date()`: `pushedAt` lấy DEFAULT now(), nên
    // mọi dấu thời gian của sổ này phải đến từ CÙNG MỘT đồng hồ. Trộn hai đồng hồ
    // vào một khoảng `[pushedAt, supersededAt)` là cách tạo ra khoảng ÂM mà không
    // lỗi nào ném (bài học lệch múi giờ doc 51 P1 của chính repo này).
    await tx
      .update(machineTemplateVersions)
      .set({ lastSeenAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(machineTemplateVersions.id, hienHanh.id));
    return { id: hienHanh.id, version: hienHanh.version, moi: false };
  }

  // (3) Cây ĐỔI — đóng khoảng bản cũ TRƯỚC khi mở bản mới (`uq_mtv_hien_hanh`).
  if (hienHanh) {
    await tx
      .update(machineTemplateVersions)
      .set({ supersededAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(machineTemplateVersions.id, hienHanh.id));
  }

  // Số phiên bản đơn điệu theo `(máy, model)` — kể cả bản đã bị đóng khoảng, vì
  // `uq_mtv_may_model_version` phủ MỌI hàng, không riêng bản hiện hành.
  const [cao] = await tx
    .select({ v: machineTemplateVersions.version })
    .from(machineTemplateVersions)
    .where(and(
      eq(machineTemplateVersions.machineId, opts.machineId),
      eq(machineTemplateVersions.productModelId, opts.productModelId),
    ))
    .orderBy(desc(machineTemplateVersions.version))
    .limit(1);

  const dem = demCapCay(opts.cay);
  const [moi] = await tx
    .insert(machineTemplateVersions)
    .values({
      machineId: opts.machineId,
      productModelId: opts.productModelId,
      version: (cao?.v ?? 0) + 1,
      checksum: opts.checksum,
      surfaceCount: dem.surfaces,
      positionCount: dem.positions,
      captureCount: dem.captures,
      componentCount: dem.components,
      // BẤT BIẾN — cây NGUYÊN VĂN. Không được đọc lại từ bảng sau này.
      snapshot: opts.cay,
      previousVersionId: hienHanh?.id ?? null,
    })
    .returning({ id: machineTemplateVersions.id, version: machineTemplateVersions.version });
  return { id: moi.id, version: moi.version, moi: true };
}

/** Đếm bốn cấp của một cây — dùng cho cột thống kê của sổ bản dạy. */
function demCapCay(cay: MachineTemplate): {
  surfaces: number; positions: number; captures: number; components: number;
} {
  let positions = 0, captures = 0, components = 0;
  for (const s of cay.surfaces) {
    positions += s.positions.length;
    for (const p of s.positions) {
      captures += p.captures.length;
      for (const c of p.captures) components += c.components.length;
    }
  }
  return { surfaces: cay.surfaces.length, positions, captures, components };
}

/**
 * Ghi TOÀN BỘ cây dạy trong **MỘT transaction**.
 *
 * ⚠ Một transaction là bắt buộc, không phải cho gọn: ghi từng cấp ở lượt riêng
 * để lại cây NỬA VỜI khi đứt giữa chừng (surface có, capture không) — và cây nửa
 * vời ở đây KHÔNG có tín hiệu nào báo, vì mọi cấp đều hợp lệ khi đứng một mình.
 * Cùng lý lẽ `persistInspectionAtomic` đã áp cho cây KẾT QUẢ.
 *
 * @param phienBanLucXoa `product_models.pointsConfigVersion` ĐỌC ĐƯỢC lúc đẩy —
 *   ghi vào `deletedAtVersion` của hàng bị xoá mềm (mig 0274: deltaSync chỉ gửi
 *   bia mộ cho máy còn dưới phiên bản đó). `null` = không biết ⇒ gửi vô điều kiện.
 */
export async function ghiCayDay(opts: {
  productModelId: number;
  /** ⚠ `auth.machine.id` — id máy ĐÃ XÁC THỰC, KHÔNG phải nhãn máy tự khai (I-4). */
  machineId: number;
  cay: MachineTemplate;
  phienBanLucXoa: number | null;
}): Promise<KetQuaGhiCayDay> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  const checksum = bamCayDay(opts.cay);

  return d.transaction(async (tx) => {
    // ── (0) PHIÊN BẢN TRƯỚC, TRONG CÙNG TRANSACTION ────────────────────────
    // Trước mọi hàng cây, vì `templateVersionId` phải đi vào chính các hàng đó.
    // Cùng transaction: một phiên bản không có cây (hoặc một cây không có phiên
    // bản) là đúng cái trạng thái nửa vời mà `ghiCayDay` sinh ra để tránh.
    const banDay = await moBanDay(tx, {
      machineId: opts.machineId,
      productModelId: opts.productModelId,
      checksum,
      cay: opts.cay,
    });

    let soSurface = 0;
    let soPosition = 0;
    let soCapture = 0;
    let soComponent = 0;
    let soXoaMem = 0;

    for (const [iSurface, surface] of opts.cay.surfaces.entries()) {
      const surfaceRowId = await ghiSurface(tx, opts.productModelId, opts.machineId, iSurface, surface);
      soSurface += 1;

      for (const position of surface.positions) {
        const positionRowId = await ghiPosition(tx, surfaceRowId, opts.machineId, position);
        soPosition += 1;

        for (const [iCapture, capture] of position.captures.entries()) {
          const captureRowId = await ghiCapture(tx, positionRowId, opts.machineId, iCapture, capture);
          soCapture += 1;

          for (const [iComponent, component] of capture.components.entries()) {
            await ghiComponent(
              tx, opts.productModelId, opts.machineId, banDay.id, captureRowId, iComponent, component,
            );
            soComponent += 1;
          }

          soXoaMem += await xoaMemComponentBienMat(
            tx,
            captureRowId,
            capture.components.map((c) => c.id),
            opts.phienBanLucXoa,
          );
        }
      }
    }

    return {
      surfaces: soSurface,
      positions: soPosition,
      captures: soCapture,
      components: soComponent,
      componentsXoaMem: soXoaMem,
      templateVersionId: banDay.id,
      templateVersion: banDay.version,
      phienBanMoi: banDay.moi,
      checksum,
    };
  });
}

/**
 * ★★★ Tra **BẢN DẠY ĐANG HIỆU LỰC** của `(máy, model)` tại một THỜI ĐIỂM.
 *
 * Đây là câu trả lời cho *"bo này chấm theo bản dạy nào?"* — và là lý do sổ bản
 * dạy dùng KHOẢNG `[pushedAt, supersededAt)` thay vì một cột trên hàng kết quả:
 * `measurement_results` là hypertable **ĐÃ NÉN** (đo `timescaledb_information.
 * hypertables`: `measurement_results[NEN]`), nên thêm cột vào đó là thứ Task 5
 * phải tránh. Một `product_inspections` chỉ cần mang sẵn `machineId` +
 * `productModelId` + thời điểm — cả ba đã có — là tra được.
 *
 * ⚠ Hàng trả về mang `snapshot` BẤT BIẾN: đó là cây NGUYÊN VĂN lúc đẩy, KHÔNG
 * phải các hàng `measurement_point_defs` hiện tại (chúng đã bị lượt đẩy sau ghi
 * đè tại chỗ). Đọc ROI/giới hạn của một bo CŨ thì đọc `snapshot`, đừng đọc bảng.
 *
 * `null` = tại thời điểm đó máy chưa từng đẩy bản dạy nào cho sản phẩm này.
 *
 * ⚠⚠ MÚI GIỜ — ĐỌC TRƯỚC KHI NỐI TASK 3. Ba cột thời gian của sổ này là
 * `timestamp WITHOUT time zone` và đều do `now()` của DB đóng dấu. Đo được
 * 2026-09-03: `current_setting('TimeZone')` của **cả hai** DB là `Etc/UTC`, nên
 * `now()` và một `Date` của Node rơi vào CÙNG một frame, và `opts.luc` là một
 * `Date` bình thường thì so đúng.
 * ⚠ Hai cái bẫy đã đo, đừng đạp lại:
 *   (a) **ĐỪNG đọc một cột timestamp ra rồi bind lại nó.** postgres.js đọc một
 *       `timestamp` naive bằng cách hiểu nó theo múi giờ CLIENT, rồi khi bind lại
 *       thì ghi ra UTC ⇒ lệch đúng bằng offset client. Đo: `pushedAt <= (giá trị
 *       vừa đọc ra của CHÍNH NÓ)` trả về **0 hàng** trên máy `+07:00`.
 *   (b) `product_inspections` ghi thời gian qua phép **dịch "fake UTC"** cố ý
 *       (doc 51 P1, `machineApiRouters.ts`). Nếu DB nào đó KHÔNG chạy `Etc/UTC`,
 *       hai bên sẽ lệch. Task 3 nối vào đây phải ĐO lại `current_setting('TimeZone')`
 *       trước khi tin phép so này, đừng thừa kế lời khai.
 */
export async function traBanDayTaiThoiDiem(opts: {
  machineId: number;
  productModelId: number;
  luc: Date;
}): Promise<MachineTemplateVersion | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  const hang = await d
    .select()
    .from(machineTemplateVersions)
    .where(and(
      eq(machineTemplateVersions.machineId, opts.machineId),
      eq(machineTemplateVersions.productModelId, opts.productModelId),
      // ⚠ Toán tử drizzle, KHÔNG phải `sql\`… <= ${date}\``: template thô bind Date
      // thành `timestamptz` (oid 1184) và postgres.js ném `ERR_INVALID_ARG_TYPE`
      // ngay ở tầng Bind — đo được, không suy đoán.
      lte(machineTemplateVersions.pushedAt, opts.luc),
      or(
        isNull(machineTemplateVersions.supersededAt),
        gt(machineTemplateVersions.supersededAt, opts.luc),
      ),
    ))
    .orderBy(desc(machineTemplateVersions.version))
    .limit(1);
  return hang[0] ?? null;
}

/** Bản dạy HIỆN HÀNH của `(máy, model)` — `supersededAt IS NULL`. */
export async function traBanDayHienHanh(opts: {
  machineId: number;
  productModelId: number;
}): Promise<MachineTemplateVersion | null> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  const hang = await d
    .select()
    .from(machineTemplateVersions)
    .where(and(
      eq(machineTemplateVersions.machineId, opts.machineId),
      eq(machineTemplateVersions.productModelId, opts.productModelId),
      isNull(machineTemplateVersions.supersededAt),
    ))
    .limit(1);
  return hang[0] ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// Khối B — Task 3 (B-4, Đ-19): TRA `pointDefId` CHO CẤP COMPONENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Khoá tra một linh kiện trong bản dạy: `captureExtId` + `componentExtId`.
 *
 * ⚠ VÌ SAO KHÔNG KHOÁ THEO `positionId`: đo mẫu máy THẬT
 * (`D:\SOURCES\AOIData\template-sync-sample.json`, 2026-09-03) — `positionId`
 * LẶP giữa hai surface (`TOP/P01` và `BOTTOM/P01`), còn 8/8 `captureExtId` là
 * GUID DUY NHẤT. Khoá theo position sẽ nhập nhằng ngay trên mẫu chuẩn.
 * ⚠ VÌ SAO CẶP NÀY chứ không riêng `componentExtId`: `uq_point_defs_capture_component`
 * (0340) là ràng buộc DUY NHẤT ở cấp component, và nó khoá theo ĐÚNG cặp này —
 * tra bằng cùng khoá mà DB cưỡng chế thì "nhiều hơn một kết quả" là chuyện KHÔNG
 * THỂ xảy ra trong phạm vi một capture.
 */
export function khoaCapComponent(captureExtId: string, componentExtId: string): string {
  return `${captureExtId}\u0000${componentExtId}`;
}

/** Kết quả một lượt tra bản dạy cho cả bo. */
export interface KetQuaTraPointDef {
  /** `khoaCapComponent(...)` → `measurement_point_defs.id`. Thiếu khoá = CHƯA DẠY. */
  readonly banDo: ReadonlyMap<string, number>;
  /**
   * ★★★ Khối B Task 4 (BG-92) — `khoaCapComponent(...)` → **giới hạn ĐÃ DẠY** của
   * chính point-def đó, cho spec-gate (`server/services/specGateCayV2.ts`).
   *
   * ⚠ CÙNG KHOÁ, CÙNG `SELECT`, CÙNG hàng với `banDo` — cố ý: "tra ra `pointDefId`"
   * và "tra ra giới hạn" KHÔNG THỂ lệch nhau, không thể lọc theo hai bộ điều kiện
   * khác nhau, và không cần một lượt đọc DB thứ hai. `banDo.has(k)` ⇔ `gioiHan.has(k)`
   * (lưới ghim bất biến này) — nên `gioiHan.get(k) === undefined` nghĩa là **CHƯA DẠY**,
   * KHÔNG phải "dạy rồi mà không có giới hạn". Ca thứ hai là một object có mặt với
   * mọi trường NULL, và `evaluatePointResult` trả `evaluated:false` cho nó.
   */
  readonly gioiHan: ReadonlyMap<string, PointLimitSource>;
  /**
   * Máy này đã dạy **sản phẩm đang chạy** chưa (khi `productModelId` biết được;
   * không biết thì lùi về "máy này từng dạy gì chưa").
   * Phân biệt HAI nhánh mà Task 3 xử lý KHÁC NHAU (xem `ghiCayKetQua`):
   * `false` = cửa cấp component CHƯA MỞ cho máy này; `true` = máy ĐÃ dạy nhưng
   * khai một linh kiện NGOÀI cây nó dạy — LỆCH THẬT, đáng ghi sổ.
   */
  readonly mayCoBanDay: boolean;
  /**
   * Khoá tra ra NHIỀU HƠN MỘT point-def ⇒ CỐ Ý bỏ khỏi `banDo`. Chỉ xảy ra khi
   * một máy có hai `product_captures` khác position mà TRÙNG `captureExtId` —
   * `uq_product_captures_position_extid` chỉ duy nhất theo `(positionRowId,
   * captureExtId)`, không theo máy. Đoán bừa một trong hai = ghi khoá ngoại sai
   * IM LẶNG, đúng thứ Task này tồn tại để không làm.
   */
  readonly khoaNhapNhang: readonly string[];
  /**
   * ★★★ Task 5 (BG-97 phơi counters) — số điểm chấm bằng giới hạn TÁI DỰNG từ
   * `measurement_point_versions` (bo cũ, limit đã đổi sau lúc bo được đo). Mặc định
   * `0` ở ĐÂY (hàm này không biết gì về cổng snapshot) — `traBanDayChoCay`
   * (`server/db/inspection.ts`) GHI ĐÈ hai trường này bằng kết quả THẬT của
   * `giaiGioiHanTaiLucDo` khi cổng snapshot áp dụng.
   */
  readonly theoSnapshot: number;
  /**
   * Số điểm chấm bằng giới hạn ĐANG SỐNG. Mặc định bằng `banDo.size` — đúng NGHĨA:
   * không chạy cổng snapshot thì MỌI điểm tra ra đều chấm theo giới hạn đang sống
   * (hành vi Task 4, trước BG-97).
   */
  readonly theoSong: number;
}

/**
 * ★★★ Tra `measurement_point_defs.id` cho từng cặp `(captureExtId, componentExtId)`
 * của MỘT máy ĐÃ XÁC THỰC. Đây là thứ mở khoá Đ-19: `measurement_results.pointDefId`
 * là `integer NOT NULL KHÔNG DEFAULT` (đo `information_schema` bằng `avi_app`,
 * 2026-09-03, cả hai DB) ⇒ tra không ra thì KHÔNG ghi được hàng nào.
 *
 * ⚠⚠ LỌC MÁY ĐI QUA `product_captures."machineId"`, **KHÔNG** qua
 * `measurement_point_defs."machineId"`. Đây không phải sở thích:
 * `measurement_point_defs.machineId` mang HAI NGHĨA sau Task 5 (điểm PHẲNG: "gắn
 * máy nào"; hàng CÂY: "máy nào dạy") và **không cổng nào canh** — chỉ có chú thích
 * phân biệt (mối lo Task 5 bàn giao). `product_captures.machineId` chỉ có MỘT
 * nghĩa, `NOT NULL`, và được khoá ngoại GHÉP `fk_captures_position_may` +
 * `fk_positions_surface_may` (0347) buộc bằng đúng máy của surface gốc — không
 * hàng con nào mang máy khác cha mà sống sót. Đi đường này thì "lấy đúng nghĩa
 * hàng cây" là HỆ QUẢ CẤU TẠO, không phải một lời hứa.
 *
 * ⚠ `deletedAt IS NULL` + `captureRowId IS NOT NULL`: linh kiện đã bị cây co lại
 * xoá mềm KHÔNG được tra ra (kết quả mới không được trỏ vào bản dạy đã chết), và
 * điểm đo PHẲNG cũ (`captureRowId IS NULL`, 39/2.761 hàng sống ở hai DB) không
 * bao giờ lọt vào đường cây.
 *
 * ⚠⚠ `productModelId` — LỌC THỨ HAI, BẮT BUỘC KHI BIẾT. Không phải phòng thủ giả
 * định: `uq_product_captures_position_extid` chỉ duy nhất theo `(positionRowId,
 * captureExtId)`, nên MỘT máy dạy HAI sản phẩm bằng cây CLONE (cùng bộ GUID
 * capture/component — theo báo cáo Task 5 là "ca thường gặp NHẤT ở phân xưởng")
 * cho ra HAI point-def cho cùng một cặp khoá. Đo được 2026-09-03: lượt chạy
 * `vitest run server/` SONG SONG với `cayDayChieuMay.db.test.ts` (cùng hai máy,
 * cùng mẫu máy thật, khác product model) làm cửa ZIP tra ra `chuaDay = 16/16` —
 * nhánh nhập nhằng bên dưới nổ đúng như thiết kế, và đó là bằng chứng khoá
 * `(máy, capture, component)` KHÔNG đủ. `null`/`undefined` = bo không phân giải
 * được mã sản phẩm ⇒ lọc theo máy thôi, và cặp nhập nhằng bị BỎ (đếm vào
 * `khoaNhapNhang`) chứ không đoán bừa.
 *
 * KHÔNG có khoá nào ⇒ trả bản đồ rỗng nhưng VẪN đo `mayCoBanDay` (một bo không
 * có linh kiện nào vẫn phải phân biệt được hai nhánh).
 */
export async function traPointDefCapComponent(opts: {
  machineId: number;
  productModelId?: number | null;
  khoa: readonly { captureExtId: string; componentExtId: string }[];
}): Promise<KetQuaTraPointDef> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  // ⚠ PHẠM VI CỦA `mayCoBanDay` là `(máy, sản phẩm)` khi biết sản phẩm, KHÔNG phải
  // máy-toàn-cục. Lý do là chính lý lẽ chống-phình-sổ của `ghiSoLechCayDay`: một máy
  // đã dạy sản phẩm A rồi chạy sản phẩm B CHƯA DẠY thì mọi bo B đều "lệch", và
  // machine-toàn-cục sẽ ghi một hàng WORM cho MỖI bo B. Câu hỏi đúng là "máy này đã
  // dạy CÁI ĐANG CHẠY chưa", không phải "máy này từng dạy gì chưa".
  const coBanDay = await d
    .select({ id: measurementPointDefs.id })
    .from(measurementPointDefs)
    .innerJoin(productCaptures, eq(productCaptures.id, measurementPointDefs.captureRowId))
    .where(and(
      eq(productCaptures.machineId, opts.machineId),
      isNull(measurementPointDefs.deletedAt),
      typeof opts.productModelId === "number"
        ? eq(measurementPointDefs.productModelId, opts.productModelId)
        : undefined,
    ))
    .limit(1);
  const mayCoBanDay = coBanDay.length > 0;

  const capIds = [...new Set(opts.khoa.map((k) => k.captureExtId))];
  const compIds = [...new Set(opts.khoa.map((k) => k.componentExtId))];
  if (capIds.length === 0 || compIds.length === 0) {
    return {
      banDo: new Map(), gioiHan: new Map(), mayCoBanDay, khoaNhapNhang: [],
      theoSnapshot: 0, theoSong: 0,
    };
  }

  // ★★★ Khối B Task 4 (BG-92) — GIỚI HẠN ĐÃ DẠY, lấy trong CHÍNH lượt SELECT
  // này. Một lượt đọc thứ hai (dù cùng khoá) là cách hai bộ lọc bắt đầu lệch
  // nhau; và `pointDefId` không kèm giới hạn thì spec-gate không có gì để tra.
  // ⚠ Task 7 Khối C (QĐ-3) — trước bản vá danh sách cột này chép TAY, và dòng
  // cảnh báo ở đây từng đọc "thiếu một cột ở đây là một chiều giới hạn KHÔNG
  // BAO GIỜ được chấm, và không lưới nào đỏ vì hàng vẫn ghi". Giờ dựng THẲNG từ
  // `POINT_LIMIT_SPEC` (MỘT nguồn sự thật, canh bằng
  // `server/contracts/pointLimitSpecCensus.test.ts`) — thiếu cột là spec thiếu,
  // và spec thiếu thì census đỏ.
  const gioiHanProjection = Object.fromEntries(
    POINT_LIMIT_SPEC.map((m) => [m.field, measurementPointDefs[m.field as keyof typeof measurementPointDefs]]),
  ) as { [K in (typeof POINT_LIMIT_SPEC)[number]["field"]]: (typeof measurementPointDefs)[K] };

  const hang = await d
    .select({
      pointDefId: measurementPointDefs.id,
      captureExtId: productCaptures.captureExtId,
      componentExtId: measurementPointDefs.componentExtId,
      ...gioiHanProjection,
    })
    .from(measurementPointDefs)
    .innerJoin(productCaptures, eq(productCaptures.id, measurementPointDefs.captureRowId))
    .where(and(
      eq(productCaptures.machineId, opts.machineId),
      isNotNull(measurementPointDefs.captureRowId),
      isNull(measurementPointDefs.deletedAt),
      // ⚠ ĐỘT BIẾN ĐÃ CHẠY (2026-09-03, đã hoàn tác): bỏ ba dòng dưới ⇒ MỆNH ĐỀ 8 ĐỎ,
      // nguyên văn `[aoi_management_test] bo khai T3B phải tra ĐÚNG bản dạy T3B, không
      // nhập nhằng: expected { tong: 16, daGhi: +0, …(2) } to deeply equal
      // { tong: 16, daGhi: 16, …(2) }`.
      typeof opts.productModelId === "number"
        ? eq(measurementPointDefs.productModelId, opts.productModelId)
        : undefined,
      inArray(productCaptures.captureExtId, capIds),
      inArray(measurementPointDefs.componentExtId, compIds),
    ));

  const banDo = new Map<string, number>();
  // ⚠ ĐỔ ĐẦY TRONG CÙNG VÒNG LẶP với `banDo`, và XOÁ ở CÙNG nhánh nhập nhằng —
  // hai bản đồ phải sống chết cùng nhau. Một cặp khoá bị bỏ khỏi `banDo` mà còn
  // trong `gioiHan` sẽ làm spec-gate chấm một linh kiện KHÔNG có hàng nào được ghi.
  const gioiHan = new Map<string, PointLimitSource>();
  const nhapNhang = new Set<string>();
  for (const h of hang) {
    if (h.componentExtId == null) continue; // không thể (vị từ IN đã lọc) — phòng kiểu
    const k = khoaCapComponent(h.captureExtId, h.componentExtId);
    const daCo = banDo.get(k);
    if (daCo !== undefined && daCo !== h.pointDefId) {
      nhapNhang.add(k);
      banDo.delete(k);
      gioiHan.delete(k);
      continue;
    }
    if (!nhapNhang.has(k)) {
      banDo.set(k, h.pointDefId);
      const { pointDefId: _id, captureExtId: _cap, componentExtId: _comp, ...gh } = h;
      gioiHan.set(k, gh);
    }
  }

  return {
    banDo, gioiHan, mayCoBanDay, khoaNhapNhang: [...nhapNhang],
    // Mặc định "mọi điểm tra ra ⇒ chấm theo giới hạn ĐANG SỐNG" — `traBanDayChoCay`
    // ghi đè bằng kết quả `giaiGioiHanTaiLucDo` khi cổng snapshot thực sự chạy.
    theoSnapshot: 0, theoSong: banDo.size,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// BG-97 — LỊCH SỬ SỬA GIỚI HẠN, NẠP MỘT LƯỢT CHO CẢ BO
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★★★ Nạp `measurement_point_versions` cho NHIỀU point-def trong **MỘT** `SELECT`.
 *
 * Đây là nguồn snapshot mà `giaiGioiHanTaiLucDo` (`server/services/gioiHanLucDoCayV2.ts`)
 * tái dựng giới hạn "lúc bo được đo". Người ghi các hàng này là `updateMeasurementPointDef`
 * (`server/db/product.ts`): mỗi lượt kỹ sư sửa một điểm đo, nó chụp hàng **TRƯỚC KHI SỬA**
 * vào `snapshotJson` và đóng dấu `changedAt = now()`.
 *
 * ── ⚠ VÌ SAO KHÔNG DÙNG LẠI `loadPointLimitSnapshots` CỦA v1.x ──────────────
 * Hàm đó (`server/routers/machineApiRouters.ts`) tra **MỘT** `pointDefId` mỗi lượt, có
 * cache theo submission. Đúng cho v1.x: nó chỉ chạy cho bo **ĐÃ BIẾT là STALE**, thường
 * là 0 lượt. Một bo CÂY có 16–48 lá (đo mẫu máy thật: 16 và 48) ⇒ bê nguyên sang v2 là
 * **N+1 trên đường ingest nóng** — đúng thứ mà docblock `traPointDefCapComponent` và khối
 * variant-override của v1.x đều ghi thành văn là phải tránh.
 * ⚠⚠ PHÉP **CHỌN** giới hạn thì **KHÔNG** chép: cả hai đường gọi CÙNG một hàm thuần
 * `resolveGateLimitsForBoard` (`server/services/pointResultEvaluator.ts`). Thứ trùng lặp
 * ở đây chỉ là câu `SELECT`, và nó **hẹp hơn** bản v1.x một cách có chủ ý (xem dưới).
 *
 * ── CỐ Ý KHÔNG chiếu cột 0282 `productPointsConfigVersion` ──────────────────
 * Đường v2 **không có** `pointsConfigVersion` để khai (`machineDataContractV2` không mang
 * trường đó — đo 2026-09-03), nên `giaiGioiHanTaiLucDo` luôn truyền `declaredVersion: null`
 * và nhánh VERSION-EXACT không bao giờ chạy ⇒ cột đó **không được đọc**. Không chiếu nó
 * cũng có nghĩa file này KHÔNG cần phép dò cột có-điều-kiện của v1.x (migration 0282 được
 * bảo vệ), tức bớt đúng một chỗ có thể hỏng.
 *
 * ⚠ BEST-EFFORT như v1.x: một lượt đọc hỏng ⇒ bản đồ RỖNG ⇒ mọi điểm rơi về giới hạn
 * ĐANG SỐNG (hành vi TRƯỚC BG-97), **không bao giờ** làm hỏng lượt ingest. Đây là chiều
 * an toàn: mất phần bảo vệ mới, không mất bo.
 */
export async function napLichSuGioiHanTheoDiem(
  pointDefIds: readonly number[],
): Promise<Map<number, PointLimitSnapshot[]>> {
  const ket = new Map<number, PointLimitSnapshot[]>();
  const ids = [...new Set(pointDefIds)].filter((x) => Number.isFinite(x));
  if (ids.length === 0) return ket;
  try {
    const d = await getDb();
    if (!d) return ket;
    const hang = await d
      .select({
        pointDefId: measurementPointVersions.pointDefId,
        changedAt: measurementPointVersions.changedAt,
        snapshotJson: measurementPointVersions.snapshotJson,
      })
      .from(measurementPointVersions)
      .where(inArray(measurementPointVersions.pointDefId, ids));
    for (const h of hang) {
      // ⚠ `changedAt` không phải `Date` (hàng hỏng/driver lạ) ⇒ BỎ, chứ không
      // `new Date(...)` bừa: `resolveLimitsAtInstant` lọc đúng vị từ này, và một
      // `Invalid Date` lọt vào sẽ làm phép chọn im lặng trả sai.
      if (!(h.changedAt instanceof Date) || !Number.isFinite(h.changedAt.getTime())) continue;
      const arr = ket.get(h.pointDefId);
      const s: PointLimitSnapshot = {
        changedAt: h.changedAt,
        limits: (h.snapshotJson ?? {}) as PointLimitSource,
        productPointsConfigVersion: null,
      };
      if (arr) arr.push(s);
      else ket.set(h.pointDefId, [s]);
    }
  } catch (err) {
    console.warn(
      `[cayDay] BG-97 — nạp lịch sử giới hạn HỎNG cho ${ids.length} point-def ` +
        `(cổng rơi về giới hạn ĐANG SỐNG, KHÔNG chặn ingest):`,
      (err as Error)?.message ?? err,
    );
    return new Map();
  }
  return ket;
}

// ════════════════════════════════════════════════════════════════════════════
// Khối C — Task 9 (QĐ-6): BỐN HÀM ĐỌC cho `cayDayRouter` — chưa từng có procedure
// đọc cây nào trước bản vá này (spec, mục "Đường đọc").
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠⚠ PHẠM VI TENANT — CÙNG KHUÔN `getMeasurementPointDefsByMachine` (`server/db/
// product.ts`), KHÔNG lọc theo cột client tự khai. `machineId`/`captureRowId` đến
// từ `input` là LỜI TỰ KHAI của người gọi — mỗi hàm dưới đây tra máy THẬT của đối
// tượng rồi kiểm `trongPhamVi("machine", …)` TRƯỚC khi đọc bất cứ gì, không suy
// phạm vi từ chính `input`. Đây là bài học `pham-vi-tenant-dot-lon` (hàng rào lọc
// theo cột TỰ KHAI mua được 0 gì).
// ⚠ Ngoài phạm vi ⇒ trả hình dạng RỖNG (mảng rỗng / cây rỗng / đếm 0), KHÔNG phân
// biệt "không tồn tại" khỏi "có thật nhưng của tenant khác" — cùng khuôn
// `productRouters.getReadiness` (`db.sanPhamTrongPhamVi` ⇒ `null`). Một câu riêng
// cho "tồn tại nhưng bạn không thấy" là một oracle rò rỉ.

/** Một máy đã dạy cây cho sản phẩm, kèm bản dạy hiện hành (nếu có). */
export interface MayCoBanDayCayDay {
  readonly machineId: number;
  readonly machineCode: string;
  readonly machineName: string;
  readonly banDayHienHanh: { version: number; checksum: string; pushedAt: Date } | null;
}

/**
 * `cayDayRouter.listMachinesForProduct` — máy nào đã dạy cây cho MỘT sản phẩm.
 *
 * ⚠ Nguồn "máy nào có cây" = `product_surfaces` (GỐC của chiều máy, Task 5 0347),
 * KHÔNG suy từ `measurement_point_defs`: `ghiCayDay` ghi cả cây trong MỘT
 * transaction nên surface luôn có mặt cùng lúc với component, và surface là cấp
 * RẺ nhất (2 hàng so với 16 ở mẫu chuẩn) để dò "những máy nào".
 * ⚠ Lọc phạm vi TRƯỚC khi đọc `product_surfaces`, không đọc rồi lọc: `idsTrongPhamVi`
 * trả `null` = toàn quyền (không thêm cổng), `[]` = phạm vi RỖNG (trả `[]` ngay,
 * không query gì thêm — "0 gán nhà máy" không phải "quên lọc").
 */
export async function traMayCoBanDay(opts: {
  productModelId: number;
  scope?: PhamViNguoiXem;
}): Promise<MayCoBanDayCayDay[]> {
  const d = await getDb();
  if (!d) return [];

  const { idsTrongPhamVi } = await import("./hierarchy");
  const idsPv = await idsTrongPhamVi("machine", opts.scope);
  if (idsPv !== null && idsPv.length === 0) return [];

  const hangSurface = await d
    .select({ machineId: productSurfaces.machineId })
    .from(productSurfaces)
    .where(and(
      eq(productSurfaces.productModelId, opts.productModelId),
      idsPv !== null ? inArray(productSurfaces.machineId, idsPv) : undefined,
    ));
  if (hangSurface.length === 0) return [];
  const ids = [...new Set(hangSurface.map((h) => h.machineId))];

  const hangMachine = await d
    .select({ id: machines.id, code: machines.code, name: machines.name })
    .from(machines)
    .where(inArray(machines.id, ids));

  const ketQua: MayCoBanDayCayDay[] = [];
  for (const m of hangMachine) {
    // N+1 nhỏ, có chủ đích: số máy dạy CÙNG một sản phẩm hiếm khi quá vài đơn vị
    // (khác `getTree`, nơi N là số capture — hàng chục — nên phải gộp một SELECT).
    const banDay = await traBanDayHienHanh({ machineId: m.id, productModelId: opts.productModelId });
    ketQua.push({
      machineId: m.id,
      machineCode: m.code,
      machineName: m.name,
      banDayHienHanh: banDay
        ? { version: banDay.version, checksum: banDay.checksum, pushedAt: banDay.pushedAt }
        : null,
    });
  }
  return ketQua;
}

/** Một capture trong cây — KHÔNG kèm component (payload to, tra riêng bằng `traComponentTheoCapture`). */
export interface CayDayCapture {
  readonly id: number;
  readonly captureExtId: string;
  readonly captureName: string | null;
  readonly soComponent: number;
}
/** Một position trong cây. */
export interface CayDayPosition {
  readonly id: number;
  readonly positionId: string;
  readonly name: string | null;
  readonly captures: readonly CayDayCapture[];
}
/** Một surface (mặt) trong cây. */
export interface CayDaySurface {
  readonly id: number;
  readonly surfaceName: string;
  readonly positions: readonly CayDayPosition[];
}

/**
 * `cayDayRouter.getTree` — cây surface→position→capture của MỘT `(sản phẩm, máy)`.
 * KHÔNG kèm component (spec QĐ-6: "tránh payload to") — `soComponent` là ĐẾM, còn
 * danh sách component thật tra riêng qua `traComponentTheoCapture(captureRowId)`.
 *
 * ⚠ `machineId` là TỰ KHAI ⇒ chặn ở trục MÁY TRƯỚC khi đọc hàng nào (không đọc rồi
 * mới kiểm). Ba cấp dưới (position/capture) KHÔNG lọc lại `machineId` — bất biến
 * khoá ngoại GHÉP (`fk_positions_surface_may`/`fk_captures_position_may`, mig 0347,
 * xem docblock đầu file) đã bảo đảm một hàng con không thể mang máy khác cha, nên
 * lọc gốc ở `product_surfaces` là đủ.
 * ⚠ Bốn lượt SELECT (surface/position/capture/đếm-component), KHÔNG N+1 theo capture:
 * đếm `soComponent` gộp MỘT `GROUP BY` cho toàn bộ capture của cây, đúng lý do QĐ-6
 * tách `getTree` khỏi `listComponents`.
 */
export async function traCayDay(opts: {
  productModelId: number;
  machineId: number;
  scope?: PhamViNguoiXem;
}): Promise<{ surfaces: CayDaySurface[] }> {
  const rong = { surfaces: [] as CayDaySurface[] };
  const { trongPhamVi } = await import("./hierarchy");
  if (!(await trongPhamVi("machine", opts.machineId, opts.scope))) return rong;

  const d = await getDb();
  if (!d) return rong;

  const hangSurface = await d
    .select({ id: productSurfaces.id, surfaceName: productSurfaces.surfaceName })
    .from(productSurfaces)
    .where(and(
      eq(productSurfaces.productModelId, opts.productModelId),
      eq(productSurfaces.machineId, opts.machineId),
    ))
    .orderBy(productSurfaces.orderIndex, productSurfaces.id);
  if (hangSurface.length === 0) return rong;
  const surfaceIds = hangSurface.map((s) => s.id);

  const hangPosition = await d
    .select({
      id: productPositions.id,
      surfaceRowId: productPositions.surfaceRowId,
      positionId: productPositions.positionId,
      name: productPositions.name,
    })
    .from(productPositions)
    .where(inArray(productPositions.surfaceRowId, surfaceIds))
    .orderBy(productPositions.positionIndex, productPositions.id);
  const positionIds = hangPosition.map((p) => p.id);

  const hangCapture = positionIds.length > 0
    ? await d
        .select({
          id: productCaptures.id,
          positionRowId: productCaptures.positionRowId,
          captureExtId: productCaptures.captureExtId,
          captureName: productCaptures.captureName,
        })
        .from(productCaptures)
        .where(inArray(productCaptures.positionRowId, positionIds))
        .orderBy(productCaptures.captureIndex, productCaptures.id)
    : [];
  const captureIds = hangCapture.map((c) => c.id);

  const demComponent = captureIds.length > 0
    ? await d
        .select({ captureRowId: measurementPointDefs.captureRowId, n: sql<number>`count(*)::int` })
        .from(measurementPointDefs)
        .where(and(
          inArray(measurementPointDefs.captureRowId, captureIds),
          isNull(measurementPointDefs.deletedAt),
        ))
        .groupBy(measurementPointDefs.captureRowId)
    : [];
  const soComponentTheoCapture = new Map<number, number>();
  for (const r of demComponent) {
    if (r.captureRowId != null) soComponentTheoCapture.set(r.captureRowId, Number(r.n));
  }

  const capturesTheoPosition = new Map<number, CayDayCapture[]>();
  for (const c of hangCapture) {
    const arr = capturesTheoPosition.get(c.positionRowId) ?? [];
    arr.push({
      id: c.id,
      captureExtId: c.captureExtId,
      captureName: c.captureName,
      soComponent: soComponentTheoCapture.get(c.id) ?? 0,
    });
    capturesTheoPosition.set(c.positionRowId, arr);
  }

  const positionsTheoSurface = new Map<number, CayDayPosition[]>();
  for (const p of hangPosition) {
    const arr = positionsTheoSurface.get(p.surfaceRowId) ?? [];
    arr.push({
      id: p.id,
      positionId: p.positionId,
      name: p.name,
      captures: capturesTheoPosition.get(p.id) ?? [],
    });
    positionsTheoSurface.set(p.surfaceRowId, arr);
  }

  return {
    surfaces: hangSurface.map((s) => ({
      id: s.id,
      surfaceName: s.surfaceName,
      positions: positionsTheoSurface.get(s.id) ?? [],
    })),
  };
}

/** Point-def cấp component, kèm trạng thái giới hạn suy từ `POINT_LIMIT_SPEC`. */
export interface ComponentCayDay {
  readonly id: number;
  readonly componentExtId: string | null;
  readonly name: string;
  readonly roiX: number | null;
  readonly roiY: number | null;
  readonly roiWidth: number | null;
  readonly roiHeight: number | null;
  readonly updatedAt: Date;
  readonly coGioiHan: boolean;
  readonly gioiHan: Record<string, string | null>;
}

/**
 * MỘT nguồn phân loại "có giới hạn" — dùng CHUNG `traComponentTheoCapture` VÀ
 * `traThongKeGioiHan` (QĐ-6: "số trên UI và số cổng chấm không thể lệch"). Đọc
 * TRỰC TIẾP từ `POINT_LIMIT_SPEC` (Task 7, QĐ-3) — KHÔNG chép tay danh sách cột.
 *
 * ⚠ Trừ `unit`: bản thân đơn vị không phải một giới hạn — cùng ngữ nghĩa `judge()`
 * của `evaluatePointResult` (`pointResultEvaluator.ts`), nơi `evaluated=true` chỉ
 * bật khi có `min`/`max` thật, không bao giờ chỉ vì có `unit`.
 * ⚠ `criteria` là jsonb mảng: một mảng RỖNG không phải "có tiêu chí" (đúng vòng lặp
 * `for (const raw of def.criteria)` của `evaluatePointResult` — mảng rỗng không lặp
 * gì, `evaluated` không bao giờ bật vì nó) nên được coi là NULL ở đây; giữ nguyên
 * mảng thì stringify để khớp kiểu `string|null` chung với 17 cột còn lại.
 */
function tinhGioiHan(row: Record<string, unknown>): { gioiHan: Record<string, string | null>; coGioiHan: boolean } {
  const gioiHan: Record<string, string | null> = {};
  for (const m of POINT_LIMIT_SPEC) {
    const v = row[m.field];
    if (v === null || v === undefined) {
      gioiHan[m.field] = null;
      continue;
    }
    if (m.field === "criteria") {
      gioiHan[m.field] = Array.isArray(v) && v.length > 0 ? JSON.stringify(v) : null;
      continue;
    }
    gioiHan[m.field] = String(v);
  }
  const coGioiHan = POINT_LIMIT_SPEC.some((m) => m.field !== "unit" && gioiHan[m.field] !== null);
  return { gioiHan, coGioiHan };
}

/** Chiếu đủ 18 cột `POINT_LIMIT_SPEC` thành một object `{field: column}` cho `.select()`. */
function chieuGioiHan() {
  return Object.fromEntries(
    POINT_LIMIT_SPEC.map((m) => [m.field, measurementPointDefs[m.field as keyof typeof measurementPointDefs]]),
  ) as { [K in (typeof POINT_LIMIT_SPEC)[number]["field"]]: (typeof measurementPointDefs)[K] };
}

/**
 * `cayDayRouter.listComponents` — point-def cấp COMPONENT của MỘT capture, kèm
 * trạng thái giới hạn (`coGioiHan`/`gioiHan`).
 *
 * ⚠ `captureRowId` là TỰ KHAI ⇒ tra MÁY THẬT của chính capture đó (không tin
 * `productModelId` từ input, vì input này còn không có trường đó) rồi chặn ở trục
 * MÁY TRƯỚC khi đọc component nào — capture không tồn tại hoặc máy ngoài phạm vi
 * đều trả `[]`, không phân biệt được (cùng khuôn "rỗng" của các hàm trên).
 */
export async function traComponentTheoCapture(opts: {
  captureRowId: number;
  scope?: PhamViNguoiXem;
}): Promise<ComponentCayDay[]> {
  const d = await getDb();
  if (!d) return [];

  const [capture] = await d
    .select({ machineId: productCaptures.machineId })
    .from(productCaptures)
    .where(eq(productCaptures.id, opts.captureRowId))
    .limit(1);
  if (!capture) return [];

  const { trongPhamVi } = await import("./hierarchy");
  if (!(await trongPhamVi("machine", capture.machineId, opts.scope))) return [];

  const hang = await d
    .select({
      id: measurementPointDefs.id,
      componentExtId: measurementPointDefs.componentExtId,
      name: measurementPointDefs.name,
      roiX: measurementPointDefs.roiX,
      roiY: measurementPointDefs.roiY,
      roiWidth: measurementPointDefs.roiWidth,
      roiHeight: measurementPointDefs.roiHeight,
      updatedAt: measurementPointDefs.updatedAt,
      ...chieuGioiHan(),
    })
    .from(measurementPointDefs)
    .where(and(
      eq(measurementPointDefs.captureRowId, opts.captureRowId),
      isNull(measurementPointDefs.deletedAt),
    ))
    .orderBy(measurementPointDefs.orderIndex, measurementPointDefs.id);

  return hang.map((h) => {
    const { gioiHan, coGioiHan } = tinhGioiHan(h as unknown as Record<string, unknown>);
    return {
      id: h.id,
      componentExtId: h.componentExtId,
      name: h.name,
      roiX: h.roiX,
      roiY: h.roiY,
      roiWidth: h.roiWidth,
      roiHeight: h.roiHeight,
      updatedAt: h.updatedAt,
      coGioiHan,
      gioiHan,
    };
  });
}

/**
 * `cayDayRouter.thongKeGioiHan` — đếm `daDay`/`chuaCoGioiHan` cho MỘT `(sản phẩm,
 * máy)`, dùng ĐÚNG `tinhGioiHan` mà `traComponentTheoCapture` dùng (một nguồn phân
 * loại — QĐ-6: "số trên UI và số cổng chấm không thể lệch").
 *
 * ⚠ Đếm bằng cách kéo cột giới hạn về rồi phân loại ở tầng ứng dụng (không phải một
 * `count(*) FILTER` viết tay lần thứ hai): một cây thật có vài chục đến trăm component
 * (mẫu chuẩn: 16), không phải hàng nghìn — phí đường truyền nhỏ hơn RỦI RO hai luật
 * phân loại trôi khỏi nhau mà không cổng nào canh (đúng bài học docblock đầu file
 * về danh sách cột chép tay).
 */
export async function traThongKeGioiHan(opts: {
  productModelId: number;
  machineId: number;
  scope?: PhamViNguoiXem;
}): Promise<{ tongComponent: number; daDay: number; chuaCoGioiHan: number }> {
  const rong = { tongComponent: 0, daDay: 0, chuaCoGioiHan: 0 };
  const { trongPhamVi } = await import("./hierarchy");
  if (!(await trongPhamVi("machine", opts.machineId, opts.scope))) return rong;

  const d = await getDb();
  if (!d) return rong;

  const hang = await d
    .select(chieuGioiHan())
    .from(measurementPointDefs)
    .innerJoin(productCaptures, eq(productCaptures.id, measurementPointDefs.captureRowId))
    .where(and(
      eq(measurementPointDefs.productModelId, opts.productModelId),
      eq(productCaptures.machineId, opts.machineId),
      isNotNull(measurementPointDefs.captureRowId),
      isNull(measurementPointDefs.deletedAt),
    ));

  let daDay = 0;
  for (const h of hang) {
    if (tinhGioiHan(h as unknown as Record<string, unknown>).coGioiHan) daDay += 1;
  }
  return { tongComponent: hang.length, daDay, chuaCoGioiHan: hang.length - daDay };
}

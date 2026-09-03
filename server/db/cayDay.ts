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
 * | surface   | (productModelId, surfaceExtId) | ❌ **KHÔNG TỒN TẠI** — chỉ có `uq_product_surfaces_model_name` (productModelId, **surfaceName**) |
 * | position  | (surfaceRowId, positionId)     | ✅ `uq_product_positions_surface_posid`               |
 * | capture   | (positionRowId, captureExtId)  | ✅ `uq_product_captures_position_extid`               |
 * | component | (captureRowId, componentExtId) | ✅ `uq_point_defs_capture_component` (PARTIAL: cả hai NOT NULL và `deletedAt IS NULL`) |
 *
 * ⇒ **SỐ ĐO BÁC BỎ kế hoạch ở cấp surface.** Không có index nào trên
 * `(productModelId, surfaceExtId)` ⇒ không `ON CONFLICT` được vào đó. Cách xử ở
 * đây, khai rõ để không ai đọc nhầm là "đã hội tụ theo extId ở tầng DB":
 *   1. SELECT hàng theo `(productModelId, surfaceExtId)` — hội tụ theo **extId**
 *      ở TẦNG ỨNG DỤNG (đây là thứ giữ đúng hàng khi máy ĐỔI TÊN một mặt).
 *   2. Không thấy ⇒ INSERT `ON CONFLICT (productModelId, surfaceName) DO UPDATE`
 *      — hội tụ theo **TÊN** ở TẦNG DB (đây là khoá DB thật sự cưỡng chế, VÀ là
 *      khoá mà KẾT QUẢ nối bằng: payload kết quả chỉ mang `name`, không mang
 *      `surfaceId`).
 * ⚠ Bước 1 KHÔNG chống được đua: hai lượt đẩy ĐỒNG THỜI cùng model có thể cùng
 * không thấy hàng rồi cùng INSERT — nhưng bước 2 biến cuộc đua đó thành một lượt
 * UPDATE, không phải hai hàng. Cái KHÔNG có bảo đảm là "hai extId khác nhau,
 * cùng một `surfaceName`": lúc đó hàng thứ hai sẽ GHI ĐÈ `surfaceExtId` của hàng
 * thứ nhất. Cửa chặn ca này bằng phép kiểm trùng `surfaceName` TRONG payload
 * (`machineApiRouters.ts`), nhưng KHÔNG chặn được giữa HAI lượt đẩy khác nhau —
 * đó là nợ thật, thuộc Task 5 (version per-máy per-bản-dạy).
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
 * ⚠ `machineId` CỐ Ý để NULL: ba cấp trên (`product_surfaces/positions/captures`)
 * KHÔNG có chiều máy nào, nên gắn máy ở riêng cấp bốn tạo một chiều nửa vời.
 * Chiều "bản dạy nào của máy nào" là Task 5.
 */
import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { measurementPointDefs } from "../../drizzle/schema";
import {
  productSurfaces,
  productPositions,
  productCaptures,
} from "../../drizzle/schema/productConfigTree";
import type { MachineTemplate } from "../contracts/machineTemplateContract";

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
  thuTu: number,
  s: MachineTemplate["surfaces"][number],
): Promise<number> {
  const daCo = await tx
    .select({ id: productSurfaces.id })
    .from(productSurfaces)
    .where(and(
      eq(productSurfaces.productModelId, productModelId),
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
    .values({ productModelId, surfaceExtId: s.surfaceId, ...giaTri })
    .onConflictDoUpdate({
      target: [productSurfaces.productModelId, productSurfaces.surfaceName],
      set: { surfaceExtId: s.surfaceId, ...giaTri },
    })
    .returning({ id: productSurfaces.id });
  return hang.id;
}

/** Cấp 2 — `product_positions`, hội tụ theo `uq_product_positions_surface_posid`. */
async function ghiPosition(
  tx: TxCayDay,
  surfaceRowId: number,
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
    .values({ surfaceRowId, positionId: p.positionId, ...giaTri })
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
    .values({ positionRowId, captureExtId: c.id, ...giaTri })
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
  cay: MachineTemplate;
  phienBanLucXoa: number | null;
}): Promise<KetQuaGhiCayDay> {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();

  return d.transaction(async (tx) => {
    let soSurface = 0;
    let soPosition = 0;
    let soCapture = 0;
    let soComponent = 0;
    let soXoaMem = 0;

    for (const [iSurface, surface] of opts.cay.surfaces.entries()) {
      const surfaceRowId = await ghiSurface(tx, opts.productModelId, iSurface, surface);
      soSurface += 1;

      for (const position of surface.positions) {
        const positionRowId = await ghiPosition(tx, surfaceRowId, position);
        soPosition += 1;

        for (const [iCapture, capture] of position.captures.entries()) {
          const captureRowId = await ghiCapture(tx, positionRowId, iCapture, capture);
          soCapture += 1;

          for (const [iComponent, component] of capture.components.entries()) {
            await ghiComponent(tx, opts.productModelId, captureRowId, iComponent, component);
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
    };
  });
}

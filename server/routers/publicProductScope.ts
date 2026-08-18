/**
 * ★★★ 2026-08-18 — **PHẠM VI NHÀ MÁY cho API SẢN PHẨM CÔNG KHAI** (`publicProductApiRouter`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO. Tám thủ tục `publicProcedure` của `publicProductApiRouter` gọi
 * `await validateAccess(input);` rồi **VỨT giá trị trả về đi**. Mà `validateAccess` CÓ phân giải
 * ra đối tượng `machine` — tức danh tính đã nằm trong tay handler và không ai dùng. Hệ quả: một
 * máy (hoặc bất kỳ ai đọc được **mã máy** in trên nhãn thiết bị) đọc trọn danh mục sản phẩm, ảnh
 * mẫu, điểm đo, thống kê và ảnh đo THỰC TẾ của **MỌI nhà máy**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHẢI CÓ FILE NÀY — BA THỨ KHÔNG GẮN THẲNG ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **(1) Danh tính ở đây KHÔNG phải người dùng.** `resolveTenantFactoryScope` /
 * `machineIdsTrongPhamVi` đều đi từ `userId` → mã gán → `factories.id`. Ở đây không có `ctx.user`
 * nào cả: người gọi là một MÁY trình khoá (hoặc mã máy) trong `input`. Nên trục phạm vi phải bắt
 * đầu từ **`machines.id` → `factories.id`**, chiều NGƯỢC với mọi bộ phân giải đang có.
 *
 * **(2) `machines` KHÔNG mang mã nhà máy** — chỉ `stationId`; đường ra nhà máy dài 4 chặng
 * (`machines → stations → production_lines → workshops."factoryId"`). Chuỗi ấy đã bị chép tay ở
 * `services/oeeService.ts`, `db/hierarchy.machineIdsTrongPhamVi` và
 * `services/ecosystem/commandCenterScope.scopedMachineIds`. **Bản thứ tư sẽ là bản lệch.** Nên ở
 * đây KHÔNG có một dòng SQL phân cấp nào: chiều xuôi (nhà-máy → máy) dùng lại
 * `machineIdFactoryGate`; chiều ngược (máy → nhà-máy) **ghép từ ba phép tra cứu KHOÁ CHÍNH đã có**
 * (`getStationById` · `getLineById` · `getWorkshopById`). Không JOIN mới, không luật mới.
 *
 * **(3) `product_models` KHÔNG có cột nhà máy nào** (đã kiểm cả `drizzle/schema/product.ts` lẫn
 * `information_schema`). Sản phẩm là dữ liệu chủ DÙNG CHUNG; nó chỉ chạm tới một nhà máy qua các
 * bảng LIÊN KẾT mang `machineId`. Đo trên `aoi_management` ngày 2026-08-18, với 4 sản phẩm còn
 * `isActive` và 41 máy (đều thuộc nhà máy 1 `SIM-FAC`):
 *
 *   ┌──────────────────────────────┬──────────────────────────────┬────────────────────────┐
 *   │ đường liên kết               │ cột                          │ sản phẩm chiếu ra được │
 *   ├──────────────────────────────┼──────────────────────────────┼────────────────────────┤
 *   │ product_machine_mappings     │ machineId (NOT NULL, FK)     │ 30 · 41                │
 *   │ measurement_point_defs       │ machineId (nullable)         │ 1                      │
 *   │ product_inspections          │ machineId                    │ 41 · 42                │
 *   ├──────────────────────────────┴──────────────────────────────┼────────────────────────┤
 *   │ HỢP của ba đường                                            │ 1 · 30 · 41 · 42 = ĐỦ  │
 *   └─────────────────────────────────────────────────────────────┴────────────────────────┘
 *
 * ⇒ **Cả ba đường đều LOAD-BEARING**: bỏ bất kỳ đường nào cũng làm biến mất một sản phẩm ĐANG
 * DÙNG của chính nhà máy đó (bỏ `product_inspections` mất `SIM-PCB-SENSOR`; bỏ
 * `measurement_point_defs` mất `__UNMAPPED__`; bỏ `product_machine_mappings` mất `GB300`). Đây là
 * lý do ĐO ĐƯỢC để lấy HỢP chứ không phải một lựa chọn cho tiện. Và vì hợp của ba đường phủ đúng
 * 4/4 sản phẩm hoạt động, bản vá này **không cắt mất gì** của nhà máy duy nhất đang có máy.
 *
 * ⚠ `product_machine_mappings.isActive = false` VẪN được tính. Một bản gán đã gỡ chứng minh sản
 * phẩm ấy TỪNG thuộc nhà máy này — đó là câu hỏi về DANH TÍNH, không phải về quyền. Loại nó ra sẽ
 * làm một máy mất khả năng đọc lại chính công thức nó vừa chạy hôm qua.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `masterKey` = **TOÀN CỤC TƯỜNG MINH** — và vì sao đó là kết luận, không phải bỏ sót
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `isValidMasterKey` (`_core/masterKey.ts`) so `timingSafeEqual` với **ĐÚNG MỘT** giá trị
 * `MASTER_API_KEY` của cả bản triển khai. Không có bảng nào buộc một master key vào một nhà máy —
 * cơ chế khoá CÓ phạm vi là bảng `api_keys` (mang `factoryCode`/`corporateCode`), một cơ chế KHÁC
 * hẳn. Tức **không tồn tại nhà máy nào để thu hẹp về**: mọi lựa chọn khác `null` đều là bịa.
 *   • Thu hẹp về `1 = 0` sẽ giết đường ảnh `x-master-key` của ứng dụng di động
 *     (`FactoryAlertSystem/src/services/stationService.ts:1451`) mà không đóng lỗ nào.
 *   • Tiền lệ trong repo: `api/export/exportRouter.reportScopeAxisOf` trả `{}` (= không lọc) cho
 *     "khoá TOÀN CỤC TƯỜNG MINH", và ghi rõ đó là *"một quyết định ai đó đã ghi ra"*.
 * Nên nó là một NHÁNH CÓ TÊN của kiểu `PhamViMayGoi`, không phải một `null` rơi vào nhánh mặc
 * định: `factoryIdCanThuHep` là `switch` VÉT CẠN, thêm một lối vào thứ tư mà quên xử ⇒ `tsc` đỏ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BỐN BẪY CỦA REPO NÀY, ĐỀU ĐƯỢC NÉ TẠI ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **Lỗi vòng JSON** — `PhamViMayGoi` KHÔNG có ô `filter`. Một `ResolvedDataScope` mang đối
 *     tượng SQL drizzle (tham chiếu vòng `PgTable → PgSerial → table`) lọt ra tRPC là
 *     `Converting circular structure to JSON`, và `tsc` KHÔNG bắt được (chỉ cấm thuộc tính thừa
 *     với *object literal*). Ở đây kiểu chỉ mang ba số/chuỗi, nên lỗi ấy **không diễn đạt được**.
 *  2. **Bí danh SQL** — mọi truy vấn phụ viết bằng đối tượng bảng drizzle, KHÔNG đặt bí danh
 *     (drizzle kết xuất cột theo TÊN BẢNG ⇒ một `FROM x AS y` sẽ vỡ `42P01`).
 *  3. **`col = ANY(${mảngJS})`** — không dùng ở đâu; `machineIdFactoryGate` → `factoryIdGate`
 *     trải từng phần tử thành tham số riêng (mảng JS sẽ thành `text[]` ⇒ `42809`, đã cắn 10 chỗ).
 *  4. **Tập rỗng phải TƯỜNG MINH** — `factoryIdGate([])` cho `1 = 0`, không bao giờ `undefined`.
 *
 * ⚠ **0 DÒNG IM LẶNG LÀ NÓI DỐI.** Ba thủ tục trả DANH SÁCH mang thêm ô `scopeApplied` để phía
 * gọi phân biệt "nhà máy tôi không có sản phẩm nào" với "tôi vừa bị thu hẹp". Năm thủ tục còn lại
 * tra theo KHOÁ, nên chúng **NÉM** `SCOPE_MISMATCH` chứ không trả rỗng — tiền lệ:
 * `api/export/biRouter.dataset_not_tenant_scopable`.
 */
import { and, eq, sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  productModels,
  productMachineMappings,
  measurementPointDefs,
  productInspections,
} from "../../drizzle/schema";
import { machineIdFactoryGate } from "../services/ecosystem/commandCenterScope";
import { appError } from "../_core/appError";
import { getDb } from "../db/connection";
import * as db from "../db";

/**
 * Mã MÁY-ĐỌC-ĐƯỢC gắn vào `fallbackMessage` của mọi lượt từ chối vì phạm vi.
 *
 * ⚠ Vì sao lặp mã vào câu chữ thay vì chỉ dựa vào `appCode`: cửa REST
 * (`server/_core/index.ts` `/api/public/**`) bắt `TRPCError` rồi trả
 * `{ success:false, error: message }` — `shape.data.appCode` **KHÔNG đi qua** cửa ấy. Client
 * không-tRPC (Android/C#/Python) vì thế chỉ còn câu chữ để bám vào; một mã ổn định trong câu là
 * thứ duy nhất họ khớp được mà không phải so tiếng người.
 */
export const MA_NGOAI_PHAM_VI = "machine_factory_scope_denied";

/** Mã riêng cho ca **không phân giải nổi** nhà máy của máy (khác hẳn "phân giải được nhưng khác nhà máy"). */
export const MA_KHONG_PHAN_GIAI_DUOC = "machine_factory_scope_unresolved";

/**
 * Phạm vi của **NGƯỜI GỌI** một thủ tục trong `publicProductApiRouter`.
 *
 * KHÔNG có ô `filter` (bẫy 1 ở đầu file). Hai nhánh, cả hai CÓ TÊN — xem khối `masterKey`.
 */
export type PhamViMayGoi =
  | { readonly kieu: "toanCuc" }
  | {
      readonly kieu: "nhaMay";
      readonly factoryId: number;
      readonly machineId: number;
      readonly machineCode: string;
    };

/** Nhánh toàn cục, đặt tên một lần để nơi gọi không phải viết object literal rải rác. */
export const PHAM_VI_TOAN_CUC: PhamViMayGoi = { kieu: "toanCuc" };

/**
 * `null` = **KHÔNG áp cổng nào** (toàn cục tường minh). Số = `factories.id` phải thu hẹp về.
 *
 * ⚠ `switch` VÉT CẠN có chủ ý: thêm một lối vào thứ tư vào `validateAccess` mà quên quyết định
 * phạm vi của nó ⇒ `tsc` đỏ ngay tại đây, chứ không lặng lẽ rơi vào một `return null` mặc định
 * (= "không lọc" = đúng cái lỗ bản vá này đi đóng).
 */
export function factoryIdCanThuHep(pv: PhamViMayGoi): number | null {
  switch (pv.kieu) {
    case "toanCuc":
      return null;
    case "nhaMay":
      return pv.factoryId;
  }
}

/**
 * `stations.id` → `factories.id`, ghép từ hai phép tra cứu KHOÁ CHÍNH đã có.
 *
 * ⚠ KHÔNG viết JOIN mới (xem lý do (2) ở đầu file). Ba cột trên đường đi đều `NOT NULL` + có FK
 * `ON DELETE RESTRICT` (`fk_stations_line` · `fk_production_lines_workshop` · `fk_workshops_factory`,
 * đã kiểm trên `pg_constraint` ngày 2026-08-18), nên `null` ở đây nghĩa là CSDL vắng hoặc một hàng
 * vừa biến mất giữa chừng — cả hai đều phải **fail-closed**, không được đoán.
 */
export async function factoryIdCuaTram(station: { lineId: number }): Promise<number | null> {
  const line = await db.getLineById(station.lineId);
  if (!line) return null;
  const workshop = await db.getWorkshopById(line.workshopId);
  return workshop?.factoryId ?? null;
}

/**
 * ★★★ **BỘ PHÂN GIẢI PHẠM VI của lối đi MÁY** — `machines` → `factories.id`.
 *
 * ⚠⚠ Tên hàm này nằm trong `TEN_PHAN_GIAI` của `server/routers/phamViDocScan.ts`. Đó KHÔNG phải
 * trang trí: bộ điều tra dân số phạm vi đọc phân loại theo *"danh tính có RỜI TAY handler không"*,
 * và danh tính ở đây **không đi qua `ctx`** (người gọi là một máy trình khoá trong `input`). Không
 * khai tên hàm ở đó thì tám thủ tục này bị đếm mãi mãi vào nhóm **A = RÒ RỈ** kể cả sau khi đã vá
 * — tức sổ nợ nói dối theo chiều ngược lại. Xem `phamViDocCensus.test.ts` §8.
 *
 * NÉM (không trả `null`) khi không phân giải được: nơi gọi mà nhận `null` sẽ phải tự nhớ kiểm
 * tra, và một lần quên là một lượt rò im lặng. Ném là hình dạng KHÔNG QUÊN ĐƯỢC.
 */
export async function phamViNhaMayCuaMay(machine: {
  id: number;
  code: string;
  stationId: number | null;
}): Promise<PhamViMayGoi> {
  const station = machine.stationId != null ? await db.getStationById(machine.stationId) : undefined;
  const factoryId = station ? await factoryIdCuaTram(station) : null;
  if (factoryId == null) {
    throw appError(
      "FORBIDDEN",
      "SCOPE_MISMATCH",
      { entity: "machine", parent: "factory" },
      `${MA_KHONG_PHAN_GIAI_DUOC}: machine '${machine.code}' cannot be resolved to a factory ` +
        `(station/line/workshop chain is broken), so this request cannot be narrowed and is refused ` +
        `rather than served unfiltered data.`,
    );
  }
  return { kieu: "nhaMay", factoryId, machineId: machine.id, machineCode: machine.code };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỔNG SQL — chiếu một nhà máy xuống `product_models.id`
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vị từ: cột `product_models.id` (hoặc bất kỳ cột `productModelId` nào) thuộc `factoryId`.
 *
 * HỢP của **ba** đường liên kết — xem bảng đo ở đầu file để biết vì sao cả ba đều bắt buộc.
 * Mỗi đường đều đi qua ĐÚNG MỘT nguyên thuỷ dùng chung `machineIdFactoryGate` (bản thân nó gói
 * trọn chuỗi `machines → stations → production_lines → workshops`), nên ở đây không có một dòng
 * SQL phân cấp nào để lệch với ba bản kia.
 *
 * ⚠ `IS NOT NULL` TƯỜNG MINH ở hai đường có cột nullable: `x IN (…, NULL, …)` cho `NULL` chứ
 * không cho `FALSE`, và `NULL` trong `WHERE` loại hàng — đúng chiều fail-closed, nhưng viết rõ ra
 * để người đọc sau không phải suy ra hành vi ba trạng thái của SQL mới tin được cái cổng.
 */
export function congSanPhamTrongNhaMay(cotSanPhamId: SQL | AnyColumn, factoryId: number): SQL {
  const ids = [factoryId];
  return sql`${cotSanPhamId} IN (
    SELECT ${productMachineMappings.productModelId} FROM ${productMachineMappings}
      WHERE ${machineIdFactoryGate(productMachineMappings.machineId, ids)}
    UNION
    SELECT ${measurementPointDefs.productModelId} FROM ${measurementPointDefs}
      WHERE ${measurementPointDefs.machineId} IS NOT NULL
        AND ${machineIdFactoryGate(measurementPointDefs.machineId, ids)}
    UNION
    SELECT ${productInspections.productModelId} FROM ${productInspections}
      WHERE ${productInspections.productModelId} IS NOT NULL
        AND ${machineIdFactoryGate(productInspections.machineId, ids)}
  )`;
}

/**
 * Một sản phẩm CỤ THỂ có nằm trong nhà máy không.
 *
 * Cố ý dùng LẠI ĐÚNG vị từ của đường danh sách (`congSanPhamTrongNhaMay`) thay vì viết một phép
 * kiểm thứ hai: hai phép kiểm cho cùng một câu hỏi là cách chúng lệch nhau, và **bản lỏng hơn** sẽ
 * quyết định ai thấy gì.
 *
 * ⚠ CSDL vắng ⇒ `false` (fail-closed), KHÔNG phải `true`.
 */
export async function sanPhamTrongNhaMay(productModelId: number, factoryId: number): Promise<boolean> {
  const database = await getDb();
  if (!database) return false;
  const rows = await database
    .select({ id: productModels.id })
    .from(productModels)
    .where(and(eq(productModels.id, productModelId), congSanPhamTrongNhaMay(productModels.id, factoryId)))
    .limit(1);
  return rows.length > 0;
}

/** Thực thể bị từ chối — dùng chung không gian từ điển `errors.entity.*` (vi/en/zh đã có đủ). */
export type ThucTheNgoaiPhamVi = "productModel" | "measurementPoint" | "station";

/**
 * TỪ CHỐI một lượt đọc nằm ngoài nhà máy của người gọi.
 *
 * ⚠ Vì sao **NÉM** chứ không trả 0 dòng: trả rỗng cho một phép tra-theo-khoá là nói với người gọi
 * *"thứ bạn hỏi không tồn tại"* trong khi sự thật là *"nó tồn tại và bạn không được xem"* — người
 * vận hành sẽ đi tạo lại một bản ghi trùng, hoặc đi tìm lỗi ở chỗ không có lỗi. Repo này đã trả
 * giá cho lớp lỗi ấy nhiều lần; tiền lệ ngược lại là
 * `api/export/biRouter.dataset_not_tenant_scopable`.
 *
 * ⚠ `entity` ở đây là THAM SỐ nên `appErrorParamsCoverage.test.ts` (chỉ quét literal) không kiểm
 * được nó. Kiểu `ThucTheNgoaiPhamVi` là cái thay thế: cả ba giá trị đã được kiểm tay có khoá ở
 * `errors.entity.*` của **cả** vi/en/zh (2026-08-18), và `tsc` chặn giá trị thứ tư.
 */
export function tuChoiNgoaiPhamVi(entity: ThucTheNgoaiPhamVi, moTa: string): never {
  throw appError(
    "FORBIDDEN",
    "SCOPE_MISMATCH",
    { entity, parent: "factory" },
    `${MA_NGOAI_PHAM_VI}: ${moTa} is outside the factory of the calling machine. The request is ` +
      `refused instead of being answered with unfiltered data or a silent empty result.`,
  );
}

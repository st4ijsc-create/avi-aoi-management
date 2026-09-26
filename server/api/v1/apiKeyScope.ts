/**
 * ★★★ PHẠM VI TENANT CỦA KHOÁ API — BA trạng thái, và vì sao phải là ba.
 * ════════════════════════════════════════════════════════════════════════════
 * `api_keys.scopes` trả lời câu hỏi **"khoá này LÀM ĐƯỢC GÌ"** (`bi:read`,
 * `export:read`, `ingest:write`…). Nó CHƯA BAO GIỜ trả lời **"khoá này THẤY
 * ĐƯỢC GÌ"**. Trước migration 0325, bất kỳ khoá nào có `bi:read` đều kéo được
 * số liệu của TOÀN BỘ nhà máy — bảng `api_keys` không mang một cột tenant nào.
 *
 * Chủ dự án chốt 2026-08-17: *"khoá API đại diện MỘT NHÀ MÁY; khoá chưa khai
 * phạm vi thì từ chối"*. Điều đó cần BA trạng thái phân biệt được, không phải hai:
 *
 *   1. **CHƯA KHAI** — `dataScopeMode IS NULL`. Mặc định của MỌI khoá đang tồn
 *      tại (27 khoá trên `aoi_management`, đo 2026-08-17). `bi:read`/`export:read`
 *      ⇒ **403**, kèm câu nói rõ khoá chưa được gán phạm vi.
 *   2. **KHAI MỘT NHÀ MÁY** — `dataScopeMode = 'factory'` + ít nhất một trong
 *      `corporateCode`/`factoryCode`. Mọi truy vấn bị thu hẹp về đúng mã ấy.
 *   3. **KHAI TOÀN CỤC TƯỜNG MINH** — `dataScopeMode = 'global'`. Thấy tất cả.
 *      BI cấp tập đoàn là nhu cầu thật nên đường này PHẢI có — nhưng nó là một
 *      **quyết định ai đó ghi ra**, không phải hệ quả của việc để trống.
 *
 * ⚠⚠ **VÌ SAO KHÔNG DÙNG `NULL` LÀM "TOÀN CỤC"** (tức vì sao có cột `dataScopeMode`
 * thay vì chỉ hai cột mã). Đó chính xác là lớp lỗi `or()` rỗng vừa vá tuần này ở
 * `_core/accessControl.ts`: một **giá trị vắng mặt bị đọc thành "không lọc"**, và
 * hậu quả đo được là 4 tài khoản 0-gán đọc trọn 22.996/22.996 bản ghi kiểm. Nếu
 * `factoryCode IS NULL` mang nghĩa "toàn cục" thì mọi khoá quên khai — kể cả 27
 * khoá cũ — sẽ **im lặng trở thành khoá toàn cục**, và không ai phân biệt được
 * "được cấp quyền toàn cục" với "chưa ai nghĩ tới chuyện này". Một cột mode
 * TƯỜNG MINH biến hai chuyện ấy thành hai giá trị khác nhau trong CSDL.
 *
 * ⚠ **VÌ SAO KHÔNG DÙNG LẠI THẲNG `getAccessFilterConditions`.** Hàm ấy nhận
 * `(userId, userRole)` và tra `user_factory_assignments`. Một khoá API **không
 * phải một người dùng**: `api_keys.createdBy` là NULLable, và dùng danh tính của
 * người đã tạo khoá làm phạm vi của khoá là sai về ngữ nghĩa (người tạo nghỉ việc,
 * hoặc là admin ⇒ khoá tự động thành toàn cục). Cái được DÙNG LẠI ở đây là **không
 * gian mã** — cùng `productInspections.corporateCode/factoryCode` mà
 * `getAccessFilterConditions` so sánh, cùng `factories.code`, cùng
 * `user_factory_assignments.factoryCode` — và ba ô nhãn qua `scopeLabelsOf`.
 * (Cùng lý lẽ đã ghi ở `resolveSavedHeatmapScope`, services/defectSpatialHeatmap.ts.)
 *
 * ⚠ **BẪY BÍ DANH SQL.** `inspectionTenantFilter` kết xuất cột theo **tên BẢNG**
 * (`"product_inspections"."factoryCode"`), KHÔNG theo bí danh. Truy vấn raw nào
 * viết `FROM product_inspections pi` sẽ vỡ `42P01` khi nhúng điều kiện này — bỏ
 * bí danh đi (đã làm ở `biRouter.ts`), và nhúng nguyên đối tượng `SQL` để tham số
 * đi qua đường **ràng buộc**, đừng nối chuỗi.
 *
 * ⚠ **KHÔNG cho `filter` ra đường dây.** Đối tượng SQL của drizzle mang tham chiếu
 * vòng (`PgTable → PgSerial → table`); `{...scope}` trên đường ra là 500 cho mọi
 * người gọi (đã xảy ra thật 2026-08-17 với `dashboard.getStats`, sau một lượt
 * `tsc` sạch + 220 ca xanh). Nhãn đi ra ngoài PHẢI qua `tenantScopeLabels()`.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Request, Response, NextFunction } from "express";
import { sql, type SQL } from "drizzle-orm";
import { sendError } from "./envelope";
import { scopeLabelsOf, type ScopeLabels } from "../../_core/accessControlLabels";
import {
  tenantCodeInspectionFilter,
  type TenantCodeScope,
} from "../../_core/tenantCodeScope";

// ── Mô hình ba trạng thái ────────────────────────────────────────────────────

/** Hai giá trị KHAI ĐƯỢC. Trạng thái thứ ba (chưa khai) là `null`, không phải một giá trị ở đây. */
export const API_KEY_SCOPE_MODES = ["factory", "global"] as const;
export type ApiKeyScopeMode = (typeof API_KEY_SCOPE_MODES)[number];

export interface ApiKeyTenantScope {
  /** `null` = CHƯA KHAI (⇒ từ chối). Không bao giờ đồng nghĩa với "toàn cục". */
  mode: ApiKeyScopeMode | null;
  corporateCode: string | null;
  factoryCode: string | null;
}

/** Mặc định fail-closed cho mọi principal không mang khai báo phạm vi. */
export const UNDECLARED_TENANT_SCOPE: ApiKeyTenantScope = Object.freeze({
  mode: null,
  corporateCode: null,
  factoryCode: null,
});

/** Toàn cục TƯỜNG MINH — chỉ được dựng ở nơi có một quyết định thật đứng sau. */
export const GLOBAL_TENANT_SCOPE: ApiKeyTenantScope = Object.freeze({
  mode: "global",
  corporateCode: null,
  factoryCode: null,
});

/**
 * Đọc phạm vi từ một hàng `api_keys`.
 *
 * ⚠ Fail-closed ở MỌI hình dạng lệch: mode lạ, `'factory'` mà không có mã nào,
 * hàng `null`/`undefined` — tất cả đều rơi về CHƯA KHAI. Ràng buộc CHECK của
 * migration 0325 đã cấm hàng lệch ở tầng CSDL; đây là lớp thứ hai cho các bản
 * triển khai đã có dữ liệu lệch từ trước hoặc ghi bằng đường khác (psql).
 */
export function tenantScopeFromRow(
  row: { dataScopeMode?: string | null; corporateCode?: string | null; factoryCode?: string | null } | null | undefined,
): ApiKeyTenantScope {
  const mode = row?.dataScopeMode ?? null;
  if (mode === "global") return GLOBAL_TENANT_SCOPE;
  if (mode === "factory") {
    const corporateCode = row?.corporateCode ?? null;
    const factoryCode = row?.factoryCode ?? null;
    // 'factory' mà không có mã nào = một lời khai RỖNG. Đọc nó thành "toàn cục"
    // là tái lập đúng lỗi `or()` rỗng ⇒ coi như CHƯA KHAI.
    if (!corporateCode && !factoryCode) return UNDECLARED_TENANT_SCOPE;
    return { mode: "factory", corporateCode, factoryCode };
  }
  return UNDECLARED_TENANT_SCOPE;
}

/** Đã có người GHI RA một phạm vi cho khoá này chưa? */
export function isTenantScopeDeclared(
  scope: ApiKeyTenantScope | null | undefined,
): scope is ApiKeyTenantScope & { mode: ApiKeyScopeMode } {
  return scope?.mode === "global" || scope?.mode === "factory";
}

// ── Điều kiện SQL trên `product_inspections` ─────────────────────────────────

/**
 * Vị từ FALSE TƯỜNG MINH. Xem docblock `DENY_ALL_ROWS` ở `_core/accessControl.ts`:
 * `or()` rỗng trả `undefined` (KHÔNG phải FALSE) và mọi nơi gọi viết
 * `if (filter) conditions.push(filter)` ⇒ `undefined` = KHÔNG lọc = thấy TẤT CẢ.
 */
/**
 * ⚠ DỰNG LƯỜI (trong hàm), KHÔNG phải hằng ở tầng module. `apiKeyScope.ts` được `auth.ts` nạp,
 * mà `auth.ts` lại được năm lưới của `server/api/v1/**` nạp — và các lưới ấy `vi.mock("drizzle-orm")`
 * chỉ trả về `eq`/`and`. Một lời gọi `sql\`…\`` ở tầng module sẽ chạy NGAY LÚC NẠP và làm HỎNG
 * KHÂU NẠP của cả năm file (đo được: 5 file ĐỎ, 0 ca chạy) vì một lý do chẳng liên quan gì tới
 * chúng. Gọi trong hàm ⇒ chỉ chạy ở nơi thật sự cần điều kiện SQL.
 */
function denyAllRows(): SQL {
  return sql`1 = 0`;
}

/**
 * Điều kiện thu hẹp về tenant của khoá, trên các cột của **`product_inspections`**.
 *
 * `undefined` = KHÔNG lọc, và **chỉ** trạng thái `'global'` được trả về nó. Mọi
 * đường còn lại — chưa khai, mode lạ, `'factory'` rỗng mã — trả `DENY_ALL_ROWS`.
 * Tức: quên gọi middleware `requireDeclaredTenantScope` vẫn ra 0 hàng chứ không
 * ra 22.996 hàng. Hai lớp, cùng một chiều.
 *
 * ⚠ `corporateCode` + `factoryCode` nối bằng **AND**, không phải OR — khác hẳn
 * đường NGƯỜI DÙNG (`getAccessFilterConditions` dùng OR vì các gán là quyền CỘNG
 * DỒN). Một khoá API đại diện MỘT nhà máy: hai mã cùng khai là mô tả CÙNG MỘT chỗ,
 * nên AND là phép thu hẹp đúng. Nếu dùng OR thì một khoá khai
 * `corporateCode='SIM' + factoryCode='SIM-FAC'` sẽ thấy được MỌI nhà máy của SIM —
 * tức lời khai chi tiết hơn lại NỚI quyền ra. Khai một mình `corporateCode` = khoá
 * cấp tập đoàn (một nấc trung gian hợp lệ, vẫn không phải toàn cục).
 */
export function inspectionTenantFilter(scope: ApiKeyTenantScope | null | undefined): SQL | undefined {
  if (scope?.mode === "global") return undefined;
  if (scope?.mode !== "factory") return denyAllRows();
  // ★ 2026-08-18 — phép AND-hai-mã sống ở `_core/tenantCodeScope` vì tầng CSDL
  // (`db/reportAggregators`, `db/statistics`) nay dùng CHÍNH nó cho các bộ tổng hợp. Chép
  // tay lần thứ hai ở đây là cách hai bên lệch nhau trong im lặng mà không lưới nào đỏ.
  return tenantCodeInspectionFilter(scope);
}

/**
 * ★★★ 2026-08-18 — MÃ TENANT của khoá, cho các bề mặt nhận **trục phạm vi tường minh** thay vì
 * một đối tượng `SQL` (`db/reportAggregators.ReportRollupFilters.tenantScope`,
 * `db/statistics.getShiftReport`).
 *
 * `undefined` = KHÔNG thu hẹp, và **chỉ** `'global'` được trả về nó. Khoá chưa khai / mode lạ
 * trả về một lời khai RỖNG (`{}`) — mà `tenantCodeInspectionFilter` đọc thành `1 = 0`, KHÔNG
 * phải "không lọc". Hai lớp, cùng một chiều: quên gọi `requireDeclaredTenantScope` vẫn ra 0
 * hàng chứ không ra 22.996 hàng.
 *
 * ⚠ Trả về **chỉ hai ô CHUỖI** — cố ý không phải `SQL`. Đối tượng SQL của drizzle mang tham
 * chiếu vòng (`PgTable → PgSerial → table`); một ô như thế đi lang thang qua các tầng là cách
 * nó lọt vào `res.json` rồi giết superjson (`Converting circular structure to JSON`).
 */
export function tenantCodeScopeOf(
  scope: ApiKeyTenantScope | null | undefined,
): TenantCodeScope | undefined {
  if (scope?.mode === "global") return undefined;
  if (scope?.mode !== "factory") return {};
  return { corporateCode: scope.corporateCode, factoryCode: scope.factoryCode };
}

// ── Câu từ chối (vi/en/zh) ───────────────────────────────────────────────────

export const TENANT_SCOPE_UNDECLARED_CODE = "tenant_scope_undeclared";

/**
 * ⚠ Câu này cố ý KHÔNG chứa cụm "không có dữ liệu" / "no data" / "没有数据" — kể
 * cả trong vế phủ định. Một khoá bị từ chối vì CHƯA ĐƯỢC KHAI PHẠM VI không giống
 * một truy vấn trả 0 dòng: nói "không có dữ liệu" dạy người tích hợp rằng hệ thống
 * hỏng, và họ sẽ đi tìm lỗi ở đúng chỗ không có lỗi. Cùng lý lẽ với
 * `NO_FACTORY_ASSIGNMENT_MESSAGE` (`_core/accessControlLabels.ts`).
 */
export const TENANT_SCOPE_UNDECLARED_MESSAGE = {
  vi:
    "Khoá API này chưa được gán phạm vi nhà máy. Quản trị viên phải khai phạm vi cho khoá " +
    "(một nhà máy cụ thể, hoặc toàn cục TƯỜNG MINH) tại Quản lý khoá API trước khi khoá đọc " +
    "được số liệu.",
  en:
    "This API key has no factory scope assigned. An administrator must declare the key's scope " +
    "(a specific factory, or EXPLICIT global) in API Key management before the key can read " +
    "any figures.",
  zh:
    "此 API 密钥尚未分配工厂范围。管理员必须先在 API 密钥管理中为该密钥声明范围" +
    "（指定某一工厂，或显式声明为全局），密钥才能读取数据指标。",
} as const;

/** Chi tiết máy-đọc-được đi kèm 403 (client tích hợp tự sửa được, không phải đoán). */
export function tenantScopeUndeclaredDetails() {
  return {
    reason: TENANT_SCOPE_UNDECLARED_CODE,
    message_vi: TENANT_SCOPE_UNDECLARED_MESSAGE.vi,
    message_en: TENANT_SCOPE_UNDECLARED_MESSAGE.en,
    message_zh: TENANT_SCOPE_UNDECLARED_MESSAGE.zh,
    declarableModes: [...API_KEY_SCOPE_MODES],
    remedy: "apiKey.update { dataScopeMode: 'factory', factoryCode: '<factories.code>' } | { dataScopeMode: 'global' }",
  };
}

// ── Nhãn đi ra ngoài (BA ô, không bao giờ có `filter`) ───────────────────────

/**
 * Ba ô nhãn cho đáp ứng. Đi qua `scopeLabelsOf` của `_core/accessControlLabels`
 * để "quên bỏ `filter`" là thứ **không diễn đạt được**, thay vì một quy ước phải nhớ.
 */
export function tenantScopeLabels(scope: ApiKeyTenantScope | null | undefined): ScopeLabels {
  return scopeLabelsOf({
    scopeApplied: inspectionTenantFilter(scope) !== undefined,
    scopeEmptyReason: null,
    scopeMessage: null,
  });
}

/** Mô tả phạm vi (an toàn để trả ra — chỉ chuỗi/null, không có đối tượng SQL). */
export function tenantScopeDescriptor(scope: ApiKeyTenantScope | null | undefined) {
  return {
    mode: scope?.mode ?? null,
    corporateCode: scope?.corporateCode ?? null,
    factoryCode: scope?.factoryCode ?? null,
  };
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * Chạy SAU `requireScope(...)`: principal đã có, giờ hỏi *"khoá này THẤY ĐƯỢC GÌ"*.
 * Chưa khai ⇒ 403 (không phải 200-rỗng, không phải 500).
 */
export function requireDeclaredTenantScope() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scope = req.apiPrincipal?.tenantScope;
    if (!isTenantScopeDeclared(scope)) {
      sendError(
        res,
        403,
        TENANT_SCOPE_UNDECLARED_CODE,
        TENANT_SCOPE_UNDECLARED_MESSAGE.vi,
        tenantScopeUndeclaredDetails(),
      );
      return;
    }
    next();
  };
}

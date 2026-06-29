/**
 * AI Local Tools — Phase P2 (groups B & C) READ tools.
 *
 * Continues readToolsP2.ts (group A). Doc 11 (AI Assistant Knowledge
 * Remediation) listed the next batch of high-value READ tools so the assistant
 * can answer live questions over product/BOM, RCA history, and (META-ONLY, for
 * admins) user/api-key/audit/machine-health domains.
 *
 *   GROUP B
 *   1. list_products      → product_models (+ bom_definitions/bom_line_items)
 *                           RBAC settings_products
 *   2. get_rca_history    → root_cause_analysis   RBAC analytics_root_cause
 *   3. list_users_by_role → users (+ user_factory_assignments) META-ONLY
 *                           RBAC admin_users  (SENSITIVE — never leaks secrets)
 *   GROUP C
 *   4. list_api_keys      → api_keys  META-ONLY  RBAC admin_system
 *                           (SENSITIVE — name/prefix/scopes only; NEVER hash/key)
 *   5. get_change_history → audit_logs            RBAC admin_system
 *   6. get_machine_health → machine_health_history (+ predictive_alerts)
 *                           RBAC machine_monitoring
 *
 * Design — mirrors readToolsP2.ts EXACTLY:
 *   - `kind: 'read'` with a declared `requiredPermission` ALSO enforced in the
 *     handler via the shared `rbacGate` (fail-safe: missing/invalid `__authCtx`
 *     OR denied → no-data "denied" result; never throws, never leaks).
 *   - SELECT-only Drizzle ORM (parameterized). No INSERT/UPDATE/DELETE.
 *   - `getDb()` guard → noDbResult. Vietnamese `textSummary`.
 *   - Each tool's `data` carries a render-friendly `rows: Array<{label,value}>`
 *     so the FE AIToolResultCard generic fallback renders it without a bespoke
 *     card.
 *
 * SECRET REDACTION (SENSITIVE tools): the SELECT projection NEVER lists a
 * secret column. `users` → only id/name/role/isActive/lastSignedIn (NEVER
 * passwordHash/twoFactorSecret/email/openId). `api_keys` → only
 * name/keyPrefix/scopes/isActive/expiresAt/lastUsedAt/createdAt (NEVER
 * keyHash). Because the secret columns are not in the projection, they can
 * never reach the result `data` even by accident.
 *
 * Self-registers on import (see index.ts → `import "./readToolsP2bc"`).
 *
 * Schema adaptations vs the doc-11 spec (noted, no invented columns):
 *   - product_models has no `active` column → `isActive` used (mapped to
 *     `active`); BOM `productCode` filter resolves the model, then its newest
 *     active BOM definition's line items.
 *   - root_cause_analysis has no `problem`/`rootCause`/`action`/`defectType`
 *     columns → derived from `analysisType` (problem), `aiInsights.summary` +
 *     top `rootCauses[]` (root cause), `aiInsights.recommendations[]` (action);
 *     `defectType` filter matches `analysisType`/machineCode text.
 *   - users role lives on `users.role` (user_roles is a TEMPLATE table, not a
 *     per-user join); `lastLogin` → `lastSignedIn`; factoryCode via
 *     user_factory_assignments.
 *   - api_keys has no `revoked`/`last4` columns → `revoked = !isActive`,
 *     prefix only (keyPrefix).
 */

import { z } from "zod";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  productModels,
  bomDefinitions,
  bomLineItems,
  rootCauseAnalysis,
  users,
  userFactoryAssignments,
  apiKeys,
  auditLogs,
  machineHealthHistory,
  predictiveAlerts,
} from "../../../drizzle/schema";
import { checkPermission } from "../../_core/accessControl";
import { registerTool, type Tool, type ToolResult, type ToolLang, type ToolResultType } from "./toolRegistry";

// ─── shared helpers (same shape as readToolsP2.ts) ───────────────────────────

type Lang = ToolLang;

/** A render-friendly row the FE generic fallback can show as label: value. */
interface RenderRow {
  label: string;
  value: string;
}

const authCtxSchema = z
  .object({
    userId: z.number().int().positive(),
    role: z.string().min(1),
  })
  .strict();
type AuthCtx = z.infer<typeof authCtxSchema>;

function langOf(params: { lang?: unknown }): Lang {
  const l = params.lang;
  return l === "en" || l === "zh" ? l : "vi";
}

function noDbResult<T>(type: ToolResultType, title: string, fallback: T): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: "Không có kết nối CSDL — không thể truy vấn dữ liệu thời gian thực.",
    note: "DB_UNAVAILABLE",
  };
}

const DENY_MSG: Record<Lang, (mod: string) => string> = {
  vi: (m) => `Bạn không có quyền xem dữ liệu "${m}". Vui lòng liên hệ quản trị viên.`,
  en: (m) => `You do not have permission to view "${m}". Please contact an administrator.`,
  zh: (m) => `您无权查看 "${m}" 数据。请联系管理员。`,
};

function deniedResult<T>(type: ToolResultType, title: string, fallback: T, module: string, lang: Lang): ToolResult<T> {
  return {
    type,
    title,
    data: fallback,
    textSummary: DENY_MSG[lang](module),
    note: "PERMISSION_DENIED",
  };
}

/**
 * RBAC gate shared by every P2bc read tool. Returns null when ALLOWED; otherwise
 * a no-data "denied" ToolResult the handler returns as-is. FAIL-SAFE: a
 * missing/invalid `__authCtx` → DENY (never leaks data).
 */
async function rbacGate<T>(
  rawAuthCtx: unknown,
  module: string,
  type: ToolResultType,
  title: string,
  fallback: T,
  lang: Lang,
): Promise<ToolResult<T> | null> {
  const parsed = authCtxSchema.safeParse(rawAuthCtx);
  if (!parsed.success) return deniedResult(type, title, fallback, module, lang);
  const auth: AuthCtx = parsed.data;
  let allowed = false;
  try {
    allowed = await checkPermission(auth.userId, auth.role, module, "canView");
  } catch {
    allowed = false; // fail-safe on any RBAC lookup error
  }
  if (!allowed) return deniedResult(type, title, fallback, module, lang);
  return null;
}

function fmtTs(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. list_products — product models (+ optional BOM for a productCode)
// ════════════════════════════════════════════════════════════════════════════

interface ProductItem {
  id: number;
  code: string;
  name: string;
  category: string | null;
  active: boolean;
}

interface BomComponentItem {
  componentCode: string;
  componentName: string | null;
  qtyPer: number | null;
  unit: string | null;
  refDesignator: string | null;
}

interface ProductListData {
  count: number;
  items: ProductItem[];
  bomProductCode: string | null;
  bomCode: string | null;
  bomComponents: BomComponentItem[];
  rows: RenderRow[];
}

const productsParams = z
  .object({
    search: z.string().min(1).max(255).optional(),
    productCode: z.string().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listProducts: Tool<z.infer<typeof productsParams>, ProductListData> = {
  name: "list_products",
  description:
    "Danh sách mẫu sản phẩm (product_models): mã, tên, nhóm, trạng thái. Tùy chọn kèm BOM (linh kiện) khi " +
    "cung cấp productCode. Lọc theo từ khóa mã/tên. READ-ONLY, RBAC settings_products.",
  parameters: productsParams,
  triggers: [
    "danh sách sản phẩm", "product model nào", "mã sản phẩm", "BOM của", "定型", "产品列表",
  ],
  kind: "read",
  requiredPermission: { module: "settings_products", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { search, productCode, limit } = params;
    const empty: ProductListData = {
      count: 0, items: [], bomProductCode: null, bomCode: null, bomComponents: [], rows: [],
    };
    const title = "Mẫu sản phẩm";
    const denied = await rbacGate<ProductListData>(
      (params as any).__authCtx, "settings_products", "product_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<ProductListData>("product_list", title, empty);

    const conds = [isNull(productModels.deletedAt)];
    if (search) {
      conds.push(sql`(${productModels.code} ilike ${`%${search}%`} or ${productModels.name} ilike ${`%${search}%`})`);
    }
    if (productCode) conds.push(eq(productModels.code, productCode));

    const modelRows = await db
      .select({
        id: productModels.id,
        code: productModels.code,
        name: productModels.name,
        category: productModels.category,
        isActive: productModels.isActive,
      })
      .from(productModels)
      .where(and(...conds))
      .orderBy(productModels.code)
      .limit(limit);

    const items: ProductItem[] = modelRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      category: r.category ?? null,
      active: !!r.isActive,
    }));

    // ── Optional BOM: resolve the productCode → model → newest active BOM def ──
    let bomComponents: BomComponentItem[] = [];
    let bomCode: string | null = null;
    if (productCode) {
      const model = items.find((m) => m.code === productCode) ?? null;
      if (model) {
        const bomDef = await db
          .select({ id: bomDefinitions.id, code: bomDefinitions.code })
          .from(bomDefinitions)
          .where(and(eq(bomDefinitions.productModelId, model.id), isNull(bomDefinitions.deletedAt)))
          .orderBy(desc(bomDefinitions.isActive), desc(bomDefinitions.version))
          .limit(1);
        if (bomDef[0]) {
          bomCode = bomDef[0].code;
          const lineRows = await db
            .select({
              componentCode: bomLineItems.componentCode,
              componentName: bomLineItems.componentName,
              qtyPer: bomLineItems.qtyPer,
              unit: bomLineItems.unit,
              refDesignator: bomLineItems.refDesignator,
            })
            .from(bomLineItems)
            .where(eq(bomLineItems.bomId, bomDef[0].id))
            .orderBy(bomLineItems.componentCode)
            .limit(50);
          bomComponents = lineRows.map((r) => ({
            componentCode: r.componentCode,
            componentName: r.componentName ?? null,
            qtyPer: num(r.qtyPer),
            unit: r.unit ?? null,
            refDesignator: r.refDesignator ?? null,
          }));
        }
      }
    }

    const renderRows: RenderRow[] = [
      ...items.map((p) => ({
        label: `${p.code}${p.category ? ` · ${p.category}` : ""}`,
        value: `${p.name}${p.active ? "" : " (ngừng)"}`,
      })),
      ...bomComponents.map((c) => ({
        label: `BOM ${productCode} · ${c.componentCode}`,
        value: `${c.componentName ?? ""} — ${c.qtyPer ?? "—"} ${c.unit ?? ""}${c.refDesignator ? ` [${c.refDesignator}]` : ""}`.trim(),
      })),
    ];
    const data: ProductListData = {
      count: items.length,
      items,
      bomProductCode: productCode ?? null,
      bomCode,
      bomComponents,
      rows: renderRows,
    };

    if (items.length === 0) {
      return {
        type: "product_list",
        title,
        data,
        textSummary: search
          ? `Không có mẫu sản phẩm nào khớp "${search}".`
          : "Không có mẫu sản phẩm nào.",
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((p, i) => `${i + 1}. ${p.code}: ${p.name}${p.category ? ` (${p.category})` : ""}${p.active ? "" : " [ngừng]"}`)
      .join("; ");
    const bomLine = productCode
      ? bomComponents.length
        ? ` BOM ${bomCode ?? productCode} (${bomComponents.length} linh kiện): ` +
          bomComponents.slice(0, 6).map((c) => `${c.componentCode}×${c.qtyPer ?? "—"}`).join(", ") + "."
        : ` Không có BOM nào cho ${productCode}.`
      : "";
    return {
      type: "product_list",
      title,
      data,
      textSummary: `${items.length} mẫu sản phẩm: ${listing}.${bomLine}`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. get_rca_history — past root-cause analyses (root_cause_analysis)
// ════════════════════════════════════════════════════════════════════════════

interface RcaItem {
  id: number;
  date: string | null;
  analysisType: string;
  machine: string | null;
  problem: string;
  rootCause: string;
  action: string;
}

interface RcaHistoryData {
  count: number;
  items: RcaItem[];
  rows: RenderRow[];
}

const rcaParams = z
  .object({
    machineCode: z.string().min(1).max(64).optional(),
    defectType: z.string().min(1).max(120).optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

type RcaInsights = {
  summary?: string;
  rootCauses?: Array<{ cause?: string; probability?: number; evidence?: string }>;
  recommendations?: Array<{ action?: string; priority?: string; expectedImpact?: string }>;
};

const getRcaHistory: Tool<z.infer<typeof rcaParams>, RcaHistoryData> = {
  name: "get_rca_history",
  description:
    "Lịch sử phân tích nguyên nhân gốc (root_cause_analysis): ngày, máy, vấn đề, nguyên nhân, hành động. " +
    "Lọc theo mã máy hoặc loại lỗi. READ-ONLY, RBAC analytics_root_cause.",
  parameters: rcaParams,
  triggers: [
    "lịch sử RCA", "phân tích nguyên nhân trước", "root cause đã làm", "nguyên nhân lỗi", "根因历史",
  ],
  kind: "read",
  requiredPermission: { module: "analytics_root_cause", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, defectType, limit } = params;
    const empty: RcaHistoryData = { count: 0, items: [], rows: [] };
    const title = "Lịch sử phân tích nguyên nhân (RCA)";
    const denied = await rbacGate<RcaHistoryData>(
      (params as any).__authCtx, "analytics_root_cause", "rca_history", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<RcaHistoryData>("rca_history", title, empty);

    const conds = [];
    if (machineCode) conds.push(eq(rootCauseAnalysis.machineCode, machineCode));
    if (defectType) {
      // No dedicated defectType column — match against analysisType / machineCode text.
      conds.push(
        sql`(${rootCauseAnalysis.analysisType}::text ilike ${`%${defectType}%`} or coalesce(${rootCauseAnalysis.machineCode}, '') ilike ${`%${defectType}%`})`,
      );
    }

    const dbRows = await db
      .select({
        id: rootCauseAnalysis.id,
        analysisType: rootCauseAnalysis.analysisType,
        machineCode: rootCauseAnalysis.machineCode,
        aiInsights: rootCauseAnalysis.aiInsights,
        topFactors: rootCauseAnalysis.topFactors,
        createdAt: rootCauseAnalysis.createdAt,
      })
      .from(rootCauseAnalysis)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(rootCauseAnalysis.createdAt))
      .limit(limit);

    const items: RcaItem[] = dbRows.map((r) => {
      const insights = (r.aiInsights ?? {}) as RcaInsights;
      const topCause = insights.rootCauses?.[0]?.cause;
      const topFactor = Array.isArray(r.topFactors) && r.topFactors[0]
        ? (r.topFactors[0] as { factor?: string }).factor
        : undefined;
      const rootCause = topCause ?? insights.summary ?? topFactor ?? "—";
      const action = insights.recommendations?.[0]?.action ?? "—";
      return {
        id: r.id,
        date: fmtTs(r.createdAt),
        analysisType: String(r.analysisType),
        machine: r.machineCode ?? null,
        problem: insights.summary ?? String(r.analysisType),
        rootCause,
        action,
      };
    });

    const renderRows: RenderRow[] = items.map((r) => ({
      label: `${r.analysisType}${r.machine ? ` · ${r.machine}` : ""} (${r.date?.slice(0, 10) ?? "—"})`,
      value: `Nguyên nhân: ${r.rootCause} → Hành động: ${r.action}`,
    }));
    const data: RcaHistoryData = { count: items.length, items, rows: renderRows };

    const scope = machineCode ? `máy ${machineCode}` : defectType ? `lỗi "${defectType}"` : "gần đây";
    if (items.length === 0) {
      return {
        type: "rca_history",
        title,
        data,
        textSummary: `Không có phân tích nguyên nhân nào (${scope}).`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 6)
      .map((r, i) => `${i + 1}. ${r.analysisType}${r.machine ? `/${r.machine}` : ""}: ${r.rootCause} → ${r.action}`)
      .join("; ");
    return {
      type: "rca_history",
      title,
      data,
      textSummary: `${items.length} phân tích nguyên nhân (${scope}): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 3. list_users_by_role — SENSITIVE, META-ONLY (users + user_factory_assignments)
//    Projection NEVER includes passwordHash/twoFactorSecret/email/openId.
// ════════════════════════════════════════════════════════════════════════════

interface UserItem {
  id: number;
  name: string | null;
  role: string;
  isActive: boolean;
  lastLogin: string | null;
}

interface UserListData {
  count: number;
  items: UserItem[];
  rows: RenderRow[];
}

const usersParams = z
  .object({
    role: z.string().min(1).max(50).optional(),
    factoryCode: z.string().min(1).max(50).optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listUsersByRole: Tool<z.infer<typeof usersParams>, UserListData> = {
  name: "list_users_by_role",
  description:
    "Danh sách người dùng (META-ONLY): id, tên, vai trò, trạng thái, lần đăng nhập cuối. KHÔNG bao giờ trả " +
    "mật khẩu/email/token. Lọc theo vai trò hoặc nhà máy. READ-ONLY, RBAC admin_users (chỉ quản trị).",
  parameters: usersParams,
  triggers: [
    "ai có vai trò", "user nào là", "danh sách người dùng", "thành viên role", "用户列表",
  ],
  kind: "read",
  requiredPermission: { module: "admin_users", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { role, factoryCode, limit } = params;
    const empty: UserListData = { count: 0, items: [], rows: [] };
    const title = "Người dùng theo vai trò";
    const denied = await rbacGate<UserListData>(
      (params as any).__authCtx, "admin_users", "user_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<UserListData>("user_list", title, empty);

    // Optional factory filter → resolve user ids first (read-only).
    let factoryUserIds: number[] | null = null;
    if (factoryCode) {
      const fa = await db
        .select({ userId: userFactoryAssignments.userId })
        .from(userFactoryAssignments)
        .where(eq(userFactoryAssignments.factoryCode, factoryCode));
      factoryUserIds = Array.from(new Set(fa.map((r) => r.userId)));
      if (factoryUserIds.length === 0) {
        return {
          type: "user_list",
          title,
          data: empty,
          textSummary: `Không có người dùng nào thuộc nhà máy "${factoryCode}".`,
          note: "NOT_FOUND",
        };
      }
    }

    const conds = [];
    if (role) conds.push(eq(users.role, role as any));
    if (factoryUserIds) conds.push(inArray(users.id, factoryUserIds));

    // META-ONLY projection — secret columns are intentionally NOT selected.
    const dbRows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(users.role, desc(users.lastSignedIn))
      .limit(limit);

    const items: UserItem[] = dbRows.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      role: String(r.role),
      isActive: !!r.isActive,
      lastLogin: fmtTs(r.lastSignedIn),
    }));

    const renderRows: RenderRow[] = items.map((u) => ({
      label: `${u.name ?? `#${u.id}`} · ${u.role}`,
      value: `${u.isActive ? "đang hoạt động" : "ngừng"} — đăng nhập cuối: ${u.lastLogin?.slice(0, 10) ?? "—"}`,
    }));
    const data: UserListData = { count: items.length, items, rows: renderRows };

    const scope = role ? `vai trò ${role}` : factoryCode ? `nhà máy ${factoryCode}` : "tất cả";
    if (items.length === 0) {
      return {
        type: "user_list",
        title,
        data,
        textSummary: `Không có người dùng nào (${scope}).`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 10)
      .map((u, i) => `${i + 1}. ${u.name ?? `#${u.id}`} (${u.role})${u.isActive ? "" : " [ngừng]"}`)
      .join("; ");
    return {
      type: "user_list",
      title,
      data,
      textSummary: `${items.length} người dùng (${scope}): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 4. list_api_keys — SENSITIVE, META-ONLY (api_keys)
//    Projection NEVER includes keyHash. Only name/prefix/scopes/flags/dates.
// ════════════════════════════════════════════════════════════════════════════

interface ApiKeyItem {
  id: number;
  name: string;
  keyPrefix: string | null;
  scopes: string[];
  revoked: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface ApiKeyListData {
  count: number;
  items: ApiKeyItem[];
  rows: RenderRow[];
}

const apiKeysParams = z
  .object({
    active: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional().default(20),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const listApiKeys: Tool<z.infer<typeof apiKeysParams>, ApiKeyListData> = {
  name: "list_api_keys",
  description:
    "Danh sách API key (META-ONLY): tên, prefix, scope, trạng thái, ngày tạo/dùng cuối/hết hạn. KHÔNG bao giờ " +
    "trả key đầy đủ hoặc hash. Lọc theo còn hiệu lực. READ-ONLY, RBAC admin_system (chỉ quản trị).",
  parameters: apiKeysParams,
  triggers: [
    "api key nào", "danh sách api key", "key sắp hết hạn", "key chưa dùng", "密钥列表",
  ],
  kind: "read",
  requiredPermission: { module: "admin_system", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { active, limit } = params;
    const empty: ApiKeyListData = { count: 0, items: [], rows: [] };
    const title = "API keys";
    const denied = await rbacGate<ApiKeyListData>(
      (params as any).__authCtx, "admin_system", "api_key_list", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<ApiKeyListData>("api_key_list", title, empty);

    const conds = [];
    if (active === true) conds.push(eq(apiKeys.isActive, true));
    if (active === false) conds.push(eq(apiKeys.isActive, false));

    // META-ONLY projection — keyHash is intentionally NOT selected.
    const dbRows = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        isActive: apiKeys.isActive,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
      })
      .from(apiKeys)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(apiKeys.createdAt))
      .limit(limit);

    const items: ApiKeyItem[] = dbRows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix ?? null,
      scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
      revoked: !r.isActive,
      createdAt: fmtTs(r.createdAt),
      lastUsedAt: fmtTs(r.lastUsedAt),
      expiresAt: fmtTs(r.expiresAt),
    }));

    const renderRows: RenderRow[] = items.map((k) => ({
      label: `${k.name}${k.keyPrefix ? ` (${k.keyPrefix}…)` : ""}${k.revoked ? " [thu hồi]" : ""}`,
      value: `scope: ${k.scopes.join(", ") || "—"} · dùng cuối: ${k.lastUsedAt?.slice(0, 10) ?? "chưa dùng"} · hết hạn: ${k.expiresAt?.slice(0, 10) ?? "không"}`,
    }));
    const data: ApiKeyListData = { count: items.length, items, rows: renderRows };

    if (items.length === 0) {
      return {
        type: "api_key_list",
        title,
        data,
        textSummary: "Không có API key nào khớp điều kiện.",
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((k, i) => `${i + 1}. ${k.name}${k.keyPrefix ? ` (${k.keyPrefix}…)` : ""}${k.revoked ? " [thu hồi]" : ""}`)
      .join("; ");
    return {
      type: "api_key_list",
      title,
      data,
      textSummary: `${items.length} API key: ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 5. get_change_history — audit "who changed what when" (audit_logs)
// ════════════════════════════════════════════════════════════════════════════

interface AuditItem {
  id: number;
  time: string | null;
  user: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  entityName: string | null;
  summary: string | null;
}

interface ChangeHistoryData {
  count: number;
  items: AuditItem[];
  rows: RenderRow[];
}

const changeHistoryParams = z
  .object({
    entityType: z.string().min(1).max(100).optional(),
    entityId: z.number().int().positive().optional(),
    userId: z.number().int().positive().optional(),
    sinceDays: z.number().int().min(1).max(365).optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

function summarizeDetails(details: string | null): string | null {
  if (!details) return null;
  const s = details.trim();
  if (!s) return null;
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

const getChangeHistory: Tool<z.infer<typeof changeHistoryParams>, ChangeHistoryData> = {
  name: "get_change_history",
  description:
    "Lịch sử thay đổi / audit (audit_logs): thời gian, người thực hiện, hành động, đối tượng, tóm tắt thay đổi. " +
    "Lọc theo loại đối tượng / id / người dùng / số ngày gần đây. READ-ONLY, RBAC admin_system (chỉ quản trị).",
  parameters: changeHistoryParams,
  triggers: [
    "ai đã đổi", "lịch sử thay đổi", "thay đổi gần đây", "audit log", "ai sửa", "谁修改了",
  ],
  kind: "read",
  requiredPermission: { module: "admin_system", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { entityType, entityId, userId, sinceDays, limit } = params;
    const empty: ChangeHistoryData = { count: 0, items: [], rows: [] };
    const title = "Lịch sử thay đổi (audit)";
    const denied = await rbacGate<ChangeHistoryData>(
      (params as any).__authCtx, "admin_system", "change_history", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<ChangeHistoryData>("change_history", title, empty);

    const conds = [];
    if (entityType) conds.push(eq(auditLogs.entityType, entityType));
    if (entityId != null) conds.push(eq(auditLogs.entityId, entityId));
    if (userId != null) conds.push(eq(auditLogs.userId, userId));
    if (sinceDays != null) {
      const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
      conds.push(gte(auditLogs.createdAt, since));
    }

    const dbRows = await db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: auditLogs.userName,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        entityName: auditLogs.entityName,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    const items: AuditItem[] = dbRows.map((r) => ({
      id: r.id,
      time: fmtTs(r.createdAt),
      user: r.userName ?? (r.userId != null ? `#${r.userId}` : null),
      action: String(r.action),
      entityType: r.entityType ?? null,
      entityId: r.entityId ?? null,
      entityName: r.entityName ?? null,
      summary: summarizeDetails(r.details),
    }));

    const renderRows: RenderRow[] = items.map((a) => ({
      label: `${a.time?.slice(0, 16).replace("T", " ") ?? "—"} · ${a.user ?? "—"}`,
      value: `${a.action} ${a.entityType ?? ""}${a.entityName ? ` "${a.entityName}"` : a.entityId != null ? ` #${a.entityId}` : ""}`.trim(),
    }));
    const data: ChangeHistoryData = { count: items.length, items, rows: renderRows };

    const scope = entityType
      ? `${entityType}${entityId != null ? ` #${entityId}` : ""}`
      : userId != null ? `người dùng #${userId}` : "gần đây";
    if (items.length === 0) {
      return {
        type: "change_history",
        title,
        data,
        textSummary: `Không có thay đổi nào (${scope}).`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((a, i) => `${i + 1}. ${a.user ?? "—"} ${a.action} ${a.entityType ?? ""}${a.entityName ? ` "${a.entityName}"` : ""}`.trim())
      .join("; ");
    return {
      type: "change_history",
      title,
      data,
      textSummary: `${items.length} thay đổi (${scope}): ${listing}.`,
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 6. get_machine_health — latest health per machine (+ active predictive risk)
//    machine_health_history + predictive_alerts.
// ════════════════════════════════════════════════════════════════════════════

interface MachineHealthItem {
  machineId: number;
  machineCode: string;
  healthScore: number | null;
  predictedFailureRisk: number | null;
  maintenanceUrgency: string | null;
  recommendedMaintenanceDate: string | null;
  measuredAt: string | null;
  activeAlertCount: number;
  topAlert: string | null;
}

interface MachineHealthData {
  count: number;
  items: MachineHealthItem[];
  rows: RenderRow[];
}

const machineHealthParams = z
  .object({
    machineCode: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).optional().default(15),
    lang: z.enum(["vi", "en", "zh"]).optional(),
    __authCtx: authCtxSchema.optional(),
  })
  .strict();

const getMachineHealth: Tool<z.infer<typeof machineHealthParams>, MachineHealthData> = {
  name: "get_machine_health",
  description:
    "Sức khỏe máy hiện tại (machine_health_history): điểm sức khỏe, rủi ro hỏng dự đoán, mức độ khẩn cấp bảo trì, " +
    "kèm cảnh báo dự đoán đang mở (predictive_alerts). Lọc theo mã máy. READ-ONLY, RBAC machine_monitoring.",
  parameters: machineHealthParams,
  triggers: [
    "sức khỏe máy", "machine health", "máy nào rủi ro", "nguy cơ hỏng", "健康状态",
  ],
  kind: "read",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  handler: async (params) => {
    const lang = langOf(params);
    const { machineCode, limit } = params;
    const empty: MachineHealthData = { count: 0, items: [], rows: [] };
    const title = "Sức khỏe máy";
    const denied = await rbacGate<MachineHealthData>(
      (params as any).__authCtx, "machine_monitoring", "machine_health", title, empty, lang,
    );
    if (denied) return denied;

    const db = await getDb();
    if (!db) return noDbResult<MachineHealthData>("machine_health", title, empty);

    // Latest health row per machine via DISTINCT ON (machineId, newest timestamp).
    const healthConds = [];
    if (machineCode) healthConds.push(eq(machineHealthHistory.machineCode, machineCode));
    const healthRows = await db
      .selectDistinctOn([machineHealthHistory.machineId], {
        machineId: machineHealthHistory.machineId,
        machineCode: machineHealthHistory.machineCode,
        healthScore: machineHealthHistory.healthScore,
        predictedFailureRisk: machineHealthHistory.predictedFailureRisk,
        maintenanceUrgency: machineHealthHistory.maintenanceUrgency,
        recommendedMaintenanceDate: machineHealthHistory.recommendedMaintenanceDate,
        timestamp: machineHealthHistory.timestamp,
      })
      .from(machineHealthHistory)
      .where(healthConds.length ? and(...healthConds) : undefined)
      .orderBy(machineHealthHistory.machineId, desc(machineHealthHistory.timestamp))
      .limit(limit);

    // Active predictive alerts for the same machines (risk overlay).
    const alertConds = [eq(predictiveAlerts.status, "ACTIVE")];
    if (machineCode) alertConds.push(eq(predictiveAlerts.machineCode, machineCode));
    const alertRows = await db
      .select({
        machineId: predictiveAlerts.machineId,
        machineCode: predictiveAlerts.machineCode,
        title: predictiveAlerts.title,
        severity: predictiveAlerts.severity,
        createdAt: predictiveAlerts.createdAt,
      })
      .from(predictiveAlerts)
      .where(and(...alertConds))
      .orderBy(desc(predictiveAlerts.createdAt))
      .limit(100);

    const alertsByMachine = new Map<string, { count: number; top: string | null }>();
    for (const a of alertRows) {
      const key = a.machineCode ?? (a.machineId != null ? `#${a.machineId}` : "");
      if (!key) continue;
      const cur = alertsByMachine.get(key) ?? { count: 0, top: null };
      cur.count += 1;
      if (cur.top == null) cur.top = `${a.title} (${String(a.severity)})`;
      alertsByMachine.set(key, cur);
    }

    const items: MachineHealthItem[] = healthRows.map((r) => {
      const key = r.machineCode ?? `#${r.machineId}`;
      const alerts = alertsByMachine.get(key) ?? alertsByMachine.get(`#${r.machineId}`) ?? { count: 0, top: null };
      return {
        machineId: r.machineId,
        machineCode: r.machineCode,
        healthScore: num(r.healthScore),
        predictedFailureRisk: num(r.predictedFailureRisk),
        maintenanceUrgency: r.maintenanceUrgency == null ? null : String(r.maintenanceUrgency),
        recommendedMaintenanceDate: fmtTs(r.recommendedMaintenanceDate),
        measuredAt: fmtTs(r.timestamp),
        activeAlertCount: alerts.count,
        topAlert: alerts.top,
      };
    });
    // Worst health (lowest score) first.
    items.sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101));

    const renderRows: RenderRow[] = items.map((m) => ({
      label: `${m.machineCode} · sức khỏe ${m.healthScore ?? "—"}/100`,
      value: `rủi ro hỏng ${m.predictedFailureRisk ?? "—"}%${m.maintenanceUrgency ? ` (${m.maintenanceUrgency})` : ""}` +
        `${m.activeAlertCount ? ` · ${m.activeAlertCount} cảnh báo${m.topAlert ? `: ${m.topAlert}` : ""}` : ""}`,
    }));
    const data: MachineHealthData = { count: items.length, items, rows: renderRows };

    const scope = machineCode ? `máy ${machineCode}` : "tất cả máy";
    if (items.length === 0) {
      return {
        type: "machine_health",
        title,
        data,
        textSummary: `Không có dữ liệu sức khỏe cho ${scope}.`,
        note: "NOT_FOUND",
      };
    }
    const listing = items
      .slice(0, 8)
      .map((m, i) => `${i + 1}. ${m.machineCode}: sức khỏe ${m.healthScore ?? "—"}/100, rủi ro ${m.predictedFailureRisk ?? "—"}%${m.activeAlertCount ? `, ${m.activeAlertCount} cảnh báo` : ""}`)
      .join("; ");
    return {
      type: "machine_health",
      title,
      data,
      textSummary: `Sức khỏe ${items.length} máy (${scope}): ${listing}.`,
    };
  },
};

// ─── register ────────────────────────────────────────────────────────────────

let _registeredP2bc = false;
export function registerP2bcReadTools(): void {
  if (_registeredP2bc) return;
  _registeredP2bc = true;
  registerTool(listProducts);
  registerTool(getRcaHistory);
  registerTool(listUsersByRole);
  registerTool(listApiKeys);
  registerTool(getChangeHistory);
  registerTool(getMachineHealth);
}

registerP2bcReadTools();

export { listProducts, getRcaHistory, listUsersByRole, listApiKeys, getChangeHistory, getMachineHealth };

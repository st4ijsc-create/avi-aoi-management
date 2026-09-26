/**
 * ★★ QUYẾT ĐỊNH RBAC CỦA CHỦ DỰ ÁN — 2026-08-17: **MỞ bit `analytics_category` (canView) cho
 * `supervisor` và `quality_inspector`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tool trợ lý `get_model_metrics` (xếp hạng model sản phẩm theo tỉ lệ NG) đứng sau
 * `analytics_category/canView` — bit của `/category-analytics`, màn DUY NHẤT thật sự chia
 * OK/NG/yield theo sản phẩm (xem chú thích ở `server/services/aiLocalTools/handlers.ts`).
 * Trước quyết định này **chỉ `admin`** được seed bit ấy ⇒ `supervisor` và `quality_inspector`
 * hỏi trợ lý "model nào NG nhiều nhất?" thì bị TỪ CHỐI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI CƠ CHẾ, PHẢI CANH CẢ HAI — ĐÂY LÀ LỚP LỖI ĐÃ CÓ THẬT TRONG REPO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. `DEFAULT_ROLE_PERMISSIONS` (permissionsRouter.ts) — cấp cho người dùng **SẼ được seed**.
 *   2. `drizzle/0322_grant_analytics_category_supervisor_quality.sql` — backfill cho người dùng
 *      **ĐÃ tồn tại** (họ không có hàng ⇒ `checkPermission` trả false vĩnh viễn).
 *
 * Sửa đúng MỘT trong hai là lỗi kinh điển của khuôn này (chính vì thế 0269 và 0277 tồn tại).
 * §2 dưới đây đọc **file migration thật** và bắt nó phải nói cùng một câu với ma trận — hai cơ
 * chế không thể trôi khỏi nhau trong im lặng.
 *
 * ⚠ PHẠM VI GRANT: `canView` **và chỉ canView** (mọi bit khác false), đúng khuôn 0277
 * (`mqtt_monitoring` view-only). Quyết định mở là để **trợ lý trả lời được**, không phải để
 * cấp thêm quyền tạo/sửa/xoá/xuất.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { permissionsRouter } from "./permissionsRouter";

const adminCtx = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

/** Vai được chốt mở ngày 2026-08-17 (+ admin đã có sẵn từ trước). */
const VAI_DUOC_MO = ["supervisor", "quality_inspector"] as const;
/** Vai KHÔNG nằm trong quyết định — phải giữ nguyên trạng thái "không có hàng". */
const VAI_KHONG_MO = ["operator", "maintenance", "engineer", "viewer", "user"] as const;

const MIGRATION = path.join(
  __dirname, "..", "..", "drizzle", "0322_grant_analytics_category_supervisor_quality.sql",
);

async function bit(role: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === "analytics_category");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ QĐ 2026-08-17 §1 — MA TRẬN SEED (người dùng mới)", () => {
  it("★★ supervisor + quality_inspector có `analytics_category` canView (và CHỈ canView)", async () => {
    for (const role of VAI_DUOC_MO) {
      const p = await bit(role);
      expect(p, `vai "${role}" thiếu hàng analytics_category trong DEFAULT_ROLE_PERMISSIONS`).toBeDefined();
      expect(p, `vai "${role}"`).toMatchObject({
        category: "analytics",
        moduleName: "analytics_category",
        canView: true,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canExport: false,
      });
    }
  });

  it("admin vẫn giữ nguyên hàng cũ (quyết định KHÔNG đụng tới admin)", async () => {
    expect(await bit("admin")).toMatchObject({ canView: true, canExport: true });
  });

  it("★★ CHỈ hai vai ấy — quyết định KHÔNG mở cho phần còn lại", async () => {
    for (const role of VAI_KHONG_MO) {
      expect(await bit(role), `vai "${role}" KHÔNG nằm trong quyết định 2026-08-17`).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ QĐ 2026-08-17 §2 — MIGRATION BACKFILL (người dùng ĐÃ tồn tại) khớp ma trận", () => {
  it("★★ file migration 0322 tồn tại", () => {
    expect(fs.existsSync(MIGRATION), `thiếu ${MIGRATION}`).toBe(true);
  });

  it("★★★ migration nhắm ĐÚNG hai vai, ĐÚNG module, canView-only, và IDEMPOTENT", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const chuan = sql.toLowerCase();

    expect(chuan, "migration phải INSERT vào bảng `permissions`").toContain("insert into permissions");
    expect(chuan, "migration phải cấp đúng module `analytics_category`").toContain("'analytics_category'");
    // Hai vai của quyết định — và KHÔNG vai nào khác.
    for (const role of VAI_DUOC_MO) expect(chuan, `migration bỏ sót vai "${role}"`).toContain(`'${role}'`);
    for (const role of VAI_KHONG_MO) {
      expect(chuan.includes(`'${role}'`), `migration cấp cho "${role}" — NGOÀI quyết định 2026-08-17`).toBe(false);
    }
    // Chạy lại không được đẻ hàng trùng (khuôn 0269/0277).
    expect(chuan, "migration phải idempotent — thiếu `NOT EXISTS`").toContain("not exists");
  });

  it("★★ migration KHÔNG cấp bit ghi/xuất (chỉ canView)", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    // Dòng SELECT của khuôn này là: <role list>, 'analytics_category', true, false, false, false, false
    const values = /'analytics_category'\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)\s*,\s*(true|false)/i.exec(sql);
    expect(values, "không đọc được bộ 5 bit sau 'analytics_category' — khuôn migration đã đổi?").toBeTruthy();
    const [, canView, canCreate, canEdit, canDelete, canExport] = values!;
    expect(canView.toLowerCase(), "canView phải true").toBe("true");
    expect(
      [canCreate, canEdit, canDelete, canExport].map((s) => s.toLowerCase()).join(","),
      "quyết định là VIEW-ONLY — bit ghi/xuất phải false",
    ).toBe("false,false,false,false");
  });
});

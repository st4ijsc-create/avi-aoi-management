/**
 * ★★ QUYẾT ĐỊNH RBAC CỦA CHỦ DỰ ÁN — 2026-08-17: **MỞ bit `analytics_defect_heatmap` (canView)
 * cho `operator`, `maintenance`, `engineer`.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO — VÀ VÌ SAO KHÔNG ĐI ĐƯỜNG KIA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đường bị BÁC BỎ: hạ bit của tool `analytics_defect_heatmap_summary` xuống `dashboard_view`.
 * Nó đẻ ra HAI cửa vào cùng một lớp dữ liệu với hai mức gác khác nhau — đúng lớp cửa-hậu mà §10
 * của `services/aiLocalTools/toolPermissionQuantifier.test.ts` dựng ra để chống; và §10b đã ĐO
 * rằng hai tool KHÔNG cùng tập (cửa sổ 1..90 vs 1..30 ngày, topN 30 vs 20, thêm lát cắt
 * machineId + productModelId).
 * ⇒ Đường đã chọn: cấp bit cho đúng vai, giữ trợ lý và giao diện đứng sau CÙNG MỘT luật.
 *
 * ⚠⚠ Bản vá này **KHÔNG đổi bit của tool nào**. §10b phải vẫn XANH NGUYÊN. Nếu §10b đỏ thì ai đó
 * đã quay lại đường đã bị bác bỏ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BA CƠ CHẾ, PHẢI CANH CẢ BA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. `DEFAULT_ROLE_PERMISSIONS` (permissionsRouter.ts) — người dùng **SẼ được seed**.   → §1
 *   2. `drizzle/0323_…sql` — backfill cho người dùng **ĐÃ tồn tại** (không có hàng ⇒
 *      `checkPermission` false vĩnh viễn).                                                → §2
 *   3. **BỀ MẶT** mà bit này mở ra — nếu ngày mai ai đó gắn bit này cho màn thứ hai thì lời khai
 *      "cấp bit = mở đúng một màn" đã âm thầm sai.                                        → §3
 *
 * Sửa đúng một trong ba là lỗi kinh điển của khuôn này (chính vì thế 0269 / 0277 / 0322 tồn tại).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { permissionsRouter } from "./permissionsRouter";

const adminCtx = { user: { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true } } as any;
const caller = permissionsRouter.createCaller(adminCtx);

const MODULE = "analytics_defect_heatmap";

/** Ba vai được chốt mở ngày 2026-08-17. */
const VAI_DUOC_MO = ["operator", "maintenance", "engineer"] as const;
/**
 * Ba vai ĐÃ CÓ bit này từ TRƯỚC quyết định (với canExport=true). Quyết định KHÔNG đụng tới họ —
 * migration cũng không được nhắc tên họ (nhắc = mở rộng phạm vi ngoài thứ đã duyệt; và `NOT
 * EXISTS` sẽ khiến dòng ấy vừa vô nghĩa vừa gây hiểu nhầm).
 */
const VAI_DA_CO_TU_TRUOC = ["admin", "supervisor", "quality_inspector"] as const;
/** Vai NGOÀI quyết định và cũng chưa từng có bit — phải giữ nguyên trạng "không có hàng". */
const VAI_KHONG_MO = ["viewer", "user"] as const;

const ROOT = path.join(__dirname, "..", "..");
const MIGRATION = path.join(ROOT, "drizzle", "0323_grant_analytics_defect_heatmap_ops_roles.sql");
const NAVIGATION = path.join(ROOT, "client", "src", "lib", "navigation.tsx");
const APP_TSX = path.join(ROOT, "client", "src", "App.tsx");

async function bit(role: string) {
  const perms = await caller.getDefaultPermissionsForRole({ role: role as any });
  return perms.find((p: any) => p.moduleName === MODULE);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ QĐ 2026-08-17 §1 — MA TRẬN SEED (người dùng mới)", () => {
  it("★★★ operator + maintenance + engineer có `analytics_defect_heatmap` canView (và CHỈ canView)", async () => {
    for (const role of VAI_DUOC_MO) {
      const p = await bit(role);
      expect(p, `vai "${role}" thiếu hàng ${MODULE} trong DEFAULT_ROLE_PERMISSIONS`).toBeDefined();
      expect(p, `vai "${role}"`).toMatchObject({
        category: "analytics",
        moduleName: MODULE,
        canView: true,
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canExport: false,
      });
    }
  });

  it("★★ ba vai đã có bit từ trước GIỮ NGUYÊN (quyết định không hạ, không nâng)", async () => {
    for (const role of VAI_DA_CO_TU_TRUOC) {
      expect(await bit(role), `vai "${role}"`).toMatchObject({
        canView: true,
        canExport: true,
        canCreate: false,
        canEdit: false,
        canDelete: false,
      });
    }
  });

  it("★★ CHỈ ba vai ấy — quyết định KHÔNG mở cho phần còn lại", async () => {
    for (const role of VAI_KHONG_MO) {
      expect(await bit(role), `vai "${role}" KHÔNG nằm trong quyết định 2026-08-17`).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★ QĐ 2026-08-17 §2 — MIGRATION BACKFILL (người dùng ĐÃ tồn tại) khớp ma trận", () => {
  it("★★ file migration 0323 tồn tại", () => {
    expect(fs.existsSync(MIGRATION), `thiếu ${MIGRATION}`).toBe(true);
  });

  it("★★★ migration nhắm ĐÚNG ba vai, ĐÚNG module, và IDEMPOTENT", () => {
    const chuan = fs.readFileSync(MIGRATION, "utf8").toLowerCase();

    expect(chuan, "migration phải INSERT vào bảng `permissions`").toContain("insert into permissions");
    expect(chuan, `migration phải cấp đúng module \`${MODULE}\``).toContain(`'${MODULE}'`);
    // Ba vai của quyết định — và KHÔNG vai nào khác (kể cả vai đã có bit từ trước).
    for (const role of VAI_DUOC_MO) {
      expect(chuan, `migration bỏ sót vai "${role}"`).toContain(`'${role}'`);
    }
    for (const role of [...VAI_DA_CO_TU_TRUOC, ...VAI_KHONG_MO]) {
      expect(
        chuan.includes(`'${role}'`),
        `migration nhắc vai "${role}" — NGOÀI quyết định 2026-08-17`,
      ).toBe(false);
    }
    // Chạy lại không được đẻ hàng trùng (khuôn 0269/0277/0322).
    expect(chuan, "migration phải idempotent — thiếu `NOT EXISTS`").toContain("not exists");
    // …và mệnh đề NOT EXISTS phải soi ĐÚNG module này, không phải một module khác chép nhầm.
    expect(
      /not exists\s*\([^)]*'analytics_defect_heatmap'/is.test(chuan),
      "mệnh đề NOT EXISTS không soi `analytics_defect_heatmap` ⇒ chạy lần hai sẽ đẻ hàng trùng",
    ).toBe(true);
  });

  it("★★★ migration KHÔNG cấp bit ghi/xuất (chỉ canView)", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    // Dòng SELECT của khuôn này là: 'analytics_defect_heatmap', true, false, false, false, false
    const values = new RegExp(
      `'${MODULE}'\\s*,\\s*(true|false)\\s*,\\s*(true|false)\\s*,\\s*(true|false)\\s*,\\s*(true|false)\\s*,\\s*(true|false)`,
      "i",
    ).exec(sql);
    expect(values, `không đọc được bộ 5 bit sau '${MODULE}' — khuôn migration đã đổi?`).toBeTruthy();
    const [, canView, canCreate, canEdit, canDelete, canExport] = values!;
    expect(canView.toLowerCase(), "canView phải true").toBe("true");
    expect(
      [canCreate, canEdit, canDelete, canExport].map((s) => s.toLowerCase()).join(","),
      "quyết định là VIEW-ONLY — bit ghi/xuất phải false",
    ).toBe("false,false,false,false");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * §3 — BỀ MẶT ĐÃ ĐO. Lời khai đi kèm quyết định là: *"cấp bit này mở thêm ĐÚNG MỘT màn —
 * `/defect-heatmap`."* Lời khai ấy đúng **tại thời điểm đo**. Nếu ngày mai ai đó gắn cùng bit cho
 * màn thứ hai (hoặc gỡ nó khỏi màn này), quyết định đã duyệt sẽ âm thầm mang nghĩa khác — không
 * ai phải cố ý làm sai, chỉ cần không ai nhớ. Ba `it` dưới đây biến lời khai thành thứ ĐO ĐƯỢC.
 */
describe("★★★ QĐ 2026-08-17 §3 — BỀ MẶT: bit này mở ĐÚNG MỘT màn, và đó là cổng ROUTE thật", () => {
  it("★★ menu: `/defect-heatmap` đứng sau đúng bit này", () => {
    const nav = fs.readFileSync(NAVIGATION, "utf8");
    expect(
      /href:\s*"\/defect-heatmap"[\s\S]{0,400}?requiredPermission:\s*"analytics_defect_heatmap"/.test(nav),
      "mục menu `/defect-heatmap` không còn đứng sau `analytics_defect_heatmap`",
    ).toBe(true);
  });

  it("★★★ KHÔNG màn nào khác dùng bit này — mở bit = mở đúng một bề mặt", () => {
    const nav = fs.readFileSync(NAVIGATION, "utf8");
    const soLan = (nav.match(/requiredPermission:\s*"analytics_defect_heatmap"/g) ?? []).length;
    expect(
      soLan,
      "số mục menu dùng `analytics_defect_heatmap` đã đổi. Quyết định 2026-08-17 được duyệt trên " +
        "phép đo 'đúng MỘT màn'. Thêm màn thứ hai = mở rộng phạm vi ngoài thứ chủ dự án đã duyệt.",
    ).toBe(1);
  });

  it("★★★ App.tsx: `/defect-heatmap` có RouteGuard THẬT (không chỉ ẩn/hiện menu)", () => {
    const app = fs.readFileSync(APP_TSX, "utf8");
    expect(
      /path="\/defect-heatmap"\s*>\s*<RouteGuard\s+navHref="\/defect-heatmap"/.test(app),
      "route `/defect-heatmap` không còn bọc RouteGuard ⇒ deep-link đi vòng qua cổng quyền",
    ).toBe(true);
  });
});

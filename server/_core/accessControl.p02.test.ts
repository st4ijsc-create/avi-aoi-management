/**
 * ★ Pha 0 P0-2 (2026-11-04) — admin HẾT bypass `checkPermission` MẶC ĐỊNH (RBAC_SCOPED_ADMIN vắng ⇒ bật); `=false` = công tắc khẩn.
 * Ngữ nghĩa giữ nguyên chế độ hạn quyền: hàng quyền có hành động FALSE ⇒ admin bị chặn đúng hành động ấy; không hàng / hết hạn ⇒ admin
 * vẫn qua (không khoá admin khỏi module chưa cấu hình); người không phải admin không đổi.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const hang = vi.hoisted(() => ({ ds: [] as unknown[] }));
vi.mock("../db/connection", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => hang.ds }) }) }),
  }),
}));

import { checkPermission } from "./accessControl";

const giu = process.env.RBAC_SCOPED_ADMIN;
afterEach(() => {
  if (giu === undefined) delete process.env.RBAC_SCOPED_ADMIN;
  else process.env.RBAC_SCOPED_ADMIN = giu;
  hang.ds = [];
});
const quyen = (o: Record<string, boolean>) => [{ canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false, expiresAt: null, ...o }];

describe("P0-2 — admin hạn quyền mặc định", () => {
  it("★★★ vắng cờ: hàng có canDelete=false ⇒ admin BỊ CHẶN canDelete, vẫn qua canView=true", async () => {
    delete process.env.RBAC_SCOPED_ADMIN;
    hang.ds = quyen({ canView: true });
    expect(await checkPermission(1, "admin", "machine_status", "canDelete")).toBe(false);
    expect(await checkPermission(1, "admin", "machine_status", "canView")).toBe(true);
  });
  it("★★★ không hàng / hàng hết hạn ⇒ admin vẫn qua (không nhà tù)", async () => {
    delete process.env.RBAC_SCOPED_ADMIN;
    hang.ds = [];
    expect(await checkPermission(1, "admin", "ai_repo_read", "canView")).toBe(true);
    hang.ds = quyen({ expiresAt: new Date(Date.now() - 1000) } as never);
    expect(await checkPermission(1, "admin", "ai_repo_read", "canView")).toBe(true);
  });
  it("★★ RBAC_SCOPED_ADMIN=false ⇒ god-mode cũ (công tắc khẩn); người không phải admin không đổi", async () => {
    process.env.RBAC_SCOPED_ADMIN = "false";
    hang.ds = quyen({});
    expect(await checkPermission(1, "admin", "machine_status", "canDelete")).toBe(true);
    delete process.env.RBAC_SCOPED_ADMIN;
    expect(await checkPermission(2, "engineer", "machine_status", "canView")).toBe(false);
    hang.ds = [];
    expect(await checkPermission(2, "engineer", "machine_status", "canView")).toBe(false);
  });
  it("★★ các hàng thật của admin DEV (đo 2026-11-04): hành động MÃ ĐÒI vẫn TRUE ⇒ không mất truy cập", async () => {
    delete process.env.RBAC_SCOPED_ADMIN;
    hang.ds = quyen({ canView: true, canEdit: true }); // ai_repo_read của admin 1 / 167
    expect(await checkPermission(1, "admin", "ai_repo_read", "canView")).toBe(true);
    hang.ds = quyen({ canCreate: true }); // ai_repo_exec
    expect(await checkPermission(1, "admin", "ai_repo_exec", "canCreate")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { canAccessStudioCorpus } from "./kbStudioAccess";

describe("canAccessStudioCorpus — Task 6 (SECURITY) role gate, fail-closed allowlist", () => {
  it("admin ⇒ true", () => {
    expect(canAccessStudioCorpus("admin")).toBe(true);
  });

  it("engineer ⇒ true", () => {
    expect(canAccessStudioCorpus("engineer")).toBe(true);
  });

  it("operator ⇒ false", () => {
    expect(canAccessStudioCorpus("operator")).toBe(false);
  });

  it("mọi vai trò RBAC khác (supervisor/quality_inspector/maintenance/viewer/user) ⇒ false", () => {
    for (const role of ["supervisor", "quality_inspector", "maintenance", "viewer", "user"]) {
      expect(canAccessStudioCorpus(role)).toBe(false);
    }
  });

  it("undefined ⇒ false (fail-closed — không xác định được vai trò)", () => {
    expect(canAccessStudioCorpus(undefined)).toBe(false);
  });

  it("null ⇒ false (fail-closed)", () => {
    expect(canAccessStudioCorpus(null)).toBe(false);
  });

  it("chuỗi rỗng ⇒ false (fail-closed)", () => {
    expect(canAccessStudioCorpus("")).toBe(false);
  });

  it("vai trò gõ sai/không tồn tại (vd 'Admin' hoa, hoặc rác) ⇒ false — allowlist khớp CHÍNH XÁC, không suy diễn", () => {
    expect(canAccessStudioCorpus("Admin")).toBe(false);
    expect(canAccessStudioCorpus("ADMIN")).toBe(false);
    expect(canAccessStudioCorpus("administrator")).toBe(false);
    expect(canAccessStudioCorpus("engineer ")).toBe(false);
  });

  it("KHÔNG phải role tone của aiLocalKnowledgeService (worker/manager/it_admin) — đây là RBAC role, hai hệ khác nhau", () => {
    // 'it_admin' là tone-role của admin thật, nhưng KHÔNG PHẢI chuỗi RBAC role thật ('admin').
    // Nếu ai đó lỡ truyền nhầm tone-role vào đây, gate PHẢI từ chối (fail-closed), không suy
    // diễn "it_admin gần giống admin nên chắc là admin".
    expect(canAccessStudioCorpus("it_admin")).toBe(false);
    expect(canAccessStudioCorpus("worker")).toBe(false);
    expect(canAccessStudioCorpus("manager")).toBe(false);
  });
});

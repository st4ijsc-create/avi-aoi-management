/**
 * GĐ1 unit tests — C5 role map + zh language detection.
 */
import { describe, it, expect } from "vitest";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import { detectLanguage } from "./aiLocalKnowledgeService";

describe("C5 — mapAppRoleToAiRole", () => {
  it("maps the agreed app roles to AI roles", () => {
    expect(mapAppRoleToAiRole("admin")).toBe("it_admin");
    expect(mapAppRoleToAiRole("supervisor")).toBe("manager");
    expect(mapAppRoleToAiRole("quality_inspector")).toBe("engineer");
    expect(mapAppRoleToAiRole("maintenance")).toBe("engineer");
    expect(mapAppRoleToAiRole("operator")).toBe("worker");
    expect(mapAppRoleToAiRole("viewer")).toBe("worker");
    expect(mapAppRoleToAiRole("user")).toBe("worker");
  });

  it("defaults unknown / missing roles to worker (safe)", () => {
    expect(mapAppRoleToAiRole(undefined)).toBe("worker");
    expect(mapAppRoleToAiRole(null)).toBe("worker");
    expect(mapAppRoleToAiRole("")).toBe("worker");
    expect(mapAppRoleToAiRole("some_custom_role_from_builder")).toBe("worker");
  });

  it("is case-insensitive", () => {
    expect(mapAppRoleToAiRole("ADMIN")).toBe("it_admin");
    expect(mapAppRoleToAiRole("  Supervisor  ")).toBe("manager");
  });
});

describe("zh — detectLanguage", () => {
  it("detects Chinese (Han characters)", () => {
    expect(detectLanguage("这台机器现在怎么样？")).toBe("zh");
    expect(detectLanguage("如何配置 AOI 检测参数？")).toBe("zh");
  });

  it("still detects Vietnamese", () => {
    expect(detectLanguage("máy này sao rồi")).toBe("vi");
    expect(detectLanguage("huong dan cau hinh he thong")).toBe("vi");
  });

  it("still detects English", () => {
    expect(detectLanguage("machine status report")).toBe("en");
  });
});

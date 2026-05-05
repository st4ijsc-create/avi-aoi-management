import { describe, it, expect } from "vitest";
import path from "path";
import { resolveSafeImagePath } from "./safeImagePath";

// Use a fixed synthetic root so tests are filesystem-independent
const ROOT = path.join("C:", "test-uploads");

describe("resolveSafeImagePath", () => {
  it("throws BAD_REQUEST for empty string", () => {
    expect(() => resolveSafeImagePath("", ROOT)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  it("throws BAD_REQUEST for absolute path (Unix style)", () => {
    expect(() => resolveSafeImagePath("/etc/passwd", ROOT)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  it("throws BAD_REQUEST for absolute path (Windows style)", () => {
    expect(() => resolveSafeImagePath("C:\\Windows\\system32\\cmd.exe", ROOT)).toThrow(
      expect.objectContaining({ code: "BAD_REQUEST" }),
    );
  });

  it("resolves a simple relative path inside the root", () => {
    const result = resolveSafeImagePath("inspections/abc.jpg", ROOT);
    expect(result).toBe(path.join(ROOT, "inspections", "abc.jpg"));
  });

  it("resolves a nested relative path inside the root", () => {
    const result = resolveSafeImagePath("a/b/c.png", ROOT);
    expect(result).toBe(path.join(ROOT, "a", "b", "c.png"));
  });

  it("throws FORBIDDEN for single-level path traversal ../../", () => {
    expect(() => resolveSafeImagePath("../../etc/passwd", ROOT)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("throws FORBIDDEN for nested traversal dir/../../outside/file.jpg", () => {
    expect(() => resolveSafeImagePath("dir/../../outside/file.jpg", ROOT)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });

  it("normalises Windows backslash paths correctly (valid sub-path)", () => {
    const result = resolveSafeImagePath("subdir\\file.jpg", ROOT);
    expect(result).toBe(path.join(ROOT, "subdir", "file.jpg"));
  });

  it("throws BAD_REQUEST for leading-slash absolute path /foo/bar.jpg", () => {
    // path.isAbsolute("/foo/bar.jpg") === true on POSIX; on Windows it's relative so check FORBIDDEN too
    expect(() => resolveSafeImagePath("/foo/bar.jpg", ROOT)).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/BAD_REQUEST|FORBIDDEN/) }),
    );
  });

  it("throws FORBIDDEN for traversal that escapes after stripping leading slash", () => {
    // "../../etc/hosts" is a relative path but escapes root
    expect(() => resolveSafeImagePath("../../etc/hosts", ROOT)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
  });
});

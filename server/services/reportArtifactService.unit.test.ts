/**
 * Doc 32 Wave R2 (R2-B) — PURE unit tests for reportArtifactService helpers.
 * No DB, no storage — exercises the access-control, expiry, hashing, retention
 * and key/filename logic in isolation. Always runs (no DATABASE_URL needed).
 */
import { describe, it, expect } from "vitest";
import {
  canAccessArtifact,
  isExpired,
  resolveRetentionDays,
  contentTypeForFormat,
  buildStorageKey,
  sha256Hex,
  artifactDownloadPath,
  defaultFilename,
} from "./reportArtifactService";

describe("reportArtifactService — access control", () => {
  const owned = { createdBy: 42 };
  const system = { createdBy: null as number | null };

  it("creator can access their own artifact", () => {
    expect(canAccessArtifact({ id: 42, role: "operator" }, owned)).toBe(true);
  });
  it("a different non-privileged user is denied", () => {
    expect(canAccessArtifact({ id: 99, role: "operator" }, owned)).toBe(false);
  });
  it("privileged roles (admin/supervisor/quality_inspector) can access any artifact", () => {
    for (const role of ["admin", "supervisor", "quality_inspector"]) {
      expect(canAccessArtifact({ id: 99, role }, owned)).toBe(true);
      expect(canAccessArtifact({ id: 99, role }, system)).toBe(true);
    }
  });
  it("system artifacts (createdBy null) are denied to non-privileged users", () => {
    expect(canAccessArtifact({ id: 42, role: "operator" }, system)).toBe(false);
  });
  it("a trusted server-to-server principal (privileged flag) can access any artifact", () => {
    expect(canAccessArtifact({ privileged: true }, system)).toBe(true);
  });
  it("a null viewer is always denied", () => {
    expect(canAccessArtifact(null, owned)).toBe(false);
  });
});

describe("reportArtifactService — expiry", () => {
  const now = new Date("2026-07-05T12:00:00Z");
  it("future expiresAt is not expired", () => {
    expect(isExpired({ expiresAt: new Date("2027-07-05T12:00:00Z") }, now)).toBe(false);
  });
  it("past expiresAt is expired", () => {
    expect(isExpired({ expiresAt: new Date("2026-07-04T12:00:00Z") }, now)).toBe(true);
  });
});

describe("reportArtifactService — retention default (decision #4: >= 1 year)", () => {
  it("defaults to 365 days when no override / env", () => {
    const prev = process.env.REPORT_ARTIFACT_RETENTION_DAYS;
    delete process.env.REPORT_ARTIFACT_RETENTION_DAYS;
    expect(resolveRetentionDays()).toBe(365);
    if (prev !== undefined) process.env.REPORT_ARTIFACT_RETENTION_DAYS = prev;
  });
  it("honours an explicit override (used by tests to forge expired artifacts)", () => {
    expect(resolveRetentionDays(-1)).toBe(-1);
    expect(resolveRetentionDays(730)).toBe(730);
  });
  it("honours REPORT_ARTIFACT_RETENTION_DAYS env when positive", () => {
    const prev = process.env.REPORT_ARTIFACT_RETENTION_DAYS;
    process.env.REPORT_ARTIFACT_RETENTION_DAYS = "540";
    expect(resolveRetentionDays()).toBe(540);
    if (prev === undefined) delete process.env.REPORT_ARTIFACT_RETENTION_DAYS;
    else process.env.REPORT_ARTIFACT_RETENTION_DAYS = prev;
  });
});

describe("reportArtifactService — content type + hashing + keys", () => {
  it("maps each format to a sensible content type", () => {
    expect(contentTypeForFormat("pdf")).toBe("application/pdf");
    expect(contentTypeForFormat("xlsx")).toContain("spreadsheetml");
    expect(contentTypeForFormat("csv")).toContain("text/csv");
    expect(contentTypeForFormat("html")).toContain("text/html");
    expect(contentTypeForFormat("pptx")).toContain("presentationml");
  });
  it("sha256Hex is a 64-char hex digest, stable for the same bytes", () => {
    const h1 = sha256Hex(Buffer.from("hello world"));
    const h2 = sha256Hex(Buffer.from("hello world"));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(sha256Hex(Buffer.from("other"))).not.toBe(h1);
  });
  it("buildStorageKey is deterministic and namespaced by year/month", () => {
    const at = new Date("2026-07-05T00:00:00Z");
    const hash = "abc123";
    expect(buildStorageKey(hash, "pdf", at)).toBe("report-artifacts/2026/07/abc123.pdf");
    expect(buildStorageKey(hash, "xlsx", at)).toBe("report-artifacts/2026/07/abc123.xlsx");
  });
  it("artifactDownloadPath + defaultFilename", () => {
    expect(artifactDownloadPath(7)).toBe("/api/reports/artifacts/7/download");
    expect(defaultFilename({ id: 7, reportType: "daily summary", format: "pdf" })).toBe("daily_summary-7.pdf");
  });
});

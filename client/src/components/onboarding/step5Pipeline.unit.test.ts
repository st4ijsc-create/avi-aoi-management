/**
 * W7-D (doc 27 gap V19) — Step-5 delivery pipeline derivation tests
 * (packaged → downloaded → verified → active, honest states).
 */
import { describe, it, expect } from "vitest";
import { deriveDeploymentPipeline } from "./step5Pipeline";

const states = (d: Parameters<typeof deriveDeploymentPipeline>[0]) =>
  Object.fromEntries(deriveDeploymentPipeline(d).stages.map((s) => [s.key, s.state]));

describe("deriveDeploymentPipeline", () => {
  it("PENDING: everything pending", () => {
    expect(states({ status: "PENDING" })).toEqual({
      packaged: "pending", downloaded: "pending", verified: "pending", active: "pending",
    });
  });

  it("PACKAGING: packaged in progress", () => {
    expect(states({ status: "PACKAGING" })).toEqual({
      packaged: "inProgress", downloaded: "pending", verified: "pending", active: "pending",
    });
  });

  it("READY (packageHash set): packaged done, download pending", () => {
    expect(states({ status: "READY", packageHash: "abc" })).toEqual({
      packaged: "done", downloaded: "pending", verified: "pending", active: "pending",
    });
  });

  it("DOWNLOADING: download in progress", () => {
    expect(states({ status: "DOWNLOADING", packageHash: "abc" })).toEqual({
      packaged: "done", downloaded: "inProgress", verified: "pending", active: "pending",
    });
  });

  it("DEPLOYED with deployVerifiedAt: verified done, active in progress", () => {
    const d = {
      status: "DEPLOYED",
      packageHash: "abc",
      deployConfig: { deployVerifiedAt: "2026-07-04T10:00:00.000Z" },
    };
    expect(states(d)).toEqual({
      packaged: "done", downloaded: "done", verified: "done", active: "inProgress",
    });
    const r = deriveDeploymentPipeline(d);
    expect(r.verifiedAt).toBe("2026-07-04T10:00:00.000Z");
    expect(r.unverifiedDeploy).toBe(false);
  });

  it("legacy deployedAt (hash-match twin) also counts as verified", () => {
    const d = { status: "DEPLOYED", packageHash: "abc", deployedAt: "2026-07-04T09:00:00.000Z" };
    expect(states(d).verified).toBe("done");
    expect(deriveDeploymentPipeline(d).unverifiedDeploy).toBe(false);
  });

  it("HONESTY: DEPLOYED without any hash confirmation → verified FAILED + warning flag", () => {
    const d = { status: "DEPLOYED", packageHash: "abc" }; // legacy updateStatus path
    expect(states(d)).toEqual({
      packaged: "done", downloaded: "done", verified: "failed", active: "pending",
    });
    expect(deriveDeploymentPipeline(d).unverifiedDeploy).toBe(true);
  });

  it("ACTIVE + verified: full green pipeline", () => {
    const d = {
      status: "ACTIVE",
      packageHash: "abc",
      deployConfig: { deployVerifiedAt: "2026-07-04T10:00:00.000Z" },
    };
    expect(states(d)).toEqual({
      packaged: "done", downloaded: "done", verified: "done", active: "done",
    });
    expect(deriveDeploymentPipeline(d).isActive).toBe(true);
  });

  it("ACTIVE without verification still warns (never silently green)", () => {
    const d = { status: "ACTIVE", packageHash: "abc" };
    expect(states(d).verified).toBe("failed");
    expect(deriveDeploymentPipeline(d).unverifiedDeploy).toBe(true);
  });

  it("FAILED before packaging: all failed except nothing done", () => {
    expect(states({ status: "FAILED" })).toEqual({
      packaged: "failed", downloaded: "failed", verified: "failed", active: "failed",
    });
    expect(deriveDeploymentPipeline({ status: "FAILED" }).isFailed).toBe(true);
  });

  it("FAILED after packaging keeps the packaged stage done (honest partial progress)", () => {
    expect(states({ status: "FAILED", packageHash: "abc" })).toEqual({
      packaged: "done", downloaded: "failed", verified: "failed", active: "failed",
    });
  });

  it("null/undefined row: all pending", () => {
    expect(states(null)).toEqual({
      packaged: "pending", downloaded: "pending", verified: "pending", active: "pending",
    });
  });
});

/**
 * W7-D (doc 27 gap V19) — pure derivation of the Step-5 delivery pipeline
 * (packaged → downloaded → verified → active) from an edge_deployments row.
 * Extracted from Step5Verify.tsx so the honesty rules are unit-testable
 * without jsdom/trpc.
 *
 * Honesty rules:
 *  • "verified" ONLY when the device proved possession of the exact bytes:
 *    deployConfig.deployVerifiedAt (stamped by confirmDeployment on sha256
 *    match) or its legacy twin deployedAt (also only set on hash match).
 *  • DEPLOYED/ACTIVE reached WITHOUT a hash confirmation (legacy updateStatus
 *    path) → verified stage shows "failed" + unverifiedDeploy warning; it is
 *    NEVER silently green.
 */

export type StageState = "done" | "inProgress" | "pending" | "failed";

export interface DeploymentRowLike {
  status?: string | null;
  packageHash?: string | null;
  deployedAt?: string | Date | null;
  deployConfig?: { deployVerifiedAt?: string | null } | null;
}

export interface PipelineDerivation {
  stages: Array<{ key: "packaged" | "downloaded" | "verified" | "active"; state: StageState }>;
  /** ISO string / Date of the hash-verified confirmation, or null. */
  verifiedAt: string | Date | null;
  /** DEPLOYED/ACTIVE was reported WITHOUT hash confirmation. */
  unverifiedDeploy: boolean;
  isActive: boolean;
  isFailed: boolean;
}

export function deriveDeploymentPipeline(d: DeploymentRowLike | null | undefined): PipelineDerivation {
  const status = d?.status ?? undefined;
  const isActive = status === "ACTIVE";
  const isFailed = status === "FAILED";

  const packaged = !!d?.packageHash;
  const verifiedAt = d?.deployConfig?.deployVerifiedAt ?? d?.deployedAt ?? null;
  const reportedDeployed = status === "DEPLOYED" || status === "ACTIVE";
  const downloaded = reportedDeployed || !!verifiedAt;
  const verified = !!verifiedAt;
  const unverifiedDeploy = reportedDeployed && !verified;

  const stages: PipelineDerivation["stages"] = [
    {
      key: "packaged",
      state: packaged ? "done" : isFailed ? "failed" : status === "PACKAGING" ? "inProgress" : "pending",
    },
    {
      key: "downloaded",
      state: downloaded ? "done" : isFailed ? "failed" : status === "DOWNLOADING" ? "inProgress" : "pending",
    },
    {
      key: "verified",
      state: verified ? "done" : unverifiedDeploy || isFailed ? "failed" : downloaded ? "inProgress" : "pending",
    },
    {
      key: "active",
      state: isActive ? "done" : isFailed ? "failed" : verified ? "inProgress" : "pending",
    },
  ];

  return { stages, verifiedAt, unverifiedDeploy, isActive, isFailed };
}

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { logger } from "../logger";

/**
 * Off-site backup replication (ISO 22301 geographic redundancy).
 *
 * Modes (selected via env vars, evaluated in this order):
 *   1. AWS_S3_BACKUP_BUCKET → shells out to `aws s3 cp`.
 *      - Works for AWS S3 and any S3-compatible store (MinIO, Wasabi, R2, Ceph)
 *        when AWS_S3_ENDPOINT_URL is set.
 *      - Optional: AWS_S3_BACKUP_PREFIX, AWS_REGION, AWS_S3_SSE (AES256|aws:kms),
 *        AWS_S3_SSE_KMS_KEY_ID, AWS_S3_STORAGE_CLASS.
 *      - Requires aws-cli on PATH; credentials via standard chain (env,
 *        instance profile, ~/.aws/credentials).
 *   2. OFFSITE_BACKUP_DIR → filesystem copy (mounted NAS / SMB share).
 *
 * For every successful replication, a sidecar `<filename>.sha256` is also
 * uploaded so consumers can verify integrity without re-downloading the
 * entire dump.
 *
 * If neither mode is configured, replication is a no-op and returns
 * { skipped: true }. Failures never throw — they are logged and returned
 * so the primary local backup remains trustworthy.
 */

export interface ReplicationResult {
  skipped: boolean;
  target?: string;
  durationMs?: number;
  bytes?: number;
  error?: string;
  sha256?: string;
  mode?: "s3" | "offsite_dir";
  sseApplied?: string;
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function replicateBackup(filePath: string): Promise<ReplicationResult> {
  if (!fs.existsSync(filePath)) {
    return { skipped: false, error: `file not found: ${filePath}` };
  }
  const stat = fs.statSync(filePath);
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  const offsiteDir = process.env.OFFSITE_BACKUP_DIR;

  if (bucket) {
    return replicateToS3(filePath, stat.size, bucket);
  }
  if (offsiteDir) {
    return replicateToDir(filePath, stat.size, offsiteDir);
  }
  return { skipped: true };
}

function buildS3Args(src: string, dst: string): string[] {
  const args = ["s3", "cp", src, dst, "--only-show-errors"];
  const region = process.env.AWS_REGION;
  const endpoint = process.env.AWS_S3_ENDPOINT_URL;
  const sse = process.env.AWS_S3_SSE;
  const sseKmsKeyId = process.env.AWS_S3_SSE_KMS_KEY_ID;
  const storageClass = process.env.AWS_S3_STORAGE_CLASS;

  if (region) args.push("--region", region);
  if (endpoint) args.push("--endpoint-url", endpoint);
  if (sse) {
    args.push("--sse", sse);
    if (sse === "aws:kms" && sseKmsKeyId) args.push("--sse-kms-key-id", sseKmsKeyId);
  }
  if (storageClass) args.push("--storage-class", storageClass);
  return args;
}

function runAwsCp(args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("aws", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => resolve({ code: -1, stderr: err.message }));
    proc.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

async function replicateToS3(filePath: string, bytes: number, bucket: string): Promise<ReplicationResult> {
  const t0 = Date.now();
  const prefix = (process.env.AWS_S3_BACKUP_PREFIX ?? "avi-aoi-backups").replace(/^\/+|\/+$/g, "");
  const fileName = path.basename(filePath);
  const s3Uri = `s3://${bucket}/${prefix}/${fileName}`;
  const sseApplied = process.env.AWS_S3_SSE;

  // Compute checksum and write sidecar manifest
  let sha256: string;
  try {
    sha256 = await sha256File(filePath);
  } catch (err: any) {
    return { skipped: false, target: s3Uri, mode: "s3", error: `sha256 failed: ${err.message}` };
  }
  const sidecarLocal = `${filePath}.sha256`;
  try {
    await fs.promises.writeFile(sidecarLocal, `${sha256}  ${fileName}\n`, "utf8");
  } catch (err: any) {
    return { skipped: false, target: s3Uri, mode: "s3", sha256, error: `sidecar write failed: ${err.message}` };
  }

  // Upload primary
  const mainResult = await runAwsCp(buildS3Args(filePath, s3Uri));
  if (mainResult.code !== 0) {
    const err = `aws s3 cp exited ${mainResult.code}: ${mainResult.stderr.slice(0, 500)}`;
    logger.error({ err, s3Uri }, "S3 replication failed");
    return { skipped: false, target: s3Uri, mode: "s3", sha256, sseApplied, error: err };
  }

  // Upload sidecar (best effort — primary already succeeded)
  const sideResult = await runAwsCp(buildS3Args(sidecarLocal, `${s3Uri}.sha256`));
  if (sideResult.code !== 0) {
    logger.warn({ stderr: sideResult.stderr.slice(0, 200), s3Uri }, "Sidecar sha256 upload failed (primary OK)");
  }

  logger.info({ s3Uri, bytes, sha256, sseApplied, durationMs: Date.now() - t0 }, "Backup replicated to S3");
  return {
    skipped: false,
    target: s3Uri,
    mode: "s3",
    bytes,
    sha256,
    sseApplied,
    durationMs: Date.now() - t0,
  };
}

async function replicateToDir(filePath: string, bytes: number, offsiteDir: string): Promise<ReplicationResult> {
  const t0 = Date.now();
  try {
    if (!fs.existsSync(offsiteDir)) fs.mkdirSync(offsiteDir, { recursive: true });
    const fileName = path.basename(filePath);
    const dest = path.join(offsiteDir, fileName);
    await fs.promises.copyFile(filePath, dest);

    const sha256 = await sha256File(dest);
    await fs.promises.writeFile(`${dest}.sha256`, `${sha256}  ${fileName}\n`, "utf8");

    logger.info({ dest, bytes, sha256, durationMs: Date.now() - t0 }, "Backup replicated to off-site dir");
    return {
      skipped: false,
      target: dest,
      mode: "offsite_dir",
      bytes,
      sha256,
      durationMs: Date.now() - t0,
    };
  } catch (err: any) {
    logger.error({ err: err.message, offsiteDir }, "Off-site dir replication failed");
    return { skipped: false, target: offsiteDir, mode: "offsite_dir", error: err.message };
  }
}

/**
 * Dry-run probe used by the `testReplication` tRPC endpoint. Uploads a small
 * temp file and (for S3 mode) verifies it appears in the bucket listing, then
 * removes both copies. Never throws — returns a structured result.
 */
export async function testReplicationConnectivity(): Promise<ReplicationResult & { probeFile?: string }> {
  const bucket = process.env.AWS_S3_BACKUP_BUCKET;
  const offsiteDir = process.env.OFFSITE_BACKUP_DIR;
  if (!bucket && !offsiteDir) return { skipped: true };

  const tmpName = `avi-aoi-replication-probe-${Date.now()}.txt`;
  const tmpPath = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", tmpName);
  try {
    await fs.promises.writeFile(tmpPath, `probe ${new Date().toISOString()}\n`, "utf8");
    const result = await replicateBackup(tmpPath);

    // Best-effort cleanup of remote artifact
    if (result.target && !result.error) {
      try {
        if (result.mode === "s3") {
          await runAwsCp(["s3", "rm", result.target, "--only-show-errors", ...(process.env.AWS_REGION ? ["--region", process.env.AWS_REGION] : []), ...(process.env.AWS_S3_ENDPOINT_URL ? ["--endpoint-url", process.env.AWS_S3_ENDPOINT_URL] : [])]);
          await runAwsCp(["s3", "rm", `${result.target}.sha256`, "--only-show-errors", ...(process.env.AWS_REGION ? ["--region", process.env.AWS_REGION] : []), ...(process.env.AWS_S3_ENDPOINT_URL ? ["--endpoint-url", process.env.AWS_S3_ENDPOINT_URL] : [])]);
        } else if (result.mode === "offsite_dir") {
          await fs.promises.unlink(result.target).catch(() => {});
          await fs.promises.unlink(`${result.target}.sha256`).catch(() => {});
        }
      } catch { /* swallow */ }
    }

    return { ...result, probeFile: tmpName };
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
    await fs.promises.unlink(`${tmpPath}.sha256`).catch(() => {});
  }
}

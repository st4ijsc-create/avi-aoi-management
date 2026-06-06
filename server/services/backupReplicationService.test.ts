/**
 * Unit tests for off-site backup replication (ISO 22301 geographic redundancy).
 * Mocks `child_process.spawn` for the S3 path; uses real fs in an OS temp dir
 * for the offsite_dir path so SHA256 sidecar behaviour is exercised end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

// Import after mocks
import { replicateBackup, testReplicationConnectivity } from "./backupReplicationService";

/**
 * Returns a thunk that builds the fake proc lazily at spawn call-time.
 * Building it eagerly (e.g. `mockReturnValueOnce(makeFakeProc(0))`) schedules
 * the `setImmediate(emit("close"))` before the source has attached `.on("close")`,
 * so the listener never fires and the test times out.
 */
function fakeProc(code: number, stderr = "") {
  return () => {
    const proc: any = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdout = new EventEmitter();
    setImmediate(() => {
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", code);
    });
    return proc;
  };
}

const ENV_KEYS = [
  "AWS_S3_BACKUP_BUCKET", "AWS_S3_BACKUP_PREFIX", "AWS_REGION",
  "AWS_S3_ENDPOINT_URL", "AWS_S3_SSE", "AWS_S3_SSE_KMS_KEY_ID",
  "AWS_S3_STORAGE_CLASS", "OFFSITE_BACKUP_DIR",
];

let tmpRoot: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "avi-aoi-repl-test-"));
  spawnMock.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFixture(name: string, body = "hello-backup"): string {
  const p = path.join(tmpRoot, name);
  fs.writeFileSync(p, body);
  return p;
}

describe("replicateBackup — no mode configured", () => {
  it("returns skipped:true when neither S3 nor offsite_dir is set", async () => {
    const file = writeFixture("dump.sql");
    const result = await replicateBackup(file);
    expect(result).toEqual({ skipped: true });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns error when source file does not exist", async () => {
    process.env.OFFSITE_BACKUP_DIR = path.join(tmpRoot, "offsite");
    const result = await replicateBackup(path.join(tmpRoot, "missing.sql"));
    expect(result.skipped).toBe(false);
    expect(result.error).toMatch(/file not found/);
  });
});

describe("replicateBackup — offsite_dir mode", () => {
  it("copies file and writes sha256 sidecar", async () => {
    const offsite = path.join(tmpRoot, "offsite");
    process.env.OFFSITE_BACKUP_DIR = offsite;
    const body = "payload-" + Date.now();
    const file = writeFixture("dump.sql", body);

    const result = await replicateBackup(file);

    const expectedSha = crypto.createHash("sha256").update(body).digest("hex");
    const dest = path.join(offsite, "dump.sql");
    expect(result.mode).toBe("offsite_dir");
    expect(result.skipped).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.sha256).toBe(expectedSha);
    expect(result.target).toBe(dest);
    expect(fs.readFileSync(dest, "utf8")).toBe(body);
    expect(fs.readFileSync(`${dest}.sha256`, "utf8")).toBe(`${expectedSha}  dump.sql\n`);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("creates the target directory if it does not exist", async () => {
    const offsite = path.join(tmpRoot, "deeply", "nested", "offsite");
    process.env.OFFSITE_BACKUP_DIR = offsite;
    const file = writeFixture("dump.sql");

    const result = await replicateBackup(file);

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(offsite, "dump.sql"))).toBe(true);
  });
});

describe("replicateBackup — S3 mode", () => {
  beforeEach(() => {
    process.env.AWS_S3_BACKUP_BUCKET = "test-bucket";
    process.env.AWS_S3_BACKUP_PREFIX = "avi-aoi/prod";
  });

  it("invokes aws s3 cp for primary + sidecar and returns sha256", async () => {
    spawnMock
      .mockImplementationOnce(fakeProc(0)) // primary
      .mockImplementationOnce(fakeProc(0)); // sidecar
    const file = writeFixture("dump.sql", "abc");

    const result = await replicateBackup(file);

    expect(result.mode).toBe("s3");
    expect(result.error).toBeUndefined();
    expect(result.target).toBe("s3://test-bucket/avi-aoi/prod/dump.sql");
    expect(result.sha256).toBe(crypto.createHash("sha256").update("abc").digest("hex"));
    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("aws");
    expect(args.slice(0, 4)).toEqual(["s3", "cp", file, "s3://test-bucket/avi-aoi/prod/dump.sql"]);
  });

  it("passes region, endpoint-url, sse, kms-key, and storage-class flags", async () => {
    process.env.AWS_REGION = "ap-southeast-1";
    process.env.AWS_S3_ENDPOINT_URL = "https://minio.example.com";
    process.env.AWS_S3_SSE = "aws:kms";
    process.env.AWS_S3_SSE_KMS_KEY_ID = "arn:aws:kms:test";
    process.env.AWS_S3_STORAGE_CLASS = "STANDARD_IA";
    spawnMock.mockImplementation(fakeProc(0));
    const file = writeFixture("dump.sql");

    await replicateBackup(file);

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args).toContain("--region"); expect(args).toContain("ap-southeast-1");
    expect(args).toContain("--endpoint-url"); expect(args).toContain("https://minio.example.com");
    expect(args).toContain("--sse"); expect(args).toContain("aws:kms");
    expect(args).toContain("--sse-kms-key-id"); expect(args).toContain("arn:aws:kms:test");
    expect(args).toContain("--storage-class"); expect(args).toContain("STANDARD_IA");
  });

  it("returns error when primary aws s3 cp exits non-zero", async () => {
    spawnMock.mockImplementationOnce(fakeProc(2, "AccessDenied"));
    const file = writeFixture("dump.sql");

    const result = await replicateBackup(file);

    expect(result.error).toMatch(/aws s3 cp exited 2/);
    expect(result.error).toMatch(/AccessDenied/);
    expect(result.mode).toBe("s3");
  });

  it("returns error when aws binary cannot be spawned", async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc: any = new EventEmitter();
      proc.stderr = new EventEmitter();
      setImmediate(() => proc.emit("error", new Error("ENOENT")));
      return proc;
    });
    const file = writeFixture("dump.sql");

    const result = await replicateBackup(file);

    expect(result.error).toMatch(/ENOENT/);
  });

  it("still succeeds when sidecar upload fails (best-effort)", async () => {
    spawnMock
      .mockImplementationOnce(fakeProc(0))          // primary OK
      .mockImplementationOnce(fakeProc(1, "fail")); // sidecar fails
    const file = writeFixture("dump.sql");

    const result = await replicateBackup(file);

    expect(result.error).toBeUndefined();
    expect(result.mode).toBe("s3");
    expect(result.sha256).toBeDefined();
  });
});

describe("testReplicationConnectivity", () => {
  it("returns skipped:true when no replication mode configured", async () => {
    const result = await testReplicationConnectivity();
    expect(result.skipped).toBe(true);
  });

  it("round-trips a probe file through offsite_dir and cleans up", async () => {
    const offsite = path.join(tmpRoot, "offsite");
    process.env.OFFSITE_BACKUP_DIR = offsite;

    const result = await testReplicationConnectivity();

    expect(result.skipped).toBe(false);
    expect(result.mode).toBe("offsite_dir");
    expect(result.error).toBeUndefined();
    expect(result.probeFile).toMatch(/^avi-aoi-replication-probe-/);
    // cleanup: target file should be removed
    if (result.target) expect(fs.existsSync(result.target)).toBe(false);
  });
});

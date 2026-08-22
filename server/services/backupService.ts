/**
 * Backup Service — pg_dump / pg_restore wrapper
 *
 * Produces real PostgreSQL dumps (.sql.gz) stored in uploads/backups/.
 * Also supports selective table-group exports via COPY … TO STDOUT.
 *
 * Standards: ISO 22301 (DR), ISO 9001:2015 Clause 7.5.3
 */

import { spawn, execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as zlib from "zlib";
import { pipeline } from "stream/promises";

// ─── Constants ──────────────────────────────────────────────────────────────

const PG_BIN_CANDIDATES = [
  "C:\\Program Files\\PostgreSQL\\18\\bin",
  "C:\\Program Files\\PostgreSQL\\17\\bin",
  "C:\\Program Files\\PostgreSQL\\16\\bin",
  "C:\\Program Files\\PostgreSQL\\15\\bin",
  "/usr/bin",
  "/usr/local/bin",
];

const BACKUP_DIR = path.resolve("uploads", "backups");

// Table categories exposed in the UI
export const TABLE_CATEGORIES: Record<string, string[]> = {
  inspections: [
    "product_inspections", "measurement_results", "measurement_point_defs",
    "inspection_packages", "package_images",
  ],
  machines: [
    "machines", "stations", "production_lines", "workshops", "factories",
    "machine_health_history", "machine_heartbeats", "machine_status_logs",
  ],
  quality: [
    "spc_rule_violations", "cpk_history", "quality_gates", "quality_gate_events",
    "defect_catalog", "audit_logs",
  ],
  ai: [
    "ai_models", "ai_model_metrics", "model_versions", "ai_quality_gate_configs",
    "ai_quality_gate_results", "training_jobs", "training_datasets",
  ],
  production: [
    "production_orders", "oee_metrics", "downtime_events", "shift_configs",
    "daily_statistics",
  ],
  users: [
    "users", "user_sessions", "user_roles", "permissions",
    "user_factory_assignments", "user_corporate_assignments",
  ],
};

// ─── Utilities ──────────────────────────────────────────────────────────────

function findPgBin(exe: string): string {
  for (const dir of PG_BIN_CANDIDATES) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  // Try PATH
  return exe;
}

function ensureBackupDir(): void {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function parseConnectionUrl(url: string): {
  host: string; port: number; dbname: string; user: string; password: string;
} {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "5432"),
    dbname: u.pathname.replace(/^\//, ""),
    user: u.username,
    password: decodeURIComponent(u.password),
  };
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", d => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

// ─── W0-I (doc 44 G5.8) — Config/secrets bundle đi kèm backup ───────────────
//
// pg_dump chỉ cứu được DB — mất máy chủ là mất luôn: .env runtime (mọi secret/
// flag), cặp khoá license RSA (server/license/keys/*.pem — mất là license đã
// phát hành không xác minh được), keystore CA nội bộ (device PKI, doc 38 C2)
// và contracts/canonical (schema hợp đồng máy).
//
// createConfigBundle() gom các file đó thành 1 bundle MÃ HOÁ AES-256-GCM:
//   - Flag `BACKUP_INCLUDE_SECRETS` default OFF — không bật thì skip im lặng.
//   - BẮT BUỘC `BACKUP_ENCRYPTION_KEY` (64-hex = key thô 32 byte, hoặc
//     passphrase bất kỳ → sha256). Thiếu key → SKIP + warn trung thực,
//     TUYỆT ĐỐI không ghi secrets plaintext ra đĩa backup.
//   - Định dạng file: magic "CFGB0001" (8B) + IV (12B) + GCM tag (16B) +
//     ciphertext( gzip( JSON{v,createdAt,files:[{path,bytes,sha256,contentBase64}]} ) ).
//   - Log CHỈ tên file + size + sha256 của ciphertext — không bao giờ nội dung.
//   - Off-site: tái dùng replicateBackup (S3/offsite dir) best-effort.

const CONFIG_BUNDLE_MAGIC = Buffer.from("CFGB0001", "ascii"); // 8 bytes
const CONFIG_BUNDLE_EXT = ".cfgb.enc";

export interface ConfigBundleFileInfo {
  /** đường dẫn tương đối so với cwd (không bao giờ là nội dung) */
  path: string;
  bytes: number;
}

export interface ConfigBundleResult {
  skipped: boolean;
  reason?: string;
  fileName?: string;
  filePath?: string;
  fileSizeBytes?: number;
  /** sha256 của CIPHERTEXT (file trên đĩa) — dùng verify khi restore */
  sha256?: string;
  fileCount?: number;
  /** tên + size các file được gom — KHÔNG chứa nội dung */
  files?: ConfigBundleFileInfo[];
  offsite?: BackupResult["offsite"];
}

/** Nguồn mặc định của bundle. Chỉ trả về file THỰC SỰ tồn tại. */
export function collectConfigBundleSources(cwd: string = process.cwd()): string[] {
  const out: string[] = [];
  const pushFile = (p: string) => {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) out.push(p);
    } catch { /* unreadable — bỏ qua */ }
  };
  const pushDir = (dir: string, filter?: (f: string) => boolean) => {
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
      for (const f of fs.readdirSync(dir)) {
        if (!filter || filter(f)) pushFile(path.join(dir, f));
      }
    } catch { /* unreadable — bỏ qua */ }
  };

  // (a) runtime env
  pushFile(path.join(cwd, ".env"));
  // (b) license keystore — RSA pair (license-service.ts keyDir)
  pushDir(path.join(cwd, "server", "license", "keys"), (f) => f.endsWith(".pem"));
  // (b2) internal CA keystore — device PKI (internalCa.ts, gitignored)
  pushDir(path.join(cwd, "server", "services", "security", ".keystore"));
  // (c) canonical machine contracts
  pushDir(path.join(cwd, "contracts", "canonical"), (f) => f.endsWith(".json"));
  return out;
}

/** 64-hex → key thô 32 byte; ngược lại sha256(passphrase). */
function deriveBundleKey(secret: string): Buffer {
  const t = secret.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) return Buffer.from(t, "hex");
  return crypto.createHash("sha256").update(t, "utf8").digest();
}

export async function createConfigBundle(opts: {
  label?: string;
  /** override nguồn (test/DI) — đường dẫn tuyệt đối */
  sources?: string[];
  /** override thư mục output (test) — default uploads/backups */
  outDir?: string;
  /** override env (test) — default process.env */
  env?: NodeJS.ProcessEnv;
  /** default true — tái dùng replicateBackup (no-op nếu chưa cấu hình off-site) */
  replicateOffsite?: boolean;
} = {}): Promise<ConfigBundleResult> {
  const env = opts.env ?? process.env;

  if (env.BACKUP_INCLUDE_SECRETS !== "true") {
    return { skipped: true, reason: "BACKUP_INCLUDE_SECRETS is not enabled (default off)" };
  }
  const secret = (env.BACKUP_ENCRYPTION_KEY ?? "").trim();
  if (!secret) {
    console.warn(
      "[Backup] BACKUP_INCLUDE_SECRETS=true nhưng BACKUP_ENCRYPTION_KEY chưa đặt — " +
        "BỎ QUA config bundle (không bao giờ ghi secrets plaintext). Đặt BACKUP_ENCRYPTION_KEY để bật.",
    );
    return {
      skipped: true,
      reason: "BACKUP_ENCRYPTION_KEY not set — refusing to write secrets in plaintext",
    };
  }

  const cwd = process.cwd();
  const sources = opts.sources ?? collectConfigBundleSources(cwd);
  if (sources.length === 0) {
    return { skipped: true, reason: "no config/secret files found to bundle" };
  }

  const outDir = opts.outDir ?? BACKUP_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  const files: Array<{ path: string; bytes: number; sha256: string; contentBase64: string }> = [];
  const publicList: ConfigBundleFileInfo[] = [];
  for (const abs of sources) {
    try {
      const content = fs.readFileSync(abs);
      const rel = path.relative(cwd, abs).split(path.sep).join("/") || path.basename(abs);
      files.push({
        path: rel,
        bytes: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        contentBase64: content.toString("base64"),
      });
      publicList.push({ path: rel, bytes: content.length });
    } catch (err: any) {
      console.warn(`[Backup] config bundle: không đọc được ${path.basename(abs)} — bỏ qua (${err?.message})`);
    }
  }
  if (files.length === 0) {
    return { skipped: true, reason: "all config/secret source files were unreadable" };
  }

  const manifest = JSON.stringify({ v: 1, createdAt: new Date().toISOString(), files });
  const plaintext = zlib.gzipSync(Buffer.from(manifest, "utf8"), { level: 9 });

  const key = deriveBundleKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tag2 = opts.label ? `_${opts.label.replace(/[^a-z0-9]/gi, "_")}` : "";
  const fileName = `config_bundle${tag2}_${ts}${CONFIG_BUNDLE_EXT}`;
  const filePath = path.join(outDir, fileName);
  fs.writeFileSync(filePath, Buffer.concat([CONFIG_BUNDLE_MAGIC, iv, tag, ciphertext]));

  const stat = fs.statSync(filePath);
  const sha256 = await sha256File(filePath);
  // Log CHỈ metadata của ciphertext — không tên biến env, không nội dung key.
  console.log(
    `[Backup] config bundle: ${fileName} (${files.length} files, ${stat.size} B, sha256=${sha256})`,
  );

  // Retention nhẹ cho bundle (mặc định giữ 30 bản mới nhất).
  try {
    const keep = Math.max(1, parseInt(env.BACKUP_CONFIG_BUNDLE_RETENTION ?? "30", 10) || 30);
    const bundles = fs.readdirSync(outDir)
      .filter((f) => f.startsWith("config_bundle") && f.endsWith(CONFIG_BUNDLE_EXT))
      .map((f) => ({ f, t: fs.statSync(path.join(outDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const stale of bundles.slice(keep)) {
      try { fs.unlinkSync(path.join(outDir, stale.f)); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }

  // Off-site (best-effort, không fail bundle).
  let offsite: BackupResult["offsite"];
  if (opts.replicateOffsite !== false) {
    try {
      const { replicateBackup } = await import("./backupReplicationService");
      offsite = await replicateBackup(filePath);
    } catch (err: any) {
      // data-raw-ok: trạng thái nhân bản ngoài site, đi kèm kết quả sao lưu. Bề mặt QUẢN TRỊ —
      // người bấm nút sao lưu là người có quyền sửa cấu hình lưu trữ.
      offsite = { skipped: false, error: err?.message ?? String(err) };
    }
  }

  return {
    skipped: false,
    fileName,
    filePath,
    fileSizeBytes: stat.size,
    sha256,
    fileCount: files.length,
    files: publicList,
    offsite,
  };
}

/**
 * Giải mã + giải nén 1 config bundle (restore/verify + test round-trip).
 * Ném lỗi nếu sai magic / sai key / ciphertext bị sửa (GCM auth fail).
 */
export function decryptConfigBundle(
  filePath: string,
  secret: string,
): { v: number; createdAt: string; files: Array<{ path: string; bytes: number; sha256: string; contentBase64: string }> } {
  const raw = fs.readFileSync(filePath);
  if (raw.length < CONFIG_BUNDLE_MAGIC.length + 12 + 16 + 1) {
    throw new Error("config bundle too short / corrupted");
  }
  if (!raw.subarray(0, CONFIG_BUNDLE_MAGIC.length).equals(CONFIG_BUNDLE_MAGIC)) {
    throw new Error("not a config bundle (bad magic)");
  }
  let off = CONFIG_BUNDLE_MAGIC.length;
  const iv = raw.subarray(off, off + 12); off += 12;
  const tag = raw.subarray(off, off + 16); off += 16;
  const ciphertext = raw.subarray(off);

  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveBundleKey(secret), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(plaintext).toString("utf8"));
}

// ─── Full DB dump via pg_dump ─────────────────────────────────────────────

export interface BackupResult {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  sha256: string;
  durationMs: number;
  tableCount: number;
  pgDumpVersion: string;
  method: "pg_dump" | "custom_json";
  offsite?: {
    skipped: boolean;
    target?: string;
    durationMs?: number;
    bytes?: number;
    error?: string;
    sha256?: string;
    mode?: "s3" | "offsite_dir";
    sseApplied?: string;
  };
  /** W0-I (doc 44 G5.8) — config/secrets bundle đi kèm (skip khi flag off) */
  configBundle?: ConfigBundleResult;
}

/** Gọi createConfigBundle mà không bao giờ làm fail backup chính. */
async function maybeCreateConfigBundle(label?: string): Promise<ConfigBundleResult> {
  try {
    return await createConfigBundle({ label });
  } catch (err: any) {
    console.warn("[Backup] config bundle failed (backup chính không bị ảnh hưởng):", err?.message ?? err);
    return { skipped: true, reason: `config bundle error: ${err?.message ?? String(err)}` };
  }
}

export async function createPgDump(opts: {
  databaseUrl: string;
  tables?: string[];        // specific tables; omit for full DB
  label?: string;
}): Promise<BackupResult> {
  ensureBackupDir();

  const { databaseUrl, tables, label } = opts;
  const conn = parseConnectionUrl(databaseUrl);
  const pgDump = findPgBin("pg_dump.exe") || findPgBin("pg_dump");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tag = label ? `_${label.replace(/[^a-z0-9]/gi, "_")}` : "";
  const sqlFileName = `backup${tag}_${ts}.sql`;
  const gzFileName = sqlFileName + ".gz";
  const sqlFilePath = path.join(BACKUP_DIR, sqlFileName);
  const gzFilePath = path.join(BACKUP_DIR, gzFileName);

  const t0 = Date.now();
  let pgDumpVersion = "unknown";

  try {
    // Get pg_dump version
    pgDumpVersion = await new Promise<string>((res, rej) =>
      execFile(pgDump, ["--version"], (err, stdout) => err ? rej(err) : res(stdout.trim()))
    );
  } catch {
    // pg_dump not available — fall through to custom JSON method
    return createCustomJsonBackup({ databaseUrl, tables, label });
  }

  const args = [
    "--host", conn.host,
    "--port", String(conn.port),
    "--username", conn.user,
    "--no-password",
    "--format", "plain",       // plain SQL for human readability
    "--encoding", "UTF8",
    "--verbose",
  ];

  if (tables && tables.length > 0) {
    for (const t of tables) {
      args.push("--table", t);
    }
  }
  args.push(conn.dbname);

  // Run pg_dump and pipe through gzip
  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: conn.password };
    const dump = spawn(pgDump, args, { env });
    const gz = zlib.createGzip({ level: 9 });
    const out = fs.createWriteStream(gzFilePath);

    dump.stdout.pipe(gz).pipe(out);

    const errors: string[] = [];
    dump.stderr.on("data", (d: Buffer) => {
      const line = d.toString();
      if (line.toLowerCase().includes("error")) errors.push(line);
    });

    out.on("finish", () => {
      if (errors.length > 0 && !fs.existsSync(gzFilePath)) {
        reject(new Error(`pg_dump errors: ${errors.slice(0, 3).join("; ")}`));
      } else {
        resolve();
      }
    });

    dump.on("close", (code) => {
      if (code !== 0 && !fs.existsSync(gzFilePath)) {
        reject(new Error(`pg_dump exited with code ${code}. Errors: ${errors.slice(0, 3).join("; ")}`));
      }
    });

    dump.on("error", reject);
  });

  const stat = fs.statSync(gzFilePath);
  const sha256 = await sha256File(gzFilePath);
  const tableCount = tables ? tables.length : Object.values(TABLE_CATEGORIES).flat().length;

  // Off-site replication (ISO 22301). No-op if neither AWS_S3_BACKUP_BUCKET
  // nor OFFSITE_BACKUP_DIR is configured. Failures are logged but do not
  // fail the primary backup — the local file is still trustworthy.
  let offsite: Awaited<ReturnType<typeof import("./backupReplicationService").replicateBackup>> | undefined;
  try {
    const { replicateBackup } = await import("./backupReplicationService");
    offsite = await replicateBackup(gzFilePath);
  } catch (err: any) {
    // data-raw-ok: như trên — trạng thái nhân bản ngoài site.
    offsite = { skipped: false, error: err?.message ?? String(err) };
  }

  // W0-I (doc 44 G5.8) — bundle .env + license keystore + CA keystore +
  // contracts/canonical (mã hoá AES-256-GCM, flag BACKUP_INCLUDE_SECRETS default off).
  const configBundle = await maybeCreateConfigBundle(label);

  return {
    fileName: gzFileName,
    filePath: gzFilePath,
    fileSizeBytes: stat.size,
    sha256,
    durationMs: Date.now() - t0,
    tableCount,
    pgDumpVersion,
    method: "pg_dump",
    offsite,
    configBundle,
  };
}

// ─── Custom JSON-lines backup (fallback when pg_dump unavailable) ─────────

async function createCustomJsonBackup(opts: {
  databaseUrl: string;
  tables?: string[];
  label?: string;
}): Promise<BackupResult> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(opts.databaseUrl, { max: 1 });
  const t0 = Date.now();

  const targetTables = opts.tables ?? Object.values(TABLE_CATEGORIES).flat();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tag = opts.label ? `_${opts.label.replace(/[^a-z0-9]/gi, "_")}` : "";
  const fileName = `backup${tag}_${ts}.jsonl.gz`;
  const filePath = path.join(BACKUP_DIR, fileName);

  const gz = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(filePath);
  gz.pipe(out);

  try {
    for (const table of targetTables) {
      try {
        const rows = await sql.unsafe(`SELECT * FROM "${table}" LIMIT 500000`);
        const header = JSON.stringify({ table, exportedAt: new Date().toISOString(), rowCount: rows.length });
        gz.write(header + "\n");
        for (const row of rows) {
          gz.write(JSON.stringify(row) + "\n");
        }
      } catch {
        gz.write(JSON.stringify({ table, error: "table_not_found" }) + "\n");
      }
    }
  } finally {
    await sql.end();
  }

  await new Promise<void>((res, rej) => { gz.end(); out.on("finish", res); out.on("error", rej); });

  const stat = fs.statSync(filePath);
  const sha256 = await sha256File(filePath);

  // Off-site replication (ISO 22301) — mirror pg_dump path behavior.
  let offsite: Awaited<ReturnType<typeof import("./backupReplicationService").replicateBackup>> | undefined;
  try {
    const { replicateBackup } = await import("./backupReplicationService");
    offsite = await replicateBackup(filePath);
  } catch (err: any) {
    // data-raw-ok: như trên — trạng thái nhân bản ngoài site.
    offsite = { skipped: false, error: err?.message ?? String(err) };
  }

  // W0-I (doc 44 G5.8) — config/secrets bundle (mirror pg_dump path).
  const configBundle = await maybeCreateConfigBundle(opts.label);

  return {
    fileName,
    filePath,
    fileSizeBytes: stat.size,
    sha256,
    durationMs: Date.now() - t0,
    tableCount: targetTables.length,
    pgDumpVersion: "custom_jsonl",
    method: "custom_json",
    offsite,
    configBundle,
  };
}

// ─── Restore from .sql.gz or .jsonl.gz backup ────────────────────────────

export interface RestoreResult {
  restoredTables: string[];
  durationMs: number;
  method: "pg_restore" | "custom_json";
  warnings: string[];
}

export async function restoreFromBackup(opts: {
  databaseUrl: string;
  filePath: string;
  tables?: string[];         // subset of tables to restore; null = all in file
}): Promise<RestoreResult> {
  const { databaseUrl, filePath, tables } = opts;
  const t0 = Date.now();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filePath}`);
  }

  if (filePath.endsWith(".sql.gz")) {
    return restoreFromSqlGz({ databaseUrl, filePath, tables, t0 });
  } else if (filePath.endsWith(".jsonl.gz")) {
    return restoreFromJsonlGz({ databaseUrl, filePath, tables, t0 });
  } else {
    throw new Error(`Unsupported backup format. Expected .sql.gz or .jsonl.gz, got: ${path.basename(filePath)}`);
  }
}

async function restoreFromSqlGz(opts: {
  databaseUrl: string; filePath: string; tables?: string[]; t0: number;
}): Promise<RestoreResult> {
  const conn = parseConnectionUrl(opts.databaseUrl);
  const psql = findPgBin("psql.exe") || findPgBin("psql");
  const warnings: string[] = [];

  const args = [
    "--host", conn.host,
    "--port", String(conn.port),
    "--username", conn.user,
    "--no-password",
    "--dbname", conn.dbname,
    "--single-transaction",
    "--set", "ON_ERROR_STOP=0",  // continue on errors (idempotent)
  ];

  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env, PGPASSWORD: conn.password };
    const gunzip = zlib.createGunzip();
    const psqlProc = spawn(psql, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const fileStream = fs.createReadStream(opts.filePath);

    fileStream.pipe(gunzip).pipe(psqlProc.stdin);

    psqlProc.stderr.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line) warnings.push(line);
    });

    psqlProc.on("close", (code) => {
      if (code !== 0) reject(new Error(`psql exited with code ${code}`));
      else resolve();
    });

    psqlProc.on("error", reject);
    fileStream.on("error", reject);
  });

  return {
    restoredTables: opts.tables ?? [],
    durationMs: Date.now() - opts.t0,
    method: "pg_restore",
    warnings: warnings.slice(0, 20),
  };
}

async function restoreFromJsonlGz(opts: {
  databaseUrl: string; filePath: string; tables?: string[]; t0: number;
}): Promise<RestoreResult> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(opts.databaseUrl, { max: 1 });
  const restoredTables: string[] = [];
  const warnings: string[] = [];
  const targetTables = new Set(opts.tables ?? []);
  let currentTable: string | null = null;
  let rows: any[] = [];

  const restoreTable = async (table: string, data: any[]) => {
    if (data.length === 0) return;
    try {
      // Chunk inserts to avoid huge statements
      const CHUNK = 500;
      for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        await sql.unsafe(
          `INSERT INTO "${table}" (${Object.keys(chunk[0]).map(k => `"${k}"`).join(",")})
           VALUES ${chunk.map(r => `(${Object.values(r).map(v => v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`).join(",")})`).join(",")}
           ON CONFLICT DO NOTHING`
        );
      }
      restoredTables.push(table);
    } catch (err: any) {
      warnings.push(`Table ${table}: ${err.message}`);
    }
  };

  const fileStream = fs.createReadStream(opts.filePath);
  const gunzip = zlib.createGunzip();
  let buffer = "";

  await new Promise<void>((resolve, reject) => {
    fileStream.pipe(gunzip);
    gunzip.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.table) {
            if (currentTable && rows.length > 0 && (targetTables.size === 0 || targetTables.has(currentTable))) {
              restoreTable(currentTable, rows).catch(e => warnings.push(e.message));
            }
            currentTable = obj.table;
            rows = [];
          } else if (currentTable) {
            rows.push(obj);
          }
        } catch { /* skip malformed lines */ }
      }
    });
    gunzip.on("end", () => {
      if (currentTable && rows.length > 0 && (targetTables.size === 0 || targetTables.has(currentTable))) {
        restoreTable(currentTable, rows).then(resolve).catch(reject);
      } else {
        resolve();
      }
    });
    gunzip.on("error", reject);
  });

  await sql.end();

  return {
    restoredTables,
    durationMs: Date.now() - opts.t0,
    method: "custom_json",
    warnings,
  };
}

// ─── List backup files on disk ─────────────────────────────────────────────

export function listBackupFiles(): Array<{
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  createdAt: Date;
}> {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".sql.gz") || f.endsWith(".jsonl.gz"))
    .map(f => {
      const fp = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fp);
      return { fileName: f, filePath: fp, fileSizeBytes: stat.size, createdAt: stat.birthtime };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function deleteBackupFile(fileName: string): void {
  const fp = path.join(BACKUP_DIR, path.basename(fileName)); // prevent path traversal
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

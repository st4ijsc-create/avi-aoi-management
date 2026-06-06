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
    offsite = { skipped: false, error: err?.message ?? String(err) };
  }

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
    offsite = { skipped: false, error: err?.message ?? String(err) };
  }

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

// Áp mig 0331 — bit `ai_repo_exec` cho engineer/admin. DML thuần idempotent, KHÔNG DDL
// ⇒ chạy được bằng cả `avi_app` lẫn `aoi`. Khuôn theo apply-migration-0330.mjs.
import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlText = readFileSync(join(__dirname, "../drizzle/0331_grant_ai_repo_exec_engineer.sql"), "utf8");

const devUrl = process.env.DATABASE_URL || readFileSync(join(__dirname, "../.env"), "utf8").match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
if (!devUrl) { console.error("[0331] DATABASE_URL not set"); process.exit(1); }

const args = process.argv.slice(2);
const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  const u = new URL(devUrl);
  u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
  targets.push([u.toString(), "test"]);
}

for (const [url, label] of targets) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const truoc = await sql`SELECT count(*)::int c FROM permissions WHERE "moduleName"='ai_repo_exec'`;
    await sql.unsafe(sqlText);
    const sau = await sql`SELECT count(*)::int c FROM permissions WHERE "moduleName"='ai_repo_exec'`;
    // Nghiệm thu tự vỡ: không lan sang vai khác, không tick ô sai.
    const lan = await sql`SELECT count(*)::int c FROM permissions p JOIN users u ON u.id=p."userId"
      WHERE p."moduleName"='ai_repo_exec' AND u.role NOT IN ('engineer','admin')`;
    const tick = await sql`SELECT count(*)::int c FROM permissions WHERE "moduleName"='ai_repo_exec'
      AND ("canView" OR "canEdit" OR "canDelete" OR "canExport")`;
    if (lan[0].c !== 0) throw new Error(`[0331] ${label}: cấp LAN sang ${lan[0].c} tài khoản không phải engineer/admin`);
    if (tick[0].c !== 0) throw new Error(`[0331] ${label}: ${tick[0].c} hàng tick ô KHÁC canCreate`);
    console.log(`[0331] ${label}: ${truoc[0].c} -> ${sau[0].c} hàng · lan=0 · tick-sai=0 · OK`);
  } catch (err) {
    console.error(`[0331] ${label}: FAILED —`, err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

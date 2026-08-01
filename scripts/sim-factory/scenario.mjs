// scripts/sim-factory/scenario.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 40 Wave 3B §13.4 — SCENARIO ENGINE (kịch bản phá hoại chạy lại được).
//
// Đọc YAML kịch bản → thực thi từng bước → kiểm tra tiêu chí pass/fail bằng cách
// ĐỌC DB (trạng thái quan sát được) + ra lệnh vào simulator control-plane. In kết
// quả PASS/FAIL từng bước + tổng kết. Bước cần thao tác NGOÀI (vd tắt DB) đánh dấu
// `manual:true` → runner in hướng dẫn + chờ, rồi kiểm tra tín hiệu quan sát được.
//
// Loại bước:
//   • sim:   { action, line, ... }        → POST simulator /control
//   • wait:  <giây>                        → chờ
//   • manual:{ prompt, waitSec }           → in hướng dẫn thủ công + chờ
//   • check: <kind> + expect + timeout     → poll DB tới khi đạt hoặc hết giờ
//       kinds: presence | downtime_open | telemetry_fresh | interlock_fired
//               | andon_raised | storeforward_depth
//   optional:true → bước quan sát (fail không tính vào tổng, chỉ WARN).
//
// Chạy:  npm run sim:scenario -- machine-down-10min      (một kịch bản)
//        npm run sim:scenario                             (chạy tất cả scenarios/*.yaml)
// ─────────────────────────────────────────────────────────────────────────────
import "./lib/env.mjs";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { makeSql, looksLikeSimDb, maskUrl } from "./lib/db.mjs";
import { machineCode } from "./topology.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SCEN_DIR = join(__dir, "scenarios");
const APP_BASE = process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const SIM_CONTROL = process.env.SIM_CONTROL_URL || `http://127.0.0.1:${process.env.SIM_CONTROL_PORT || 4899}`;
const STORE_FWD = process.env.INSPECTION_STORE_FORWARD_FILE || resolve(process.cwd(), "data/inspection-store-forward.jsonl");

// DB client tạo LAZY — đường guard (chưa reachable) không cần DB nên không mở kết nối.
let _sql = null;
function getSql() {
  if (!_sql) _sql = makeSql();
  return _sql;
}
async function endSql() {
  if (_sql) {
    try {
      await _sql.end({ timeout: 5 });
    } catch {
      /* ignore */
    }
    _sql = null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m", b: "\x1b[1m" };

// ── helpers ─────────────────────────────────────────────────────────────────
async function resolveMachineId(line, role) {
  const code = machineCode(`SIM-L${line}`, role);
  const rows = await getSql()`SELECT id FROM machines WHERE code = ${code} AND "isActive" = true LIMIT 1`;
  if (rows.length === 0) throw new Error(`không tìm thấy máy ${code} — đã chạy npm run sim:factory chưa?`);
  return rows[0].id;
}

async function simControl(body) {
  const r = await fetch(`${SIM_CONTROL}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`sim control lỗi: ${j.error || r.status}`);
  return j;
}

async function reachable(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function cmp(op, a, b) {
  switch (op) {
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
    case "eq": default: return a === b;
  }
}

// ── check evaluators (đọc DB) → { pass, detail } ─────────────────────────────
async function evalCheck(step) {
  const kind = step.check;
  switch (kind) {
    case "presence": {
      const mid = await resolveMachineId(step.line, step.role);
      const rows = await getSql()`SELECT status FROM machine_status_logs WHERE "machineId" = ${mid} ORDER BY "timestamp" DESC LIMIT 1`;
      const cur = rows[0]?.status ?? "(chưa có)";
      return { pass: cur === step.expect, detail: `presence=${cur} (mong ${step.expect})` };
    }
    case "downtime_open": {
      const mid = await resolveMachineId(step.line, step.role);
      const rows = await getSql()`SELECT id FROM downtime_events WHERE "machineId" = ${mid} AND "endTime" IS NULL LIMIT 1`;
      const open = rows.length > 0;
      return { pass: open === (step.expect === true || step.expect === "true"), detail: `downtime_open=${open} (mong ${step.expect})` };
    }
    case "telemetry_fresh": {
      const mid = await resolveMachineId(step.line, step.role);
      const maxAge = Number(step.maxAgeSec ?? 15);
      const rows = await getSql()`SELECT extract(epoch from (now() - max(ts))) AS age FROM ot_telemetry WHERE "machineId" = ${mid}`;
      const age = rows[0]?.age != null ? Number(rows[0].age) : null;
      const fresh = age != null && age <= maxAge;
      const want = step.expect === true || step.expect === "true";
      return { pass: fresh === want, detail: `telemetry age=${age == null ? "∅" : age.toFixed(1) + "s"} (<=${maxAge}s? ${fresh}, mong ${want})` };
    }
    case "interlock_fired": {
      const since = Number(step.sinceSec ?? 300);
      // Rule của scenario ng-spike theo tên (seed cố định).
      const ruleName = step.ruleName ?? "SIM NG-rate spike (L1 CONVEYOR)";
      const rows = await getSql()`
        SELECT count(*)::int AS c FROM interlock_events e
        JOIN interlock_rules r ON r.id = e."ruleId"
        WHERE r.name = ${ruleName} AND e."firedAt" >= now() - (${since} || ' seconds')::interval`;
      const c = rows[0]?.c ?? 0;
      return { pass: c > 0, detail: `interlock_events(${ruleName}) trong ${since}s = ${c}` };
    }
    case "andon_raised": {
      const since = Number(step.sinceSec ?? 300);
      let rows;
      if (step.line && step.role) {
        const mid = await resolveMachineId(step.line, step.role);
        rows = await getSql()`SELECT count(*)::int AS c FROM andon_events WHERE "machineId" = ${mid} AND "raisedAt" >= now() - (${since} || ' seconds')::interval`;
      } else if (step.line) {
        const lrows = await getSql()`SELECT id FROM production_lines WHERE code = ${"SIM-L" + step.line} AND "isActive" = true LIMIT 1`;
        const lid = lrows[0]?.id ?? -1;
        rows = await getSql()`SELECT count(*)::int AS c FROM andon_events WHERE "lineId" = ${lid} AND "raisedAt" >= now() - (${since} || ' seconds')::interval`;
      } else {
        rows = await getSql()`SELECT count(*)::int AS c FROM andon_events WHERE "raisedBySystem" = true AND "raisedAt" >= now() - (${since} || ' seconds')::interval`;
      }
      const c = rows[0]?.c ?? 0;
      return { pass: c > 0, detail: `andon_events(system) trong ${since}s = ${c}` };
    }
    case "storeforward_depth": {
      const op = step.op ?? "gt";
      const val = Number(step.value ?? 0);
      let depth = 0;
      if (existsSync(STORE_FWD)) {
        const txt = readFileSync(STORE_FWD, "utf8");
        depth = txt.split("\n").filter((l) => l.trim().length > 0).length;
      }
      return { pass: cmp(op, depth, val), detail: `store-forward depth=${depth} (${op} ${val}); file=${STORE_FWD}` };
    }
    default:
      return { pass: false, detail: `check không hỗ trợ: ${kind}` };
  }
}

async function runCheck(step) {
  const timeout = Number(step.timeout ?? 30) * 1000;
  const interval = Number(step.interval ?? 3) * 1000;
  const deadline = Date.now() + timeout;
  let last = { pass: false, detail: "(chưa chạy)" };
  // poll tới khi pass hoặc hết giờ
  // eslint-disable-next-line no-constant-condition
  while (true) {
    last = await evalCheck(step);
    if (last.pass) return last;
    if (Date.now() >= deadline) return last;
    await sleep(interval);
  }
}

// ── chạy một scenario ────────────────────────────────────────────────────────
async function runScenario(file) {
  const doc = YAML.parse(readFileSync(file, "utf8"));
  console.log(`\n${C.b}▶ SCENARIO: ${doc.name}${C.x}`);
  if (doc.description) console.log(`${C.d}  ${doc.description}${C.x}`);
  const results = [];
  let stepNo = 0;

  for (const step of doc.steps ?? []) {
    stepNo++;
    const label = step.name || `step ${stepNo}`;
    try {
      if (step.sim) {
        const out = await simControl(step.sim);
        console.log(`  ${C.g}✓${C.x} [sim] ${label} — ${out.note || out.action}`);
        results.push({ label, ok: true, kind: "sim" });
      } else if (step.wait != null) {
        process.stdout.write(`  ${C.d}… [wait] ${label} — chờ ${step.wait}s${C.x}\r`);
        await sleep(Number(step.wait) * 1000);
        console.log(`  ${C.d}· [wait] ${label} — ${step.wait}s xong${" ".repeat(20)}${C.x}`);
        results.push({ label, ok: true, kind: "wait" });
      } else if (step.manual) {
        console.log(`\n  ${C.y}⚠ [MANUAL] ${label}${C.x}`);
        console.log(`  ${C.y}${step.manual.prompt}${C.x}`);
        const w = Number(step.manual.waitSec ?? 30);
        console.log(`  ${C.d}(runner chờ ${w}s để bạn thao tác...)${C.x}`);
        await sleep(w * 1000);
        results.push({ label, ok: true, kind: "manual" });
      } else if (step.check) {
        const res = await runCheck(step);
        const optional = step.optional === true;
        const icon = res.pass ? `${C.g}✓${C.x}` : optional ? `${C.y}⚠${C.x}` : `${C.r}✗${C.x}`;
        console.log(`  ${icon} [check:${step.check}] ${label} — ${res.detail}`);
        results.push({ label, ok: res.pass, kind: "check", optional });
      } else {
        console.log(`  ${C.y}? [skip] ${label} — bước không rõ loại${C.x}`);
      }
    } catch (e) {
      console.log(`  ${C.r}✗${C.x} [${label}] LỖI: ${e?.message ?? e}`);
      results.push({ label, ok: false, kind: "error", optional: step.optional === true });
    }
  }

  // teardown (luôn chạy để trả simulator về trạng thái sạch)
  for (const t of doc.teardown ?? []) {
    try {
      if (t.sim) await simControl(t.sim);
    } catch (e) {
      console.log(`  ${C.d}(teardown lỗi: ${e?.message ?? e})${C.x}`);
    }
  }

  const hard = results.filter((r) => !r.optional);
  const failed = hard.filter((r) => !r.ok);
  const warned = results.filter((r) => r.optional && !r.ok);
  const verdict = failed.length === 0;
  console.log(
    `  ${verdict ? C.g + "PASS" : C.r + "FAIL"}${C.x} — ${hard.length - failed.length}/${hard.length} bắt buộc đạt` +
      (warned.length ? `, ${C.y}${warned.length} quan sát chưa đạt (WARN)${C.x}` : ""),
  );
  return { name: doc.name, pass: verdict, failed: failed.length, warned: warned.length };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2];

  if (!looksLikeSimDb(process.env.DATABASE_URL || "")) {
    console.warn(`${C.y}[scenario] CẢNH BÁO: DATABASE_URL không chứa 'sim' (${maskUrl(process.env.DATABASE_URL || "")}). Đảm bảo bạn đang trỏ DB _sim.${C.x}`);
  }

  // Kiểm tra reachability trước khi chạy.
  const appOk = await reachable(`${APP_BASE}/health`);
  const simOk = await reachable(`${SIM_CONTROL}/health`);
  console.log(`[scenario] app ${APP_BASE} → ${appOk ? C.g + "OK" : C.r + "KHÔNG REACHABLE"}${C.x}`);
  console.log(`[scenario] sim ${SIM_CONTROL} → ${simOk ? C.g + "OK" : C.r + "KHÔNG REACHABLE"}${C.x}`);
  if (!appOk || !simOk) {
    console.error(
      `\n${C.r}[scenario] DỪNG:${C.x} cần CẢ server (.env.sim) LẪN simulator đang chạy.\n` +
        "  1) Server:    DOTENV_CONFIG_PATH=.env.sim NODE_ENV=development npx tsx watch server/_core/index.ts\n" +
        "  2) Simulator: node scripts/sim-factory/simulator.mjs\n" +
        "  Xem scripts/sim-factory/README.md.",
    );
    await endSql();
    process.exitCode = 1;
    return;
  }

  // Chọn file(s).
  let files;
  if (arg) {
    const p = arg.endsWith(".yaml") || arg.endsWith(".yml") ? resolve(arg) : join(SCEN_DIR, `${arg}.yaml`);
    if (!existsSync(p)) {
      console.error(`[scenario] không thấy kịch bản: ${p}`);
      console.error(`  có sẵn: ${readdirSync(SCEN_DIR).filter((f) => f.endsWith(".yaml")).join(", ")}`);
      await endSql();
      process.exitCode = 1;
      return;
    }
    files = [p];
  } else {
    files = readdirSync(SCEN_DIR)
      .filter((f) => f.endsWith(".yaml"))
      .sort()
      .map((f) => join(SCEN_DIR, f));
    console.log(`[scenario] chạy TẤT CẢ ${files.length} kịch bản (truyền tên để chạy 1).`);
  }

  const summary = [];
  for (const f of files) summary.push(await runScenario(f));

  console.log(`\n${C.b}══ TỔNG KẾT ══${C.x}`);
  for (const s of summary) {
    console.log(`  ${s.pass ? C.g + "PASS" : C.r + "FAIL"}${C.x}  ${s.name}${s.warned ? C.y + `  (${s.warned} WARN)` + C.x : ""}`);
  }
  const anyFail = summary.some((s) => !s.pass);
  await endSql();
  process.exitCode = anyFail ? 1 : 0;
}

main().catch(async (e) => {
  console.error("[scenario] LỖI:", e);
  await endSql();
  process.exitCode = 1;
});

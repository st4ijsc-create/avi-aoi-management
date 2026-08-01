#!/usr/bin/env node
/**
 * Doc 51 P0 (QĐ#1) — MACHINE KEY ROTATION REPORT
 *
 * Trả lời ĐÚNG MỘT câu hỏi, trước khi ai đó siết cờ auth máy:
 *
 *     "Máy nào CÒN dùng đường yếu (shared plaintext key / machineCode-only) và
 *      sẽ CHẾT khi tôi đặt MACHINE_SHARED_KEY_ALLOWED / MACHINE_CODE_ONLY_ALLOWED
 *      = deny ở production?"
 *
 * Runbook: docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md
 *
 * Cách dùng:
 *   node scripts/machine-key-rotation-report.mjs
 *   node scripts/machine-key-rotation-report.mjs --json           (máy đọc / CI)
 *   node scripts/machine-key-rotation-report.mjs --active-days=14 (cửa sổ "còn chạy")
 *   node scripts/machine-key-rotation-report.mjs --all            (in cả máy IDLE/OK)
 *   DATABASE_URL=postgresql://... node scripts/machine-key-rotation-report.mjs
 *
 * Exit code:  0 = an toàn để flip (không máy nào BLOCKING) · 1 = còn máy phải rotate
 *             2 = lỗi (không nối được DB / thiếu migration 0178)
 *
 * ── PHƯƠNG PHÁP SUY LUẬN (đọc kỹ — báo cáo này là SUY LUẬN, không phải nhật ký) ──
 * Server KHÔNG ghi "phương thức auth" xuống DB (đó là bảng mới = migration = ngoài
 * phạm vi P0). Script chỉ đọc những gì DB đã có, và suy luận:
 *
 *   • `api_keys.lastUsedAt`  — CHỈ được bump khi máy xác thực bằng khoá `mk_`
 *     (machineAuthService.touchLastUsed, throttle ≤1 lần/60s).
 *   • `machines.lastHeartbeat` — được bump ở HẦU HẾT đường máy (submitInspection,
 *     getPoints, heartbeat…) BẤT KỂ phương thức auth.
 *
 *   ⇒ heartbeat MỚI HƠN lastUsedAt (quá dung sai) ⇒ traffic đó KHÔNG đi bằng mk_
 *     ⇒ máy còn bám đường yếu.
 *
 * Giới hạn đã biết (nói thẳng, đừng tin mù):
 *   • Throttle 60s + lệch đồng hồ ⇒ dùng dung sai --tolerance-min (mặc định 5).
 *   • Máy vừa rotate xong nhưng chưa gửi request nào ⇒ KEY_UNUSED (đúng: chưa
 *     chứng minh được là máy đã nhận khoá).
 *   • Không phân biệt được shared-key vs machineCode-only — DB không đủ dữ kiện.
 *     Muốn chính xác 100% theo từng đường + từng endpoint: xem telemetry LIVE
 *     `getWeakAuthUsage()` trong tiến trình server (doc 52 §3 bước 3).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Parse arguments ──────────────────────────────────────────
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const SHOW_ALL = args.includes('--all');

function numArg(name, dflt) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
// Máy có heartbeat trong N ngày qua = "còn chạy" → nếu còn đường yếu thì flip = CHẾT MÁY.
const ACTIVE_DAYS = numArg('active-days', 7);
// Dung sai heartbeat-vs-lastUsedAt (phút) — bù throttle 60s + lệch đồng hồ.
const TOLERANCE_MIN = numArg('tolerance-min', 5);

// ─── Load .env (cùng parser với migrate-standalone.mjs) ───────
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), '.env'));
loadEnvFile(path.join(__dirname, '..', '.env'));

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set (đặt trong .env hoặc biến môi trường).');
  process.exit(2);
}

// ─── Import postgres driver ──────────────────────────────────
let postgres;
try {
  const pg = await import('postgres');
  postgres = pg.default;
} catch (e) {
  console.error('ERROR: Cannot import "postgres" driver — chạy `npm install` trước.');
  console.error('       Error:', e.message);
  process.exit(2);
}

const needsSsl = DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('ssl=true');
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

// ═══════════════════════════════════════════════════════════════
// Thu thập dữ liệu
// ═══════════════════════════════════════════════════════════════

let machines;
let keys;
try {
  // Migration 0178 thêm api_keys.machineId + revokedAt. Thiếu = báo rõ, không đoán.
  const [{ hasMachineId }] = await sql`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns
       WHERE table_name = 'api_keys' AND column_name = 'machineId'
    ) AS "hasMachineId"
  `;
  if (!hasMachineId) {
    console.error('ERROR: api_keys."machineId" không tồn tại — migration 0178 chưa áp.');
    console.error('       Chạy `npm run db:push` rồi thử lại.');
    await sql.end();
    process.exit(2);
  }

  machines = await sql`
    SELECT id, code, name, "machineType", "isActive", "lifecycleStatus",
           "registrationStatus", "lastHeartbeat",
           ("apiKey" IS NOT NULL AND "apiKey" <> '') AS "hasSharedKey"
      FROM machines
     ORDER BY code
  `;

  keys = await sql`
    SELECT id, "machineId", "keyPrefix", scopes, "isActive", "revokedAt",
           "expiresAt", "lastUsedAt", "createdAt"
      FROM api_keys
     WHERE "machineId" IS NOT NULL
     ORDER BY "createdAt" DESC
  `;
} catch (e) {
  console.error('ERROR: truy vấn DB thất bại:', e.message);
  await sql.end();
  process.exit(2);
}

await sql.end();

// ═══════════════════════════════════════════════════════════════
// Phân loại
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();
const ACTIVE_MS = ACTIVE_DAYS * 86400_000;
const TOLERANCE_MS = TOLERANCE_MIN * 60_000;

const ms = (d) => (d ? new Date(d).getTime() : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Khoá còn hiệu lực THẬT SỰ = đúng thứ tự authenticateMachine kiểm tra. */
function keyUsable(k) {
  if (!k.isActive || k.revokedAt) return false;
  if (k.expiresAt && ms(k.expiresAt) < NOW) return false;
  return true;
}

const keysByMachine = new Map();
for (const k of keys) {
  if (!keysByMachine.has(k.machineId)) keysByMachine.set(k.machineId, []);
  keysByMachine.get(k.machineId).push(k);
}

/**
 * VERDICT:
 *   BLOCKING  — máy còn chạy + còn đường yếu ⇒ flip cờ = CHẾT MÁY. Rotate trước.
 *   WARN      — nghi ngờ / cần dọn, không chặn flip.
 *   OK        — đã chứng minh dùng mk_.
 *   IDLE      — không có traffic trong cửa sổ ⇒ flip không ảnh hưởng NGAY.
 */
const rows = machines.map((m) => {
  const mKeys = keysByMachine.get(m.id) ?? [];
  const usable = mKeys.filter(keyUsable);
  const lastUsed = usable.reduce((acc, k) => Math.max(acc, ms(k.lastUsedAt) ?? 0), 0) || null;
  const heartbeat = ms(m.lastHeartbeat);
  const recentTraffic = heartbeat != null && NOW - heartbeat <= ACTIVE_MS;
  const retired = m.lifecycleStatus === 'retired' || m.lifecycleStatus === 'decommissioned';

  let verdict, state, action;

  if (retired) {
    // Doc 51 §5.1: retire KHÔNG thu hồi key — máy "đã loại" vẫn ingest được.
    verdict = m.hasSharedKey || usable.length > 0 ? 'WARN' : 'OK';
    state = 'RETIRED_WITH_CREDS';
    action = verdict === 'WARN'
      ? 'Máy đã retired nhưng CÒN credential — revoke key + clear machines.apiKey'
      : 'Đã retired, không còn credential';
  } else if (usable.length === 0) {
    state = 'NO_MK_KEY';
    verdict = recentTraffic ? 'BLOCKING' : 'IDLE';
    action = recentTraffic
      ? 'CHƯA có khoá mk_ mà VẪN đang gửi ⇒ flip là chết. machineApi.issueKey NGAY.'
      : 'Chưa có khoá mk_, nhưng không có traffic gần đây (kiểm tra máy còn dùng không).';
  } else if (lastUsed == null) {
    state = 'KEY_ISSUED_NEVER_USED';
    verdict = recentTraffic ? 'BLOCKING' : 'WARN';
    action = recentTraffic
      ? 'Đã cấp khoá mk_ nhưng máy CHƯA hề dùng ⇒ máy chưa được cấu hình lại. Nạp khoá vào máy.'
      : 'Đã cấp khoá mk_ nhưng chưa dùng lần nào; máy đang im.';
  } else if (heartbeat != null && heartbeat - lastUsed > TOLERANCE_MS) {
    state = 'MIXED_WEAK_TRAFFIC';
    verdict = recentTraffic ? 'BLOCKING' : 'WARN';
    action = `Có khoá mk_ nhưng heartbeat mới hơn lastUsedAt ${Math.round((heartbeat - lastUsed) / 60000)} phút ` +
             '⇒ traffic vẫn đi đường yếu. Sửa cấu hình máy (header Bearer/X-API-Key).';
  } else {
    state = 'MK_KEY_ACTIVE';
    verdict = recentTraffic ? 'OK' : 'IDLE';
    action = m.hasSharedKey
      ? 'Đang dùng mk_ ✓ — dọn nốt machines.apiKey (shared key plaintext còn sót).'
      : 'Đang dùng mk_ ✓';
  }

  return {
    machineId: m.id,
    code: m.code,
    name: m.name,
    machineType: m.machineType,
    isActive: m.isActive,
    lifecycleStatus: m.lifecycleStatus,
    registrationStatus: m.registrationStatus,
    hasSharedPlaintextKey: m.hasSharedKey,
    mkKeysUsable: usable.length,
    mkKeysTotal: mKeys.length,
    keyPrefixes: usable.map((k) => k.keyPrefix).filter(Boolean),
    lastHeartbeatAt: iso(m.lastHeartbeat),
    lastMkKeyUseAt: iso(lastUsed),
    recentTraffic,
    state,
    verdict,
    action,
  };
});

const blocking = rows.filter((r) => r.verdict === 'BLOCKING');
const warn = rows.filter((r) => r.verdict === 'WARN');
const ok = rows.filter((r) => r.verdict === 'OK');
const idle = rows.filter((r) => r.verdict === 'IDLE');
const sharedLeft = rows.filter((r) => r.hasSharedPlaintextKey);

const summary = {
  generatedAt: new Date().toISOString(),
  params: { activeDays: ACTIVE_DAYS, toleranceMinutes: TOLERANCE_MIN },
  totals: {
    machines: rows.length,
    blocking: blocking.length,
    warn: warn.length,
    ok: ok.length,
    idle: idle.length,
    sharedPlaintextKeyStillSet: sharedLeft.length,
  },
  safeToFlip: blocking.length === 0,
};

// ═══════════════════════════════════════════════════════════════
// Xuất
// ═══════════════════════════════════════════════════════════════

if (JSON_OUT) {
  console.log(JSON.stringify({ ...summary, machines: rows }, null, 2));
  process.exit(blocking.length > 0 ? 1 : 0);
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const ago = (isoStr) => {
  if (!isoStr) return 'never';
  const mins = Math.round((NOW - new Date(isoStr).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

console.log('');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  MACHINE KEY ROTATION REPORT — doc 51 P0 (QĐ#1)');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log(`  Database:     ${DATABASE_URL.replace(/:([^@:]+)@/, ':****@')}`);
console.log(`  Cửa sổ "còn chạy": heartbeat ≤ ${ACTIVE_DAYS} ngày · dung sai ${TOLERANCE_MIN} phút`);
console.log(`  Máy: ${rows.length}  ·  BLOCKING: ${blocking.length}  ·  WARN: ${warn.length}  ·  OK: ${ok.length}  ·  IDLE: ${idle.length}`);
console.log('══════════════════════════════════════════════════════════════════════════════');

const shown = SHOW_ALL ? rows : [...blocking, ...warn];
if (shown.length === 0) {
  console.log('\n  Không có máy nào cần rotate. (Dùng --all để xem toàn bộ.)');
} else {
  console.log('');
  console.log(`  ${pad('VERDICT', 9)}${pad('MACHINE', 22)}${pad('STATE', 24)}${pad('mk_', 5)}${pad('SHARED', 7)}${pad('HEARTBEAT', 11)}${'mk_ LAST USE'}`);
  console.log('  ' + '─'.repeat(88));
  for (const r of shown) {
    console.log(
      '  ' +
      pad(r.verdict, 9) +
      pad(r.code, 22) +
      pad(r.state, 24) +
      pad(r.mkKeysUsable, 5) +
      pad(r.hasSharedPlaintextKey ? 'yes' : '-', 7) +
      pad(ago(r.lastHeartbeatAt), 11) +
      ago(r.lastMkKeyUseAt),
    );
  }
}

if (blocking.length > 0) {
  console.log('');
  console.log('  ── PHẢI XỬ LÝ TRƯỚC KHI FLIP CỜ ──────────────────────────────────────────');
  for (const r of blocking) console.log(`  ✗ ${r.code}: ${r.action}`);
}
if (warn.length > 0) {
  console.log('');
  console.log('  ── CẢNH BÁO (không chặn flip, nhưng nên dọn) ─────────────────────────────');
  for (const r of warn) console.log(`  ! ${r.code}: ${r.action}`);
}

console.log('');
console.log('══════════════════════════════════════════════════════════════════════════════');
if (blocking.length === 0) {
  console.log('  ✓ AN TOÀN ĐỂ FLIP: không máy nào đang chạy còn bám đường yếu.');
  console.log('    Bước kế: xác nhận telemetry LIVE sạch (getWeakAuthUsage / metric');
  console.log('    avi_aoi_security_events_total{type="machine_weak_auth_allowed"} = 0 suốt ≥1 ca),');
  console.log('    rồi đặt MACHINE_SHARED_KEY_ALLOWED=deny + MACHINE_CODE_ONLY_ALLOWED=deny.');
} else {
  console.log(`  ✗ CHƯA ĐƯỢC FLIP: ${blocking.length} máy đang chạy sẽ chết (401) nếu siết cờ bây giờ.`);
  console.log('    Rotate từng máy: machineApi.issueKey → nạp khoá vào máy (header');
  console.log('    Authorization: Bearer <mk_...>) → chạy lại báo cáo này.');
}
if (sharedLeft.length > 0) {
  console.log(`  · ${sharedLeft.length} máy còn machines.apiKey plaintext — dọn SAU khi flip xong.`);
}
console.log('  Runbook: docs/ECOSYSTEM/52_P0_MACHINE_AUTH_ROTATION_RUNBOOK.md');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('');

process.exit(blocking.length > 0 ? 1 : 0);

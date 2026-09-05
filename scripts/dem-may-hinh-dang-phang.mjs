#!/usr/bin/env node
/**
 * ★★★ Lô 3 Mục 1 (BG-57a) — ĐIỀU KIỆN TIÊN QUYẾT của BG-57 (bật
 * `INGEST_REJECT_LEGACY_MACHINE_ENABLED`): trả lời được câu "MÁY NÀO còn gửi
 * hình dạng PHẲNG (v1.x/v1.1) hôm nay, và bao nhiêu lượt?" TỪ MÃ — không đoán,
 * không hỏi vận hành.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NGUỒN SỐ: `audit_logs`, hai action đã ghi sẵn từ BG-89 (Task 1, machineApiRouters.ts)
 * ══════════════════════════════════════════════════════════════════════════
 * `ghiTinHieuHinhDangIngest` (machineApiRouters.ts, gọi NGAY SAU `authenticateMachine`
 * thành công trong thân `submitInspection`/`submitInspectionBatch`) ghi MỘT hàng
 * `audit_logs` cho MỖI lượt ingest ĐÃ XÁC THỰC:
 *   - action = 'ingest_shape_legacy'  ⇒ payload PHẲNG (v1.x/v1.1, `measurements[]`)
 *   - action = 'ingest_shape_v2'      ⇒ payload CÂY (v2.0, `surfaces[]`)
 *   - entityType = 'machine', entityId = machines.id (FK THẬT), entityName = machines.code
 *     — CẢ HAI đọc từ máy ĐÃ XÁC THỰC, KHÔNG PHẢI lời tự khai (đóng lỗ I-4, xem docblock
 *     `ghiTinHieuHinhDangIngest`) ⇒ số đếm dưới đây KHÔNG giả mạo được bằng credential giả.
 *
 * Script này KHÔNG đọc/suy đoán gì khác — nó CHỈ GROUP BY trên hai action đó, trong
 * một cửa sổ thời gian, theo `entityId`/`entityName`.
 *
 * ── ĐÃ ĐO TRƯỚC (theo yêu cầu brief Mục 1) — cột nào giữ machine id/code ─────
 * `drizzle/schema/system.ts` — bảng `audit_logs`: `entityId: integer` (FK, không ràng buộc
 * cứng ở DB nhưng `ghiTinHieuHinhDangIngest` LUÔN gán `may.id`), `entityName: varchar(255)`
 * (LUÔN gán `may.code` — xem `auditTrailService.ts` AUDIT_ACTIONS.INGEST_SHAPE_LEGACY/_V2 và
 * `machineApiRouters.ts:~3490`). `createdAt: timestamp` — mốc ghi tín hiệu.
 *
 * ⚠ GIỚI HẠN ĐÃ BIẾT (nói thẳng): tín hiệu chỉ tồn tại cho lượt ĐÃ XÁC THỰC THÀNH CÔNG
 * VÀ cờ CẮT máy cũ đang TẮT lúc ingest đó chạy (§C `dangKyTinHieuHinhDangIngestBg89.test.ts`
 * — khi cờ BẬT, `loiMayChuaNangCap` ném TRƯỚC xác thực, không đếm). Script này ĐANG được
 * chạy CHÍNH XÁC để trả lời câu hỏi đó TRƯỚC KHI bật cờ — tại thời điểm đo, cờ mặc định
 * TẮT nên phép đếm phản ánh ĐÚNG lưu lượng thật đang chạy.
 *
 * Cách dùng:
 *   node scripts/dem-may-hinh-dang-phang.mjs                     (14 ngày, DB mặc định .env)
 *   node scripts/dem-may-hinh-dang-phang.mjs --days=30
 *   node scripts/dem-may-hinh-dang-phang.mjs --db="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management"
 *   node scripts/dem-may-hinh-dang-phang.mjs --db=... --days=7
 *
 * Đây là CÔNG CỤ ĐO, không phải cổng chặn CI — luôn exit 0 (kể cả 0 máy phẳng, kể cả lỗi
 * kết nối được báo rõ trên stderr thì vẫn exit 0, đúng brief "không phải một cổng").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Parse arguments ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function numArg(name, dflt) {
  const raw = argVal(name);
  if (raw === null) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
const DAYS = numArg("days", 14);

// ─── Load .env (cùng parser với các script scripts/*.mjs khác trong repo) ──
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(__dirname, "..", ".env"));

const DATABASE_URL = argVal("db") ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: thiếu --db=<postgres url> (hoặc DATABASE_URL trong .env).");
  process.exit(0); // công cụ đo, không phải cổng — báo lỗi rõ trên stderr rồi thoát sạch
}

let postgres;
try {
  const pg = await import("postgres");
  postgres = pg.default;
} catch (e) {
  console.error('ERROR: không import được driver "postgres" — chạy `npm install` trước.');
  console.error("       Error:", e.message);
  process.exit(0);
}

const needsSsl = DATABASE_URL.includes("sslmode=require") || DATABASE_URL.includes("ssl=true");
const sql = postgres(DATABASE_URL, {
  ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  connect_timeout: 30,
  max: 1,
});

async function main() {
  let tenDb;
  try {
    [{ db: tenDb }] = await sql`SELECT current_database() AS db`;
  } catch (e) {
    console.error("ERROR: không nối được DB:", e.message);
    return;
  }

  console.log("");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("  BG-57a — MÁY NÀO CÒN GỬI HÌNH DẠNG PHẲNG (v1.x/v1.1)?");
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(`  current_database() = ${tenDb}`);
  console.log(`  Cửa sổ: ${DAYS} ngày gần nhất (tính từ lúc chạy script)`);
  console.log("  Nguồn: audit_logs.action IN ('ingest_shape_legacy','ingest_shape_v2')");
  console.log("══════════════════════════════════════════════════════════════════════════════");

  // ── Kiểm tra tín hiệu BG-89 có tồn tại hàng nào không (khác "0 máy phẳng" —
  // "0 hàng CẢ HAI action" nghĩa là BG-89 chưa từng chạy qua lượt ingest thật nào
  // trong cửa sổ này, KHÁC hẳn "mọi máy đều đã lên v2.0").
  const [{ tongCoTinHieu }] = await sql`
    SELECT COUNT(*)::int AS "tongCoTinHieu"
      FROM audit_logs
     WHERE action IN ('ingest_shape_legacy', 'ingest_shape_v2')
  `;

  // ── GROUP BY máy (entityId/entityName), trong cửa sổ --days, đếm riêng từng
  // hình dạng + lượt cuối cùng của hình dạng LEGACY (to_char — đọc chuỗi, KHÔNG
  // để postgres-js tự parse timestamp về Date theo TZ máy chạy script, bẫy đã
  // biết trong brief).
  const rows = await sql`
    SELECT
      "entityId"                                                        AS machine_id,
      "entityName"                                                      AS machine_code,
      COUNT(*) FILTER (WHERE action = 'ingest_shape_legacy')::int       AS legacy_count,
      COUNT(*) FILTER (WHERE action = 'ingest_shape_v2')::int           AS v2_count,
      to_char(
        MAX("createdAt") FILTER (WHERE action = 'ingest_shape_legacy'),
        'YYYY-MM-DD HH24:MI:SS'
      )                                                                  AS last_legacy_at
    FROM audit_logs
    WHERE action IN ('ingest_shape_legacy', 'ingest_shape_v2')
      AND "createdAt" >= NOW() - (${DAYS} || ' days')::interval
    GROUP BY "entityId", "entityName"
    ORDER BY legacy_count DESC, v2_count DESC, machine_code ASC
  `;

  // ── Tổng đối chiếu — TÁCH RIÊNG khỏi vòng GROUP BY ở trên, cùng cửa sổ, để
  // một lỗi group-by (vd trùng entityName giữa hai entityId) không tự che giấu
  // qua phép cộng các dòng đã in.
  const [{ tongLegacy, tongV2 }] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE action = 'ingest_shape_legacy')::int AS "tongLegacy",
      COUNT(*) FILTER (WHERE action = 'ingest_shape_v2')::int     AS "tongV2"
    FROM audit_logs
    WHERE action IN ('ingest_shape_legacy', 'ingest_shape_v2')
      AND "createdAt" >= NOW() - (${DAYS} || ' days')::interval
  `;

  if (tongCoTinHieu === 0) {
    console.log("");
    console.log(
      `  [current_database=${tenDb}] 0 hàng tín hiệu BG-89 trong TOÀN BỘ audit_logs (không chỉ` +
        ` cửa sổ ${DAYS} ngày) — hoặc DB này chưa từng nhận lượt ingest THẬT nào qua submitInspection` +
        "/submitInspectionBatch kể từ khi BG-89 triển khai, hoặc đang trỏ nhầm DB. KHÔNG đọc thành" +
        ' "0 máy phẳng" — đọc thành "chưa đo được gì ở đây".',
    );
  }

  if (rows.length === 0) {
    console.log("");
    console.log(
      `  [current_database=${tenDb}] 0 máy có tín hiệu ingest trong ${DAYS} ngày qua` +
        (tongCoTinHieu > 0 ? " (có tín hiệu cũ hơn cửa sổ này — thử --days lớn hơn)." : "."),
    );
  } else {
    const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);
    console.log("");
    console.log(
      `  ${pad("MACHINE_CODE", 28)}${pad("LEGACY", 8)}${pad("V2", 8)}${"LƯỢT LEGACY CUỐI (UTC, to_char)"}`,
    );
    console.log("  " + "─".repeat(80));
    for (const r of rows) {
      console.log(
        "  " +
          pad(r.machine_code ?? `(id=${r.machine_id})`, 28) +
          pad(r.legacy_count, 8) +
          pad(r.v2_count, 8) +
          (r.last_legacy_at ?? "—"),
      );
    }
  }

  const soMayConLegacy = rows.filter((r) => r.legacy_count > 0).length;

  console.log("");
  console.log("  ── TỔNG ĐỐI CHIẾU (đếm riêng, không suy từ bảng trên) ──────────────────────");
  console.log(`  [current_database=${tenDb}] tổng ingest_shape_legacy (${DAYS}d) = ${tongLegacy}`);
  console.log(`  [current_database=${tenDb}] tổng ingest_shape_v2     (${DAYS}d) = ${tongV2}`);
  console.log(`  [current_database=${tenDb}] số máy CÒN gửi legacy trong cửa sổ = ${soMayConLegacy}`);
  const tongTuBang = rows.reduce((acc, r) => acc + r.legacy_count + r.v2_count, 0);
  console.log(
    `  [current_database=${tenDb}] đối chiếu: tổng GROUP BY = ${tongTuBang} ` +
      `${tongTuBang === tongLegacy + tongV2 ? "== " : "!= "}tổng đếm riêng = ${tongLegacy + tongV2}`,
  );
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log(
    "  Điều kiện tiên quyết BG-57 trước khi bật INGEST_REJECT_LEGACY_MACHINE_ENABLED:",
  );
  console.log(
    soMayConLegacy > 0
      ? `  ✗ CÒN ${soMayConLegacy} máy đang gửi hình dạng phẳng — bật cờ HÔM NAY sẽ chặn các máy này.`
      : "  ✓ 0 máy còn gửi hình dạng phẳng trong cửa sổ đo — không có nghĩa là AN TOÀN VĨNH VIỄN,",
  );
  if (soMayConLegacy === 0) {
    console.log("    chỉ nghĩa là không thấy trong cửa sổ NÀY (thử --days lớn hơn trước khi kết luận).");
  }
  console.log("══════════════════════════════════════════════════════════════════════════════");
  console.log("");
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(0);

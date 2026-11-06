#!/usr/bin/env node
/**
 * Pha 0 · AL0-3 + T0-4 — ĐẾM + XOÁ dữ liệu lũ / dữ liệu cũ, MỘT mục mỗi lần, trong MỘT giao dịch. KHÔNG tự chạy; dieu-phoi chạy sau khi
 * chủ dự án duyệt số đếm. Cùng khuôn `scripts/pha0/xoa-du-lieu.mjs` (tho-ca-agent, E0-1 / F0-1 / Q0-5) — tệp riêng để hai nhánh không đụng nhau.
 *
 *   DATABASE_URL=... node scripts/pha0/xoa-du-lieu-al0-t0.mjs --item <MỤC> --db <current_database mong đợi>
 *        [--chi-dem (mặc định) | --test-only | --commit --expect-n <N>]
 *   MỤC: AL0-3a notifications · AL0-3b alert_escalations · AL0-3c predictive_alerts (+ predictive_alert_occurrences theo FK CASCADE)
 *        · AL0-3d mqtt_alert_history · T0-4a machine_health_history · T0-4b rul_estimates
 *
 * Luật cứng (như tệp gốc):
 *   - Mặc định `--chi-dem`: giao dịch `READ ONLY` — chỉ SELECT (đếm, kích thước, canh, phụ thuộc FK), KHÔNG một DELETE nào được gửi.
 *   - `--test-only`: chạy đủ (đếm, xoá, đếm sau) rồi ROLLBACK — in đúng số sẽ xoá. Chỉ nên dùng trên `_test`.
 *   - `--commit` đòi `--expect-n` = số `sap_xoa` của lần chạy ngay trước (lệch ⇒ ROLLBACK) và `--db` khớp `current_database()` (Đ-28).
 *   - Mỗi mục có điều kiện canh đo TRƯỚC khi xoá; sai ⇒ dừng, không xoá. Mọi bảng có FK trỏ vào bảng xoá được ĐẾM (CASCADE xoá theo).
 *   - Chỉ DELETE đúng điều kiện của mục (không TRUNCATE / DROP). Vai do người chạy cấp qua DATABASE_URL (script không đọc .env).
 *
 * MỐC CỐ ĐỊNH cho bốn mục AL0-3: hàng tạo TRƯỚC 2026-11-04 00:00 (giờ ghi naive của cột) — số chủ dự án duyệt là ảnh chụp tới mốc đó;
 * thông báo / cảnh báo MỚI sau mốc (thật, nếu có) không bị xoá. T0-4: cũ hơn 90 ngày tính lúc chạy (so cột naive với now() — lệch múi giờ
 * ≤ 7 h, không đáng kể ở cửa sổ 90 ngày).
 *
 * Căn cứ (TechDocs): 40-alarm §1 bảng hiện trạng (56 433 thông báo 100 % chưa đọc, 53 416 một tiêu đề "CRITICAL Alert: DEFECT SPIKE"; 7 779
 * leo thang notifiedUserIds = [] toàn bộ; 992 predictive_alerts EXPIRED 992/992; 3 183 mqtt_alert_history notificationSent=false toàn bộ),
 * §7 QĐ2 + §2 QĐ10 "xoá, không di trú"; 30-telemetry T0-4 (machine_health_history + rul_estimates 1,8 GB, retention 90 d, sau duyệt).
 * `machine_status_logs` KHÔNG có ở đây: `services/oeeService.ts` (Availability = getMachineUptimeStats ← machine_status_logs) và
 * `productionDashboardRouter.ts` (time utilization) ĐỌC bảng đó ⇒ để đợt sau (cần 90 đổi nguồn trước).
 */
import postgres from "postgres";

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const co = (k) => process.argv.includes(k);
const item = arg("--item");
const dbMong = arg("--db");
const commit = co("--commit");
const chiDem = !commit && !co("--test-only");
const expectN = arg("--expect-n");
if (commit && (co("--test-only") || co("--chi-dem"))) { console.error("--commit và --test-only loại trừ nhau"); process.exit(2); }
if (!item || !dbMong || !process.env.DATABASE_URL) { console.error("Thiếu --item/--db hoặc DATABASE_URL"); process.exit(2); }
if (commit && (expectN === undefined || !/^\d+$/.test(expectN))) { console.error("--commit đòi --expect-n <số nguyên> từ lần chạy trước"); process.exit(2); }

const MOC = `'2026-11-04 00:00:00'`;
const MUC = {
  "AL0-3a": {
    mota: "notifications — hộp thư cũ (lũ DEFECT SPIKE phát 5 user), tạo trước mốc 2026-11-04",
    bang: "notifications",
    where: `"createdAt" < ${MOC}`,
    canh: [],
    baoCao: [
      { ten: "trong tập xoá: ĐÃ ĐỌC (mong 0 — 100 % chưa đọc lúc đo 03/11)", sql: `SELECT count(*)::int AS n FROM notifications WHERE "createdAt" < ${MOC} AND "isRead" = true` },
      { ten: "trong tập xoá: tiêu đề 'CRITICAL Alert: DEFECT SPIKE'", sql: `SELECT count(*)::int AS n FROM notifications WHERE "createdAt" < ${MOC} AND title LIKE 'CRITICAL Alert: DEFECT SPIKE%'` },
      { ten: "GIỮ (tạo từ mốc trở đi)", sql: `SELECT count(*)::int AS n FROM notifications WHERE NOT ("createdAt" < ${MOC})` },
    ],
    tomtat: `SELECT count(*)::int AS tong, min("createdAt") AS som_nhat, max("createdAt") AS muon_nhat FROM notifications`,
  },
  "AL0-3b": {
    mota: "alert_escalations — 0 người nhận ở MỌI hàng, ghi trùng; tạo trước mốc",
    bang: "alert_escalations",
    where: `"escalatedAt" < ${MOC}`,
    canh: [{ ten: "trong tập xoá KHÔNG hàng nào có người nhận (notifiedUserIds khác rỗng)", sql: `SELECT count(*)::int AS n FROM alert_escalations WHERE "escalatedAt" < ${MOC} AND COALESCE(json_array_length("notifiedUserIds"), 0) > 0`, mongDoi: 0 }],
    baoCao: [],
    tomtat: `SELECT count(*)::int AS tong, min("escalatedAt") AS som_nhat, max("escalatedAt") AS muon_nhat FROM alert_escalations`,
  },
  "AL0-3c": {
    mota: "predictive_alerts EXPIRED tạo trước mốc (+ predictive_alert_occurrences xoá theo FK ON DELETE CASCADE)",
    bang: "predictive_alerts",
    where: `status = 'EXPIRED' AND "createdAt" < ${MOC}`,
    canh: [],
    baoCao: [
      { ten: "GIỮ: cảnh báo KHÔNG EXPIRED (hub còn sống — mọi trạng thái khác)", sql: `SELECT count(*)::int AS n FROM predictive_alerts WHERE NOT (status = 'EXPIRED' AND "createdAt" < ${MOC})` },
      { ten: "predictive_alert_occurrences sẽ xoá theo CASCADE", sql: `SELECT count(*)::int AS n FROM predictive_alert_occurrences WHERE "alertId" IN (SELECT id FROM predictive_alerts WHERE status = 'EXPIRED' AND "createdAt" < ${MOC})` },
    ],
    tomtat: `SELECT count(*)::int AS tong, count(*) FILTER (WHERE status = 'EXPIRED')::int AS expired, min("createdAt") AS som_nhat, max("createdAt") AS muon_nhat FROM predictive_alerts`,
  },
  "AL0-3d": {
    mota: "mqtt_alert_history — rule THROUGHPUT_LOW bắn mù mỗi 30 phút (không MQTT thật), chưa gửi thông báo nào; trước mốc",
    bang: "mqtt_alert_history",
    where: `"triggeredAt" < ${MOC}`,
    canh: [{ ten: "trong tập xoá KHÔNG hàng nào đã gửi thông báo", sql: `SELECT count(*)::int AS n FROM mqtt_alert_history WHERE "triggeredAt" < ${MOC} AND "notificationSent" = true`, mongDoi: 0 }],
    baoCao: [],
    tomtat: `SELECT count(*)::int AS tong, min("triggeredAt") AS som_nhat, max("triggeredAt") AS muon_nhat FROM mqtt_alert_history`,
  },
  "T0-4a": {
    mota: "machine_health_history — cũ hơn 90 ngày (bảng thường, không hypertable — mig 0278)",
    bang: "machine_health_history",
    where: `"timestamp" < now() - interval '90 days'`,
    canh: [{ ten: "còn hàng trong 90 ngày (không xoá sạch bảng)", sql: `SELECT (count(*) FILTER (WHERE "timestamp" >= now() - interval '90 days') > 0)::int AS n FROM machine_health_history`, mongDoi: 1 }],
    baoCao: [],
    tomtat: `SELECT count(*)::int AS tong, min("timestamp") AS som_nhat, max("timestamp") AS muon_nhat FROM machine_health_history`,
  },
  "T0-4b": {
    mota: "rul_estimates — cũ hơn 90 ngày theo computed_at (timestamptz)",
    bang: "rul_estimates",
    where: `computed_at < now() - interval '90 days'`,
    canh: [{ ten: "còn hàng trong 90 ngày (không xoá sạch bảng)", sql: `SELECT (count(*) FILTER (WHERE computed_at >= now() - interval '90 days') > 0)::int AS n FROM rul_estimates`, mongDoi: 1 }],
    baoCao: [],
    tomtat: `SELECT count(*)::int AS tong, min(computed_at) AS som_nhat, max(computed_at) AS muon_nhat FROM rul_estimates`,
  },
};
const m = MUC[item];
if (!m) { console.error("Mục không có:", item, "— chọn", Object.keys(MUC).join("|")); process.exit(2); }

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
const in_ = (o) => console.log(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
let ketThuc = 0;
try {
  const [{ cd, usr }] = await sql`SELECT current_database() AS cd, current_user AS usr`;
  in_({ muc: item, mota: m.mota, current_database: cd, current_user: usr, che_do: commit ? "COMMIT" : chiDem ? "CHI-DEM(READ ONLY, không DELETE)" : "TEST-ONLY(ROLLBACK)" });
  if (cd !== dbMong) { console.error(`DỪNG: current_database()=${cd} ≠ --db ${dbMong}`); process.exit(3); }

  if (chiDem) await sql`BEGIN READ ONLY`; else await sql`BEGIN`;
  const truoc = (await sql.unsafe(m.tomtat))[0];
  const [{ kich_thuoc }] = await sql.unsafe(`SELECT pg_size_pretty(pg_total_relation_size('public.${m.bang}')) AS kich_thuoc`);
  in_({ truoc, kich_thuoc_bang_gom_index: kich_thuoc });
  for (const c of m.canh) {
    const [{ n }] = await sql.unsafe(c.sql);
    in_({ canh: c.ten, do_duoc: n, mong_doi: c.mongDoi });
    if (n !== c.mongDoi) { await sql`ROLLBACK`; console.error("DỪNG: điều kiện canh sai — không xoá"); process.exit(4); }
  }
  for (const b of m.baoCao) {
    const [{ n }] = await sql.unsafe(b.sql);
    in_({ bao_cao: b.ten, n });
  }
  // FK trỏ VÀO bảng xoá: đếm hàng tham chiếu các hàng sắp xoá (CASCADE xoá theo / RESTRICT làm DELETE lỗi ⇒ ROLLBACK)
  const fk = await sql`
    SELECT con.conrelid::regclass::text AS bang_con, a.attname AS cot, ap.attname AS cot_cha, con.confdeltype AS khi_xoa
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute ap ON ap.attrelid = con.confrelid AND ap.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND con.confrelid = ${"public." + m.bang}::regclass AND array_length(con.conkey, 1) = 1`;
  for (const f of fk) {
    const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${f.bang_con} WHERE "${f.cot}" IN (SELECT "${f.cot_cha}" FROM ${m.bang} WHERE ${m.where})`);
    in_({ fk_tro_vao: f.bang_con, cot: f.cot, khi_xoa: { c: "CASCADE", r: "RESTRICT", a: "NO ACTION", n: "SET NULL", d: "SET DEFAULT" }[f.khi_xoa] ?? f.khi_xoa, hang_tham_chieu: n });
  }
  const [{ n: sapXoa }] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${m.bang} WHERE ${m.where}`);
  in_({ sap_xoa: sapXoa });
  if (chiDem) { await sql`ROLLBACK`; in_({ ket_qua: "CHI-DEM: CSDL KHÔNG ĐỔI (giao dịch READ ONLY, không DELETE)", se_xoa: sapXoa }); process.exit(0); }
  if (commit && String(sapXoa) !== expectN) { await sql`ROLLBACK`; console.error(`DỪNG: sắp xoá ${sapXoa} ≠ --expect-n ${expectN} — không ghi`); process.exit(5); }

  const daXoa = (await sql.unsafe(`DELETE FROM ${m.bang} WHERE ${m.where} RETURNING 1`)).length;
  const sau = (await sql.unsafe(m.tomtat))[0];
  in_({ da_xoa: daXoa, sau });
  if (daXoa !== sapXoa) { await sql`ROLLBACK`; console.error("DỪNG: số xoá thực ≠ số đếm — ROLLBACK"); process.exit(6); }
  if (commit) { await sql`COMMIT`; in_({ ket_qua: "ĐÃ COMMIT", da_xoa: daXoa }); }
  else { await sql`ROLLBACK`; in_({ ket_qua: "TEST-ONLY: ĐÃ ROLLBACK, CSDL KHÔNG ĐỔI", se_xoa: daXoa }); }
} catch (e) {
  try { await sql`ROLLBACK`; } catch {}
  console.error("LỖI:", e?.message ?? e);
  ketThuc = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(ketThuc);

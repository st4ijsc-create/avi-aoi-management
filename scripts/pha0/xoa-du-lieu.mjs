#!/usr/bin/env node
/**
 * Pha 0 lô D — ĐẾM + XOÁ dữ liệu rác, MỘT mục mỗi lần, trong MỘT giao dịch. KHÔNG tự chạy; do dieu-phoi chạy sau khi chủ dự án duyệt số đếm.
 *
 *   DATABASE_URL=... node scripts/pha0/xoa-du-lieu.mjs --item E0-1|F0-1 --db <current_database mong đợi> [--chi-dem (mặc định) | --test-only | --commit --expect-n <N>]
 *
 * Luật cứng:
 *   - Mặc định `--chi-dem`: giao dịch `READ ONLY` — CHỈ SELECT (đếm, canh, phụ thuộc), KHÔNG có DELETE nào được gửi; dùng cho DEV. `--test-only` (đếm bằng DELETE+ROLLBACK) chỉ nên dùng trên `_test`.
 *   - `--test-only`: chạy đủ (đếm trước, xoá, đếm sau) rồi ROLLBACK — in ĐÚNG số sẽ xoá. KHÔNG có cờ nào làm `--test-only` ghi thật.
 *   - `--commit` đòi `--expect-n` = số đếm từ lần `--test-only` ngay trước (lệch ⇒ ROLLBACK, không ghi) và `--db` khớp `current_database()` (Đ-28).
 *   - Mỗi mục có "điều kiện canh" (guard) đo TRƯỚC khi xoá: sai ⇒ dừng, không xoá.
 *   - Chỉ DELETE đúng điều kiện của mục (không TRUNCATE, không DROP). Q0-5 (product_inspections seed) ĐÃ BỎ khỏi công cụ: bảng là sổ WORM (mig 0279 REVOKE DELETE avi_app), chủ dự án chọn GIỮ seed (2026-11-04).
 *   - Dùng owner nào do người chạy cấp qua DATABASE_URL (script không chọn vai, không đọc .env).
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
if (commit && (expectN === undefined || !/^\d+$/.test(expectN))) { console.error("--commit đòi --expect-n <số nguyên> từ lần --test-only trước"); process.exit(2); }

const MUC = {
  "E0-1": {
    mota: "simulation_runs — toàn bộ lượt chạy twinFidelity (mode=fidelity_check), job đã gỡ lịch",
    bang: "simulation_runs",
    where: `"mode" = 'fidelity_check'`,
    canh: [{ ten: "100% hàng là fidelity_check (không xoá nhầm loại khác)", sql: `SELECT count(*)::int AS n FROM simulation_runs WHERE "mode" <> 'fidelity_check'`, mongDoi: 0 }],
    tomtat: `SELECT count(*)::int AS tong, min(created_at) AS som_nhat, max(created_at) AS muon_nhat FROM simulation_runs`,
  },
  "F0-1": {
    mota: "vram_events — sự kiện cũ hơn 30 ngày (sổ chẩn đoán, không phải sổ tuân thủ)",
    bang: "vram_events",
    where: `"createdAt" < now() - interval '30 days'`,
    canh: [{ ten: "còn lại hàng trong 30 ngày (không xoá sạch bảng)", sql: `SELECT (count(*) FILTER (WHERE "createdAt" >= now() - interval '30 days') > 0)::int AS n FROM vram_events`, mongDoi: 1 }],
    tomtat: `SELECT count(*)::int AS tong, min("createdAt") AS som_nhat, max("createdAt") AS muon_nhat FROM vram_events`,
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
  in_({ truoc });
  for (const c of m.canh) {
    const [{ n }] = await sql.unsafe(c.sql);
    in_({ canh: c.ten, do_duoc: n, mong_doi: c.mongDoi });
    if (n !== c.mongDoi) { await sql`ROLLBACK`; console.error("DỪNG: điều kiện canh sai — không xoá"); process.exit(4); }
  }
  const [{ n: sapXoa }] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${m.bang} WHERE ${m.where}`);
  in_({ sap_xoa: sapXoa });
  if (m.phuThuoc) {
    // bảng khác có cột inspectionId trỏ vào các hàng sắp xoá (FK CASCADE xoá theo; không FK ⇒ thành MỒ CÔI) — chỉ ĐẾM
    const cols = await sql`SELECT table_name FROM information_schema.columns WHERE column_name = 'inspectionId' AND table_schema = 'public' AND table_name <> 'product_inspections' ORDER BY 1`;
    const pt = {};
    for (const { table_name: t } of cols) {
      const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM "${t}" WHERE "inspectionId" IN (SELECT id FROM product_inspections WHERE ${m.where})`);
      if (n > 0) pt[t] = n;
    }
    in_({ phu_thuoc_tro_vao_hang_sap_xoa: pt });
  }
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

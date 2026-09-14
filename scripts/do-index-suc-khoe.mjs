#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 * `do-index-suc-khoe.mjs` — ĐO **CHỈ ĐỌC** cho QĐ-30 (áp index `0356` lên production)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Chạy:
 *     DATABASE_URL=postgres://user:pass@host:5432/db node scripts/do-index-suc-khoe.mjs
 *     # tuỳ chọn: --may=<N>  số máy giả lập trong mệnh đề IN (mặc định: TẤT CẢ máy active)
 *     #           --lan=<N>  số lượt EXPLAIN ấm (mặc định 5; lượt 1 là NGUỘI, không tính p50)
 *     #           --json     in thêm một khối JSON ở cuối để máy đọc
 *
 * ★★★ TỆP NÀY **KHÔNG CHẠY MỘT CÂU DDL NÀO VÀ KHÔNG GHI MỘT HÀNG NÀO.**
 *   Mọi câu đều là `SELECT` hoặc `EXPLAIN` (EXPLAIN của một SELECT không ghi gì —
 *   `ANALYZE` ở đây là "chạy thật câu SELECT rồi báo thời gian", không phải lệnh
 *   `ANALYZE` thu thập thống kê). Không `CREATE`, không `DROP`, không `INSERT`,
 *   không `UPDATE`, không `SET` ngoài phiên. Kiểm được bằng mắt: grep tệp này cho
 *   `CREATE|DROP|INSERT|UPDATE|DELETE|ALTER|TRUNCATE` ⇒ chỉ thấy trong CHÚ THÍCH.
 *   Ngoài ra phiên tự đặt `default_transaction_read_only = on` (tuỳ chọn `connection:` khi
 *   mở `postgres(...)` bên dưới), nên kể cả một câu ghi lọt vào cũng bị CSDL từ chối (`25006`)
 *   thay vì chạy. Hai `SET enable_*scan` của `--khong-index` là tham số PHIÊN, không phải ghi.
 *
 * ★ VÌ SAO CẦN: QĐ-27 đã áp `0356` trên **dev** và đo được `traSucKhoeMay`
 *   **288,5 ms → 0,30 ms** (SQL thuần) / **319 → 11,8 ms** (qua thủ tục, ấm p50).
 *   QĐ-30 duyệt áp lên **production**, nhưng môi trường phát triển này **không có
 *   chuỗi kết nối production**. Nên bước đi được ở đây là: đưa cho người vận hành
 *   một THIẾT BỊ ĐO chạy được ở cả hai phía cửa sổ bảo trì, in **cùng một bộ số**,
 *   để "trước/sau" là phép so sánh thật chứ không phải lời khai.
 *
 * ★ ĐỌC KÈM: `docs/runbook/2026-09-13-index-suc-khoe-may-production.md` (thủ tục 3 bước,
 *   cách phát hiện/dọn index INVALID, cách rollback, tiêu chí thành công bằng số).
 */
import postgres from "postgres";

const arg = (k, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${k}=`));
  return m ? m.slice(k.length + 3) : d;
};
const CO_JSON = process.argv.includes("--json");
/**
 * ★★★ `--khong-index` — CHẾ ĐỘ ĐỐI CHỨNG (G139).
 *
 * Tắt Index/Bitmap Scan **chỉ trong phiên này** (`SET enable_indexscan = off` …) rồi chạy lại
 * ĐÚNG câu ấy. Nó làm được hai việc mà không đụng một byte nào của CSDL:
 *   1. **Chứng minh thiết bị đo biết kêu TRƯỢT.** Một bảng "ĐẠT 7/7" chỉ có giá trị khi cùng
 *      thiết bị ấy ra TRƯỢT trên nền không-index — nếu không, "ĐẠT" chỉ là lời khai.
 *   2. **Xem trước số "TRƯỚC" trên production** mà KHÔNG phải DROP index: người vận hành đo
 *      được cái giá đang trả trước khi mở cửa sổ bảo trì.
 * ⚠ `SET` này là tham số PHIÊN, mất khi đóng kết nối; nó KHÔNG sửa dữ liệu, KHÔNG sửa lược đồ,
 *   và KHÔNG ảnh hưởng phiên nào khác. Vẫn nằm trong phiên `default_transaction_read_only = on`.
 */
const KHONG_INDEX = process.argv.includes("--khong-index");
const SO_LAN = Math.max(2, Number(arg("lan", "5")));
const GIOI_HAN_MAY = arg("may", null);

const URL_DB = process.env.DATABASE_URL;
if (!URL_DB) {
  console.error("✗ Thiếu DATABASE_URL. Ví dụ:\n    DATABASE_URL=postgres://aoi@host:5432/aoi_management node scripts/do-index-suc-khoe.mjs");
  process.exit(2);
}
/** Che mật khẩu trước khi in — script này hay được dán vào phiếu bảo trì. */
const cheUrl = (u) => u.replace(/(:\/\/[^:/@]+):[^@]*@/, "$1:***@");

const TEN_INDEX = "idx_health_machine_created_desc";
const BANG = "machine_health_history";

const sql = postgres(URL_DB, {
  max: 1,
  idle_timeout: 10,
  connect_timeout: 15,
  onnotice: () => {},
  /* ★ HÀNG RÀO THỨ HAI (fail-closed): phiên chỉ-đọc ở tầng CSDL. Nếu một ngày ai đó
       thêm một câu ghi vào tệp này, Postgres trả 25006 thay vì thực thi nó. */
  connection: { default_transaction_read_only: "on" },
});

const so = (v) => (v == null ? null : Number(v));
const bang = (hang, cot) => {
  const w = cot.map((c) => Math.max(c.length, ...hang.map((h) => String(h[c] ?? "").length)));
  const dong = (v) => "  " + cot.map((c, i) => String(v[c] ?? "").padEnd(w[i])).join("  ");
  console.log(dong(Object.fromEntries(cot.map((c) => [c, c]))));
  console.log("  " + w.map((n) => "─".repeat(n)).join("  "));
  for (const h of hang) console.log(dong(h));
};

const ra = { luc: new Date().toISOString(), db: cheUrl(URL_DB), doiChungKhongIndex: KHONG_INDEX };
try {
  if (KHONG_INDEX) {
    await sql`SET enable_indexscan = off`;
    await sql`SET enable_indexonlyscan = off`;
    await sql`SET enable_bitmapscan = off`;
    console.log("⚑ CHẾ ĐỘ ĐỐI CHỨNG `--khong-index`: Index/Bitmap Scan TẮT trong phiên này.");
    console.log("  Mọi số ở mục 3–4 dưới đây là số của một CSDL **như thể chưa có index** — dùng để");
    console.log("  (a) chứng minh bảng tiêu chí biết kêu TRƯỢT, (b) xem trước cái giá đang trả.");
    console.log("  Không có gì bị thay đổi: `SET` chỉ sống trong phiên này.\n");
  }

  /* ── 0. Danh tính CSDL (Đ-28: luôn in ra ĐANG ĐO CÁI GÌ) ──────────────── */
  const [dn] = await sql`
    SELECT current_database() AS db, current_user AS nguoi, version() AS phien_ban,
           current_setting('server_version_num')::int AS sv,
           pg_is_in_recovery() AS la_replica`;
  ra.danhTinh = dn;
  console.log("══════ 0. CSDL ĐANG ĐO ══════");
  console.log(`  url        : ${cheUrl(URL_DB)}`);
  console.log(`  database   : ${dn.db}   user: ${dn.nguoi}`);
  console.log(`  version    : ${String(dn.phien_ban).split(",")[0]}`);
  console.log(`  replica    : ${dn.la_replica ? "CÓ — đây là bản đọc, KHÔNG áp DDL ở đây" : "không (primary)"}`);
  if (dn.la_replica) console.log("  ⚠ Đang nối vào REPLICA: số đo hợp lệ, nhưng CREATE INDEX phải chạy trên primary.");

  /* ── 1. Kích cỡ bảng ──────────────────────────────────────────────────── */
  const [dem] = await sql`SELECT count(*)::bigint AS n FROM machine_health_history`;
  const [kich] = await sql`
    SELECT pg_total_relation_size(${BANG}::regclass)      AS tong,
           pg_relation_size(${BANG}::regclass)            AS heap,
           pg_indexes_size(${BANG}::regclass)             AS idx,
           pg_size_pretty(pg_total_relation_size(${BANG}::regclass)) AS tong_doc,
           pg_size_pretty(pg_relation_size(${BANG}::regclass))       AS heap_doc,
           pg_size_pretty(pg_indexes_size(${BANG}::regclass))        AS idx_doc`;
  const [may] = await sql`
    SELECT count(DISTINCT "machineId")::int AS n FROM machine_health_history`;
  ra.bang = { soHang: so(dem.n), soMay: may.n, ...kich, tong: so(kich.tong), heap: so(kich.heap), idx: so(kich.idx) };
  console.log("\n══════ 1. KÍCH CỠ BẢNG `machine_health_history` ══════");
  console.log(`  số hàng          : ${so(dem.n).toLocaleString("vi-VN")}`);
  console.log(`  số máy khác nhau : ${may.n}`);
  console.log(`  tổng / heap / idx: ${kich.tong_doc} / ${kich.heap_doc} / ${kich.idx_doc}`);
  console.log("  ★ So với dev khi áp QĐ-27: 213 567 hàng · 42 máy · 75 MB (heap 41 + idx 34).");
  console.log("    Thời gian build CONCURRENTLY tỉ lệ THUẬN với số hàng — nhân lên mà ước cửa sổ.");

  /* ── 2. Index hiện có + index mới đã có chưa + có INVALID không ───────── */
  const idx = await sql`
    SELECT c.relname                                        AS ten,
           i.indisvalid                                     AS hop_le,
           i.indisready                                     AS san_sang,
           pg_size_pretty(pg_relation_size(c.oid))          AS co,
           pg_get_indexdef(c.oid)                           AS dinh_nghia,
           COALESCE(s.idx_scan, 0)::bigint                  AS idx_scan,
           COALESCE(s.idx_tup_read, 0)::bigint              AS tup_read
      FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
      LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = c.oid
     WHERE i.indrelid = ${BANG}::regclass
     ORDER BY c.relname`;
  ra.index = idx.map((r) => ({ ...r, idx_scan: so(r.idx_scan), tup_read: so(r.tup_read) }));
  console.log("\n══════ 2. INDEX HIỆN CÓ ══════");
  bang(
    idx.map((r) => ({
      ten: r.ten,
      hợp_lệ: r.hop_le ? "có" : "KHÔNG (INVALID)",
      cỡ: r.co,
      idx_scan: String(so(r.idx_scan)),
      định_nghĩa: r.dinh_nghia.replace(/^CREATE (UNIQUE )?INDEX \S+ ON \S+ USING /, ""),
    })),
    ["ten", "hợp_lệ", "cỡ", "idx_scan", "định_nghĩa"],
  );
  const moi = idx.find((r) => r.ten === TEN_INDEX);
  const invalid = idx.filter((r) => !r.hop_le);
  ra.trangThaiIndexMoi = !moi ? "chua_co" : moi.hop_le ? "co_va_hop_le" : "co_nhung_INVALID";
  console.log(`\n  → ${TEN_INDEX}: ${!moi ? "CHƯA CÓ (bước 2 của runbook sẽ tạo)" : moi.hop_le ? `ĐÃ CÓ, hợp lệ, ${moi.co}, idx_scan=${so(moi.idx_scan)}` : "ĐÃ CÓ NHƯNG **INVALID** — xem mục 'Dọn INVALID' của runbook"}`);
  if (invalid.length) {
    console.log(`  ⚠ ${invalid.length} index INVALID trên bảng này: ${invalid.map((r) => r.ten).join(", ")}`);
    console.log("    Index INVALID KHÔNG được planner dùng nhưng VẪN bị mọi INSERT bảo trì — tệ nhất của hai thế giới.");
  }
  if (moi && moi.hop_le && so(moi.idx_scan) === 0) {
    console.log("  ⚠ idx_scan = 0: index có thật nhưng CHƯA AI DÙNG. Đo lại sau ≥ 24 h lưu lượng thật");
    console.log("    trước khi kết luận — index không ai dùng là chi phí ghi thuần (bước 3 runbook).");
  }

  /* ── 3. EXPLAIN (ANALYZE, BUFFERS) ĐÚNG CÂU của `traSucKhoeMay` ───────── */
  /* ★ Danh sách id lấy từ CHÍNH bảng máy như thủ tục thật (`traCayPhanCapNhaMay`
       trả máy của nhà máy trong phạm vi). Ở đây KHÔNG áp phạm vi tenant vì mục
       tiêu là hình dạng KẾ HOẠCH, và kế hoạch xấu nhất là kế hoạch nhiều id nhất. */
  let ids = (await sql`
    SELECT DISTINCT "machineId" AS id FROM machine_health_history ORDER BY 1`).map((r) => Number(r.id));
  if (GIOI_HAN_MAY) ids = ids.slice(0, Number(GIOI_HAN_MAY));
  console.log(`\n══════ 3. EXPLAIN (ANALYZE, BUFFERS) — ${SO_LAN} lượt, ${ids.length} máy trong IN ══════`);
  if (ids.length === 0) {
    console.log("  (bảng rỗng — không có gì để EXPLAIN)");
  } else {
    const CAU = sql`
      SELECT DISTINCT ON ("machineId")
             "machineId"                   AS machine_id,
             "healthScore"                 AS diem,
             "predictedFailureRisk"        AS nguy_co,
             "maintenanceUrgency"::text    AS muc_khan,
             "recommendedMaintenanceDate"  AS han_bao_tri,
             "createdAt"                   AS moc
      FROM machine_health_history
      WHERE "machineId" IN ${sql(ids)}
      ORDER BY "machineId", "createdAt" DESC`;
    const luot = [];
    for (let i = 0; i < SO_LAN; i++) {
      const d = await sql`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) ${CAU}`;
      const txt = d.map((r) => r["QUERY PLAN"]).join("\n");
      const ms = Number(/Execution Time: ([\d.]+) ms/.exec(txt)?.[1] ?? NaN);
      luot.push({ ms, txt });
      if (i === 0) {
        console.log("  ── kế hoạch (lượt 1, NGUỘI) ──");
        console.log(txt.split("\n").map((l) => "  " + l).join("\n"));
      }
    }
    const am = luot.slice(1).map((l) => l.ms).filter(Number.isFinite).sort((a, b) => a - b);
    const p50 = am.length ? am[Math.floor(am.length / 2)] : null;
    const txt0 = luot[0].txt;
    const coSeq = /Seq Scan on machine_health_history/.test(txt0);
    const coMergeDia = /Sort Method: external merge/.test(txt0);
    const coIndex = new RegExp(`Index (Only )?Scan.*${TEN_INDEX}|${TEN_INDEX}`).test(txt0);
    const tempKb = Number(/temp read=(\d+)/.exec(txt0)?.[1] ?? 0);
    ra.explain = { soMay: ids.length, nguoiMs: luot[0].ms, amP50Ms: p50, amMs: am, coSeq, coMergeDia, coIndex, tempBlockRead: tempKb };
    console.log(`\n  nguội (lượt 1) : ${luot[0].ms} ms`);
    console.log(`  ấm p50 (${am.length} lượt): ${p50} ms   [${am.join(", ")}]`);
    console.log(`  Seq Scan bảng  : ${coSeq ? "CÓ  ← chưa dùng index" : "không"}`);
    console.log(`  external merge : ${coMergeDia ? "CÓ  ← đang SẮP RA ĐĨA" : "không"}`);
    console.log(`  dùng ${TEN_INDEX}: ${coIndex ? "CÓ" : "không"}`);

    /* ── 4. TIÊU CHÍ THÀNH CÔNG — nói bằng SỐ, không bằng cảm nhận ──────── */
    console.log("\n══════ 4. ĐỐI CHIẾU TIÊU CHÍ (runbook §Tiêu chí thành công) ══════");
    const ok = (b) => (b ? "ĐẠT  " : "TRƯỢT");
    console.log(`  ${ok(!coMergeDia)} T1 — kế hoạch KHÔNG còn \`Sort Method: external merge\``);
    console.log(`  ${ok(!coSeq)} T2 — kế hoạch KHÔNG còn \`Seq Scan on ${BANG}\``);
    console.log(`  ${ok(coIndex)} T3 — kế hoạch CÓ nhắc \`${TEN_INDEX}\``);
    console.log(`  ${ok(p50 != null && p50 < 10)} T4 — ấm p50 < 10 ms (dev sau QĐ-27: 0,30 ms SQL thuần)`);
    console.log(`  ${ok(tempKb === 0)} T5 — \`temp read\` = 0 khối (dev trước: 981 khối ≈ 7,8 MB)`);
    console.log(`  ${ok(moi != null && moi.hop_le)} T6 — index tồn tại và \`indisvalid = true\``);
    console.log(`  ${ok(moi != null && so(moi.idx_scan) > 0)} T7 — \`idx_scan > 0\` (CHỈ đo sau ≥ 24 h lưu lượng thật)`);
    ra.tieuChi = { T1: !coMergeDia, T2: !coSeq, T3: coIndex, T4: p50 != null && p50 < 10, T5: tempKb === 0, T6: !!(moi && moi.hop_le), T7: !!(moi && so(moi.idx_scan) > 0) };
  }

  /* ── 5. Đường GHI — để ước tác động của CONCURRENTLY ──────────────────── */
  const [ghi] = await sql`
    SELECT max("createdAt") AS moi_nhat,
           count(*) FILTER (WHERE "createdAt" > now() - interval '1 hour')::bigint AS gio_qua,
           count(*) FILTER (WHERE "createdAt" > now() - interval '24 hours')::bigint AS ngay_qua
      FROM machine_health_history`;
  ra.duongGhi = { moiNhat: ghi.moi_nhat, gioQua: so(ghi.gio_qua), ngayQua: so(ghi.ngay_qua) };
  console.log("\n══════ 5. ĐƯỜNG GHI (ước tác động của CONCURRENTLY) ══════");
  console.log(`  hàng mới nhất        : ${ghi.moi_nhat ?? "—"}`);
  console.log(`  ghi trong 1 h qua    : ${so(ghi.gio_qua)}`);
  console.log(`  ghi trong 24 h qua   : ${so(ghi.ngay_qua)}`);
  console.log("  ★ CONCURRENTLY KHÔNG khoá đường ghi; con số này là để biết bảng có đang nóng không");
  console.log("    (bảng nóng ⇒ lượt quét thứ hai lâu hơn, và nguy cơ bị ngắt giữa chừng cao hơn).");

  if (CO_JSON) console.log("\n──── JSON ────\n" + JSON.stringify(ra, null, 2));
} catch (e) {
  console.error("\n✗ LỖI: " + (e?.message ?? e));
  if (e?.code) console.error("  mã Postgres: " + e.code);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

/**
 * BG-96 Task 3 — dọn dữ liệu TEST lệch múi giờ trên DB DEV, sinh ra TRƯỚC cutover
 * "fake-UTC" (Khối C Task 1/2, `aedd3096`/`86b0e889`/`118d5322`/`db10d08f`).
 *
 * Trước cutover, `product_inspections.inspectionTime` bị dịch "fake UTC" (+giờ theo TZ
 * process) trong khi cấp cây (`inspection_surfaces/positions/captures.startedAt` …) ghi
 * THÔ — cùng một request, hai hệ quy chiếu KHÁC NHAU (BG-96). Dữ liệu test tạo ra trong
 * giai đoạn đó mang lỗi lệch này vĩnh viễn; xoá nó là cách duy nhất để dev DB không còn
 * hàng "hai đồng hồ" — KHÔNG migrate/backfill giá trị, vì không có cách suy ngược ra
 * offset đã dùng cho từng hàng một cách chắc chắn.
 *
 * ⚠ CHỈ chạy tay, KHÔNG BAO GIỜ tự động — xem `scripts/don-db-dev.mjs` cho lý do (một câu
 *   DELETE đúng ý trên dev DB hôm nay sẽ xoá sạch lịch sử sản xuất nếu lỡ chạy ở nhà máy).
 *   Script này sống ở `scripts/`, không sống ở `drizzle/`.
 *
 * Luật Đ-28: mọi số đo DB phải kèm `current_database()` — MỌI output dưới đây đều in nó.
 *
 * Thứ tự DELETE đi từ LÁ lên GỐC theo FK thật/soft-ref của cây kết quả + header:
 *   measurement_results → inspection_captures → inspection_positions →
 *   inspection_surfaces → inspection_idempotency_keys → product_inspections
 * (`drizzle/schema/inspection.ts`, `drizzle/schema/inspectionTree.ts`).
 *
 * TUYỆT ĐỐI KHÔNG đụng: product_surfaces/positions/captures (cây DẠY, khác cây KẾT QUẢ),
 * measurement_point_defs, machine_template_versions, inspection_packages, audit_logs.
 *
 * Đếm:  node scripts/don-du-lieu-lech-tz.mjs
 * Xoá:  node scripts/don-du-lieu-lech-tz.mjs --xoa
 * Xoá bằng vai OWNER (khi avi_app bị 42501 trên product_inspections — bảng WORM):
 *       node scripts/don-du-lieu-lech-tz.mjs --xoa --owner
 */
import 'dotenv/config';
import postgres from 'postgres';

const XOA = process.argv.includes('--xoa');
/**
 * `--owner`: chạy bằng vai OWNER (`aoi`) thay vì `avi_app`.
 *
 * ⚠ Chỉ dùng khi DELETE bị 42501. `product_inspections` là bảng WORM — `avi_app` KHÔNG có
 * quyền DELETE theo CHỦ ĐÍCH (append-only audit, doc48 R1). Cờ này vượt qua nó.
 *
 * Cách dựng URL owner LẤY NGUYÊN KHUÔN của `scripts/apply-migration-*.mjs` /
 * `scripts/don-db-dev.mjs`: đổi user/password của DATABASE_URL sang
 * MIGRATION_DB_USER/PASSWORD (mặc định `aoi`/`aoi` — connstring dev-only đã comment sẵn ở
 * `.env` dòng ~9: `postgresql://aoi:aoi@127.0.0.1:5434/aoi_management`).
 */
const DUNG_OWNER = process.argv.includes('--owner');
const TRAN_SO_BO = 100000;
let url = process.env.DATABASE_URL || '';

if (DUNG_OWNER && url) {
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? 'aoi';
  u.password = process.env.MIGRATION_DB_PASSWORD ?? 'aoi';
  url = u.toString();
}

// ── Lớp chặn: chỉ máy cục bộ ─────────────────────────────────────────────────
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('DỪNG: DATABASE_URL không trỏ 127.0.0.1/localhost.');
  console.error('       Script này CHỈ dành cho DB dev cục bộ.');
  console.error('       Giá trị hiện tại:', url.replace(/:[^:@]*@/, ':***@') || '(rỗng)');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'prefer', max: 1 });
const che = (u) => u.replace(/:[^:@]*@/, ':***@');

// Thứ tự khai == thứ tự XOÁ (lá → gốc). Đếm dùng CÙNG danh sách để "trước/sau" luôn khớp
// đúng bảng đã xoá — không đếm bảng nào ngoài phạm vi brief.
const BANG = [
  'measurement_results',
  'inspection_captures',
  'inspection_positions',
  'inspection_surfaces',
  'inspection_idempotency_keys',
  'product_inspections',
];

async function layTenDb() {
  const [r] = await sql`SELECT current_database() AS db`;
  return r.db;
}

async function dem() {
  const out = {};
  for (const b of BANG) {
    // postgres-js parse cột `timestamp` NAIVE theo TZ của PROCESS — script này chỉ
    // COUNT(*), không đọc bất kỳ giá trị thời gian nào, nên né được đúng bẫy mà chính
    // migration này đang dọn hậu quả (nếu cần in mốc thời gian: dùng `to_char`, không bao
    // giờ đọc trực tiếp cột timestamp qua driver này).
    const [r] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${b}`);
    out[b] = r.n;
  }
  return out;
}

const tenDb = await layTenDb();
console.log(`[current_database=${tenDb}] DB: ${che(url)}${DUNG_OWNER ? ' (vai OWNER)' : ''}`);

const truoc = await dem();
console.log(`[current_database=${tenDb}] TRƯỚC:`, JSON.stringify(truoc));

if (!XOA) {
  console.log(`[current_database=${tenDb}] Chế độ ĐẾM. Thêm --xoa để thực thi.`);
  await sql.end();
  process.exit(0);
}

// ── Trần: số lớn bất thường ⇒ đang trỏ nhầm DB, dừng thay vì xoá mù ────────────
if (truoc.product_inspections > TRAN_SO_BO) {
  console.error(
    `[current_database=${tenDb}] DỪNG: ${truoc.product_inspections} product_inspections vượt trần ${TRAN_SO_BO}. Kiểm tra lại đang trỏ DB nào.`,
  );
  await sql.end();
  process.exit(1);
}

const ketQua = [];
for (const b of BANG) {
  try {
    const r = await sql.unsafe(`DELETE FROM ${b}`);
    ketQua.push({ bang: b, trang_thai: 'đã xoá', so_hang: r.count ?? null });
  } catch (e) {
    const worm = e?.code === '42501';
    ketQua.push({
      bang: b,
      trang_thai: worm
        ? 'TỪ CHỐI (42501 — thiếu quyền DELETE; thử lại với --owner)'
        : `LỖI: ${e?.code ?? ''} ${e?.message ?? e}`,
    });
  }
}

console.log(`[current_database=${tenDb}] KẾT QUẢ TỪNG BẢNG:`);
for (const r of ketQua) {
  console.log(' -', r.bang.padEnd(30), r.trang_thai, r.so_hang != null ? `(${r.so_hang} hàng)` : '');
}

const sau = await dem();
console.log(`[current_database=${tenDb}] SAU:`, JSON.stringify(sau));

const conLai = Object.entries(sau).filter(([, v]) => v > 0);
if (conLai.length) {
  console.log(
    `[current_database=${tenDb}] ⚠ CÒN LẠI (không xoá được):`,
    conLai.map(([k, v]) => `${k}=${v}`).join(' · '),
  );
  console.log(`[current_database=${tenDb}]   Nếu là 42501: cần chạy lại với --owner (vai \`aoi\`).`);
} else {
  console.log(`[current_database=${tenDb}] ✅ Sạch toàn bộ — 0 hàng lệch TZ còn lại.`);
}

await sql.end();
process.exit(0);

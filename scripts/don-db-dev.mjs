/**
 * Dọn dữ liệu TEST trên DB DEV — thao tác MỘT LẦN, chạy tay, NGOÀI migration.
 *
 * ⚠ Migration của dự án TUYỆT ĐỐI không được chứa lệnh xoá dữ liệu lịch sử. Một câu
 *   `DELETE ... WHERE <điều kiện>` nằm trong migration sẽ chạy "đúng như ý" trên DB dev
 *   hôm nay và XOÁ SẠCH lịch sử sản xuất vào ngày nó chạy ở nhà máy. Cùng một câu lệnh,
 *   hai hậu quả ngược nhau — chỉ khác nhau ở nơi nó chạy. Vì vậy script này sống ở
 *   `scripts/`, không sống ở `drizzle/`.
 *
 * Ba lớp chặn:
 *   1. Chỉ chạy khi DATABASE_URL trỏ 127.0.0.1 / localhost.
 *   2. Mặc định CHỈ ĐẾM. Phải thêm `--that-su-xoa` mới thực thi.
 *   3. Trần ORPHAN/ROW: vượt ngưỡng thì DỪNG — số lớn bất thường nghĩa là đang trỏ nhầm DB.
 *
 * Đếm:  node scripts/don-db-dev.mjs
 * Xoá:  node scripts/don-db-dev.mjs --that-su-xoa
 */
import 'dotenv/config';
import postgres from 'postgres';

const THAT_SU_XOA = process.argv.includes('--that-su-xoa');
const TRAN_SO_BO = 100000;
const url = process.env.DATABASE_URL || '';

// ── Lớp chặn 1: chỉ máy cục bộ ──────────────────────────────────────────────
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('DỪNG: DATABASE_URL không trỏ 127.0.0.1/localhost.');
  console.error('       Script này CHỈ dành cho DB dev cục bộ.');
  console.error('       Giá trị hiện tại:', url.replace(/:[^:@]*@/, ':***@') || '(rỗng)');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'prefer', max: 1 });
const che = (u) => u.replace(/:[^:@]*@/, ':***@');

async function dem() {
  const [r] = await sql`
    SELECT (SELECT count(*) FROM product_inspections)::int          AS bo,
           (SELECT count(*) FROM measurement_results)::int          AS diem_do,
           (SELECT count(*) FROM inspection_packages)::int          AS goi,
           (SELECT count(*) FROM package_images)::int               AS anh,
           (SELECT count(*) FROM package_activity_logs)::int        AS nhat_ky_goi,
           (SELECT count(*) FROM inspection_idempotency_keys)::int  AS khoa_idem`;
  return r;
}

console.log('DB:', che(url));
const truoc = await dem();
console.log('TRƯỚC:', JSON.stringify(truoc));

if (!THAT_SU_XOA) {
  console.log('\nChế độ ĐẾM. Thêm --that-su-xoa để thực thi.');
  await sql.end();
  process.exit(0);
}

// ── Lớp chặn 3: trần ──────────────────────────────────────────────────────────
if (truoc.bo > TRAN_SO_BO) {
  console.error(`DỪNG: ${truoc.bo} bo vượt trần ${TRAN_SO_BO}. Kiểm tra lại đang trỏ DB nào.`);
  await sql.end();
  process.exit(1);
}

// Thứ tự xoá đi từ lá lên gốc để không vướng ràng buộc tham chiếu.
// `product_inspections` là bảng WORM — vai `avi_app` KHÔNG có quyền DELETE (đo được ở
// Task 7). Bắt lỗi 42501 riêng và báo TRUNG THỰC thay vì để script chết khó hiểu.
const BANG = [
  'package_images',
  'package_activity_logs',
  'inspection_packages',
  'measurement_results',
  'inspection_idempotency_keys',
  'product_inspections',
];

const ketQua = [];
for (const b of BANG) {
  try {
    await sql.unsafe(`DELETE FROM ${b}`);
    ketQua.push({ bang: b, trang_thai: 'đã xoá' });
  } catch (e) {
    const worm = e?.code === '42501';
    ketQua.push({
      bang: b,
      trang_thai: worm ? 'TỪ CHỐI (WORM — avi_app không có quyền DELETE)' : `LỖI: ${e?.code ?? ''} ${e?.message ?? e}`,
    });
  }
}

console.log('\nKẾT QUẢ TỪNG BẢNG:');
for (const r of ketQua) console.log(' -', r.bang.padEnd(30), r.trang_thai);

const sau = await dem();
console.log('\nSAU:', JSON.stringify(sau));

const conLai = Object.entries(sau).filter(([, v]) => v > 0);
if (conLai.length) {
  console.log('\n⚠ CÒN LẠI (không xoá được):', conLai.map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log('  Nếu là WORM: cần vai `aoi` (owner), không phải `avi_app`.');
} else {
  console.log('\n✅ Sạch toàn bộ.');
}

await sql.end();

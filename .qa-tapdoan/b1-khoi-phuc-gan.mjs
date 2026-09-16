/**
 * b1-khoi-phuc-gan.mjs — KHÔI PHỤC gán nhà máy/tập đoàn cho 7 tài khoản `qatd_*`.
 *
 * VÌ SAO CẦN: `sinh-tap-doan.mjs` khi xoá sạch dữ liệu QATD có XOÁ LUÔN hai bảng
 * gán (dòng 868/870: `DELETE FROM user_factory_assignments WHERE "factoryCode"
 * LIKE 'QATD-%'` và `DELETE FROM user_corporate_assignments WHERE
 * "corporateCode" = 'QATD'`). Lần sinh lại lúc 2026-09-16T09:05Z không chạy lại
 * `--gan`, nên `select count(*)` cho **0 / 0** và MỌI vai QA (trừ admin bypass)
 * thấy `factory.list = 0` ⇒ màn `/twin` ra "Your account is not assigned to any
 * factory". Đây là trạng thái DỮ LIỆU, không phải khuyết tật mã.
 *
 * ⚠ KHÔNG dùng `sinh-tap-doan.mjs --gan`: lệnh đó gán CẢ BA công ty cho mọi user
 *   được liệt kê, làm hỏng chính thứ các vai dùng để phân biệt phạm vi (quản lý
 *   chỉ QATD-A, kỹ thuật A+B, công nhân C). Ở đây chép ĐÚNG bảng gán mà
 *   `tai-khoan.mjs` khai, không hơn không kém.
 *
 * ⚠ KHÔNG xoá/tạo lại user (`tai-khoan.mjs xoa|tao`): làm thế là đổi `users.id`,
 *   trong khi thứ hỏng chỉ là hai bảng gán. Chỉ CHÈN hàng còn thiếu, idempotent
 *   bằng NOT EXISTS.
 *
 *   node .qa-tapdoan/b1-khoi-phuc-gan.mjs
 */
import postgres from "postgres";
import fs from "node:fs";
import { TAI_KHOAN } from "./tai-khoan.mjs";

const url = fs
  .readFileSync(".env", "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL="))
  ?.slice(13)
  .replace(/^["']|["']$/g, "");
const sql = postgres(url, { max: 1 });

const dem = async () => {
  const [f] = await sql`select count(*)::int n from user_factory_assignments where "factoryCode" like 'QATD-%'`;
  const [c] = await sql`select count(*)::int n from user_corporate_assignments where "corporateCode" = 'QATD'`;
  return { gan_nha_may: f.n, gan_tap_doan: c.n };
};

console.log("TRƯỚC:", JSON.stringify(await dem()));

const [adm] = await sql`select id from users where role='admin' order by id limit 1`;
let themF = 0;
let themC = 0;
for (const t of TAI_KHOAN) {
  const [u] = await sql`select id from users where username = ${t.ten}`;
  if (!u) {
    console.log(`  ⚠ KHÔNG có user ${t.ten} — bỏ qua`);
    continue;
  }
  for (const code of t.ganNhaMay) {
    const r = await sql`insert into user_factory_assignments ("userId","factoryCode","assignedBy")
      select ${u.id}, ${code}, ${adm?.id ?? u.id}
      where not exists (select 1 from user_factory_assignments where "userId" = ${u.id} and "factoryCode" = ${code})`;
    themF += r.count;
  }
  for (const code of t.ganTapDoan) {
    const r = await sql`insert into user_corporate_assignments ("userId","corporateCode","assignedBy")
      select ${u.id}, ${code}, ${adm?.id ?? u.id}
      where not exists (select 1 from user_corporate_assignments where "userId" = ${u.id} and "corporateCode" = ${code})`;
    themC += r.count;
  }
  console.log(`  ${t.ten.padEnd(16)} id=${u.id} nhàMáy=[${t.ganNhaMay.join(",")}] tậpĐoàn=[${t.ganTapDoan.join(",")}]`);
}
console.log(`chèn thêm: nhà máy=${themF} · tập đoàn=${themC}`);
console.log("SAU:", JSON.stringify(await dem()));
await sql.end();

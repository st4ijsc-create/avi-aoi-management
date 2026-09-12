// ĐỢT 49 · mục G — HAI user TẠM chỉ khác nhau MỘT bit `machine_monitoring.canCreate`
// (`nganXuLyLogic.ts:148` ⇒ `quyen.taoPhieu` ⇒ `NganXuLy.tsx:478` ẩn/hiện `<section nhom-tao-viec>`).
// Đối chứng DƯƠNG là bắt buộc: một `return null` vô điều kiện làm chiều (−) xanh mà đã giết chức năng.
//   node .qa-dot49/user-tam49.mjs tao|xoa|dem
import { readFileSync } from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";
const url = (readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1].trim();
const sql = postgres(url, { max: 1 });
const [lenh] = process.argv.slice(2);
const AI = [
  { u: "e2e_dot49_co", mk: "Dot49Co!2026", canCreate: true, ten: "E2E Dot49 CO taoPhieu" },
  { u: "e2e_dot49_khong", mk: "Dot49Khong!2026", canCreate: false, ten: "E2E Dot49 KHONG taoPhieu" },
];
const d = async () => ({
  users: (await sql`select count(*)::int n from users`)[0].n,
  tam: (await sql`select count(*)::int n from users where username in ${sql(AI.map((a) => a.u))}`)[0].n,
  permissions: (await sql`select count(*)::int n from permissions`)[0].n,
  ufa: (await sql`select count(*)::int n from user_factory_assignments`)[0].n,
});
const out = { taiKhoan: AI.map((a) => ({ username: a.u, password: a.mk, canCreate: a.canCreate })) };
try {
  if (lenh === "tao") {
    out.truoc = await d();
    for (const a of AI) {
      const hash = await bcrypt.hash(a.mk, 10);
      const openId = "local_" + Date.now() + "_" + a.u;
      await sql.begin(async (tx) => {
        const [u] = await tx`insert into users ("openId", username, name, "loginMethod", role, "isActive", "passwordChangedAt") values (${openId}, ${a.u}, ${a.ten}, ${"local"}, ${"supervisor"}, true, now()) returning id`;
        await tx`insert into user_secrets ("userId", "passwordHash") values (${u.id}, ${hash})`;
        /*
         * ★★★ BÍT THẬT LÀ `machine_status.canCreate`, KHÔNG PHẢI `machine_monitoring.canCreate`.
         * `TwinMay.tsx:567` viết `hasPermission("machine_monitoring", "canCreate")`, nhưng
         * `usePermissions` resolve qua `PERMISSION_MODULE_ALIASES` (`shared/permissions.ts:243`):
         * `machine_monitoring → machine_status` — `machine_monitoring` chỉ là một CATEGORY, chưa
         * bao giờ là `moduleName` của role nào. Lượt đo đầu của tôi cấp `moduleName =
         * "machine_monitoring"` và ĐỐI CHỨNG DƯƠNG TRƯỢT (vai "có quyền" vẫn 0 nhóm) — chính
         * chiều (+) bắt được fixture sai, đúng lớp lỗi G24 ("lấy tên quyền từ fixture test").
         * Hai vai giống hệt nhau trừ ĐÚNG MỘT bit: `machine_status.canCreate`.
         */
        await tx`insert into permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport") values (${u.id}, ${"machine_monitoring"}, ${"machine_status"}, true, ${a.canCreate}, false, false, false)`;
        await tx`insert into permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport") values (${u.id}, ${"andon"}, ${"andon"}, true, false, false, false, false)`;
        await tx`insert into permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport") values (${u.id}, ${"analytics"}, ${"analytics_oee"}, true, false, false, false, false)`;
        await tx`insert into user_factory_assignments ("userId", "factoryCode", "assignedBy") values (${u.id}, ${"SIM-FAC"}, ${u.id})`;
      });
    }
    out.sau = await d();
  } else if (lenh === "xoa") {
    out.truoc = await d();
    const ids = (await sql`select id from users where username in ${sql(AI.map((a) => a.u))}`).map((r) => r.id);
    for (const id of ids) {
      await sql`delete from permissions where "userId"=${id}`;
      await sql`delete from user_factory_assignments where "userId"=${id}`;
      await sql`delete from user_secrets where "userId"=${id}`;
      await sql`delete from users where id=${id}`;
    }
    out.xoa = ids.length;
    out.sau = await d();
  } else out.dem = await d();
} finally { await sql.end(); }
console.log(JSON.stringify(out));

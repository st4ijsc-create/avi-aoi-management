/**
 * .qa-tapdoan/db-DE.mjs — công cụ DB cho LÔ D+E (QA lần 11). SQL thô, đường ĐỘC LẬP với tRPC.
 * Tiền tố hàng tạm RIÊNG của lô này: `QATD-DE-` (không dùng chung với bất kỳ đợt nào khác).
 *
 * Lệnh:
 *   dem                       — đếm nền 3 bảng ghi (andon_events / maintenance_work_orders / twin_vat_the)
 *   quyen                     — permissions + gán nhà máy của các vai QATD
 *   andon-tam tao <mayId>     — chèn 1 andon raised TẠM (title `QATD-DE-RAISED-M<id>`)
 *   andon-tam xoa             — xoá MỌI hàng andon title like 'QATD-DE-%'
 *   andon-tam dem             — liệt kê hàng tạm andon
 *   wo-dem <mayId>            — đếm maintenance_work_orders (tổng + của máy đó)
 *   wo-liet <mayId>           — liệt kê phiếu của máy đó
 *   wo-xoa <id>               — xoá MỘT phiếu theo id (chỉ id truyền vào)
 *   vung-dem <tangId>         — đếm twin_vat_the của tầng
 *   vung-liet <tangId>        — liệt kê vùng của tầng
 *   vung-xoa-tam              — xoá vùng có ten like 'QATD-DE-%' (lưới an toàn cuối)
 *   may <ids>                 — thông tin máy
 *   tang-cua-toa <toaId>      — các tầng của một toà
 *   toa-cua-nha-may <fid>     — các toà của một nhà máy
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
const url = (readFileSync("D:/SOURCES/avi-aoi-management/.env", "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1].trim();
const sql = postgres(url, { max: 1 });
const [lenh, arg, arg2] = process.argv.slice(2);
const TIEN_TO = "QATD-DE-";
const LIKE = TIEN_TO + "%";
const out = { lenh, luc: new Date().toISOString() };
const dem = async () => ({
  db: (await sql`select current_database() d, now() n`)[0],
  andon: (await sql`select count(*)::int n from andon_events`)[0].n,
  andon_raised: (await sql`select count(*)::int n from andon_events where status='raised'`)[0].n,
  andon_tam: (await sql`select count(*)::int n from andon_events where title like ${LIKE}`)[0].n,
  wo: (await sql`select count(*)::int n from maintenance_work_orders`)[0].n,
  vat_the: (await sql`select count(*)::int n from twin_vat_the`)[0].n,
});
try {
  if (lenh === "dem") {
    out.dem = await dem();
  } else if (lenh === "quyen") {
    out.vai = await sql`select u.id, u.username, u.role from users u where u.username like 'qatd_%' order by u.username`;
    out.perm = await sql`select u.username, p.category, p."moduleName", p."canView", p."canCreate", p."canEdit", p."canDelete"
      from permissions p join users u on u.id=p."userId" where u.username like 'qatd_%' order by u.username, p."moduleName"`;
    out.ufa = await sql`select u.username, a."factoryCode" from user_factory_assignments a join users u on u.id=a."userId" where u.username like 'qatd_%' order by 1,2`;
    out.uca = await sql`select u.username, a."corporateCode" from user_corporate_assignments a join users u on u.id=a."userId" where u.username like 'qatd_%' order by 1,2`;
  } else if (lenh === "andon-tam") {
    const d = async () => ({
      tong: (await sql`select count(*)::int n from andon_events`)[0].n,
      raised: (await sql`select count(*)::int n from andon_events where status='raised'`)[0].n,
      tam: await sql`select id, "machineId", status, title, ("acknowledgedAt" is not null) as da_ack, "acknowledgedBy", "mttaSeconds" from andon_events where title like ${LIKE} order by id`,
    });
    if (arg === "tao") {
      const mid = Number(arg2);
      if (!Number.isInteger(mid) || mid <= 0) throw new Error("can <mayId>");
      const [st] = await sql`select s.id as sid, s."lineId" as lid from machines m join stations s on s.id=m."stationId" where m.id=${mid}`;
      if (!st) throw new Error("may " + mid + " khong co station");
      out.truoc = await d();
      const title = TIEN_TO + "RAISED-M" + mid;
      const [r] = await sql`insert into andon_events (state, reason, status, "lineId", "stationId", "machineId", title, message, "raisedBy", "raisedBySystem", "raisedAt", "escalationLevel")
        values ('red','quality','raised',${st.lid},${st.sid},${mid},${title},${"QA lan 11 lo D - hang raised TAM, se xoa"},null,true,now(),0) returning id`;
      out.id = r.id;
      out.title = title;
      writeFileSync("D:/SOURCES/avi-aoi-management/.qa-tapdoan/tho/DE/andon-tam.id", String(r.id));
      out.sau = await d();
    } else if (arg === "xoa") {
      out.truoc = await d();
      out.daXoa = (await sql`delete from andon_events where title like ${LIKE}`).count;
      out.sau = await d();
    } else {
      out.dem = await d();
    }
  } else if (lenh === "wo-dem") {
    const mid = Number(arg);
    out.tong = (await sql`select count(*)::int n from maintenance_work_orders`)[0].n;
    out.cuaMay = (await sql`select count(*)::int n from maintenance_work_orders where "machineId"=${mid}`)[0].n;
    out.maxId = (await sql`select coalesce(max(id),0)::int n from maintenance_work_orders`)[0].n;
  } else if (lenh === "wo-liet") {
    const mid = Number(arg);
    out.hang = await sql`select id, "workOrderNumber", "machineId", title, priority, status, type, "assignedTo", "factoryId", "corporateCode", ("createdAt" AT TIME ZONE 'UTC') as tao_utc from maintenance_work_orders where "machineId"=${mid} order by id desc limit 20`;
  } else if (lenh === "wo-xoa") {
    const id = Number(arg);
    if (!Number.isInteger(id) || id <= 0) throw new Error("can <id>");
    out.truoc = (await sql`select count(*)::int n from maintenance_work_orders`)[0].n;
    out.hangTruocKhiXoa = await sql`select id, "workOrderNumber", "machineId", title from maintenance_work_orders where id=${id}`;
    out.daXoa = (await sql`delete from maintenance_work_orders where id=${id}`).count;
    out.sau = (await sql`select count(*)::int n from maintenance_work_orders`)[0].n;
  } else if (lenh === "vung-dem") {
    const tid = Number(arg);
    out.loaiCo = await sql`select loai, count(*)::int n from twin_vat_the group by 1 order by 2 desc`;
    out.cuaTang = (await sql`select count(*)::int n from twin_vat_the where "tangId"=${tid}`)[0].n;
  } else if (lenh === "vung-liet") {
    const tid = Number(arg);
    out.hang = await sql`select id, "tangId", loai, ten, mau from twin_vat_the where "tangId"=${tid} order by id desc limit 20`;
  } else if (lenh === "vung-xoa-tam") {
    out.truoc = (await sql`select count(*)::int n from twin_vat_the where ten like ${LIKE}`)[0].n;
    out.hang = await sql`select id, ten, "tangId" from twin_vat_the where ten like ${LIKE}`;
    out.daXoa = (await sql`delete from twin_vat_the where ten like ${LIKE}`).count;
    out.sau = (await sql`select count(*)::int n from twin_vat_the where ten like ${LIKE}`)[0].n;
  } else if (lenh === "may") {
    const ids = String(arg).split(",").map(Number);
    out.may = await sql`select m.id, m.code, m.name, m."machineType", m."operationStatus", m."isActive", s."lineId", s.id as "stationId"
      from machines m left join stations s on s.id=m."stationId" where m.id in ${sql(ids)} order by m.id`;
  } else if (lenh === "tang-cua-toa") {
    const tid = Number(arg);
    out.tang = await sql`select id, "toaNhaId", "capSo", ten from twin_tang where "toaNhaId"=${tid} order by "capSo"`;
  } else if (lenh === "toa-cua-nha-may") {
    const fid = Number(arg);
    out.toa = await sql`select id, ma, ten, "factoryId", "rongMm", "sauMm" from twin_toa_nha where "factoryId"=${fid} order by id`;
  } else if (lenh === "audit-dem") {
    /* ★ `andon.acknowledge` và `maintenance.createWorkOrder` mỗi lượt còn ghi MỘT hàng
       `audit_logs` (entityName = tiêu đề). Đếm để không bỏ sót hàng nào lô này sinh ra. */
    out.tong = (await sql`select count(*)::int n from audit_logs`)[0].n;
    out.tam = await sql`select id, "userId", action, "entityType", "entityId", "entityName", ("createdAt" AT TIME ZONE 'UTC') as tao_utc
      from audit_logs where "entityName" like ${LIKE} order by id`;
  } else if (lenh === "audit-xoa-tam") {
    out.truoc = (await sql`select count(*)::int n from audit_logs`)[0].n;
    out.hang = await sql`select id, action, "entityType", "entityId", "entityName" from audit_logs where "entityName" like ${LIKE}`;
    out.daXoa = (await sql`delete from audit_logs where "entityName" like ${LIKE}`).count;
    out.sau = (await sql`select count(*)::int n from audit_logs`)[0].n;
  } else {
    out.err = "lenh? dem|quyen|andon-tam|wo-dem|wo-liet|wo-xoa|vung-dem|vung-liet|vung-xoa-tam|audit-dem|audit-xoa-tam|may|tang-cua-toa|toa-cua-nha-may";
  }
} catch (e) {
  out.err = e.message;
} finally {
  await sql.end();
}
console.log(JSON.stringify(out, null, 1));

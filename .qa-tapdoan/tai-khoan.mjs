// QA lần 11 — tài khoản 4 vai + 3 đối chứng, tiền tố qatd_. Chạy từ gốc repo:
//   node .qa-tapdoan/tai-khoan.mjs tao | xoa | dem | in
// Khuôn cột theo server/db/auth.ts:276-316 (createLocalUser) + _twin_wt/.qa-dot41/user-tam.mjs:20-34.
// Mật khẩu chung: Qatd!2026 (bcrypt cost 10). two_factor_enabled để mặc định false ⇒ đăng nhập API một bước.
import postgres from "postgres";
import fs from "node:fs";
import bcrypt from "bcryptjs";
const url = fs.readFileSync(".env","utf8").split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL="))?.slice(13).replace(/^["']|["']$/g,"");
const sql = postgres(url, { max: 1 });
export const MAT_KHAU = "Qatd!2026";
// quyền: [moduleName, category, view, create, edit, delete]
const V = (m,c)=>[m,c,true,false,false,false];
const VE = (m,c)=>[m,c,true,false,true,false];
const VCE = (m,c)=>[m,c,true,true,true,false];
const VCED = (m,c)=>[m,c,true,true,true,true];
export const TAI_KHOAN = [
  { ten:"qatd_giamdoc",  vai:"GIÁM ĐỐC",  role:"supervisor", name:"Giám đốc tập đoàn (QA)", ganTapDoan:["QATD"], ganNhaMay:[],
    quyen:[V("analytics_oee","analytics"), V("machine_status","machine_monitoring"), V("dashboard_corporate","dashboard"), V("dashboard_view","dashboard"), V("andon","andon"), V("history_view","history")] },
  { ten:"qatd_quanly",   vai:"QUẢN LÝ",   role:"supervisor", name:"Quản đốc Công ty A (QA)", ganTapDoan:[], ganNhaMay:["QATD-A"],
    quyen:[V("analytics_oee","analytics"), V("machine_status","machine_monitoring"), VE("machine_control","machine_control"), VE("andon","andon"), V("dashboard_corporate","dashboard"), V("dashboard_view","dashboard"), V("history_view","history")] },
  { ten:"qatd_kythuat",  vai:"KỸ THUẬT",  role:"engineer",   name:"Kỹ sư thiết bị A+B (QA)", ganTapDoan:[], ganNhaMay:["QATD-A","QATD-B"],
    quyen:[VCE("machine_status","machine_monitoring"), VCE("machine_control","machine_control"), VCED("settings_factory","settings"), VE("andon","andon"), V("dashboard_view","dashboard"), V("history_view","history")] },
  { ten:"qatd_congnhan", vai:"CÔNG NHÂN", role:"operator",   name:"Công nhân Công ty C (QA)", ganTapDoan:[], ganNhaMay:["QATD-C"],
    quyen:[V("machine_status","machine_monitoring"), VE("andon","andon"), V("dashboard_view","dashboard")] },
  // đối chứng
  { ten:"qatd_admin",    vai:"ĐỐI CHỨNG admin (bypass, thấy hết)", role:"admin", name:"Admin QA", ganTapDoan:[], ganNhaMay:[], quyen:[] },
  { ten:"qatd_khonggan", vai:"ĐỐI CHỨNG có quyền, 0 gán (kỳ vọng rỗng chuaGanNhaMay)", role:"operator", name:"Công nhân chưa gán (QA)", ganTapDoan:[], ganNhaMay:[], quyen:[V("machine_status","machine_monitoring")] },
  { ten:"qatd_khongquyen", vai:"ĐỐI CHỨNG 0 quyền (kỳ vọng CHẶN-ĐÚNG)", role:"user", name:"Người dùng không quyền (QA)", ganTapDoan:[], ganNhaMay:["QATD-A"], quyen:[] },
];
const che = process.argv[2] ?? "in";
const dem = async () => {
  const [u] = await sql`select count(*)::int n from users where username like 'qatd\_%'`;
  const [p] = await sql`select count(*)::int n from permissions where "userId" in (select id from users where username like 'qatd\_%')`;
  const [f] = await sql`select count(*)::int n from user_factory_assignments where "userId" in (select id from users where username like 'qatd\_%')`;
  const [c] = await sql`select count(*)::int n from user_corporate_assignments where "userId" in (select id from users where username like 'qatd\_%')`;
  const [tong] = await sql`select count(*)::int n from users`;
  return { users_qatd: u.n, permissions: p.n, gan_nha_may: f.n, gan_tap_doan: c.n, users_tong: tong.n };
};
if (che === "in") { console.table(TAI_KHOAN.map(t=>({ ten:t.ten, vai:t.vai, role:t.role, gan:[...t.ganTapDoan.map(x=>"TĐ:"+x), ...t.ganNhaMay].join(","), quyen:t.quyen.map(q=>q[0]+":"+["V","C","E","D"].filter((_,i)=>q[2+i]).join("")).join(" ") }))); }
if (che === "dem") console.log(JSON.stringify(await dem()));
if (che === "tao") {
  const truoc = await dem(); if (truoc.users_qatd > 0) { console.log("ĐÃ CÓ tài khoản qatd_ — chạy xoa trước"); await sql.end(); process.exit(1); }
  const hash = await bcrypt.hash(MAT_KHAU, 10);
  const [adm] = await sql`select id from users where role='admin' order by id limit 1`;
  await sql.begin(async (tx) => {
    for (const t of TAI_KHOAN) {
      const openId = "local_" + Date.now() + "_" + t.ten;
      const [u] = await tx`insert into users ("openId", username, name, "loginMethod", role, "isActive", "passwordChangedAt") values (${openId}, ${t.ten}, ${t.name}, 'local', ${t.role}, true, now()) returning id`;
      await tx`insert into user_secrets ("userId","passwordHash") values (${u.id}, ${hash})`;
      for (const [m,c,v,cr,e,d] of t.quyen) await tx`insert into permissions ("userId",category,"moduleName","canView","canCreate","canEdit","canDelete","canExport") values (${u.id}, ${c}, ${m}, ${v}, ${cr}, ${e}, ${d}, false)`;
      for (const f of t.ganNhaMay) await tx`insert into user_factory_assignments ("userId","factoryCode","assignedBy") values (${u.id}, ${f}, ${adm?.id ?? u.id})`;
      for (const c of t.ganTapDoan) await tx`insert into user_corporate_assignments ("userId","corporateCode","assignedBy") values (${u.id}, ${c}, ${adm?.id ?? u.id})`;
      console.log(`tạo ${t.ten} id=${u.id} role=${t.role} quyền=${t.quyen.length} gán=${t.ganNhaMay.length}+TĐ${t.ganTapDoan.length}`);
    }
  });
  console.log("sau:", JSON.stringify(await dem()));
}
if (che === "xoa") {
  const ids = (await sql`select id from users where username like 'qatd\_%'`).map(r=>r.id);
  if (!ids.length) { console.log("không có gì để xoá"); }
  else {
    await sql.begin(async (tx) => {
      const p = await tx`delete from permissions where "userId" = any(${ids})`;
      const f = await tx`delete from user_factory_assignments where "userId" = any(${ids})`;
      const c = await tx`delete from user_corporate_assignments where "userId" = any(${ids})`;
      const u = await tx`delete from users where id = any(${ids})`; // user_secrets ON DELETE CASCADE (auth.ts:110)
      console.log(`xoá permissions=${p.count} gán_nm=${f.count} gán_tđ=${c.count} users=${u.count}`);
    });
  }
  console.log("sau:", JSON.stringify(await dem()));
}
await sql.end();

// ĐỢT 48 · D-4 — LỐI VÀO HTTP `/api/v1/machines/:id/detail` (moduleReads.ts:421 `machineDetail(machineId)` KHÔNG scope) bằng API key TẠM
//   CHỈ nhà máy 1 (dataScopeMode=factory, factoryCode=SIM-FAC, scopes [equipment:read]). node .qa-dot49/http-v1.mjs --key=<key> [--base=…]
import { request } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const KEY = arg("key", ""); const BASE = arg("base", "http://localhost:3049");
// ★★★ ĐỢT 49 — ĐƯỜNG RA LẤY TỪ ENV. Bản chép nguyên văn của QA ghi CỨNG `.qa-dot48/api-vai`, nên
//   lượt D-4 của tôi ĐÃ GHI ĐÈ 13 tệp TRACKED của Đợt 48 (đã khôi phục byte-exact bằng
//   `git show HEAD:<tep>`). Đúng cùng lớp lỗi mà mục F vừa vá cho `e2e/twin-dot47-bam-canh.spec.ts`
//   — và tôi dính nó ở một tệp KHÁC trong cùng phiên: sửa MỘT chỗ ghi cứng không đóng được lớp lỗi,
//   phải quét MỌI harness có đường ra ghi cứng (G110 "cùng kit, màn thứ ba không quét").
const OUT = process.env.API_VAI_OUT || ".qa-dot49/api-vai"; mkdirSync(OUT, { recursive: true });
const ctx = await request.newContext({ baseURL: BASE });
const kq = { luc: new Date().toISOString(), ds: [] };
async function goi(ten, path, headers) { const r = await ctx.get(path, { headers }); const t = await r.text(); const row = { ten, path, status: r.status(), bytes: t.length, coSIM: /SIM-/.test(t), coT12: /T12-SHOT|mtlt8goc8429/.test(t), tho: t.slice(0, 160).replace(/\s+/g, " ") }; kq.ds.push(row); console.log(`   [http-v1] ${ten.padEnd(46)} ${row.status} SIM=${row.coSIM ? "CO" : "-"} T12=${row.coT12 ? "CO" : "-"} ${row.tho.slice(0, 90)}`); }
await goi("KHONG khoa: /machines/257/detail (doi chung 401)", "/api/v1/machines/257/detail", {});
await goi("khoa SIM-FAC: /machines/14/detail (NM1)", "/api/v1/machines/14/detail", { "X-API-Key": KEY });
await goi("khoa SIM-FAC: /machines/257/detail (NM18)", "/api/v1/machines/257/detail", { "X-API-Key": KEY });
await goi("khoa SIM-FAC: /robots/1/detail", "/api/v1/robots/1/detail", { "X-API-Key": KEY });
await goi("khoa SIM-FAC: /machines/999999/detail (doi chung 404)", "/api/v1/machines/999999/detail", { "X-API-Key": KEY });
writeFileSync(`${OUT}/http-v1.json`, JSON.stringify(kq, null, 2)); await ctx.dispose();

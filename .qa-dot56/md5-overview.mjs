// ĐỢT 53 · mục C — ĐỐI CHỨNG ĐẦU RA BẰNG BYTE: `factoryCommand.overview` phải KHÔNG ĐỔI sau khi
//   đổi cột ORDER BY. Đo trên ≥ 2 VAI (phạm vi khác nhau ⇒ tập máy khác nhau ⇒ hai đường đọc).
//   md5 tính trên bản ĐÃ CHUẨN HOÁ: bỏ các trường suy từ ĐỒNG HỒ (ageMinutes…), giữ mọi thứ còn lại.
//   node .qa-dot56/md5-overview.mjs --out=.qa-dot56/md5-ov-truoc.json [--base=http://localhost:3053]
import { request } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const BASE = arg("base", "http://localhost:3053");
const OUT = arg("out", ".qa-dot56/md5-ov.json");
mkdirSync(".qa-dot56/ov", { recursive: true });
// ⚠ ĐO ĐƯỢC 2026-09-12 trên 3053: trong 6 vai của nền Đợt 52 chỉ còn `e2e_tai_loE` và `operator1`
//   đăng nhập được (4 vai TẠM kia đã bị xoá sau đợt của chúng; `users` vẫn 10 — DB không đổi).
//   Tạo lại user là ghi DB dev ⇒ vi phạm bất biến của đợt này ⇒ dùng 2 vai còn sống (brief đòi ≥ 2).
const VAI = {
  A: { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" },
  B: { username: "operator1", password: "User@123" },
};
/** Trường suy từ ĐỒNG HỒ — đổi giữa hai lần đo dù dữ liệu y nguyên. Bỏ để md5 nói về DỮ LIỆU. */
const KHOA_THEO_DONG_HO = new Set(["ageMinutes", "doTuoiGiay", "tuoiGiay", "ageSeconds", "generatedAt", "luc", "now"]);
const chuanHoa = (v) => {
  if (Array.isArray(v)) return v.map(chuanHoa);
  if (v && typeof v === "object") {
    const ra = {};
    for (const k of Object.keys(v).sort()) { if (!KHOA_THEO_DONG_HO.has(k)) ra[k] = chuanHoa(v[k]); }
    return ra;
  }
  return v;
};
const kq = { luc: new Date().toISOString(), base: BASE, vai: {} };
for (const [ten, tk] of Object.entries(VAI)) {
  const ctx = await request.newContext({ baseURL: BASE });
  const lg = await ctx.post("/api/auth/login", { data: tk });
  const r = await ctx.get(`/api/trpc/factoryCommand.overview?input=${encodeURIComponent(JSON.stringify({ json: { factoryId: 1 } }))}`);
  const tho = await r.text();
  let data = null; try { data = JSON.parse(tho)?.result?.data?.json ?? null; } catch {}
  const ch = JSON.stringify(chuanHoa(data));
  const may = data?.machines ?? [];
  kq.vai[ten] = {
    user: tk.username, login: lg.status(), httpStatus: r.status(),
    soMay: may.length,
    md5ChuanHoa: createHash("md5").update(ch).digest("hex"),
    md5Tho: createHash("md5").update(tho).digest("hex"),
    bytes: tho.length,
    // PdM risk là ô mà câu mục C nuôi — in thẳng để thấy nó không đổi.
    pdmRiskHigh: may.filter((m) => m.pdmRiskHigh).length,
    // ô mà câu mục C nuôi — liệt kê ĐẦY ĐỦ theo máy để so từng ô, không chỉ so tổng.
    pdmTheoMay: may.map((m) => `${m.id}:${m.pdmRiskHigh ? 1 : 0}`).join(","),
    mauPdm: may.slice(0, 5).map((m) => ({ id: m.id, status: m.status, pdmRiskHigh: m.pdmRiskHigh, oee: m.oee })),
    soIssue: (data?.issues ?? []).length,
  };
  writeFileSync(`.qa-dot56/ov/${ten}-${OUT.includes("truoc") ? "truoc" : "sau"}.json`, ch);
  await ctx.dispose();
  console.log(`   [${ten} ${tk.username}] login ${lg.status()} · http ${r.status()} · máy ${kq.vai[ten].soMay} · issue ${kq.vai[ten].soIssue} · md5(chuẩn hoá) ${kq.vai[ten].md5ChuanHoa}`);
}
writeFileSync(OUT, JSON.stringify(kq, null, 2));

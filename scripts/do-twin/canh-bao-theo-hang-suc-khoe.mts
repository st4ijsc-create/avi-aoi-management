/**
 * N4 / V-21(1) — lượt 2: ĐO LẠI + ĐỐI CHỨNG XÁO TRỘN.
 *
 * Lượt 1 cho 14,5 → 31,3 → 45,5 → 58,2 % (đơn điệu tăng). Trước khi kết luận, phải loại
 * khả năng **chính HÌNH DẠNG truy vấn sinh ra xu hướng**. Đối chứng: gán NGẪU NHIÊN máy vào
 * bốn hạng (giữ nguyên cỡ mỗi hạng), chạy lại đúng phép đếm ấy. Nếu xu hướng vẫn còn ⇒ phép
 * đo tự thoả, kết luận vứt. Nếu phẳng quanh tỉ lệ nền ⇒ xu hướng đến từ DỮ LIỆU.
 */
import postgres from "postgres";
const url = process.env.DATABASE_URL;
if (!url) { console.log("KHONG co DATABASE_URL"); process.exit(0); }
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
try {
  const r = await sql<{ machineId: number; hs: number; cb: number }[]>`
    WITH sk AS (
      SELECT DISTINCT ON (h."machineId") h."machineId", h."healthScore"
      FROM machine_health_history h ORDER BY h."machineId", h."createdAt" DESC
    ), cb AS (
      SELECT DISTINCT "machineId" FROM predictive_alerts
      WHERE "createdAt" >= now() - interval '30 days'
    )
    SELECT sk."machineId", sk."healthScore"::float AS hs,
           (cb."machineId" IS NOT NULL)::int AS cb
    FROM sk LEFT JOIN cb USING ("machineId") WHERE sk."healthScore" IS NOT NULL`;

  const hang = (hs: number) => (hs >= 85 ? 0 : hs >= 70 ? 1 : hs >= 50 ? 2 : 3);
  const TEN = ["A 85-100", "B 70-84", "C 50-69", "D <50"];
  const dem = (ganHang: (i: number) => number) => {
    const may = [0, 0, 0, 0], co = [0, 0, 0, 0];
    r.forEach((x, i) => { const h = ganHang(i); may[h]++; co[h] += x.cb; });
    return may.map((m, h) => (m ? (100 * co[h]) / m : NaN));
  };

  const that = dem((i) => hang(r[i].hs));
  console.log("═══ THẬT ═══");
  TEN.forEach((t, h) => console.log(`  ${t.padEnd(9)} | ${that[h].toFixed(1)} %`));
  const nen = (100 * r.reduce((s, x) => s + x.cb, 0)) / r.length;
  console.log(`  tỉ lệ NỀN (mọi máy) = ${nen.toFixed(1)} %`);

  // ĐỐI CHỨNG: giữ nguyên cỡ bốn hạng, xáo ai vào hạng nào.
  const coHang = r.map((x) => hang(x.hs));
  const bienDoThat = Math.max(...that) - Math.min(...that);
  let soLanVuot = 0, bienMax = 0;
  const LAN = 200;
  for (let k = 0; k < LAN; k++) {
    const xao = coHang.slice();
    for (let i = xao.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [xao[i], xao[j]] = [xao[j], xao[i]];
    }
    const t = dem((i) => xao[i]);
    const b = Math.max(...t) - Math.min(...t);
    bienMax = Math.max(bienMax, b);
    if (b >= bienDoThat) soLanVuot++;
  }
  console.log(`\n═══ ĐỐI CHỨNG xáo trộn (${LAN} lượt, giữ nguyên cỡ hạng) ═══`);
  console.log(`  biên độ THẬT           = ${bienDoThat.toFixed(1)} điểm %`);
  console.log(`  biên độ XÁO lớn nhất   = ${bienMax.toFixed(1)} điểm %`);
  console.log(`  số lượt xáo ≥ thật     = ${soLanVuot}/${LAN}`);
  console.log(`  ⇒ ${soLanVuot === 0 ? "xu hướng KHÔNG đến từ hình dạng truy vấn" : "CẢNH BÁO: phép đo có thể tự thoả"}`);
} catch (e) { console.log("LOI:", String(e).slice(0, 300)); }
await sql.end();

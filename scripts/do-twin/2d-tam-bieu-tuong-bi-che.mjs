/**
 * v6-2d-che-tam.mjs — KHẢO SÁT: **cái gì** đang nằm trên tâm biểu tượng toà ở bản 2D?
 *
 * Vòng 5 đo được "2/14 biểu tượng có tâm nằm dưới huy hiệu nhỏ", nhưng **không nêu tên** hai
 * huy hiệu ấy — tức chưa đủ để vá. Phép đo này hỏi thẳng `elementFromPoint` tại tâm từng
 * biểu tượng và mô tả kẻ đứng trên, kèm **chuỗi tổ tiên** để lần ra component.
 *
 * ⚠ Không kết luận từ mã nguồn: một lớp phủ có thể `pointer-events:none` (vô hại) hoặc
 *   nằm ngoài luồng (vô hại). Chỉ thứ `elementFromPoint` trả về mới thật sự chặn cú bấm.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3000";
const nghi = (m) => new Promise((r) => setTimeout(r, m));

const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
await c.request.post(`${BASE}/api/auth/login`, {
  data: { username: "qatd_admin", password: "Qatd!2026" },
});
const p = await c.newPage();
await p.goto(`${BASE}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
await p.waitForSelector('[data-testid="nut-che-2d"]', { timeout: 30000 }).catch(() => {});
await nghi(9000);
await p.click('[data-testid="nut-che-2d"]');
await nghi(8000);

const kq = await p.evaluate(() => {
  const ta = (el) => {
    const d = [];
    for (const a of el.attributes) if (a.name.startsWith("data-")) d.push(`${a.name}=${a.value}`);
    return d.join(" ");
  };
  const moTa = (el) => {
    if (!el) return "(khong co)";
    const cls = typeof el.className === "string" ? el.className : el.className?.baseVal ?? "";
    return `<${el.tagName.toLowerCase()}> ${ta(el)}${cls ? ` class="${String(cls).slice(0, 70)}"` : ""}`;
  };
  const toCheNhan = (el) => {
    for (let n = el; n; n = n.parentElement) if (n.hasAttribute?.("data-che-nhan")) return moTa(n);
    return null;
  };

  const toa = [...document.querySelectorAll('[data-testid="toa-2d-sa-ban"]')];
  const hang = toa.map((t, i) => {
    const r = t.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const tren = document.elementFromPoint(cx, cy);
    const laChinhNo = tren === t || t.contains(tren);
    const toTien = [];
    for (let n = tren; n && toTien.length < 6; n = n.parentElement) {
      const id = n.getAttribute?.("data-testid");
      if (id) toTien.push(id);
    }
    return {
      i,
      toaNhaId: t.getAttribute("data-toa-nha-id"),
      factoryId: t.getAttribute("data-factory-id"),
      cx, cy,
      rong: Math.round(r.width), cao: Math.round(r.height),
      canhNho: Math.round(Math.min(r.width, r.height)),
      thongTam: laChinhNo,
      treTren: laChinhNo ? null : moTa(tren),
      toTien: laChinhNo ? null : toTien,
      coCheNhan: laChinhNo ? null : toCheNhan(tren),
    };
  });

  // Mọi lớp phủ ĐANG khai `data-che-nhan` — để biết cơ chế có chạy không.
  const daKhai = [...document.querySelectorAll("[data-che-nhan]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { mo: moTa(el), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });

  return { soToa: toa.length, hang, daKhai };
});

console.log(`số biểu tượng toà 2D: ${kq.soToa}`);
console.log(`thông tâm (bấm được tại TÂM): ${kq.hang.filter((h) => h.thongTam).length}/${kq.soToa}`);
console.log("");
for (const h of kq.hang) {
  const c1 = `#${String(h.i).padStart(2)} toà=${String(h.toaNhaId).padStart(4)} nm=${String(h.factoryId).padStart(3)}`;
  const c2 = `tâm=(${String(h.cx).padStart(4)},${String(h.cy).padStart(3)}) ${String(h.rong).padStart(3)}×${String(h.cao).padStart(3)} nhỏ=${String(h.canhNho).padStart(3)}px`;
  if (h.thongTam) console.log(`  ✅ ${c1} ${c2}`);
  else {
    console.log(`  ❌ ${c1} ${c2}`);
    console.log(`       BỊ CHE BỞI: ${h.treTren}`);
    console.log(`       tổ tiên   : ${JSON.stringify(h.toTien)}`);
    console.log(`       che-nhan? : ${h.coCheNhan ?? "KHÔNG — lớp phủ này KHÔNG khai data-che-nhan"}`);
  }
}
console.log(`\n── lớp phủ ĐÃ khai data-che-nhan: ${kq.daKhai.length} ──`);
for (const d of kq.daKhai) console.log(`  ${d.x},${d.y} ${d.w}×${d.h}  ${d.mo}`);

await p.screenshot({ path: "scripts/do-twin/_tho/v6-2d-che-tam.png" });
await b.close();

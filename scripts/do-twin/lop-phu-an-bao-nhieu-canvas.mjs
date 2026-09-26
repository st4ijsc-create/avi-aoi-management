#!/usr/bin/env node
/**
 * lop-phu-an-bao-nhieu-canvas.mjs — **TRẢ MỘT DÒNG NỢ TRONG SỔ TRUY VẤN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CON SỐ ĐANG ĐƯỢC VIỆN DẪN: "lớp phủ ăn 58,2 % canvas @1280×720"
 * ════════════════════════════════════════════════════════════════════════════
 * Vòng 3 đo được lớp phủ DOM ăn **70,8 %** canvas, thu panel xuống còn **58,2 %**, và con số
 * 58,2 % được trích lại từ đó tới nay **mà không ai ghi truy vấn**. Kịch bản này là truy vấn ấy.
 *
 * ★ ĐỊNH NGHĨA (phải viết ra, vì thiếu nó thì không so được hai lần đo):
 *   · **lớp phủ** := mọi phần tử khai `data-che-nhan` — đúng tập mà `layVungCam()` đọc, không
 *     phải "mọi thứ trông như che".
 *   · **phủ** := diện tích **HỢP** của các hình chữ nhật ấy, cắt trong khung canvas.
 *     Dùng hợp chứ không cộng: hai panel chồng mép sẽ bị đếm hai lần nếu cộng, và con số
 *     phồng lên mà không ai biết.
 *   · **mẫu số** := diện tích canvas `[data-testid="khoi-canh-3d"] canvas`, không phải cả màn.
 *
 * ⚠ Con số phụ thuộc **trạng thái panel**: mở hết vs thu hết cho hai kết quả khác hẳn (chính
 *   đó là nội dung của phát hiện vòng 3). Nên kịch bản đo **cả hai** và in ra cả hai.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const nghi = (m) => new Promise((r) => setTimeout(r, m));

/** Diện tích HỢP của một tập hình chữ nhật — quét dòng theo mốc x. */
function dienTichHop(hcn) {
  const xs = [...new Set(hcn.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let tong = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    const be = hcn.filter((r) => r.x <= x0 && r.x + r.w >= x1).map((r) => [r.y, r.y + r.h]);
    if (be.length === 0) continue;
    be.sort((a, b) => a[0] - b[0]);
    let cao = 0;
    let [ky0, ky1] = be[0];
    for (let k = 1; k < be.length; k++) {
      if (be[k][0] > ky1) {
        cao += ky1 - ky0;
        [ky0, ky1] = be[k];
      } else if (be[k][1] > ky1) ky1 = be[k][1];
    }
    cao += ky1 - ky0;
    tong += (x1 - x0) * cao;
  }
  return tong;
}

const b = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const c = await b.newContext({ viewport: { width: 1280, height: 720 } });
await c.request.post(`${BASE}/api/auth/login`, {
  data: { username: "qatd_admin", password: "Qatd!2026" },
});

for (const [ten, url] of [
  // ⚠ Hồ sơ vòng 3 đo màn MỘT NHÀ MÁY (`/twin` mặc định), không phải cấp tập đoàn.
  //   Đo cả hai phạm vi: so số cũ với số cùng phạm vi mới là so, không thì là nguỵ biện.
  ["một nhà máy · panel MỞ", "/twin?do=1"],
  ["một nhà máy · panel THU", "/twin?do=1&thu=trai,phai,kpi"],
  ["tập đoàn · panel MỞ", "/twin?pv=tapdoan&do=1"],
  ["tập đoàn · panel THU", "/twin?pv=tapdoan&do=1&thu=trai,phai,kpi"],
]) {
  const p = await c.newPage();
  await p.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  await nghi(16000);
  const r = await p.evaluate(() => {
    const cv = document.querySelector("canvas");
    if (!cv) return null;
    const k = cv.getBoundingClientRect();
    const phu = [...document.querySelectorAll("[data-che-nhan]")]
      .map((e) => e.getBoundingClientRect())
      .map((q) => ({
        x: Math.max(q.left, k.left),
        y: Math.max(q.top, k.top),
        w: Math.min(q.right, k.right) - Math.max(q.left, k.left),
        h: Math.min(q.bottom, k.bottom) - Math.max(q.top, k.top),
      }))
      .filter((q) => q.w > 0 && q.h > 0);
    return { canvas: { w: k.width, h: k.height }, so: phu.length, phu };
  });
  if (!r) {
    console.log(`${ten}: KHÔNG có canvas — lỗi hệ đo, không phải kết quả.`);
    await p.close();
    continue;
  }
  const dt = dienTichHop(r.phu);
  const tong = r.canvas.w * r.canvas.h;
  console.log(
    `${ten.padEnd(22)} canvas ${Math.round(r.canvas.w)}×${Math.round(r.canvas.h)} · ` +
      `${r.so} lớp phủ · phủ ${((100 * dt) / tong).toFixed(1)} % · còn trống ${((100 * (tong - dt)) / tong).toFixed(1)} %`,
  );
  await p.close();
}

console.log("\n── ĐỐI CHIẾU ──");
console.log("  hồ sơ vòng 3 ghi: 70,8 % (panel mở) → 58,2 % (sau khi thu panel)");
console.log("  ⇒ so hàng 'panel MỞ' và 'panel THU hết' ở trên. Lệch thì con số cũ đã hết hạn.");
await b.close();

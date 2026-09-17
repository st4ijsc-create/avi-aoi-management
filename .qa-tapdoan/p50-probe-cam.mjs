/**
 * p50-probe-cam.mjs — ĐỌC CAMERA THẬT trong cảnh 3D (near/far/vị trí) + cỡ sàn,
 * để biết vì sao `hopChieu` trả `null` cho 14/14 toà ở `qatd_admin`.
 *   node .qa-tapdoan/p50-probe-cam.mjs [vai...]
 */
import { chromium } from "playwright";
const GOC = "http://localhost:3064";
const MK = "Qatd!2026";
const VAI = process.argv.slice(2).length ? process.argv.slice(2) : ["qatd_admin", "qatd_giamdoc", "qatd_congnhan"];

const trinh = await chromium.launch({ args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"] });
for (const vai of VAI) {
  const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.request.post(`${GOC}/api/auth/login`, { data: { username: vai, password: MK } });
  await page.goto(`${GOC}/twin?pv=tapdoan&do=1`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("man-twin-van-hanh").waitFor({ timeout: 90_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const n = document.querySelectorAll("[data-testid='nhan-cum-sa-ban']").length;
        const on = window.__p50 === n && n > 0;
        window.__p50 = n;
        return on;
      },
      undefined,
      { timeout: 120_000, polling: 1000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);

  const ra = await page.evaluate(() => {
    const cv = document.querySelector("canvas");
    const r3f = cv && cv.__r3f;
    const st = r3f?.root?.getState?.() ?? null;
    const cam = st?.camera ?? null;
    const scn = st?.scene ?? null;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    let hopCanh = null;
    if (scn && window.THREE_BOX3) hopCanh = "n/a";
    // Bao hình cảnh: tự duyệt, không cần THREE (đọc geometry.boundingBox qua matrixWorld là quá sâu)
    const nhom = [];
    scn?.traverse?.((o) => {
      if (o.isInstancedMesh) nhom.push({ ten: o.name || o.type, count: o.count, visible: o.visible });
      else if (o.name) nhom.push({ ten: o.name, type: o.type, visible: o.visible });
    });
    return {
      cam: cam
        ? {
            type: cam.type,
            near: cam.near,
            far: cam.far,
            fov: cam.fov,
            viTri: { x: r3(cam.position.x), y: r3(cam.position.y), z: r3(cam.position.z) },
            huong: { x: r3(cam.getWorldDirection?.(new cam.position.constructor()).x ?? 0) },
          }
        : null,
      khoangCachGoc: cam ? r3(Math.hypot(cam.position.x, cam.position.y, cam.position.z)) : null,
      nhom: nhom.slice(0, 25),
    };
  });
  console.log(`\n══ ${vai} ══\n` + JSON.stringify(ra, null, 1));
  await ctx.close();
}
await trinh.close();

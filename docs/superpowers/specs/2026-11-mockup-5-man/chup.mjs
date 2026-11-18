// Chụp PNG từ HTML tĩnh bằng Playwright (không cần server app). Chạy: node chup.mjs [man-1 man-4 man-5]
// Tên ảnh: man-<n>-<trang-thai>-<kich-thuoc>.png ; kích thước 1280x800 (comfortable) và 1920x1080 (default).
import { chromium } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const dir = fileURLToPath(new URL("./", import.meta.url));
const SIZES = [["1280x800", 1280, 800, "comfortable"], ["1920x1080", 1920, 1080, "default"]];
// [tệp, tiền tố ảnh, [[tên trạng thái trong tên ảnh, query]]]
const PLAN = {
  "man-1": ["man-1-home.html", "man-1", [
    ["binh-thuong-giam-sat", "state=binh-thuong&role=giam-sat"],
    ["p1-chua-ack-giam-sat", "state=p1-chua-ack&role=giam-sat"],
    ["du-lieu-cu-giam-sat", "state=du-lieu-cu&role=giam-sat"],
    ["binh-thuong-van-hanh", "state=binh-thuong&role=van-hanh"],
    ["p1-chua-ack-van-hanh", "state=p1-chua-ack&role=van-hanh"],
    ["binh-thuong-ky-su", "state=binh-thuong&role=ky-su"],
    ["binh-thuong-quan-ly", "state=binh-thuong&role=quan-ly"],
    ["p1-chua-ack-quan-ly", "state=p1-chua-ack&role=quan-ly"],
    ["binh-thuong-quan-tri", "state=binh-thuong&role=quan-tri"],
    ["p1-chua-ack-quan-tri", "state=p1-chua-ack&role=quan-tri"],
    ["du-lieu-cu-quan-tri", "state=du-lieu-cu&role=quan-tri"],
  ]],
  "man-4": ["man-4-canh-bao.html", "man-4", [
    ["12-hon-hop", "state=hon-hop"],
    ["lu-canh-bao", "state=lu"],
    ["du-lieu-cu-p1-nguon-cu", "state=du-lieu-cu"],
    ["p1-tuoi-line-khac-cu", "state=p1-tuoi-line-cu"],
    ["chi-tiet-ngan-phai", "state=chi-tiet"],
  ]],
  "man-5": ["man-5-tai-san.html", "man-5", [
    ["may-that", "state=may-that"],
    ["may-mo-phong", "state=may-sim&scope=sim"],
    ["ngoai-pham-vi", "state=ngoai-pham-vi"],
    ["them-thiet-bi-buoc-3", "state=wizard"],
  ]],
};
const chon = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLAN);
const b = await chromium.launch();
let n = 0;
for (const k of chon) {
  const [tep, pre, ds] = PLAN[k];
  for (const [ten, q] of ds) for (const [kt, w, h, den] of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const extra = q.includes("rail=") ? "" : "&rail=" + (w >= 1920 ? "open" : "closed");
    await p.goto(pathToFileURL(dir + tep).href + `?${q}${extra}&density=${den}&shot=1`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${dir}${pre}-${ten}-${kt}.png`, fullPage: false });
    await p.close(); n++;
  }
}
await b.close();
console.log("chup xong", n, "anh");

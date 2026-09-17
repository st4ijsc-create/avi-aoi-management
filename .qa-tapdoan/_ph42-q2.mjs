/**
 * _ph42-q2.mjs — CÂU 2 CỦA BRIEF, ĐO CHO SẮC: "bấm LẠI đúng máy đang chọn".
 *
 * Lượt đo đầu (`_ph42-do.mjs`) bị NHIỄU: `selectMachine` đặt `focusId` ⇒ camera BAY,
 * nên toạ độ px của máy sau khi chọn KHÁC lúc trước. Lượt này đọc lại `dsMay()` SAU
 * khi camera dừng rồi mới bấm, và ghi luôn PHẦN TỬ DOM TRÊN CÙNG tại đúng điểm ấy —
 * vì giả thuyết cạnh tranh là "cú bấm không bao giờ tới được cảnh".
 */
import { chromium } from "playwright";
import fs from "node:fs";

const NHAN = process.argv[2] ?? "truoc";
const GOC = process.env.PH42_GOC ?? "http://localhost:3066";
const THU_MUC = `.qa-tapdoan/anh/ph42-q2-${NHAN}`;
fs.mkdirSync(THU_MUC, { recursive: true });

const trinh = await chromium.launch({
  args: ["--use-angle=default", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const ctx = await trinh.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const loi = [];
page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)));

await page.request.post(`${GOC}/api/auth/login`, {
  data: { username: "qatd_giamdoc", password: "Qatd!2026" },
});
await page.goto(`${GOC}/factory-command?do=1`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: "3D", exact: true }).click();
await page
  .waitForFunction(() => (window.__demTuongTac?.dsMay?.()?.length ?? 0) > 0, undefined, {
    timeout: 120_000,
    polling: 500,
  })
  .catch(() => {});
await page.waitForTimeout(2500);

const doTrangThai = () =>
  page.evaluate(() => {
    const sheet = document.querySelector("[data-slot='sheet-content']");
    const nhan = [...document.querySelectorAll("[data-testid='nhan-may-twin3d']")].map((e) => ({
      id: Number(e.getAttribute("data-machine-id")),
      chon: /59, 130, 246|#3b82f6|--primary/.test(e.style.border),
    }));
    return {
      sheetMo: Boolean(sheet),
      sheetTieuDe: sheet?.querySelector("[data-slot='sheet-title']")?.textContent?.trim() ?? null,
      overlay: document.querySelectorAll("[data-slot='sheet-overlay']").length,
      nhanChon: nhan.filter((n) => n.chon).map((n) => n.id),
      soNhan: nhan.length,
      // ★ cửa sổ đo CHỌN (chỉ có khi bản dựng đã gắn probe) — `null` = KHÔNG ĐO ĐƯỢC.
      chonCanh: window.__demChonChiHuy?.() ?? null,
    };
  });

/** Toạ độ client của tâm một máy, đọc LẠI ngay lúc gọi. */
const tamMay = (id) =>
  page.evaluate((mid) => {
    const canvas = document.querySelector("canvas");
    const r = canvas.getBoundingClientRect();
    const m = (window.__demTuongTac?.dsMay?.() ?? []).find((x) => x.machineId === mid);
    if (!m) return null;
    return { x: r.left + m.x, y: r.top + m.y, trongKhung: m.trongKhung, biChe: null };
  }, id);

const elTai = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el
        ? { the: el.tagName, slot: el.getAttribute("data-slot"), testid: el.getAttribute("data-testid") }
        : null;
    },
    [x, y],
  );

const so = { buoc: [] };
const ghi = async (ten, them = {}) => {
  const tt = await doTrangThai();
  so.buoc.push({ ten, ...tt, ...them });
  await page.screenshot({ path: `${THU_MUC}/${so.buoc.length}-${ten}.png` });
};

await ghi("0-ban-dau");

// ── chọn một máy: bấm vào TÂM một máy trong khung ──
const ds = await page.evaluate(() => window.__demTuongTac?.dsMay?.() ?? []);
const muc = ds.find((m) => m.trongKhung) ?? ds[0];
const canvas = await page.evaluate(() => {
  const r = document.querySelector("canvas").getBoundingClientRect();
  return { trai: r.left, tren: r.top };
});
await page.mouse.click(canvas.trai + muc.x, canvas.tren + muc.y);
await page.waitForTimeout(2500); // đủ cho camera BAY xong
await ghi("1-sau-chon", { bamTai: { x: muc.x, y: muc.y }, mucBanDau: muc.machineId });

// máy nào THỰC SỰ được chọn (nhãn viền primary) — không giả định là `muc`
const idChon = so.buoc[so.buoc.length - 1].nhanChon[0] ?? null;
so.idChon = idChon;

// ── Q2: bấm LẠI đúng máy đang chọn, tại vị trí HIỆN TẠI ──
if (idChon != null) {
  const t = await tamMay(idChon);
  so.tamMayDangChon = t;
  so.elTaiTamMayDangChon = t ? await elTai(t.x, t.y) : null;
  if (t) {
    await page.mouse.click(t.x, t.y);
    await page.waitForTimeout(1500);
  }
  await ghi("2-sau-bam-lai-may-dang-chon", { elTai: so.elTaiTamMayDangChon });

  // bấm lần NỮA tại cùng điểm (lúc này Sheet đã đóng nếu lần trước chỉ đóng Sheet)
  const t2 = await tamMay(idChon);
  so.tamLan2 = t2;
  so.elTaiLan2 = t2 ? await elTai(t2.x, t2.y) : null;
  if (t2) {
    await page.mouse.click(t2.x, t2.y);
    await page.waitForTimeout(1500);
  }
  await ghi("3-sau-bam-lan-hai", { elTai: so.elTaiLan2 });

  // và lần THỨ BA — nếu lần 2 chọn lại được thì lần 3 là "bấm lại máy đang chọn" thật
  const t3 = await tamMay(idChon);
  so.tamLan3 = t3;
  so.elTaiLan3 = t3 ? await elTai(t3.x, t3.y) : null;
  if (t3) {
    await page.mouse.click(t3.x, t3.y);
    await page.waitForTimeout(1500);
  }
  await ghi("4-sau-bam-lan-ba", { elTai: so.elTaiLan3 });
}

so.loi = loi;
fs.writeFileSync(`.qa-tapdoan/_ph42-q2-${NHAN}.json`, JSON.stringify(so, null, 1));
for (const b of so.buoc) console.log(JSON.stringify(b));
console.log("idChon =", so.idChon, "| elTai tâm máy đang chọn:", JSON.stringify(so.elTaiTamMayDangChon));
console.log("elTai lần2:", JSON.stringify(so.elTaiLan2), "| lần3:", JSON.stringify(so.elTaiLan3));
console.log("loi:", JSON.stringify(loi));
await ctx.close();
await trinh.close();

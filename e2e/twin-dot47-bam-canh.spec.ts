import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỢT 47 — BẤM MÁY TRÊN CẢNH 3D (kết cục gốc của chủ sở hữu: *"chọn vào máy (Cell) thì hiển thị Machine 3D Twin"*)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * G123: 46 đợt đo "chọn máy" qua danh sách / dải trạm / cây — chưa lưới nào `page.mouse.click` vào KHỐI máy trên
 * canvas. Đây là lưới đầu tiên đi đúng đường người vận hành. Đo trên `dist` (`PLAYWRIGHT_BASE_URL`, server 3047), vai
 * `e2e_tai_loE` (danh tính thật qua `auth.me` — G100), hai viewport. URL mang `?do=1` để mở `window.__demTuongTac`
 * (`KhungCanh`/`LoBatchMay`, chỉ DEV hoặc `?do=1`): tâm KHỐI máy → px canvas (không bấm nhãn), đếm object có handler.
 * JSON thô ghi `.qa-dot47/e2e/` (G65). Chạy:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3047 npx playwright test e2e/twin-dot47-bam-canh.spec.ts --workers=1 --output .qa-dot47/pw-output
 *
 *   T1a  /twin và /twin/line/2 × 2 vp: `mouse.click` tâm khối máy ⇒ URL `/twin/may/:id` (đúng id), độ trễ trong trang
 *        (click DOM → pushState) ≤ 500 ms
 *   T1b  rê lên máy ⇒ `canvas.style.cursor === "pointer"`; rời ⇒ không còn pointer
 *   T1c  bấm NHÃN (`pointer-events:none`, hit-test hộp thật ở LopNhan) ⇒ điều hướng tới `data-machine-id` của nhãn
 *   T1d  KÉO 200 px bắt đầu trên máy ⇒ URL KHÔNG đổi, camera đổi (`__tuTheCamera`) — kéo xoay vẫn xuyên qua
 *   T1e  đối chứng: bấm sàn trống ⇒ URL không đổi
 *   T1f  cơ chế: `__demTuongTac.demObject()` ⇒ mọi object trong interaction còn handler + còn trong scene;
 *        `hitTai(tâm máy)` trúng lô `twin3d-lo-may` với `batchId` là số
 *
 * ★ Gỡ vá (handler trở lại `<primitive>`): T1a/T1b/T1c/T1f đỏ, T1d/T1e vẫn xanh — đúng hình dạng lỗi Đợt 46.
 */

const ANH = ".qa-dot47/e2e";
const TK = { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" };
const VP = [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
];
const MAN = [
  { duong: "/twin", man: "man-twin-van-hanh" },
  { duong: "/twin/line/2", man: "man-twin-line" },
];
/** Độ trễ trong trang từ `click` DOM tới `pushState` — brief Đợt 47: ≤ 500 ms. */
const TRE_TOI_DA_MS = 500;

// Không `serial`: một ca đỏ không được kéo 11 ca còn lại thành "bỏ qua" (mỗi ca tự mở trang, không chia sẻ trạng thái).
let cookieCache: string | null = null;

async function dangNhap(page: Page) {
  if (cookieCache) {
    await page.context().addCookies(JSON.parse(cookieCache));
    return;
  }
  const res = await page.request.post("/api/auth/login", { data: TK });
  expect(res.status(), `dang nhap ${TK.username}`).toBe(200);
  const me = await page.request.get("/api/trpc/auth.me");
  const body = await me.json().catch(() => null);
  const ten = body?.result?.data?.json?.username ?? body?.result?.data?.username;
  expect(ten, "auth.me phai tra dung vai vua dang nhap").toBe(TK.username);
  cookieCache = JSON.stringify(await page.context().cookies());
}

const luu = (ten: string, obj: unknown) => {
  fs.mkdirSync(ANH, { recursive: true });
  fs.writeFileSync(`${ANH}/${ten}.json`, JSON.stringify({ luc: new Date().toISOString(), ...(obj as object) }, null, 2));
};

type MayPx = { machineId: number; x: number; y: number; trongKhung: boolean };
type CuaSo = Window & {
  __demTuongTac?: {
    demObject?: () => { soObject: number; coHandler: number; trongScene: number; ten: string[] };
    hitTai?: (x: number, y: number) => { ten: string; batchId: number | null } | null;
    tamMay?: (id: number) => { x: number; y: number; ndcX: number; ndcY: number; trongKhung: boolean } | null;
    dsMay?: () => MayPx[];
  };
  __tuTheCamera?: { x: number; y: number; z: number; mucX: number; mucZ: number };
  __doBam?: { tClick: number | null; tPush: number | null };
};

/** Đo độ trễ TRONG TRANG: `click` trên document → `history.pushState` (điều hướng wouter). */
const GHI_DO_BAM = () => {
  const w = window as unknown as CuaSo;
  w.__doBam = { tClick: null, tPush: null };
  document.addEventListener("click", () => { w.__doBam!.tClick = performance.now(); w.__doBam!.tPush = null; }, true);
  const goc = history.pushState.bind(history);
  history.pushState = function (...a: Parameters<History["pushState"]>) { w.__doBam!.tPush = performance.now(); return goc(...a); };
};

async function moMan(page: Page, duong: string, man: string, vp: { width: number; height: number }) {
  await page.setViewportSize(vp);
  await dangNhap(page);
  await page.addInitScript(GHI_DO_BAM);
  const t0 = Date.now();
  await page.goto(`${duong}?do=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(`[data-testid="${man}"] canvas`, { timeout: 90_000 });
  // Cửa sổ đo có mặt và có ≥ 1 máy trong khung; rồi chờ tween camera (500 ms) + vẽ ổn định.
  await page.waitForFunction(
    () => ((window as unknown as CuaSo).__demTuongTac?.dsMay?.() ?? []).some((m) => m.trongKhung),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(2_500);
  return Date.now() - t0;
}

/** Máy bấm được: tâm trong khung, DOM tại điểm đó là canvas (không dưới panel/KPI), raycast trúng lô. */
async function mayBamDuoc(page: Page, man: string): Promise<{ id: number; X: number; Y: number; cv: { x: number; y: number } } | null> {
  return page.evaluate((manTid) => {
    const w = window as unknown as CuaSo;
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
    const cv = canvas.getBoundingClientRect();
    const ds = (w.__demTuongTac?.dsMay?.() ?? []).filter((m) => m.trongKhung);
    for (const m of ds) {
      const X = cv.left + m.x;
      const Y = cv.top + m.y;
      if (document.elementFromPoint(X, Y) !== canvas) continue;
      const t = w.__demTuongTac?.tamMay?.(m.machineId);
      if (!t) continue;
      const hit = w.__demTuongTac?.hitTai?.(t.ndcX, t.ndcY);
      if (!hit || hit.ten !== "twin3d-lo-may") continue;
      return { id: m.machineId, X, Y, cv: { x: cv.left, y: cv.top } };
    }
    return null;
  }, man);
}

/** Điểm sàn trống: trong canvas, DOM là canvas, raycast KHÔNG trúng máy. */
async function sanTrong(page: Page, man: string): Promise<{ X: number; Y: number } | null> {
  return page.evaluate((manTid) => {
    const w = window as unknown as CuaSo;
    const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
    const cv = canvas.getBoundingClientRect();
    for (const fy of [0.08, 0.12, 0.16, 0.2]) {
      for (const fx of [0.5, 0.42, 0.58, 0.34, 0.66]) {
        const X = cv.left + cv.width * fx;
        const Y = cv.top + cv.height * fy;
        if (document.elementFromPoint(X, Y) !== canvas) continue;
        const ndcX = (fx * 2) - 1;
        const ndcY = 1 - fy * 2;
        if (w.__demTuongTac?.hitTai?.(ndcX, ndcY)) continue;
        return { X, Y };
      }
    }
    return null;
  }, man);
}

const cursorCanvas = (page: Page, man: string) =>
  page.evaluate((manTid) => {
    const c = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
    return c.style.cursor || getComputedStyle(c).cursor;
  }, man);

for (const vp of VP) {
  for (const { duong, man } of MAN) {
    const nhan = `${duong} @${vp.width}x${vp.height}`;

    test(`T1a+b+e+f — ${nhan}: bấm TÂM KHỐI máy ⇒ /twin/may/:id ≤ ${TRE_TOI_DA_MS} ms; rê ⇒ pointer; sàn ⇒ không đổi; cơ chế sạch`, async ({ page }) => {
      test.setTimeout(240_000);
      const msToiCanh = await moMan(page, duong, man, vp);
      const coChe = await page.evaluate(() => (window as unknown as CuaSo).__demTuongTac?.demObject?.() ?? null);
      expect(coChe, "cửa sổ đo __demTuongTac phải có (?do=1)").not.toBeNull();
      // T1f — không object "ma" trong danh sách R3F sẽ raycast: mọi object còn handler + còn trong scene.
      expect(coChe!.coHandler, `interaction ${JSON.stringify(coChe)}`).toBeGreaterThanOrEqual(1);
      expect(coChe!.coHandler).toBe(coChe!.soObject);
      expect(coChe!.trongScene).toBe(coChe!.soObject);

      // ★ N1 gốc rễ — lớp DOM badge (và nhãn) phải TRÙNG canvas (Đợt 31 chỉ ghim lớp nhãn; badge lệch tới (−443,−142) ở Line).
      const lopPhu = await page.evaluate((manTid) => {
        const R = (el: Element | null | undefined) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
        };
        const cv = document.querySelector(`[data-testid="${manTid}"] canvas`);
        const lb = document.querySelector('[data-testid="lop-canh-bao"]');
        const ln = document.querySelector('[data-testid="lop-nhan-twin3d"]');
        return { canvas: R(cv), lopBadge: R(lb), lopNhan: R(ln), soBadge: document.querySelectorAll('[data-testid^="badge-canh-bao-"]').length };
      }, man);
      if (lopPhu.lopBadge) expect(lopPhu.lopBadge, `lớp badge phải trùng canvas ${JSON.stringify(lopPhu)}`).toEqual(lopPhu.canvas);
      if (lopPhu.lopNhan) expect(lopPhu.lopNhan, `lớp nhãn phải trùng canvas ${JSON.stringify(lopPhu)}`).toEqual(lopPhu.canvas);

      const may = await mayBamDuoc(page, man);
      expect(may, "phải có ít nhất một máy trong khung, không bị lớp phủ che, raycast trúng").not.toBeNull();
      const { id, X, Y } = may!;
      const hit = await page.evaluate(({ id }) => {
        const w = window as unknown as CuaSo;
        const t = w.__demTuongTac!.tamMay!(id)!;
        return w.__demTuongTac!.hitTai!(t.ndcX, t.ndcY);
      }, { id });
      expect(hit?.ten).toBe("twin3d-lo-may");
      expect(typeof hit?.batchId).toBe("number");

      // T1b — rê lên máy ⇒ pointer; rời (sàn trống) ⇒ hết pointer.
      await page.mouse.move(X - 40, Y - 40);
      await page.waitForTimeout(150);
      await page.mouse.move(X, Y, { steps: 5 });
      await page.waitForTimeout(300);
      const cursorTrenMay = await cursorCanvas(page, man);
      expect(cursorTrenMay, "rê lên máy ⇒ cursor pointer").toBe("pointer");
      const san = await sanTrong(page, man);
      expect(san, "phải tìm được một điểm sàn trống").not.toBeNull();
      await page.mouse.move(san!.X, san!.Y, { steps: 5 });
      await page.waitForTimeout(300);
      const cursorTrenSan = await cursorCanvas(page, man);
      expect(cursorTrenSan).not.toBe("pointer");

      // T1e — đối chứng: bấm sàn trống ⇒ URL không đổi.
      const urlTruoc = page.url();
      await page.mouse.click(san!.X, san!.Y);
      await page.waitForTimeout(800);
      expect(page.url(), "bấm sàn trống không được điều hướng").toBe(urlTruoc);

      // T1a — bấm TÂM khối máy ⇒ /twin/may/:id.
      await page.mouse.move(X, Y, { steps: 5 });
      await page.waitForTimeout(150);
      const t0 = Date.now();
      await page.mouse.click(X, Y);
      await page.waitForURL(new RegExp(`/twin/may/${id}(\\?|$)`), { timeout: 3_000 });
      const msPlaywright = Date.now() - t0;
      const doBam = await page.evaluate(() => (window as unknown as CuaSo).__doBam ?? null);
      const treTrongTrang = doBam?.tClick != null && doBam?.tPush != null ? doBam.tPush - doBam.tClick : null;
      luu(`t1a-${man}-${vp.width}`, { duong, vp, msToiCanh, coChe, lopPhu, may, hit, cursorTrenMay, cursorTrenSan, san, urlSau: page.url(), msPlaywright, treTrongTrang });
      expect(new URL(page.url()).pathname).toBe(`/twin/may/${id}`);
      expect(treTrongTrang, "độ trễ trong trang click → pushState").not.toBeNull();
      expect(treTrongTrang!).toBeLessThanOrEqual(TRE_TOI_DA_MS);
      await page.screenshot({ path: `${ANH}/t1a-${man}-${vp.width}-sau-bam.png` });
    });

    test(`T1c — ${nhan}: bấm NHÃN (pointer-events:none) ⇒ điều hướng tới máy của nhãn`, async ({ page }) => {
      test.setTimeout(240_000);
      await moMan(page, duong, man, vp);
      const ketQuaNhan = await page.evaluate((manTid) => {
        const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
        const ds = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="nhan-may-twin3d"]'));
        const chanDoan: string[] = [];
        for (const el of ds) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const X = r.left + r.width / 2;
          const Y = r.top + r.height / 2;
          // nhãn pointer-events:none ⇒ DOM tại điểm phải là CANVAS (không phải panel/KPI đè lên)
          const duoi = document.elementFromPoint(X, Y);
          const id = Number(el.getAttribute("data-machine-id"));
          if (duoi !== canvas || !Number.isInteger(id)) {
            chanDoan.push(
              `${el.textContent?.trim().slice(0, 24)}@${Math.round(X)},${Math.round(Y)} id=${el.getAttribute("data-machine-id")} duoi=${duoi ? `${duoi.tagName.toLowerCase()}[${duoi.getAttribute("data-testid") ?? ""}]` : "null"}`,
            );
            continue;
          }
          return { trung: { id, X, Y, chu: el.textContent?.trim() ?? "", soNhan: ds.length }, chanDoan };
        }
        return { trung: null, chanDoan, soNhan: ds.length };
      }, man);
      const nhanBamDuoc = ketQuaNhan.trung;
      expect(nhanBamDuoc, `phải có ≥ 1 nhãn trong canvas không bị lớp phủ đè — ${JSON.stringify(ketQuaNhan)}`).not.toBeNull();
      const { id, X, Y } = nhanBamDuoc!;
      await page.mouse.move(X, Y, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.click(X, Y);
      await page.waitForURL(new RegExp(`/twin/may/${id}(\\?|$)`), { timeout: 3_000 });
      luu(`t1c-${man}-${vp.width}`, { duong, vp, nhanBamDuoc, urlSau: page.url() });
      expect(new URL(page.url()).pathname).toBe(`/twin/may/${id}`);
      // Không điều hướng HAI lần (nhãn + máy phía sau): Back một lần phải về màn gốc.
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      expect(new URL(page.url()).pathname).toBe(duong);
    });

    test(`T1d — ${nhan}: KÉO 200 px bắt đầu trên máy ⇒ camera đổi, URL không đổi`, async ({ page }) => {
      test.setTimeout(240_000);
      await moMan(page, duong, man, vp);
      const may = await mayBamDuoc(page, man);
      expect(may).not.toBeNull();
      const { X, Y } = may!;
      const camTruoc = await page.evaluate(() => (window as unknown as CuaSo).__tuTheCamera ?? null);
      const urlTruoc = page.url();
      await page.mouse.move(X, Y, { steps: 4 });
      await page.mouse.down({ button: "left" });
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(X + i * 10, Y, { steps: 1 });
        await page.waitForTimeout(16);
      }
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(1_200);
      const camSau = await page.evaluate(() => (window as unknown as CuaSo).__tuTheCamera ?? null);
      luu(`t1d-${man}-${vp.width}`, { duong, vp, may, camTruoc, camSau, urlTruoc, urlSau: page.url() });
      // So PATHNAME, không so cả URL: `/twin` ghi tư thế camera vào `?cam=` bằng `replaceState` sau khi kéo (§9.4, K7) —
      // đó là hành vi đúng, không phải điều hướng. Điều hướng = đổi đường dẫn sang `/twin/may/:id`.
      expect(new URL(page.url()).pathname, "kéo xoay không được điều hướng").toBe(new URL(urlTruoc).pathname);
      expect(camSau, "camera phải ghi tư thế sau khi kéo (OrbitControls 'end')").not.toBeNull();
      expect(JSON.stringify(camSau)).not.toBe(JSON.stringify(camTruoc));
    });
  }
}

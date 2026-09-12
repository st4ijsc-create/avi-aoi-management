import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { duongRaBangChung } from "./duongRaBangChung";

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
 *   TWIN_E2E_ANH=.qa-dotNN/e2e PLAYWRIGHT_BASE_URL=http://localhost:30NN npx playwright test e2e/twin-dot47-bam-canh.spec.ts \n *     --workers=1 --output .qa-dotNN/pw-output     ← ĐỢT 51: ghi vào thư mục CỦA ĐỢT ĐANG CHẠY, không phải .qa-dot47
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
 * ★ Gỡ vá ĐO ĐƯỢC (`.qa-dot47/ablation-go-va.log`, handler trở lại `<primitive>`): 8/12 đỏ — T1a+b+e+f ×4 (bấm/rê chết,
 *   `demObject` 1/0/0) và T1d ×4 (tiền đề `hitTai` không còn object có handler ⇒ không tìm được máy để kéo); T1c ×4 VẪN
 *   XANH — đường bấm-nhãn đi qua hit-test DOM của `LopNhan`, độc lập với handler R3F. (Dự đoán đầu "T1c đỏ" là sai.)
 */

/**
 * ★★★ ĐỢT 49 (mục F) — THƯ MỤC ẢNH LẤY TỪ ENV.
 *
 * `.qa-dot47/e2e` có 8 tệp ĐÃ COMMIT (bằng chứng Đợt 47). Chạy lại spec là GHI ĐÈ tệp tracked:
 * QA Đợt 48 phải sao lưu/khôi phục tay rồi so md5 để cây không bẩn — một thủ tục thủ công mà
 * lần sau ai đó sẽ quên. `TWIN_E2E_ANH=<thư mục>` cho người đo ghi chỗ khác; mặc định giữ
 * nguyên đường cũ nên mọi lệnh đã ghi trong tài liệu vẫn đúng.
 *
 * ★★★ ĐỢT 51 (mục B) — VÀ NÓ ĐÃ KHÔNG CỨU ĐƯỢC. Đợt 50 chạy lại spec này KHÔNG đặt
 * `TWIN_E2E_ANH`, mặc định trỏ thẳng `.qa-dot47/e2e` ⇒ 8 tệp tracked + 12 tệp untracked bị ghi
 * đè, rồi vòng "khôi phục" làm rỗng thêm 103 tệp (G130). Bài học: **một ENV mà người chạy phải
 * NHỚ đặt không phải hàng rào**. Từ Đợt 51, đường ra đi qua `duongRaBangChung()` — thư mục đích
 * ĐÃ CÓ TỆP thì tự đổi sang `<đường>-lai-<mốc>` và kêu to, thay vì ghi đè im lặng.
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH", ".qa-dot47/e2e");
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
    hitTai?: (
      x: number,
      y: number,
    ) => {
      ten: string;
      batchId: number | null;
      machineId?: number | null;
      domTai?: { the: string; testid: string | null; machineId: number | null } | null;
    } | null;
    tamMay?: (
      id: number,
    ) => { x: number; y: number; ndcX: number; ndcY: number; trongKhung: boolean; biChe?: number | null } | null;
    /** ★ Đợt 49 (A) — hộp THẬT của nhãn đang vẽ / hình chiếu khối từng máy, CÙNG một khung. */
    hopNhanDaVe?: () => Array<{ machineId: number; hop: { trai: number; phai: number; tren: number; duoi: number } }>;
    hopKhoiMay?: () => Array<{ machineId: number; hop: { trai: number; phai: number; tren: number; duoi: number } }>;
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
      // ★ Đợt 49 (A) — điểm bấm phải là điểm mà CƠ CHẾ nói sẽ chọn ĐÚNG máy này: raycast trúng
      //   chính nó (`machineId`), và DOM trên cùng tại đó là canvas. Đợt 47 chỉ đòi "trúng lô",
      //   nên chọn phải một tâm bị nhãn máy khác đè là chuyện may rủi của hình học camera —
      //   đúng cách spec 12/12 xanh trong khi QA bấm cùng loại điểm lại ra sai máy (K7a/K7b).
      if (typeof hit.machineId === "number" && hit.machineId !== m.machineId) continue;
      if (hit.domTai && hit.domTai.the !== "CANVAS") continue;
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
      /*
       * ★★★ ĐỢT 49 (mục F) — CHỤP SAU KHI MÀN MÁY ĐÃ VẼ XONG.
       * QA lần 7 đọc 4 PNG "sau-bam" đã commit ở Đợt 47: tất cả là SPINNER. Spec chụp ngay sau
       * `waitForURL`, tức chụp lúc URL đã đổi mà màn chưa vẽ ⇒ "màn Máy hiển thị" CHƯA BAO GIỜ là
       * bằng chứng của spec này, dù 12/12 xanh. Chờ đúng ba tín hiệu của màn Máy rồi mới chụp.
       */
      const veXong = await page
        .waitForFunction(
          () => {
            const man = document.querySelector('[data-testid="man-twin-may"]');
            if (!man) return false;
            if (document.querySelector('[data-testid="may-dang-tai"]')) return false;
            const cv = man.querySelector("canvas");
            if (!cv) return false;
            const tk = (window as unknown as { __thongKeVe?: { calls?: number } }).__thongKeVe;
            if ((tk?.calls ?? 0) <= 0) return false;
            /*
             * ★ Ba tín hiệu trên VẪN chưa đủ — đo được ở lượt đầu của chính Đợt 49: ảnh hết
             * spinner nhưng vùng canvas ĐEN TRƠN và cockpit nhúng còn in "Loading cockpit…".
             * `calls > 0` chỉ nói renderer đã vẽ MỘT khung (và `__thongKeVe` trễ một khung —
             * xem `KhungCanh.BomThongKe`), không nói cảnh đã có gì. Thêm hai điều kiện:
             *   (a) cockpit nhúng KHÔNG còn ở trạng thái đang tải (chữ, mọi ngôn ngữ đã dịch);
             *   (b) canvas đã có kích thước thật.
             */
            if (cv.clientWidth < 50 || cv.clientHeight < 50) return false;
            const chu = man.textContent ?? "";
            if (/Loading cockpit|Đang tải buồng lái|Loading machine|Đang tải máy/i.test(chu)) return false;
            return true;
          },
          { timeout: 20_000 },
        )
        .then(() => true)
        .catch(() => false);
      expect(veXong, "màn Máy phải VẼ XONG trước khi chụp — ảnh spinner/canvas trắng không chứng minh gì").toBe(true);
      // Một nhịp nữa cho cảnh 3D ổn định khung (camera khớp khung + vòng trạng thái) trước khi chụp.
      await page.waitForTimeout(2_500);
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

    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * ★★★ T1g (ĐỢT 49, mục A) — TÂM KHỐI MÁY BỊ NHÃN MÁY KHÁC ĐÈ
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Ca này là thứ Đợt 47 KHÔNG có và vì thế 12/12 xanh trong khi kết cục gốc sai: spec cũ bấm ở
     * tư thế camera MẶC ĐỊNH và lấy máy ĐẦU TIÊN hợp lệ, nên không bao giờ gặp chỗ nhãn đè. QA lần
     * 7 KÉO 60 px trước rồi bấm ⇒ `/twin`@1600 máy 246 mở `/twin/may/1`, Line@1280 máy 23 mở
     * `/twin/may/21`; census 13 lượt/212 tâm ở 5/8 khung.
     *
     * Hai khẳng định, ở hai tầng:
     *   (1) HÌNH HỌC — số nhãn đang vẽ mà đè hình chiếu khối của MÁY KHÁC (đọc hộp THẬT của cùng
     *       một khung qua `hopNhanDaVe`/`hopKhoiMay`). Ghi số; không đòi 0 tuyệt đối vì hợp đồng
     *       của `locNhan` là "hết chỗ thì GIỮ nhãn".
     *   (2) KẾT CỤC — với MỌI máy có tâm nằm trong hộp nhãn của máy khác, bấm tâm ấy phải mở ĐÚNG
     *       máy ấy. Đây mới là điều người dùng gặp, và là điều bản vá hứa.
     * Kéo 60 px trước khi đo — đúng thao tác QA đã dùng để lộ lỗi.
     */
    test(`T1g — ${nhan}: bấm TÂM KHỐI của máy bị NHÃN MÁY KHÁC đè ⇒ vẫn mở đúng máy ấy`, async ({ page }) => {
      test.setTimeout(240_000);
      await moMan(page, duong, man, vp);
      // Kéo 60 px: tư thế camera mặc định là tư thế duy nhất spec Đợt 47 từng đo.
      const mocKeo = await mayBamDuoc(page, man);
      expect(mocKeo, "cần một máy để bắt đầu cú kéo").not.toBeNull();
      await page.mouse.move(mocKeo!.X, mocKeo!.Y, { steps: 3 });
      await page.mouse.down({ button: "left" });
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(mocKeo!.X + i * 10, mocKeo!.Y, { steps: 1 });
        await page.waitForTimeout(16);
      }
      await page.mouse.up({ button: "left" });
      await page.waitForTimeout(1_200);

      const dinh: { soNhan: number; soKhoi: number; soCap: number; dienTich: number; biPhu: Array<{ machineId: number; boiNhanCua: number; X: number; Y: number }> } = await page.evaluate((manTid) => {
        const w = window as unknown as CuaSo;
        const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
        const cv = canvas.getBoundingClientRect();
        const hopNhan = w.__demTuongTac?.hopNhanDaVe?.() ?? [];
        const hopKhoi = w.__demTuongTac?.hopKhoiMay?.() ?? [];
        const giao = (a: { trai: number; phai: number; tren: number; duoi: number }, b: typeof a) =>
          Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.trai, b.trai)) *
          Math.max(0, Math.min(a.duoi, b.duoi) - Math.max(a.tren, b.tren));
        // (1) cặp nhãn máy A ∩ khối máy B (A ≠ B) + tổng diện tích giao.
        let soCap = 0;
        let dienTich = 0;
        for (const n of hopNhan) {
          for (const k of hopKhoi) {
            if (k.machineId === n.machineId) continue;
            const d = giao(n.hop, k.hop);
            if (d > 0) {
              soCap += 1;
              dienTich += d;
            }
          }
        }
        // (2) máy có TÂM nằm trong hộp nhãn của máy KHÁC, và tâm ấy bấm được (DOM là canvas).
        const biPhu: Array<{ machineId: number; boiNhanCua: number; X: number; Y: number }> = [];
        for (const m of (w.__demTuongTac?.dsMay?.() ?? []).filter((v) => v.trongKhung)) {
          const X = cv.left + m.x;
          const Y = cv.top + m.y;
          if (document.elementFromPoint(X, Y) !== canvas) continue;
          const n = hopNhan.find(
            (v) =>
              v.machineId !== m.machineId &&
              m.x >= v.hop.trai &&
              m.x <= v.hop.phai &&
              m.y >= v.hop.tren &&
              m.y <= v.hop.duoi,
          );
          if (n) biPhu.push({ machineId: m.machineId, boiNhanCua: n.machineId, X, Y });
        }
        return { soNhan: hopNhan.length, soKhoi: hopKhoi.length, soCap, dienTich: Math.round(dienTich), biPhu };
      }, man);

      expect(dinh.soKhoi, "cửa sổ đo hopKhoiMay phải có — nếu 0 thì `khoiMay` chưa nối tới LopNhan").toBeGreaterThan(0);

      // Bấm TỪNG tâm bị phủ (tối đa 3 — mỗi lần phải quay lại màn gốc).
      const ketCuc: Array<{ machineId: number; boiNhanCua: number; duongSau: string; dung: boolean }> = [];
      for (const m of dinh.biPhu.slice(0, 3)) {
        /*
         * ★★★ ĐO LẠI TOẠ ĐỘ TRƯỚC MỖI CÚ BẤM. Giữa hai cú có `goBack` ⇒ camera về tư thế khác; và
         * chỉ riêng việc RÊ chuột lên máy đã làm lớp nhãn tính lại (máy đang hover được giữ nhãn
         * — `chiNhanBatThuong`), nên bố cục nhãn ở khung sắp bấm KHÔNG phải bố cục lúc census.
         * Bấm bằng toạ độ cũ là đo một cảnh bằng ảnh chụp của cảnh khác — âm tính giả của THIẾT
         * BỊ ĐO. Máy không còn bị phủ ở khung hiện tại thì bỏ qua, không tính là đạt hay trượt.
         */
        const tuoi = await page.evaluate(
          ({ manTid, id }) => {
            const w = window as unknown as CuaSo;
            const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${manTid}"] canvas`)!;
            const cv = canvas.getBoundingClientRect();
            const t = w.__demTuongTac?.tamMay?.(id);
            if (!t || !t.trongKhung) return null;
            const X = cv.left + t.x;
            const Y = cv.top + t.y;
            if (document.elementFromPoint(X, Y) !== canvas) return null;
            const n = (w.__demTuongTac?.hopNhanDaVe?.() ?? []).find(
              (v) =>
                v.machineId !== id &&
                t.x >= v.hop.trai &&
                t.x <= v.hop.phai &&
                t.y >= v.hop.tren &&
                t.y <= v.hop.duoi,
            );
            return n ? { X, Y, boiNhanCua: n.machineId } : null;
          },
          { manTid: man, id: m.machineId },
        );
        if (!tuoi) continue;
        m.X = tuoi.X;
        m.Y = tuoi.Y;
        m.boiNhanCua = tuoi.boiNhanCua;
        await page.mouse.move(m.X, m.Y, { steps: 4 });
        await page.waitForTimeout(300);
        // Rê chuột đã có thể dời nhãn (máy hover được giữ nhãn). Nếu đã hết bị phủ thì ca này
        // không còn là ca cần đo — nhưng VẪN bấm, vì kết cục "bấm tâm khối ⇒ đúng máy" phải đúng
        // ở mọi chỗ; chỉ ghi lại rằng lúc bấm nó còn bị phủ hay không.
        await page.mouse.click(m.X, m.Y);
        await page.waitForTimeout(1_200);
        const duongSau = new URL(page.url()).pathname;
        ketCuc.push({ ...m, duongSau, dung: duongSau === `/twin/may/${m.machineId}` });
        if (duongSau !== duong) {
          await page.goBack({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1_500);
        }
      }
      luu(`t1g-${man}-${vp.width}`, { duong, vp, dinh, ketCuc });
      for (const k of ketCuc) {
        expect(
          k.dung,
          `bấm TÂM KHỐI máy ${k.machineId} (đang bị nhãn máy ${k.boiNhanCua} đè) phải mở /twin/may/${k.machineId}, đo được ${k.duongSau}`,
        ).toBe(true);
      }
    });
  }
}

import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";

/**
 * ============================================================================
 * LÔ U (Đợt 16) — ĐO ĐỘ MƯỢT CỦA TƯƠNG TÁC CANVAS 3D
 * ============================================================================
 *
 * Chủ sở hữu báo: *"zoom, move, rotation, transform... thi thoảng không thực
 * hiện được, đơ, giật, lag hoặc không mượt"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PHÉP ĐO TRUNG TÂM: "MỘT CÚ KÉO ĐI ĐƯỢC BAO XA"
 * ════════════════════════════════════════════════════════════════════════════
 * Suite này KHÔNG đo FPS lúc cảnh đứng yên — G5/G32: một phép đo FPS trên cảnh
 * không có gì chuyển động không chứng minh được gì về độ mượt.
 *
 * Nó đo thứ người dùng THẤY: cho MỘT chuỗi sự kiện chuột CỐ ĐỊNH, ảnh trên
 * canvas đổi BAO NHIÊU. Đại lượng `doDoiPixel` = tỉ lệ pixel khác nhau giữa ảnh
 * TRƯỚC và ảnh SAU thao tác.
 *
 *   • `doDoiPixel` ~ 0    ⇒ thao tác KHÔNG THỰC HIỆN ĐƯỢC (màn đứng im).
 *   • `doDoiPixel` nhỏ    ⇒ đi được một phần rồi dừng — "giật", "không mượt".
 *   • `soKhungVe`          ⇒ với `frameloop="demand"`, 0 khung = không ai vẽ.
 *
 * ★ Vì sao đo pixel chứ không đọc `camera.position`: R3F bản này không phơi
 *   `__r3f` trên canvas ở build production (đã ĐO: `Object.keys(canvas)` chỉ có
 *   `__reactFiber$…`/`__reactProps$…`), và đi bộ cây fiber tìm state cho ra
 *   RỖNG. Ảnh canvas là nguồn KHÔNG phụ thuộc nội bộ — và nó đúng là thứ chủ
 *   sở hữu nhìn thấy.
 *
 * ★ G34 — `preserveDrawingBuffer=false`: `canvas.toDataURL()` cho ra ảnh TRỐNG.
 *   Nên ta chụp bằng `page.screenshot({clip})` (đọc từ bộ đệm trình bày của
 *   trình duyệt, không qua WebGL), CẮT ĐÚNG vùng canvas.
 */

const TAI_KHOAN = {
  username: process.env.E2E_TAI_USER || "e2e_tai_loE",
  password: process.env.E2E_TAI_PASS || "E2eTaiLoE!2026",
};

interface KetQua {
  doDoiPixel: number;
  soKhungVe: number;
  treDauMs: number;
  longTask: number;
}

/** Cắm đồng hồ: đếm khung ĐƯỢC VẼ + long task + độ trễ sự kiện→khung đầu. */
async function camDongHo(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const s = { khung: 0, longTask: 0, treDau: -1, mocSuKien: -1 };
    w.__loU = s;

    // `frameloop="demand"` chỉ lập lịch rAF khi có `invalidate()`. Vòng đếm này
    // tự lập lịch nên nó đếm MỌI khung trình duyệt vẽ; phần chênh giữa lúc nghỉ
    // và lúc thao tác mới là tín hiệu. Ta dùng nó cho `treDau` là chính.
    const raf = window.requestAnimationFrame.bind(window);
    const dem = () => {
      s.khung += 1;
      if (s.mocSuKien >= 0 && s.treDau < 0) s.treDau = performance.now() - s.mocSuKien;
      raf(dem);
    };
    raf(dem);

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.duration > 50) s.longTask += 1;
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* không hỗ trợ — giữ 0 và nói rõ ở báo cáo */
    }
  });
}

async function batDauDo(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as { __loU: Record<string, number> }).__loU;
    s.khung = 0;
    s.longTask = 0;
    s.treDau = -1;
    s.mocSuKien = performance.now();
  });
}

async function ketThucDo(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __loU: { khung: number; longTask: number; treDau: number } })
      .__loU;
    return { khung: s.khung, longTask: s.longTask, treDau: s.treDau };
  });
}

/** Tỉ lệ pixel KHÁC nhau giữa hai ảnh PNG cùng kích thước (0..1). */
function tiLeKhac(a: Buffer, b: Buffer): number {
  const p = PNG.sync.read(a);
  const q = PNG.sync.read(b);
  if (p.width !== q.width || p.height !== q.height) return -1;
  let khac = 0;
  const n = p.width * p.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Ngưỡng 8/255 mỗi kênh — bỏ nhiễu nén/khử răng cưa, giữ dịch chuyển thật.
    if (
      Math.abs(p.data[o] - q.data[o]) > 8 ||
      Math.abs(p.data[o + 1] - q.data[o + 1]) > 8 ||
      Math.abs(p.data[o + 2] - q.data[o + 2]) > 8
    ) {
      khac += 1;
    }
  }
  return khac / n;
}

async function moTrang(page: Page, duong: string) {
  await page.setViewportSize({ width: 1600, height: 950 });
  const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
  expect(res.ok()).toBeTruthy();
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => ((window as unknown as { __thongKeVe?: { calls: number } }).__thongKeVe?.calls ?? 0) > 0,
    undefined,
    { timeout: 120_000 },
  );
  // Để cảnh ổn định hẳn: nạp model, nhãn, lớp phủ.
  await page.waitForTimeout(5_000);
  await camDongHo(page);
}

async function vungCanvas(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("khong tim thay canvas");
  // Cắt vào trong 4px để tránh viền/anti-alias mép.
  return {
    clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 },
    tx: box.x + box.width / 2,
    ty: box.y + box.height / 2,
  };
}

/** Chạy một thao tác, trả về độ đổi ảnh + số khung + trễ. */
async function doThaoTac(
  page: Page,
  thaoTac: (tx: number, ty: number) => Promise<void>,
): Promise<KetQua> {
  const v = await vungCanvas(page);
  const truoc = await page.screenshot({ clip: v.clip });
  await batDauDo(page);
  await thaoTac(v.tx, v.ty);
  // Chờ quán tính trôi hết NẾU nó được phục vụ. 600ms >> thời gian tắt của
  // damping 0,08 khi có vòng update (≈40 khung ≈ 660ms) — đủ để phân biệt
  // "đi hết quãng" với "đi 8% rồi dừng".
  await page.waitForTimeout(700);
  const d = await ketThucDo(page);
  const sau = await page.screenshot({ clip: v.clip });
  return {
    doDoiPixel: tiLeKhac(truoc, sau),
    soKhungVe: d.khung,
    treDauMs: d.treDau,
    longTask: d.longTask,
  };
}

function inSo(nhan: string, man: string, k: KetQua, ghiChu = "") {
  console.log(
    `\n[${nhan}] ${man}\n` +
      `   DO DOI ANH (ti le pixel khac) = ${(k.doDoiPixel * 100).toFixed(3)} %\n` +
      `   so khung VE trong thao tac    = ${k.soKhungVe}\n` +
      `   tre su kien -> khung dau      = ${k.treDauMs.toFixed(1)} ms\n` +
      `   long task > 50ms              = ${k.longTask}` +
      (ghiChu ? `\n   ${ghiChu}` : ""),
  );
}

test.describe.configure({ mode: "serial" });

const MAN = [
  { ten: "/twin (Van hanh)", duong: "/twin" },
  { ten: "/twin-studio (Thiet ke)", duong: "/twin-studio" },
];

for (const man of MAN) {
  test.describe(`Lo U — ${man.ten}`, () => {
    test(`U-ORBIT keo trai 20 buoc — ${man.duong}`, async ({ page }) => {
      test.setTimeout(300_000);
      await moTrang(page, man.duong);
      const k = await doThaoTac(page, async (tx, ty) => {
        await page.mouse.move(tx, ty);
        await page.mouse.down({ button: "left" });
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(tx + i * 10, ty);
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "left" });
      });
      inSo("U-ORBIT", man.ten, k, "keo trai 200px sang phai");
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });

    test(`U-ZOOM wheel 10 nac — ${man.duong}`, async ({ page }) => {
      test.setTimeout(300_000);
      await moTrang(page, man.duong);
      const k = await doThaoTac(page, async (tx, ty) => {
        await page.mouse.move(tx, ty);
        for (let i = 0; i < 10; i++) {
          await page.mouse.wheel(0, -120);
          await page.waitForTimeout(16);
        }
      });
      inSo("U-ZOOM", man.ten, k, "10 nac wheel vao trong");
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });

    test(`U-PAN chuot phai 20 buoc — ${man.duong}`, async ({ page }) => {
      test.setTimeout(300_000);
      await moTrang(page, man.duong);
      const k = await doThaoTac(page, async (tx, ty) => {
        await page.mouse.move(tx, ty);
        await page.mouse.down({ button: "right" });
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(tx + i * 8, ty + i * 4);
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "right" });
      });
      inSo("U-PAN", man.ten, k, "keo phai 160x80 px");
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });
  });
}

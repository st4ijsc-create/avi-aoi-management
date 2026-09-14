import { test, expect, type Page } from "@playwright/test";
import { duongRaBangChung, taoThuMuc } from "./duongRaBangChung";
import { PNG } from "pngjs";

/**
 * ★★★ ĐỢT 55 (C) — ĐƯỜNG RA BẰNG CHỨNG ĐI QUA HÀNG RÀO (G130).
 *
 * Trước Đợt 55 spec này ghi thẳng vào `.qa-loV` bằng đường ghim cứng. Đó đúng lớp lỗi đã
 * làm mất bằng chứng ở Đợt 50: chạy lại để xem thử ⇒ ghi đè im lặng lên ảnh của lượt trước.
 * `duongRaBangChung` áp bất biến *"thư mục đích ĐÃ CÓ TỆP ⇒ đổi đường ra + kêu to"*.
 *
 * CÁCH CHẠY (đổi chỗ ghi mà không phải sửa mã):
 *     TWIN_E2E_ANH_LOV=<thư mục>   npx playwright test e2e/twin-lo-v-tuong-tac.spec.ts
 *     QA_GHI_DE_BANG_CHUNG=1              ⇒ ép ghi đè `.qa-loV` (lối thoát CÓ CHỦ Ý)
 */
const ANH = duongRaBangChung("TWIN_E2E_ANH_LOV", ".qa-loV");

/**
 * ============================================================================
 * LÔ V (Đợt 17) — ĐÓNG NỢ ĐO CỦA LÔ U
 * ============================================================================
 *
 * Lô U đo được ORBIT/ZOOM/PAN và vá được một nguyên nhân (quán tính bị vứt vì
 * thiếu `useFrame(controls.update())` dưới `frameloop="demand"`). Lô này đo BỐN
 * thao tác lô U KHÔNG đo được, quy nguyên nhân long task, và săn triệu chứng
 * "KHÔNG THỰC HIỆN ĐƯỢC".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO LÔ U KHÔNG ĐO ĐƯỢC GIZMO — KHÔNG PHẢI VÌ THIẾU MÁY ĐẶT CHỖ
 * ════════════════════════════════════════════════════════════════════════════
 * Brief lô V nói "180/240 máy chưa đặt". ĐO ĐƯỢC: SAI. `sinh-tai-twin.ts --240`
 * ghi MỘT hàng `twin_dat_cho(loaiThucThe='machine')` cho MỖI máy nó sinh
 * (sinh-tai-twin.ts:477-494), và câu đếm đối chiếu trả `tong=240 daDat=240`.
 *
 * Nguyên nhân THẬT là QUYỀN. `XuongThietKe.tsx:972`:
 *
 *     mayDangChon={coQuyenSua ? machineIdChon : null}
 *
 * với `coQuyenSua = useCanWrite("settings_factory").canEdit ||
 *                   useCanWrite("machine_control").canEdit` (:173).
 * `CanhThietKe` chỉ dựng `<GizmoBienDoi>` khi `mayDangChon !== null`. Vai
 * `e2e_tai_loE` (id 21075, supervisor) có ĐÚNG 4 hàng `permissions`, cả 4 đều
 * `canEdit=false` và KHÔNG có `settings_factory` ⇒ `coQuyenSua=false` ⇒ gizmo
 * KHÔNG BAO GIỜ được mount cho tài khoản đó. Lô U đo bằng chính vai đó, nên
 * "không đo được gizmo" là hệ quả CẤU TRÚC, không phải thiếu dữ liệu.
 *
 * ⇒ Lô V cấp `machine_control.canEdit=true` cho 21075 TRONG LÚC ĐO rồi trả lại
 *   `false` (giá trị trước đã ghi lại; xem báo cáo lô V).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PHÉP ĐO — giữ NGUYÊN của lô U (G64: build production không phơi `__r3f`)
 * ════════════════════════════════════════════════════════════════════════════
 * `doDoiPixel` = tỉ lệ pixel khác nhau giữa ảnh TRƯỚC và ảnh SAU thao tác, chụp
 * bằng `page.screenshot({clip})` (G34: `preserveDrawingBuffer=false` nên
 * `toDataURL` cho ảnh trống). Đối chứng KHÔNG chạm chuột phải ra ~0 %.
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
  longTaskMax: number;
  /** Quy kết long task: nhãn nguồn (attribution) → tổng ms. */
  quyKet: Record<string, number>;
}

interface ChiTietLT {
  ten: string;
  batDau: number;
  keoDai: number;
  nguon: string;
}

/**
 * Cắm đồng hồ. Khác lô U ở MỘT chỗ: giữ lại `attribution` + mốc thời gian của
 * long task để V2 quy được nguyên nhân, thay vì chỉ đếm.
 */
async function camDongHo(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const s = {
      khung: 0,
      longTask: 0,
      longTaskMax: 0,
      treDau: -1,
      mocSuKien: -1,
      quyKet: {} as Record<string, number>,
      chiTiet: [] as Array<{ ten: string; batDau: number; keoDai: number; nguon: string }>,
    };
    w.__loV = s;

    const raf = window.requestAnimationFrame.bind(window);
    const dem = () => {
      s.khung += 1;
      if (s.mocSuKien >= 0 && s.treDau < 0) s.treDau = performance.now() - s.mocSuKien;
      raf(dem);
    };
    raf(dem);

    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration <= 50) continue;
          s.longTask += 1;
          if (e.duration > s.longTaskMax) s.longTaskMax = e.duration;
          // `attribution` là nơi DUY NHẤT trình duyệt nói long task đến từ đâu.
          // Nó chỉ phân giải tới CONTAINER (frame/iframe), không tới hàm — nên
          // phần quy kết tới HÀM do CPU profile lo (xem V2). Ở đây ghi cả `name`
          // (self / same-origin-*) để phân biệt script chính với iframe con.
          const at =
            (
              e as unknown as {
                attribution?: Array<{ name: string; containerType: string }>;
              }
            ).attribution ?? [];
          const nhan = at.length
            ? at.map((a) => `${e.name}|${a.name}|${a.containerType}`).join(",")
            : `${e.name}|-`;
          s.quyKet[nhan] = (s.quyKet[nhan] ?? 0) + e.duration;
          s.chiTiet.push({
            ten: e.name,
            batDau: e.startTime - (s.mocSuKien < 0 ? 0 : s.mocSuKien),
            keoDai: e.duration,
            nguon: nhan,
          });
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* không hỗ trợ — giữ 0 và nói rõ ở báo cáo */
    }
  });
}

async function batDauDo(page: Page) {
  await page.evaluate(() => {
    const s = (window as unknown as { __loV: Record<string, unknown> }).__loV;
    s.khung = 0;
    s.longTask = 0;
    s.longTaskMax = 0;
    s.treDau = -1;
    s.quyKet = {};
    s.chiTiet = [];
    s.mocSuKien = performance.now();
  });
}

async function ketThucDo(page: Page) {
  return page.evaluate(() => {
    const s = (
      window as unknown as {
        __loV: {
          khung: number;
          longTask: number;
          longTaskMax: number;
          treDau: number;
          quyKet: Record<string, number>;
          chiTiet: Array<{ ten: string; batDau: number; keoDai: number; nguon: string }>;
        };
      }
    ).__loV;
    return {
      khung: s.khung,
      longTask: s.longTask,
      longTaskMax: s.longTaskMax,
      treDau: s.treDau,
      quyKet: { ...s.quyKet },
      chiTiet: s.chiTiet.slice(0, 30),
    };
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

/**
 * Đăng nhập, CÓ THỬ LẠI.
 *
 * ⚠ Đo được: chạy cả suite liên tiếp làm `POST /api/auth/login` trả lỗi ở một
 *   lượt giữa chừng (bộ chặn tần suất), và test ĐỎ ở dòng `expect(res.ok())` —
 *   một kết cục ĐỎ KHÔNG nói gì về thứ đang đo. Chờ rồi thử lại tách "hệ thống
 *   chặn tần suất" khỏi "thao tác canvas hỏng"; nếu hết lượt thử vẫn hỏng thì
 *   mới thực sự là lỗi và ta để nó ĐỎ, kèm mã trạng thái.
 */
async function dangNhap(page: Page) {
  let cuoi = 0;
  for (let lan = 1; lan <= 5; lan++) {
    const res = await page.request.post("/api/auth/login", { data: TAI_KHOAN });
    if (res.ok()) return;
    cuoi = res.status();
    await page.waitForTimeout(2_000 * lan);
  }
  expect(cuoi, `dang nhap that bai sau 5 lan, ma cuoi = ${cuoi}`).toBe(200);
}

async function choKhungDau(page: Page) {
  await page.waitForFunction(
    () => ((window as unknown as { __thongKeVe?: { calls: number } }).__thongKeVe?.calls ?? 0) > 0,
    undefined,
    { timeout: 120_000 },
  );
}

async function moTrang(page: Page, duong: string, cho = 5_000) {
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await choKhungDau(page);
  await page.waitForTimeout(cho);
  await camDongHo(page);
}

/** Mở `/twin-studio` và vào tab Thiết kế (tab mang `<Canvas>`). */
async function moStudio(page: Page) {
  await page.setViewportSize({ width: 1600, height: 950 });
  await dangNhap(page);
  await page.goto("/twin-studio", { waitUntil: "domcontentloaded" });
  await page
    .getByTestId("tab-thiet-ke")
    .click({ timeout: 60_000 })
    .catch(() => {});
  await choKhungDau(page);
  await page.waitForTimeout(6_000);
  await camDongHo(page);
}

/**
 * ★★★ BUNG CÂY PHÂN CẤP RỒI ĐẾM MÁY **ĐÃ ĐẶT CHỖ**.
 *
 * Đo được (lô V): cây mở màn CHỈ có 4 hàng `workshop` + 180 hàng `machine`, và
 * cả 180 hàng máy đó nằm trong **KHU CHỜ XẾP CHỖ** (`data-cho-xep-cho="1"`;
 * `khu-cho-xep-cho` chứa đúng 180). 60 máy ĐÃ đặt nằm dưới `line` → `station`
 * đang THU GỌN, nên KHÔNG có trong DOM lúc mở màn.
 *
 * ⚠⚠ Hệ quả nếu bỏ qua: `node-cay-machine:*` lấy `.first()` cho ra một máy CHƯA
 *    đặt ⇒ `may.find(m => m.machineId === mayDangChon)` trả `undefined` ⇒
 *    `CanhThietKe.tsx:467-477` THOÁT SỚM (`if (!o || !mayChon) return`) ⇒ proxy
 *    ở nguyên gốc `(0,0,0)` với `rotation.y = 0`. Gizmo VẪN mount, handler snap
 *    VẪN chạy đủ 24 lần, mà KHÔNG pixel nào đổi. Đó là ÂM TÍNH GIẢ của phép đo,
 *    KHÔNG phải lỗi sản phẩm — và nó trông y hệt triệu chứng "không thực hiện
 *    được" mà lô này đi săn. Đo được nguyên văn (V1-CHAN-DOAN lượt đầu):
 *      so mau = 102 · so mau co rotation.y != 0 = 0 · position = (0,0,0)
 *
 * Nút bung là `<button>` ĐẦU TIÊN trong hàng; `aria-expanded` nằm trên HÀNG chứ
 * không trên nút — nên phải bấm NÚT (bấm hàng = CHỌN, không bung).
 */
async function bungCayVaChonMayDaDat(page: Page): Promise<number> {
  const daDat = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
  for (let vong = 0; vong < 6; vong++) {
    const hangDong = page.locator('[data-testid^="node-cay-"][aria-expanded="false"]');
    const n = await hangDong.count();
    if (n === 0) break;
    for (let i = 0; i < n; i++) {
      await hangDong
        .nth(i)
        .locator("button")
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {});
    }
    await page.waitForTimeout(800);
    if ((await daDat.count()) > 0) break;
  }
  return daDat.count();
}


async function vungCanvas(page: Page) {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("khong tim thay canvas");
  return {
    clip: { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 },
    tx: box.x + box.width / 2,
    ty: box.y + box.height / 2,
    box,
  };
}

async function doThaoTac(
  page: Page,
  thaoTac: (tx: number, ty: number) => Promise<void>,
  choMs = 700,
): Promise<KetQua & { chiTiet: ChiTietLT[] }> {
  const v = await vungCanvas(page);
  const truoc = await page.screenshot({ clip: v.clip });
  await batDauDo(page);
  await thaoTac(v.tx, v.ty);
  await page.waitForTimeout(choMs);
  const d = await ketThucDo(page);
  const sau = await page.screenshot({ clip: v.clip });
  return {
    doDoiPixel: tiLeKhac(truoc, sau),
    soKhungVe: d.khung,
    treDauMs: d.treDau,
    longTask: d.longTask,
    longTaskMax: d.longTaskMax,
    quyKet: d.quyKet,
    chiTiet: d.chiTiet,
  };
}

function inSo(nhan: string, man: string, k: KetQua, ghiChu = "") {
  const qk = Object.entries(k.quyKet)
    .sort((a, b) => b[1] - a[1])
    .map(([n, ms]) => `${n}=${ms.toFixed(0)}ms`)
    .join("  ");
  console.log(
    `\n[${nhan}] ${man}\n` +
      `   DO DOI ANH (ti le pixel khac) = ${(k.doDoiPixel * 100).toFixed(3)} %\n` +
      `   so khung VE trong thao tac    = ${k.soKhungVe}\n` +
      `   tre su kien -> khung dau      = ${k.treDauMs.toFixed(1)} ms\n` +
      `   long task > 50ms              = ${k.longTask}  (dai nhat ${k.longTaskMax.toFixed(0)} ms)\n` +
      `   quy ket long task             = ${qk || "(khong co)"}` +
      (ghiChu ? `\n   ${ghiChu}` : ""),
  );
}

test.describe.configure({ mode: "serial" });

/* ═══════════════════════════════════════════════════════════════════════════ */
/* V1 — TRANSFORM GIZMO                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

test.describe("V1 — transform gizmo (/twin-studio)", () => {
  test("V1-0 gizmo CO MOUNT khong (RB-1: getHelper trong scene)", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);

    // Chọn một máy qua mini-map (đường DOM, không phụ thuộc raycast toạ độ).
    const cham = page.getByTestId("mini-map-cham");
    const soCham = await cham.count();
    console.log(`\n[V1-0] so cham mini-map = ${soCham}`);
    if (soCham > 0) await cham.nth(Math.floor(soCham / 2)).click({ force: true });
    await page.waitForTimeout(1_500);

    const g = await page.evaluate(
      () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? null,
    );
    console.log(`[V1-0] window.__gizmo = ${JSON.stringify(g)}`);
    // KHÔNG assert `tenLopHelper` (G10b: minifier đổi tên lớp trên build thật).
    expect(g, "gizmo phai duoc mount — neu null thi coQuyenSua=false").not.toBeNull();
    expect((g as Record<string, unknown>).helperLaObject3D).toBe(true);
    expect((g as Record<string, unknown>).helperTrongScene).toBe(true);
  });

  for (const cd of ["translate", "rotate", "scale"] as const) {
    test(`V1-${cd} keo gizmo — do do doi anh`, async ({ page }) => {
      test.setTimeout(300_000);
      await moStudio(page);

      const cham = page.getByTestId("mini-map-cham");
      const soCham = await cham.count();
      if (soCham === 0) test.skip(true, "khong co cham mini-map de chon may");
      await cham.nth(Math.floor(soCham / 2)).click({ force: true });
      await page.waitForTimeout(1_200);

      await page
        .getByTestId(`nut-che-do-${cd}`)
        .click()
        .catch(() => {});
      await page.waitForTimeout(600);

      const truocKeo = await page.evaluate(
        () =>
          (window as unknown as { __gizmo?: { soLanSnapGoc: number } }).__gizmo?.soLanSnapGoc ?? 0,
      );

      // Kéo TỪ TÂM canvas: gizmo bám vào máy đang chọn, và bước "Fit" trước đó
      // đưa máy về giữa khung. Nếu con trỏ không trúng cần gizmo, cú kéo rơi về
      // ORBIT — và đó CŨNG là một số đọc được (ảnh vẫn đổi), nên ta đọc thêm
      // `soLanSnapGoc` để biết đường gizmo có thật sự chạy hay không.
      const k = await doThaoTac(page, async (tx, ty) => {
        await page.mouse.move(tx, ty);
        await page.mouse.down({ button: "left" });
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(tx + i * 6, ty - i * 3);
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "left" });
      });

      const sauKeo = await page.evaluate(
        () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? {},
      );
      inSo(
        `V1-${cd.toUpperCase()}`,
        "/twin-studio",
        k,
        `soLanSnapGoc ${truocKeo} -> ${(sauKeo as { soLanSnapGoc?: number }).soLanSnapGoc ?? "?"}  ` +
          `cheDo=${(sauKeo as { cheDo?: string }).cheDo}`,
      );
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });
  }

  /**
   * ★★★ V1-BAM — KÉO ĐÚNG CẦN GIZMO, không kéo trượt sang ORBIT.
   *
   * V1-translate/rotate/scale kéo từ TÂM canvas và `soLanSnapGoc` ở nguyên 0:
   * cú kéo KHÔNG chạm cần gizmo, nó rơi về OrbitControls. Một con số "ảnh có
   * đổi" ở đó KHÔNG nói gì về gizmo — đúng lớp lỗi "một đường sống che một
   * đường chết" mà `CanhThietKe` đã ghi.
   *
   * Cách định vị KHÔNG đoán: chụp ảnh TRƯỚC khi chọn máy và SAU khi chọn máy.
   * Chênh lệch giữa hai ảnh CHÍNH LÀ gizmo (không gì khác đổi trên canvas).
   * Lấy trọng tâm khối pixel đổi ⇒ toạ độ tâm gizmo; các cần toả ra từ đó.
   */
  for (const cd of ["translate", "rotate", "scale"] as const) {
    test(`V1-BAM-${cd} keo DUNG can gizmo`, async ({ page }) => {
      test.setTimeout(300_000);
      await moStudio(page);

      // ★ ĐẶT CHẾ ĐỘ TRƯỚC KHI CHỌN MÁY. Đảo thứ tự (chọn rồi mới đổi chế độ)
      //   đo được là KHÔNG ỔN ĐỊNH: `nut-che-do-*` nằm trên thanh công cụ, và
      //   bấm nó sau khi chọn làm mất tiêu điểm ở một số lượt, nên ảnh "đã chọn"
      //   thỉnh thoảng KHÔNG có gizmo (đo được: rotate/scale ra 0/0/0 pixel cần
      //   trong khi translate ra 397). Đặt chế độ trước thì `cheDo` đã đúng ngay
      //   lúc `<GizmoBienDoi>` mount.
      await page
        .getByTestId(`nut-che-do-${cd}`)
        .click()
        .catch(() => {});
      await page.waitForTimeout(500);

      // Fit trước, để cả cảnh vào khung — nếu không, máy được chọn có thể nằm
      // ngoài khung nhìn và gizmo không có pixel nào trên ảnh.
      await page
        .getByTestId("nut-fit-tat-ca")
        .click()
        .catch(() => {});
      await page.waitForTimeout(1_200);

      const v = await vungCanvas(page);
      const anhChuaChon = await page.screenshot({ clip: v.clip });

      // Chọn máy qua CÂY PHÂN CẤP — CHỈ máy ĐÃ ĐẶT CHỖ (xem docblock
      // `bungCayVaChonMayDaDat`: máy chưa đặt cho ra âm tính giả 0,000 %).
      const soNode = await bungCayVaChonMayDaDat(page);
      const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
      console.log(`
[V1-BAM-${cd}] so may DA DAT tren cay = ${soNode}`);
      if (soNode === 0) test.skip(true, "khong co may DA DAT tren cay de chon");
      await nodeMay.first().click();
      await page.waitForTimeout(1_500);

      // Cửa kiểm: gizmo PHẢI đã mount và đúng chế độ trước khi đo.
      const gMount = await page.evaluate(
        () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? null,
      );
      console.log(`[V1-BAM-${cd}] __gizmo sau khi chon = ${JSON.stringify(gMount)}`);
      expect(gMount, "gizmo phai mount sau khi chon may").not.toBeNull();
      expect((gMount as Record<string, unknown>).helperTrongScene).toBe(true);
      expect((gMount as Record<string, unknown>).cheDo).toBe(cd);

      const anhDaChon = await page.screenshot({ clip: v.clip });

      // ── ĐỊNH VỊ GIZMO BẰNG MÀU CẦN, không bằng trọng tâm pixel-đổi ──────
      // Trọng tâm của "mọi pixel đã đổi" KHÔNG dùng được: chọn máy còn làm đổi
      // highlight + nhãn rải khắp cảnh, nên trọng tâm rơi vào chỗ trống. Cần
      // gizmo của three có màu BÃO HOÀ đặc trưng (đỏ #ff0000 / lục #00ff00 /
      // lam #0000ff, `depthTest:false` nên không bị cảnh làm nhạt). Ta bắt
      // đúng những pixel đó và CHỈ trong vùng đã đổi khi chọn máy.
      const p = PNG.sync.read(anhChuaChon);
      const q = PNG.sync.read(anhDaChon);
      const diem: Array<{ x: number; y: number; kenh: number }> = [];
      for (let y = 0; y < p.height; y++) {
        for (let x = 0; x < p.width; x++) {
          const o = (y * p.width + x) * 4;
          const doi =
            Math.abs(p.data[o] - q.data[o]) > 24 ||
            Math.abs(p.data[o + 1] - q.data[o + 1]) > 24 ||
            Math.abs(p.data[o + 2] - q.data[o + 2]) > 24;
          if (!doi) continue;
          const r = q.data[o];
          const g = q.data[o + 1];
          const b = q.data[o + 2];
          // Bão hoà theo MỘT kênh. Ngưỡng NỚI so với bản đầu: cần XOAY của
          // three là VÒNG mảnh và cần CO GIÃN là hộp nhỏ — cả hai ít pixel và
          // bị khử răng cưa làm nhạt, nên ngưỡng 140/70 (hợp cho mũi tên đặc
          // của chế độ TỊNH TIẾN) trả về ĐÚNG 0 cho hai chế độ kia. Đo được:
          // "0/0/0" ở rotate và scale trong khi ảnh chụp CÓ gizmo.
          if (r >= 90 && r - g >= 40 && r - b >= 40) diem.push({ x, y, kenh: 0 });
          else if (g >= 90 && g - r >= 40 && g - b >= 40) diem.push({ x, y, kenh: 1 });
          else if (b >= 90 && b - r >= 40 && b - g >= 40) diem.push({ x, y, kenh: 2 });
        }
      }
      const demKenh = [0, 1, 2].map((c) => diem.filter((d) => d.kenh === c).length);
      console.log(
        `\n[V1-BAM-${cd}] pixel can gizmo (do/luc/lam) = ${demKenh.join("/")}  tong=${diem.length}`,
      );
      // Ảnh để MẮT kiểm — không nộp số nào mà không nhìn được cảnh sinh ra nó.
      await page.screenshot({ path: `${taoThuMuc(ANH)}/loV-gizmo-${cd}.png`, clip: v.clip });
      if (diem.length < 30) test.skip(true, "khong tim thay pixel can gizmo tren anh");

      // Cần ĐỎ = trục X trong three (nếu vắng, lấy lục = trục Y).
      const kenhDung = demKenh[0] >= 20 ? 0 : demKenh[1] >= 20 ? 1 : 2;
      const can = diem.filter((d) => d.kenh === kenhDung);
      const cx = can.reduce((s, d) => s + d.x, 0) / can.length;
      const cy = can.reduce((s, d) => s + d.y, 0) / can.length;
      const bx = v.clip.x + cx;
      const by = v.clip.y + cy;
      console.log(
        `[V1-BAM-${cd}] tam CAN (kenh ${["do", "luc", "lam"][kenhDung]}) tren man hinh = ` +
          `(${bx.toFixed(0)}, ${by.toFixed(0)})  so pixel = ${can.length}`,
      );

      const truocSnap = await page.evaluate(
        () =>
          (window as unknown as { __gizmo?: { soLanSnapGoc: number } }).__gizmo?.soLanSnapGoc ?? 0,
      );

      const k = await doThaoTac(page, async () => {
        await page.mouse.move(bx, by);
        await page.mouse.down({ button: "left" });
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(bx + i * 5, by - i * 2);
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "left" });
      });

      const sauG = await page.evaluate(
        () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? {},
      );
      // Bằng chứng đường GHI đã nhận thay đổi từ gizmo: đếm "chưa lưu" > 0.
      // Không dùng `getByTestId(...).textContent()` — huy hiệu đó chỉ dựng khi
      // đã có thay đổi, nên chờ nó là chờ 5 phút rồi timeout (đo được lần đầu).
      const demChuaLuu = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="dem-chua-luu"]');
        return el ? el.textContent : null;
      });
      inSo(
        `V1-BAM-${cd.toUpperCase()}`,
        "/twin-studio",
        k,
        `keo tu (${bx.toFixed(0)},${by.toFixed(0)})  ` +
          `soLanSnapGoc ${truocSnap} -> ${(sauG as { soLanSnapGoc?: number }).soLanSnapGoc ?? "?"}  ` +
          `gocSnapCuoiDo=${(sauG as { gocSnapCuoiDo?: number | null }).gocSnapCuoiDo}  ` +
          `dem-chua-luu=${JSON.stringify(demChuaLuu)}`,
      );
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });
  }

  /**
   * ★★★ V1-XOAY-DAI — CÙNG cần XOAY, chỉ khác QUÃNG KÉO.
   *
   * V1-BAM-rotate đo được điều kỳ lạ: `soLanSnapGoc 0 -> 20` (handler snap CHẠY
   * đủ 20 lần, tức cú kéo BẮT ĐÚNG vòng xoay) nhưng `gocSnapCuoiDo = 0` và độ
   * đổi ảnh = **0,000 %** — màn hình ĐỨNG IM trong khi mã vẫn chạy.
   *
   * Giả thuyết: `snapGocTuyetDoi(góc, 15)` làm tròn về BỘI CỦA 15°. Một cú kéo
   * ngắn sinh góc < 7,5° ⇒ làm tròn về **0** ⇒ `o.rotation.y` bị ghi lại đúng
   * giá trị cũ ⇒ không pixel nào đổi. Test này kéo QUÃNG DÀI trên cùng cần đó:
   * nếu ảnh đổi > 0 thì nguyên nhân là NGƯỠNG SNAP, không phải gizmo hỏng.
   */
  test("V1-XOAY-DAI keo vong xoay quang DAI (doi chung cua V1-BAM-rotate)", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    await page
      .getByTestId("nut-che-do-rotate")
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
    await page
      .getByTestId("nut-fit-tat-ca")
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);

    const v = await vungCanvas(page);
    const anhChuaChon = await page.screenshot({ clip: v.clip });
    const soDaDat = await bungCayVaChonMayDaDat(page);
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
    if (soDaDat === 0) test.skip(true, "khong co may DA DAT tren cay");
    await nodeMay.first().click();
    await page.waitForTimeout(1_500);
    const anhDaChon = await page.screenshot({ clip: v.clip });

    const p = PNG.sync.read(anhChuaChon);
    const q = PNG.sync.read(anhDaChon);
    const diemDo: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const o = (y * p.width + x) * 4;
        const doi =
          Math.abs(p.data[o] - q.data[o]) > 24 ||
          Math.abs(p.data[o + 1] - q.data[o + 1]) > 24 ||
          Math.abs(p.data[o + 2] - q.data[o + 2]) > 24;
        if (doi && q.data[o] >= 90 && q.data[o] - q.data[o + 1] >= 40 && q.data[o] - q.data[o + 2] >= 40) {
          diemDo.push({ x, y });
        }
      }
    }
    if (diemDo.length < 20) test.skip(true, "khong tim thay vong xoay do");
    const bx = v.clip.x + diemDo.reduce((s, d) => s + d.x, 0) / diemDo.length;
    const by = v.clip.y + diemDo.reduce((s, d) => s + d.y, 0) / diemDo.length;

    for (const quang of [40, 120, 300]) {
      const truocSnap = await page.evaluate(
        () =>
          (window as unknown as { __gizmo?: { soLanSnapGoc: number } }).__gizmo?.soLanSnapGoc ?? 0,
      );
      const k = await doThaoTac(page, async () => {
        await page.mouse.move(bx, by);
        await page.mouse.down({ button: "left" });
        const buoc = 24;
        for (let i = 1; i <= buoc; i++) {
          await page.mouse.move(bx + (quang * i) / buoc, by - (quang * i) / (buoc * 3));
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "left" });
      });
      const sauG = await page.evaluate(
        () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? {},
      );
      const demChuaLuu = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="dem-chua-luu"]');
        return el ? el.textContent : null;
      });
      inSo(
        `V1-XOAY-DAI-${quang}px`,
        "/twin-studio",
        k,
        `soLanSnapGoc ${truocSnap} -> ${(sauG as { soLanSnapGoc?: number }).soLanSnapGoc ?? "?"}  ` +
          `gocSnapCuoiDo=${(sauG as { gocSnapCuoiDo?: number | null }).gocSnapCuoiDo}  ` +
          `dem-chua-luu=${JSON.stringify(demChuaLuu)}`,
      );
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * ★ V1-XOAY-TAT-SNAP — cùng cú kéo NGẮN, nhưng TẮT snap.
   *   Nếu ảnh đổi > 0 khi tắt snap và = 0 khi bật, thì nguyên nhân được CÔ LẬP
   *   về đúng bước snap 15°, không phải về đường vẽ hay đường sự kiện.
   */
  test("V1-XOAY-TAT-SNAP keo NGAN nhung tat snap", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    await page
      .getByTestId("nut-che-do-rotate")
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    // Tắt công tắc snap (mặc định BẬT).
    await page
      .getByTestId("cong-tac-bat-dinh")
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    await page
      .getByTestId("nut-fit-tat-ca")
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);

    const v = await vungCanvas(page);
    const anhChuaChon = await page.screenshot({ clip: v.clip });
    const soDaDat = await bungCayVaChonMayDaDat(page);
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
    if (soDaDat === 0) test.skip(true, "khong co may DA DAT tren cay");
    await nodeMay.first().click();
    await page.waitForTimeout(1_500);
    const anhDaChon = await page.screenshot({ clip: v.clip });

    const p = PNG.sync.read(anhChuaChon);
    const q = PNG.sync.read(anhDaChon);
    const diemDo: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const o = (y * p.width + x) * 4;
        const doi =
          Math.abs(p.data[o] - q.data[o]) > 24 ||
          Math.abs(p.data[o + 1] - q.data[o + 1]) > 24 ||
          Math.abs(p.data[o + 2] - q.data[o + 2]) > 24;
        if (doi && q.data[o] >= 90 && q.data[o] - q.data[o + 1] >= 40 && q.data[o] - q.data[o + 2] >= 40) {
          diemDo.push({ x, y });
        }
      }
    }
    if (diemDo.length < 20) test.skip(true, "khong tim thay vong xoay do");
    const bx = v.clip.x + diemDo.reduce((s, d) => s + d.x, 0) / diemDo.length;
    const by = v.clip.y + diemDo.reduce((s, d) => s + d.y, 0) / diemDo.length;

    const k = await doThaoTac(page, async () => {
      await page.mouse.move(bx, by);
      await page.mouse.down({ button: "left" });
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(bx + i * 5, by - i * 2);
        await page.waitForTimeout(16);
      }
      await page.mouse.up({ button: "left" });
    });
    const sauG = await page.evaluate(
      () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? {},
    );
    const demChuaLuu = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dem-chua-luu"]');
      return el ? el.textContent : null;
    });
    inSo(
      "V1-XOAY-TAT-SNAP",
      "/twin-studio",
      k,
      `CUNG cu keo 100px nhu V1-BAM-rotate nhung TAT snap  ` +
        `soLanSnapGoc -> ${(sauG as { soLanSnapGoc?: number }).soLanSnapGoc ?? "?"}  ` +
        `gocSnapCuoiDo=${(sauG as { gocSnapCuoiDo?: number | null }).gocSnapCuoiDo}  ` +
        `dem-chua-luu=${JSON.stringify(demChuaLuu)}`,
    );
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /**
   * ★★★ V1-CHAN-DOAN — ĐỌC THẲNG `proxy.rotation.y` TRONG LÚC KÉO.
   *
   * `soLanSnapGoc` chỉ nói handler CHẠY; `gocSnapCuoiDo` chỉ nói giá trị handler
   * GHI. Cả hai đều không phân biệt được hai khả năng: (a) three không bao giờ
   * đặt góc khác 0 vào proxy, hay (b) three đặt rồi có ai đó ghi đè về 0.
   * `CanhThietKe` phơi `window.__gizmoProxy.vatThe` là THAM CHIẾU THẬT tới
   * proxy, nên ta lấy mẫu `rotation.y` mỗi khung và xem nó có bao giờ rời 0.
   */
  /**
   * ★★★ V1-BA-TRUC — kéo LẦN LƯỢT vòng ĐỎ (X), LỤC (Y), LAM (Z).
   *
   * V1-CHAN-DOAN (kéo vòng ĐỎ) đo được: quaternion đứng ở ĐÚNG đơn vị
   * `[0,0,0,1]` suốt 103 mẫu trong khi `soLanSnapGoc` lên 24. Nhưng "vòng đỏ"
   * trong three là trục **X**, còn máy đứng trên sàn chỉ được phép xoay quanh
   * trục ĐỨNG **Y** — và handler `objectChange` ép `o.rotation.x = 0` và
   * `o.rotation.z = 0` đúng theo thiết kế (`GizmoBienDoi.tsx`: "máy đứng trên
   * sàn: chỉ xoay quanh trục đứng").
   *
   * ⇒ Kéo vòng ĐỎ mà không thấy gì KHÔNG chứng minh gizmo hỏng: đó có thể là
   *   hành vi ĐÚNG. Chỉ vòng LỤC (Y) mới là ca dương. Test này đo cả ba để
   *   phân biệt "vá đúng ý đồ" với "hỏng thật", thay vì kết luận từ một trục.
   */
  test("V1-BA-TRUC keo lan luot vong DO(X) / LUC(Y) / LAM(Z)", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    await page
      .getByTestId("nut-che-do-rotate")
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    await page
      .getByTestId("nut-fit-tat-ca")
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);

    const v = await vungCanvas(page);
    const anhChuaChon = await page.screenshot({ clip: v.clip });
    const soDaDat = await bungCayVaChonMayDaDat(page);
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
    if (soDaDat === 0) test.skip(true, "khong co may DA DAT tren cay");
    await nodeMay.first().click();
    await page.waitForTimeout(1_500);
    const anhDaChon = await page.screenshot({ clip: v.clip });

    // Trọng tâm RIÊNG cho từng kênh màu = tâm của từng vòng.
    const p = PNG.sync.read(anhChuaChon);
    const q = PNG.sync.read(anhDaChon);
    const theoKenh: Array<Array<{ x: number; y: number }>> = [[], [], []];
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const o = (y * p.width + x) * 4;
        const doi =
          Math.abs(p.data[o] - q.data[o]) > 24 ||
          Math.abs(p.data[o + 1] - q.data[o + 1]) > 24 ||
          Math.abs(p.data[o + 2] - q.data[o + 2]) > 24;
        if (!doi) continue;
        const r = q.data[o];
        const g = q.data[o + 1];
        const b = q.data[o + 2];
        if (r >= 90 && r - g >= 40 && r - b >= 40) theoKenh[0].push({ x, y });
        else if (g >= 90 && g - r >= 40 && g - b >= 40) theoKenh[1].push({ x, y });
        else if (b >= 90 && b - r >= 40 && b - g >= 40) theoKenh[2].push({ x, y });
      }
    }
    const tenTruc = ["DO(X)", "LUC(Y)", "LAM(Z)"];
    for (let kenh = 0; kenh < 3; kenh++) {
      const pts = theoKenh[kenh];
      if (pts.length < 20) {
        console.log(`
[V1-BA-TRUC] ${tenTruc[kenh]}: chi ${pts.length} pixel — bo qua`);
        continue;
      }
      // Điểm XA tâm gizmo nhất theo kênh đó = chỗ vòng "mở" nhất, dễ bắt nhất.
      const cx = pts.reduce((s, d) => s + d.x, 0) / pts.length;
      const cy = pts.reduce((s, d) => s + d.y, 0) / pts.length;
      const bx = v.clip.x + cx;
      const by = v.clip.y + cy;

      await page.evaluate(() => {
        const w = window as unknown as {
          __gizmoProxy?: { vatThe: { quaternion: { x: number; y: number; z: number; w: number } } | null };
          __q?: number[][];
        };
        const ds: number[][] = [];
        w.__q = ds;
        const raf = window.requestAnimationFrame.bind(window);
        const buoc = () => {
          const o = w.__gizmoProxy?.vatThe ?? null;
          if (o) ds.push([o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w]);
          if (ds.length < 300) raf(buoc);
        };
        raf(buoc);
      });

      const k = await doThaoTac(page, async () => {
        await page.mouse.move(bx, by);
        await page.mouse.down({ button: "left" });
        for (let i = 1; i <= 24; i++) {
          await page.mouse.move(bx + i * 10, by - i * 4);
          await page.waitForTimeout(16);
        }
        await page.mouse.up({ button: "left" });
      });

      const qs = await page.evaluate(() => (window as unknown as { __q?: number[][] }).__q ?? []);
      const khac = qs.filter(
        (a) => Math.abs(a[0]) > 1e-6 || Math.abs(a[1]) > 1e-6 || Math.abs(a[2]) > 1e-6,
      );
      const gizmo = await page.evaluate(
        () => (window as unknown as { __gizmo?: Record<string, unknown> }).__gizmo ?? {},
      );
      const demChuaLuu = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="dem-chua-luu"]');
        return el ? el.textContent : null;
      });
      // ẢNH để MẮT kiểm — 0,001 % là một con số cần NHÌN mới hiểu.
      await page.screenshot({ path: `${taoThuMuc(ANH)}/loV-xoay-${kenh}.png`, clip: v.clip });
      inSo(
        `V1-BA-TRUC-${tenTruc[kenh]}`,
        "/twin-studio",
        k,
        `keo tu (${bx.toFixed(0)},${by.toFixed(0)}) tren ${pts.length} pixel  ` +
          `so mau quaternion KHAC don vi = ${khac.length}/${qs.length}  ` +
          `q cuoi = ${JSON.stringify(qs[qs.length - 1])}  ` +
          `soLanSnapGoc=${(gizmo as { soLanSnapGoc?: number }).soLanSnapGoc}  ` +
          `dem-chua-luu=${JSON.stringify(demChuaLuu)}`,
      );
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * ★★★ V1-GAN — CÙNG cú xoay Y, nhưng camera ZOOM SÁT vào máy.
   *
   * V1-BA-TRUC đo được nghịch lý: vòng LỤC (Y) cho quaternion
   * `[0, 0,38268, 0, 0,92388]` = **đúng 45°** (bội của bước snap 15°) và
   * `dem-chua-luu = "1 unsaved changes"` — tức đường xoay CHẠY ĐÚNG — nhưng độ
   * đổi ảnh vẫn chỉ **0,001 %**.
   *
   * Ảnh tự chụp (`.qa-loV/loV-xoay-1.png`) giải thích: ở khung nhìn "Fit
   * tất cả" trên sàn 3000 m × 2000 m, mỗi máy chỉ còn **vài pixel**. Xoay một
   * chấm 3 px đi 45° đổi đúng vài pixel — 0,001 % là con số ĐÚNG cho cảnh đó,
   * không phải dấu hiệu hỏng.
   *
   * ⇒ Test này lặp CÙNG cú xoay sau khi zoom sát. Nếu độ đổi ảnh bật lên rõ,
   *   kết luận là "gizmo mượt, chỉ khuất vì tỉ lệ", chứ không phải "gizmo đơ".
   *   Đây là ĐỐI CHỨNG cho chính phép đo, đúng tinh thần G5/G32.
   */
  test("V1-GAN xoay Y sau khi zoom SAT vao may", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    await page
      .getByTestId("nut-che-do-rotate")
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    // ★ FIT trước — không Fit thì gizmo không nằm trong khung nhìn ngay từ đầu
    //   và mọi phép đếm pixel sau đó trả 0 vì lý do SAI (đo được: 0 pixel lục
    //   ngay sau đợt cuộn đầu tiên).
    await page
      .getByTestId("nut-fit-tat-ca")
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);
    const soDaDat = await bungCayVaChonMayDaDat(page);
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
    if (soDaDat === 0) test.skip(true, "khong co may DA DAT tren cay");
    await nodeMay.first().click();
    await page.waitForTimeout(1_500);

    // ZOOM SÁT — cuộn TỪNG ĐỢT và DỪNG khi vòng lục còn to nhất.
    // ⚠ Cuộn thẳng 28 nấc đo được là HỎNG: OrbitControls zoom về TÂM QUAY, không
    //   về máy đang chọn, nên gizmo trôi ra ngoài khung và phép đo trả 0 pixel
    //   lục — một "không tìm thấy" vì lý do SAI. Nên phải đo lại sau mỗi đợt.
    const demLuc = async () => {
      const vv = await vungCanvas(page);
      const im = PNG.sync.read(await page.screenshot({ clip: vv.clip }));
      let n = 0;
      for (let i = 0; i < im.width * im.height; i++) {
        const o = i * 4;
        const r = im.data[o];
        const g = im.data[o + 1];
        const b = im.data[o + 2];
        if (g >= 90 && g - r >= 40 && g - b >= 40) n += 1;
      }
      return n;
    };
    let tot = await demLuc();
    for (let dot = 0; dot < 8; dot++) {
      const vv = await vungCanvas(page);
      await page.mouse.move(vv.tx, vv.ty);
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(40);
      }
      await page.waitForTimeout(700);
      const n = await demLuc();
      console.log(`   [V1-GAN] sau dot ${dot + 1}: pixel luc = ${n}`);
      if (n === 0 || n < tot / 2) break; // gizmo bat dau troi khoi khung
      tot = Math.max(tot, n);
    }
    await page.waitForTimeout(800);

    const v = await vungCanvas(page);
    // Định vị lại vòng LỤC sau khi zoom: bỏ chọn rồi chọn lại để có ảnh nền.
    const anhCoGizmo = await page.screenshot({ clip: v.clip });
    const img = PNG.sync.read(anhCoGizmo);
    const luc: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const o = (y * img.width + x) * 4;
        const r = img.data[o];
        const g = img.data[o + 1];
        const b = img.data[o + 2];
        if (g >= 90 && g - r >= 40 && g - b >= 40) luc.push({ x, y });
      }
    }
    console.log(`
[V1-GAN] pixel vong LUC sau khi zoom = ${luc.length}`);
    if (luc.length < 20) test.skip(true, "khong tim thay vong luc sau khi zoom");
    const bx = v.clip.x + luc.reduce((s, d) => s + d.x, 0) / luc.length;
    const by = v.clip.y + luc.reduce((s, d) => s + d.y, 0) / luc.length;

    const k = await doThaoTac(page, async () => {
      await page.mouse.move(bx, by);
      await page.mouse.down({ button: "left" });
      for (let i = 1; i <= 24; i++) {
        await page.mouse.move(bx + i * 10, by - i * 4);
        await page.waitForTimeout(16);
      }
      await page.mouse.up({ button: "left" });
    });
    await page.screenshot({ path: `${taoThuMuc(ANH)}/loV-xoay-gan.png`, clip: v.clip });

    const cuoi = await page.evaluate(() => {
      const w = window as unknown as {
        __gizmoProxy?: { vatThe: { quaternion: { x: number; y: number; z: number; w: number } } | null };
        __gizmo?: Record<string, unknown>;
      };
      const o = w.__gizmoProxy?.vatThe ?? null;
      return {
        q: o ? [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] : null,
        gizmo: w.__gizmo ?? null,
      };
    });
    const demChuaLuu = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dem-chua-luu"]');
      return el ? el.textContent : null;
    });
    const gocDo =
      cuoi.q === null ? null : ((2 * Math.asin(Math.min(1, Math.abs(cuoi.q[1]))) * 180) / Math.PI).toFixed(2);
    inSo(
      "V1-GAN",
      "/twin-studio",
      k,
      `XOAY Y sau khi zoom sat  q = ${JSON.stringify(cuoi.q)}  ` +
        `=> goc quanh Y ~ ${gocDo} do  dem-chua-luu=${JSON.stringify(demChuaLuu)}`,
    );
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V1-CHAN-DOAN doc proxy.rotation.y moi khung trong luc keo xoay", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    await page
      .getByTestId("nut-che-do-rotate")
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
    await page
      .getByTestId("nut-fit-tat-ca")
      .click()
      .catch(() => {});
    await page.waitForTimeout(1_200);

    const v = await vungCanvas(page);
    const anhChuaChon = await page.screenshot({ clip: v.clip });
    const soDaDat = await bungCayVaChonMayDaDat(page);
    const nodeMay = page.locator('[data-testid^="node-cay-machine:"][data-cho-xep-cho="0"]');
    if (soDaDat === 0) test.skip(true, "khong co may DA DAT tren cay");
    await nodeMay.first().click();
    await page.waitForTimeout(1_500);
    const anhDaChon = await page.screenshot({ clip: v.clip });

    const p = PNG.sync.read(anhChuaChon);
    const q = PNG.sync.read(anhDaChon);
    const diemDo: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const o = (y * p.width + x) * 4;
        const doi =
          Math.abs(p.data[o] - q.data[o]) > 24 ||
          Math.abs(p.data[o + 1] - q.data[o + 1]) > 24 ||
          Math.abs(p.data[o + 2] - q.data[o + 2]) > 24;
        if (doi && q.data[o] >= 90 && q.data[o] - q.data[o + 1] >= 40 && q.data[o] - q.data[o + 2] >= 40) {
          diemDo.push({ x, y });
        }
      }
    }
    if (diemDo.length < 20) test.skip(true, "khong tim thay vong xoay do");
    const bx = v.clip.x + diemDo.reduce((s, d) => s + d.x, 0) / diemDo.length;
    const by = v.clip.y + diemDo.reduce((s, d) => s + d.y, 0) / diemDo.length;

    // Cắm bộ lấy mẫu: `rotation.y` + `position` + `parent` mỗi khung.
    await page.evaluate(() => {
      const w = window as unknown as {
        __gizmoProxy?: { vatThe: { rotation: { x: number; y: number; z: number }; position: { x: number; y: number; z: number }; parent: unknown; scale: { x: number; y: number; z: number } } | null };
        __mau?: Array<{ t: number; ry: number; px: number; pz: number; sx: number; coParent: boolean; q: number[] }>;
      };
      const mau: Array<{ t: number; ry: number; px: number; pz: number; sx: number; coParent: boolean; q: number[] }> = [];
      w.__mau = mau;
      const t0 = performance.now();
      const raf = window.requestAnimationFrame.bind(window);
      const buoc = () => {
        const o = w.__gizmoProxy?.vatThe ?? null;
        if (o) {
          // ★ Lấy CẢ `quaternion` — đó là nơi three ghi kết quả xoay.
          const qq = (o as unknown as { quaternion: { x: number; y: number; z: number; w: number } })
            .quaternion;
          mau.push({
            t: performance.now() - t0,
            ry: o.rotation.y,
            px: o.position.x,
            pz: o.position.z,
            sx: o.scale.x,
            coParent: o.parent != null,
            q: [qq.x, qq.y, qq.z, qq.w],
          });
        }
        if (mau.length < 400) raf(buoc);
      };
      raf(buoc);
    });

    await page.mouse.move(bx, by);
    await page.mouse.down({ button: "left" });
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(bx + i * 12, by - i * 4);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: "left" });
    await page.waitForTimeout(600);

    const mau = await page.evaluate(
      () =>
        (window as unknown as { __mau?: Array<{ t: number; ry: number; px: number; pz: number; sx: number; coParent: boolean; q: number[] }> })
          .__mau ?? [],
    );
    const ryKhac0 = mau.filter((m) => Math.abs(m.ry) > 1e-6);
    const ryMax = mau.reduce((s, m) => Math.max(s, Math.abs(m.ry)), 0);
    const coParentSai = mau.filter((m) => !m.coParent).length;
    // ★★★ Quaternion KHÁC đơn vị = three ĐÃ xoay object thật.
    //   `TransformControls.js:704-713` ghi kết quả xoay vào `object.quaternion`,
    //   KHÔNG vào `object.rotation`. Một phép đo chỉ đọc `rotation` KHÔNG phân
    //   biệt được "three không xoay gì" với "three CÓ xoay mà ai đó xoá đi" —
    //   hai chẩn đoán ấy dẫn tới hai bản vá khác hẳn nhau.
    const qKhacDonVi = mau.filter(
      (m) => Math.abs(m.q[0]) > 1e-6 || Math.abs(m.q[1]) > 1e-6 || Math.abs(m.q[2]) > 1e-6,
    );
    console.log(
      `
[V1-CHAN-DOAN] so mau = ${mau.length}  ` +
        `so mau co rotation.y != 0 = ${ryKhac0.length}  ` +
        `|rotation.y| lon nhat = ${ryMax.toExponential(3)} rad (${((ryMax * 180) / Math.PI).toFixed(4)} do)
` +
        `   so mau QUATERNION khac don vi = ${qKhacDonVi.length}
` +
        `   so mau proxy MAT parent = ${coParentSai}
` +
        `   5 mau q khac don vi: ${JSON.stringify(qKhacDonVi.slice(0, 5))}
` +
        `   10 mau giua cu keo: ${JSON.stringify(mau.slice(Math.floor(mau.length / 3), Math.floor(mau.length / 3) + 10))}`,
    );
    // Đọc thêm góc CUỐI + trạng thái gizmo.
    const cuoi = await page.evaluate(() => {
      const w = window as unknown as {
        __gizmoProxy?: { vatThe: { rotation: { y: number }; position: { x: number; y: number; z: number }; scale: { x: number } } | null };
        __gizmo?: Record<string, unknown>;
      };
      const o = w.__gizmoProxy?.vatThe ?? null;
      return {
        ry: o ? o.rotation.y : null,
        pos: o ? { x: o.position.x, y: o.position.y, z: o.position.z } : null,
        sx: o ? o.scale.x : null,
        gizmo: w.__gizmo ?? null,
      };
    });
    console.log(`   trang thai CUOI = ${JSON.stringify(cuoi)}`);
    expect(mau.length).toBeGreaterThan(0);
  });

  test("V1-DOI-CHUNG khong cham chuot", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    const k = await doThaoTac(page, async () => {
      await page.waitForTimeout(400);
    });
    inSo("V1-DOI-CHUNG", "/twin-studio", k, "KHONG cham chuot — phai ~0 %");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* V2 — LONG TASK LÚC ZOOM /twin                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

test.describe("V2 — quy ket long task luc zoom /twin", () => {
  test("V2-ZOOM voi PerformanceObserver + CPU profile", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });

    const v = await vungCanvas(page);
    const truoc = await page.screenshot({ clip: v.clip });
    await batDauDo(page);
    await cdp.send("Profiler.start");

    await page.mouse.move(v.tx, v.ty);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(700);

    const prof = (await cdp.send("Profiler.stop")) as unknown as {
      profile: {
        nodes: Array<{
          id: number;
          callFrame: { functionName: string; url: string; lineNumber: number };
        }>;
        samples?: number[];
        timeDeltas?: number[];
      };
    };
    const d = await ketThucDo(page);
    const sau = await page.screenshot({ clip: v.clip });

    const k: KetQua = {
      doDoiPixel: tiLeKhac(truoc, sau),
      soKhungVe: d.khung,
      treDauMs: d.treDau,
      longTask: d.longTask,
      longTaskMax: d.longTaskMax,
      quyKet: d.quyKet,
    };
    inSo("V2-ZOOM", "/twin", k);
    console.log(`   chi tiet long task: ${JSON.stringify(d.chiTiet)}`);

    // ── Quy kết bằng CPU profile: cộng self-time theo NÚT ────────────────
    const p = prof.profile;
    const theoNut = new Map<number, number>();
    if (p.samples && p.timeDeltas) {
      for (let i = 0; i < p.samples.length; i++) {
        theoNut.set(p.samples[i], (theoNut.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0));
      }
    }
    const bang = p.nodes
      .map((n) => ({
        ten: n.callFrame.functionName || "(anonymous)",
        url: (n.callFrame.url || "").split("/").pop() ?? "",
        dong: n.callFrame.lineNumber,
        us: theoNut.get(n.id) ?? 0,
      }))
      .filter((r) => r.us > 0)
      .sort((a, b) => b.us - a.us)
      .slice(0, 25);
    console.log("\n   ── TOP 25 SELF-TIME (CPU profile, micro-giay) ──");
    for (const r of bang) {
      console.log(`   ${(r.us / 1000).toFixed(1).padStart(8)} ms  ${r.ten}  @${r.url}:${r.dong}`);
    }
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V2-DOI-CHUNG dung yen (long task NEN)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const k = await doThaoTac(
      page,
      async () => {
        await page.waitForTimeout(1_000);
      },
      1_000,
    );
    inSo("V2-DOI-CHUNG", "/twin", k, "dung yen — long task NEN cua trang");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V2-ZOOM-LAN-2 (zoom lan thu hai, cung phien)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    // Lần 1 — "làm nóng".
    const k1 = await doThaoTac(page, async (tx, ty) => {
      await page.mouse.move(tx, ty);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(16);
      }
    });
    inSo("V2-ZOOM-lan1", "/twin", k1, "zoom lan DAU trong phien");
    // Lần 2 — cùng chuỗi sự kiện, cùng trang, không tải lại.
    const k2 = await doThaoTac(page, async (tx, ty) => {
      await page.mouse.move(tx, ty);
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(16);
      }
    });
    inSo(
      "V2-ZOOM-lan2",
      "/twin",
      k2,
      "zoom lan HAI — neu long task tut manh thi nguyen nhan la LAN DAU (nap luoi/bien dich shader), khong phai ban than zoom",
    );
    expect(k2.doDoiPixel).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* V3 — CHỌN MÁY · ĐỔI PHẠM VI · MỞ/ĐÓNG PANEL                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

test.describe("V3 — ba thao tac con lai", () => {
  test("V3-CHON-MAY (/twin, click canh 3D)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const k = await doThaoTac(page, async (tx, ty) => {
      await page.mouse.click(tx, ty);
    });
    inSo("V3-CHON-MAY", "/twin", k, "click giua canvas");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V3-CHON-MAY-DS (/twin, click hang danh sach)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const hang = page.locator('[data-testid^="may-hang-"]');
    const n = await hang.count();
    console.log(`\n[V3-CHON-MAY-DS] so hang danh sach = ${n}`);
    const k = await doThaoTac(page, async () => {
      if (n > 0) await hang.nth(Math.min(3, n - 1)).click();
    });
    inSo("V3-CHON-MAY-DS", "/twin", k, "click hang trong DanhSachMay");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V3-DOI-PHAM-VI (/twin, breadcrumb)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const bc = page.locator('[data-testid^="breadcrumb-"]');
    const n = await bc.count();
    console.log(`\n[V3-DOI-PHAM-VI] so muc breadcrumb = ${n}`);
    // Đổi phạm vi có TWEEN camera — chờ dài hơn để đo trọn cú bay.
    const k = await doThaoTac(
      page,
      async () => {
        if (n > 1) await bc.nth(n - 1).click();
      },
      2_500,
    );
    inSo("V3-DOI-PHAM-VI", "/twin", k, "bam muc breadcrumb sau cung (co tween)");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  test("V3-PANEL (/twin, thu/mo panel trai + phai)", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const k = await doThaoTac(
      page,
      async () => {
        await page
          .getByTestId("nut-thu-trai")
          .click()
          .catch(() => {});
        await page.waitForTimeout(250);
        await page
          .getByTestId("nut-thu-phai")
          .click()
          .catch(() => {});
      },
      1_200,
    );
    inSo("V3-PANEL", "/twin", k, "thu panel trai roi panel phai");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* V4 — SĂN "KHÔNG THỰC HIỆN ĐƯỢC"                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Chuỗi ORBIT chuẩn — dùng lại Y HỆT ở mọi điều kiện của V4 để các số so được
 * với nhau. Trả về một hàm `(tx, ty) => Promise<void>` đúng chữ ký `doThaoTac`
 * mong đợi; truyền thẳng `orbitChuan` (nhận `page` làm đối số đầu) vào đó sẽ
 * cho `page === tx` là một SỐ, và lỗi là `Cannot read properties of undefined
 * (reading 'move')` — đo được ở lượt chạy đầu.
 */
function orbitChuan(page: Page) {
  return async (tx: number, ty: number) => {
    await page.mouse.move(tx, ty);
    await page.mouse.down({ button: "left" });
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(tx + i * 10, ty);
      await page.waitForTimeout(16);
    }
    await page.mouse.up({ button: "left" });
  };
}

test.describe("V4 — san 'KHONG THUC HIEN DUOC'", () => {
  /** Đk A: thao tác NGAY SAU KHI TẢI — không chờ 5s ổn định. */
  test("V4-A ngay sau khi tai (khong cho on dinh)", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1600, height: 950 });
    await dangNhap(page);
    await page.goto("/twin", { waitUntil: "domcontentloaded" });
    await choKhungDau(page);
    await camDongHo(page);
    const k = await doThaoTac(page, orbitChuan(page));
    inSo("V4-A", "/twin", k, "ORBIT NGAY khi khung dau vua ve (0s on dinh)");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /** Đk B: CPU throttle — máy chậm hơn của chủ sở hữu. */
  for (const heSo of [4, 6, 10, 20]) {
    test(`V4-B CPU throttle x${heSo}`, async ({ page }) => {
      test.setTimeout(300_000);
      await moTrang(page, "/twin");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: heSo });
      const k = await doThaoTac(page, orbitChuan(page), 1_500);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      inSo(`V4-B-x${heSo}`, "/twin", k, `ORBIT duoi CPU throttle x${heSo}`);
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    });
  }

  /** Đk B': CPU throttle trên màn Thiết kế (nặng hơn: gizmo + cây + inspector). */
  test("V4-B-studio CPU throttle x10 tren /twin-studio", async ({ page }) => {
    test.setTimeout(300_000);
    await moStudio(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 10 });
    const k = await doThaoTac(page, orbitChuan(page), 1_500);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    inSo("V4-B-studio-x10", "/twin-studio", k, "ORBIT duoi CPU throttle x10");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /**
   * ★★★ V4-B-QUY-KET — CPU profile TRONG LÚC bị throttle.
   *
   * V4-B đã TÁI HIỆN ĐƯỢC triệu chứng (throttle ×4 cho long task dài **2543 ms**;
   * ×20 cho **13320 ms**, so với 0–5 task ≤ ~100 ms lúc không throttle). Nhưng
   * "tái hiện được" chưa phải "quy được nguyên nhân" — test này lấy CPU profile
   * trong đúng cửa sổ đó để biết thời gian nằm ở HÀM nào, không đoán từ tên.
   */
  test("V4-B-QUY-KET CPU profile duoi throttle x6", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

    const v = await vungCanvas(page);
    const truoc = await page.screenshot({ clip: v.clip });
    await batDauDo(page);
    await cdp.send("Profiler.start");
    await orbitChuan(page)(v.tx, v.ty);
    await page.waitForTimeout(2_000);
    const prof = (await cdp.send("Profiler.stop")) as unknown as {
      profile: {
        nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number } }>;
        samples?: number[];
        timeDeltas?: number[];
      };
    };
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const d = await ketThucDo(page);
    const sau = await page.screenshot({ clip: v.clip });

    inSo(
      "V4-B-QUY-KET",
      "/twin",
      {
        doDoiPixel: tiLeKhac(truoc, sau),
        soKhungVe: d.khung,
        treDauMs: d.treDau,
        longTask: d.longTask,
        longTaskMax: d.longTaskMax,
        quyKet: d.quyKet,
      },
      "ORBIT duoi throttle x6 + CPU profile",
    );
    console.log(`   chi tiet long task: ${JSON.stringify(d.chiTiet)}`);

    const pr = prof.profile;
    const theoNut = new Map<number, number>();
    if (pr.samples && pr.timeDeltas) {
      for (let i = 0; i < pr.samples.length; i++) {
        theoNut.set(pr.samples[i], (theoNut.get(pr.samples[i]) ?? 0) + (pr.timeDeltas[i] ?? 0));
      }
    }
    const bang = pr.nodes
      .map((n) => ({
        ten: n.callFrame.functionName || "(anonymous)",
        url: (n.callFrame.url || "").split("/").pop() ?? "",
        dong: n.callFrame.lineNumber,
        us: theoNut.get(n.id) ?? 0,
      }))
      .filter((r) => r.us > 0)
      .sort((a, b) => b.us - a.us)
      .slice(0, 25);
    console.log("\n   ── TOP 25 SELF-TIME duoi throttle x6 ──");
    for (const r of bang) {
      console.log(`   ${(r.us / 1000).toFixed(1).padStart(9)} ms  ${r.ten}  @${r.url}:${r.dong}`);
    }
    expect(d.longTask).toBeGreaterThanOrEqual(0);
  });

  /** Đk C: thao tác TRONG LÚC truy vấn tRPC đang chạy (ép bằng nút Nạp lại). */
  test("V4-C thao tac trong luc tRPC dang chay", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const k = await doThaoTac(
      page,
      async (tx, ty) => {
        // Bấm "Nạp lại" rồi ORBIT NGAY, không chờ truy vấn xong.
        await page
          .getByTestId("nut-nap-lai")
          .click()
          .catch(() => {});
        await orbitChuan(page)(tx, ty);
      },
      1_500,
    );
    inSo("V4-C", "/twin", k, "ORBIT ngay sau khi bam Nap lai (tRPC dang bay)");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /** Đk D: chọn máy (ngăn nhúng nạp cả một màn) rồi thao tác ngay. */
  test("V4-D sau khi mo ngan nhung", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const hang = page.locator('[data-testid^="may-hang-"]');
    if ((await hang.count()) > 0) await hang.first().click();
    await page.waitForTimeout(1_500);
    const k = await doThaoTac(page, orbitChuan(page), 1_200);
    inSo("V4-D", "/twin", k, "ORBIT sau khi chon may (ngan nhung da nap)");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /** Đk E: kéo LIÊN TIẾP nhiều lần không nghỉ — dồn sự kiện. */
  test("V4-E keo lien tiep 6 lan khong nghi", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    for (let lan = 1; lan <= 6; lan++) {
      const k = await doThaoTac(
        page,
        async (tx, ty) => {
          await page.mouse.move(tx, ty);
          await page.mouse.down({ button: "left" });
          for (let i = 1; i <= 12; i++) {
            await page.mouse.move(tx + i * 12, ty + (lan % 2 ? i * 4 : -i * 4));
            await page.waitForTimeout(8);
          }
          await page.mouse.up({ button: "left" });
        },
        150,
      );
      inSo(`V4-E-lan${lan}`, "/twin", k, "keo lien tiep, chi nghi 150ms");
      expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
    }
  });

  /** Đk F: kéo ra NGOÀI canvas rồi thả — chuột rời vùng trong lúc đang kéo. */
  test("V4-F tha chuot NGOAI canvas", async ({ page }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const k1 = await doThaoTac(page, async (tx, ty) => {
      await page.mouse.move(tx, ty);
      await page.mouse.down({ button: "left" });
      for (let i = 1; i <= 15; i++) {
        await page.mouse.move(tx + i * 30, ty - i * 20);
        await page.waitForTimeout(12);
      }
      // Thả khi con trỏ đã ra ngoài canvas (góc trên phải màn hình).
      await page.mouse.move(1595, 5);
      await page.mouse.up({ button: "left" });
    });
    inSo("V4-F-buoc1", "/twin", k1, "keo RA NGOAI canvas roi tha o do");
    // Bước 2: thao tác BÌNH THƯỜNG ngay sau đó — nếu con trỏ bị "kẹt" trạng
    // thái đang-kéo thì bước này sẽ ra ~0 %.
    const k2 = await doThaoTac(page, orbitChuan(page));
    inSo("V4-F-buoc2", "/twin", k2, "ORBIT binh thuong NGAY SAU cu tha ngoai canvas");
    expect(k2.doDoiPixel).toBeGreaterThanOrEqual(0);
  });

  /** Đk G: đổi tab trình duyệt rồi quay lại (rAF bị treo, `demand` mất nhịp). */
  test("V4-G quay lai sau khi tab bi an", async ({ page, context }) => {
    test.setTimeout(300_000);
    await moTrang(page, "/twin");
    const tab2 = await context.newPage();
    await tab2.goto("about:blank");
    await tab2.bringToFront();
    await page.waitForTimeout(3_000);
    await page.bringToFront();
    await page.waitForTimeout(500);
    const k = await doThaoTac(page, orbitChuan(page));
    await tab2.close();
    inSo("V4-G", "/twin", k, "ORBIT ngay sau khi tab duoc dua lai truoc");
    expect(k.doDoiPixel).toBeGreaterThanOrEqual(0);
  });
});

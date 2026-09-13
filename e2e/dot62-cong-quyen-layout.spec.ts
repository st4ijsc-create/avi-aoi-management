import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ĐỢT 62 mục A — LỚP LỖI "MỘT LỐI VÀO RỒI TỪ CHỐI", ĐO **HAI CHIỀU** BẰNG VAI THẬT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ô "Sơ đồ bố trí" (`DataManagementHub`) và liên kết nhanh "Bố cục nhà máy"
 * (`DataSettings`) đều trỏ `href="/layout"`. Từ Đợt 61, `App.tsx:741` là
 * `<Route path="/layout"><Redirect to="/twin-studio" /></Route>`, và
 * `/twin-studio` gate bằng `requiredPermissionAny: ["settings_factory","machine_control"]`.
 *
 * Nhưng ĐIỀU KIỆN HIỂN THỊ của hai lối vào ấy lại tra quyền của **`/digital-twin`**
 * (`analytics_oee`) — một route CHỈ CÒN LÀ REDIRECT, không phải đích thật. Hai gate
 * rời nhau ⇒ hỏng được theo **hai chiều ngược nhau**, và một chiều đo là chưa đo gì:
 *
 *   ┌─ CHIỀU XUÔI  ─ có `analytics_oee`, KHÔNG có quyền thiết kế
 *   │                ⇒ **THẤY ô rồi bị RouteGuard TỪ CHỐI** (dead-end).
 *   └─ CHIỀU NGƯỢC ─ có `machine_control`/`settings_factory`, KHÔNG có `analytics_oee`
 *                    ⇒ **KHÔNG THẤY ô** dù vào được — lối vào bị GIẤU, câm hơn.
 *
 * ⇒ BẤT BIẾN suite này ghim: với MỌI vai, **THẤY ⇔ VÀO ĐƯỢC**.
 *
 * ★★★ ĐO BẰNG VAI KHÔNG-ADMIN. `usePermissions.hasPermission` trả `true` cho mọi
 *   chuỗi khi `role === "admin"` ⇒ đo bằng admin chứng minh SỐ 0 (bài học Khối D).
 *
 * ★ Bốn hàng dưới là 2×2 ĐẦY ĐỦ trên hai cổng ĐỘC LẬP (`analytics_oee` ×
 *   `machine_control`). Hai hàng "đồng ý" (cahai/khong) là ĐỐI CHỨNG: nếu bản vá
 *   biến cổng thành "ai cũng thấy" hay "không ai thấy", chúng đỏ ngay.
 *
 * ★ Tài khoản: `dot62_*` là hàng TẠM tạo cho đợt đo (xoá bằng
 *   `.qa-dot62/tam-user-xoa.sql`); `engineer1` là vai seed THẬT — nó chứng minh
 *   lỗi chiều ngược tồn tại trên dữ liệu sản phẩm, không chỉ trên hàng tạm.
 */

type O = {
  ma: string;
  tk: { username: string; password: string };
  man: string;
  quyen: string;
  /** cách nhận ra lối vào trên màn ấy */
  loiVao: "tile" | "quicklink";
};

const VAI: O[] = [
  { ma: "A1-oee",       tk: { username: "dot62_oee",   password: "User@123" }, man: "/data-management", quyen: "masterdata + analytics_oee",                    loiVao: "tile" },
  { ma: "A2-ctrl",      tk: { username: "dot62_ctrl",  password: "User@123" }, man: "/data-management", quyen: "masterdata + machine_control",                  loiVao: "tile" },
  { ma: "A3-cahai",     tk: { username: "dot62_cahai", password: "User@123" }, man: "/data-management", quyen: "masterdata + analytics_oee + machine_control",  loiVao: "tile" },
  { ma: "A4-khong",     tk: { username: "dot62_khong", password: "User@123" }, man: "/data-management", quyen: "masterdata (không quyền twin nào)",             loiVao: "tile" },
  { ma: "A5-engineer1", tk: { username: "engineer1",   password: "User@123" }, man: "/datasettings",    quyen: "settings_factory + machine_control (seed thật)", loiVao: "quicklink" },
];

/**
 * Lối vào "Layout" được nhận ra qua CẢ HAI cách viết của cùng một đích:
 * `/layout` (bản trước Đợt 62 — redirect) và `/twin-studio` (đích thật).
 */
const SEL_O_LAYOUT = 'a[href="/layout"], a[href="/twin-studio"]';

const KQ: Record<string, { thay: boolean; vaoDuoc: boolean; urlCuoi: string; quyen: string; man: string }> = {};

/**
 * ★★★ G100-họ — THIẾT BỊ ĐO MÙ VÌ NGÔN NGỮ. Lượt đo đầu của Đợt 62 tìm chuỗi
 * tiếng Việt ("Không có quyền truy cập") trong khi trình duyệt Playwright chạy
 * `navigator.language = en-US` ⇒ app hiện tiếng Anh ("Access denied") ⇒ CẢ HAI
 * dấu hiệu vào/chặn đều bằng 0 và phép đo không phân biệt được gì. Ghim ngôn ngữ
 * TRƯỚC khi trang chạy (i18n detection order: localStorage → navigator → htmlTag).
 */
async function ghimTiengViet(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("i18nextLng", "vi"); } catch { /* private mode */ }
  });
}

async function dangNhap(page: Page, tk: O["tk"]) {
  const res = await page.request.post("/api/auth/login", { data: tk });
  expect(res.status(), `dang nhap ${tk.username}`).toBe(200);
  const me = await page.request.get("/api/auth/me");
  if (me.ok()) {
    const body = await me.json().catch(() => null);
    const ten = body?.username ?? body?.user?.username;
    if (ten) expect(ten, "phien phai dung vai vua dang nhap").toBe(tk.username);
  }
}

/**
 * Lối vào có HIỆN không — đọc từ DOM thật, **đi đúng đường người dùng** (G123).
 *
 * ★ `HubLauncher` chỉ render ô của DANH MỤC ĐANG CHỌN; mặc định là danh mục đầu.
 *   Lượt đo đầu đếm `a[href="/layout"]` ngay khi trang mở ⇒ 0 cho MỌI vai, kể cả
 *   vai đang thấy ô — âm tính giả cho cả bảng. Phải BẤM vào danh mục "Cấu hình
 *   nhà máy & Quản trị" trước, y như người dùng.
 */
async function coLoiVao(page: Page, o: O): Promise<boolean> {
  await page.goto(o.man, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5_000);
  if (o.loiVao === "tile") {
    // ĐỐI CHỨNG DƯƠNG: hub phải thực sự dựng (một danh mục khác phải có mặt),
    // nếu không thì "không thấy ô" chỉ là trang chưa render — phép đo mù.
    await expect(page.getByRole("button", { name: /Dữ liệu chủ/ })).toHaveCount(1, { timeout: 30_000 });
    const nutDanhMuc = page.getByRole("button", { name: /Cấu hình nhà máy & Quản trị/ });
    if ((await nutDanhMuc.count()) === 0) return false; // 0 ô ⇒ HubLauncher bỏ hẳn danh mục
    await nutDanhMuc.first().click();
    await page.waitForTimeout(1_500);
    return (await page.locator(SEL_O_LAYOUT).count()) > 0;
  }
  // ĐỐI CHỨNG DƯƠNG: thẻ "Liên kết nhanh" phải dựng (một liên kết khác có mặt).
  await expect(page.getByRole("button", { name: /Trạm làm việc/ }).first()).toBeVisible({ timeout: 30_000 });
  return (await page.getByRole("button", { name: /Bố cục nhà máy/ }).count()) > 0;
}

/**
 * ĐI ĐÚNG ĐƯỜNG NGƯỜI DÙNG: mở href của lối vào và xem có tới nơi không.
 *
 * ★ Đợt 62 đổi href của ô/liên kết từ `/layout` (redirect) sang `/twin-studio`
 *   (đích thật) để href và cổng quyền là MỘT. Suite phải đo được trên CẢ HAI
 *   bản — nếu không, lượt ablation (gỡ vá) sẽ "xanh" chỉ vì selector hụt, chứ
 *   không phải vì lỗi biến mất. `/layout` vẫn `<Redirect>` tới cùng một nơi.
 */
async function vaoDuocDich(page: Page, duong = "/layout"): Promise<{ vao: boolean; url: string }> {
  await page.goto(duong, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6_000);
  const coStudio = (await page.locator('[data-testid="man-twin-studio"]').count()) > 0;
  const biChan = (await page.getByText("Không có quyền truy cập").count()) > 0;
  // hai dấu hiệu phải LOẠI TRỪ nhau — nếu cả hai cùng 0, phép đo đang mù
  expect(coStudio !== biChan, `phep do phai phan biet duoc vao/chan (url=${page.url()})`).toBe(true);
  return { vao: coStudio, url: page.url() };
}

for (const o of VAI) {
  test(`A ${o.ma} — ${o.tk.username} (${o.quyen}) trên ${o.man}: THẤY ⇔ VÀO ĐƯỢC`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await ghimTiengViet(page);
    await dangNhap(page, o.tk);
    const thay = await coLoiVao(page, o);
    const { vao, url } = await vaoDuocDich(page);
    KQ[o.ma] = { thay, vaoDuoc: vao, urlCuoi: url, quyen: o.quyen, man: o.man };
    const thuMuc = process.env.QA_DOT62_RA ?? ".qa-dot62";
    fs.mkdirSync(thuMuc, { recursive: true });
    fs.writeFileSync(path.join(thuMuc, `A-${o.ma}.json`), JSON.stringify(KQ[o.ma], null, 2));
    expect(
      thay,
      `LỚP LỖI "một lối vào rồi TỪ CHỐI": ${o.tk.username} ${thay ? "THẤY" : "KHÔNG thấy"} lối vào ` +
        `nhưng ${vao ? "VÀO ĐƯỢC" : "BỊ CHẶN"} ở đích (url cuối ${url})`,
    ).toBe(vao);
  });
}

test("A6 — ĐỐI CHỨNG: bảng 2×2 không rỗng (có cả ô VÀO ĐƯỢC lẫn ô BỊ CHẶN)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const thuMuc = process.env.QA_DOT62_RA ?? ".qa-dot62";
  const doc = (ma: string) => {
    const p = path.join(thuMuc, `A-${ma}.json`);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as { vaoDuoc: boolean }) : null;
  };
  const tatCa = VAI.map((o) => doc(o.ma)).filter(Boolean) as { vaoDuoc: boolean }[];
  expect(tatCa.length, "phai co du 5 phep do truoc do").toBe(VAI.length);
  // Nếu MỌI ô đều bị chặn (hoặc mọi ô đều vào được), bất biến "thấy ⇔ vào được" ở trên
  // vẫn xanh mà chẳng đo gì — đúng lớp lỗi G5. Ô này bắt ca đó.
  expect(tatCa.some((x) => x.vaoDuoc), "phai co it nhat MOT vai VAO DUOC dich").toBe(true);
  expect(tatCa.some((x) => !x.vaoDuoc), "phai co it nhat MOT vai BI CHAN o dich").toBe(true);
});

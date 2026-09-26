/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-4** — lưới của **CỔNG BUỘC ĐỔI MẬT KHẨU, phía CLIENT**.
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom client bằng `client/src/**\/*.unit.test.ts`.
 *   Đặt tên `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng vẫn khai XANH — lớp *"glob rỗng"*
 *   đã che ca đỏ **sáu** lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BỐN Ô — VÀ Ô §4 TỒN TẠI VÌ MỘT ĐỘT BIẾN ĐÃ SHIP QUA §3
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1  **VỊ TỪ** — bảng chân trị đầy đủ của `phaiKhoaVaoManDoiMatKhau`, gồm cả biên *"chưa biết"*.
 *   §2  🔴 **MIỄN TRỪ CỐ Ý** — `admin` có cờ ⇒ **KHÔNG** bị khoá (quyết định chủ dự án 2026-08-09),
 *       và tập miễn trừ là **CÙNG MỘT** chủ với máy chủ (không có bản sao thứ hai ở client).
 *   §3  **CẤU TRÚC** — cổng bọc **CHÍNH `<Router/>`** (∀ route theo cấu tạo) · dùng lại **màn đã
 *       có** · và `ChangePassword` **đọc lại `auth.me`** sau khi đổi (nếu không: nhà tù).
 *   §4  **RENDER THẬT** (`react-dom/server`, không jsdom) — cổng có **THẬT SỰ KHOÁ** không.
 *
 * ⚠⚠⚠ §3 quét **MÃ NGUỒN**. Hai đột biến của lượt vá này đo được **chính xác** nó canh tới đâu:
 *    · `// await utils.auth.me.invalidate();` (bình luận đúng một dòng) ⇒ **XANH 10/10**, vì ô ấy
 *      quét mã **THÔ**. Vá: `boComment()` ở **mọi** ô quét mã.
 *    · `if (true) return <>{children}</>` — **cổng thôi khoá hoàn toàn** ⇒ vẫn **XANH 10/10**.
 *      §3 canh *"cổng NẰM ĐÚNG CHỖ"*; nó **không thể** canh *"cổng KHOÁ"*. Vá: **§4**.
 * ⇒ Kết luận mang đi: một lưới quét mã trả lời được câu *"mã có hình dạng ấy không"* và **không**
 *   trả lời được câu *"mã làm việc ấy không"*. Đừng để §3 trôi thành *"đã canh rồi"*.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  DUONG_DOI_MAT_KHAU,
  phaiKhoaVaoManDoiMatKhau,
  type NguoiDungCuaCong,
} from "./congDoiMatKhau";
import { VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU, biChanBoiCongDoiMatKhau } from "@shared/buocDoiMatKhau";

const LIB = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
const SRC = join(LIB, "..");

function doc(duongTuongDoi: string): string {
  return readFileSync(join(SRC, duongTuongDoi), "utf8");
}

/**
 * Bỏ chú thích (`/* … *\/`, `{/* … *\/}`, `// …`) trước khi đếm JSX.
 * ⚠ Không có bước này thì **chính khối docstring giải thích cổng** bị đếm như mã, và ô *"có
 *   `<Router/>` thứ hai"* sẽ ĐỎ vì một lý do **SAI** — một lưới đỏ vì lý do sai còn tệ hơn không
 *   có lưới: lần sau người ta sẽ nới nó ra thay vì đọc nó.
 */
function boComment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ §4 — **RENDER THẬT**, không jsdom, không `@testing-library`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KHỐI NÀY TỒN TẠI: đột biến `if (true) return <>{children}</>` — tức **cổng thôi khoá,
 * hoàn toàn** — **SHIP ĐƯỢC** với §3 (quét mã nguồn) **XANH 10/10**. Đo được, không suy ra. §3 canh
 * *"cổng NẰM ĐÚNG CHỖ trong cây"*; nó **không thể** canh *"cổng THẬT SỰ KHOÁ"*.
 *
 * `renderToStaticMarkup` (react-dom/server) chạy được ở **`environment: "node"`** — không cần
 * jsdom, không cần thêm dependency. Ba hook ngoại vi (`useAuth` · `wouter` · `react-i18next`) được
 * thay bằng bản tối thiểu; `ChangePassword` là `lazy()` nên SSR dừng ở Suspense fallback, tức lưới
 * **không** kéo cả cây `DashboardLayout` vào.
 * ⚠ Ba mock ấy là **ngoại vi**, không phải thứ đang được đo: thứ đang đo là **quyết định render**
 *   của chính `CongDoiMatKhau`.
 */
const PHIEN: { user: unknown } = { user: null };
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: PHIEN.user }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/dashboard", () => {}] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

/** Dấu nhận biết *"bảng route ĐÃ được render"*. Nó đứng thay cho `<Router/>` thật. */
const DAU_ROUTER = "DAU-CUA-BANG-ROUTE";

async function renderCong(nguoiDung: unknown): Promise<string> {
  const { CongDoiMatKhau } = await import("@/components/CongDoiMatKhau");
  PHIEN.user = nguoiDung;
  return renderToStaticMarkup(
    createElement(CongDoiMatKhau, { children: createElement("div", { id: DAU_ROUTER }) }),
  );
}

describe("★★★ I-4 §1 (client) — VỊ TỪ: bảng chân trị ĐẦY ĐỦ", () => {
  it("★★★ có cờ + vai KHÔNG miễn trừ ⇒ KHOÁ", () => {
    expect(phaiKhoaVaoManDoiMatKhau({ role: "user", mustChangePassword: true })).toBe(true);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "engineer", mustChangePassword: true })).toBe(true);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "supervisor", mustChangePassword: true })).toBe(true);
  });

  it("★★★ KHÔNG cờ ⇒ KHÔNG khoá (đối chứng ÂM — nếu thiếu, cổng khoá TẤT CẢ mọi người)", () => {
    expect(phaiKhoaVaoManDoiMatKhau({ role: "user", mustChangePassword: false })).toBe(false);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "admin", mustChangePassword: false })).toBe(false);
  });

  it("★★★★ CHƯA BIẾT ⇒ KHÔNG khoá (khoá lúc chưa biết = nhốt cả người CHƯA ĐĂNG NHẬP)", () => {
    /**
     * ⚠⚠ `auth.me` chưa về / trả `null` (chưa đăng nhập) là tình huống **thường xuyên**, không
     *    phải biên hiếm. Nếu cổng khoá ở đây thì màn `/login` cũng bị thay bằng màn đổi mật khẩu —
     *    một vòng lặp **không lối ra**, và nó xuất hiện với **mọi** khách chưa đăng nhập.
     * ⚠ Chiều an toàn của khoảnh khắc "chưa biết" do **MÁY CHỦ** giữ (`chanKhiPhaiDoiMatKhau`):
     *   client khoá **điều hướng**, máy chủ khoá **dữ liệu**.
     */
    expect(phaiKhoaVaoManDoiMatKhau(null)).toBe(false);
    expect(phaiKhoaVaoManDoiMatKhau(undefined)).toBe(false);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "user" })).toBe(false);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "user", mustChangePassword: null })).toBe(false);
  });

  it("★★ giá trị LẠ từ dây không được coi là 'phải đổi' (`!== true`, không phải `Boolean(...)`)", () => {
    // Một phản hồi hỏng/cũ có thể mang `"true"` hoặc `1`. Cả hai đều KHÔNG phải `true`.
    // ⚠ `as unknown as` là bắt buộc: kiểu tĩnh **cấm** hai giá trị này, nhưng dây thì không —
    //   `superjson` giải mã một phản hồi cũ/hỏng vẫn giao được chúng vào lúc chạy.
    const lam = (v: unknown) =>
      phaiKhoaVaoManDoiMatKhau({ role: "user", mustChangePassword: v } as unknown as NguoiDungCuaCong);
    expect(lam("true")).toBe(false);
    expect(lam(1)).toBe(false);
  });
});

describe("🔴🔴 I-4 §2 (client) — MIỄN TRỪ CỐ Ý, và nó phải là CÙNG MỘT CHỦ với máy chủ", () => {
  it("🔴🔴 `admin` CÓ CỜ ⇒ **KHÔNG** bị khoá (quyết định chủ dự án 2026-08-09)", () => {
    /**
     * ⚠⚠⚠ CA NÀY GHIM MỘT LỖ, KHÔNG PHẢI MỘT TÍNH NĂNG — xem `shared/buocDoiMatKhau.ts`. Rủi ro
     * (admin là vai nhiều quyền nhất; bí mật của họ nằm trong đúng 8 cái đã lộ ở Task 8) đã được
     * nêu rõ; khuyến nghị kỹ thuật là KHÔNG miễn trừ; chủ dự án vẫn chọn.
     * ⇒ Ai muốn bỏ miễn trừ phải sửa `VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU` **và** ca này (**và** ca §4
     *   phía máy chủ) — tức bỏ **có chủ đích**, hiện thành diff trong review.
     */
    expect(VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU, "tập miễn trừ đã đổi — đây là một quyết định an ninh").toEqual([
      "admin",
    ]);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "admin", mustChangePassword: true })).toBe(false);
    // KHÔNG BẮT NHẦM: chỉ đúng chuỗi `"admin"`, phân biệt hoa thường.
    expect(phaiKhoaVaoManDoiMatKhau({ role: "Admin", mustChangePassword: true })).toBe(true);
    expect(phaiKhoaVaoManDoiMatKhau({ role: "admin_readonly", mustChangePassword: true })).toBe(true);
  });

  it("★★★★ client KHÔNG giữ bản sao thứ hai của luật — nó GỌI chủ ở `shared/`", () => {
    /**
     * ⚠⚠ Hai bản của cùng một luật là chỗ nó trôi đi, và ở đúng cổng này lệch chiều nào cũng hỏng:
     *  · máy chủ tha `admin`, client nhốt ⇒ admin kẹt trong màn đổi mật khẩu;
     *  · client thả, máy chủ chặn ⇒ mọi trang trắng, không câu lỗi nào giải thích.
     * Ô này canh **hai** thứ: kết quả hai bên **luôn khớp**, và mã client **không** chứa một danh
     * sách vai thứ hai.
     */
    for (const vai of ["admin", "user", "engineer", "supervisor", "viewer", "Admin", null, undefined]) {
      expect(
        phaiKhoaVaoManDoiMatKhau({ role: vai, mustChangePassword: true }),
        `client và shared lệch nhau ở vai ${JSON.stringify(vai)}`,
      ).toBe(biChanBoiCongDoiMatKhau(vai, true));
    }
    const src = doc("lib/congDoiMatKhau.ts");
    expect(src.includes('from "@shared/buocDoiMatKhau"'), "client phải GỌI chủ ở `shared/`").toBe(true);
    expect(
      /VAI_MIEN_TRU_BUOC_DOI_MAT_KHAU\s*[:=]\s*\[/.test(src),
      "client dựng lại tập miễn trừ ⇒ đã có HAI chủ cho một bất biến",
    ).toBe(false);
  });
});

describe("★★★★ I-4 §3 (client) — CẤU TRÚC: ∀ route theo cấu tạo · dùng lại màn cũ · không thành nhà tù", () => {
  it("★★ cầu chì — ba file nguồn đọc được (file rỗng ⇒ mọi khẳng định dưới là chân lý rỗng)", () => {
    for (const f of ["App.tsx", "components/CongDoiMatKhau.tsx", "pages/ChangePassword.tsx"]) {
      expect(doc(f).length, `${f} rỗng/không đọc được`).toBeGreaterThan(500);
    }
  });

  it("★★★★ cổng bọc CHÍNH `<Router/>` — khi khoá thì KHÔNG route nào tồn tại trong cây", () => {
    /**
     * ⚠⚠⚠ `App.tsx` có **hơn 200** `<Route>`, và `RouteGuard` **không** phủ hết (`/`, `/login`,
     * `/setup`, `/api-docs`, `/change-password`, `/component-showcase` không có guard nào). Đặt
     * cổng "ở các route nhạy cảm" là biến một **∀** thành một **DANH SÁCH** — lớp lỗi *"phần tử thứ
     * N+1"*, đã tái diễn **MƯỜI BẢY** lần trong chuỗi pha này.
     * ⇒ Ô này ghim đúng **hình dạng lồng nhau**: `<CongDoiMatKhau>` ⊃ `<Router />`. Ai dời cổng
     *   xuống dưới (vào `RouteGuard`, vào từng `<Route>`) làm ô này ĐỎ.
     */
    const app = boComment(doc("App.tsx"));
    expect(
      /<CongDoiMatKhau>\s*<Router\s*\/>\s*<\/CongDoiMatKhau>/.test(app),
      "`<Router/>` KHÔNG còn nằm trong `<CongDoiMatKhau>` ⇒ mọi route lại lách được cổng",
    ).toBe(true);
    // …và KHÔNG có một `<Router />` thứ hai nằm ngoài cổng.
    expect((app.match(/<Router\s*\/>/g) ?? []).length, "có `<Router/>` thứ hai ⇒ một bảng route ngoài cổng").toBe(1);
    expect(app.includes('from "./components/CongDoiMatKhau"')).toBe(true);
    // ⚠ Đối chứng cho `boComment`: nó phải THẬT SỰ bỏ được chú thích, nếu không ô trên đo nhầm.
    expect(boComment("a /* <Router /> */ b\nc // <Router />\n")).not.toMatch(/<Router/);
    expect(boComment("x <Router /> y"), "boComment KHÔNG được nuốt mã thật").toContain("<Router />");
  });

  it("★★★ cổng DÙNG LẠI màn `pages/ChangePassword` đã có, không dựng màn thứ hai", () => {
    // ⚠ `boComment` ở MỌI ô quét mã — xem lý do (một đột biến đã ship) ở ô "NHÀ TÙ" bên dưới.
    const cong = boComment(doc("components/CongDoiMatKhau.tsx"));
    expect(
      cong.includes('import("@/pages/ChangePassword")'),
      "cổng phải render ĐÚNG màn mà `<Route path=\"/change-password\">` trỏ tới",
    ).toBe(true);
    expect(cong.includes("<ChangePassword />"), "cổng phải THẬT SỰ render màn ấy, không chỉ nhập nó").toBe(true);
    // …và quyết định phải đến từ vị từ có lưới, không từ một `if` viết tay trong JSX.
    expect(
      cong.includes("phaiKhoaVaoManDoiMatKhau("),
      "cổng không gọi vị từ ⇒ nó đang tự quyết định, ngoài tầm mọi ca ở §1/§2",
    ).toBe(true);
    // Đường của màn là một hằng dùng chung, không phải chuỗi viết tay lần hai.
    expect(DUONG_DOI_MAT_KHAU).toBe("/change-password");
    expect(
      boComment(doc("App.tsx")).includes(`<Route path="${DUONG_DOI_MAT_KHAU}"`),
      "route của màn phải còn đó",
    ).toBe(true);
  });

  it("★★★★ KHÔNG THÀNH NHÀ TÙ — `ChangePassword` đọc LẠI `auth.me` sau khi đổi thành công", () => {
    /**
     * ⚠⚠⚠ Đây là ô canh bất biến ***KHÔNG ĐƯỢC KHOÁ AI RA NGOÀI*** ở phía client, và nó là chỗ
     * **dễ mất nhất** của cả bản vá: máy chủ hạ cờ ngay trong giao dịch đổi mật khẩu, nhưng client
     * giữ bản `auth.me` **CŨ** (`staleTime` 30 s + `refetchOnWindowFocus: false`, `main.tsx`) ⇒
     * cổng vẫn đọc `mustChangePassword: true` và đẩy người dùng **ngược lại** đúng màn ấy. Họ đổi
     * mật khẩu bao nhiêu lần cũng không thoát ra. Hỏng **im lặng**: không lỗi, không cảnh báo.
     */
    /**
     * ⚠⚠⚠ `boComment` ở đây **KHÔNG** phải dọn dẹp — nó là **BẢN VÁ CỦA MỘT ĐỘT BIẾN ĐÃ SHIP.**
     * Bản đầu của ô này quét mã **THÔ**, và đột biến `// await utils.auth.me.invalidate();`
     * (bình luận đúng một dòng — cách một người "tạm tắt để thử" hay làm nhất) **đi lọt với lưới
     * XANH 10/10**. Tức lưới đang canh *"chuỗi ký tự ấy có xuất hiện trong file không"*, chứ không
     * canh *"lượt gọi ấy có CHẠY không"* — đúng lớp *"lưới canh hẹp hơn TÊN nó nói"*.
     */
    const src = boComment(doc("pages/ChangePassword.tsx"));
    const i = src.indexOf("onSuccess");
    const j = src.indexOf("onError", i);
    expect(i, "không tìm thấy `onSuccess` của mutation đổi mật khẩu").toBeGreaterThan(-1);
    expect(j, "không tìm thấy `onError` — hình dạng mutation đã đổi, ô này đang đo nhầm khối").toBeGreaterThan(i);
    const khoiOnSuccess = src.slice(i, j);
    expect(
      /await\s+utils\.auth\.me\.invalidate\(\)/.test(khoiOnSuccess),
      "đổi mật khẩu xong mà KHÔNG đọc lại `auth.me` ⇒ cổng giữ cờ CŨ và nhốt người dùng lại",
    ).toBe(true);
    // ⚠ `await` là phần bắt buộc: điều hướng trước khi cache mới về dựng lại đúng vòng lặp ấy.
    expect(
      khoiOnSuccess.indexOf("utils.auth.me.invalidate"),
      "lượt đọc lại phải đứng TRƯỚC `setLocation`",
    ).toBeLessThan(khoiOnSuccess.indexOf("setLocation("));
  });
});

describe("★★★★ I-4 §4 (client) — RENDER THẬT: cổng có KHOÁ hay không (ô mà §3 KHÔNG THỂ canh)", () => {
  it("★★★★ CÓ CỜ ⇒ bảng route KHÔNG được render, và màn đổi mật khẩu hiện ra", async () => {
    /**
     * ⚠⚠⚠ Đây là ô **CHỦ** của nửa client, và là ô mà đột biến `if (true) return children` đã đi
     * lọt trước khi có nó. Khẳng định là **VẮNG MẶT**: `children` — toàn bộ bảng route — **không
     * xuất hiện trong kết xuất**. Đó là cách duy nhất phát biểu *"không route nào lách được"* mà
     * không phải liệt kê route nào.
     */
    const html = await renderCong({ role: "user", mustChangePassword: true });
    expect(html, "bảng route VẪN được render khi đang khoá ⇒ mọi route lách được cổng").not.toContain(DAU_ROUTER);
    expect(html, "không thấy lời giải thích ⇒ người dùng bị chặn mà không biết vì sao").toContain(
      "auth.mustChangePasswordTitle",
    );
  });

  it("★★★★ ĐỐI CHỨNG DƯƠNG — KHÔNG cờ ⇒ bảng route render bình thường (cổng không khoá nhầm ai)", async () => {
    // ⚠ Thiếu ô này, một cổng khoá **TẤT CẢ MỌI NGƯỜI** vẫn qua được ca trên: khẳng định vắng mặt
    //   là chân lý với một cổng luôn-khoá. Hai ô cùng nhau mới thành một phép đo.
    const html = await renderCong({ role: "user", mustChangePassword: false });
    expect(html).toContain(DAU_ROUTER);
    expect(html).not.toContain("auth.mustChangePasswordTitle");
  });

  it("★★★ CHƯA ĐĂNG NHẬP (`auth.me` = null) ⇒ render bình thường, KHÔNG nhốt khách vào màn cần phiên", async () => {
    expect(await renderCong(null)).toContain(DAU_ROUTER);
  });

  it("🔴🔴 MIỄN TRỪ CỐ Ý, ĐO BẰNG RENDER — `admin` CÓ CỜ vẫn thấy bảng route (chủ dự án 2026-08-09)", async () => {
    /**
     * ⚠⚠⚠ Ô §2 ghim **vị từ**; ô này ghim **hành vi hiện ra màn hình**. Cần cả hai: một cổng gọi
     * đúng vị từ rồi **bỏ qua kết quả** vẫn qua được §2.
     * Đây là **lỗ CỐ Ý** (rủi ro đã nêu: `admin` là vai nhiều quyền nhất, bí mật của họ nằm trong
     * đúng 8 cái đã lộ ở Task 8; khuyến nghị kỹ thuật là KHÔNG miễn trừ; chủ dự án vẫn chọn).
     */
    const html = await renderCong({ role: "admin", mustChangePassword: true });
    expect(html, "admin đang có cờ mà bị khoá ⇒ miễn trừ (quyết định chủ dự án) đã mất").toContain(DAU_ROUTER);
    expect(html).not.toContain("auth.mustChangePasswordTitle");
  });
});

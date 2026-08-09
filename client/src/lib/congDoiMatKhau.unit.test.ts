/**
 * ★★★★ Pha 7 / review TOÀN NHÁNH **I-4** — lưới của **CỔNG BUỘC ĐỔI MẬT KHẨU, phía CLIENT**.
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom client bằng `client/src/**\/*.unit.test.ts`.
 *   Đặt tên `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng vẫn khai XANH — lớp *"glob rỗng"*
 *   đã che ca đỏ **sáu** lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA Ô, VÀ Ô §3 LÀ Ô YẾU NHẤT — NÓI RA THAY VÌ GIẤU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1  **VỊ TỪ** — bảng chân trị đầy đủ của `phaiKhoaVaoManDoiMatKhau`, gồm cả biên *"chưa biết"*.
 *   §2  🔴 **MIỄN TRỪ CỐ Ý** — `admin` có cờ ⇒ **KHÔNG** bị khoá (quyết định chủ dự án 2026-08-09),
 *       và tập miễn trừ là **CÙNG MỘT** chủ với máy chủ (không có bản sao thứ hai ở client).
 *   §3  **CẤU TRÚC** — cổng bọc **CHÍNH `<Router/>`** (∀ route theo cấu tạo) · dùng lại **màn đã
 *       có** · và `ChangePassword` **đọc lại `auth.me`** sau khi đổi (nếu không: nhà tù).
 *
 * ⚠⚠ §3 quét **MÃ NGUỒN**, không render. Đó là **giới hạn của hạ tầng**, không phải lựa chọn:
 *    `vitest.config.ts` chạy client ở `environment: "node"`, gom `*.unit.test.ts` (không `.tsx`),
 *    và repo **không** có `jsdom`/`@testing-library`. Một lưới quét mã **yếu hơn** một lượt render
 *    thật — nó bắt được *"ai đó dời cổng xuống dưới `<Router/>`"* nhưng **không** bắt được một lỗi
 *    render. Ghi vào nợ (`i4-report.md` §nợ mới), đừng để nó trôi thành *"đã canh rồi"*.
 */
import { describe, it, expect } from "vitest";
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
    const cong = doc("components/CongDoiMatKhau.tsx");
    expect(
      cong.includes('import("@/pages/ChangePassword")'),
      "cổng phải render ĐÚNG màn mà `<Route path=\"/change-password\">` trỏ tới",
    ).toBe(true);
    // Đường của màn là một hằng dùng chung, không phải chuỗi viết tay lần hai.
    expect(DUONG_DOI_MAT_KHAU).toBe("/change-password");
    expect(doc("App.tsx").includes(`<Route path="${DUONG_DOI_MAT_KHAU}"`), "route của màn phải còn đó").toBe(true);
  });

  it("★★★★ KHÔNG THÀNH NHÀ TÙ — `ChangePassword` đọc LẠI `auth.me` sau khi đổi thành công", () => {
    /**
     * ⚠⚠⚠ Đây là ô canh bất biến ***KHÔNG ĐƯỢC KHOÁ AI RA NGOÀI*** ở phía client, và nó là chỗ
     * **dễ mất nhất** của cả bản vá: máy chủ hạ cờ ngay trong giao dịch đổi mật khẩu, nhưng client
     * giữ bản `auth.me` **CŨ** (`staleTime` 30 s + `refetchOnWindowFocus: false`, `main.tsx`) ⇒
     * cổng vẫn đọc `mustChangePassword: true` và đẩy người dùng **ngược lại** đúng màn ấy. Họ đổi
     * mật khẩu bao nhiêu lần cũng không thoát ra. Hỏng **im lặng**: không lỗi, không cảnh báo.
     */
    const src = doc("pages/ChangePassword.tsx");
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

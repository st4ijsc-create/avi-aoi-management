/**
 * ★★★ **CỔNG GIẤY PHÉP `MOD_AI` — NỬA CLIENT.** Ba câu, và câu thứ hai là câu chống HỒI QUY.
 *
 * ⚠ Đuôi `.unit.test.ts` là **BẮT BUỘC**: `vitest.config.ts` gom nửa client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt tên `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi
 *   cổng vẫn khai XANH — lớp *"glob rỗng"* đã che ca đỏ **sáu** lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §2  **PHỦ SÓNG**   — ∀ tuyến thuộc `MOD_AI.routes` mà `App.tsx` phục vụ bằng một trang thật
 *                        ⇒ dòng `<Route>` của nó phải mang `requireModule="MOD_AI"`.
 *   §3  **KHÔNG HỒI QUY** — ∀ dòng `<Route>` mang `requireModule="MOD_AI"` ⇒ tuyến của nó phải
 *                        CÓ trong `MOD_AI.routes`. Bọc nhầm một trang vận hành = khách không mua
 *                        AI mất trang của họ; đây là chiều nguy hiểm hơn.
 *   §5  **RENDER THẬT** — quét mã trả lời *"cổng có nằm đúng chỗ"*, KHÔNG trả lời *"cổng có khoá"*.
 *                        Bài học đã trả giá ở `congDoiMatKhau.unit.test.ts`: đột biến
 *                        `if (true) return <>{children}</>` **SHIP ĐƯỢC** với lưới quét-mã XANH.
 *
 * ⚠⚠ Cổng client **KHÔNG** phải hàng rào an ninh — máy chủ mới là (`server/_core/moduleGate.ts` +
 *    `congGiayPhepAiCensus.test.ts`). Nửa này canh **TRẢI NGHIỆM**: không màn trắng, không vòng lặp
 *    chuyển hướng, và không một cửa vào AI nào còn sáng cho khách chưa mua.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { getModuleByCode } from "@shared/module-registry";

const LIB = fileURLToPath(new URL(".", import.meta.url)); // .../client/src/lib
const SRC = join(LIB, "..");
const doc = (p: string): string => readFileSync(join(SRC, p), "utf8");

/** Bỏ chú thích trước khi đếm JSX — nếu không, chính khối docstring giải thích cổng bị đếm như mã. */
function boComment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

interface DongTuyen {
  readonly duong: string;
  readonly coCong: boolean;
  readonly laChuyenHuong: boolean;
}

/**
 * Rút mọi `<Route path="…">` từ một nguồn `App.tsx`.
 * ⚠ Nhận `src` làm THAM SỐ (không đọc đĩa bên trong) để §6 chạy được **đúng bộ rút này** trên một
 *   nguồn đã ĐỘT BIẾN — một lưới đột biến chạy trên bản sao của bộ suy không chứng minh gì.
 */
function rutTuyen(src: string): { tuyen: DongTuyen[]; mu: string[] } {
  const sach = boComment(src);
  const tuyen: DongTuyen[] = [];
  const mu: string[] = [];

  // ⚠⚠ Bản đầu cắt theo **DÒNG** và đã ĐỎ đúng như thiết kế: ba tuyến (`/machine-onboarding`,
  //    `/aoi-onboarding`, `/machine/:id`) khai trải nhiều dòng. Cách SAI để chữa là miễn trừ chúng
  //    — một cổng có cửa miễn trừ theo hình dạng viết là một cổng người ta né được bằng cách xuống
  //    dòng. Cách đúng: cắt theo **PHẦN TỬ**. `<Route>` trong `App.tsx` KHÔNG lồng nhau, nên biên
  //    của một phần tử là ngay trước `<Route` kế tiếp.
  const moc = [...sach.matchAll(/<Route\s+path="([^"]+)"/g)];
  for (let i = 0; i < moc.length; i++) {
    const m = moc[i] as RegExpMatchArray & { index: number };
    const batDau = m.index;
    const ketThuc = i + 1 < moc.length ? (moc[i + 1] as RegExpMatchArray & { index: number }).index : sach.length;
    const than = sach.slice(batDau, ketThuc);
    if (!than.includes("</Route>") && !than.includes("/>")) {
      mu.push(`tuyến \`${m[1]}\` không thấy chỗ đóng — bộ rút theo PHẦN TỬ mất biên`);
      continue;
    }
    tuyen.push({
      duong: m[1] as string,
      coCong: than.includes('requireModule="MOD_AI"'),
      laChuyenHuong: than.includes("<Redirect"),
    });
  }
  return { tuyen, mu };
}

const APP = doc("App.tsx");
const RUT = rutTuyen(APP);
const TUYEN_MOD_AI = new Set(getModuleByCode("MOD_AI")?.routes ?? []);

/**
 * ★ Tuyến của nhóm điều hướng "ai" CỐ Ý **KHÔNG** thuộc `MOD_AI`.
 * `/inbox` nằm trong nhóm menu "ai" nhưng chủ thật của nó là `CORE_AUTH` (hộp thư cá nhân, còn
 * xuất hiện ở nhóm "Tôi"). Khai nó là MOD_AI sẽ khoá hộp thư của khách không mua AI.
 */
const NAV_AI_KHONG_THUOC_MOD_AI: readonly string[] = ["/inbox"];

describe("§1 — CẦU CHÌ: bộ rút có thật sự nhìn thấy gì không", () => {
  it("★ không có ô mù + rút được ĐỦ tuyến (chống 'xanh vì rút trúng 0 dòng')", () => {
    expect(RUT.mu, "bộ rút tự khai là không còn đủ — đọc từng dòng, đừng nới lượng từ.").toEqual([]);
    expect(RUT.tuyen.length, "App.tsx có ~200 tuyến; rút ra quá ít ⇒ bộ rút hỏng").toBeGreaterThan(150);
  });

  it("★ `MOD_AI.routes` khác rỗng và có mặt trong sổ đăng ký", () => {
    expect(getModuleByCode("MOD_AI"), "MOD_AI biến mất khỏi registry").toBeDefined();
    expect(TUYEN_MOD_AI.size).toBeGreaterThanOrEqual(30);
  });

  it("★ có ÍT NHẤT một tuyến MANG cổng (nếu không, §3 xanh TỰ THOẢ)", () => {
    expect(RUT.tuyen.filter((t) => t.coCong).length).toBeGreaterThanOrEqual(25);
  });
});

describe("§2 — PHỦ SÓNG: ∀ tuyến MOD_AI có trang thật ⇒ mang `requireModule=\"MOD_AI\"`", () => {
  it("★★★ không tuyến MOD_AI nào còn vào được bằng đường dẫn sâu", () => {
    const thieu = RUT.tuyen
      .filter((t) => TUYEN_MOD_AI.has(t.duong) && !t.laChuyenHuong && !t.coCong)
      .map((t) => t.duong);
    expect(
      thieu,
      "Tuyến thuộc SKU AI mà KHÔNG khai `requireModule=\"MOD_AI\"`.\n" +
        "Menu đã ẩn nhóm 'ai' cho khách không mua AI, nhưng ẨN ≠ CHẶN: gõ thẳng URL vẫn vào được.\n" +
        'Cách đúng: <Route path="/x"><RouteGuard … requireModule="MOD_AI">…</RouteGuard></Route>',
    ).toEqual([]);
  });

  it("★ tuyến MOD_AI chỉ là CHUYỂN HƯỚNG thì KHÔNG cần cổng (đích đến đã có cổng)", () => {
    const ch = RUT.tuyen.filter((t) => TUYEN_MOD_AI.has(t.duong) && t.laChuyenHuong);
    expect(ch.length, "không còn tuyến chuyển hướng nào — miễn trừ này đã hết nghĩa").toBeGreaterThan(0);
    for (const t of ch) expect(t.coCong, `${t.duong} là <Redirect>, không cần cổng`).toBe(false);
  });
});

describe("§3 — ★★★ KHÔNG HỒI QUY: không tuyến NGOÀI MOD_AI nào bị khoá nhầm", () => {
  it("★★★ ∀ tuyến mang `requireModule=\"MOD_AI\"` ⇒ có tên trong `MOD_AI.routes`", () => {
    const thua = RUT.tuyen.filter((t) => t.coCong && !TUYEN_MOD_AI.has(t.duong)).map((t) => t.duong);
    expect(
      thua,
      "MỘT TUYẾN **KHÔNG THUỘC SKU AI** ĐANG BỊ KHOÁ SAU `MOD_AI`.\n" +
        "Khách mua module khác mà không mua AI sẽ thấy tường 'chưa được cấp phép' trên trang của HỌ.\n" +
        "Hoặc gỡ `requireModule`, hoặc khai tuyến ấy vào `MOD_AI.routes` (`shared/module-registry.ts`)\n" +
        "— và nếu khai thì phải kiểm cả menu, vì `isRouteAllowed` sẽ ẩn nó luôn.",
    ).toEqual([]);
  });

  it("★★ mọi tuyến trong nhóm menu 'ai' đều thuộc MOD_AI, trừ danh sách đã KÝ", () => {
    // Nhóm menu bị `isNavGroupAllowed('ai')` ẩn nguyên cụm; nhưng một tuyến trong nhóm mà KHÔNG
    // thuộc MOD_AI sẽ vẫn vào được bằng URL — và nếu nó thuộc module KHÁC thì khai vào MOD_AI lại
    // là một lượt hồi quy. Ô này buộc mỗi ca lệch phải được ký tên.
    const nav = boComment(doc("lib/navigation.tsx"));
    const batDau = nav.indexOf('id: "ai",');
    expect(batDau, "không thấy nhóm điều hướng `ai` — bộ rút mất điểm neo").toBeGreaterThan(0);
    const ketThuc = nav.indexOf('id: "', batDau + 10);
    const khoi = nav.slice(batDau, ketThuc > 0 ? ketThuc : undefined);
    const href = [...khoi.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1] as string);
    expect(href.length, "nhóm 'ai' có ~29 mục; rút ra quá ít ⇒ bộ rút hỏng").toBeGreaterThan(20);

    const lech = href.filter((h) => !TUYEN_MOD_AI.has(h) && !NAV_AI_KHONG_THUOC_MOD_AI.includes(h));
    expect(
      lech,
      "Mục menu nằm trong nhóm 'ai' nhưng tuyến của nó KHÔNG thuộc `MOD_AI.routes`.\n" +
        "Hoặc thêm tuyến vào `MOD_AI.routes`, hoặc ký tên vào `NAV_AI_KHONG_THUOC_MOD_AI` kèm lý do\n" +
        "(mẫu: `/inbox` — chủ thật là CORE_AUTH).",
    ).toEqual([]);
    // Chống hoá thạch: một tên đã ký mà nay ĐÃ thuộc MOD_AI thì phải gỡ khỏi danh sách.
    for (const h of NAV_AI_KHONG_THUOC_MOD_AI) {
      expect(TUYEN_MOD_AI.has(h), `${h} nay đã thuộc MOD_AI — gỡ nó khỏi danh sách đã ký`).toBe(false);
    }
  });
});

describe("§4 — CỬA VÀO AI TOÀN CỤC: bong bóng chat phải ẩn theo module", () => {
  it("★★ `AILocalChatBubble` hỏi `isModuleBlocked(\"MOD_AI\")` và trả `null`", () => {
    // Bong bóng gắn ở GỐC `App.tsx` ⇒ nó KHÔNG nằm sau bất kỳ `RouteGuard` nào. Không ẩn nó thì
    // cổng theo tuyến bịt được 30 trang mà vẫn để một nút AI nổi trên 200 trang còn lại.
    const src = boComment(doc("components/AILocalChatBubble.tsx"));
    expect(src.includes('isModuleBlocked("MOD_AI")'), "bong bóng không hỏi cổng module").toBe(true);
    expect(/if\s*\(\s*moduleAiBiChan\s*\)\s*return null;/.test(src), "hỏi rồi mà không ẩn").toBe(true);
  });

  it("★★ vị từ chặn có ĐÚNG MỘT CHỦ — client không dựng bản sao thứ hai của luật không-brick", () => {
    const hook = boComment(doc("hooks/useLicenseModules.ts"));
    expect(hook.includes("isModuleBlocked"), "`useLicenseModules` phải là chủ của vị từ").toBe(true);
    for (const f of ["components/RouteGuard.tsx", "components/AILocalChatBubble.tsx"]) {
      const s = boComment(doc(f));
      expect(
        /const\s+isModuleBlocked\s*=/.test(s),
        `${f} dựng lại vị từ chặn ⇒ đã có HAI chủ cho một bất biến`,
      ).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ §5 — **RENDER THẬT** (`react-dom/server`, môi trường node, không jsdom).
 *
 * ⚠⚠⚠ §2/§3 quét MÃ. Một đột biến `const moduleBlocked = false;` sẽ giữ nguyên mọi thứ chúng nhìn
 *     và **tắt cổng hoàn toàn**. Khối này gọi CHÍNH `RouteGuard` và hỏi nó render cái gì.
 * ⚠ Các hook ngoại vi (`useAuth`/`usePermissions`/`wouter`/`react-i18next`/`useLicenseModules`)
 *   được thay bằng bản tối thiểu — thứ đang ĐO là **quyết định render** của `RouteGuard`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
const GIAY_PHEP: { chan: boolean } = { chan: false };
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, loading: false }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true, loading: false, isAdmin: true }),
}));
vi.mock("@/hooks/useLicenseModules", () => ({
  useLicenseModules: () => ({
    isRouteAllowed: () => true,
    isLoading: false,
    isModuleBlocked: () => GIAY_PHEP.chan,
  }),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/ai-chat", () => {}] }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

const DAU_TRANG_AI = "DAU-CUA-TRANG-AI";

async function renderGuard(chan: boolean, props: Record<string, unknown> = {}): Promise<string> {
  GIAY_PHEP.chan = chan;
  const { RouteGuard } = await import("@/components/RouteGuard");
  return renderToStaticMarkup(
    createElement(
      RouteGuard as never,
      { requireModule: "MOD_AI", ...props } as never,
      createElement("div", { id: DAU_TRANG_AI }),
    ),
  );
}

describe("§5 — RENDER THẬT: cổng có KHOÁ không, và khoá có đúng hình dạng không", () => {
  it("★★★ CHẶN ⇒ KHÔNG render trang AI, và có tường 'chưa được cấp phép'", async () => {
    const html = await renderGuard(true);
    expect(html.includes(DAU_TRANG_AI), "MODULE BỊ CHẶN MÀ TRANG AI VẪN ĐƯỢC RENDER").toBe(false);
    expect(html.includes("module-not-licensed-title"), "không thấy tường license").toBe(true);
  });

  it("★★★ ĐỐI CHỨNG ÂM — KHÔNG chặn ⇒ trang AI render bình thường (chống 'khoá tất cả')", async () => {
    const html = await renderGuard(false);
    expect(html.includes(DAU_TRANG_AI), "cổng đang khoá cả khách ĐÃ MUA AI").toBe(true);
    expect(html.includes("module-not-licensed-title")).toBe(false);
  });

  it("★★★ KHÔNG khai `requireModule` ⇒ cổng module KHÔNG bao giờ bật (mọi trang khác an toàn)", async () => {
    // ⇐ Đây là bảo đảm "không hồi quy" ở mức component: 170 tuyến còn lại không truyền ô này.
    const html = await renderGuard(true, { requireModule: undefined });
    expect(html.includes(DAU_TRANG_AI), "trang KHÔNG khai module mà vẫn bị cổng module chặn").toBe(true);
  });

  it("★★ tường KHÔNG phải màn trắng và KHÔNG tự chuyển hướng (không vòng lặp)", async () => {
    const html = await renderGuard(true);
    expect(html.length, "tường rỗng = màn trắng").toBeGreaterThan(200);
    // Hai lối ra là NÚT do người dùng bấm, không phải `navigate()` lúc render.
    expect(html.includes("<button"), "tường phải có lối ra bấm được").toBe(true);
    const src = boComment(doc("components/RouteGuard.tsx"));
    const khoi = src.slice(src.indexOf("if (moduleBlocked)"), src.indexOf("// 1b."));
    expect(khoi.length).toBeGreaterThan(100);
    expect(
      /useEffect|Redirect|navigate\(\s*["'`]/.test(khoi.replace(/onClick=\{[^}]*\}/g, "")),
      "tường license tự chuyển hướng ⇒ nguy cơ vòng lặp",
    ).toBe(false);
  });

  it("★★★ cổng module đứng TRƯỚC phép bỏ qua của admin (giấy phép là thứ CÔNG TY mua)", async () => {
    // `usePermissions` ở trên trả `isAdmin: true`. Nếu nhánh admin đứng trước, admin sẽ lách được
    // cổng giấy phép — và mọi phép nghiệm thu bằng tài khoản admin sẽ khai XANH GIẢ.
    const html = await renderGuard(true);
    expect(html.includes(DAU_TRANG_AI), "ADMIN LÁCH ĐƯỢC CỔNG GIẤY PHÉP").toBe(false);
  });
});

describe("§6 — ĐỘT BIẾN THẬT: bộ rút có ĐỎ khi ai đó gỡ cổng khỏi một tuyến không", () => {
  it("★★★ gỡ `requireModule` khỏi `/ai-chat` ⇒ §2 bắt được; thêm vào `/dashboard` ⇒ §3 bắt được", () => {
    // ⚠ Chạy CHÍNH `rutTuyen` đang canh sản phẩm trên một nguồn đã sửa — không dựng bản sao.
    const goc = APP;

    const boCong = goc.replace(
      '<Route path="/ai-chat"><RouteGuard requireModule="MOD_AI">',
      '<Route path="/ai-chat"><RouteGuard>',
    );
    expect(boCong, "đột biến KHÔNG áp được (chuỗi neo đã đổi) — ô này đang chứng minh 0 thứ").not.toBe(goc);
    const sauKhiBo = rutTuyen(boCong);
    const thieu = sauKhiBo.tuyen
      .filter((t) => TUYEN_MOD_AI.has(t.duong) && !t.laChuyenHuong && !t.coCong)
      .map((t) => t.duong);
    expect(thieu, "gỡ cổng khỏi một tuyến AI mà §2 vẫn xanh").toContain("/ai-chat");

    const themNham = goc.replace(
      '<Route path="/dashboard"><RouteGuard navHref="/dashboard">',
      '<Route path="/dashboard"><RouteGuard navHref="/dashboard" requireModule="MOD_AI">',
    );
    expect(themNham, "đột biến KHÔNG áp được (chuỗi neo đã đổi)").not.toBe(goc);
    const sauKhiThem = rutTuyen(themNham);
    const thua = sauKhiThem.tuyen.filter((t) => t.coCong && !TUYEN_MOD_AI.has(t.duong)).map((t) => t.duong);
    expect(thua, "khoá nhầm một tuyến VẬN HÀNH mà §3 vẫn xanh").toContain("/dashboard");
  });
});

describe("§7 — BA NGÔN NGỮ: tường license không được là một khoá trần", () => {
  const KHOA = ["moduleTitle", "moduleMessage"] as const;
  for (const l of ["vi", "en", "zh"] as const) {
    it(`locale ${l} có đủ ${KHOA.length} khoá \`routeGuard.*\``, () => {
      const j = JSON.parse(readFileSync(join(SRC, "i18n", "locales", `${l}.json`), "utf8")) as {
        routeGuard?: Record<string, string>;
      };
      for (const k of KHOA) {
        expect(j.routeGuard?.[k], `${l}.json thiếu \`routeGuard.${k}\``).toBeTruthy();
      }
    });
  }
});

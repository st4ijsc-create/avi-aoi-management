// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 2 — SHELL: một breadcrumb (trong top bar), bỏ padding kép + biến thể full-bleed,
// rail thu gọn có flyout submenu (chuột + bàn phím), rail thu gọn mặc định ở màn workbench (nhớ theo
// người dùng), chế độ "Đơn giản" không trống, banner shell thành chip 1 dòng (cùng điều kiện), một lối
// vào AI trên top bar.
//
// Render DashboardLayout THẬT (sidebar, CascadingNav, breadcrumb, PageHeader, PageContainer, banner,
// NoticeChip, nút AI). Chỉ thay hạ tầng nặng/mạng (trpc, palette, thông báo, công tắc site…) bằng stub.
// Số px thật (h1 ≤100, che MAIN) do thiết bị đo Task 1 chấm trên trình duyệt; jsdom chấm CẤU TRÚC.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { readFileSync } from "node:fs";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow } from "@/components/patterns/layoutKitTestMedia";

type Perm = { moduleName: string; expiresAt?: string | Date | null };
type Lic = Record<string, unknown>;
const S: {
  user: { id: number; role: string; name: string; email: string } | null;
  permissions: Perm[];
  launcher: boolean;
  lic: Lic;
  aiBlocked: boolean;
  isa: boolean;
} = {
  user: { id: 7, role: "engineer", name: "Eng", email: "e@x" },
  permissions: [],
  launcher: true,
  lic: {},
  aiBlocked: false,
  isa: false,
};

const LIC_NORMAL: Lic = {
  showBanner: false, isLoading: false, isWarning: false, isNormal: true, isLocked: false, noLicense: false,
  serverReachable: true, consecutiveOfflineChecks: 0, bannerSeverity: null, message: "", daysUntilExpiry: null,
  lastSuccessfulOnlineCheck: null,
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: S.user, loading: false, logout: vi.fn(), isAuthenticated: !!S.user }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    permissions: S.permissions,
    hasPermission: () => true,
    hasAnyCategoryPermission: () => true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useLicenseModules", () => ({
  useLicenseModules: () => ({
    isNavGroupAllowed: () => true,
    isRouteAllowed: () => true,
    allowedModules: [],
    isModuleBlocked: (code: string) => (code === "MOD_AI" ? S.aiBlocked : false),
  }),
}));
vi.mock("@/hooks/useLicenseEnforcement", () => ({ useLicenseEnforcement: () => S.lic }));
vi.mock("@/hooks/useSpcAlertToast", () => ({ useSpcAlertToast: () => undefined }));
vi.mock("@/hooks/useAppLauncherMode", () => ({
  useAppLauncherMode: () => ({ launcherOn: S.launcher, toggleLauncher: vi.fn() }),
}));
vi.mock("@/lib/hmiFlags", () => ({ isIsa101V2: () => S.isa }));
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => React.createElement("span", { "data-stub": name }),
}));
vi.mock("@/components/NotificationCenter", () => ({ NotificationCenter: stub("notif") }));
vi.mock("@/components/AIActionInbox", () => ({ AIActionInboxLauncher: stub("inbox") }));
vi.mock("@/components/SiteSwitcher", () => ({ SiteSwitcher: stub("site") }));
vi.mock("@/components/SiteHealthDot", () => ({ SiteHealthDot: stub("health") }));
vi.mock("@/components/FreshnessStrip", () => ({
  FreshnessStrip: (p: { className?: string; compactUntilXl?: boolean }) =>
    React.createElement("span", { "data-stub": "fresh", "data-compact": String(!!p.compactUntilXl), className: p.className }),
}));
vi.mock("@/components/ShellAlertChip", () => ({ ShellAlertChip: stub("alert") }));
vi.mock("@/components/AssetScopeBar", () => ({ AssetScopeBar: stub("scope"), ScopeStatusChip: stub("scopechip") }));
vi.mock("@/components/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/AppLauncherButton", () => ({ AppLauncherButton: stub("launcher") }));
vi.mock("@/components/AppLauncherOverlay", () => ({ AppLauncherOverlay: () => null }));
vi.mock("@/components/SidebarQuickAccess", () => ({ SidebarQuickAccess: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: stub("theme") }));
vi.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: stub("lang") }));
vi.mock("@/components/BottomNav", () => ({ BottomNav: () => null }));

import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns/PageHeader";
import { PageContainer } from "@/components/patterns/PageContainer";
import { ProgrammingCopilotProvider, useCopilotBinding, useProgrammingCopilot } from "@/contexts/ProgrammingCopilotContext";
import { useShellPageVariant } from "@/lib/shellPage";
import { getAiEntryState, resetAiEntryForTest, setAiChatOpen } from "@/lib/aiEntryStore";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { getNavItemByHref, navGroups } from "@/lib/navigation";

/** 14 màn Engineering do thiết bị đo Task 1 chấm (SCREENS trong scripts/ui-metrics/engineeringLayout.mjs) — trừ hai màn
 *  đã GỘP ở Task 15 (doc 81 Đợt 2): `/engineering-studio` (⇒ Hub ?tab=catalog) và `/programming-copilot` (⇒ IDE
 *  ?copilot=scratch) nay chỉ là chuyển hướng (lib/engineeringLegacyRedirects.tsx), không còn trang để dựng. */
const ENGINEERING_ROUTES = [
  "/engineering-home", "/engineering", "/engineering-changes", "/recipes",
  "/interlock-rules", "/orchestration-studio", "/ir-editor", "/pou-studio",
  "/fleet-orchestration", "/safety-workforce", "/equipment-standards", "/equipment-integration",
];

beforeAll(async () => {
  await initLayoutKitTestI18n();
  installMatchMedia();
  presetNarrow(false);
});
beforeEach(() => {
  // Bề rộng desktop mặc định của bộ test (jsdom mặc định 1024): ≥1280 ⇒ license nghiêm trọng là chip.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1366 });
  S.user = { id: 7, role: "engineer", name: "Eng", email: "e@x" };
  S.permissions = [];
  S.launcher = true;
  S.lic = { ...LIC_NORMAL };
  S.aiBlocked = false;
  S.isa = false;
  localStorage.clear();
  resetAiEntryForTest();
});
afterEach(() => cleanup());

function Page({ variant, children }: { variant?: "workbench" | "full-bleed"; children?: React.ReactNode }) {
  useShellPageVariant(variant ?? "default");
  return (
    <PageContainer>
      <PageHeader title="Trang thử" />
      {children}
    </PageContainer>
  );
}

function renderShell(path: string, child: React.ReactNode = <Page />) {
  const loc = memoryLocation({ path });
  return render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <ProgrammingCopilotProvider>
        <DashboardLayout asShell>{child}</DashboardLayout>
      </ProgrammingCopilotProvider>
    </Router>,
  );
}

const header = () => document.querySelector('header[data-app-chrome="header"]') as HTMLElement;
const mainEl = () => document.getElementById("main-content") as HTMLElement;
const crumbNavs = () => [...document.querySelectorAll('nav[data-slot="breadcrumb"]')];

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Breadcrumb — đúng MỘT, nằm trong top bar", () => {
  it.each(ENGINEERING_ROUTES)("%s: đúng 1 breadcrumb và nó nằm TRONG header của shell", (route) => {
    renderShell(route);
    const expected = buildBreadcrumbs(route).length > 1 ? 1 : 0;
    expect(crumbNavs()).toHaveLength(expected);
    if (expected) {
      expect(header()).toContainElement(crumbNavs()[0] as HTMLElement);
      // Không còn hàng breadcrumb riêng giữa top bar và <main>.
      expect(header().nextElementSibling?.querySelector('nav[data-slot="breadcrumb"]') ?? null).toBeNull();
    }
  });

  it("PageHeader KHÔNG còn vẽ breadcrumb, kể cả khi trang cũ lỡ truyền prop", () => {
    const legacy = { breadcrumbs: [{ label: "A", href: "/a" }, { label: "B" }] } as Record<string, unknown>;
    render(<PageHeader title="X" {...legacy} />);
    expect(crumbNavs()).toHaveLength(0);
  });

  it("trail vẫn đủ Module › … › Trang và mục cha là link (không mất điều hướng)", () => {
    renderShell("/recipes");
    const nav = crumbNavs()[0] as HTMLElement;
    const crumbs = buildBreadcrumbs("/recipes");
    const links = within(nav).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", crumbs[0].href);
    expect(within(nav).getAllByRole("listitem").length).toBe(crumbs.length);
  });

  // 5 trang NGOÀI Engineering từng truyền `PageHeader breadcrumbs={buildBreadcrumbs(location)}`.
  // Trang cũ hiện trail khi buildBreadcrumbs(route) không rỗng; shell phải hiện đúng trail đó (không
  // trang nào mất điều hướng khi bỏ prop).
  it.each(["/alarm-kpi", "/sla-cockpit", "/sop-management", "/sop", "/sop/5", "/rf-test-cell"])(
    "%s (trang ngoài Engineering từng tự vẽ breadcrumb): shell hiện đúng trail cũ",
    (route) => {
      renderShell(route);
      const old = buildBreadcrumbs(route, (k) => i18next.t(k));
      expect(crumbNavs()).toHaveLength(old.length > 0 ? 1 : 0);
      if (old.length > 0) {
        const items = within(crumbNavs()[0] as HTMLElement).getAllByRole("listitem");
        expect(items.map((li) => li.textContent)).toEqual(old.map((c) => c.label));
      }
    },
  );

  it("route ẩn breadcrumb (trang chủ vai trò) vẫn KHÔNG có breadcrumb", () => {
    renderShell("/supervisor-home");
    expect(crumbNavs()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Padding — không còn padding kép; biến thể full-bleed", () => {
  const PAD = /(^|\s)(md:|sm:|lg:)?(p|px|py|pt)-\d/;

  it("PageContainer trong <main> của shell KHÔNG tự đệm (main là chỗ đệm duy nhất)", () => {
    renderShell("/recipes");
    const pc = mainEl().querySelector("[data-page-container]") as HTMLElement;
    expect(pc).not.toBeNull();
    expect(pc.className).not.toMatch(PAD);
    expect(mainEl().getAttribute("data-shell-variant")).toBe("default");
    // đỉnh main ≤16 px (md:pt-4) — trước đây 24 + 24
    expect(mainEl().className).toMatch(/(^|\s)md:pt-4(\s|$)/);
    expect(mainEl().className).not.toMatch(/(^|\s)md:p-6(\s|$)/);
  });

  it("PageContainer NGOÀI shell giữ padding cũ (tương thích)", () => {
    render(<PageContainer data-testid="pc" />);
    expect(screen.getByTestId("pc").className).toMatch(/px-4 py-4 md:px-6 md:py-6/);
  });

  it("trang khai full-bleed ⇒ <main> không đệm (p-0) và không chừa pb-24 cho nút nổi", () => {
    renderShell("/engineering", <Page variant="full-bleed" />);
    expect(mainEl().getAttribute("data-shell-variant")).toBe("full-bleed");
    expect(mainEl().className).toMatch(/(^|\s)p-0(\s|$)/);
    expect(mainEl().className).not.toMatch(/pb-24/);
  });

  it("rời trang full-bleed ⇒ shell trở về default", () => {
    function Toggle() {
      const [fb, setFb] = React.useState(true);
      return (
        <>
          {fb ? <Page variant="full-bleed" /> : <Page />}
          <button type="button" onClick={() => setFb(false)}>leave</button>
        </>
      );
    }
    renderShell("/engineering", <Toggle />);
    expect(mainEl().getAttribute("data-shell-variant")).toBe("full-bleed");
    fireEvent.click(screen.getByRole("button", { name: "leave" }));
    expect(mainEl().getAttribute("data-shell-variant")).toBe("default");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Rail thu gọn — flyout submenu kiểu VS Code", () => {
  const sidebarState = () =>
    (document.querySelector('[data-slot="sidebar"][data-state]') as HTMLElement).getAttribute("data-state");
  const railIcons = () =>
    [...document.querySelectorAll('[data-cascading-nav] button[aria-haspopup="menu"]')] as HTMLButtonElement[];

  it("di chuột lên icon nhóm ⇒ menu liệt kê ĐỦ các trang của nhóm", () => {
    localStorage.setItem("sidebar_open", "false");
    renderShell("/recipes");
    expect(sidebarState()).toBe("collapsed");
    const icons = railIcons();
    expect(icons.length).toBeGreaterThan(0);
    const icon = icons[0];
    fireEvent.mouseEnter(icon);
    const menu = screen.getByRole("menu", { name: icon.getAttribute("aria-label")! });
    // Đủ trang của nhóm: so với chính nhóm nav cùng nhãn (đã lọc vai/giấy phép như sidebar).
    const label = icon.getAttribute("aria-label")!;
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
    const g = navGroups.find((x) => i18next.t(x.label) === label)!;
    expect(g, "icon phải mang nhãn của một nhóm nav").toBeTruthy();
    const labels = g.items.map((it) => i18next.t(it.label));
    for (const b of items) expect(labels.some((l) => (b.textContent ?? "").includes(l))).toBe(true);
    expect(icon).toHaveAttribute("aria-expanded", "true");
  });

  it("bàn phím: Enter mở và focus mục đầu, ↓ đi tiếp, Esc đóng và trả focus về icon", () => {
    localStorage.setItem("sidebar_open", "false");
    renderShell("/recipes");
    const icon = railIcons()[0];
    act(() => icon.focus());
    fireEvent.keyDown(icon, { key: "Enter" });
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);
    if (items.length > 1) {
      fireEvent.keyDown(items[0], { key: "ArrowDown" });
      expect(document.activeElement).toBe(items[1]);
      fireEvent.keyDown(items[1], { key: "ArrowUp" });
      expect(document.activeElement).toBe(items[0]);
    }
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it("bàn phím: → cũng mở; ← đóng và trả focus", () => {
    localStorage.setItem("sidebar_open", "false");
    renderShell("/recipes");
    const icon = railIcons()[0];
    act(() => icon.focus());
    fireEvent.keyDown(icon, { key: "ArrowRight" });
    const first = within(screen.getByRole("menu")).getAllByRole("menuitem")[0];
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it("M1 Tab trong menu ⇒ đóng và sang icon KẾ; Shift+Tab ⇒ về icon đã mở; nhãn nhóm aria-hidden", () => {
    localStorage.setItem("sidebar_open", "false");
    renderShell("/recipes");
    const icons = railIcons();
    expect(icons.length).toBeGreaterThan(1);
    act(() => icons[0].focus());
    fireEvent.keyDown(icons[0], { key: "Enter" });
    const menu = screen.getByRole("menu");
    expect(menu.firstElementChild).toHaveAttribute("aria-hidden", "true");
    const first = within(menu).getAllByRole("menuitem")[0];
    fireEvent.keyDown(first, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(icons[1]);
    act(() => icons[0].focus());
    fireEvent.keyDown(icons[0], { key: "Enter" });
    const first2 = within(screen.getByRole("menu")).getAllByRole("menuitem")[0];
    fireEvent.keyDown(first2, { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(icons[0]);
  });

  it("chọn một mục trong flyout ⇒ điều hướng và đóng menu", () => {
    localStorage.setItem("sidebar_open", "false");
    const loc = memoryLocation({ path: "/recipes", record: true });
    render(
      <Router hook={loc.hook} searchHook={loc.searchHook}>
        <ProgrammingCopilotProvider>
          <DashboardLayout asShell><Page /></DashboardLayout>
        </ProgrammingCopilotProvider>
      </Router>,
    );
    const icon = railIcons()[0];
    fireEvent.mouseEnter(icon);
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    const target = items[items.length - 1];
    fireEvent.click(target);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(loc.history!.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Màn workbench: rail thu gọn mặc định, người dùng mở được và lựa chọn nhớ THEO NGƯỜI DÙNG", () => {
  const state = () => (document.querySelector('[data-slot="sidebar"][data-state]') as HTMLElement).getAttribute("data-state");
  const trigger = () => header().querySelector('[data-sidebar="trigger"]') as HTMLElement;

  it("full-bleed ⇒ thu gọn dù màn thường đang mở rộng", () => {
    localStorage.setItem("sidebar_open", "true");
    renderShell("/engineering", <Page variant="full-bleed" />);
    expect(state()).toBe("collapsed");
  });

  it("mở rộng ở workbench ⇒ nhớ cho user đó, user khác vẫn mặc định thu gọn; khoá màn thường không đổi", () => {
    localStorage.setItem("sidebar_open", "true");
    const r = renderShell("/engineering", <Page variant="full-bleed" />);
    fireEvent.click(trigger());
    expect(state()).toBe("expanded");
    expect(localStorage.getItem("sidebar_open")).toBe("true");
    r.unmount();
    renderShell("/engineering", <Page variant="full-bleed" />);
    expect(state()).toBe("expanded");
    cleanup();
    S.user = { id: 8, role: "engineer", name: "Other", email: "o@x" };
    renderShell("/engineering", <Page variant="full-bleed" />);
    expect(state()).toBe("collapsed");
  });

  it("biến thể workbench (màn soạn thảo chưa chuyển WorkbenchShell): rail thu gọn, <main> GIỮ padding", () => {
    localStorage.setItem("sidebar_open", "true");
    renderShell("/ir-editor", <Page variant="workbench" />);
    expect(state()).toBe("collapsed");
    expect(mainEl().getAttribute("data-shell-variant")).toBe("workbench");
    expect(mainEl().className).not.toMatch(/(^|\s)p-0(\s|$)/);
    expect(mainEl().className).toMatch(/(^|\s)md:pt-4(\s|$)/);
  });

  it("đúng 4 màn workbench (FE1 khuyến nghị 3) khai biến thể; 8 màn còn lại không (Studio/Copilot đã gộp — Task 15)", () => {
    const FILES: Record<string, string> = {
      "/engineering": "EngineeringWorkspace", "/ir-editor": "IrEditor", "/pou-studio": "PouStudio",
      "/orchestration-studio": "OrchestrationStudio", "/engineering-home": "EngineeringHub",
      "/engineering-changes": "EngineeringChanges",
      "/recipes": "RecipeManagement", "/interlock-rules": "InterlockRuleManagement",
      "/fleet-orchestration": "FleetOrchestration",
      "/safety-workforce": "SafetyWorkforce", "/equipment-standards": "EquipmentStandards",
      "/equipment-integration": "EquipmentIntegration",
    };
    const WORKBENCH = new Set(["/engineering", "/ir-editor", "/pou-studio", "/orchestration-studio"]);
    for (const route of ENGINEERING_ROUTES) {
      const src = readFileSync(`client/src/pages/${FILES[route]}.tsx`, "utf8");
      const declares = /useShellPageVariant\("(workbench|full-bleed)"\)/.test(src);
      expect(declares, route).toBe(WORKBENCH.has(route));
      // breadcrumb của trang đã bỏ: không trang nào còn tự dựng trail
      expect(/breadcrumbs=\{/.test(src), `${route} còn truyền breadcrumbs`).toBe(false);
    }
  });

  it("màn thường vẫn theo lựa chọn cũ (sidebar_open)", () => {
    localStorage.setItem("sidebar_open", "true");
    renderShell("/recipes");
    expect(state()).toBe("expanded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Chế độ Đơn giản không trống", () => {
  const primaryNav = () => screen.getByRole("navigation", { name: /Điều hướng chính/ });

  it("supervisor (mặc định Đơn giản) trên màn Engineering: thanh bên CÓ mục, kèm ghi chú đang hiện đủ", () => {
    S.user = { id: 9, role: "supervisor", name: "Sup", email: "s@x" };
    renderShell("/engineering-changes");
    const nav = primaryNav();
    expect(within(nav).queryAllByRole("button").length + within(nav).queryAllByRole("menuitem").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-nav-simple-fallback]")).not.toBeNull();
  });

  it("chế độ Đơn giản có mục ⇒ KHÔNG đổi gì (không ghi chú)", () => {
    S.user = { id: 9, role: "supervisor", name: "Sup", email: "s@x" };
    renderShell("/supervisor-home");
    expect(document.querySelector("[data-nav-simple-fallback]")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Banner shell ⇒ chip 1 dòng trong top bar, CÙNG điều kiện", () => {
  const DAY = 24 * 3600 * 1000;

  it("quyền sắp hết hạn ⇒ chip trong header; popover giữ nguyên câu cũ; bỏ qua ⇒ chip mất", () => {
    S.permissions = [{ moduleName: "Recipes", expiresAt: new Date(Date.now() + 2 * DAY - 1000).toISOString() }];
    renderShell("/recipes");
    const chip = header().querySelector('[data-testid="shell-notice-permission-expiry"]') as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip).toHaveAttribute("data-notice-kind");
    // không còn dải banner giữa top bar và main
    expect(document.querySelector('[data-shell-banner]')).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText('Quyền "Recipes" sẽ hết hạn sau 2 ngày — liên hệ quản trị để gia hạn.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua" }));
    expect(header().querySelector('[data-testid="shell-notice-permission-expiry"]')).toBeNull();
  });

  it("quyền còn xa (30 ngày) hoặc đã hết hạn ⇒ không chip (điều kiện cũ)", () => {
    S.permissions = [
      { moduleName: "A", expiresAt: new Date(Date.now() + 30 * DAY).toISOString() },
      { moduleName: "B", expiresAt: new Date(Date.now() - DAY).toISOString() },
    ];
    renderShell("/recipes");
    expect(header().querySelector('[data-testid="shell-notice-permission-expiry"]')).toBeNull();
  });

  it("license sắp hết hạn (warning) ⇒ chip; popover có thông điệp + nút đóng", () => {
    S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, isWarning: true, bannerSeverity: "warning", message: "License hết hạn ngày 08/10", daysUntilExpiry: 5 };
    renderShell("/recipes");
    const chip = header().querySelector('[data-testid="shell-notice-license"]') as HTMLElement;
    expect(chip).not.toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("License hết hạn ngày 08/10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng cảnh báo" }));
    expect(header().querySelector('[data-testid="shell-notice-license"]')).toBeNull();
  });

  // ── R-2-i: trạng thái license NGHIÊM TRỌNG — đỏ đặc, luôn hiện, role=status, nút admin NGAY trên đó ──
  const crit = () => header().querySelector('[data-testid="shell-license-critical"]') as HTMLElement | null;
  const bar = () => document.querySelector('[data-testid="shell-license-bar"]') as HTMLElement | null;

  it("R-2-i chỉ đọc (error) ⇒ chip ĐỎ ĐẶC luôn hiện trong header, role=status, CTA admin không cần bấm, không nút đóng, không bị gộp", () => {
    S.user = { id: 1, role: "admin", name: "Adm", email: "a@x" };
    S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, bannerSeverity: "error", message: "Chỉ đọc từ 01/10" };
    presetNarrow(true); // header hẹp: chip thường gộp vào "+N", chip nghiêm trọng thì KHÔNG
    renderShell("/recipes");
    const c = crit()!;
    expect(c).not.toBeNull();
    expect(c).toHaveAttribute("role", "status");
    expect(c).toHaveAttribute("aria-live", "polite");
    expect(c).toHaveAttribute("data-state", "readonly");
    expect(c.className).toMatch(/(^|\s)bg-destructive(\s|$)/);
    expect(c.className).toMatch(/(^|\s)shrink-0(\s|$)/);
    expect(c.className).toMatch(/whitespace-nowrap/);
    expect(c).toHaveTextContent("License: chỉ đọc");
    expect(c).toHaveTextContent("Chỉ đọc từ 01/10"); // câu đầy đủ cho trình đọc màn hình
    expect(within(c).getByRole("link", { name: "Gia hạn License" })).toHaveAttribute("href", "/license");
    expect(screen.queryByRole("button", { name: "Đóng cảnh báo" })).toBeNull();
    expect(bar()).toBeNull();
    expect(header().querySelector('[data-testid="shell-notice-license"]')).toBeNull();
    presetNarrow(false);
  });

  it("R-2-i server offline ⇒ chip đỏ đặc, role=status; chi tiết cũ trong popover", () => {
    S.lic = { ...LIC_NORMAL, showBanner: true, serverReachable: false, consecutiveOfflineChecks: 2 };
    renderShell("/recipes");
    const c = crit()!;
    expect(c).not.toBeNull();
    expect(c).toHaveAttribute("data-state", "serverDown");
    expect(c).toHaveAttribute("role", "status");
    expect(c.className).toMatch(/(^|\s)bg-destructive(\s|$)/);
    expect(c).toHaveTextContent("License Server không khả dụng");
    fireEvent.click(within(c).getByRole("button", { name: "Chi tiết license" }));
    expect(screen.getByText(/Hệ thống vẫn hoạt động bình thường/)).toBeInTheDocument();
    expect(bar()).toBeNull();
  });

  it("R-2-i bị khoá ⇒ THANH đầy bề rộng ≤32 px ngay dưới top bar, role=status, CTA Kích hoạt; khác chỉ-đọc", () => {
    S.user = { id: 1, role: "admin", name: "Adm", email: "a@x" };
    S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, isLocked: true, bannerSeverity: "critical", message: "Đã khoá" };
    renderShell("/recipes");
    const b = bar()!;
    expect(b).not.toBeNull();
    expect(header().nextElementSibling).toBe(b);
    expect(b).toHaveAttribute("role", "status");
    expect(b).toHaveAttribute("data-state", "locked");
    expect(b.className).toMatch(/(^|\s)h-8(\s|$)/);
    expect(b).toHaveTextContent("License bị khoá");
    expect(b).toHaveTextContent("Đã khoá");
    expect(within(b).getByRole("link", { name: "Kích hoạt License" })).toBeInTheDocument();
    expect(crit()).toBeNull(); // chỉ-đọc là CHIP, khoá là THANH — hai hình dạng khác nhau
  });

  it("R-2-i chưa có license ⇒ thanh dưới top bar, nhãn riêng", () => {
    S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, noLicense: true, bannerSeverity: "critical", message: "Không tìm thấy license" };
    renderShell("/recipes");
    const b = bar()!;
    expect(b).not.toBeNull();
    expect(b).toHaveAttribute("data-state", "noLicense");
    expect(b).toHaveTextContent("Chưa có license");
    expect(b).toHaveTextContent("Không tìm thấy license");
    expect(within(b).queryByRole("link")).toBeNull(); // không phải admin ⇒ không CTA (như cũ)
  });

  it("điện thoại (<768): chỉ-đọc thành THANH đỏ dưới top bar (không chip tràn top bar); nút AI còn trong header; theme/ngôn ngữ/lưới app rời top bar", () => {
    const w = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      S.user = { id: 1, role: "admin", name: "Adm", email: "a@x" };
      S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, bannerSeverity: "error", message: "Chỉ đọc từ 01/10" };
      renderShell("/recipes");
      expect(crit()).toBeNull();
      const b = bar()!;
      expect(b).not.toBeNull();
      expect(header().nextElementSibling).toBe(b);
      expect(b).toHaveAttribute("data-state", "readonly");
      expect(b.className).toMatch(/(^|\s)bg-destructive(\s|$)/); // khác thanh "bị khoá" (bg-red-700)
      expect(b).toHaveTextContent("License: chỉ đọc");
      expect(within(b).getByRole("link", { name: "Gia hạn License" })).toBeInTheDocument();
      expect(header().querySelector("[data-shell-ai]")).not.toBeNull();
      expect(header().querySelector('[data-stub="theme"]')).toBeNull();
      expect(header().querySelector('[data-stub="lang"]')).toBeNull();
      expect(header().querySelector('[data-stub="launcher"]')).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    }
  });

  it.each([800, 1100])("%i px (< 1280): server offline cũng thành THANH (chip đỏ đặc không vừa top bar)", (px) => {
    const w = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: px });
    try {
      S.lic = { ...LIC_NORMAL, showBanner: true, serverReachable: false, consecutiveOfflineChecks: 2 };
      renderShell("/recipes");
      expect(crit()).toBeNull();
      expect(bar()).toHaveAttribute("data-state", "serverDown");
      expect(bar()).toHaveAttribute("role", "status");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    }
  });

  it("fix 2 — trạng thái tươi dữ liệu (ISA-101) còn hiện ở MỌI bề rộng nó từng hiện (≥640): một bản trong top bar, gọn dưới xl", () => {
    S.isa = true;
    renderShell("/recipes");
    const f = header().querySelectorAll('[data-stub="fresh"]');
    expect(f).toHaveLength(1);
    const c = (f[0].getAttribute("class") ?? "").split(/\s+/);
    expect(c).toContain("sm:inline-flex");
    expect(c.some((x) => /^(md|lg|xl|2xl):inline-flex$/.test(x))).toBe(false);
    expect(f[0]).toHaveAttribute("data-compact", "true");
  });

  it("fix 2 — điện thoại (<640): trạng thái tươi dữ liệu nằm trong ngăn menu (như theme/ngôn ngữ)", () => {
    const w = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    try {
      S.isa = true;
      renderShell("/recipes");
      fireEvent.click(header().querySelector('[data-sidebar="trigger"]') as HTMLElement);
      const prefs = document.querySelector("[data-shell-mobile-prefs]") as HTMLElement;
      expect(prefs).not.toBeNull();
      expect(prefs.querySelector('[data-stub="fresh"]')).not.toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    }
  });

  it("M2 header hẹp (<1920): chip thường gộp thành \"+N\"; breadcrumb giữ bề rộng tối thiểu 160 px", () => {
    S.permissions = [{ moduleName: "Recipes", expiresAt: new Date(Date.now() + 2 * DAY).toISOString() }];
    presetNarrow(true);
    const beta = ENGINEERING_ROUTES.find((r) => getNavItemByHref(r)?.beta === true)!;
    renderShell(beta);
    const more = header().querySelector("[data-notice-more]") as HTMLElement;
    expect(more).not.toBeNull();
    expect(more.getAttribute("data-notice-more")).toBe("2");
    expect(header().querySelector('button[data-testid="shell-notice-beta"]')).toBeNull();
    const crumbBox = crumbNavs()[0].closest("[data-shell-crumb]") as HTMLElement;
    expect(crumbBox.className).toMatch(/(^|\s)xl:min-w-40(\s|$)/);
    presetNarrow(false);
    cleanup();
    renderShell(beta);
    expect(header().querySelector("[data-notice-more]")).toBeNull();
    expect(header().querySelector('button[data-testid="shell-notice-beta"]')).not.toBeNull();
  });

  it("license bình thường / đang tải ⇒ không chip", () => {
    renderShell("/recipes");
    expect(header().querySelector('[data-testid="shell-notice-license"]')).toBeNull();
    cleanup();
    S.lic = { ...LIC_NORMAL, showBanner: true, isLoading: true, bannerSeverity: "error" };
    renderShell("/recipes");
    expect(header().querySelector('[data-testid="shell-notice-license"]')).toBeNull();
  });

  it("route Beta ⇒ chip Beta trong header, không còn banner role=note trong <main>; route thường ⇒ không", () => {
    const beta = ENGINEERING_ROUTES.find((r) => getNavItemByHref(r)?.beta === true)!;
    const plain = ENGINEERING_ROUTES.find((r) => getNavItemByHref(r) && getNavItemByHref(r)?.beta !== true)!;
    expect(beta).toBeTruthy();
    renderShell(beta);
    const chip = header().querySelector('[data-testid="shell-notice-beta"]') as HTMLElement;
    expect(chip).toHaveAttribute("data-notice-kind", "beta");
    expect(mainEl().querySelector('[role="note"]')).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText(/Đây là tính năng xem trước/)).toBeInTheDocument();
    cleanup();
    renderShell(plain);
    expect(header().querySelector('[data-testid="shell-notice-beta"]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Một lối vào AI trên top bar", () => {
  const aiBtn = () => header().querySelector("[data-shell-ai]") as HTMLButtonElement | null;

  it("màn thường: nút AI mở/đóng sheet trợ lý (trạng thái chung với bong bóng)", () => {
    renderShell("/recipes");
    const b = aiBtn()!;
    expect(b).not.toBeNull();
    expect(b).toHaveAccessibleName("Trợ lý AI");
    expect(getAiEntryState().headerEntries).toBe(1);
    fireEvent.click(b);
    expect(getAiEntryState().chatOpen).toBe(true);
    expect(b).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(b);
    expect(getAiEntryState().chatOpen).toBe(false);
  });

  it("màn lập trình có binding (IDE/IR/POU — R-2-b): nút AI mở DOCK Copilot, không mở chat", () => {
    let dockOpen = false;
    function Bound() {
      useCopilotBinding(() => ({ surfaceLabel: "IDE" }), []);
      dockOpen = useProgrammingCopilot().open;
      return <Page />;
    }
    renderShell("/engineering", <Bound />);
    const b = aiBtn()!;
    expect(b).toHaveAccessibleName("Mở Trợ lý Lập trình");
    fireEvent.click(b);
    expect(dockOpen).toBe(true);
    expect(getAiEntryState().chatOpen).toBe(false);
  });

  it("R-2-j chat đang mở rồi vào màn lập trình (IDE/IR/POU) ⇒ chat đóng, trao cho dock; không bao giờ chồng", () => {
    let dockOpen = false;
    function Bound() {
      useCopilotBinding(() => ({ surfaceLabel: "IDE" }), []);
      return null;
    }
    function Probe() {
      dockOpen = useProgrammingCopilot().open;
      const [ide, setIde] = React.useState(false);
      return (
        <>
          <Page />
          {ide && <Bound />}
          <button type="button" onClick={() => setIde(true)}>go-ide</button>
        </>
      );
    }
    renderShell("/recipes", <Probe />);
    fireEvent.click(aiBtn()!);
    expect(getAiEntryState().chatOpen).toBe(true);
    expect(dockOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "go-ide" }));
    expect(getAiEntryState().chatOpen).toBe(false);
    expect(dockOpen).toBe(true);
    // ở màn lập trình, mở chat từ nơi khác cũng bị đóng ngay (một panel phải tại một thời điểm)
    act(() => setAiChatOpen(true));
    expect(getAiEntryState().chatOpen).toBe(false);
  });

  it("khách không mua MOD_AI ⇒ không có nút AI chat", () => {
    S.aiBlocked = true;
    renderShell("/recipes");
    expect(aiBtn()).toBeNull();
  });

  it("tuyến ẩn bong bóng (/ai-chat) ⇒ không có nút AI chat", () => {
    renderShell("/ai-chat");
    expect(aiBtn()).toBeNull();
  });
});

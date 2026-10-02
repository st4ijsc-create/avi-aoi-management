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
} = {
  user: { id: 7, role: "engineer", name: "Eng", email: "e@x" },
  permissions: [],
  launcher: true,
  lic: {},
  aiBlocked: false,
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
vi.mock("@/lib/hmiFlags", () => ({ isIsa101V2: () => false }));
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => React.createElement("span", { "data-stub": name }),
}));
vi.mock("@/components/NotificationCenter", () => ({ NotificationCenter: stub("notif") }));
vi.mock("@/components/AIActionInbox", () => ({ AIActionInboxLauncher: stub("inbox") }));
vi.mock("@/components/SiteSwitcher", () => ({ SiteSwitcher: stub("site") }));
vi.mock("@/components/SiteHealthDot", () => ({ SiteHealthDot: stub("health") }));
vi.mock("@/components/FreshnessStrip", () => ({ FreshnessStrip: stub("fresh") }));
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
import { getAiEntryState, resetAiEntryForTest } from "@/lib/aiEntryStore";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { getNavItemByHref, navGroups } from "@/lib/navigation";

/** 14 màn Engineering do thiết bị đo Task 1 chấm (SCREENS trong scripts/ui-metrics/engineeringLayout.mjs). */
const ENGINEERING_ROUTES = [
  "/engineering-home", "/engineering-studio", "/engineering", "/engineering-changes", "/recipes",
  "/interlock-rules", "/orchestration-studio", "/ir-editor", "/pou-studio", "/programming-copilot",
  "/fleet-orchestration", "/safety-workforce", "/equipment-standards", "/equipment-integration",
];

beforeAll(async () => {
  await initLayoutKitTestI18n();
  installMatchMedia();
  presetNarrow(false);
});
beforeEach(() => {
  S.user = { id: 7, role: "engineer", name: "Eng", email: "e@x" };
  S.permissions = [];
  S.launcher = true;
  S.lic = { ...LIC_NORMAL };
  S.aiBlocked = false;
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

  it("đúng 4 màn workbench (FE1 khuyến nghị 3) khai biến thể; 10 màn còn lại không", () => {
    const FILES: Record<string, string> = {
      "/engineering": "EngineeringWorkspace", "/ir-editor": "IrEditor", "/pou-studio": "PouStudio",
      "/orchestration-studio": "OrchestrationStudio", "/engineering-home": "EngineeringHub",
      "/engineering-studio": "EngineeringStudioHub", "/engineering-changes": "EngineeringChanges",
      "/recipes": "RecipeManagement", "/interlock-rules": "InterlockRuleManagement",
      "/programming-copilot": "ProgrammingCopilot", "/fleet-orchestration": "FleetOrchestration",
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

  it("license chỉ đọc (error) ⇒ chip kiểu lỗi, KHÔNG có nút đóng", () => {
    S.lic = { ...LIC_NORMAL, showBanner: true, isNormal: false, bannerSeverity: "error", message: "Chỉ đọc" };
    renderShell("/recipes");
    const chip = header().querySelector('[data-testid="shell-notice-license"]') as HTMLElement;
    expect(chip).toHaveAttribute("data-notice-kind", "error");
    fireEvent.click(chip);
    expect(screen.getByText("Chỉ đọc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Đóng cảnh báo" })).toBeNull();
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

// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 15 — Hub Kỹ thuật thành mẫu P4 Cockpit; Studio gộp vào làm chế độ danh mục.
// Hợp đồng (task-15-brief + doc 81 §1.2 dòng "Hub" + §1.4 + FE1 §2.1/§2.2 + Review Focus 4/5 + GC3):
//   - Header một hàng: h1 + chip "Luồng vàng" (thay khối chữ tĩnh 57 px) + chip TƯ THẾ AN TOÀN (ghim, R-2-p; vàng khi
//     ghi lệnh thật BẬT mà engine interlock TẮT — ILK-06).
//   - MAIN (`data-layout-main`) = hàng tab `?tab=` (Hộp việc | Danh mục công cụ) + nội dung. Hộp việc = BẢNG của
//     `PendingReviewStrip` (Đợt 1 Task 2): cùng nguồn `oversight.pendingSummary`, cùng link sâu `?filter=pending`.
//     Phạm vi `?scope=`: "Chờ duyệt" (mặc định — loại việc không khẩn ở màn người dùng mở được) | "Toàn module".
//   - Panel phụ (aside): tư thế an toàn đầy đủ (cờ + độ phủ + cảnh báo ILK-06) + công cụ Ghim / Gần đây (ô 64 px).
//   - Danh mục (`?tab=catalog`, đích của /engineering-studio cũ): ô 64 px theo nhóm, ghim được, gồm cả các mục chỉ
//     Studio có (ECN, Bảng lệnh, Copilot nháp ⇒ IDE ?copilot=scratch).
// Chạy trên wouter THẬT với history jsdom.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { installMatchMedia, presetNarrow } from "@/components/patterns/layoutKitTestMedia";
import { resolvePermissionModule } from "@shared/permissions";
import HUB_SRC from "./EngineeringHub.tsx?raw";

const S = (k: string): string => {
  const v = k.split(".").reduce<unknown>((o, p) => (o as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return v;
};

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
const who = vi.hoisted(() => ({ role: "supervisor", modules: ["machine_status", "machine_control", "interlock"] as string[] }));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, role: who.role, name: "Sup" }, loading: false, isAuthenticated: true }),
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({
    isAdmin: who.role === "admin",
    hasPermission: (m: string, a: string) =>
      who.role === "admin" || ((a === "canView" || a === "canEdit") && who.modules.includes(resolvePermissionModule(m))),
  }),
}));

type Bucket = { count: number; samples: Array<{ id: number; label: string; hint?: string }>; degraded: boolean };
const ok = (count = 0, samples: Bucket["samples"] = []): Bucket => ({ count, samples, degraded: false });
const srv = vi.hoisted(() => ({
  summary: undefined as Record<string, unknown> | undefined,
  posture: undefined as Record<string, unknown> | undefined,
  summaryError: false,
}));
function setSummary(o: Record<string, Bucket> = {}) {
  const base: Record<string, Bucket> = {
    ecn: ok(), recipes: ok(), recipeActiveUnapproved: ok(), interlock: ok(), changeover: ok(),
    interlockEventsOpen: ok(), orchestration: ok(), safety: ok(), deadlocks: ok(), ...o,
  };
  srv.summary = { ...base, total: Object.values(base).reduce((n, b) => n + b.count, 0), generatedAt: "x" };
}
function chainable(): unknown {
  const fn = (..._a: unknown[]) => undefined;
  return new Proxy(fn, { get: () => chainable(), apply: () => undefined });
}
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get(_t, router: string) {
      if (router === "useUtils") return () => chainable();
      return new Proxy({}, {
        get(_t2, proc: string) {
          const key = `${router}.${proc}`;
          return {
            useQuery: () => {
              if (key === "oversight.pendingSummary" && srv.summaryError) {
                return { data: undefined, isLoading: false, isPending: false, isError: true, error: new Error("x"), refetch: () => undefined };
              }
              const data = key === "oversight.pendingSummary" ? srv.summary : key === "oversight.posture" ? srv.posture : undefined;
              return { data, isLoading: data === undefined, isPending: data === undefined, isError: false, error: null, refetch: () => undefined };
            },
          };
        },
      });
    },
  }),
}));

import EngineeringHub from "./EngineeringHub";

const POSTURE_OK = {
  otControlEnabled: false, robotControlEnabled: false, dpcDeployEnabled: false, interlockEngineEnabled: true,
  interlockAutoBlockEnabled: false, interlockRulesEnabledWithTarget: 2, interlockCoverageDegraded: false, writesOnEngineOff: false,
};

beforeAll(async () => {
  await initLayoutKitTestI18n();
  installMatchMedia();
});
beforeEach(() => {
  who.role = "supervisor";
  who.modules = ["machine_status", "machine_control", "interlock"];
  setSummary();
  srv.summaryError = false;
  srv.posture = { ...POSTURE_OK };
  presetNarrow(false);
  localStorage.clear();
  window.history.replaceState({}, "", "/engineering-home");
});
afterEach(() => cleanup());

const CRITICAL_HREFS = [
  "/recipes?filter=pending",
  "/interlock-rules?filter=pending",
  "/safety-workforce?filter=pending",
  "/fleet-orchestration?filter=deadlock",
];
const pinnedHrefs = () => Array.from(mainEl().querySelectorAll("table tbody[data-pending-pinned] tr a")).map((a) => a.getAttribute("href"));
const headerEl = () => screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
const criticalChip = () => headerEl().querySelector('[data-chip-id="critical"]') as HTMLElement;
const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const aside = () => document.querySelector("aside") as HTMLElement;
const rowHrefs = () => Array.from(mainEl().querySelectorAll("table tbody tr a")).map((a) => a.getAttribute("href"));
const scopeBtn = (k: "scopeApprovals" | "scopeAll") =>
  within(mainEl()).getByRole("button", { name: new RegExp(`^${S(`engineeringHome.${k}`)}`) });

describe("P4 Cockpit — bố cục (doc 81 §1.2 Hub)", () => {
  it("header 1 hàng (h1 + chip luồng vàng + chip tư thế); MAIN = toolbar tab + BẢNG hộp việc; aside ngoài MAIN; không khối chữ luồng vàng", () => {
    render(<EngineeringHub />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent(S("engineeringHome.title"));
    const header = h1.closest("[data-layout-header]") as HTMLElement;
    expect(within(header).getByRole("button", { name: new RegExp(S("engineeringHome.goldenThreadChip")) })).toBeInTheDocument();
    expect(header.querySelector('[data-layout-kpi][data-chip-id="posture"]')).not.toBeNull();
    expect(header.querySelector('[data-layout-kpi][data-chip-id="critical"]')).not.toBeNull();
    const main = mainEl();
    expect(main.getAttribute("data-layout-main")).toBe("engineering-home");
    expect(main.querySelectorAll("[data-layout-toolbar]")).toHaveLength(1);
    expect(main.querySelector("h1, [data-layout-header], [data-layout-kpi]")).toBeNull();
    expect(main.querySelectorAll("table")).toHaveLength(1);
    expect(main.contains(aside())).toBe(false);
    // khối chữ tĩnh "Luồng vàng…" không còn nằm trên trang (chỉ còn trong popover của chip)
    expect(screen.queryByText(S("engineeringHome.goldenThread"))).toBeNull();
    // không dựng breadcrumb riêng, không ToolTile 304×206 cũ
    expect(HUB_SRC).not.toMatch(/breadcrumbs=\{/);
    expect(HUB_SRC).not.toMatch(/<ToolTile/);
  });
});

describe("★ Supervisor vào Hub ⇒ mở ĐÚNG hộp việc (doc 81 §1.4, Review Focus 5)", () => {
  it("mặc định tab Hộp việc + phạm vi Chờ duyệt: ECN đang chờ HIỆN (số + tên mẫu) và link tới ECN ?filter=pending", () => {
    setSummary({ ecn: ok(1, [{ id: 3, label: "SEED-ECN-0003 · Tang nguong NG", hint: "in_review" }]), safety: ok(2) });
    render(<EngineeringHub />);
    expect(screen.getByRole("tab", { name: S("engineeringHome.inboxTab") })).toHaveAttribute("aria-selected", "true");
    expect(scopeBtn("scopeApprovals")).toHaveAttribute("aria-pressed", "true");
    const ecnLink = within(mainEl()).getByRole("link", { name: S("oversight.category.ecn") });
    expect(ecnLink).toHaveAttribute("href", "/engineering-changes?filter=pending");
    const row = ecnLink.closest("tr") as HTMLElement;
    expect(row.querySelector("[data-pending-count]")?.textContent).toBe("1");
    expect(row.textContent).toContain("SEED-ECN-0003");
    // R-2-y: 4 loại KHẨN luôn ghim trên đầu (mọi phạm vi) + Chờ duyệt = 5 loại không khẩn ở màn mở được
    expect(rowHrefs()).toEqual([
      ...CRITICAL_HREFS,
      "/engineering-changes?filter=pending",
      "/recipes?filter=pending",
      "/interlock-rules?filter=pending",
      "/product-changeover",
      "/orchestration-studio?filter=pending",
    ]);
    // sự cố an toàn chưa kiểm định (2, khẩn) VẪN thấy ở phạm vi Chờ duyệt, tô đỏ
    const safety = within(mainEl()).getByRole("link", { name: S("oversight.category.safety") }).closest("tr") as HTMLElement;
    expect(safety.querySelector("[data-pending-count]")?.textContent).toBe("2");
    expect(safety.querySelector("[data-pending-count]")?.className).toMatch(/text-destructive/);
    // số đếm của phạm vi hiện CẠNH nút phạm vi (ngoài bảng): 1 chờ duyệt / 3 toàn module
    expect(scopeBtn("scopeApprovals").textContent).toContain("1");
    expect(scopeBtn("scopeAll").textContent).toContain("3");
  });

  it("'Toàn module' ⇒ đủ 9 loại (gồm sự cố an toàn, bế tắc đội xe), ?scope=all vào URL và sống qua F5", () => {
    setSummary({ safety: ok(2) });
    render(<EngineeringHub />);
    fireEvent.click(scopeBtn("scopeAll"));
    expect(window.location.search).toContain("scope=all");
    expect(rowHrefs()).toHaveLength(9);
    expect(rowHrefs()).toContain("/safety-workforce?filter=pending");
    expect(rowHrefs()).toContain("/fleet-orchestration?filter=deadlock");
    cleanup();
    render(<EngineeringHub />); // F5
    expect(scopeBtn("scopeAll")).toHaveAttribute("aria-pressed", "true");
    expect(rowHrefs()).toHaveLength(9);
  });

  it("deep link sâu GIỮ NGUYÊN: Recipes / Interlock / Orchestration ?filter=pending", () => {
    setSummary({ recipes: ok(2), orchestration: ok(1) });
    render(<EngineeringHub />);
    expect(within(mainEl()).getByRole("link", { name: S("oversight.category.recipes") })).toHaveAttribute("href", "/recipes?filter=pending");
    expect(within(mainEl()).getByRole("link", { name: S("oversight.category.orchestration") })).toHaveAttribute("href", "/orchestration-studio?filter=pending");
    expect(within(mainEl()).getByRole("link", { name: S("oversight.category.interlock") })).toHaveAttribute("href", "/interlock-rules?filter=pending");
  });

  it("Chờ duyệt chỉ gồm màn người dùng MỞ ĐƯỢC (maintenance: không `interlock` ⇒ không dòng DUYỆT rule interlock); Toàn module vẫn đủ như cũ", () => {
    who.role = "maintenance";
    who.modules = ["machine_status", "machine_control"];
    render(<EngineeringHub />);
    // dòng "Interlocks to approve" (không khẩn) vắng; dòng KHẨN "Open interlock events" vẫn ghim (R-2-y)
    expect(within(mainEl()).queryByRole("link", { name: S("oversight.category.interlock") })).toBeNull();
    expect(within(mainEl()).getByRole("link", { name: S("oversight.category.interlockEventsOpen") })).toBeInTheDocument();
    expect(rowHrefs()).toContain("/engineering-changes?filter=pending");
    fireEvent.click(scopeBtn("scopeAll"));
    expect(within(mainEl()).getByRole("link", { name: S("oversight.category.interlock") })).toBeInTheDocument();
  });

  it("HUB-01 giữ: nguồn trong phạm vi không đọc được ⇒ KHÔNG 'Không có gì chờ duyệt'", () => {
    setSummary({ ecn: { count: 0, samples: [], degraded: true } });
    render(<EngineeringHub />);
    expect(screen.queryByText(S("oversight.allClear"))).toBeNull();
    expect(within(mainEl()).getByRole("status")).toBeInTheDocument();
  });
});

describe("★ R-2-y — loại KHẨN luôn thấy trên Hub, MỌI phạm vi (danh sách ghim + chip ghim)", () => {
  it.each(["approvals", "all"] as const)("phạm vi %s: 4 dòng khẩn ghim ĐẦU bảng, có số + link sâu, đỏ khi >0", (scope) => {
    setSummary({ recipeActiveUnapproved: ok(1), interlockEventsOpen: ok(3), safety: ok(2), deadlocks: ok(0) });
    if (scope === "all") window.history.replaceState({}, "", "/engineering-home?scope=all");
    render(<EngineeringHub />);
    expect(pinnedHrefs()).toEqual(CRITICAL_HREFS);
    const rows = Array.from(mainEl().querySelectorAll("table tbody[data-pending-pinned] tr")) as HTMLElement[];
    expect(rows.map((r) => r.querySelector("[data-pending-count]")?.textContent)).toEqual(["1", "3", "2", "0"]);
    for (const r of rows.slice(0, 3)) expect(r.querySelector("[data-pending-count]")?.className).toMatch(/text-destructive/);
    expect(rows[3].querySelector("[data-pending-count]")?.className).not.toMatch(/text-destructive/);
  });

  it("chip KHẨN ghim ở header (thấy cả ở tab Danh mục và dưới 1024 px): tổng 6, tông lỗi; bấm ⇒ về Hộp việc", () => {
    setSummary({ recipeActiveUnapproved: ok(1), interlockEventsOpen: ok(3), safety: ok(2) });
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    presetNarrow(true);
    render(<EngineeringHub />);
    const chip = criticalChip();
    expect(chip).toHaveAttribute("data-state", "ok");
    expect(chip.textContent).toContain("6");
    expect(chip.querySelector(".text-destructive")).not.toBeNull();
    fireEvent.click(chip);
    expect(screen.getByRole("tab", { name: S("engineeringHome.inboxTab") })).toHaveAttribute("aria-selected", "true");
    expect(pinnedHrefs()).toEqual(CRITICAL_HREFS);
  });

  it("đang tải ⇒ chip KHẨN 'đang tải' (không in 0), bảng là skeleton (không dòng số 0)", () => {
    srv.summary = undefined;
    render(<EngineeringHub />);
    expect(criticalChip()).toHaveAttribute("data-state", "loading");
    expect(criticalChip().textContent).not.toMatch(/\b0\b/);
    expect(mainEl().querySelectorAll("[data-pending-count]")).toHaveLength(0);
    expect(mainEl().querySelectorAll("tr[data-pending-skeleton]").length).toBeGreaterThanOrEqual(4);
  });

  it("một nguồn khẩn không đọc được ⇒ chip 'degraded' (≥), dòng đó '—' (không 0, không OK)", () => {
    setSummary({ safety: { count: 0, samples: [], degraded: true } });
    render(<EngineeringHub />);
    expect(criticalChip()).toHaveAttribute("data-state", "degraded");
    const row = within(mainEl()).getByRole("link", { name: S("oversight.category.safety") }).closest("tr") as HTMLElement;
    expect(row.querySelector("[data-pending-count]")?.textContent).toBe("—");
    expect(screen.queryByText(S("oversight.allClear"))).toBeNull();
  });

  it("lỗi tải ⇒ chip KHẨN 'Lỗi' (không 0)", () => {
    srv.summaryError = true;
    render(<EngineeringHub />);
    expect(criticalChip()).toHaveAttribute("data-state", "error");
  });
});

describe("R-2-v — hộp việc lấp chiều cao còn lại, danh sách cuộn BÊN TRONG", () => {
  it("bảng nằm trong vùng cuộn cao theo khung nhìn (h-[calc(100dvh-…)] + overflow-auto); thead dính", () => {
    render(<EngineeringHub />);
    const region = mainEl().querySelector("[data-hub-inbox-scroll]") as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.className).toMatch(/h-\[calc\(100dvh-[^\]]+\)\]/);
    expect(region.className).toMatch(/(^|\s)overflow-auto(\s|$)/);
    expect(region.querySelector("table")).not.toBeNull();
    expect(region.querySelector("thead")?.className).toMatch(/sticky/);
  });
});

describe("Tư thế an toàn (panel phụ + chip ghim) — không thoái lui GC14", () => {
  it("panel phụ có đủ cờ tư thế + độ phủ rule", () => {
    render(<EngineeringHub />);
    const a = aside();
    for (const k of ["otWrites", "robotWrites", "dpcDeploy", "interlockEngine", "interlockAutoBlock"]) {
      expect(within(a).getByText(S(`oversight.posture.${k}`))).toBeInTheDocument();
    }
    expect(a.textContent).toContain("2");
  });

  it("ILK-06: ghi lệnh thật BẬT + engine interlock TẮT ⇒ cảnh báo vàng trong panel phụ VÀ chip header ở trạng thái cảnh báo (ghim)", () => {
    srv.posture = { ...POSTURE_OK, otControlEnabled: true, interlockEngineEnabled: false, writesOnEngineOff: true };
    render(<EngineeringHub />);
    expect(within(aside()).getByText(S("oversight.posture.writesOnEngineOffWarning"))).toBeInTheDocument();
    const chip = headerEl().querySelector('[data-chip-id="posture"]') as HTMLElement;
    expect(chip.textContent).toContain(S("engineeringHome.postureWarn"));
    expect(chip.querySelector(".text-warning")).not.toBeNull();
  });

  it("dưới 1024 px chip tư thế VẪN ở header (panel phụ xuống dưới MAIN)", () => {
    presetNarrow(true);
    srv.posture = { ...POSTURE_OK, otControlEnabled: true, interlockEngineEnabled: false, writesOnEngineOff: true };
    render(<EngineeringHub />);
    expect((headerEl().querySelector('[data-chip-id="posture"]') as HTMLElement).textContent).toContain(S("engineeringHome.postureWarn"));
  });
});

describe("Danh mục công cụ (Studio gộp vào — ?tab=catalog)", () => {
  it("?tab=catalog (đích của /engineering-studio cũ) ⇒ tab Danh mục; ô 64 px; có mục chỉ Studio có (ECN, Bảng lệnh, Copilot nháp)", () => {
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    expect(screen.getByRole("tab", { name: S("engineeringHome.catalogTab") })).toHaveAttribute("aria-selected", "true");
    const main = mainEl();
    const links = Array.from(main.querySelectorAll("[data-hub-tool] a")).map((a) => a.getAttribute("href"));
    for (const h of ["/engineering", "/engineering?copilot=scratch", "/ir-editor", "/pou-studio", "/recipes", "/engineering-changes",
      "/orchestration-studio", "/fleet-orchestration", "/command-console", "/interlock-rules", "/safety-workforce",
      "/equipment-standards", "/equipment-integration"]) {
      expect(links, h).toContain(h);
    }
    // KHÔNG còn trang Copilot riêng làm đích
    expect(links).not.toContain("/programming-copilot");
    for (const tile of Array.from(main.querySelectorAll("[data-hub-tool]"))) expect(tile.className).toMatch(/(^|\s)h-16(\s|$)/);
    // không còn bảng hộp việc ở tab này
    expect(main.querySelector("table")).toBeNull();
  });

  it("ghim một công cụ ⇒ lưu chung kho ghim (nav-favorites) và hiện ở 'Đã ghim' của panel phụ; bỏ ghim ⇒ mất", () => {
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    const pin = within(mainEl()).getByRole("button", { name: S("engineeringHome.tools.pin").replace("{{name}}", S("nav.recipes")) });
    fireEvent.click(pin);
    expect(JSON.parse(localStorage.getItem("nav-favorites") ?? "[]")).toContain("/recipes");
    const pinned = within(aside()).getByRole("list", { name: S("engineeringHome.tools.pinned") });
    expect(within(pinned).getByRole("link", { name: S("nav.recipes") })).toHaveAttribute("href", "/recipes");
    fireEvent.click(within(mainEl()).getByRole("button", { name: S("engineeringHome.tools.unpin").replace("{{name}}", S("nav.recipes")) }));
    expect(within(aside()).queryByRole("list", { name: S("engineeringHome.tools.pinned") })).toBeNull();
  });

  it("'Gần đây' đọc kho gần đây chung (nav-recent), chỉ công cụ của module; 'Tất cả công cụ' ⇒ chuyển sang tab Danh mục", () => {
    localStorage.setItem("nav-recent", JSON.stringify(["/reports", "/interlock-rules"]));
    render(<EngineeringHub />);
    const recent = within(aside()).getByRole("list", { name: S("engineeringHome.tools.recent") });
    expect(within(recent).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/interlock-rules"]);
    act(() => { fireEvent.click(within(aside()).getByRole("button", { name: S("engineeringHome.tools.all") })); });
    expect(window.location.search).toContain("tab=catalog");
    expect(screen.getByRole("tab", { name: S("engineeringHome.catalogTab") })).toHaveAttribute("aria-selected", "true");
  });

  it("ô người dùng KHÔNG MỞ ĐƯỢC bị ẨN như Studio cũ (maintenance: không `interlock` ⇒ không ô Quy tắc Interlock); không còn ghi chú khoá", () => {
    who.role = "maintenance";
    who.modules = ["machine_status", "machine_control"];
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    const links = Array.from(mainEl().querySelectorAll("[data-hub-tool] a")).map((a) => a.getAttribute("href"));
    expect(links).not.toContain("/interlock-rules");
    expect(links).toContain("/engineering");
    expect(within(mainEl()).queryByText(/Cần quyền điều khiển/)).toBeNull();
  });

  it("vai không soạn thảo (không machine_control) ⇒ danh mục KHÔNG có IR / POU (cùng luật điều hướng §1.4)", () => {
    who.role = "viewer";
    who.modules = ["machine_status"];
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    const links = Array.from(mainEl().querySelectorAll("[data-hub-tool] a")).map((a) => a.getAttribute("href"));
    expect(links).not.toContain("/ir-editor");
    expect(links).not.toContain("/pou-studio");
    expect(links).toContain("/safety-workforce");
  });
});

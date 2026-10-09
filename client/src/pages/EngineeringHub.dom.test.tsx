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
import { getNavItemByHref, hasAccessToItem } from "@/lib/navigation";
import { useShowLabs } from "@/hooks/useShowLabs";

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
function setSummary(o: Record<string, Bucket> = {}, mine: Record<string, Bucket> = {}) {
  const base: Record<string, Bucket> = {
    ecn: ok(), recipes: ok(), recipeActiveUnapproved: ok(), interlock: ok(), changeover: ok(),
    interlockEventsOpen: ok(), orchestration: ok(), safety: ok(), deadlocks: ok(), ...o,
  };
  // doc 81 Đợt 3 Task 4 — `mine` (phạm vi "Của tôi"): năm nhóm giao được.
  const m: Record<string, Bucket> = { ecn: ok(), recipes: ok(), interlock: ok(), changeover: ok(), orchestration: ok(), ...mine };
  srv.summary = { ...base, mine: m, total: Object.values(base).reduce((n, b) => n + b.count, 0), generatedAt: "x" };
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
  "/labs/fleet-orchestration?filter=deadlock",
];
const pinnedHrefs = () => Array.from(mainEl().querySelectorAll("table tbody[data-pending-pinned] tr a")).map((a) => a.getAttribute("href"));
const headerEl = () => screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
const criticalChip = () => headerEl().querySelector('[data-chip-id="critical"]') as HTMLElement;
const mainEl = () => document.querySelector("[data-layout-main]") as HTMLElement;
const aside = () => document.querySelector("aside") as HTMLElement;
const rowHrefs = () => Array.from(mainEl().querySelectorAll("table tbody tr a")).map((a) => a.getAttribute("href"));
const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const scopeBtn = (k: "scopeMine" | "scopeApprovals" | "scopeAll") =>
  within(mainEl()).getByRole("button", { name: new RegExp(`^${reEsc(S(`engineeringHome.${k}`))}`) });

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
    expect(rowHrefs()).toContain("/labs/fleet-orchestration?filter=deadlock");
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
    // final wave R-2-z5 — ĐỔI KHẲNG ĐỊNH có chủ đích (ruling): dòng khẩn vẫn ghim + số, nhưng vai không mở được
    // /interlock-rules ⇒ KHÔNG là link (trước: link tới trang bị từ chối), kèm ghi chú "không có quyền".
    expect(within(mainEl()).queryByRole("link", { name: S("oversight.category.interlock") })).toBeNull();
    const evRow = mainEl().querySelector('tbody[data-pending-pinned] tr[data-pending-row="interlockEventsOpen"]') as HTMLElement;
    expect(evRow).not.toBeNull();
    expect(evRow.querySelector("a")).toBeNull();
    expect(evRow.querySelector("[data-pending-no-access]")).toHaveTextContent(S("oversight.noAccess"));
    expect(evRow.querySelector("[data-pending-count]")?.textContent).toBe("0");
    expect(rowHrefs()).toContain("/engineering-changes?filter=pending");
    fireEvent.click(scopeBtn("scopeAll"));
    // Toàn module: dòng duyệt rule interlock hiện (như cũ) nhưng cũng không là link với vai này.
    const ilkRow = mainEl().querySelector('tr[data-pending-row="interlock"]') as HTMLElement;
    expect(ilkRow).not.toBeNull();
    expect(ilkRow.querySelector("a")).toBeNull();
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

describe("doc 81 Đợt 3 Task 4 — phạm vi 'Của tôi' (giao cho tôi) · 'Chờ duyệt (tôi có quyền)' · 'Toàn module'", () => {
  const MINE_HREFS = [
    "/engineering-changes?filter=pending",
    "/recipes?filter=pending",
    "/interlock-rules?filter=pending",
    "/product-changeover",
    "/orchestration-studio?filter=pending",
  ];
  const scopeGroupLabels = () =>
    Array.from(mainEl().querySelectorAll('[role="group"] button')).map((b) => (b.textContent ?? "").replace(/\d+\+?$/, "").trim());

  it("BA nút phạm vi theo thứ tự Của tôi · Chờ duyệt (tôi có quyền) · Toàn module; mặc định vẫn là Chờ duyệt (không đổi URL cũ)", () => {
    render(<EngineeringHub />);
    expect(S("engineeringHome.scopeApprovals")).toBe("Chờ duyệt (tôi có quyền)");
    expect(scopeGroupLabels()).toEqual([S("engineeringHome.scopeMine"), S("engineeringHome.scopeApprovals"), S("engineeringHome.scopeAll")]);
    expect(scopeBtn("scopeApprovals")).toHaveAttribute("aria-pressed", "true");
    expect(scopeBtn("scopeMine")).toHaveAttribute("aria-pressed", "false");
  });

  it("★ 'Của tôi' ⇒ ?scope=mine (sống qua F5); 5 nhóm giao được đọc SỐ + TÊN từ `mine` (không từ tổng); số cạnh nút = tổng mine", () => {
    setSummary(
      { ecn: ok(7, [{ id: 1, label: "ECN-KHAC · cua nguoi khac" }]), recipes: ok(4) },
      { ecn: ok(2, [{ id: 9, label: "ECN-CUA-TOI · giao cho toi" }]), orchestration: ok(1) },
    );
    render(<EngineeringHub />);
    fireEvent.click(scopeBtn("scopeMine"));
    expect(window.location.search).toContain("scope=mine");
    expect(scopeBtn("scopeMine")).toHaveAttribute("aria-pressed", "true");
    expect(scopeBtn("scopeMine").textContent).toContain("3");
    expect(rowHrefs()).toEqual([...CRITICAL_HREFS, ...MINE_HREFS]);
    const ecnRow = mainEl().querySelector('tbody:not([data-pending-pinned]) tr[data-pending-row="ecn"]') as HTMLElement;
    expect(ecnRow.querySelector("[data-pending-count]")?.textContent).toBe("2");
    expect(ecnRow.textContent).toContain("ECN-CUA-TOI");
    expect(ecnRow.textContent).not.toContain("ECN-KHAC");
    const rcpRow = mainEl().querySelector('tbody:not([data-pending-pinned]) tr[data-pending-row="recipes"]') as HTMLElement;
    expect(rcpRow.querySelector("[data-pending-count]")?.textContent).toBe("0");
    cleanup();
    render(<EngineeringHub />); // F5
    expect(scopeBtn("scopeMine")).toHaveAttribute("aria-pressed", "true");
    expect(rowHrefs()).toEqual([...CRITICAL_HREFS, ...MINE_HREFS]);
  });

  it("★★ R-2-y — 'Của tôi' VẪN ghim 4 loại KHẨN với số TOÀN module (không bao giờ chỉ sau công tắc phạm vi)", () => {
    setSummary({ recipeActiveUnapproved: ok(1), interlockEventsOpen: ok(3), safety: ok(2) });
    window.history.replaceState({}, "", "/engineering-home?scope=mine");
    render(<EngineeringHub />);
    expect(pinnedHrefs()).toEqual(CRITICAL_HREFS);
    const rows = Array.from(mainEl().querySelectorAll("table tbody[data-pending-pinned] tr")) as HTMLElement[];
    expect(rows.map((r) => r.querySelector("[data-pending-count]")?.textContent)).toEqual(["1", "3", "2", "0"]);
    expect(criticalChip().textContent).toContain("6");
  });

  it("★★ không lộ tên: `mine` không có mẫu (người xem thiếu quyền xem) ⇒ dòng KHÔNG mượn tên của nhóm toàn module", () => {
    setSummary({ ecn: ok(5, [{ id: 1, label: "SECRET-ECN · khong duoc lo" }]) }, { ecn: ok(1, []) });
    window.history.replaceState({}, "", "/engineering-home?scope=mine");
    render(<EngineeringHub />);
    const ecnRow = mainEl().querySelector('tbody:not([data-pending-pinned]) tr[data-pending-row="ecn"]') as HTMLElement;
    expect(ecnRow.querySelector("[data-pending-count]")?.textContent).toBe("1");
    expect(mainEl().textContent).not.toContain("SECRET-ECN");
  });

  it("'Của tôi' trống ⇒ câu riêng 'không có việc giao cho bạn'; nguồn phân công không đọc được ⇒ '—' + role=status (HUB-01)", () => {
    window.history.replaceState({}, "", "/engineering-home?scope=mine");
    render(<EngineeringHub />);
    expect(within(mainEl()).getByText(S("oversight.mineAllClear"))).toBeInTheDocument();
    cleanup();
    setSummary({}, { interlock: { count: 0, samples: [], degraded: true } });
    render(<EngineeringHub />);
    expect(screen.queryByText(S("oversight.mineAllClear"))).toBeNull();
    expect(within(mainEl()).getByRole("status")).toBeInTheDocument();
    const row = mainEl().querySelector('tbody:not([data-pending-pinned]) tr[data-pending-row="interlock"]') as HTMLElement;
    expect(row.querySelector("[data-pending-count]")?.textContent).toBe("—");
  });

  it("fix 1 (HUB-01) — một nhóm 'Của tôi' không đọc được ⇒ số cạnh nút 'Của tôi' là '—', KHÔNG phải 0", () => {
    setSummary({}, { changeover: { count: 0, samples: [], degraded: true } });
    render(<EngineeringHub />);
    expect(scopeBtn("scopeMine").textContent).toContain("—");
    expect(scopeBtn("scopeMine").textContent).not.toMatch(/\d/);
  });

  it("'Của tôi' giữ luật mở trang (R-2-z5): vai không mở được /interlock-rules ⇒ dòng rule giữ số, không là link", () => {
    who.role = "maintenance";
    who.modules = ["machine_status", "machine_control"];
    setSummary({}, { interlock: ok(1) });
    window.history.replaceState({}, "", "/engineering-home?scope=mine");
    render(<EngineeringHub />);
    const row = mainEl().querySelector('tbody:not([data-pending-pinned]) tr[data-pending-row="interlock"]') as HTMLElement;
    expect(row.querySelector("a")).toBeNull();
    expect(row.querySelector("[data-pending-count]")?.textContent).toBe("1");
  });
});

describe("R-2-v — hộp việc lấp chiều cao còn lại, danh sách cuộn BÊN TRONG", () => {
  it("bảng nằm trong vùng cuộn cao theo khung nhìn (h-[calc(100dvh-…)] + overflow-auto); thead dính", () => {
    render(<EngineeringHub />);
    const region = mainEl().querySelector("[data-hub-inbox-scroll]") as HTMLElement;
    expect(region).not.toBeNull();
    // final wave R-2-z4 — ĐỔI SELECTOR (khẳng định giữ): chiều cao theo khung nhìn nay trừ chrome THẬT của shell.
    expect(region.className).toMatch(/h-\[calc\(100dvh_-_var\(--shell-chrome-h[^\]]+\)\]/);
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
      "/orchestration-studio", "/command-console", "/interlock-rules", "/safety-workforce",
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

// ── Doc 81 Đợt 3 Task 5 ([QĐ-3b], Review Focus #4) — Fleet ở nhóm Labs, Labs ẨN trong menu của người xem: cảnh báo bế tắc trên
// Hub vẫn ghim (R-2-y) ở MỌI phạm vi, là LINK, và bấm vào mở đúng Fleet ở route mới (giữ ?filter=deadlock). Sở thích "Hiện
// Labs" chỉ lọc menu — không đụng hộp việc, không đụng cổng route (hasAccessToItem đọc navGroups tĩnh).
describe("Task 5 — bế tắc đội xe trên Hub mở Fleet ở Labs, kể cả khi Labs đang ẩn trong menu", () => {
  const DEADLOCK = "/labs/fleet-orchestration?filter=deadlock";
  it.each([
    ["supervisor", ["machine_status", "machine_control", "interlock"], "approvals"],
    ["supervisor", ["machine_status", "machine_control", "interlock"], "mine"],
    ["supervisor", ["machine_status", "machine_control", "interlock"], "all"],
    ["engineer", ["machine_status", "machine_control"], "approvals"],
  ] as const)("%s (%j) · phạm vi %s: dòng bế tắc ghim, đỏ, là link tới %s; bấm ⇒ /labs/fleet-orchestration?filter=deadlock", (role, mods, scope) => {
    who.role = role;
    who.modules = [...mods];
    // Labs ẩn TƯỜNG MINH cho người xem (id 9) — và không có khoá nào khác bật Labs.
    localStorage.setItem("layoutKit:nav-labs:u9:show", "0");
    setSummary({ deadlocks: ok(2) });
    window.history.replaceState({}, "", `/engineering-home?scope=${scope}`);
    render(<EngineeringHub />);
    expect(pinnedHrefs()).toContain(DEADLOCK);
    const row = Array.from(mainEl().querySelectorAll("table tbody[data-pending-pinned] tr")).find(
      (r) => r.querySelector("a")?.getAttribute("href") === DEADLOCK,
    ) as HTMLElement;
    expect(row.querySelector("[data-pending-count]")?.textContent).toBe("2");
    expect(row.querySelector("[data-pending-count]")?.className).toMatch(/text-destructive/);
    // đích là mục nav Labs có thật, và cổng route (cùng luật RouteGuard navHref) cho vai này qua
    expect(getNavItemByHref(DEADLOCK)?.labs).toBe(true);
    expect(hasAccessToItem("/labs/fleet-orchestration", role, (m: string, a: string) => a === "canView" && mods.includes(m as never))).toBe(true);
    fireEvent.click(row.querySelector("a") as HTMLElement);
    expect(window.location.pathname).toBe("/labs/fleet-orchestration");
    expect(window.location.search).toBe("?filter=deadlock");
  });
});

// ── Doc 81 Đợt 3b Task 2 (a) — danh mục công cụ theo "Hiện Labs" (chủ dự án 2026-10-06): Labs TẮT (mặc định) ⇒ Fleet và
// mọi mục `labs` vắng khỏi danh mục; BẬT ⇒ hiện dưới nhóm Labs. Ghim cá nhân (panel phụ "Đã ghim") KHÔNG đổi; cảnh báo bế
// tắc (R-2-y) KHÔNG đổi.
describe("Đợt 3b Task 2 (a) — danh mục công cụ theo sở thích Hiện Labs", () => {
  const FLEET = "/labs/fleet-orchestration";
  const catalogHrefs = () => Array.from(mainEl().querySelectorAll("[data-hub-catalog] [data-hub-tool] a")).map((a) => a.getAttribute("href") ?? "");
  const labsHeading = () => Array.from(mainEl().querySelectorAll("[data-hub-catalog] h2")).find((h) => h.textContent === S("nav.section.labs"));

  it("Labs TẮT (mặc định, chưa có khoá) ⇒ không Fleet, không mục labs nào, không tiêu đề nhóm Labs; mục khác còn", () => {
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    const links = catalogHrefs();
    expect(links).not.toContain(FLEET);
    expect(links.filter((h) => getNavItemByHref(h)?.labs === true)).toEqual([]);
    expect(labsHeading()).toBeUndefined();
    expect(links).toContain("/orchestration-studio");
    expect(links).toContain("/engineering-changes");
  });

  it("Labs TẮT tường minh ('0') ⇒ như mặc định", () => {
    localStorage.setItem("layoutKit:nav-labs:u9:show", "0");
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    expect(catalogHrefs()).not.toContain(FLEET);
  });

  it("Labs BẬT ('1') ⇒ Fleet hiện dưới tiêu đề nhóm Labs", () => {
    localStorage.setItem("layoutKit:nav-labs:u9:show", "1");
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    expect(catalogHrefs()).toContain(FLEET);
    expect(labsHeading()).toBeDefined();
  });

  it("Labs TẮT nhưng người dùng ĐÃ GHIM Fleet ⇒ 'Đã ghim' ở panel phụ VẪN có Fleet (ghim cá nhân giữ nguyên)", () => {
    localStorage.setItem("nav-favorites", JSON.stringify([FLEET]));
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    expect(catalogHrefs()).not.toContain(FLEET);
    const pinned = within(aside()).getByRole("list", { name: S("engineeringHome.tools.pinned") });
    expect(within(pinned).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([FLEET]);
    expect(JSON.parse(localStorage.getItem("nav-favorites") ?? "[]")).toEqual([FLEET]);
  });

  it("Labs TẮT ⇒ cảnh báo bế tắc (R-2-y) vẫn ghim ở hộp việc và chip nghiêm trọng ở header vẫn đỏ", () => {
    setSummary({ deadlocks: ok(3) });
    render(<EngineeringHub />);
    expect(pinnedHrefs()).toContain("/labs/fleet-orchestration?filter=deadlock");
    expect(criticalChip()).not.toBeNull();
    const chipText = criticalChip().textContent;
    cleanup();
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<EngineeringHub />);
    expect(screen.getByRole("tab", { name: S("engineeringHome.catalogTab") })).toHaveAttribute("aria-selected", "true");
    expect(catalogHrefs().length).toBeGreaterThan(0);
    expect(catalogHrefs()).not.toContain(FLEET);
    expect(criticalChip().textContent).toBe(chipText);
  });

  // Fix round 1 (R-3b-b (4)) — bật/tắt "Hiện Labs" ở thanh bên CÙNG tab ⇒ danh mục đang mở đổi NGAY, không cần tải lại
  // (trước: hook chỉ nghe sự kiện `storage` — chỉ bắn ở tab KHÁC).
  it("bật/tắt Labs trong CÙNG tab (công tắc thanh bên) ⇒ danh mục đang mở đổi ngay, không remount", () => {
    function LabsToggle() {
      const { showLabs, toggleShowLabs } = useShowLabs(9);
      return <button type="button" data-testid="labs-toggle" aria-pressed={showLabs} onClick={toggleShowLabs}>labs</button>;
    }
    window.history.replaceState({}, "", "/engineering-home?tab=catalog");
    render(<><LabsToggle /><EngineeringHub /></>);
    expect(catalogHrefs()).not.toContain(FLEET);
    act(() => { fireEvent.click(screen.getByTestId("labs-toggle")); });
    expect(localStorage.getItem("layoutKit:nav-labs:u9:show")).toBe("1");
    expect(catalogHrefs()).toContain(FLEET);
    act(() => { fireEvent.click(screen.getByTestId("labs-toggle")); });
    expect(catalogHrefs()).not.toContain(FLEET);
  });
});

// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 2 (HUB-01) — TDD cho PendingReviewStrip.tsx: trước bản vá, client
// chỉ xét `total === 0` để hiện "Không có gì chờ duyệt", KHÔNG xét `degraded` — một
// nhánh lỗi (count=0 do throw) đủ để rơi vào "tất cả đã xử lý" dù nguồn đó thật ra
// KHÔNG đọc được (ca quan sát live: SEED-ECN-0003 "Đang xem xét" mà Hub báo trống).
// Dựng component THẬT qua @testing-library/react, chỉ mock hạ tầng (trpc/i18n).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}
function makeQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return { data: undefined, isLoading: false, isError: false, ...overrides };
}
const queryOverrides: Record<string, () => QueryResult> = {};
function setQueryOverride(key: string, result: QueryResult) {
  queryOverrides[key] = () => result;
}
function chainable(): unknown {
  const fn = (..._args: unknown[]) => undefined;
  return new Proxy(fn, { get: () => chainable(), apply: () => undefined });
}
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, routerName: string) {
        if (routerName === "useUtils") return () => chainable();
        return new Proxy(
          {},
          {
            get(_t2, procName: string) {
              const key = `${routerName}.${procName}`;
              return {
                useQuery: () => (queryOverrides[key] ? queryOverrides[key]() : makeQuery()),
              };
            },
          },
        );
      },
    },
  ),
}));

import { PendingReviewStrip } from "./PendingReviewStrip";

const KEY = "oversight.pendingSummary";

/** Bucket "khoẻ" mặc định — count=0, samples=[], degraded=false. */
function ok(count = 0, samples: Array<{ id: number; label: string; hint?: string }> = []) {
  return { count, samples, degraded: false };
}
function degraded() {
  return { count: 0, samples: [], degraded: true };
}

/** Tất cả chín nhánh — mặc định "khoẻ, count=0" trừ khi override. */
function summary(overrides: Record<string, ReturnType<typeof ok> | ReturnType<typeof degraded>> = {}) {
  const base = {
    ecn: ok(),
    recipes: ok(),
    recipeActiveUnapproved: ok(),
    interlock: ok(),
    changeover: ok(),
    interlockEventsOpen: ok(),
    orchestration: ok(),
    safety: ok(),
    deadlocks: ok(),
    ...overrides,
  };
  const total = Object.values(base).reduce((s, b) => s + b.count, 0);
  return { ...base, total, generatedAt: new Date().toISOString() };
}

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
});
afterEach(() => {
  cleanup();
});

describe("PendingReviewStrip — loading / error (không đổi)", () => {
  it("đang tải ⇒ hiện đủ 9 skeleton (khớp CATEGORIES), không banner", () => {
    setQueryOverride(KEY, makeQuery({ isLoading: true }));
    render(<PendingReviewStrip />);
    expect(document.querySelectorAll('[class*="rounded-xl"]').length).toBeGreaterThanOrEqual(9);
    expect(screen.queryByText(/Nothing waiting/i)).not.toBeInTheDocument();
  });

  it("lỗi mạng/transport ⇒ banner lỗi nhẹ, không phải banner degraded", () => {
    setQueryOverride(KEY, makeQuery({ isError: true }));
    render(<PendingReviewStrip />);
    expect(screen.getByText(/Could not load the pending-review summary/i)).toBeInTheDocument();
  });
});

describe("PendingReviewStrip — HUB-01: degraded KHÔNG được báo xanh giả", () => {
  it("mọi nhánh OK, tổng=0 ⇒ 'Nothing waiting' (đúng ca thật sạch)", () => {
    setQueryOverride(KEY, makeQuery({ data: summary() }));
    render(<PendingReviewStrip />);
    expect(screen.getByText(/Nothing waiting for approval right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/Could not read/i)).not.toBeInTheDocument();
  });

  it("★★★ một nhánh (ecn) degraded, TỔNG vẫn 0 ⇒ KHÔNG hiện 'Nothing waiting', HIỆN banner 'Could not read: …'", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ ecn: degraded() }) }));
    render(<PendingReviewStrip />);
    expect(screen.queryByText(/Nothing waiting for approval right now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Could not read:/i)).toBeInTheDocument();
    expect(screen.getByText(/ECNs to approve/i)).toBeInTheDocument();
  });

  it("nhánh degraded VẪN hiện lưới thẻ (kể cả tổng=0) để thấy CÁI GÌ không đọc được", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ interlockEventsOpen: degraded() }) }));
    render(<PendingReviewStrip />);
    // Nhãn của MỌI thẻ đều lên màn (kể cả những thẻ count=0 khác) — không co lại chỉ hiện 1.
    expect(screen.getByText("ECNs to approve")).toBeInTheDocument();
    expect(screen.getByText("Open interlock events")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });

  it("có việc chờ thật (total>0) và KHÔNG degraded ⇒ hiện lưới, không banner degraded", () => {
    setQueryOverride(
      KEY,
      makeQuery({
        data: summary({ ecn: ok(1, [{ id: 3, label: "SEED-ECN-0003 · Tang nguong NG", hint: "in_review" }]) }),
      }),
    );
    render(<PendingReviewStrip />);
    expect(screen.queryByText(/Could not read:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing waiting/i)).not.toBeInTheDocument();
    expect(screen.getByText(/SEED-ECN-0003/)).toBeInTheDocument();
  });
});

describe("PendingReviewStrip — HUB-02: samples rỗng (thiếu quyền) không tự xưng 'unavailable'", () => {
  it("count>0 nhưng samples=[] và KHÔNG degraded (người chỉ có machine_status) ⇒ không hiện chữ 'unavailable'", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ recipes: ok(2, []) }) }));
    render(<PendingReviewStrip />);
    expect(screen.getByText("Recipes to approve")).toBeInTheDocument();
    expect(screen.queryByText("unavailable")).not.toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Doc 81 Đợt 2 Task 15 — biến thể BẢNG (MAIN "hộp việc" của Hub, FE1 §2.1 "bảng 8 dòng"): cùng nguồn, cùng deep
// link, cùng luật HUB-01/HUB-02; thêm bộ lọc loại việc (phạm vi "Chờ duyệt" / "Toàn module" của Hub).
describe("PendingReviewStrip variant='table' (Task 15)", () => {
  const rowsHrefs = () =>
    Array.from(document.querySelectorAll("table tbody tr a")).map((a) => a.getAttribute("href"));

  it("một <table>, mỗi loại việc một dòng, link sâu GIỮ NGUYÊN (?filter=pending…)", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ ecn: ok(1, [{ id: 3, label: "SEED-ECN-0003 · Tang nguong NG" }]) }) }));
    render(<PendingReviewStrip variant="table" />);
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(rowsHrefs()).toEqual([
      "/engineering-changes?filter=pending",
      "/recipes?filter=pending",
      "/recipes?filter=pending",
      "/interlock-rules?filter=pending",
      "/product-changeover",
      "/interlock-rules?filter=pending",
      "/orchestration-studio?filter=pending",
      "/safety-workforce?filter=pending",
      "/labs/fleet-orchestration?filter=deadlock",
    ]);
    const ecnRow = screen.getByText("ECNs to approve").closest("tr") as HTMLElement;
    expect(ecnRow.textContent).toContain("1");
    expect(ecnRow.textContent).toContain("SEED-ECN-0003");
  });

  it("categoryFilter: chỉ các loại được chọn; 'Nothing waiting' tính TRÊN tập đang xem", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ safety: ok(4) }) }));
    render(<PendingReviewStrip variant="table" categoryFilter={(c) => !c.critical} />);
    expect(rowsHrefs()).toHaveLength(5);
    expect(screen.queryByText("Unaudited safety events")).toBeNull();
    // safety (critical, ngoài tập) có 4 nhưng tập đang xem đều 0 và đọc được ⇒ "Nothing waiting"
    expect(screen.getByText(/Nothing waiting for approval right now/i)).toBeInTheDocument();
  });

  it("★ HUB-01 trong bảng: một nguồn trong tập degraded ⇒ KHÔNG 'Nothing waiting', CÓ 'Could not read: …', ô số không in 0", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ ecn: degraded() }) }));
    render(<PendingReviewStrip variant="table" categoryFilter={(c) => !c.critical} />);
    expect(screen.queryByText(/Nothing waiting/i)).toBeNull();
    // (i18n chưa khởi tạo trong test này ⇒ chuỗi mặc định KHÔNG nội suy {{sources}} — như test lưới thẻ ở trên)
    expect(screen.getByRole("status").textContent).toMatch(/Could not read:/);
    const ecnRow = screen.getByText("ECNs to approve", { selector: "a *, a" }).closest("tr") as HTMLElement;
    expect(ecnRow.querySelector("[data-pending-count]")?.textContent).toBe("—");
    expect(ecnRow.textContent).toContain("unavailable");
  });

  it("đang tải ⇒ bảng với đúng số dòng skeleton của tập; lỗi ⇒ thông báo lỗi trong bảng", () => {
    setQueryOverride(KEY, makeQuery({ isLoading: true }));
    render(<PendingReviewStrip variant="table" categoryFilter={(c) => !c.critical} />);
    expect(document.querySelectorAll("table tbody tr[data-pending-skeleton]")).toHaveLength(5);
    cleanup();
    setQueryOverride(KEY, makeQuery({ isError: true }));
    render(<PendingReviewStrip variant="table" />);
    expect(document.querySelector("table")).not.toBeNull();
    expect(screen.getByText(/Could not load the pending-review summary/i)).toBeInTheDocument();
  });

  it("mặc định (không variant) vẫn là lưới thẻ cũ — không có <table>", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ ecn: ok(1) }) }));
    render(<PendingReviewStrip />);
    expect(document.querySelector("table")).toBeNull();
  });
});

// Task 15 fix 1 (R-2-y) — `pinned`: loại ghim LUÔN hiện, ĐẦU bảng, bất kể categoryFilter.
describe("PendingReviewStrip variant='table' — pinned (R-2-y)", () => {
  it("pinned=critical + filter loại trừ chúng ⇒ 4 dòng khẩn vẫn ở tbody ghim, đứng TRƯỚC tập lọc", () => {
    setQueryOverride(KEY, makeQuery({ data: summary({ safety: ok(2) }) }));
    render(<PendingReviewStrip variant="table" pinned={(c) => c.critical} categoryFilter={(c) => !c.critical} />);
    const pinned = Array.from(document.querySelectorAll("tbody[data-pending-pinned] tr")).map((r) => r.getAttribute("data-pending-row"));
    expect(pinned).toEqual(["recipeActiveUnapproved", "interlockEventsOpen", "safety", "deadlocks"]);
    const all = Array.from(document.querySelectorAll("tbody tr")).map((r) => r.getAttribute("data-pending-row"));
    expect(all.slice(0, 4)).toEqual(pinned);
    expect(all).toHaveLength(9);
    // safety 2 nằm trong tập đang hiện ⇒ KHÔNG "Nothing waiting"
    expect(screen.queryByText(/Nothing waiting/i)).toBeNull();
  });

  it("chưa có dữ liệu, không lỗi, không cờ isLoading ⇒ khung chờ (không bảng rỗng, không số 0)", () => {
    setQueryOverride(KEY, makeQuery({ data: undefined, isLoading: false }));
    render(<PendingReviewStrip variant="table" />);
    expect(document.querySelectorAll("tr[data-pending-skeleton]")).toHaveLength(9);
    expect(document.querySelectorAll("[data-pending-count]")).toHaveLength(0);
  });
});

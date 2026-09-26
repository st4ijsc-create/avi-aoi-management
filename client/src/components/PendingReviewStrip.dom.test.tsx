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

// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho EngineeringWorkspace.tsx (IDE
// `/engineering`). Bằng chứng live 2026-09-25: vài giây đầu màn hình nói "Chưa có dự án",
// badge "Triển khai: OFF" và banner nêu tên biến môi trường `DPC_DEPLOY_ENABLED`, rồi lật
// sang "4 dự án" + "ON" — trạng thái ĐANG TẢI bị hiển thị như SỰ THẬT đã biết. Dựng trang
// THẬT qua @testing-library/react; chỉ mock hạ tầng nặng (DashboardLayout/usePermissions/
// trpc/sonner/socket/copilot context — không mock chính EngineeringWorkspace).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/socketManager", () => ({
  getSharedSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  releaseSharedSocket: vi.fn(),
}));
vi.mock("@/contexts/ProgrammingCopilotContext", () => ({
  useProgrammingCopilot: () => ({ openDock: vi.fn(), closeDock: vi.fn(), open: false, setOpen: vi.fn(), binding: null }),
  useCopilotBinding: () => {},
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number | undefined;
  refetch: () => void;
}
function makeQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: undefined,
    refetch: vi.fn(),
    ...overrides,
  };
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
                useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
              };
            },
          },
        );
      },
    },
  ),
}));

import EngineeringWorkspace from "./EngineeringWorkspace";

// Trang dùng i18next THẬT (không mock react-i18next) — jsdom's `navigator.language` khiến
// i18next-browser-languagedetector chọn "en" trong môi trường test này (bộ ngữ liệu en.json
// nạp xong trong pha "collect" của Vitest trước khi render), nên chuỗi render ra là bản EN,
// không phải defaultValue tiếng Việt truyền trong mã. Khớp CẢ HAI để test không phụ thuộc
// ngôn ngữ nào i18next thực sự chọn trong một môi trường CI khác.
const PROJECTS_LOAD_ERROR_RE = /Không tải được danh sách dự án\.|Could not load the project list\./;
// Exact-match (not substring) — the onboarding panel's `emptyDesc` ("No projects yet.
// Create a DEMO project…") also CONTAINS the short sidebar label as a prefix, so a plain
// substring/regex match finds two elements. Match only the standalone short label.
const isExactNoProjectsLabel = (_content: string, element: Element | null) =>
  element != null
  && element.children.length === 0
  && (element.textContent === "Chưa có dự án" || element.textContent === "No projects yet");

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
});

afterEach(() => {
  cleanup();
});

describe("EngineeringWorkspace (/engineering) — trạng thái đang tải không hiển thị như sự thật (G-07)", () => {
  it("programming.status + listProjects ĐANG TẢI ⇒ KHÔNG 'Chưa có dự án', KHÔNG badge 'OFF', KHÔNG banner tên biến môi trường — hiện skeleton", () => {
    setQueryOverride("programming.status", makeQuery({ isLoading: true }));
    setQueryOverride("programming.listProjects", makeQuery({ isLoading: true }));
    render(<EngineeringWorkspace />);

    expect(screen.queryByText(isExactNoProjectsLabel)).not.toBeInTheDocument();
    expect(screen.queryByText(/OFF/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DPC_DEPLOY_ENABLED/)).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-projects-loading")).toBeInTheDocument();
    // Badge Deploy vẫn hiện (không biến mất) nhưng ở nhãn "đang kiểm tra", không phải ON/OFF.
    expect(screen.getByTestId("engineering-deploy-badge")).toHaveTextContent("…");
  });

  it("programming.status LỖI ⇒ banner lỗi riêng biệt, KHÔNG phải banner tắt thường, badge KHÔNG phải ON/OFF", () => {
    setQueryOverride("programming.status", makeQuery({ isError: true }));
    setQueryOverride("programming.listProjects", makeQuery({ data: [] }));
    render(<EngineeringWorkspace />);

    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-deploy-badge")).not.toHaveTextContent(/^Deploy: ON$/);
    expect(screen.getByTestId("engineering-deploy-badge")).not.toHaveTextContent("OFF");
  });

  it("listProjects LỖI ⇒ 'Không tải được danh sách dự án.' (không phải 'Chưa có dự án')", () => {
    setQueryOverride("programming.status", makeQuery({ data: { deployEnabled: true } }));
    setQueryOverride("programming.listProjects", makeQuery({ isError: true }));
    render(<EngineeringWorkspace />);

    expect(screen.getByText(PROJECTS_LOAD_ERROR_RE)).toBeInTheDocument();
    expect(screen.queryByText(isExactNoProjectsLabel)).not.toBeInTheDocument();
  });

  it("cả hai query xong: cờ TẮT + 0 dự án ⇒ banner thân thiện KHÔNG tên biến, 'Chưa có dự án' hiện đúng lúc, badge OFF", () => {
    setQueryOverride("programming.status", makeQuery({ data: { deployEnabled: false } }));
    setQueryOverride("programming.listProjects", makeQuery({ data: [] }));
    render(<EngineeringWorkspace />);

    const banner = screen.getByTestId("feature-status-off");
    expect(banner.textContent).not.toMatch(/DPC_DEPLOY_ENABLED/);
    expect(screen.getByText(isExactNoProjectsLabel)).toBeInTheDocument();
    expect(screen.getByTestId("engineering-deploy-badge")).toHaveTextContent("OFF");
  });

  it("cả hai query xong: cờ BẬT + có dự án ⇒ không banner off/error/loading, badge ON", () => {
    setQueryOverride("programming.status", makeQuery({ data: { deployEnabled: true } }));
    setQueryOverride(
      "programming.listProjects",
      makeQuery({ data: [{ id: 1, name: "Cell 1", code: "C1", kind: "zmotion-basic" }] }),
    );
    render(<EngineeringWorkspace />);

    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("engineering-deploy-badge")).toHaveTextContent("ON");
    expect(screen.queryByText(isExactNoProjectsLabel)).not.toBeInTheDocument();
  });
});

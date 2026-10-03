// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho EngineeringWorkspace.tsx (IDE
// `/engineering`). Bằng chứng live 2026-09-25: vài giây đầu màn hình nói "Chưa có dự án",
// badge "Triển khai: OFF" và banner nêu tên biến môi trường `DPC_DEPLOY_ENABLED`, rồi lật
// sang "4 dự án" + "ON" — trạng thái ĐANG TẢI bị hiển thị như SỰ THẬT đã biết. Dựng trang
// THẬT qua @testing-library/react; chỉ mock hạ tầng nặng (DashboardLayout/usePermissions/
// trpc/sonner/socket/copilot context — không mock chính EngineeringWorkspace).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// doc 81 Đợt 2 Task 13 — trang dựng EngineeringShell/WorkbenchShell ⇒ nạp bản BROWSER thật của react-resizable-panels
// (layoutKitTestPanels.ts — hạ tầng test, không mock hành vi).
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
  useProgrammingCopilot: () => ({ open: false, setOpen: vi.fn(), binding: null }),
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
// doc 80 Đợt 1 Task 5 — ghi lại đầu vào query + lời gọi mutate để đo luồng duyệt / xem trước deploy.
const queryInputs: Record<string, unknown> = {};
const mutateCalls: Record<string, unknown[]> = {};
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
                useQuery: (input?: unknown) => {
                  queryInputs[key] = input;
                  return queryOverrides[key] ? queryOverrides[key]() : makeQuery();
                },
                useMutation: () => ({
                  mutate: (...args: unknown[]) => { (mutateCalls[key] ??= []).push(args[0]); },
                  // Promise thật: CodeEditor (inline copilot) gọi `.then` khi đã nạp một phiên bản.
                  mutateAsync: vi.fn(() => Promise.resolve(undefined)),
                  isPending: false,
                }),
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
  for (const k of Object.keys(queryInputs)) delete queryInputs[k];
  for (const k of Object.keys(mutateCalls)) delete mutateCalls[k];
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

// ════════════════════════════════════════════════════════════════════════════
// doc 80 Đợt 1 Task 5 — WS-01 (duyệt phiên bản trong IDE) + bản xem trước deploy TRƯỚC OTP.
// ════════════════════════════════════════════════════════════════════════════
const ME = 8;
const PROJECT = { id: 1, name: "Cell 1", code: "C1", kind: "stub", deviceId: null, defaultBranch: "main" };
const artifactRow = (over: Record<string, unknown> = {}) => ({
  id: 11, projectId: 1, branch: "main", version: 1, kind: "stub", language: "text", content: "A\nB",
  status: "draft", reviewStatus: "pending_review", createdBy: 7, diagnosticsJson: null, ...over,
});

function seedWorkspace(o: { reviewOn: boolean; artifact?: Record<string, unknown>; preview?: unknown; builds?: unknown[] }) {
  window.history.pushState({}, "", "/engineering?projectId=1");
  setQueryOverride("auth.me", makeQuery({ data: { id: ME, role: "supervisor", name: "Sup", twoFactorEnabled: false } }));
  setQueryOverride("programming.status", makeQuery({ data: { deployEnabled: true, versionReviewEnabled: o.reviewOn, adapters: [] } }));
  setQueryOverride("programming.listProjects", makeQuery({ data: [PROJECT] }));
  setQueryOverride("programming.listArtifacts", makeQuery({ data: [artifactRow(o.artifact)] }));
  setQueryOverride("programming.listBuilds", makeQuery({ data: o.builds ?? [] }));
  if (o.preview !== undefined) setQueryOverride("programming.deployPreview", makeQuery({ data: o.preview }));
  render(<EngineeringWorkspace />);
  fireEvent.click(screen.getByText(/^v1 · main/));
}

const buildBtn = () => screen.getByRole("button", { name: /^Build$/ });
/**
 * doc 81 Đợt 2 Task 13 — nút Deploy / ô ký duyệt nằm trong WIZARD deploy 4 bước (WizardDialog: Build · Đích & canary ·
 * Ký duyệt · Xem trước & xác nhận). Hàm này chỉ ĐIỀU HƯỚNG tới bước n (mở wizard bằng "Deploy…" nếu chưa mở, rồi
 * Tiếp/Quay lại) — không đổi khẳng định nào của test.
 */
function toWizardStep(n: number) {
  if (!screen.queryByRole("dialog")) fireEvent.click(screen.getByRole("button", { name: /^(Deploy…)$/ }));
  const d = screen.getByRole("dialog");
  for (let guard = 0; guard < 8; guard++) {
    const cur = within(d).getAllByRole("listitem").findIndex((li) => li.getAttribute("aria-current") === "step");
    if (cur === n) return;
    fireEvent.click(within(d).getByRole("button", { name: cur < n ? /^(Next|Tiếp)$/ : /^(Back|Quay lại)$/ }));
  }
  throw new Error(`wizard: không tới được bước ${n}`);
}

describe("WS-01 — duyệt phiên bản trong IDE (cờ versionReviewEnabled)", () => {
  it("cờ TẮT ⇒ KHÔNG một phần tử review nào trong DOM, Build không bị khoá vì review", () => {
    seedWorkspace({ reviewOn: false });
    expect(document.querySelectorAll('[data-testid^="version-review"]').length).toBe(0);
    expect(screen.queryByTestId("build-review-lock")).not.toBeInTheDocument();
    expect(buildBtn()).not.toBeDisabled();
  });

  it("cờ BẬT + phiên bản chờ duyệt của NGƯỜI KHÁC ⇒ chip có trạng thái, nút Duyệt/Từ chối, Build bị khoá KÈM lý do", () => {
    seedWorkspace({ reviewOn: true });
    expect(screen.getAllByTestId("version-review-badge-11").length).toBeGreaterThan(0);
    expect(screen.getByTestId("version-review-approve")).toBeInTheDocument();
    expect(screen.getByTestId("version-review-reject")).toBeInTheDocument();
    expect(screen.queryByTestId("version-review-request")).not.toBeInTheDocument();
    expect(buildBtn()).toBeDisabled();
    expect(screen.getByTestId("build-review-lock")).toBeInTheDocument();
  });

  it("cờ BẬT + tôi là TÁC GIẢ ⇒ chỉ 'Yêu cầu duyệt' (không có nút Duyệt — SoD), bấm ⇒ requestVersionReview", () => {
    seedWorkspace({ reviewOn: true, artifact: { createdBy: ME } });
    expect(screen.queryByTestId("version-review-approve")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("version-review-request"));
    expect(mutateCalls["programming.requestVersionReview"]).toEqual([{ artifactId: 11 }]);
  });

  it("Từ chối BẮT BUỘC lý do: nút xác nhận khoá khi trống; có lý do ⇒ reviewArtifact(rejected, reason)", () => {
    seedWorkspace({ reviewOn: true });
    fireEvent.click(screen.getByTestId("version-review-reject"));
    const confirm = screen.getByTestId("version-review-reject-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("version-review-reject-reason"), { target: { value: "Thiếu interlock" } });
    fireEvent.click(screen.getByTestId("version-review-reject-confirm"));
    expect(mutateCalls["programming.reviewArtifact"]).toEqual([{ artifactId: 11, decision: "rejected", reason: "Thiếu interlock" }]);
  });

  it("final wave R-2-z2: 'Từ chối phiên bản' là SHEET bên phải (không phải Dialog giữa màn), giữ nguyên hợp đồng; Huỷ không gọi server", () => {
    seedWorkspace({ reviewOn: true });
    fireEvent.click(screen.getByTestId("version-review-reject"));
    const reasonBox = screen.getByTestId("version-review-reject-reason");
    expect(reasonBox.closest('[data-slot="sheet-content"]')).not.toBeNull();
    expect(reasonBox.closest('[data-slot="dialog-content"]')).toBeNull();
    // lý do chỉ khoảng trắng vẫn KHOÁ (trim) — đúng hợp đồng cũ
    fireEvent.change(reasonBox, { target: { value: "   " } });
    expect(screen.getByTestId("version-review-reject-confirm")).toBeDisabled();
    const sheet = reasonBox.closest('[data-slot="sheet-content"]') as HTMLElement;
    // nút Huỷ = nút không phải xác nhận ở chân sheet
    const cancel = sheet.querySelector('[data-slot="sheet-footer"] button:not([data-testid])') as HTMLElement;
    fireEvent.click(cancel!);
    expect(screen.queryByTestId("version-review-reject-reason")).not.toBeInTheDocument();
    expect(mutateCalls["programming.reviewArtifact"] ?? []).toEqual([]);
  });

  it("Duyệt ⇒ reviewArtifact(approved); phiên bản ĐÃ duyệt ⇒ Build mở, không còn nút duyệt", () => {
    seedWorkspace({ reviewOn: true });
    fireEvent.click(screen.getByTestId("version-review-approve"));
    expect(mutateCalls["programming.reviewArtifact"]).toEqual([{ artifactId: 11, decision: "approved" }]);
    cleanup();
    seedWorkspace({ reviewOn: true, artifact: { reviewStatus: "approved" } });
    expect(buildBtn()).not.toBeDisabled();
    expect(screen.queryByTestId("build-review-lock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-review-approve")).not.toBeInTheDocument();
  });

  it("phiên bản bị từ chối ⇒ hiện lý do từ chối", () => {
    seedWorkspace({
      reviewOn: true,
      artifact: { reviewStatus: "rejected", diagnosticsJson: { review: { decision: "rejected", reason: "Sai tốc độ trục" } } },
    });
    expect(screen.getByTestId("version-review-reason")).toHaveTextContent("Sai tốc độ trục");
  });
});

describe("F2 — bản xem trước deploy hiện TRƯỚC khi hỏi OTP", () => {
  const blocked = {
    verdict: "blocked",
    gates: [
      { name: "buildOk", ok: true, reason: "buildOk" },
      { name: "adapterPath", ok: false, effect: "block", reason: "techman_program_download_unsupported" },
    ],
    target: { adapterKind: "robot-tm", stage: "staging", deviceId: null, path: "direct", artifactVersion: 1 },
  };

  it("chọn build ⇒ gọi deployPreview với đúng buildId/stage; verdict + từng cổng hiện ngay; verdict 'blocked' ⇒ nút Deploy khoá (không mở hộp OTP)", () => {
    seedWorkspace({ reviewOn: false, preview: blocked, builds: [{ id: 5, ok: true, status: "ok" }] });
    fireEvent.click(screen.getByText("#5"));
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5, stage: "staging" });
    const panel = screen.getByTestId("deploy-preview");
    expect(panel).toHaveAttribute("data-verdict", "blocked");
    expect(screen.getByTestId("deploy-preview-gate-adapterPath")).toHaveAttribute("data-ok", "0");
    toWizardStep(3); // Task 13 — nút Deploy ở bước cuối của wizard
    const deployBtn = screen.getByTestId("engineering-deploy-button");
    expect(deployBtn).toBeDisabled();
    fireEvent.click(deployBtn);
    expect(mutateCalls["programming.deployBuild"]).toBeUndefined();
  });

  it("verdict 'real' ⇒ nút Deploy mở; tick ký duyệt ⇒ preview nhận confirmedBy = chính mình (khớp lượt deploy sắp gửi)", () => {
    const real = { ...blocked, verdict: "real", gates: [{ name: "buildOk", ok: true, reason: "buildOk" }] };
    seedWorkspace({ reviewOn: false, preview: real, builds: [{ id: 5, ok: true, status: "ok" }] });
    fireEvent.click(screen.getByText("#5"));
    expect(screen.getByTestId("deploy-preview")).toHaveAttribute("data-verdict", "real");
    toWizardStep(3); // Task 13 — nút Deploy ở bước cuối của wizard
    expect(screen.getByTestId("engineering-deploy-button")).not.toBeDisabled();
    toWizardStep(2); // ô ký duyệt ở bước "Ký duyệt"
    fireEvent.click(screen.getByTestId("engineering-deploy-signoff"));
    expect(queryInputs["programming.deployPreview"]).toMatchObject({ buildId: 5, stage: "staging", confirmedBy: ME });
  });
});

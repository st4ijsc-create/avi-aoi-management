// @vitest-environment jsdom
//
// doc 80 Đợt 1 Task 9 — interlock VERSION TOKEN phía client: nút "Duyệt"/"Bật" gửi ĐÚNG
// `versionToken` của hàng đang hiển thị (server so dưới FOR UPDATE, lệch ⇒ CONFLICT), và khi
// server trả CONFLICT thì danh sách được tải lại (người duyệt thấy nội dung mới trước khi bấm lại).
// Dựng trang THẬT, chỉ mock hạ tầng nặng (khuôn OrchestrationStudio.dom.test.tsx).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// final wave T11b-7 — bản BROWSER của react-resizable-panels như mọi test trang dựng WorkbenchShell (thiếu ⇒ 7× "Panel size not found").
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true, isAdmin: true }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/trpcErrors", () => ({
  toastTrpcError: vi.fn(),
  mapTrpcError: () => ({ message: "x" }),
}));

interface MutationOpts {
  onSuccess?: (...a: unknown[]) => void;
  onError?: (e: unknown) => void;
}
const mutations: Record<string, { mutate: ReturnType<typeof vi.fn>; opts: MutationOpts }> = {};
const invalidated: string[] = [];
const queryData: Record<string, unknown> = {};

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, routerName: string) {
        if (routerName === "useUtils") {
          return () =>
            new Proxy(
              {},
              {
                get: (_a, r: string) =>
                  new Proxy({}, { get: (_b, p: string) => ({ invalidate: () => { invalidated.push(`${r}.${p}`); } }) }),
              },
            );
        }
        return new Proxy(
          {},
          {
            get(_t2, procName: string) {
              const key = `${routerName}.${procName}`;
              return {
                useQuery: () => makeQuery(queryData[key]),
                useMutation: (opts: MutationOpts = {}) => {
                  const m = (mutations[key] ??= { mutate: vi.fn(), opts });
                  m.opts = opts;
                  return { mutate: m.mutate, mutateAsync: vi.fn(), isPending: false };
                },
              };
            },
          },
        );
      },
    },
  ),
}));

import InterlockRuleManagement from "./InterlockRuleManagement";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

function rule(id: number, over: Record<string, unknown>) {
  return {
    id, name: `rule-${id}`, description: null, scope: "machine", lineId: null, stationId: null, machineId: null,
    sourceType: "ng_rate", sourceKey: null, comparisonOperator: "gt", threshold: "5.000000",
    windowSize: null, consecutiveCount: null, windowSeconds: null, action: "stop_line",
    targetMachineId: 1, targetAdapterId: null, commandTag: "line_stop", commandValue: null,
    requiresHumanConfirm: true, enabled: false, approvedBy: null, approvedAt: null, cooldownSeconds: 300,
    lastFiredAt: null, createdBy: 1, createdAt: new Date("2026-09-27T00:00:00Z"),
    updatedAt: new Date("2026-09-27T00:00:00Z"), updatedBy: 1,
    ...over,
  };
}

// ORACLE: token khai tay theo fixture — không suy bằng hàm nào của trang.
const PENDING = rule(41, { versionToken: "v1:token-hang-41-dang-hien-thi" });
const APPROVED = rule(42, { approvedBy: 9, approvedAt: new Date(), versionToken: "v1:token-hang-42-da-duyet" });
// Task 11 — nhánh "đang BẬT" của điều kiện OR (`approvedBy != null || enabled`) độc lập với nhánh
// "đã DUYỆT": approvedBy null nhưng enabled=true (hàng seed/ghi thẳng — không đại diện luồng
// approve→enable bình thường, nhưng điều kiện cảnh báo ở component đọc ĐÚNG NHƯ VIẾT, cả hai vế).
const ENABLED_ONLY = rule(43, { approvedBy: null, enabled: true, versionToken: "v1:token-hang-43-dang-bat" });

beforeEach(() => {
  for (const k of Object.keys(mutations)) delete mutations[k];
  invalidated.length = 0;
  queryData["interlock.list"] = [PENDING, APPROVED, ENABLED_ONLY];
  queryData["interlock.events"] = [];
  // Doc 81 Đợt 2 Task 5 — sheet sửa giờ là flyout có URL (`?flyout=rule&flyoutId=`, URL là nguồn sự thật):
  // trả URL về trang trống trước mỗi ca để sheet của ca trước không mở lại như một deep-link.
  window.history.replaceState(null, "", "/interlock-rules");
});
afterEach(() => cleanup());

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("InterlockRuleManagement — Task 9: approve/enable gửi token của hàng đang hiển thị", () => {
  it("Duyệt ⇒ approve.mutate({ id, expectedVersion: versionToken của CHÍNH hàng đó })", () => {
    render(<InterlockRuleManagement />);
    fireEvent.click(within(rowOf("rule-41")).getByRole("button", { name: /interlockRules\.approve|Duyệt|Approve/i }));
    expect(mutations["interlock.approve"].mutate).toHaveBeenCalledWith({ id: 41, expectedVersion: "v1:token-hang-41-dang-hien-thi" });
  });

  it("Bật ⇒ enable.mutate({ id, expectedVersion: versionToken của bản ĐÃ duyệt đang hiển thị })", () => {
    render(<InterlockRuleManagement />);
    fireEvent.click(within(rowOf("rule-42")).getByRole("button", { name: /interlockRules\.enable|Bật|Enable/i }));
    expect(mutations["interlock.enable"].mutate).toHaveBeenCalledWith({ id: 42, expectedVersion: "v1:token-hang-42-da-duyet" });
  });

  it("server trả CONFLICT (rule đã bị sửa) ⇒ tải lại danh sách; lỗi khác ⇒ không", () => {
    render(<InterlockRuleManagement />);
    mutations["interlock.approve"].opts.onError?.({ data: { code: "FORBIDDEN" } });
    expect(invalidated).not.toContain("interlock.list");
    mutations["interlock.approve"].opts.onError?.({ data: { code: "CONFLICT" } });
    expect(invalidated).toContain("interlock.list");
    invalidated.length = 0;
    mutations["interlock.enable"].opts.onError?.({ data: { code: "CONFLICT" } });
    expect(invalidated).toContain("interlock.list");
  });
});

describe("InterlockRuleManagement — Task 11: cảnh báo TRƯỚC khi lưu rule đã duyệt/đang bật", () => {
  const clickEdit = (rowName: string) =>
    fireEvent.click(within(rowOf(rowName)).getByRole("button", { name: /interlockRules\.editRule|Sửa quy tắc|Edit rule/i }));

  it("Sửa rule ĐÃ DUYỆT (rule-42) ⇒ dialog hiện cảnh báo trước khi Lưu", () => {
    render(<InterlockRuleManagement />);
    clickEdit("rule-42");
    expect(screen.getByTestId("edit-approved-warning")).toBeInTheDocument();
  });

  it("Sửa rule ĐANG BẬT nhưng chưa duyệt (rule-43) ⇒ dialog vẫn hiện cảnh báo (nhánh OR thứ hai)", () => {
    render(<InterlockRuleManagement />);
    clickEdit("rule-43");
    expect(screen.getByTestId("edit-approved-warning")).toBeInTheDocument();
  });

  it("Sửa rule CHƯA DUYỆT + CHƯA BẬT (rule-41) ⇒ KHÔNG hiện cảnh báo", () => {
    render(<InterlockRuleManagement />);
    clickEdit("rule-41");
    expect(screen.queryByTestId("edit-approved-warning")).not.toBeInTheDocument();
  });

  it("Tạo rule MỚI (không phải sửa) ⇒ KHÔNG hiện cảnh báo dù dialog Sửa vừa mới đóng ở trạng thái cảnh báo", async () => {
    render(<InterlockRuleManagement />);
    // Đóng dialog Sửa trước (Escape — Radix Dialog gọi onOpenChange(false), khớp cách người
    // dùng thật đóng dialog): nút "Thêm quy tắc" ở NGOÀI dialog bị `aria-hidden` khi modal mở.
    clickEdit("rule-42");
    expect(screen.getByTestId("edit-approved-warning")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    // Doc 81 Đợt 2 Task 5 — sheet đóng bằng lùi lịch sử (popstate bất đồng bộ) ⇒ chờ nút hết `aria-hidden`.
    fireEvent.click(await screen.findByRole("button", { name: /interlockRules\.newRule|Thêm quy tắc|New rule/i }));
    expect(screen.queryByTestId("edit-approved-warning")).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SCADA R0.1 (2026-10-24, kiem-dinh P1-2) — (a) "Khi thiếu dữ liệu" sửa được; (b) telemetry_tag chỉ ở phạm vi Máy (D11).
// Trang dựng THẬT; Radix Select mở bằng click (pointerType mặc định ≠ mouse), như ChangeoverQueue.dom.test.tsx.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("InterlockRuleManagement — R0.1: khiThieuDuLieu + telemetry_tag chỉ phạm vi Máy", () => {
  // i18next THẬT với vi.json (như bộ layout kit): câu tiếng Việt phải đến từ KHOÁ trong vi.json, không phải chuỗi dự phòng.
  beforeAll(async () => {
    await initLayoutKitTestI18n();
  });
  beforeEach(() => {
    Element.prototype.scrollIntoView ??= function () {};
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture ??= () => false;
    (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture ??= () => {};
    queryData["interlock.list"] = [
      PENDING, APPROVED, ENABLED_ONLY,
      // Hàng CŨ hỏng cấu trúc (ghi thẳng bảng / trước vá) — form phải nói rõ lý do và chặn Lưu.
      rule(51, { name: "tag-thieu-may", sourceType: "telemetry_tag", sourceKey: "nhiet_do", machineId: null, versionToken: "v1:51" }),
      rule(52, { name: "tag-thieu-ten", sourceType: "telemetry_tag", sourceKey: null, machineId: 5, versionToken: "v1:52" }),
      rule(53, { name: "tag-pham-vi-line", scope: "line", lineId: 2, sourceType: "telemetry_tag", sourceKey: "nhiet_do", machineId: 5, versionToken: "v1:53" }),
      rule(54, { name: "tag-cho-qua", sourceType: "telemetry_tag", sourceKey: "nhiet_do", machineId: 5, khiThieuDuLieu: "cho_qua", versionToken: "v1:54" }),
    ];
  });

  const openEdit = (rowName: string) =>
    fireEvent.click(within(rowOf(rowName)).getByRole("button", { name: /interlockRules\.editRule|Sửa quy tắc|Edit rule/i }));
  const openNew = () => fireEvent.click(screen.getByRole("button", { name: /interlockRules\.newRule|Thêm quy tắc|New rule/i }));
  const combo = (name: RegExp) => screen.getByRole("combobox", { name });
  const pick = (comboName: RegExp, option: RegExp) => {
    fireEvent.click(combo(comboName));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };
  const SCOPE = /interlockRules\.scope|Phạm vi|Scope/i;
  const SOURCE = /interlockRules\.sourceType|Loại nguồn|Source type/i;
  const KHI = /Khi thiếu dữ liệu|When data is missing/i;
  const saveBtn = () => screen.getByRole("button", { name: /^(interlockRules\.save|Lưu|Save)$/i });

  it("telemetry_tag CHỈ có trong danh sách nguồn khi phạm vi = Máy", () => {
    render(<InterlockRuleManagement />);
    openNew();
    fireEvent.click(combo(SOURCE));
    expect(screen.getByRole("option", { name: "telemetry_tag" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("option", { name: "telemetry_tag" }), { key: "Escape" });
    pick(SCOPE, /^line$/);
    fireEvent.click(combo(SOURCE));
    expect(screen.queryByRole("option", { name: "telemetry_tag" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ng_rate" })).toBeInTheDocument();
  });

  it("đã chọn telemetry_tag rồi đổi phạm vi sang Trạm ⇒ lý do inline 'phạm vi phải là Máy' + Lưu bị chặn", () => {
    render(<InterlockRuleManagement />);
    openNew();
    fireEvent.change(screen.getByLabelText(/interlockRules\.name|^Tên|Name/i), { target: { value: "moi" } });
    pick(SOURCE, /^telemetry_tag$/);
    pick(SCOPE, /^station$/);
    expect(screen.getByTestId("telemetry-cau-hinh-ly-do")).toHaveTextContent(/phạm vi phải là Máy/);
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(saveBtn());
    expect(mutations["interlock.create"]?.mutate ?? vi.fn()).not.toHaveBeenCalled();
  });

  it.each([
    ["tag-thieu-may", /Luật nguồn tag thiết bị phải gắn một máy và một tên tag — thiếu máy/],
    ["tag-thieu-ten", /Luật nguồn tag thiết bị phải gắn một máy và một tên tag — thiếu tên tag/],
    ["tag-pham-vi-line", /phạm vi phải là Máy/],
  ])("hàng cũ %s ⇒ lý do inline tiếng Việt cạnh trường + Lưu bị chặn (không đợi toast FIELD_REQUIRED của server)", (name, lyDo) => {
    render(<InterlockRuleManagement />);
    openEdit(name);
    expect(screen.getByTestId("telemetry-cau-hinh-ly-do")).toHaveTextContent(lyDo);
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(saveBtn());
    expect(mutations["interlock.update"]?.mutate ?? vi.fn()).not.toHaveBeenCalled();
  });

  it("luật telemetry_tag hợp lệ (phạm vi Máy, đủ máy + tag) ⇒ không có lý do, Lưu được", () => {
    render(<InterlockRuleManagement />);
    openEdit("tag-cho-qua");
    expect(screen.queryByTestId("telemetry-cau-hinh-ly-do")).not.toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it("form có 'Khi thiếu dữ liệu' + câu giải thích; chọn 'Cho qua' ⇒ create gửi khiThieuDuLieu='cho_qua' (mặc định 'chan')", () => {
    render(<InterlockRuleManagement />);
    openNew();
    expect(combo(KHI)).toHaveTextContent(/Chặn \(an toàn — mặc định\)/);
    expect(screen.getByTestId("khi-thieu-du-lieu-giai-thich")).toHaveTextContent(
      /Cho qua.*lệnh đi qua.*không có dữ liệu tốt, mới.*mất duyệt và tắt luật.*admin duyệt lại/,
    );
    fireEvent.change(screen.getByLabelText(/interlockRules\.name|^Tên|Name/i), { target: { value: "moi" } });
    fireEvent.click(combo(KHI));
    expect(screen.getByRole("option", { name: "Chặn (an toàn — mặc định)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Cho qua (cần duyệt lại)" }));
    fireEvent.click(saveBtn());
    expect(mutations["interlock.create"].mutate).toHaveBeenCalledWith(expect.objectContaining({ khiThieuDuLieu: "cho_qua" }));
  });

  it("sửa hàng 'cho_qua' ⇒ control hiện giá trị hiện tại; đổi về 'Chặn' ⇒ update gửi khiThieuDuLieu='chan'", () => {
    render(<InterlockRuleManagement />);
    openEdit("tag-cho-qua");
    expect(combo(KHI)).toHaveTextContent(/Cho qua \(cần duyệt lại\)/);
    pick(KHI, /^Chặn \(an toàn — mặc định\)$/);
    fireEvent.click(saveBtn());
    expect(mutations["interlock.update"].mutate).toHaveBeenCalledWith(expect.objectContaining({ id: 54, khiThieuDuLieu: "chan" }));
  });

  it("danh sách hiện giá trị hiện tại của khiThieuDuLieu trên từng hàng", () => {
    render(<InterlockRuleManagement />);
    expect(within(rowOf("tag-cho-qua")).getByTestId("khi-thieu-du-lieu")).toHaveTextContent(/cho qua/i);
    // hàng không mang trường (fixture cũ) ⇒ mặc định chặn.
    expect(within(rowOf("rule-41")).getByTestId("khi-thieu-du-lieu")).toHaveTextContent(/chặn/i);
  });
});

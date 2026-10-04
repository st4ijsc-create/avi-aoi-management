// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — VersionHistoryPanel + JsonDiffView: thay 4 bản viết lại "danh sách phiên
// bản + so sánh 2 bản + khôi phục" (Workspace, Recipes, Orchestration, EqIntegration).
// Hợp đồng: 4 trạng thái của danh sách (đang tải / lỗi / trống / có dữ liệu — không gộp lỗi vào
// trống); chọn bản Gốc và bản So với bằng radio (bàn phím được); mặc định gốc = bản thứ hai (hoặc
// `defaultBaseId`, vd bản Golden của Recipes), so với = bản mới nhất; hành động mỗi hàng do trang cấp
// (RollbackConfirm của trang).
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { JsonDiffView } from "./JsonDiffView";
import { VersionHistoryPanel, type VersionRow } from "./VersionHistoryPanel";

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

const rows: VersionRow[] = [
  { id: 3, label: "v3", current: true, content: { speed: 30, temp: 250, mode: "auto" } },
  { id: 2, label: "v2", content: { speed: 25, temp: 250, mode: "auto" } },
  { id: 1, label: "v1", content: { speed: 20, temp: 240 } },
];

describe("JsonDiffView", () => {
  it("JSON được in đẹp rồi diff theo dòng; đếm +/−; có nhãn hai bản", () => {
    render(<JsonDiffView left={{ a: 1, b: 2 }} right={{ a: 1, b: 3 }} leftLabel="v1" rightLabel="v2" />);
    const region = screen.getByRole("region", { name: "Khác biệt giữa v1 và v2" });
    expect(within(region).getByText("+1")).toBeInTheDocument();
    expect(within(region).getByText("−1")).toBeInTheDocument();
    expect(region).toHaveTextContent('"b": 3');
  });
  it("giống nhau ⇒ báo 'giống nhau' (khoá diff.identical)", () => {
    render(<JsonDiffView left={{ a: 1 }} right={{ a: 1 }} leftLabel="v1" rightLabel="v2" />);
    expect(screen.getByText(vi.diff.identical)).toBeInTheDocument();
  });
  it("chuỗi JSON cũng được in đẹp; mode=text giữ nguyên văn", () => {
    const { unmount } = render(<JsonDiffView left={'{"a":1}'} right={'{"a":2}'} leftLabel="A" rightLabel="B" />);
    expect(screen.getByRole("region")).toHaveTextContent('"a": 2');
    unmount();
    render(<JsonDiffView mode="text" left={"x = 1"} right={"x = 2"} leftLabel="A" rightLabel="B" />);
    expect(screen.getByRole("region")).toHaveTextContent("x = 2");
  });
});

describe("VersionHistoryPanel — trạng thái danh sách", () => {
  it("đang tải ⇒ chữ đang tải, không bảng, không báo trống", () => {
    render(<VersionHistoryPanel versions={undefined} status="loading" />);
    expect(screen.getByText(vi.layoutKit.versions.loading)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(vi.layoutKit.versions.empty)).toBeNull();
  });
  it("lỗi ⇒ role=alert, KHÔNG báo 'chưa có phiên bản'", () => {
    render(<VersionHistoryPanel versions={[]} status="error" />);
    expect(screen.getByRole("alert")).toHaveTextContent(vi.layoutKit.versions.error);
    expect(screen.queryByText(vi.layoutKit.versions.empty)).toBeNull();
  });
  it("trống ⇒ EmptyState 'Chưa có phiên bản nào.'", () => {
    render(<VersionHistoryPanel versions={[]} status="ready" />);
    expect(screen.getByText(vi.layoutKit.versions.empty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("VersionHistoryPanel — chọn hai bản và diff", () => {
  it("mặc định: gốc = v2, so với = v3 (mới nhất); diff giữa hai bản đó", () => {
    render(<VersionHistoryPanel versions={rows} status="ready" />);
    expect(screen.getByRole("radio", { name: "Chọn v2 làm bản gốc" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "So sánh với v3" })).toBeChecked();
    const region = screen.getByRole("region", { name: "Khác biệt giữa v2 và v3" });
    expect(region).toHaveTextContent('"speed": 30');
  });

  it("defaultBaseId (vd bản Golden) thắng mặc định", () => {
    render(<VersionHistoryPanel versions={rows} status="ready" defaultBaseId={1} />);
    expect(screen.getByRole("radio", { name: "Chọn v1 làm bản gốc" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Khác biệt giữa v1 và v3" })).toBeInTheDocument();
  });

  it("đổi radio gốc ⇒ diff đổi theo; chọn cùng một bản ⇒ báo, không diff", () => {
    render(<VersionHistoryPanel versions={rows} status="ready" />);
    fireEvent.click(screen.getByRole("radio", { name: "Chọn v1 làm bản gốc" }));
    expect(screen.getByRole("region", { name: "Khác biệt giữa v1 và v3" })).toHaveTextContent('"mode": "auto"');
    fireEvent.click(screen.getByRole("radio", { name: "Chọn v3 làm bản gốc" }));
    expect(screen.getByText(vi.layoutKit.versions.sameVersion)).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("chỉ một phiên bản ⇒ nhắc chọn 2 bản, không diff", () => {
    render(<VersionHistoryPanel versions={[rows[0]]} status="ready" />);
    expect(screen.getByText(vi.layoutKit.versions.pickTwo)).toBeInTheDocument();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("bản đang dùng có nhãn; hành động mỗi hàng do trang cấp và nhận đúng hàng", () => {
    const seen: Array<string | number> = [];
    render(
      <VersionHistoryPanel
        versions={rows}
        status="ready"
        renderRowActions={(v) => {
          seen.push(v.id);
          return <button type="button">Khôi phục {v.label}</button>;
        }}
      />,
    );
    const row3 = screen.getByRole("row", { name: /v3/ });
    expect(within(row3).getByText(vi.layoutKit.versions.current)).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /v1/ })).getByRole("button", { name: "Khôi phục v1" })).toBeInTheDocument();
    expect(seen).toEqual(expect.arrayContaining([3, 2, 1]));
  });

  it("radio nằm trong hai nhóm riêng (gốc / so với) để điều khiển bằng bàn phím", () => {
    render(<VersionHistoryPanel versions={rows} status="ready" />);
    const base = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).name.endsWith("-base"));
    const cmp = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).name.endsWith("-compare"));
    expect(base).toHaveLength(3);
    expect(cmp).toHaveLength(3);
  });
});

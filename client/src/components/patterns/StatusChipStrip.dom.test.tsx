// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — StatusChipStrip: dải chip 32 px thay thẻ KPI 130–146 px. Luật trung
// thực của Đợt 1 (PendingReviewStrip HUB-01, FeatureStatusGate): KHÔNG BAO GIỜ in số 0 khi nguồn
// thực chất lỗi/đang tải; nguồn đọc được một phần (degraded) phải lộ ra. Bốn trạng thái của chip:
// ok / loading / error / degraded — mỗi chip mang NGUỒN của con số.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { StatusChipStrip, chipStateFromQuery, type StatusChipItem } from "./StatusChipStrip";

beforeAll(async () => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

function chip(id: string): HTMLElement {
  const el = document.querySelector(`[data-chip-id="${id}"]`);
  if (!el) throw new Error(`chip ${id} not found`);
  return el as HTMLElement;
}

const base: StatusChipItem[] = [
  { id: "ok", label: "Đang chạy", value: 12, state: "ok", source: "fleet.tasks (DB)" },
  { id: "loading", label: "Chờ sạc", value: 0, state: "loading", source: "fleet.chargers" },
  { id: "error", label: "Cảnh báo", value: 0, state: "error", source: "safety.events" },
  { id: "degraded", label: "Chờ duyệt", value: 3, state: "degraded", source: "oversight.pendingSummary" },
];

describe("StatusChipStrip — 4 trạng thái của chip", () => {
  it("ok ⇒ hiện số, data-state=ok", () => {
    render(<StatusChipStrip items={base} />);
    const c = chip("ok");
    expect(c).toHaveAttribute("data-state", "ok");
    expect(within(c).getByText("12")).toBeInTheDocument();
  });

  it("loading ⇒ KHÔNG in số (kể cả value=0 truyền vào), có nhãn 'Đang tải', aria-busy", () => {
    render(<StatusChipStrip items={base} />);
    const c = chip("loading");
    expect(c).toHaveAttribute("data-state", "loading");
    expect(c).toHaveAttribute("aria-busy", "true");
    expect(c).not.toHaveTextContent(/\b0\b/);
    expect(c).toHaveTextContent(vi.layoutKit.chip.loading);
  });

  it("error ⇒ KHÔNG in số 0, in 'Lỗi', tooltip nói không đọc được nguồn", () => {
    render(<StatusChipStrip items={base} />);
    const c = chip("error");
    expect(c).toHaveAttribute("data-state", "error");
    expect(c).not.toHaveTextContent(/\b0\b/);
    expect(c).toHaveTextContent(vi.layoutKit.chip.error);
    expect(c.getAttribute("title")).toContain(vi.layoutKit.chip.errorHint);
  });

  it("degraded ⇒ vẫn in số nhưng đánh dấu (≥ / tooltip một phần) — không giả là đủ", () => {
    render(<StatusChipStrip items={base} />);
    const c = chip("degraded");
    expect(c).toHaveAttribute("data-state", "degraded");
    expect(c).toHaveTextContent("≥3");
    expect(c.getAttribute("title")).toContain(vi.layoutKit.chip.degradedHint);
  });

  it("ok nhưng value null/undefined ⇒ coi là LỖI, không in số và không in rỗng giả 0", () => {
    render(
      <StatusChipStrip
        items={[
          { id: "n", label: "A", value: null, state: "ok", source: "x" },
          { id: "u", label: "B", value: undefined, state: "ok", source: "y" },
        ]}
      />,
    );
    for (const id of ["n", "u"]) {
      expect(chip(id)).toHaveAttribute("data-state", "error");
      expect(chip(id)).toHaveTextContent(vi.layoutKit.chip.error);
    }
  });

  it("mọi chip mang nguồn số (title + mô tả cho trình đọc màn hình)", () => {
    render(<StatusChipStrip items={base} />);
    for (const it of base) {
      const c = chip(it.id);
      expect(c.getAttribute("title")).toContain(`Nguồn: ${it.source}`);
      expect(c).toHaveAccessibleDescription(expect.stringContaining(`Nguồn: ${it.source}`));
    }
  });
});

describe("StatusChipStrip — dấu đo và kích thước", () => {
  it("mỗi chip mang data-layout-kpi và cao 32 px (≥28 px theo thiết bị đo)", () => {
    render(<StatusChipStrip items={base} />);
    const kpis = document.querySelectorAll("[data-layout-kpi]");
    expect(kpis).toHaveLength(4);
    kpis.forEach((k) => expect((k as HTMLElement).style.height).toBe("32px"));
  });

  it("Đợt 2 Task 7 — mô tả sr-only (position:absolute) nằm trong chip ĐỊNH VỊ ⇒ chip bị header/dải cắt không đẩy trang rộng ra (390 px: docW 615)", () => {
    render(<StatusChipStrip items={base} />);
    for (const k of document.querySelectorAll("[data-layout-kpi]")) {
      expect((k as HTMLElement).className.split(/\s+/)).toContain("relative");
      expect(k.querySelector(".sr-only")).toBeTruthy();
    }
  });

  it("dải là MỘT hàng có nhãn nhóm; chip bấm được là nút", () => {
    let clicked = "";
    render(
      <StatusChipStrip
        ariaLabel="Chỉ số đội xe"
        items={[{ id: "c", label: "Đang chạy", value: 5, state: "ok", source: "s", onClick: () => { clicked = "c"; } }]}
      />,
    );
    const g = screen.getByRole("group", { name: "Chỉ số đội xe" });
    expect(g.className).toMatch(/flex-nowrap/);
    within(g).getByRole("button").click();
    expect(clicked).toBe("c");
  });
});

describe("chipStateFromQuery — suy trạng thái từ query, không đoán", () => {
  it("đang tải ⇒ loading", () => {
    expect(chipStateFromQuery({ data: undefined, isLoading: true })).toBe("loading");
    expect(chipStateFromQuery({ data: undefined, isPending: true })).toBe("loading");
  });
  it("data undefined dù không cờ nào ⇒ loading (không đoán ok)", () => {
    expect(chipStateFromQuery({ data: undefined })).toBe("loading");
  });
  it("lỗi ⇒ error, kể cả khi còn data cũ trong cache", () => {
    expect(chipStateFromQuery({ data: { n: 1 }, isError: true })).toBe("error");
  });
  it("degraded do caller chỉ ra ⇒ degraded", () => {
    expect(chipStateFromQuery({ data: { degraded: true } }, (d) => d.degraded)).toBe("degraded");
  });
  it("có data, không degraded ⇒ ok", () => {
    expect(chipStateFromQuery({ data: { degraded: false } }, (d) => d.degraded)).toBe("ok");
  });
});

// ── Fix round 1 (review minor) — tràn ở 1366 px KHÔNG được giấu chip lỗi ──────────────────────────
describe("StatusChipStrip — tràn vào '+N', lỗi luôn hiện", () => {
  const many: StatusChipItem[] = [
    { id: "a", label: "A", value: 1, state: "ok", source: "s" },
    { id: "b", label: "B", value: 2, state: "ok", source: "s" },
    { id: "c", label: "C", value: 3, state: "ok", source: "s" },
    { id: "d", label: "D", value: 4, state: "loading", source: "s" },
    { id: "e", label: "E", value: 5, state: "ok", source: "s" },
    { id: "f", label: "F", value: 6, state: "degraded", source: "s" },
    { id: "g", label: "G", value: 0, state: "error", source: "s" },
  ];

  it("maxVisible=3: chip lỗi (cuối danh sách) VẪN hiện, rồi degraded; phần còn lại vào '+N' mở được", async () => {
    render(<StatusChipStrip items={many} maxVisible={3} />);
    const strip = screen.getByRole("group", { name: vi.layoutKit.chip.stripLabel });
    const shown = [...strip.querySelectorAll("[data-chip-id]")].map((x) => x.getAttribute("data-chip-id"));
    expect(shown).toContain("g");
    expect(shown).toContain("f");
    expect(shown).toHaveLength(3);
    const more = within(strip).getByRole("button", { name: "Xem thêm 4 chỉ số" });
    expect(more).toHaveTextContent("+4");
    fireEvent.click(more);
    const pop = await screen.findByRole("dialog");
    expect(pop.querySelectorAll("[data-chip-id]")).toHaveLength(4);
  });

  it("thứ tự hiển thị giữ nguyên thứ tự gốc của các chip được chọn", () => {
    render(<StatusChipStrip items={many} maxVisible={4} />);
    const shown = [...document.querySelectorAll("[data-status-chip-strip] > [data-chip-id]")].map((x) => x.getAttribute("data-chip-id"));
    expect(shown).toEqual(["a", "d", "f", "g"]);
  });

  it("nhiều lỗi hơn chỗ ⇒ chip '+N' mang trạng thái lỗi (không giấu lỗi trong chip trung tính)", () => {
    const errs: StatusChipItem[] = ["p", "q", "r", "s"].map((id) => ({ id, label: id, value: 0, state: "error", source: "x" }));
    render(<StatusChipStrip items={errs} maxVisible={2} />);
    const more = screen.getByRole("button", { name: "Xem thêm 2 chỉ số" });
    expect(more).toHaveAttribute("data-state", "error");
  });

  it("không vượt maxVisible ⇒ không có chip '+N'", () => {
    render(<StatusChipStrip items={many.slice(0, 3)} maxVisible={3} />);
    expect(screen.queryByRole("button", { name: /Xem thêm/ })).toBeNull();
  });
});

// ── Ruling R-2-p (Đợt 2 Task 8 fix round 1) — chip GHIM không bao giờ vào "+N"; "+N" mang trạng thái/tông
//    TỆ NHẤT của các chip bị giấu (không bao giờ trung tính khi trong đó có cảnh báo/lỗi). ─────────────
describe("StatusChipStrip — R-2-p: chip ghim + '+N' mang trạng thái tệ nhất", () => {
  const strip = () => screen.getByRole("group", { name: vi.layoutKit.chip.stripLabel });
  const shownIds = () => [...strip().querySelectorAll(":scope > [data-chip-id]")].map((x) => x.getAttribute("data-chip-id"));

  it("chip ghim luôn hiện dù các chip KHÔNG ghim đang lỗi/đang tải và chỗ chỉ đủ cho số chip ghim", () => {
    const items: StatusChipItem[] = [
      { id: "safe1", label: "Chưa kiểm định", value: 3, state: "ok", tone: "warning", source: "s", pinned: true },
      { id: "safe2", label: "Suýt sự cố", value: 1, state: "ok", tone: "warning", source: "s", pinned: true },
      { id: "w1", label: "Phân công", value: 0, state: "error", source: "s" },
      { id: "w2", label: "Phối hợp", value: 0, state: "loading", source: "s" },
    ];
    render(<StatusChipStrip items={items} maxVisible={2} />);
    expect(shownIds()).toEqual(["safe1", "safe2"]);
    const more = within(strip()).getByRole("button", { name: "Xem thêm 2 chỉ số" });
    // Phần giấu có lỗi ⇒ "+2" là lỗi.
    expect(more).toHaveAttribute("data-state", "error");
    expect(more.className).toMatch(/destructive/);
  });

  it("số chip ghim vượt maxVisible ⇒ vẫn hiện HẾT chip ghim (không cắt chip ghim nào)", () => {
    const items: StatusChipItem[] = ["a", "b", "c"].map((id) => ({ id, label: id, value: 1, state: "ok", source: "s", pinned: true }));
    render(<StatusChipStrip items={[...items, { id: "z", label: "z", value: 1, state: "error", source: "s" }]} maxVisible={2} />);
    expect(shownIds()).toEqual(["a", "b", "c"]);
    expect(within(strip()).getByRole("button", { name: "Xem thêm 1 chỉ số" })).toHaveAttribute("data-state", "error");
  });

  it("chip giấu có tông CẢNH BÁO (state ok) ⇒ '+N' mang cảnh báo, không trung tính", () => {
    const items: StatusChipItem[] = [
      { id: "a", label: "A", value: 1, state: "ok", source: "s" },
      { id: "b", label: "B", value: 5, state: "ok", tone: "warning", source: "s" },
    ];
    render(<StatusChipStrip items={items} maxVisible={1} />);
    const more = within(strip()).getByRole("button", { name: "Xem thêm 1 chỉ số" });
    expect(more).toHaveAttribute("data-state", "warning");
    expect(more.className).toMatch(/warning/);
    expect(more.className).not.toMatch(/text-muted-foreground/);
  });

  it("chip giấu DEGRADED ⇒ '+N' mang cảnh báo; chip giấu tông LỖI (state ok) ⇒ '+N' mang lỗi", () => {
    // degraded vốn được ưu tiên hiện; một chip ghim ok chiếm chỗ duy nhất ⇒ degraded + tông lỗi vào phần giấu.
    render(
      <StatusChipStrip
        items={[
          { id: "p", label: "P", value: 1, state: "ok", source: "s", pinned: true },
          { id: "b", label: "B", value: 5, state: "degraded", source: "s" },
          { id: "e", label: "E", value: 2, state: "ok", tone: "error", source: "s" },
        ]}
        maxVisible={1}
      />,
    );
    expect(shownIds()).toEqual(["p"]);
    expect(within(strip()).getByRole("button", { name: "Xem thêm 2 chỉ số" })).toHaveAttribute("data-state", "error");
    cleanup();
    render(
      <StatusChipStrip
        items={[
          { id: "p", label: "P", value: 1, state: "ok", source: "s", pinned: true },
          { id: "b", label: "B", value: 5, state: "degraded", source: "s" },
        ]}
        maxVisible={1}
      />,
    );
    expect(within(strip()).getByRole("button", { name: "Xem thêm 1 chỉ số" })).toHaveAttribute("data-state", "warning");
  });

  it("phần giấu chỉ có chip ok/trung tính ⇒ '+N' trung tính (ok); chỉ có loading ⇒ 'loading', không giả ok", () => {
    render(<StatusChipStrip items={[{ id: "a", label: "A", value: 1, state: "ok", source: "s" }, { id: "b", label: "B", value: 2, state: "ok", tone: "success", source: "s" }]} maxVisible={1} />);
    expect(within(strip()).getByRole("button", { name: "Xem thêm 1 chỉ số" })).toHaveAttribute("data-state", "ok");
    cleanup();
    render(<StatusChipStrip items={[{ id: "p", label: "P", value: 1, state: "ok", source: "s", pinned: true }, { id: "l", label: "L", value: 0, state: "loading", source: "s" }]} maxVisible={1} />);
    expect(within(strip()).getByRole("button", { name: "Xem thêm 1 chỉ số" })).toHaveAttribute("data-state", "loading");
  });
});

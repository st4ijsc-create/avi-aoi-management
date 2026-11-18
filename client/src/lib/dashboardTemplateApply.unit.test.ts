import { describe, it, expect, vi, afterEach } from "vitest";
import { templateToCustomDashboardWidgets } from "./dashboardTemplateApply";
import type { TemplateLayoutItem } from "./dashboardTemplateApply";

type PhanTuThieuXY = Omit<TemplateLayoutItem, "x" | "y">;

afterEach(() => {
  vi.useRealTimers();
});

/* ──────────────────────────────────────────────
   1. Trả về [] với {}, với widgets: [] và với layout: []
   ────────────────────────────────────────────── */
describe("trường hợp rỗng", () => {
  it("{} → []", () => {
    const result = templateToCustomDashboardWidgets({});
    expect(result).toEqual([]);
  });

  it("widgets: [] → []", () => {
    const result = templateToCustomDashboardWidgets({ widgets: [] });
    expect(result).toEqual([]);
  });

  it("layout: [] → []", () => {
    const result = templateToCustomDashboardWidgets({ layout: [] });
    expect(result).toEqual([]);
  });
});

/* ──────────────────────────────────────────────
   2. layout rỗng nhưng widgets có phần tử → dùng widgets
   ────────────────────────────────────────────── */
describe("layout rỗng, widgets có phần tử", () => {
  it("dùng widgets khi layout = []", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["kpi-card", "bar-chart"],
      layout: [],
    });
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("kpi-card");
    expect(result[1].type).toBe("bar-chart");
  });
});

/* ──────────────────────────────────────────────
   3. Cả layout và widgets đều có phần tử → chỉ dùng layout
   ────────────────────────────────────────────── */
describe("cả layout và widgets đều có phần tử", () => {
  it("chỉ dùng layout, bỏ widgets", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["kpi-card", "bar-chart"],
      layout: [
        { i: "yield-chart", x: 0, y: 0, w: 6, h: 2 },
        { i: "machine-status", x: 4, y: 2, w: 4, h: 3 },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("yield-rate");
    expect(result[1].type).toBe("machine-status");
  });
});

/* ──────────────────────────────────────────────
   4. Mỗi phần tử layout tạo đúng một WidgetConfig, giữ thứ tự
   ────────────────────────────────────────────── */
describe("mỗi layout item → một WidgetConfig, giữ thứ tự", () => {
  it("3 layout item → 3 widget, đúng thứ tự", () => {
    vi.setSystemTime(1_700_000_000_000);
    const result = templateToCustomDashboardWidgets({
      layout: [
        { i: "a", x: 0, y: 0, w: 4, h: 2 },
        { i: "b", x: 4, y: 0, w: 4, h: 2 },
        { i: "c", x: 0, y: 2, w: 4, h: 2 },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result[0].title).toBe("A");
    expect(result[1].title).toBe("B");
    expect(result[2].title).toBe("C");
  });
});

/* ──────────────────────────────────────────────
   5. id theo mẫu w_<timestamp>_<index>, index từ 0;
      dùng đồng hồ giả để tất định; afterEach trả timer
   ────────────────────────────────────────────── */
describe("id widget", () => {
  it("đúng mẫu w_<timestamp>_<index>", () => {
    vi.setSystemTime(1_700_000_000_000);
    const result = templateToCustomDashboardWidgets({
      layout: [
        { i: "x", x: 0, y: 0, w: 4, h: 2 },
        { i: "y", x: 4, y: 0, w: 4, h: 2 },
      ],
    });
    expect(result[0].id).toBe("w_1700000000000_0");
    expect(result[1].id).toBe("w_1700000000000_1");
  });

  it("index tăng từ 0", () => {
    vi.setSystemTime(1_700_000_000_000);
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "a", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].id).toBe("w_1700000000000_0");
  });

  it("các id trong cùng một lần gọi khác nhau", () => {
    vi.setSystemTime(1_700_000_000_000);
    const result = templateToCustomDashboardWidgets({
      layout: [
        { i: "a", x: 0, y: 0, w: 4, h: 2 },
        { i: "b", x: 4, y: 0, w: 4, h: 2 },
        { i: "c", x: 0, y: 2, w: 4, h: 2 },
      ],
    });
    const ids = result.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ──────────────────────────────────────────────
   6. type từ layout: id mẫu hệ thống → ánh xạ sang loại vẽ được
      (chọn vài id trong bảng, kiểm cả hai nhánh mẫu khác nhau)
   ────────────────────────────────────────────── */
describe("type từ layout — ánh xạ mẫu hệ thống", () => {
  it("production-stats (production-overview) → kpi-card", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "production-stats", x: 0, y: 0, w: 6, h: 2 }],
    });
    expect(result[0].type).toBe("kpi-card");
  });

  it("yield-chart (production-overview) → yield-rate", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "yield-chart", x: 0, y: 0, w: 6, h: 2 }],
    });
    expect(result[0].type).toBe("yield-rate");
  });

  it("oee-gauge (machine-health) → gauge", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "oee-gauge", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("gauge");
  });

  it("maintenance-calendar (machine-health) → table", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "maintenance-calendar", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("table");
  });
});

/* ──────────────────────────────────────────────
   7. type: id là WidgetType hợp lệ nhưng KHÔNG có trong bảng ánh xạ → giữ nguyên
   ────────────────────────────────────────────── */
describe("type — WidgetType hợp lệ không có trong bảng ánh xạ", () => {
  it("kpi-card giữ nguyên", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "kpi-card", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("kpi-card");
  });

  it("bar-chart giữ nguyên", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "bar-chart", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("bar-chart");
  });

  it("line-chart giữ nguyên", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "line-chart", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("line-chart");
  });

  it("gauge giữ nguyên", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "gauge", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("gauge");
  });
});

/* ──────────────────────────────────────────────
   8. type: id lạ không hợp lệ → fallback "kpi-card"
      (kiểm cả layout và widgets)
   ────────────────────────────────────────────── */
describe("type — id lạ fallback kpi-card", () => {
  it("layout: id lạ → kpi-card", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "unknown-widget-xyz", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("kpi-card");
  });

  it("widgets: id lạ → kpi-card", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["unknown-widget-xyz"],
    });
    expect(result[0].type).toBe("kpi-card");
  });

  it("layout: id rỗng → kpi-card", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].type).toBe("kpi-card");
  });

  it("widgets: id rỗng → kpi-card", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: [""],
    });
    expect(result[0].type).toBe("kpi-card");
  });
});

/* ──────────────────────────────────────────────
   9. title: kebab-case → Title Case
      (kiểm id một từ và id nhiều từ, cả hai nhánh)
   ────────────────────────────────────────────── */
describe("title — kebab-case → Title Case", () => {
  it("layout: id một từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "hello", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].title).toBe("Hello");
  });

  it("layout: id nhiều từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "production-stats", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].title).toBe("Production Stats");
  });

  it("layout: id 3 từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "top-ng-points", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].title).toBe("Top Ng Points");
  });

  it("widgets: id một từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["hello"],
    });
    expect(result[0].title).toBe("Hello");
  });

  it("widgets: id nhiều từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["production-stats"],
    });
    expect(result[0].title).toBe("Production Stats");
  });

  it("widgets: id 3 từ → Title Case", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["top-ng-points"],
    });
    expect(result[0].title).toBe("Top Ng Points");
  });
});

/* ──────────────────────────────────────────────
   10. size từ layout theo bề rộng w:
       đúng TẠI mỗi ngưỡng và NGAY DƯỚI mỗi ngưỡng (4 cỡ)
       w >= 11 → full, w >= 7 → large, w >= 4 → medium, else → small
   ────────────────────────────────────────────── */
describe("size từ layout — ngưỡng bề rộng", () => {
  it("w = 11 → full (tại ngưỡng)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 11, h: 2 }],
    });
    expect(result[0].size).toBe("full");
  });

  it("w = 12 → full (trên ngưỡng)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 12, h: 2 }],
    });
    expect(result[0].size).toBe("full");
  });

  it("w = 10 → large (ngay dưới ngưỡng full)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 10, h: 2 }],
    });
    expect(result[0].size).toBe("large");
  });

  it("w = 7 → large (tại ngưỡng)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 7, h: 2 }],
    });
    expect(result[0].size).toBe("large");
  });

  it("w = 6 → medium (ngay dưới ngưỡng large)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 6, h: 2 }],
    });
    expect(result[0].size).toBe("medium");
  });

  it("w = 4 → medium (tại ngưỡng)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].size).toBe("medium");
  });

  it("w = 3 → small (ngay dưới ngưỡng medium)", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 3, h: 2 }],
    });
    expect(result[0].size).toBe("small");
  });

  it("w = 0 → small", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 0, h: 2 }],
    });
    expect(result[0].size).toBe("small");
  });

  it("w = 1 → small", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 1, h: 2 }],
    });
    expect(result[0].size).toBe("small");
  });

  it("w = 2 → small", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 0, w: 2, h: 2 }],
    });
    expect(result[0].size).toBe("small");
  });
});

/* ──────────────────────────────────────────────
   11. size từ widgets: luôn "medium" (≥ 2 phần tử)
   ────────────────────────────────────────────── */
describe("size từ widgets — luôn medium", () => {
  it("2 phần tử đều medium", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["kpi-card", "bar-chart"],
    });
    expect(result[0].size).toBe("medium");
    expect(result[1].size).toBe("medium");
  });

  it("3 phần tử đều medium", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["kpi-card", "bar-chart", "line-chart"],
    });
    expect(result[0].size).toBe("medium");
    expect(result[1].size).toBe("medium");
    expect(result[2].size).toBe("medium");
  });
});

/* ──────────────────────────────────────────────
   12. position từ layout:
       x khác 0 được giữ; thiếu x thì 0;
       thiếu y thì bằng index; có y thì giữ y
   ────────────────────────────────────────────── */
describe("position từ layout", () => {
  it("x khác 0 được giữ", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 6, y: 0, w: 4, h: 2 }],
    });
    expect(result[0].position).toEqual({ x: 6, y: 0 });
  });

  it("x = 0 được giữ nguyên", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 0, y: 5, w: 4, h: 2 }],
    });
    expect(result[0].position).toEqual({ x: 0, y: 5 });
  });

  it("có y → giữ y", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [{ i: "x", x: 2, y: 7, w: 4, h: 2 }],
    });
    expect(result[0].position).toEqual({ x: 2, y: 7 });
  });

  it("thiếu x → 0, thiếu y → index", () => {
    vi.setSystemTime(1_700_000_000_000);
    const partials: PhanTuThieuXY[] = [
      { i: "a", w: 4, h: 2 },
      { i: "b", w: 4, h: 2 },
      { i: "c", w: 4, h: 2 },
    ];
    const result = templateToCustomDashboardWidgets({
      layout: partials as unknown as TemplateLayoutItem[],
    });
    expect(result[0].position).toEqual({ x: 0, y: 0 });
    expect(result[1].position).toEqual({ x: 0, y: 1 });
    expect(result[2].position).toEqual({ x: 0, y: 2 });
  });
});

/* ──────────────────────────────────────────────
   13. position từ widgets: luôn { x: 0, y: index };
       config luôn {} ở cả hai nhánh
   ────────────────────────────────────────────── */
describe("position và config từ widgets", () => {
  it("position luôn { x: 0, y: index }", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["a", "b", "c"],
    });
    expect(result[0].position).toEqual({ x: 0, y: 0 });
    expect(result[1].position).toEqual({ x: 0, y: 1 });
    expect(result[2].position).toEqual({ x: 0, y: 2 });
  });

  it("config luôn {}", () => {
    const result = templateToCustomDashboardWidgets({
      widgets: ["a", "b"],
    });
    expect(result[0].config).toEqual({});
    expect(result[1].config).toEqual({});
  });
});

/* ──────────────────────────────────────────────
   13b. config luôn {} ở nhánh layout
   ────────────────────────────────────────────── */
describe("config từ layout luôn {}", () => {
  it("config = {}", () => {
    const result = templateToCustomDashboardWidgets({
      layout: [
        { i: "a", x: 0, y: 0, w: 4, h: 2 },
        { i: "b", x: 4, y: 2, w: 8, h: 3 },
      ],
    });
    expect(result[0].config).toEqual({});
    expect(result[1].config).toEqual({});
  });
});

/* ──────────────────────────────────────────────
   Tổng hợp: kiểm một template thật (production-overview)
   ────────────────────────────────────────────── */
describe("template thật — production-overview", () => {
  it("áp dụng đúng layout của production-overview", () => {
    vi.setSystemTime(1_700_000_000_000);
    const layout = [
      { i: "production-stats", x: 0, y: 0, w: 6, h: 2 },
      { i: "yield-chart", x: 6, y: 0, w: 6, h: 2 },
      { i: "machine-status", x: 0, y: 2, w: 8, h: 3 },
      { i: "hourly-trend", x: 8, y: 2, w: 4, h: 3 },
    ];
    const result = templateToCustomDashboardWidgets({ layout });
    expect(result).toHaveLength(4);

    // production-stats → kpi-card, w=6 → medium
    expect(result[0].type).toBe("kpi-card");
    expect(result[0].title).toBe("Production Stats");
    expect(result[0].size).toBe("medium");
    expect(result[0].position).toEqual({ x: 0, y: 0 });

    // yield-chart → yield-rate, w=6 → medium
    expect(result[1].type).toBe("yield-rate");
    expect(result[1].title).toBe("Yield Chart");
    expect(result[1].size).toBe("medium");
    expect(result[1].position).toEqual({ x: 6, y: 0 });

    // machine-status → machine-status, w=8 → large
    expect(result[2].type).toBe("machine-status");
    expect(result[2].title).toBe("Machine Status");
    expect(result[2].size).toBe("large");
    expect(result[2].position).toEqual({ x: 0, y: 2 });

    // hourly-trend → line-chart, w=4 → medium
    expect(result[3].type).toBe("line-chart");
    expect(result[3].title).toBe("Hourly Trend");
    expect(result[3].size).toBe("medium");
    expect(result[3].position).toEqual({ x: 8, y: 2 });

    // config luôn {}
    result.forEach((w) => expect(w.config).toEqual({}));
  });
});

/**
 * ★★★ 2026-08-17 — LƯỚI CHO "KHỐI RỖNG NÓI DỐI KHI NGUYÊN NHÂN THẬT LÀ PHẠM VI RỖNG".
 *
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt tên `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi
 *   cổng vẫn khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH, và vì sao lưới API KHÔNG bắt được nó
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Máy chủ đã trả `scopeEmptyReason="no_factory_assignment"` ĐÚNG. Mọi phép đo phía API vì thế
 * XANH. Cái sai nằm ở chỗ **giao diện vứt cái nhãn ấy đi** rồi vẽ câu "chưa có dữ liệu". Chỉ
 * nghiệm thu THỊ GIÁC 2026-08-17 mới thấy: cùng một màn `/dashboard`, dải trên đầu nói đúng,
 * khối cảnh báo yield ngay bên dưới nói sai.
 *
 * ── BỐN Ô ─────────────────────────────────────────────────────────────────────────────────
 *   §1  VỊ TỪ — bảng chân trị đầy đủ, gồm cả biên "rỗng thật" (đột biến *vá quá tay* ⇒ ĐỎ).
 *   §2  CÂU CHỮ — đủ vi/en/zh (đột biến *thiếu một ngôn ngữ* ⇒ ĐỎ) và **không** chứa cụm
 *       "không có dữ liệu" kể cả ở vế phủ định (đột biến *câu mới chứa cụm ấy* ⇒ ĐỎ).
 *   §3  RENDER THẬT (`react-dom/server`, không jsdom) — cổng có THẬT SỰ đổi câu không, và
 *       có THẬT SỰ giữ nguyên câu cũ cho người CÓ gán nhà máy không. **Cả hai chiều.**
 *   §4  CẤU TRÚC — từng khối rỗng đã vá có còn đọc lý do không (đột biến *gỡ nhánh
 *       scope-aware khỏi một khối* ⇒ ĐỎ).
 *
 * ⚠ §4 quét MÃ NGUỒN nên chỉ trả lời được "mã có hình dạng ấy không", KHÔNG trả lời được "mã
 *   làm việc ấy không" — đó chính là lý do §3 tồn tại. Đừng để §4 trôi thành "đã canh rồi".
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
  isScopeEmpty,
  scopeEmptyReasonOf,
} from "./scopeEmpty";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = join(CLIENT_SRC, "i18n", "locales");
const LANGS = ["vi", "en", "zh"] as const;

function locale(lang: (typeof LANGS)[number]): Record<string, any> {
  return JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8"));
}
function doc(relative: string): string {
  return readFileSync(join(CLIENT_SRC, relative), "utf8");
}
/**
 * Bỏ chú thích trước khi quét cấu trúc. ⚠ Không có bước này thì chính docblock giải thích bản
 * vá bị đếm như mã, và một ô có thể XANH vì lý do SAI — tệ hơn không có ô, vì lần sau người ta
 * sẽ nới nó ra thay vì đọc nó.
 */
function boComment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §1 — VỊ TỪ. Bảng chân trị đầy đủ.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
describe("§1 vị từ phạm vi rỗng", () => {
  it("chỉ ĐÚNG với mã máy chủ khai, không phải mọi giá trị 'có gì đó'", () => {
    expect(isScopeEmpty(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT)).toBe(true);
    expect(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT).toBe("no_factory_assignment");
  });

  it("★ RỖNG THẬT vẫn là rỗng thật — đây là chiều chống VÁ QUÁ TAY", () => {
    // Dây chuyền có gán nhà máy, có lọc, và trong phạm vi thật sự không có bản ghi.
    expect(isScopeEmpty(null)).toBe(false);
    expect(isScopeEmpty(undefined)).toBe(false);
    expect(isScopeEmpty("")).toBe(false);
    // Mã lạ trong tương lai KHÔNG được tự động khoác câu "chưa gán nhà máy".
    expect(isScopeEmpty("no_line_assignment")).toBe(false);
    expect(isScopeEmpty("NO_FACTORY_ASSIGNMENT")).toBe(false);
  });

  it("gom lý do từ nhiều nguồn CÙNG MÀN (khuôn cho thủ tục trả mảng trần)", () => {
    // Nguồn không mang nhãn (mảng trần qua tRPC) + nguồn mang nhãn ⇒ lấy được lý do.
    expect(scopeEmptyReasonOf(undefined, { scopeEmptyReason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT }))
      .toBe(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT);
    expect(scopeEmptyReasonOf({ scopeEmptyReason: null }, { scopeEmptyReason: null })).toBeNull();
    expect(scopeEmptyReasonOf()).toBeNull();
    expect(scopeEmptyReasonOf(null, undefined)).toBeNull();
    // Chấp nhận cả chuỗi trần lẫn đối tượng.
    expect(scopeEmptyReasonOf(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT)).toBe(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT);
    // Thứ tự không đổi kết quả: một nguồn khai rỗng là đủ.
    expect(scopeEmptyReasonOf({ scopeEmptyReason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT }, { scopeEmptyReason: null }))
      .toBe(SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §2 — CÂU CHỮ. Một nguồn, ba ngôn ngữ, và một cụm bị CẤM.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
const SCOPE_KEYS = ["title", "hint", "badge"] as const;

/**
 * ⚠ Cụm bị cấm — KỂ CẢ Ở VẾ PHỦ ĐỊNH.
 *
 * Người đọc lướt chỉ bắt được cụm từ, không bắt được vế phủ định: một câu
 * "…không phải là không có dữ liệu…" vẫn đọng lại đúng cái hiểu sai mà bản vá này đi xoá.
 * Quy tắc đã ghi trong `server/_core/accessControlLabels.ts` (`NO_FACTORY_ASSIGNMENT_MESSAGE`);
 * ô này là bản sao phía client cho ĐÚNG ba khoá `common.scopeEmpty.*`.
 */
const CUM_BI_CAM: Record<(typeof LANGS)[number], RegExp[]> = {
  vi: [/không có dữ liệu/i, /chưa có dữ liệu/i, /chưa có bản ghi/i],
  en: [/no data/i, /no inspection data/i],
  zh: [/没有数据/, /无数据/, /暂无数据/],
};

describe("§2 câu chữ phạm-vi-rỗng", () => {
  it.each(LANGS)("%s có đủ ba khoá common.scopeEmpty.*", (lang) => {
    const scopeEmpty = locale(lang)?.common?.scopeEmpty;
    expect(scopeEmpty, `${lang}.json thiếu common.scopeEmpty`).toBeTruthy();
    for (const k of SCOPE_KEYS) {
      expect(typeof scopeEmpty[k], `${lang}.json thiếu common.scopeEmpty.${k}`).toBe("string");
      expect(String(scopeEmpty[k]).trim().length).toBeGreaterThan(0);
    }
  });

  it.each(LANGS)("%s KHÔNG chứa cụm 'không có dữ liệu' ở bất kỳ vế nào", (lang) => {
    const scopeEmpty = locale(lang).common.scopeEmpty;
    for (const k of SCOPE_KEYS) {
      for (const cam of CUM_BI_CAM[lang]) {
        expect(
          cam.test(String(scopeEmpty[k])),
          `${lang}.json common.scopeEmpty.${k} chứa cụm bị cấm ${cam}`,
        ).toBe(false);
      }
    }
  });

  it("ba ngôn ngữ KHÁC NHAU thật sự (một bản dịch bị chép nguyên tiếng Việt cũng là thiếu)", () => {
    const vi = locale("vi").common.scopeEmpty;
    const en = locale("en").common.scopeEmpty;
    const zh = locale("zh").common.scopeEmpty;
    for (const k of SCOPE_KEYS) {
      expect(en[k], `en.json common.scopeEmpty.${k} chưa dịch`).not.toBe(vi[k]);
      expect(zh[k], `zh.json common.scopeEmpty.${k} chưa dịch`).not.toBe(vi[k]);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §3 — RENDER THẬT (`react-dom/server`). CẢ HAI CHIỀU.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `t` giả TRA THẬT `vi.json`: nếu component gõ sai khoá, ô này ĐỎ. Một `t` trả về chính khoá
 * sẽ khiến mọi khẳng định dưới đây xanh một cách tầm thường — đó là lưới giả.
 */
const VI = locale("vi");
function tThat(key: string, fallback?: string): string {
  const value = key.split(".").reduce<any>((o, part) => (o == null ? undefined : o[part]), VI);
  return typeof value === "string" ? value : (fallback ?? `‹THIẾU:${key}›`);
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

const { ScopeEmptyNotice, ScopeAwareEmpty } = await import("@/components/ScopeEmptyNotice");
const { EmptyState } = await import("@/components/EmptyState");

const CAU_PHAM_VI_RONG = VI.common.scopeEmpty.title as string;
const CAU_NHAN_PHAM_VI = VI.common.scopeEmpty.badge as string;

describe("§3 render thật — hai chiều", () => {
  it("phạm vi rỗng ⇒ ScopeAwareEmpty NUỐT câu cũ và nói đúng lý do", () => {
    const html = renderToStaticMarkup(
      createElement(ScopeAwareEmpty, {
        reason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
        children: createElement("p", null, "Tạm chưa có dữ liệu kiểm"),
      }),
    );
    expect(html).toContain(CAU_PHAM_VI_RONG);
    expect(html).not.toContain("Tạm chưa có dữ liệu kiểm");
  });

  it("★ RỖNG THẬT ⇒ ScopeAwareEmpty GIỮ NGUYÊN câu cũ (chống vá quá tay)", () => {
    for (const reason of [null, undefined, "some_other_reason"]) {
      const html = renderToStaticMarkup(
        createElement(ScopeAwareEmpty, {
          reason,
          children: createElement("p", null, "Tạm chưa có dữ liệu kiểm"),
        }),
      );
      expect(html, `reason=${String(reason)}`).toContain("Tạm chưa có dữ liệu kiểm");
      expect(html, `reason=${String(reason)}`).not.toContain(CAU_PHAM_VI_RONG);
    }
  });

  it("ba biến thể của ScopeEmptyNotice đều phát ra câu THẬT (không phải tên khoá)", () => {
    for (const variant of ["banner", "block", "inline"] as const) {
      const html = renderToStaticMarkup(
        createElement(ScopeEmptyNotice, { reason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT, variant }),
      );
      expect(html, variant).toMatch(/role="status"/);
      expect(html, variant).not.toContain("‹THIẾU:");
      expect(html, variant).toContain(variant === "inline" ? CAU_NHAN_PHAM_VI : CAU_PHAM_VI_RONG);
    }
    // Phạm vi bình thường ⇒ KHÔNG hiện gì cả.
    expect(renderToStaticMarkup(createElement(ScopeEmptyNotice, { reason: null }))).toBe("");
  });

  it("★ EmptyState: phạm vi rỗng THẮNG cả title/description do nơi gọi truyền vào", () => {
    // Nếu không thắng, mọi call site đang truyền `title` (đa số) vẫn nói dối và prop thành đồ trang trí.
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        scopeEmptyReason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT,
        title: "Chưa có dữ liệu trạm",
        description: "Hãy đổi bộ lọc",
      }),
    );
    expect(html).toContain(CAU_PHAM_VI_RONG);
    expect(html).not.toContain("Chưa có dữ liệu trạm");
    expect(html).not.toContain("Hãy đổi bộ lọc");
  });

  it("★ EmptyState: 'allClear' cũng bị nuốt — lời trấn an cũng là một kết luận", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, { scopeEmptyReason: SCOPE_EMPTY_NO_FACTORY_ASSIGNMENT, allClear: true }),
    );
    expect(html).toContain(CAU_PHAM_VI_RONG);
    expect(html).not.toContain("Không có gì bất thường");
  });

  it("★ EmptyState rỗng-thật giữ nguyên hành vi cũ (cả title tuỳ biến lẫn mặc định)", () => {
    const custom = renderToStaticMarkup(
      createElement(EmptyState, { scopeEmptyReason: null, title: "Chưa có dữ liệu trạm" }),
    );
    expect(custom).toContain("Chưa có dữ liệu trạm");
    expect(custom).not.toContain(CAU_PHAM_VI_RONG);

    const allClear = renderToStaticMarkup(createElement(EmptyState, { allClear: true }));
    expect(allClear).toContain("Không có gì bất thường");
    expect(allClear).not.toContain(CAU_PHAM_VI_RONG);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * §4 — CẤU TRÚC: từng khối rỗng đã vá có CÒN đọc lý do không.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Mỗi dòng = một bề mặt đã vá + những mảnh mã KHÔNG được biến mất.
 * Gỡ nhánh scope-aware khỏi bất kỳ khối nào ⇒ ô tương ứng ĐỎ.
 *
 * ⚠⚠ `dung_bang` là số ĐÚNG BẰNG, cố ý KHÔNG phải "≥". Lượt đầu của chính ô này viết
 * `toBeGreaterThanOrEqual(9)` trong khi màn có 14 chỗ nối — đột biến M1 (gỡ nhánh khỏi ĐÚNG
 * khối mà nghiệm thu thị giác đã bắt) chạy qua XANH 14→13. Đó là lớp "ngân sách TỰ THOẢ":
 * một lượng từ giao với chính tập phủ thì không bao giờ đỏ được. Thêm khối mới ⇒ SỬA SỐ, và
 * việc phải sửa số chính là chỗ để đọc lại xem khối mới có nối đúng không.
 */
const BE_MAT_DA_VA: Array<{
  file: string;
  phai_co: string[];
  dung_bang?: Array<[string, number]>;
  /** Khoá i18n của câu rỗng CŨ — mỗi lần xuất hiện phải có `scopeEmptyReason` ở ngay trên. */
  ke_can?: string[];
}> = [
  {
    file: "pages/Dashboard.tsx",
    phai_co: [
      "const scopeEmptyReason = scopeEmptyReasonOf(",
      "<ScopeEmptyNotice reason={scopeEmptyReason} />",
      // dải "hôm nay chưa có bản ghi" PHẢI tắt khi phạm vi rỗng (nếu không: hai câu chỏi nhau)
      "scopeEmptyReason === null",
    ],
    dung_bang: [
      ["<ScopeAwareEmpty reason={scopeEmptyReason}", 14],
      ["scopeEmptyReason={scopeEmptyReason}", 5],
    ],
    ke_can: [
      "dashboard.noDataYet",
      "dashboard.noDataForAlerts",
      'common.noData"',
      "dashboard.noMachinesInFilter",
      "dashboard.noInspectionResults",
    ],
  },
  {
    file: "pages/History.tsx",
    phai_co: [
      "const scopeEmptyReason = scopeEmptyReasonOf(data, allData)",
      "<ScopeEmptyNotice reason={scopeEmptyReason} />",
      "<NoWorkstationData scopeEmptyReason={scopeEmptyReason} />",
      "<NoChartData scopeEmptyReason={scopeEmptyReason} />",
    ],
    dung_bang: [["scopeEmptyReason={scopeEmptyReason}", 11]],
    ke_can: ["dashboard.noDataYet", "history.processStable"],
  },
  {
    file: "pages/Reports.tsx",
    phai_co: ["const scopeEmptyReason = scopeEmptyReasonOf(topBottomMachines)"],
    dung_bang: [["scopeEmptyReason={scopeEmptyReason}", 5]],
    ke_can: ["reports.machineStatsEmpty", "reports.factoryStatsEmpty", "reports.copqEmpty"],
  },
  {
    file: "pages/AndonBoard.tsx",
    phai_co: ['board.scopeEmptyReason === "no_factory_assignment"', 't("common.scopeEmpty.badge")'],
    dung_bang: [['board.scopeEmptyReason === "no_factory_assignment"', 2]],
    ke_can: ["andonBoard.noMachines", "andonBoard.tickerEmpty"],
  },
  {
    file: "pages/QualityHome.tsx",
    phai_co: ['ngQuery.data?.scopeEmptyReason === "no_factory_assignment"', 't("common.scopeEmpty.badge")'],
    ke_can: ["quality.recentNgEmpty"],
  },
  {
    file: "pages/SupervisorHome.tsx",
    phai_co: ['ngQuery.data?.scopeEmptyReason === "no_factory_assignment"', 't("common.scopeEmpty.badge")'],
    ke_can: ["supervisor.attentionEmpty"],
  },
  {
    file: "pages/ExecutiveMobile.tsx",
    phai_co: ["const scopeEmptyReason ="],
    dung_bang: [["scopeEmptyReason={scopeEmptyReason}", 3]],
    ke_can: ["executiveMobile.risks.empty", "executiveMobile.approvals.empty", "executiveMobile.ai.empty"],
  },
  { file: "pages/CorporateDashboard.tsx", phai_co: ["<ScopeEmptyNotice reason={"] },
  { file: "pages/CorporateLayout.tsx", phai_co: ["<ScopeEmptyNotice reason={"] },
  {
    file: "components/HistoryComparison.tsx",
    phai_co: [
      "const scopeEmptyReason = scopeEmptyReasonOf(period1Data, period2Data)",
      "<ScopeEmptyNotice reason={scopeEmptyReason} />",
    ],
  },
  {
    file: "components/DashboardWidgetRenderer.tsx",
    phai_co: ["function WidgetEmpty({ reason }", "t('common.scopeEmpty.badge')"],
    dung_bang: [
      ["isScopeEmpty(", 8],
      ["<WidgetEmpty reason=", 9],
    ],
  },
  {
    file: "components/controlTower/panels.tsx",
    phai_co: ['t("common.scopeEmpty.badge")'],
    // 4 → 9 (2026-08-18, nhóm B #5): hai bề mặt BÁO ĐỘNG được nối thêm vào cùng khuôn —
    // `LiveAlarmsPanel` (+2: `emptyAllClear` và nhánh `emptyText`) và `AlarmHealthPanel`
    // (+3: thêm dải giải thích NGAY CẠNH các số 0, vì panel ấy gần như không bao giờ rơi
    // vào nhánh `isEmpty`). Máy chủ nay lọc `commandCenter.recentAlerts` /
    // `commandCenter.kpiSummary` / `alarmKpi.summary` theo nhà máy được gán, nên "All
    // clear" trên một phạm vi rỗng là lời khai SAI VỀ THẾ GIỚI ở đúng chỗ nguy hiểm nhất.
    dung_bang: [["isScopeEmpty(", 9]],
    ke_can: [
      "controlTower.corporate.empty",
      "controlTower.andonRail.empty",
      "controlTower.liveAlarms.empty",
      "controlTower.alarmHealth.empty",
    ],
  },
  {
    file: "components/EmptyState.tsx",
    phai_co: ["const scopeEmpty = isScopeEmpty(scopeEmptyReason)", "'common.scopeEmpty.title'"],
  },
  /**
   * ★★★ 2026-08-18 — HAI MÀN ĂN BẰNG MẢNG TRẦN, nối nhãn qua `mqttClient.getScopeLabels`.
   *
   * ⚠ Khác MỌI dòng phía trên: các màn kia mượn được nhãn từ một truy vấn CÙNG MÀN có trả object
   * (`dashboard.getStats`, `inspection.search`). Hai màn này **không có cái nào** — `machine.list`,
   * `getAllOEE`, `getAllMachineHealth` đều là mảng trần, mà mảng KHÔNG chở được nhãn qua superjson
   * (`withScopeLabels` đính chúng `enumerable: false`, CỐ Ý). Nên nhãn tới bằng một thủ tục RIÊNG.
   * Mảnh `trpc.mqttClient.getScopeLabels.useQuery()` nằm trong `phai_co` chính là để đột biến
   * "gỡ nguồn nhãn khỏi màn" đỏ NGAY, chứ không âm thầm biến `scopeEmptyReason` thành `null` vĩnh
   * viễn — dạng hỏng mà mọi ô khác của file này vẫn XANH (vị từ đúng, câu chữ đủ, cấu trúc còn).
   */
  {
    file: "pages/OEEDashboard.tsx",
    phai_co: [
      "trpc.mqttClient.getScopeLabels.useQuery()",
      "const scopeEmptyReason = scopeEmptyReasonOf(oeeScope)",
      "<ScopeEmptyNotice reason={scopeEmptyReason} />",
    ],
    dung_bang: [["<ScopeAwareEmpty reason={scopeEmptyReason}", 2]],
    ke_can: ["oee.noData'", "oee.noOeeData'", "oee.selectMachineForDetails"],
  },
  {
    file: "pages/MachineHealthMonitoring.tsx",
    phai_co: [
      "trpc.mqttClient.getScopeLabels.useQuery()",
      "const scopeEmptyReason = scopeEmptyReasonOf(healthScope)",
      "<ScopeEmptyNotice reason={scopeEmptyReason} />",
      // Khối tổng quan: TRƯỚC bản vá, 0 máy hiện bốn thẻ "0" mà KHÔNG một câu nào — nên ô này
      // canh cả sự TỒN TẠI của nhánh rỗng, không chỉ việc nó có đọc lý do.
      "machineComparisonData.length === 0 ?",
      "scopeEmptyReason={scopeEmptyReason}",
    ],
    dung_bang: [["<ScopeAwareEmpty reason={scopeEmptyReason}", 2]],
    // ⚠ `machines.allMachinesGood` là lời TRẤN AN — nguy hiểm ngang một câu rỗng sai, vì người
    // đọc nó sẽ THÔI đi kiểm tra. Nó phải nằm sau một cổng phạm vi như mọi câu rỗng khác.
    ke_can: [
      "machines.noFleetHealth'",
      "machines.allMachinesGood",
      "machines.selectMachineForHealthMonitoring",
    ],
  },
];

/**
 * Cửa sổ KỀ CẬN, đo được chứ không chọn bừa: khoảng cách thật lớn nhất giữa một khoá rỗng cũ
 * và chữ `scopeEmptyReason` đứng trước nó hiện là **400 ký tự** (khối cảnh báo yield của
 * `/dashboard`, vì có một ternary lồng ở giữa). 450 cho biên an toàn mà vẫn đủ hẹp để việc gỡ
 * nhánh đẩy khoảng cách vượt ngưỡng.
 */
const CUA_SO_KE_CAN = 450;

describe("§4 cấu trúc — khối rỗng vẫn đọc lý do", () => {
  it.each(BE_MAT_DA_VA)("$file giữ nguyên nhánh scope-aware", ({ file, phai_co, dung_bang }) => {
    const src = boComment(doc(file));
    for (const manh of phai_co) {
      expect(src.includes(manh), `${file} mất mảnh: ${manh}`).toBe(true);
    }
    for (const [manh, n] of dung_bang ?? []) {
      const dem = src.split(manh).length - 1;
      expect(dem, `${file} có ${dem} chỗ dùng "${manh}", phải ĐÚNG ${n}`).toBe(n);
    }
  });

  it.each(BE_MAT_DA_VA.filter((b) => b.ke_can))(
    "$file — mọi câu rỗng CŨ đều có lý do phạm vi ở ngay trên",
    ({ file, ke_can }) => {
      const src = boComment(doc(file));
      for (const khoa of ke_can!) {
        let i = -1;
        let lan = 0;
        while ((i = src.indexOf(khoa, i + 1)) !== -1) {
          lan += 1;
          const truoc = src.slice(Math.max(0, i - CUA_SO_KE_CAN), i);
          expect(
            truoc.includes("scopeEmptyReason") || truoc.includes("scopeEmpty"),
            `${file}: lần ${lan} của "${khoa}" không có lý do phạm vi trong ${CUA_SO_KE_CAN} ký tự trước đó`,
          ).toBe(true);
        }
        expect(lan, `${file}: không tìm thấy "${khoa}" — bảng đã lệch khỏi mã`).toBeGreaterThan(0);
      }
    },
  );

  it("★ câu phạm-vi-rỗng chỉ được lấy từ MỘT nguồn i18n — không chép tay ở bề mặt nào", () => {
    // Chép tay là cách một bề mặt lặng lẽ lệch câu chữ rồi không ai phát hiện.
    for (const { file } of BE_MAT_DA_VA) {
      const src = boComment(doc(file));
      expect(src.includes(VI.common.scopeEmpty.title), `${file} chép tay câu scopeEmpty`).toBe(false);
      expect(src.includes(VI.common.scopeEmpty.hint), `${file} chép tay câu scopeEmpty`).toBe(false);
    }
  });
});

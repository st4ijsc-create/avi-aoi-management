/**
 * F13 — CỔNG cho khoá i18n ĐƯỢC LƯU NHƯ DỮ LIỆU rồi mới `t()`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ LỚP LỖI NÀY DO CHÍNH ĐỢT DI TRÚ F13 TẠO RA — nên nó phải có lưới riêng.
 * ══════════════════════════════════════════════════════════════════════════════════
 * `navigation.tsx` và các file `*Hub.tsx` lưu nhãn dưới dạng **chuỗi khoá**:
 *
 *     { label: "nav.factoryCommand", href: "/factory-command" }
 *
 * rồi component mới gọi `t(entry.label)`. Đây là lời gọi **không có defaultValue**,
 * và i18next khi không tra được khoá sẽ trả lại **chính chuỗi khoá**. Nghĩa là một
 * khoá gõ sai hay quên nạp KHÔNG ném lỗi, không cảnh báo — người dùng chỉ thấy
 * `nav.factoryCommand` nằm chình ình trên menu.
 *
 * Vì sao hai cổng sẵn có KHÔNG bắt được:
 *   · `i18n-check.mjs` dựng tập khoá từ **tham chiếu tĩnh** `t("...")` trong mã.
 *     `t(entry.label)` là tham chiếu ĐỘNG — nó không thấy khoá nào cả.
 *   · `viStringCoverage` so **file với file** (vi ⊆ en, zh). Một khoá vắng ở CẢ BA
 *     locale thì parity vẫn xanh — không có gì để so.
 * ⇒ Chỉ phép kiểm dưới đây, đi từ MÃ NGUỒN ra locale, mới đóng được lỗ này.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = resolve(CLIENT_SRC, "i18n/locales");

/** Mọi file lưu khoá i18n như dữ liệu rồi để component `t()` sau. */
const FILES_KHOA_DU_LIEU = [
  "lib/navigation.tsx",
  "pages/AIHome.tsx",
  "pages/AIStudioHub.tsx",
  "pages/DataManagementHub.tsx",
  "pages/EngineeringStudioHub.tsx",
  "pages/MaintenanceWorkspaceHub.tsx",
  "pages/ProductWorkspaceHub.tsx",
  "pages/SettingsHub.tsx",
  // F13 lô 2 — bản đồ mã→khoá (`STATUS_KEY`, `SEVERITY_KEY`, `KIND_KEY`, `*_LABELS`)
  "pages/CommandCenter.tsx",
  "pages/MasterDataManagement.tsx",
  // F13 lô 3 — UserGuide lưu toàn bộ nội dung hướng dẫn dưới dạng khoá
  "pages/UserGuide.tsx",
  // F13 lô 4 — `headerKey` (nhãn cột hiển thị; `header` vẫn là khoá khớp Excel)
  "pages/ProductModels.tsx",
  "pages/ComponentShowcase.tsx",
  // F13 lô 5 — gợi ý câu hỏi AI (`question` cũng là khoá: nó được GỬI cho trợ lý)
  "components/AILocalKnowledgeBase.tsx",
];

/** Trường được component gọi `t()` lên. `description` KHÔNG nằm đây — xem ghi chú dưới. */
const TRUONG_QUA_T = ["label", "blurb", "note", "headerKey", "question"];

/**
 * Không gian tên gốc của các khoá do F13 sinh. Quét theo TIỀN TỐ thay vì theo tên
 * trường, vì bản đồ trạng thái có hình dạng `ok: "cmdCenter.status.ok"` — tên khoá
 * bên trái là mã enum, không phải một trong `TRUONG_QUA_T`.
 */
const NS_F13 = /^(cmdCenter|masterDataEnum|userGuide)\./;

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}
const doc = (lg: string) => flatten(JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")));

/**
 * Chuỗi trông như khoá i18n: ASCII, có chấm, không khoảng trắng — VÀ đoạn đầu phải
 * là một không-gian-tên CÓ THẬT trong `vi.json`.
 *
 * ⚠ Điều kiện thứ hai không phải cho gọn. Thiếu nó, `label: "Next.js"` trong
 * `ComponentShowcase` bị nhận nhầm là khoá i18n rồi bị tố "thiếu ở cả ba locale" —
 * cổng đỏ vì một TÊN SẢN PHẨM. Đúng lớp "thước đo bắt nhầm" của F12: một cổng tố
 * sai chỗ sẽ bị người ta tắt đi, và khi đó nó không canh gì nữa.
 */
const NS_GOC = new Set(Object.keys(JSON.parse(readFileSync(join(LOCALES, "vi.json"), "utf8"))));
const LA_KHOA = (s: string) =>
  /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(s) && NS_GOC.has(s.split(".")[0]);

function khoaTrongMa(): Array<{ file: string; khoa: string }> {
  const out: Array<{ file: string; khoa: string }> = [];
  for (const rel of FILES_KHOA_DU_LIEU) {
    const src = readFileSync(join(CLIENT_SRC, rel), "utf8");
    for (const truong of TRUONG_QUA_T) {
      const re = new RegExp(`\\b${truong}:\\s*"([^"]+)"`, "g");
      for (const m of src.matchAll(re)) if (LA_KHOA(m[1])) out.push({ file: rel, khoa: m[1] });
    }
    // Khuôn bản đồ: bất kỳ chuỗi nào mang tiền tố không-gian-tên của F13.
    for (const m of src.matchAll(/"([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)"/g)) {
      if (NS_F13.test(m[1]) && LA_KHOA(m[1])) out.push({ file: rel, khoa: m[1] });
    }
  }
  return out;
}

describe("F13 — khoá i18n lưu như DỮ LIỆU phải tra được ở cả ba locale", () => {
  it("cầu chì: phép quét phải THẤY khoá, không thì nó đang canh tập rỗng", () => {
    // Không có bước này, mọi khẳng định dưới đây đều đúng một cách vô nghĩa
    // (∀ trên tập rỗng). Đã trả giá đúng lớp này ở Pha 4 (glob rỗng ⇒ vitest im lặng).
    expect(khoaTrongMa().length).toBeGreaterThan(150);
  });

  it("★★★ MỌI khoá phải có ở vi, en VÀ zh — thiếu là người dùng thấy chuỗi khoá", () => {
    const vi = doc("vi"), en = doc("en"), zh = doc("zh");
    const thieu = khoaTrongMa()
      .filter(({ khoa }) => vi[khoa] === undefined || en[khoa] === undefined || zh[khoa] === undefined)
      .map(({ file, khoa }) => `${file} → ${khoa}`);
    expect(thieu).toEqual([]);
  });

  it("không khoá nào còn mang chữ tiếng Việt — khoá phải là định danh ASCII", () => {
    const xau = khoaTrongMa().filter(({ khoa }) => !/^[\x20-\x7E]+$/.test(khoa));
    expect(xau).toEqual([]);
  });
});

/**
 * ⚠ `NavItem.description` CỐ Ý không nằm trong `TRUONG_QUA_T`.
 * Đo ngày 2026-08-16: không component nào render nó, và nó cũng không có trong
 * `knowledge/nav-catalog.json`. Nó là siêu dữ liệu cho lập trình viên. Vẫn được
 * chuyển sang khoá để thôi mơ hồ, nhưng KHÔNG bị ràng buộc phải tồn tại — nếu
 * ngày nào có người render nó, hãy thêm "description" vào danh sách trên.
 */

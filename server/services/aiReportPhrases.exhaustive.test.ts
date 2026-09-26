/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ G4-A VIỆC 1 — **CỔNG VÉT CẠN CỦA BỀ MẶT BÁO CÁO ĐIỀU HÀNH.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠⚠ "LƯỚI NÀY DẪN NGƯỜI TA TỚI ĐÂU?"
 * Phản ứng tự nhiên với một cổng vét cạn ngây thơ ("khoá có tồn tại ở cả ba ngôn ngữ không?") là
 * **khai một khoá RỖNG**, hoặc **chép nguyên câu tiếng Anh sang ô `vi`**. Đủ khoá, cổng xanh,
 * người đọc vẫn nhận tiếng Anh — tức đúng lỗi đang vá, chỉ khác chỗ đứng.
 *
 * ⇒ §A KHÔNG hỏi *"khoá có tồn tại không"*. Nó hỏi **ba câu PHẢI-LÀ** trên chuỗi ĐÃ RENDER:
 *   (1) cả ba bản đều **có chữ** (sau khi bỏ mọi ô tham số) ⇒ khoá rỗng ĐỎ;
 *   (2) `en` **không chứa một chữ cái phi-ASCII nào** ⇒ chép tiếng Việt/tiếng Trung sang `en` ĐỎ;
 *   (3) `zh` **phải có ít nhất một Hán tự**, `vi` **phải có ít nhất một chữ Latin có dấu**
 *       ⇒ `zh` mượn `vi`, hay `vi` mượn `en`, đều ĐỎ.
 * (Khuôn lấy nguyên từ tiền lệ đã được duyệt `aiLocalTools/vramPhrases.exhaustive.test.ts`.)
 *
 * ⚠⚠⚠ §C ĐO **ĐẦU RA CỦA MÃ SẢN PHẨM**, KHÔNG ĐO BẢNG.
 * §A và bảng câu suy ra từ **cùng một nguồn** ⇒ xoá một lượt gọi `cauBaoCao(...)` trong
 * `aiReportGenerator.ts` và viết lại một chuỗi tiếng Anh **KHÔNG làm §A đỏ được** (bài học N14:
 * hai vế cùng một bảng thì đột biến không đỏ được gì). §C gọi **bốn hàm sinh báo cáo THẬT** và
 * khẳng định **MỌI phần tử** của `anomalies` / `recommendations` / `actionItems` / `trends` /
 * `concerns` / `forecast` / `timeline` phải mang dấu hiệu của đúng ngôn ngữ được xin — một lượng
 * từ trên **toàn bộ mảng**, không liệt kê câu nào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks: đúng ba mặt tiếp xúc NGOÀI tiến trình (khuôn của aiReportGenerator.test.ts) ─────
const getDb = vi.fn();
const routerNarrative = vi.fn();
const checkConfidenceDrift = vi.fn();

vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));
vi.mock("./aiProviderRouter", () => ({ generateNarrative: (...a: unknown[]) => routerNarrative(...a) }));
vi.mock("./aiDriftMonitor", () => ({ checkConfidenceDrift: (...a: unknown[]) => checkConfidenceDrift(...a) }));

import {
  CAU_BAO_CAO,
  KHOA_CAU_BAO_CAO,
  NGON_NGU_BAO_CAO,
  cauBaoCao,
  type Cum,
  type ReportLang,
  type Tham,
} from "./aiReportPhrases";
import {
  generateDailyQualitySummary,
  generateExecutiveSummary,
  generateModelPerformanceReport,
  generateRCAReport,
} from "./aiReportGenerator";
import { productInspections, measurementResults, machines, inferenceResults } from "../../drizzle/schema";
import { aiModels } from "../../drizzle/schema/ai";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §A — BA LUẬT PHẢI-LÀ, ÁP CHO **TOÀN BẢNG, KHÔNG MỘT MIỄN TRỪ NÀO**
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * Giá trị mẫu cho **mọi** tham số. Cố ý **thuần ASCII + chữ số**: nếu tham số mang chữ có dấu thì
 * luật (2) sẽ đỏ oan ở ô `en`, và luật (3) sẽ xanh oan ở ô `vi` — tức thiết bị đo tự nhiễm.
 */
const THAM_MAU = new Proxy({} as Tham, {
  get: (_t, k) => (typeof k === "string" && /^(count|total|n|max)$/.test(k) ? 7 : "X1"),
  has: () => true,
  ownKeys: () => [],
});

/** Bỏ mọi ô tham số đã render khỏi chuỗi, để luật (1) đo **văn xuôi**, không đo dữ liệu. */
function chiVanXuoi(s: string): string {
  return s.replace(/X1/g, "").replace(/\d+/g, "");
}

const CO_HAN_TU = /\p{sc=Han}/u;
/** Chữ Latin CÓ DẤU: Latin-1 Supplement + Latin Extended-A/B + Latin Extended Additional (tiếng Việt). */
const CHU_LATIN_CO_DAU = /[À-ɏḀ-ỿ]/u;
/**
 * ⚠⚠ **THIẾT BỊ ĐO TỰ KIỂM — BẢN ĐẦU CỦA CHÍNH LƯỚI NÀY NÓI SAI.**
 *
 * Luật (2) phát biểu *"không một **CHỮ CÁI** phi-ASCII nào"*. Bản đầu lại đo *"không một **KÝ TỰ**
 * phi-ASCII nào"* (`/[^\x00-\x7F]/`) và chấm **ĐỎ 14 ca** — vì dấu gạch ngang dài (U+2014) nằm sẵn
 * trong chính những câu tiếng Anh **CÓ TỪ TRƯỚC** (`… accuracy drift — recommend retraining`).
 * U+2014 là **dấu câu** (Pd), không phải chữ.
 *
 * ⚠ Hai lối thoát rẻ mà lưới này **KHÔNG** đi: đổi dấu gạch ngang thành `-` cho vừa thước, hoặc
 * nới luật (2) thành "trừ vài ký tự cho phép". Cả hai đều là **nắn hiện tượng cho vừa thiết bị
 * đo**. Sửa **thiết bị đo** để nó đo đúng thứ luật đang nói.
 */
function coChuCaiPhiAscii(s: string): boolean {
  for (const ch of s) if (ch.codePointAt(0)! > 127 && /\p{L}/u.test(ch)) return true;
  return false;
}

describe("§A — mỗi khoá phải có VĂN XUÔI THẬT ở cả ba ngôn ngữ", () => {
  it("bảng không rỗng (cầu chì chống 'PASS trên tập rỗng')", () => {
    expect(KHOA_CAU_BAO_CAO.length).toBeGreaterThan(40);
    expect(NGON_NGU_BAO_CAO).toEqual(["vi", "en", "zh"]);
  });

  for (const khoa of KHOA_CAU_BAO_CAO) {
    it(`${khoa} — ba bản đều CÓ CHỮ, en THUẦN ASCII, zh CÓ HÁN TỰ, vi CÓ DẤU`, () => {
      const cum = CAU_BAO_CAO[khoa] as Cum<Tham>;
      const ban: Record<ReportLang, string> = {
        vi: cum.vi(THAM_MAU),
        en: cum.en(THAM_MAU),
        zh: cum.zh(THAM_MAU),
      };

      // (1) có chữ thật, không phải một khuôn rỗng / chỉ toàn tham số.
      // ⚠ **SÀN THEO CHỮ VIẾT, KHÔNG PHẢI MỘT CON SỐ CHUNG.** Sàn `>2` ban đầu chấm ĐỎ khoá
      //   `offline_khongXacDinh.zh` = "未知" — một **từ hoàn chỉnh** dài đúng 2 ký tự. Chữ Hán
      //   đặc hơn chữ Latin: đòi nó dài bằng chữ Latin là đòi sai đơn vị, và lối thoát rẻ (viết
      //   dài ra cho qua cổng) sẽ làm câu tiếng Trung **tệ đi** để một con số đẹp lên.
      for (const l of NGON_NGU_BAO_CAO) {
        const chu = chiVanXuoi(ban[l]).replace(/[\s"“”().:%—–\-,;/]/g, "");
        expect(chu.length, `${khoa}.${l} rỗng`).toBeGreaterThanOrEqual(l === "zh" ? 2 : 3);
      }

      // (2) `en` không được chứa MỘT chữ phi-ASCII nào ⇒ chép vi/zh sang en là ĐỎ.
      expect(coChuCaiPhiAscii(ban.en), `${khoa}.en chứa ký tự phi-ASCII: ${ban.en}`).toBe(false);

      // (3) `zh` phải có Hán tự · `vi` phải có chữ Latin CÓ DẤU ⇒ mượn của nhau là ĐỎ.
      expect(CO_HAN_TU.test(ban.zh), `${khoa}.zh không có Hán tự: ${ban.zh}`).toBe(true);
      expect(CHU_LATIN_CO_DAU.test(ban.vi), `${khoa}.vi không có chữ có dấu: ${ban.vi}`).toBe(true);

      // Ba bản phải KHÁC nhau từng đôi — hai bản trùng nhau là một bản chưa được dịch.
      expect(new Set([ban.vi, ban.en, ban.zh]).size, `${khoa}: có hai bản TRÙNG nhau`).toBe(3);
    });
  }

  it("cauBaoCao() tra đúng ô ngôn ngữ được xin (thiết bị đo tự kiểm)", () => {
    expect(cauBaoCao("vi", "khuyenNghiTheoDoiTiep", {})).toBe(CAU_BAO_CAO.khuyenNghiTheoDoiTiep.vi({}));
    expect(cauBaoCao("zh", "khuyenNghiTheoDoiTiep", {})).toBe(CAU_BAO_CAO.khuyenNghiTheoDoiTiep.zh({}));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §B — KHÔNG một ô ngôn ngữ nào được RẼ NHÁNH theo giá trị tham số (bài học I-3)
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * §A render mỗi khuôn **đúng một lần** ⇒ chỉ quan sát được **một** nhánh, trong khi tập giá trị
 * tham số là **vô hạn**. Một `p.x ? "<vi>" : "<en>"` nằm trong ô `en` sẽ đi qua §A trọn vẹn.
 * ⇒ §B đọc **mã nguồn của thân hàm** và cấm toán tử điều kiện / rẽ nhánh trong đó.
 */
describe("§B — thân mỗi ô ngôn ngữ là MỘT biểu thức chuỗi, không rẽ nhánh", () => {
  for (const khoa of KHOA_CAU_BAO_CAO) {
    it(`${khoa} — ba ô không chứa \`?:\` / \`if\` / \`&&\` / \`||\``, () => {
      const cum = CAU_BAO_CAO[khoa] as Cum<Tham>;
      for (const l of NGON_NGU_BAO_CAO) {
        const than = String(cum[l]);
        expect(/\?[^.]|(^|[^\w])if\s*\(|&&|\|\|/.test(than), `${khoa}.${l} có rẽ nhánh: ${than}`).toBe(false);
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §C — ĐẦU RA CỦA **MÃ SẢN PHẨM**: bốn báo cáo THẬT, MỌI mảng văn xuôi, ba ngôn ngữ
// ═══════════════════════════════════════════════════════════════════════════════════════════
interface QueryCtx { table: unknown; fields: string[] }

function makeDbStub(resolveRows: (ctx: QueryCtx) => unknown[]) {
  const select = (fields?: Record<string, unknown>) => {
    const ctx: QueryCtx = { table: null, fields: Object.keys(fields ?? {}) };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      from: (t: unknown) => { ctx.table = t; return chain; },
      innerJoin: self, leftJoin: self, where: self, groupBy: self, orderBy: self, limit: self,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows(ctx)).then(res, rej),
    });
    return chain;
  };
  return { select };
}

/** Bộ số ép **MỌI** nhánh văn xuôi cùng bật: defectRate 12% · lỗi áp đảo · sản lượng đổi · drift. */
function installDb() {
  // executive gọi collectInspectionStats HAI lần (kỳ này rồi kỳ trước) — kỳ trước cố ý khác nhiều
  // để cả `xuHuongYieldGiam`/`xuHuongSanLuongTang` lẫn `quanNgai*` cùng có cái để nói.
  const statsQueue = [
    { total: 500, ok: 440, ng: 60 },
    { total: 100, ok: 99, ng: 1 },
  ];
  const inferenceQueue = [{ total: 200, avgLatencyMs: 10, p50LatencyMs: 9, p95LatencyMs: 20, errCount: 60 }];
  getDb.mockResolvedValue(
    makeDbStub((ctx) => {
      if (ctx.table === productInspections) {
        if (ctx.fields.includes("machineId")) {
          return [
            { machineId: 1, machineCode: "AOI-01", total: 200, ok: 160, ng: 40 },
            { machineId: 2, machineCode: "AOI-02", total: 300, ok: 280, ng: 20 },
          ];
        }
        return [statsQueue.shift() ?? { total: 0, ok: 0, ng: 0 }];
      }
      if (ctx.table === measurementResults) return [{ defectType: "Solder Bridge", count: 55 }];
      if (ctx.table === aiModels) return [{ modelId: 7, modelCode: "AOI-DET-V3", modelVersion: "1.2.0", status: "ACTIVE" }];
      if (ctx.table === inferenceResults) {
        return [inferenceQueue.shift() ?? { total: 0, avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, errCount: 0 }];
      }
      if (ctx.table === machines) return [];
      throw new Error("[test] bảng ngoài dự kiến: " + String(ctx.table));
    }),
  );
}

const JAN = { startDate: new Date("2026-01-01T00:00:00Z"), endDate: new Date("2026-01-31T23:59:59Z") };

beforeEach(() => {
  vi.clearAllMocks();
  checkConfidenceDrift.mockResolvedValue({ evaluated: true, drift: true, severity: "HIGH" });
  // Ép nhánh narrative NGOẠI TUYẾN — đó là đường chạy khi không có model, và cũng là lớp thứ TƯ
  // của lỗi (bản trước ĐÁNH HƠI chữ "tiếng Việt" trong câu dẫn thay vì nhận một tham số).
  routerNarrative.mockRejectedValue(new Error("no local model in test"));
});

/**
 * ★★★ **BỎ MỌI MẢNH ĐÃ ĐƯỢC CHẤM RIÊNG RA KHỎI NARRATIVE TRƯỚC KHI CHẤM KHUÔN.**
 *
 * ⚠⚠⚠ ĐỘT BIẾN **M6 SỐNG SÓT Ở LƯỢT ĐẦU**, và lý do là một ca kinh điển *"lưới xanh qua một cơ
 * chế KHÁC cơ chế nó tưởng đang canh"*:
 *   M6 ép `generateOfflineNarrative` luôn dùng `lang="en"`. Khuôn narrative thành tiếng Anh —
 *   **nhưng lưới vẫn XANH**, vì khuôn ấy **NHÉT `anomalies` vào giữa nó**, và `anomalies` do lớp ②
 *   (KHÔNG bị đột biến) sinh ra bằng **tiếng Trung**. Đo được:
 *     `"Anomalies detected: 不良率偏高：12.0%; 主导不良类型…"`  ⇒ `\p{sc=Han}` khớp ⇒ XANH.
 *   Tức phép đo đang xác nhận *"dữ liệu nhét vào có tiếng Trung"*, chứ không phải *"khuôn narrative
 *   là tiếng Trung"* — hai câu khác hẳn nhau, và cái nó tưởng đang canh là câu thứ hai.
 *
 * ⇒ Trước khi chấm narrative, **trừ đi** mọi chuỗi đã được chấm ở một ca khác (anomalies /
 *   recommendations / actionItems / trends / concerns). Phần còn lại **đúng là khuôn**.
 */
function boManhDaCham(narrative: string, manh: string[]): string {
  let s = narrative;
  for (const m of manh) s = s.split(m).join("");
  return s;
}

/** Luật PHẢI-LÀ cho một chuỗi văn xuôi do MÃ SẢN PHẨM sinh ra. */
function phaiLaNgonNgu(s: string, lang: ReportLang, nhan: string) {
  // Bỏ dữ liệu (mã máy, tên loại lỗi, số) — chúng giống nhau ở mọi ngôn ngữ theo luật phân công.
  const vanXuoi = s.replace(/"[^"]*"/g, "").replace(/[“][^”]*[”]/g, "").replace(/[\d.,%]+/g, "");
  if (lang === "vi") expect(CHU_LATIN_CO_DAU.test(vanXuoi), `${nhan} [vi] KHÔNG có chữ có dấu: ${s}`).toBe(true);
  if (lang === "zh") expect(CO_HAN_TU.test(vanXuoi), `${nhan} [zh] KHÔNG có Hán tự: ${s}`).toBe(true);
  if (lang === "en") expect(coChuCaiPhiAscii(vanXuoi), `${nhan} [en] có ký tự phi-ASCII: ${s}`).toBe(false);
}

describe("§C — bốn báo cáo THẬT: MỌI mảng văn xuôi phải theo ngôn ngữ được xin", () => {
  for (const lang of ["vi", "en", "zh"] as const) {
    it(`daily summary [${lang}] — anomalies + recommendations (mảng, không liệt kê câu nào)`, async () => {
      installDb();
      const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily", language: lang });
      expect(r.anomalies.length, "bộ số phải bật ĐƯỢC nhánh anomalies").toBeGreaterThanOrEqual(2);
      expect(r.recommendations.length).toBeGreaterThanOrEqual(3);
      r.anomalies.forEach((s, i) => phaiLaNgonNgu(s, lang, `anomalies[${i}]`));
      r.recommendations.forEach((s, i) => phaiLaNgonNgu(s, lang, `recommendations[${i}]`));
      phaiLaNgonNgu(boManhDaCham(r.narrative, r.anomalies), lang, "KHUÔN narrative(offline)");
    });

    it(`RCA report [${lang}] — actionItems + timeline.event + evidence + triggeredBy mặc định`, async () => {
      installDb();
      const r = await generateRCAReport({ ...JAN, reportType: "rca", language: lang });
      expect(r.actionItems.length).toBeGreaterThanOrEqual(3);
      r.actionItems.forEach((s, i) => phaiLaNgonNgu(s, lang, `actionItems[${i}]`));
      r.timeline.forEach((t, i) => phaiLaNgonNgu(t.event, lang, `timeline[${i}].event`));
      r.contributingFactors.forEach((f, i) => phaiLaNgonNgu(f.evidence, lang, `contributingFactors[${i}].evidence`));
      phaiLaNgonNgu(r.triggeredBy, lang, "triggeredBy(mặc định)");
      phaiLaNgonNgu(boManhDaCham(r.narrative, [...r.actionItems, r.triggeredBy]), lang, "KHUÔN narrative(offline)");
    });

    it(`model performance [${lang}] — retrainRecommendations`, async () => {
      installDb();
      const r = await generateModelPerformanceReport({ ...JAN, reportType: "model_performance", language: lang });
      expect(r.retrainRecommendations.length).toBeGreaterThanOrEqual(1);
      r.retrainRecommendations.forEach((s, i) => phaiLaNgonNgu(s, lang, `retrainRecommendations[${i}]`));
      phaiLaNgonNgu(boManhDaCham(r.narrative, r.retrainRecommendations), lang, "KHUÔN narrative(offline)");
    });

    it(`executive summary [${lang}] — trends + concerns + forecast`, async () => {
      installDb();
      const r = await generateExecutiveSummary({ ...JAN, reportType: "executive", language: lang });
      expect(r.trends.length).toBeGreaterThanOrEqual(1);
      expect(r.concerns.length).toBeGreaterThanOrEqual(1);
      r.trends.forEach((s, i) => phaiLaNgonNgu(s, lang, `trends[${i}]`));
      r.concerns.forEach((s, i) => phaiLaNgonNgu(s, lang, `concerns[${i}]`));
      phaiLaNgonNgu(r.forecast, lang, "forecast");
      phaiLaNgonNgu(boManhDaCham(r.narrative, [...r.trends, ...r.concerns]), lang, "KHUÔN narrative(offline)");
    });
  }

  it("★ KHÔNG khai `language` ⇒ TIẾNG VIỆT (mặc định của một nhà máy Việt Nam, không phải `en`)", async () => {
    installDb();
    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily" });
    r.anomalies.forEach((s, i) => phaiLaNgonNgu(s, "vi", `mặc-định anomalies[${i}]`));
    r.recommendations.forEach((s, i) => phaiLaNgonNgu(s, "vi", `mặc-định recommendations[${i}]`));
  });

  it("★ câu dẫn gửi cho MODEL cũng đổi theo ngôn ngữ (không chỉ bản mẫu ngoại tuyến)", async () => {
    installDb();
    routerNarrative.mockResolvedValue({ text: "x", provider: "gguf", model: "m", totalTimeMs: 1, fallbackUsed: false });
    await generateDailyQualitySummary({ ...JAN, reportType: "daily", language: "zh" });
    const sys = String(routerNarrative.mock.calls[0][0].systemPrompt);
    expect(CO_HAN_TU.test(sys), `câu dẫn gửi model KHÔNG phải tiếng Trung: ${sys}`).toBe(true);
  });

  it("★ bản mẫu NGOẠI TUYẾN nhận `lang` làm THAM SỐ, không đánh hơi câu dẫn", async () => {
    // Đột biến mà ca này bắt: đổi câu dẫn `vi` cho gọn (bỏ chữ "tiếng Việt") ⇒ bản trước ÂM THẦM
    // quay về tiếng Anh. Ở đây câu dẫn `zh` không chứa chuỗi "tiếng Việt", mà narrative vẫn phải
    // là tiếng Trung ⇒ chứng minh đường suy luận cũ đã bị gỡ bỏ hoàn toàn.
    installDb();
    const r = await generateDailyQualitySummary({ ...JAN, reportType: "daily", language: "zh" });
    expect(r.narrativeMetadata?.generatedBy).toBe("offline");
    // ⚠ Trừ `anomalies` ra TRƯỚC — đó chính là mảnh đã làm M6 sống sót ở lượt đầu (xem boManhDaCham).
    const khuon = boManhDaCham(r.narrative, r.anomalies);
    expect(CO_HAN_TU.test(khuon), `KHUÔN narrative ngoại tuyến không phải tiếng Trung: ${khuon}`).toBe(true);
    expect(coChuCaiPhiAscii(khuon.replace(/\p{sc=Han}|[　-〿＀-￯]/gu, "")),
      `KHUÔN narrative zh còn lẫn chữ Latin có dấu / văn xuôi ngôn ngữ khác: ${khuon}`).toBe(false);
  });
});

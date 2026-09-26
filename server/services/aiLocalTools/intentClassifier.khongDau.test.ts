/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * G4-A VIỆC 2 — **GÕ KHÔNG DẤU THÌ BỘ CHỌN TOOL GẦN NHƯ MÙ.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phép đo TRƯỚC bản vá (`scripts/ai-eval/eval-toolcall.mjs`, mẫu số in kèm):
 *   accuracy CÓ DẤU **0,917** (12 ca) · KHÔNG DẤU **0,167** (12 ca) — tụt **0,750** điểm.
 *   10/12 ca không dấu trượt với **cùng một `reason`: `NO_TRIGGER_MATCH`**.
 *
 * ⚠ Đây là **lỗi KHÁC** với lớp lỗi `\b`+chữ-có-dấu mà `intentClassifier.diacritics.test.ts`
 *   canh. Bản vá kia đổi các **regex**; đường chấm điểm trigger **không có regex nào** để đổi —
 *   nó so bằng `norm.includes(trigger)` với một danh sách trigger **chỉ có bản CÓ DẤU**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LƯỚI NÀY CANH **BA** LUẬT, VÀ CANH CHÚNG **RIÊNG RẼ** — VÌ CHÚNG CÓ THỂ HỎNG NGƯỢC NHAU.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   (1) **BỎ DẤU CẢ HAI PHÍA**   ⇒ câu không dấu tìm được trigger có dấu.
 *   (2) **CHẶN NHẬP NHẰNG**      ⇒ `"lô"→"lo"`, `"tính"→"tinh"` **không** được nhận, vì chúng sẽ
 *       khớp bừa vào văn xuôi thường ngày và đẩy **DƯƠNG TÍNH GIẢ** (đang là 0,154) lên.
 *   (3) **KIỂM BIÊN**            ⇒ `"moment"` KHÔNG được trúng trigger `"mom"`.
 * Luật (1) một mình sẽ **phá** (2); luật (3) một mình sẽ **phá** chữ Hán (xem §E). Gộp ba luật
 * vào một chỉ báo duy nhất ("accuracy tăng") là cách chắc chắn nhất để không thấy cái nào hỏng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ §D KHÔNG LIỆT KÊ TRIGGER NÀO. Một danh sách viết tay luôn có phần tử thứ N+1 — và registry
 * này **được thêm trigger mỗi pha**. §D dựng lượng từ **từ registry SỐNG** và phát biểu luật
 * PHẢI-LÀ trên **MỌI** trigger đang đăng ký.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import "./index"; // side-effect: đăng ký toàn bộ 77 tool
import { listTools } from "./toolRegistry";
import {
  bienTheKhongDau,
  bienTheKhongDauDungDuoc,
  boDauTiengViet,
  chonDuocTheoTrigger,
  classifyToolIntent,
  diemTrigger,
  khopTriggerCoBien,
} from "./intentClassifier";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.resolve(HERE, "../../..");

const tool = (q: string) => classifyToolIntent(q).tool;

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §A — CẶP CÓ DẤU / KHÔNG DẤU, ĐỌC TỪ **BỘ CA CỦA CHÍNH PHÉP ĐO**
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Nguồn của §A là `scripts/ai-eval/toolcall-cases.json` — **cùng bộ ca** mà con số 0,167 được
 * đo trên đó. Chép 12 cặp ấy sang đây bằng tay sẽ đẻ ra bản sao thứ hai: sửa bộ ca mà lưới không
 * đổi (hoặc ngược lại), và hai con số sẽ nói về hai tập khác nhau.
 *
 * ⚠⚠ **SÀN SỐ CẶP** là cầu chì chống *"tập rỗng vẫn xanh"*: bộ ca bị đổi khoá `variantOf`, hay
 * file bị dời, thì §A phải **ĐỎ**, không được lặng lẽ chạy 0 ca rồi khai PASS.
 */
interface CaEval {
  id: string;
  question: string;
  expectTool: string | null;
  variantOf?: string;
  noDiacritics?: boolean;
}

const BO_CA: CaEval[] = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(GOC, "scripts/ai-eval/toolcall-cases.json"), "utf8"));
  return Array.isArray(raw) ? raw : raw.cases;
})();

const CAP = BO_CA.filter((c) => c.variantOf).map((bienThe) => ({
  bienThe,
  goc: BO_CA.find((c) => c.id === bienThe.variantOf)!,
}));

/**
 * ⚠⚠ **BẤT BIẾN ĐƯỢC PHÁT BIỂU LÀ "BỎ DẤU KHÔNG ĐỔI CÂU TRẢ LỜI", KHÔNG PHẢI "CÂU TRẢ LỜI ĐÚNG".**
 *
 * Hai thứ đó KHÁC nhau, và trộn chúng vào một ca làm lưới nói sai chỗ hỏng. Ca **A06** chứng minh
 * điều đó: `"Điện tiêu thụ 7 ngày qua thế nào?"` chọn `get_defect_trend` — và **vế CÓ DẤU cũng
 * chọn y hệt**. Đo trực tiếp điểm trigger:
 *
 *   get_defect_trend  = 14  ("7 ngày"=6 · "ngày qua"=8)
 *   get_energy_metrics = 13 ("điện tiêu thụ"=13)
 *
 * ⇒ Đây là một lượt **hoà điểm sai** của thang `trigger.length`, **có từ trước bản vá này** và
 * hoàn toàn **độc lập với dấu**. Bắt §A đỏ vì nó là nhận nhầm công: bản vá dấu **không** hứa sửa
 * thang điểm, và nếu §A canh `expectTool` thì một ngày nào đó ai đó sẽ "sửa" A06 bằng cách nắn
 * trọng số cho vừa lưới. Cái A06 **phải** thoả là bất biến thật: có dấu hay không, **cùng một
 * câu trả lời**.
 *
 * ⚠ Cầu chì chống thoả-mãn-suy-biến: `null === null` cũng thoả bất biến trên. Nên §A đòi thêm
 * **mọi vế gốc phải chọn được MỘT tool** — bản vá bị gỡ ⇒ vế không dấu về `null` ⇒ ĐỎ ngay.
 */
describe("§A — bỏ dấu KHÔNG được đổi câu trả lời", () => {
  it("bộ ca còn đủ cặp để đo (cầu chì: 0 cặp ⇒ ĐỎ, không phải 'PASS trên tập rỗng')", () => {
    expect(CAP.length).toBeGreaterThanOrEqual(12);
    for (const { goc, bienThe } of CAP) {
      expect(goc, `ca ${bienThe.id} trỏ variantOf=${bienThe.variantOf} KHÔNG tồn tại`).toBeDefined();
      // Bản không dấu phải THẬT SỰ không dấu, nếu không cả §A đo một thứ khác.
      expect(boDauTiengViet(bienThe.question), `${bienThe.id} vẫn còn dấu`).toBe(bienThe.question);
    }
  });

  for (const { goc, bienThe } of CAP) {
    it(`${bienThe.id} "${bienThe.question.slice(0, 44)}" ⇒ cùng tool với ${goc.id}`, () => {
      const cauTraLoi = tool(goc.question);
      // Cầu chì: hai vế cùng `null` cũng "bằng nhau" — chặn kiểu xanh suy biến đó tại đây.
      expect(cauTraLoi, `vế CÓ DẤU ${goc.id} không chọn được tool nào`).not.toBeNull();
      expect(tool(bienThe.question)).toBe(cauTraLoi);
    });
  }

  it("SÀN ĐỘ ĐÚNG — ≥11/12 cặp chọn ĐÚNG expectTool (mẫu số in kèm; chỉ được nâng, không hạ)", () => {
    const dung = CAP.filter(({ goc }) => tool(goc.question) === goc.expectTool);
    const truot = CAP.filter(({ goc }) => tool(goc.question) !== goc.expectTool).map((c) => c.goc.id);
    // ⚠ A06 là lượt hoà điểm 14-vs-13 nói ở trên — **nợ có trước**, không phải hồi quy của bản vá.
    expect(`${dung.length}/${CAP.length} (trượt: ${truot.join(",") || "—"})`).toBe(
      `${CAP.length - 1}/${CAP.length} (trượt: A06)`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §B — KIỂM BIÊN: chuỗi con KHÔNG có biên là một lượt khớp SAI
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Hai ca dưới đây là lỗi **đã ghi nhận**: các regex `\bmom\b` / `\bpdm\b` ở `intentClassifier.ts`
 * từ chối ĐÚNG `"moment"` / `"pdmx"`, rồi `findToolByTriggers` **vẫn nhận** — hai lớp phát biểu
 * hai luật khác nhau về cùng một chữ, và lớp lỏng hơn là lớp đang chạy.
 */
describe("§B — trigger phải khớp CÓ BIÊN, không phải chuỗi con", () => {
  it('"moment" KHÔNG được trúng trigger "mom" (get_ng_compare)', () => {
    expect(khopTriggerCoBien("moment", "mom")).toBe(false);
    expect(tool("moment")).not.toBe("get_ng_compare");
    // ĐỐI CHỨNG DƯƠNG — "mom" đứng RỜI thì vẫn phải trúng.
    expect(khopTriggerCoBien("so sanh mom di", "mom")).toBe(true);
  });

  it('"pdmx" KHÔNG được trúng trigger "pdm" (analytics_pdm_forecast)', () => {
    expect(khopTriggerCoBien("pdmx", "pdm")).toBe(false);
    expect(tool("pdmx")).not.toBe("analytics_pdm_forecast");
    expect(khopTriggerCoBien("xem pdm", "pdm")).toBe(true);
  });

  it("biên chỉ áp ở mép NÀO của trigger là ký tự từ — trigger `po ` vẫn bắt được `po 123`", () => {
    // Dấu cách cuối của trigger `"po "` CHÍNH LÀ biên phải mà tác giả cũ đã ép; áp thêm một biên
    // Unicode sau nó sẽ đòi ký tự kế không phải chữ ⇒ `po 123` hỏng (`1` là \p{N}).
    expect(khopTriggerCoBien("trang thai po 123", "po ")).toBe(true);
    // …nhưng biên TRÁI vẫn có tác dụng: `expo 123` không phải một mã PO.
    expect(khopTriggerCoBien("expo 123", "po ")).toBe(false);
  });

  it("biên nhận biết Unicode — chữ có dấu KHÔNG bị coi là ký tự-không-phải-từ", () => {
    // `\b` của JS coi `ỗ` là non-word ⇒ `\blỗi\b` là MÃ CHẾT. Lookaround `\p{L}` thì không.
    expect(khopTriggerCoBien("máy lỗi nhiều nhất", "lỗi nhiều nhất")).toBe(true);
    // và vẫn chặn được khớp-giữa-từ ở phía chữ có dấu.
    expect(khopTriggerCoBien("xlỗi nhiều nhất", "lỗi nhiều nhất")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §C — CHẶN NHẬP NHẰNG: bỏ dấu làm mất thông tin, và mất bao nhiêu thì đủ để khớp bừa
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ **CHỖ ĐO PHẢI LÀ `reason`/`clarifyMessage`, KHÔNG PHẢI `tool` — ĐÃ ĐO SAI MỘT LẦN.**
 *
 * Lượt đầu, §C khẳng định `tool(...)` **không phải** `get_lot_status` / `calc`. Cả hai ca xanh —
 * **và chúng xanh y hệt khi GỠ BỎ chặn nhập nhằng.** Vì `get_lot_status` **đòi** `orderCode` và
 * `calc` **đòi** `expression`: một lượt khớp bừa vẫn bị chặn **ở bước sau** và cùng ra `tool:null`.
 * ⇒ Phép đo cũ xác nhận *"bước kiểm tham số bắt buộc đang chạy"*, **không** xác nhận điều nó tưởng.
 *
 * ⚠ Cùng lý do đó, **`falsePositiveRate` của bộ eval MÙ với lớp lỗi này theo cấu tạo**: nó chấm
 * `tool`, mà `tool` là `null` ở cả hai bản. Đo lại bằng bộ eval: **không một tỉ lệ nào đổi**
 * (strict 0,9565 · FP 0,1538 · không dấu 0,9167 — y hệt). Đó là một sự thật về **thước đo**, không
 * phải bằng chứng rằng chặn nhập nhằng vô dụng.
 *
 * Cái ĐỔI THẬT nằm ở **câu người dùng nhận được**, đo trực tiếp:
 *   `"toi dang lo lang ve viec nay"`  (một câu lo lắng thường ngày)
 *     • CÓ chặn : `NO_TRIGGER_MATCH`, không hỏi lại  ⇒ câu đi tiếp về RAG, đúng chỗ.
 *     • BỎ chặn : `MISSING_ORDER_CODE` + hỏi lại **"Bạn muốn tra cứu lô sản xuất nào?"** ⇒ trợ lý
 *       hỏi một câu vô nghĩa về lô sản xuất.
 *   `"tinh trang cua ban the nao"` ⇒ BỎ chặn cho `INVALID_ARGS` của `calc` thay vì về RAG.
 */
describe("§C — biến thể không dấu NGẮN + MỘT TỪ bị TỪ CHỐI (không đẻ ra lượt hỏi lại vô nghĩa)", () => {
  it('"lô " ⇒ "lo" (2 ký tự, một từ) — KHÔNG được nhận', () => {
    expect(boDauTiengViet("lô ")).toBe("lo ");
    expect(bienTheKhongDauDungDuoc("lo")).toBe(false);
    expect(bienTheKhongDau("lô ")).toBeNull();
  });

  it('"tính" ⇒ "tinh" (4 ký tự, một từ) — KHÔNG được nhận', () => {
    expect(bienTheKhongDau("tính")).toBeNull();
  });

  for (const q of ["toi dang lo lang ve viec nay", "lo au qua thi khong tot cho suc khoe"]) {
    it(`"${q}" ⇒ KHÔNG hỏi lại về lô sản xuất`, () => {
      const d = classifyToolIntent(q);
      expect(d.tool).toBeNull();
      // ⚠ Hai ô này mới là chỗ đột biến đi qua — `tool` là `null` ở CẢ HAI bản (xem khối trên).
      expect(d.reason).toBe("NO_TRIGGER_MATCH");
      expect(d.clarifyMessage ?? null, "trợ lý hỏi một câu vô nghĩa về lô sản xuất").toBeNull();
    });
  }

  for (const q of ["tinh trang cua ban the nao", "cho toi biet tinh hinh chung"]) {
    it(`"${q}" ⇒ KHÔNG rơi vào \`calc\``, () => {
      const d = classifyToolIntent(q);
      expect(d.tool).toBeNull();
      expect(d.reason, "câu nghiệp vụ bị `calc` cướp rồi báo INVALID_ARGS").toBe("NO_TRIGGER_MATCH");
    });
  }

  it('"nghẽn" ⇒ "nghen" (5 ký tự) — ĐƯỢC nhận (đối chứng dương của ngưỡng)', () => {
    expect(bienTheKhongDau("nghẽn")).toBe("nghen");
  });

  it("biến thể NHIỀU TỪ luôn được nhận, không cần ngưỡng độ dài", () => {
    expect(bienTheKhongDau("hôm nay")).toBe("hom nay");
    expect(bienTheKhongDau("điện tiêu thụ")).toBe("dien tieu thu");
  });

  it("trigger KHÔNG có dấu thì KHÔNG sinh biến thể thứ hai (ASCII và CJK)", () => {
    expect(bienTheKhongDau("offline")).toBeNull();
    expect(bienTheKhongDau("pareto")).toBeNull();
    expect(bienTheKhongDau("编程手册")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §D — LƯỢNG TỪ TRÊN **REGISTRY SỐNG** (không một trigger nào được liệt kê ở đây)
// ═══════════════════════════════════════════════════════════════════════════════════════════
const MOI_TRIGGER: Array<{ tool: string; trigger: string }> = listTools()
  .filter(chonDuocTheoTrigger)
  .flatMap((t) => t.triggers.map((trigger) => ({ tool: t.name, trigger })));

describe("§D — luật PHẢI-LÀ áp cho MỌI trigger đang đăng ký", () => {
  it("có đủ trigger để đo (cầu chì chống tập rỗng)", () => {
    expect(MOI_TRIGGER.length).toBeGreaterThan(200);
  });

  it("MỌI biến thể không dấu ĐƯỢC NHẬN đều thoả luật đặc trưng (≥2 từ, hoặc ≥5 ký tự)", () => {
    const pham: string[] = [];
    for (const { tool: n, trigger } of MOI_TRIGGER) {
      const v = bienTheKhongDau(trigger.toLowerCase());
      if (v === null) continue;
      if (!(/\s/.test(v.trim()) || v.trim().length >= 5)) pham.push(`${n}:"${trigger}"→"${v}"`);
    }
    expect(pham, `biến thể quá nhập nhằng lọt vào: ${pham.join(" · ")}`).toEqual([]);
  });

  it("MỌI biến thể ĐƯỢC NHẬN đều THẬT SỰ tới được đường chấm điểm (không phải mã chết)", () => {
    // Lượng từ này canh đúng thứ đã hỏng: một biến thể được **tạo ra** nhưng không bao giờ được
    // **so**, thì tất cả vẫn xanh mà lỗ vẫn mở. Ở đây câu hỏi CHÍNH LÀ biến thể không dấu.
    const chet: string[] = [];
    for (const { tool: n, trigger } of MOI_TRIGGER) {
      const v = bienTheKhongDau(trigger.toLowerCase());
      if (v === null) continue;
      if (diemTrigger(v, v, trigger) !== trigger.length) chet.push(`${n}:"${trigger}"→"${v}"`);
    }
    expect(chet, `biến thể không dấu KHÔNG chấm được điểm: ${chet.join(" · ")}`).toEqual([]);
  });

  it("MỌI trigger vẫn phải tự khớp chính mình ở bản CÓ DẤU (bản vá không được ăn mất cái cũ)", () => {
    const chet: string[] = [];
    for (const { tool: n, trigger } of MOI_TRIGGER) {
      const t = trigger.toLowerCase();
      if (diemTrigger(t, boDauTiengViet(t), trigger) !== trigger.length) chet.push(`${n}:"${trigger}"`);
    }
    expect(chet, `trigger thành MÃ CHẾT: ${chet.join(" · ")}`).toEqual([]);
  });

  it("một trigger chỉ tính điểm MỘT LẦN, kể cả khi cả hai bản cùng khớp", () => {
    // Câu không dấu ⇒ `norm` và `normKhongDau` bằng nhau; trigger ASCII khớp CẢ HAI vế.
    expect(diemTrigger("xem pareto di", "xem pareto di", "pareto")).toBe("pareto".length);
  });

  it("CENSUS — trigger MỘT TỪ + CÓ DẤU của registry hiện tại (nguồn của ngưỡng 5)", () => {
    const motTu = MOI_TRIGGER.map(({ trigger }) => trigger.toLowerCase())
      .filter((t) => boDauTiengViet(t) !== t)
      .map((t) => ({ t, v: boDauTiengViet(t).trim() }))
      .filter(({ v }) => !/\s/.test(v));
    // ⚠ Con số này KHÔNG được khoá cứng — nó là ảnh chụp để người sau thấy tập ấy nhỏ và
    //   kiểm được bằng mắt. Cái được KHOÁ là luật ở ca trên, áp cho toàn registry.
    expect(motTu.length).toBeLessThan(12);
    expect(motTu.map((x) => x.v)).toEqual(expect.arrayContaining(["lo", "tinh"]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §E — CHỮ HÁN: BIÊN TỪ **KHÔNG** ÁP ĐƯỢC CHO CHỮ VIẾT KHÔNG TÁCH TỪ
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠⚠ §E canh một hồi quy **do chính bản vá §B đẻ ra**, và bộ eval 82 ca **KHÔNG bắt được** vì
 * bộ ca không có một câu tiếng Trung nào. Bản chỉ-có-`\p{L}`:
 *   `"查编程手册"` ⇒ null · `"我要读取文件内容"` ⇒ null   (vốn chạy được với `includes`)
 * Trong chữ Hán không có dấu cách giữa từ ⇒ đòi "hai bên không phải chữ" là đòi một điều
 * **không bao giờ đúng** ⇒ mọi trigger CJK thành MÃ CHẾT, im lặng.
 */
describe("§E — trigger chữ Hán KHÔNG bị biên từ giết", () => {
  it("trigger CJK nằm GIỮA một câu Hán vẫn khớp", () => {
    expect(khopTriggerCoBien("查编程手册", "编程手册")).toBe(true);
    expect(khopTriggerCoBien("我要读取文件内容", "读取文件")).toBe(true);
  });

  it("và đi tới tận quyết định chọn tool", () => {
    expect(tool("查编程手册")).toBe("retrieve_programming_kb");
    expect(tool("我要读取文件内容")).toBe("read_project_file");
  });

  it("ĐỐI CHỨNG — biên vẫn áp bình thường cho chữ Latin ngay cạnh chữ Hán", () => {
    expect(khopTriggerCoBien("xpareto", "pareto")).toBe(false);
  });
});

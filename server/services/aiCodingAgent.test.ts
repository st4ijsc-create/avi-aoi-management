/**
 * ★★★ doc 79 · TRỤC 1 (C) — LƯỚI CHO **CỬA GỌI MODEL** CỦA TÁC NHÂN LẬP TRÌNH.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY (mỗi cái có một đột biến giết được nó)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   §1 Chuỗi suy luận KHÔNG BAO GIỜ rời `streamCodingModel` — kể cả khi thẻ bị CHẺ ĐÔI qua hai
 *      chunk (đây là lý do bộ cắt phải GIỮ TRẠNG THÁI, không phải một `replace` một lượt).
 *      ⚠ Bề mặt này nguy hiểm hơn ops-chat một bậc: chữ ở đây còn đi tiếp vào `apply_diff` và
 *      được GHI RA ĐĨA — một khối `<think>` lọt vào tệp `.cs` là mã hỏng, im lặng.
 *   §2 Bí mật bị chẻ đôi qua hai chunk vẫn bị che (bộ che cũng giữ trạng thái).
 *   §3 Đầu ra THOÁI HOÁ ⇒ `text` RỖNG. **KHÔNG cứu phần đầu** — với MÃ thì "một nửa dùng được"
 *      là một tệp hỏng, và nếu nó đi tiếp vào `apply_diff` thì ta ghi mã hỏng ra đĩa.
 *   §4 `bocKhoiMa` lấy khối DÀI NHẤT, không phải khối đầu tiên (model hay mở đầu bằng một khối
 *      lệnh nhỏ; chọn nhầm = đề xuất ghi đè cả tệp bằng ba dòng, và MỌI hàng rào dưới đều xanh).
 *   §5 `dongBoXuongDong` giữ CRLF của tệp gốc — nếu không, một lượt sửa một dòng hiện thành diff
 *      toàn tệp và người duyệt không còn nhìn thấy thay đổi THẬT (hàng rào người-duyệt bị vô hiệu
 *      hoá bằng nhiễu, chứ không bằng một lỗ).
 *   §6 Đường SỬA TỆP đòi prompt NGUYÊN VĂN: bộ che đầu vào đổi một ký tự ⇒ NÉM, không đề xuất.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  /** Các mảnh mà engine giả sẽ phát ra, theo thứ tự. */
  manh: [] as string[],
  /** modelId mà `generateTextStream` nhận được ở lượt gần nhất. */
  modelIdNhan: undefined as string | undefined,
  /** options mà `generateTextStream` nhận được ở lượt gần nhất. */
  optNhan: null as any,
}));

vi.mock("./aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  generateText: vi.fn(),
  chatCompletion: vi.fn(),
  generateEmbedding: vi.fn(),
  generateTextStream: async function* (opt: any, modelId?: string) {
    h.optNhan = opt;
    h.modelIdNhan = modelId;
    for (const m of h.manh) yield { type: "token", token: m };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: h.manh.length };
  },
}));

// Gateway ghi sổ đo qua DB — không có DB trong lưới đơn vị.
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => ({ insert: () => ({ values: async () => undefined }) })) }));

import {
  bocKhoiMa,
  codingEditEnabled,
  codingGenEnabled,
  dongBoXuongDong,
  nhanNgonNgu,
  personaSinhMa,
  rutChuCoCanh,
  streamCodingModel,
  tranTokenChoTep,
} from "./aiCodingAgent";

const NOI_TAM = "Người dùng hỏi C#. Ta cứ bịa một API cho có vẻ chắc chắn.";
const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const ENV = [
  "AI_CODING_GEN", "AI_CODING_EDIT", "AI_CODING_MODEL_TASK", "AI_SAFETY_ENABLED",
  "AI_THINKING_TAGS", "AI_THINKING_STARTS_OPEN",
] as const;

beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  h.manh = [];
  h.modelIdNhan = undefined;
  h.optNhan = null;
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

async function gom(manh: string[], them: Partial<Parameters<typeof streamCodingModel>[0]> = {}): Promise<string> {
  h.manh = manh;
  let ra = "";
  for await (const m of streamCodingModel({ systemPrompt: "S", prompt: "P", maxTokens: 512, ...them })) ra += m;
  return ra;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — chuỗi suy luận KHÔNG rời cửa gọi model (bộ cắt GIỮ TRẠNG THÁI)", () => {
  it("★★★ khối <think> trọn trong MỘT chunk bị cắt sạch", async () => {
    const ra = await gom([`<think>${NOI_TAM}</think>`, "```csharp\nclass A {}\n```"]);
    expect(ra).not.toContain(NOI_TAM);
    expect(ra).not.toContain("<think>");
    expect(ra).toContain("class A {}");
  });

  it("★★★ thẻ CHẺ ĐÔI qua hai chunk vẫn bị cắt (một `replace` một lượt sẽ TRƯỢT ca này)", async () => {
    const ra = await gom(["<thi", "nk>", NOI_TAM, "</thi", "nk>", "xong"]);
    expect(ra).not.toContain(NOI_TAM);
    expect(ra).not.toContain("think");
    expect(ra.trim()).toBe("xong");
  });

  it("★★ thẻ LỒNG NHAU + thẻ tên khác (<reasoning>) cũng sạch", async () => {
    const ra = await gom([`<reasoning>${NOI_TAM}<think>lồng</think>còn sót</reasoning>KẾT`]);
    expect(ra).not.toContain(NOI_TAM);
    expect(ra).not.toContain("lồng");
    expect(ra).not.toContain("còn sót");
    expect(ra).toContain("KẾT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — bí mật bị chẻ đôi qua hai chunk vẫn bị CHE", () => {
  it("★★ nửa đầu ở chunk này, nửa sau ở chunk sau ⇒ không rò nguyên khoá", async () => {
    const a = BI_MAT.slice(0, 12);
    const b = BI_MAT.slice(12);
    const ra = await gom(["token=", a, b, " hết"]);
    expect(ra).not.toContain(BI_MAT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — canh thoái hoá: với MÃ thì KHÔNG cứu phần đầu", () => {
  async function chay(manh: string[]) {
    h.manh = manh;
    const it = rutChuCoCanh(streamCodingModel({ systemPrompt: "S", prompt: "P", maxTokens: 4096 }));
    for (;;) {
      const n = await it.next();
      if (n.done) return n.value;
    }
  }

  it("★★★ đầu ra sạch ⇒ text = nguyên văn, degraded=false", async () => {
    const kq = await chay(["```ts\nexport const a = 1;\n```"]);
    expect(kq.degraded).toBe(false);
    expect(kq.text).toContain("export const a = 1;");
  });

  /** Phần đầu dài & sạch — `guardGeneratedText` CÓ THỂ cứu nó; đường mã thì KHÔNG được nhận. */
  const DAU_SACH =
    "// Day la mot doan mo dau hoan toan binh thuong va du dai de bo guard coi la cuu duoc, hon 80 ky tu.\n";

  it("★★★ vòng lặp thoái hoá ⇒ text RỖNG (không có 'phần đầu cứu được')", async () => {
    const kq = await chay([DAU_SACH, ...Array(400).fill("cell ")]);
    expect(kq.degraded).toBe(true);
    expect(kq.text, "một tệp bị cắt cụt vẫn là tệp HỎNG — không được đưa cho apply_diff").toBe("");
    expect(kq.reason).not.toBe("");
  });

  /**
   * ⚠ ĐỘT BIẾN M6 TỪNG SỐNG SÓT Ở ĐÂY. Ca trên bị **cổng giữa luồng** bắt trước, nên nó không hề
   * phát biểu gì về `guardGeneratedText` ở CUỐI — đổi dòng ấy sang "trả phần đầu cứu được" vẫn xanh.
   * Ca này giữ luồng NGẮN hơn ngưỡng canh giữa chừng, nên chỉ còn guard cuối chịu trách nhiệm.
   */
  it("★★★ luồng NGẮN, chỉ guard CUỐI bắt được ⇒ vẫn RỖNG (giết đột biến 'cứu phần đầu')", async () => {
    const kq = await chay([DAU_SACH, ...Array(60).fill("cell ")]); // < ngưỡng canh giữa chừng
    expect(kq.degraded).toBe(true);
    expect(kq.text).toBe("");
  });

  /**
   * ⚠⚠ KHAI THẲNG MỘT ĐỘT BIẾN **TƯƠNG ĐƯƠNG** (M6b), đã đo chứ không đoán: đổi
   * `return {text:"",…}` ở cổng giữa luồng thành `break` **KHÔNG bị ca nào bắt, và đó là ĐÚNG** —
   * `break` cũng thoát vòng `for await` nên số mảnh phát ra y hệt, rồi `guardGeneratedText` ở cuối
   * ra CÙNG phán quyết (rỗng + degraded). Khác biệt duy nhất là chuỗi `reason`. Đây là phòng vệ
   * theo chiều sâu, không phải một lỗ; ghi ra đây để người sau không đi tìm một ca không tồn tại.
   *
   * Ca dưới vẫn có giá trị riêng: nó khoá bất biến *"người dùng không phải nhận hàng trăm mảnh rác"*
   * — thứ sẽ ĐỎ nếu ai đó bỏ HẲN cổng giữa luồng (không phải đổi `return` thành `break`).
   */
  it("★★★ cổng giữa luồng CẮT NGANG — người dùng không phải nhận hết 400 mảnh rác", async () => {
    h.manh = [DAU_SACH, ...Array(400).fill("cell ")];
    const it = rutChuCoCanh(streamCodingModel({ systemPrompt: "S", prompt: "P", maxTokens: 4096 }));
    let soManh = 0;
    for (;;) {
      const n = await it.next();
      if (n.done) break;
      soManh++;
    }
    expect(soManh, "không cắt ngang ⇒ 401 mảnh rác tới người dùng").toBeLessThan(200);
    expect(soManh).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — bocKhoiMa lấy khối DÀI NHẤT", () => {
  it("★★★ khối lệnh nhỏ đứng TRƯỚC không được thắng khối tệp thật", () => {
    const tra = [
      "Chạy thử bằng:",
      "```bash",
      "dotnet test",
      "```",
      "Tệp sau khi sửa:",
      "```csharp",
      "namespace X;",
      "public class Calculator { public double Divide(double a, double b) => a / b; }",
      "```",
    ].join("\n");
    const boc = bocKhoiMa(tra);
    expect(boc).toContain("namespace X;");
    expect(boc).not.toContain("dotnet test");
  });

  it("★ không có khối nào ⇒ null (người gọi TỪ CHỐI, không đoán)", () => {
    expect(bocKhoiMa("Tôi nghĩ bạn nên thêm một phép kiểm.")).toBeNull();
  });

  it("★ khối không khai ngôn ngữ vẫn bóc được", () => {
    expect(bocKhoiMa("```\nabc\n```")).toBe("abc\n");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — dongBoXuongDong giữ đúng kiểu kết thúc dòng của tệp GỐC", () => {
  it("★★★ gốc CRLF + model phát LF ⇒ ra CRLF (nếu không: diff toàn tệp, người duyệt bị nhiễu)", () => {
    const goc = "a\r\nb\r\n";
    expect(dongBoXuongDong(goc, "a\nb2\n")).toBe("a\r\nb2\r\n");
  });
  it("★★ gốc LF ⇒ ra LF kể cả khi model phát CRLF", () => {
    expect(dongBoXuongDong("a\nb\n", "a\r\nb2\r\n")).toBe("a\nb2\n");
  });
  it("★ gốc kết bằng dòng mới ⇒ bản mới cũng vậy", () => {
    expect(dongBoXuongDong("a\n", "a2")).toBe("a2\n");
    expect(dongBoXuongDong("a", "a2\n")).toBe("a2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — đường SỬA TỆP đòi prompt NGUYÊN VĂN (fail-closed)", () => {
  it("★★★ bộ che đầu vào đổi prompt ⇒ NÉM `CODING_PROMPT_REDACTED`, KHÔNG sinh chữ", async () => {
    process.env.AI_SAFETY_ENABLED = "true";
    h.manh = ["không bao giờ tới đây"];
    const it = streamCodingModel({
      systemPrompt: "S",
      // Chuỗi này bị `applySafety` che ⇒ `plan.safeText !== prompt`.
      prompt: `nội dung tệp có ${BI_MAT} bên trong`,
      maxTokens: 128,
      nguyenVanPrompt: true,
    });
    await expect(it.next()).rejects.toThrow(/CODING_PROMPT_REDACTED/);
  });

  it("★★ cùng prompt ấy nhưng KHÔNG đòi nguyên văn (đường sinh mã) ⇒ vẫn chạy", async () => {
    process.env.AI_SAFETY_ENABLED = "true";
    const ra = await gom(["ok"], { prompt: `có ${BI_MAT} bên trong` });
    expect(ra).toContain("ok");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§7 — cờ, model tier và các hàm phụ", () => {
  it("★★★ cả hai cờ MẶC ĐỊNH BẬT (không có cờ ⇒ chủ dự án vẫn thấy hỏng)", () => {
    expect(codingGenEnabled()).toBe(true);
    expect(codingEditEnabled()).toBe(true);
  });

  it("★★★ `AI_CODING_GEN=0` ⇒ TẮT; `AI_CODING_EDIT=0` ⇒ TẮT (công tắc có thật)", () => {
    process.env.AI_CODING_GEN = "0";
    process.env.AI_CODING_EDIT = "0";
    expect(codingGenEnabled()).toBe(false);
    expect(codingEditEnabled()).toBe(false);
  });

  it("★★ mặc định đi tier `chat` (model llama-server ĐANG GIỮ) — xem khối ⚠ VRAM ở đầu module", async () => {
    const { route } = await import("./aiModelRouter");
    await gom(["x"]);
    expect(h.modelIdNhan).toBe(route({ task: "chat", text: "P" }).modelId);
  });

  it("★★ `AI_CODING_MODEL_TASK=code` mới đổi sang model Coder (opt-in có ý thức)", async () => {
    const { route } = await import("./aiModelRouter");
    process.env.AI_CODING_MODEL_TASK = "code";
    await gom(["x"]);
    expect(h.modelIdNhan).toBe(route({ task: "code", text: "P" }).modelId);
  });

  it("★ trần token đủ chở CẢ tệp (thiếu token ⇒ tệp cụt ⇒ đề xuất ghi mã hỏng)", () => {
    expect(tranTokenChoTep(1105)).toBeGreaterThan(1105 / 2.6);
    expect(tranTokenChoTep(10)).toBeGreaterThanOrEqual(1_400);
    expect(tranTokenChoTep(10_000_000)).toBeLessThanOrEqual(12_000);
  });

  it("★ nhãn ngôn ngữ theo đuôi tệp (C# là stack THẬT của dự án thử)", () => {
    expect(nhanNgonNgu("src/Calculator.cs")).toBe("csharp");
    expect(nhanNgonNgu("src/validate.mjs")).toBe("javascript");
    expect(nhanNgonNgu("a/b.tsx")).toBe("tsx");
  });

  it("★★★ persona KHÔNG phải trợ lý vận hành: cấm [1][2] và cấm câu 'liên hệ kỹ sư kỹ thuật'", () => {
    const p = personaSinhMa("vi", "");
    expect(p).toContain("KỸ SƯ LẬP TRÌNH");
    expect(p).toContain("[1]");
    expect(p).toContain("liên hệ kỹ sư kỹ thuật");
    expect(p).not.toContain("OEE của line");
  });

  it("★★ ngữ cảnh dự án được NỐI vào persona (không có nó, model trả lời ngoài không khí)", () => {
    const p = personaSinhMa("vi", "=== Dự án đang mở ===\nTên: Demo Csharp");
    expect(p).toContain("Demo Csharp");
  });
});

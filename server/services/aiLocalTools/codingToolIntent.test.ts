/**
 * ★★★ doc 79 · TRỤC 1 (B) — LƯỚI CHO BỘ CHỌN TOOL **CHẾ ĐỘ LẬP TRÌNH**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẤT BIẾN ĐƯỢC PHÁT BIỂU Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **CỔNG RA CỦA TRỤC 1** — "đọc server/routers.ts …" ⇒ `read_file` với `path` NGUYÊN VĂN. Đây là
 *      phép đo đã ĐỎ trên Playwright hôm nay; lưới đơn vị này khoá nó ở mức tất định.
 *   2. **TÁCH BIỆT A/B** — bộ chọn lập trình KHÔNG BAO GIỜ chọn một tool VẬN HÀNH (get_oee, …); và
 *      `classifyToolIntent` (vận hành) KHÔNG đổi. Cùng một câu hỏi vận hành cho hai kết quả KHÁC
 *      nhau ở hai bộ chọn ⇒ hai đường độc lập.
 *   3. **CHỈ 5 TOOL** — mọi quyết định của bộ chọn lập trình nằm trong `CODING_TOOL_NAMES`.
 */
import { describe, it, expect } from "vitest";
import "./index"; // đăng ký toàn bộ tool (side-effect)
import {
  classifyCodingToolIntent,
  classifyCodingToolIntentLLM,
  classifyToolIntent,
  CODING_TOOL_NAMES,
} from "./intentClassifier";

const CODING = new Set<string>(CODING_TOOL_NAMES);

describe("§1 — CỔNG RA: đường dẫn repo ⇒ read_file (phép đo đã ĐỎ trên Playwright)", () => {
  it("★★★ 'đọc server/routers.ts và cho biết export gì' ⇒ read_file, path nguyên văn", () => {
    const d = classifyCodingToolIntent("đọc server/routers.ts và cho biết export gì");
    expect(d.tool).toBe("read_file");
    expect(d.args.path).toBe("server/routers.ts");
  });

  it("★★ tên tệp TRẦN (không có '/') vẫn ⇒ read_file", () => {
    const d = classifyCodingToolIntent("mở toolRegistry.ts giúp tôi");
    expect(d.tool).toBe("read_file");
    expect(d.args.path).toBe("toolRegistry.ts");
  });

  it("★★ đường dẫn sâu ⇒ read_file", () => {
    const d = classifyCodingToolIntent("xem client/src/pages/AICodingWorkspace.tsx");
    expect(d.tool).toBe("read_file");
    expect(d.args.path).toBe("client/src/pages/AICodingWorkspace.tsx");
  });
});

describe("§2 — grep_repo: ý định TÌM + trích được mẫu", () => {
  it("★★★ 'Tìm nơi gọi executeDecision trong repo' ⇒ grep_repo, pattern=executeDecision (không phải 'nơi')", () => {
    const d = classifyCodingToolIntent("Tìm nơi gọi executeDecision trong repo");
    expect(d.tool).toBe("grep_repo");
    expect(d.args.pattern).toBe("executeDecision");
  });

  it("★★ mẫu trong nháy được ưu tiên", () => {
    const d = classifyCodingToolIntent('tìm chuỗi "AI_TOOL_LLM_FALLBACK" trong mã');
    expect(d.tool).toBe("grep_repo");
    expect(d.args.pattern).toBe("AI_TOOL_LLM_FALLBACK");
  });
});

describe("§3 — run_command: một lệnh danh sách trắng xuất hiện nguyên văn", () => {
  const cases: Array<[string, string]> = [
    ["Chạy npm run check rồi đọc lỗi", "npm run check"],
    ["chạy npm run check:tests", "npm run check:tests"],
    ["npx vitest run server/services/aiLocalTools/codingToolIntent.test.ts", "npx vitest run server/services/aiLocalTools/codingToolIntent.test.ts"],
    ["chạy dotnet test sandbox-projects/csharp-demo/CalculatorDemo.sln", "dotnet test sandbox-projects/csharp-demo/CalculatorDemo.sln"],
    ["dotnet build sandbox-projects/csharp-demo", "dotnet build sandbox-projects/csharp-demo"],
    ["node --test sandbox-projects/react-pg-demo/test/validate.test.mjs", "node --test sandbox-projects/react-pg-demo/test/validate.test.mjs"],
    ["cho tôi git status", "git status"],
  ];
  for (const [q, cmd] of cases) {
    it(`★★ "${q}" ⇒ run_command "${cmd}"`, () => {
      const d = classifyCodingToolIntent(q);
      expect(d.tool).toBe("run_command");
      expect(d.args.command).toBe(cmd);
    });
  }
});

describe("§4 — list_files: một thư mục repo (không đuôi tệp)", () => {
  it("★★ 'liệt kê thư mục server/services' ⇒ list_files path=server/services", () => {
    const d = classifyCodingToolIntent("liệt kê thư mục server/services");
    expect(d.tool).toBe("list_files");
    expect(d.args.path).toBe("server/services");
  });
});

describe("§5 — TÁCH BIỆT A/B: bộ chọn lập trình KHÔNG chọn tool vận hành", () => {
  const vanHanh = [
    "OEE hôm nay của line 2 bao nhiêu",
    "máy nào đang offline",
    "top 5 lỗi tuần này",
    "sản lượng hôm nay",
  ];
  for (const q of vanHanh) {
    it(`★★★ "${q}" ⇒ KHÔNG tool (CODING_NO_MATCH), KHÔNG rơi vào tool vận hành`, () => {
      const d = classifyCodingToolIntent(q);
      expect(d.tool, `bộ chọn lập trình phải BỎ QUA câu vận hành: ${JSON.stringify(d)}`).toBeNull();
    });
  }

  it("★★★ ĐỐI CHỨNG — cùng câu 'OEE …', bộ chọn VẬN HÀNH VẪN chọn get_oee (đường vận hành không đổi)", () => {
    const d = classifyToolIntent("OEE hôm nay của line 2 bao nhiêu");
    expect(d.tool, "classifyToolIntent (vận hành) phải giữ nguyên hành vi — chọn get_oee").toBe("get_oee");
  });
});

describe("§6 — MỌI quyết định của bộ chọn lập trình nằm trong 5 tool lập trình", () => {
  const mau = [
    "đọc server/routers.ts",
    "Tìm nơi gọi executeDecision",
    "chạy npm run check",
    "liệt kê thư mục shared",
    "OEE hôm nay", // → null, cũng hợp lệ (không nằm ngoài tập)
  ];
  for (const q of mau) {
    it(`★ "${q}" ⇒ tool ∈ {5 tool lập trình} hoặc null`, () => {
      const d = classifyCodingToolIntent(q);
      if (d.tool !== null) expect(CODING.has(d.tool), `${d.tool} không thuộc 5 tool lập trình`).toBe(true);
    });
  }
});

describe("§7 — LLM giới hạn tool: cổng bật/tắt độc lập với AI_TOOL_LLM_FALLBACK", () => {
  it("★ AI_CODING_TOOL_LLM=0 ⇒ trả CODING_LLM_DISABLED, KHÔNG gọi engine", async () => {
    const cu = process.env.AI_CODING_TOOL_LLM;
    process.env.AI_CODING_TOOL_LLM = "0";
    try {
      const d = await classifyCodingToolIntentLLM("đọc server/routers.ts");
      expect(d.tool).toBeNull();
      expect(d.reason).toBe("CODING_LLM_DISABLED");
    } finally {
      if (cu === undefined) delete process.env.AI_CODING_TOOL_LLM;
      else process.env.AI_CODING_TOOL_LLM = cu;
    }
  });
});

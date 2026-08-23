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
  chanLenhKhiCauHoi,
  classifyCodingToolIntent,
  classifyCodingToolIntentLLM,
  classifyToolIntent,
  CODING_TOOL_NAMES,
  laCauCanSuyLuan,
  trichDuongSuaTatDinh,
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

  // doc 79 — C# (dự án thử): `.cs`/`.csproj`/`.sln` phải được NHẬN là đường dẫn, nếu không câu
  // "đọc Calculator.cs" không chọn được read_file và AI không code được C#. `REPO_PATH_REGEX` +
  // `DUOI_CHO_PHEP` cùng mở cho ba đuôi này.
  it("★★★ '.cs' ⇒ read_file (AI code được C#, không chỉ TypeScript)", () => {
    const d = classifyCodingToolIntent("đọc sandbox-projects/csharp-demo/src/Calculator.cs");
    expect(d.tool).toBe("read_file");
    expect(d.args.path).toBe("sandbox-projects/csharp-demo/src/Calculator.cs");
  });

  it("★★ '.csproj' cũng ⇒ read_file", () => {
    const d = classifyCodingToolIntent("mở CalculatorDemo.csproj");
    expect(d.tool).toBe("read_file");
    expect(d.args.path).toBe("CalculatorDemo.csproj");
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 · UX LÔ 1 — §8 (C1): TOKEN VĂN XUÔI KHÔNG BỊ NUỐT VÀO Ô ĐỐI SỐ LỆNH
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Sự việc live: "Chạy dotnet test và cho tôi biết…" ⇒ lệnh trích = `dotnet test và` ⇒ CMD_METACHAR
 * về một lệnh người dùng KHÔNG gõ. ĐỘT BIẾN PHẢI BẮT: bỏ phép cắt (`laTokenVanXuoi`) ⇒ 8.2 ĐỎ;
 * cắt QUÁ TAY (nuốt cả đường dẫn thật) ⇒ 8.1/8.3 ĐỎ.
 */
describe("§8 (C1) — trích lệnh cắt tại token văn xuôi đầu tiên", () => {
  it("★★★ 8.1 ORACLE — 'Chạy dotnet test CalculatorDemo.sln và cho tôi biết kết quả' ⇒ lệnh trích ĐÚNG BẰNG 'dotnet test CalculatorDemo.sln'", () => {
    const d = classifyCodingToolIntent("Chạy dotnet test CalculatorDemo.sln và cho tôi biết kết quả");
    expect(d.tool).toBe("run_command");
    expect(d.args.command).toBe("dotnet test CalculatorDemo.sln");
  });

  it("★★★ 8.2 KHÔNG có đường dẫn — chữ 'và' KHÔNG bị nuốt: lệnh cụt 'dotnet test' (danh sách trắng sẽ nói 'thiếu đường dẫn', không phải 'ký tự cấm')", () => {
    const d = classifyCodingToolIntent("Chạy dotnet test và cho tôi biết kết quả");
    expect(d.tool).toBe("run_command");
    expect(d.args.command).toBe("dotnet test");
  });

  it("★★ 8.3 từ nối ASCII thuần ('xong', 'roi' — gõ không dấu) cũng bị cắt; đường dẫn thật KHÔNG bị cắt", () => {
    expect(classifyCodingToolIntent("dotnet test xong cho tôi biết").args.command).toBe("dotnet test");
    expect(classifyCodingToolIntent("dotnet build roi bao ket qua").args.command).toBe("dotnet build");
    // đường dẫn thật (có '/', có đuôi) đi qua NGUYÊN VĂN — chống vá quá tay.
    expect(classifyCodingToolIntent("dotnet test tests/CalculatorDemo.Tests.csproj xong báo tôi").args.command).toBe(
      "dotnet test tests/CalculatorDemo.Tests.csproj",
    );
  });

  it("★★ 8.4 'npx vitest run và …' / 'node --test rồi …' — cùng luật cho hai ô tự do còn lại", () => {
    expect(classifyCodingToolIntent("npx vitest run và đọc lỗi giúp tôi").args.command).toBe("npx vitest run");
    expect(classifyCodingToolIntent("chạy node --test rồi tóm tắt").args.command).toBe("node --test");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 · UX LÔ 1 — §9 (C3): "sửa <đường>:" LÀ MỘT VỊ TỪ TẤT ĐỊNH
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§9 (C3) — trichDuongSuaTatDinh: khớp thì 10/10, không khớp thì null", () => {
  it("★★★ 9.1 — mười lần chạy cùng câu ⇒ mười lần cùng một đường (KHÔNG một model nào được hỏi)", () => {
    for (let i = 0; i < 10; i++) {
      expect(trichDuongSuaTatDinh("sửa src/Calculator.cs: thêm chú thích cho Divide")).toBe("src/Calculator.cs");
    }
  });

  it("★★ 9.2 — các biến thể động từ + dấu ngăn đều vào: sua/fix/chỉnh sửa · `：` · ` — ` · ` - `", () => {
    expect(trichDuongSuaTatDinh("sua src/App.tsx: doi mau nut")).toBe("src/App.tsx");
    expect(trichDuongSuaTatDinh("fix server/routers.ts： vá lỗi import")).toBe("server/routers.ts");
    expect(trichDuongSuaTatDinh("chỉnh sửa src/validate.mjs — thêm trim")).toBe("src/validate.mjs");
    expect(trichDuongSuaTatDinh("sửa src/a-b.cs - thêm chú thích")).toBe("src/a-b.cs");
  });

  it("★★★ 9.3 CA ÂM — không đường dẫn / không dấu ngăn / hai tệp / câu vòng tự động ⇒ null (đi đường cũ)", () => {
    expect(trichDuongSuaTatDinh("sửa hàm Divide cho tôi")).toBeNull();
    expect(trichDuongSuaTatDinh("sửa src/Calculator.cs để Divide ném lỗi")).toBeNull(); // không dấu ngăn ⇒ cửa cũ
    expect(trichDuongSuaTatDinh("sửa src/a.cs và src/b.cs: cùng một việc")).toBeNull(); // ≥2 tệp ⇒ đường LÔ cũ
    expect(
      trichDuongSuaTatDinh("sửa Calc.cs để khắc phục lỗi sau khi chạy `dotnet test X`. Đây là đầu ra THẬT:"),
    ).toBeNull(); // hình dạng câu bộ điều khiển vòng phát — §5.5 aiCodingMode.stream ghim hành vi cũ
    expect(trichDuongSuaTatDinh("đọc src/Calculator.cs: có gì")).toBeNull(); // động từ ĐỌC không phải SỬA
    expect(trichDuongSuaTatDinh("")).toBeNull();
  });

  it("★★ 9.4 — tên tệp có `-` không bị cắt cụt bởi dấu ngăn `-` (dấu ngăn ĐÒI khoảng trắng trước)", () => {
    expect(trichDuongSuaTatDinh("sửa sandbox-projects/csharp-demo/src/Calculator.cs: thêm XML doc")).toBe(
      "sandbox-projects/csharp-demo/src/Calculator.cs",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 · UX LÔ 1 — §10 (C2-ii): CÂU HỎI KHÔNG ĐẺ RA THẺ `run_command`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("§10 (C2-ii) — chanLenhKhiCauHoi: A/B hai chiều", () => {
  const RUN = { tool: "run_command", args: { command: "dotnet test X" }, reason: "CODING_RUN_SHORTCUT" } as const;

  it("★★★ 10.1 — câu HỎI ('vì sao … đỏ?', 'xanh chưa?') ⇒ quyết định run_command bị THU về null", () => {
    for (const q of [
      "vì sao dotnet test CalculatorDemo.sln đỏ?",
      "xanh chưa?",
      "test đã pass chưa",
      "kết luận giúp tôi: xanh hay đỏ",
      "kết quả thế nào rồi",
    ]) {
      const d = chanLenhKhiCauHoi(q, { ...RUN, args: { ...RUN.args } });
      expect(d.tool, q).toBeNull();
      expect(d.reason).toBe("CODING_RUN_BI_CHAN_CAU_HOI");
    }
  });

  it("★★★ 10.2 CHỐNG VÁ QUÁ TAY — mệnh lệnh chạy tường minh VẪN ra lệnh (câu có cả 'kết quả')", () => {
    for (const q of [
      "Chạy dotnet test CalculatorDemo.sln và cho tôi biết kết quả",
      "hãy chạy npm run check rồi đọc lỗi",
      "thực thi git status",
      "run npm run check and summarize",
    ]) {
      const d = chanLenhKhiCauHoi(q, { ...RUN, args: { ...RUN.args } });
      expect(d.tool, q).toBe("run_command");
    }
  });

  it("★★★ 10.3 — bộ lọc CHỈ đụng run_command: read/grep của một câu hỏi đi qua nguyên vẹn", () => {
    const doc = { tool: "read_file", args: { path: "src/a.cs" }, reason: "CODING_READ_SHORTCUT" };
    expect(chanLenhKhiCauHoi("vì sao src/a.cs đỏ?", { ...doc, args: { ...doc.args } }).tool).toBe("read_file");
    const khong = { tool: null, args: {}, reason: "CODING_NO_MATCH" };
    expect(chanLenhKhiCauHoi("xanh chưa?", khong).reason).toBe("CODING_NO_MATCH");
  });

  it("★★ 10.4 — ĐẦU-CUỐI qua bộ chọn tất định: 'vì sao dotnet test X đỏ?' KHÔNG còn là run_command sau bộ lọc", () => {
    const d0 = classifyCodingToolIntent("vì sao dotnet test CalculatorDemo.sln đỏ?");
    // bộ chọn TẤT ĐỊNH vẫn thấy lệnh trong câu (hành vi cũ không đổi một byte)…
    expect(d0.tool).toBe("run_command");
    // …và bộ lọc ở điểm hẹp (`chonToolLapTrinh`) là nơi thu nó về null.
    expect(chanLenhKhiCauHoi("vì sao dotnet test CalculatorDemo.sln đỏ?", d0).tool).toBeNull();
  });

  it("★★ 10.5 — vị từ nền `laCauCanSuyLuan` nhận thêm đúng các hình dạng C2 (và giữ ca cũ)", () => {
    for (const q of ["xanh chưa?", "kết luận: xanh hay đỏ", "dotnet test xong chưa?", "did the tests pass?"]) {
      expect(laCauCanSuyLuan(q), q).toBe(true);
    }
    for (const q of ["Chạy dotnet test X và cho tôi biết kết quả", "đọc src/a.cs và cho biết có gì", "liệt kê thư mục src"]) {
      expect(laCauCanSuyLuan(q), q).toBe(false);
    }
  });
});

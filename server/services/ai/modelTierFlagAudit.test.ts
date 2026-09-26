/**
 * modelTierFlagAudit — G1-C (2026-08-16).
 *
 * Canh cái cơ chế dựng ra để lớp lỗi *"cờ khai BẬT mà tầng chết, KHÔNG có gì đỏ"* không thể im
 * lặng lần nữa. Hai nhóm ca:
 *   1. Ngữ nghĩa của bộ kiểm tra (bảng tiêm vào, không phụ thuộc đĩa thật).
 *   2. ★ BẢNG SẢN XUẤT THẬT (`TIER_FLAG_SPECS`) — tái dựng ĐÚNG cấu hình lệch đã tìm thấy hôm nay
 *      và đòi nó phải kêu. Đây là phần chống "lưới canh một bảng đồ chơi trong khi bảng thật rỗng".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  auditModelTierFlags,
  reportModelTierFlags,
  TIER_FLAG_SPECS,
  type TierFlagProbes,
  type TierFlagSpec,
} from "./modelTierFlagAudit";

/** Bộ dò tiêm: không chạm đĩa. Mặc định "không có gì tồn tại". */
function probes(present: string[] = []): TierFlagProbes {
  const set = new Set(present);
  return { ggufExists: (b) => set.has(b), pathExists: (p) => set.has(p) };
}

// vitest.setup nạp .env THẬT ⇒ phải xoá tay mọi biến các ca này quan tâm, nếu không ca sẽ đọc
// cấu hình của máy dev và xanh/đỏ theo môi trường chứ không theo ý định của ca.
const TOUCHED = [
  "AI_THINKING_TIER_ENABLED", "GGUF_THINKING_MODEL",
  "AI_CODE_ROUTER_ENABLED", "GGUF_CODE_MODEL", "GGUF_FIM_MODEL",
  "GGUF_DEFAULT_MODEL", "GGUF_FAST_MODEL",
  "RAG_RERANKER_ENABLED", "RAG_RERANKER_MODE", "GGUF_RERANKER_MODEL",
  "LLAMA_SERVER_BIN", "GGUF_VISION_MODEL", "GGUF_VISION_MMPROJ",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of TOUCHED) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const oneSpec: TierFlagSpec[] = [
  {
    label: "demo",
    isOn: () => (process.env.DEMO_FLAG || "") === "true",
    onCondition: "DEMO_FLAG",
    requires: [
      { env: "DEMO_MODEL", kind: "basename", requiredWhenOn: true, impact: "tầng demo chết" },
    ],
  },
];

describe("auditModelTierFlags — ngữ nghĩa", () => {
  afterEach(() => {
    delete process.env.DEMO_FLAG;
    delete process.env.DEMO_MODEL;
  });

  it("cờ TẮT ⇒ im lặng, kể cả khi model vắng mặt (cấu hình TRUNG THỰC không phải lỗi)", async () => {
    process.env.DEMO_FLAG = "false";
    expect(await auditModelTierFlags(probes(), oneSpec)).toEqual([]);
  });

  it("cờ BẬT + env CHƯA GÁN ⇒ báo 'unset' (đúng lớp lỗi G1-C)", async () => {
    process.env.DEMO_FLAG = "true";
    const f = await auditModelTierFlags(probes(), oneSpec);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ env: "DEMO_MODEL", problem: "unset" });
    expect(f[0].reason).toMatch(/chưa được gán/);
  });

  it("cờ BẬT + env có giá trị nhưng file KHÔNG có trên đĩa ⇒ báo 'missing' kèm giá trị", async () => {
    process.env.DEMO_FLAG = "true";
    process.env.DEMO_MODEL = "khong-ton-tai";
    const f = await auditModelTierFlags(probes(), oneSpec);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ problem: "missing", value: "khong-ton-tai" });
  });

  it("cờ BẬT + model CÓ THẬT ⇒ im lặng", async () => {
    process.env.DEMO_FLAG = "true";
    process.env.DEMO_MODEL = "co-that";
    expect(await auditModelTierFlags(probes(["co-that"]), oneSpec)).toEqual([]);
  });

  it("strip '.gguf' trước khi tra (env hay ghi kèm đuôi)", async () => {
    process.env.DEMO_FLAG = "true";
    process.env.DEMO_MODEL = "co-that.gguf";
    expect(await auditModelTierFlags(probes(["co-that"]), oneSpec)).toEqual([]);
  });

  it("requiredWhenOn:false ⇒ env rỗng KHÔNG báo, nhưng gán-mà-thiếu-file thì CÓ", async () => {
    const optional: TierFlagSpec[] = [
      {
        label: "opt",
        isOn: () => true,
        onCondition: "luôn bật",
        requires: [{ env: "OPT_MODEL", kind: "basename", requiredWhenOn: false, impact: "ném khi nạp" }],
      },
    ];
    delete process.env.OPT_MODEL;
    expect(await auditModelTierFlags(probes(), optional)).toEqual([]);
    process.env.OPT_MODEL = "thieu";
    expect(await auditModelTierFlags(probes(), optional)).toHaveLength(1);
    delete process.env.OPT_MODEL;
  });

  it("vị từ isOn ném ⇒ coi như TẮT, KHÔNG làm hỏng cả lượt audit", async () => {
    const boom: TierFlagSpec[] = [
      {
        label: "boom",
        isOn: () => {
          throw new Error("x");
        },
        onCondition: "n/a",
        requires: [{ env: "B", kind: "basename", requiredWhenOn: true, impact: "i" }],
      },
      ...oneSpec,
    ];
    process.env.DEMO_FLAG = "true";
    const f = await auditModelTierFlags(probes(), boom);
    expect(f.map((x) => x.label)).toEqual(["demo"]);
  });
});

describe("reportModelTierFlags — phải KÊU, và không bao giờ ném", () => {
  afterEach(() => {
    delete process.env.DEMO_FLAG;
  });

  it("log cảnh báo khi có phát hiện", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AI_THINKING_TIER_ENABLED = "true"; // model để trống → đúng ca lệch của hôm nay
    await reportModelTierFlags(probes());
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/khai BẬT nhưng VÔ HIỆU/));
  });

  it("im lặng hoàn toàn khi mọi cờ đang bật đều có đủ model", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Không bật cờ nào (đã xoá ở beforeEach) ⇒ không có gì để báo.
    const f = await reportModelTierFlags(probes());
    expect(f).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("bộ dò ném ⇒ trả rỗng, KHÔNG ném ra ngoài (không được chặn boot)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AI_THINKING_TIER_ENABLED = "true";
    const bad: TierFlagProbes = {
      ggufExists: () => {
        throw new Error("đĩa hỏng");
      },
      pathExists: () => {
        throw new Error("đĩa hỏng");
      },
    };
    process.env.GGUF_THINKING_MODEL = "x";
    await expect(reportModelTierFlags(bad)).resolves.toBeInstanceOf(Array);
  });
});

/**
 * ★ Nhóm ca canh BẢNG SẢN XUẤT. Nếu ai đó xoá một mục khỏi TIER_FLAG_SPECS, các ca ở nhóm trên
 * vẫn xanh (chúng dùng bảng tiêm) — chỉ nhóm này đỏ.
 */
describe("TIER_FLAG_SPECS — bảng thật", () => {
  it("phủ đúng cấu hình lệch tìm thấy hôm nay: THINKING bật + model chưa gán", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "true";
    const f = await auditModelTierFlags(probes());
    expect(f.some((x) => x.env === "GGUF_THINKING_MODEL" && x.problem === "unset")).toBe(true);
  });

  it("AI_THINKING_TIER_ENABLED=false (giá trị .env sau G1-C) ⇒ KHÔNG báo gì", async () => {
    process.env.AI_THINKING_TIER_ENABLED = "false";
    const f = await auditModelTierFlags(probes());
    expect(f.filter((x) => x.label === "thinking-tier")).toEqual([]);
  });

  it("nhận mọi cách viết bật: 1/true/yes/on", async () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", "On"]) {
      process.env.AI_THINKING_TIER_ENABLED = v;
      const f = await auditModelTierFlags(probes());
      expect(f.some((x) => x.env === "GGUF_THINKING_MODEL"), `giá trị "${v}"`).toBe(true);
    }
  });

  it("reranker gguf: chỉ soi khi ENABLED=true VÀ MODE=gguf", async () => {
    process.env.RAG_RERANKER_ENABLED = "true";
    process.env.RAG_RERANKER_MODE = "llm"; // mode khác ⇒ không dùng GGUF ⇒ không phải lỗi
    expect((await auditModelTierFlags(probes())).filter((x) => x.env === "GGUF_RERANKER_MODEL")).toEqual([]);

    process.env.RAG_RERANKER_MODE = "gguf";
    expect((await auditModelTierFlags(probes())).some((x) => x.env === "GGUF_RERANKER_MODEL")).toBe(true);
  });

  it("sidecar thị giác: gán bin nhưng thiếu mmproj trên đĩa ⇒ bị bắt", async () => {
    process.env.LLAMA_SERVER_BIN = "/bin/llama-server";
    process.env.GGUF_VISION_MODEL = "/models/vl.gguf";
    process.env.GGUF_VISION_MMPROJ = "/models/mmproj.gguf";
    const f = await auditModelTierFlags(probes(["/bin/llama-server", "/models/vl.gguf"]));
    expect(f.some((x) => x.env === "GGUF_VISION_MMPROJ" && x.problem === "missing")).toBe(true);
  });

  /**
   * ★ G5-B (2026-08-16) — ĐƯỜNG GHOST-TEXT THOÁI HOÁ ÂM THẦM.
   *
   * `GGUF_FIM_MODEL` CÓ đường lùi (`→ GGUF_FAST_MODEL → GGUF_DEFAULT_MODEL`), nên bảng ban đầu
   * khai `requiredWhenOn: false`. Nhưng "có fallback" KHÔNG có nghĩa "fallback dùng được": model
   * lùi là một model CHAT, không được huấn luyện fill-in-middle. Xoá biến này khi gộp roster ⇒
   * ghost-text lặng lẽ thành completion thường: chậm hơn nhiều, chất lượng khác hẳn, KHÔNG có gì
   * đỏ. Cùng lập luận đã ghi sẵn cho `copilot-repo-index` trong chính bảng này.
   */
  it("★ code-router BẬT + GGUF_FIM_MODEL BỎ TRỐNG ⇒ phải báo 'unset' (ghost-text thoái hoá âm thầm)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_FAST_MODEL = "Qwen3-27B-dense"; // có đường lùi — vẫn KHÔNG được im lặng
    const f = await auditModelTierFlags(probes(["Qwen3-27B-dense"]));
    const hit = f.find((x) => x.env === "GGUF_FIM_MODEL");
    expect(hit).toBeDefined();
    expect(hit!.problem).toBe("unset");
    expect(hit!.impact).toMatch(/fill-in-middle|FIM/i);
  });

  it("★ 'GỘP ROSTER': trỏ GGUF_FIM_MODEL vào chính model chat ⇒ phải báo 'collapsed'", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3.8-27B-Instruct-Q4_K_M.gguf";
    process.env.GGUF_FIM_MODEL = "Qwen3.8-27B-Instruct-Q4_K_M.gguf"; // file CÓ THẬT ⇒ 'missing' không bắt được
    const f = await auditModelTierFlags(probes(["Qwen3.8-27B-Instruct-Q4_K_M"]));
    const hit = f.find((x) => x.env === "GGUF_FIM_MODEL");
    expect(hit).toBeDefined();
    expect(hit!.problem).toBe("collapsed");
    expect(hit!.reason).toMatch(/GGUF_DEFAULT_MODEL/);
  });

  it("GGUF_FIM_MODEL trỏ model FIM riêng ⇒ im lặng (cấu hình ĐÚNG không được sinh tiếng ồn)", async () => {
    process.env.AI_CODE_ROUTER_ENABLED = "true";
    process.env.GGUF_DEFAULT_MODEL = "Qwen3.8-27B-Instruct-Q4_K_M.gguf";
    process.env.GGUF_FIM_MODEL = "Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf";
    const f = await auditModelTierFlags(probes(["Qwen3.8-27B-Instruct-Q4_K_M", "Qwen2.5-Coder-1.5B-Instruct-Q4_K_M"]));
    expect(f.filter((x) => x.env === "GGUF_FIM_MODEL")).toEqual([]);
  });

  it("code-router TẮT ⇒ GGUF_FIM_MODEL bỏ trống KHÔNG phải lỗi (cấu hình trung thực)", async () => {
    delete process.env.AI_CODE_ROUTER_ENABLED;
    const f = await auditModelTierFlags(probes());
    expect(f.filter((x) => x.env === "GGUF_FIM_MODEL")).toEqual([]);
  });

  it("mustDifferFrom — ngữ nghĩa (bảng tiêm): so sánh theo BASENAME, bỏ qua '.gguf' và hoa/thường", async () => {
    const spec: TierFlagSpec[] = [
      {
        label: "demo",
        isOn: () => true,
        onCondition: "luôn bật",
        requires: [
          {
            env: "A_MODEL",
            kind: "basename",
            requiredWhenOn: true,
            mustDifferFrom: ["B_MODEL"],
            impact: "A trùng B ⇒ tầng A vô nghĩa",
          },
        ],
      },
    ];
    process.env.A_MODEL = "m.gguf";
    process.env.B_MODEL = "M";
    expect((await auditModelTierFlags(probes(["m", "M"]), spec))[0]).toMatchObject({ problem: "collapsed" });
    process.env.B_MODEL = "khac";
    expect(await auditModelTierFlags(probes(["m", "khac"]), spec)).toEqual([]);
    delete process.env.A_MODEL;
    delete process.env.B_MODEL;
  });

  it("mọi mục trong bảng đều có ít nhất một model để kiểm — không có mục rỗng vô nghĩa", () => {
    expect(TIER_FLAG_SPECS.length).toBeGreaterThan(0);
    for (const s of TIER_FLAG_SPECS) {
      expect(s.requires.length, `spec "${s.label}"`).toBeGreaterThan(0);
      for (const r of s.requires) expect(r.impact.length).toBeGreaterThan(10);
    }
  });
});

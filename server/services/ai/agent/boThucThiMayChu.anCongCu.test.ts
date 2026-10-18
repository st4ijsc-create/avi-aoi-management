/**
 * ★★ Đợt 2 (2026-10-17) — công tắc ABLATION `AI_AGENT_AN_CONG_CU` của bộ thực thi máy chủ (bộ đo "tìm mã",
 * `scripts/ai-eval/codegen-chay-duoc/tim-ma/`). Thuần: chỉ mục mã + truy hồi tài liệu + executeDecision là bản GIẢ,
 * không chạm CSDL/đĩa. Đo: (1) bộ phơi bỏ đúng tên, đọc TẠI CHỖ GỌI; (2) model vẫn gọi tên bị ẩn ⇒ bộ thực thi từ chối
 * và KHÔNG chạm chỉ mục; (3) qua lõi vòng thật, model không nhìn thấy tool bị ẩn.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { chayVongAgent, type GoiModel, type ManhModel, type SuKienAgent, type WireTool } from "@shared/agentCore";
import { congCuBiAn, taoBoThucThiMayChu } from "./boThucThiMayChu";
import type { CongChiMucMa } from "./chiMucMaAgent";

const AN_DOT2 = "find_symbol,search_code,search_docs";
const ten = (ds: WireTool[]) => ds.map((t) => t.function.name);

function taoBo() {
  const goiChiMuc: string[] = [];
  const goiTaiLieu: string[] = [];
  const chiMucMa: CongChiMucMa = {
    timKyHieu: async (y) => {
      goiChiMuc.push(`timKyHieu:${y.ten}`);
      return { dinhNghia: [{ duong: "src/a.ts", dong: 3, kind: "function", chuKy: "function chayVong()" }], thamChieu: [], catBot: false };
    },
    timMaNgu: async () => {
      goiChiMuc.push("timMaNgu");
      return { ketQua: [], trangThai: "san-sang" as const };
    },
    lamTuoiTep: async () => undefined,
    dungChiMuc: async () => ({ soTep: 0, soDoan: 0, ms: 0 }),
  };
  const nguoi = { id: 1, role: "admin", name: "Ky su ablation" };
  const bo = taoBoThucThiMayChu({
    execCtx: { user: nguoi, lang: "vi", projectRoot: process.cwd() },
    gocDuAn: process.cwd(),
    projectId: "repo",
    user: nguoi,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: {
      chiMucMa,
      timTaiLieu: (async () => {
        goiTaiLieu.push("timTaiLieu");
        return [];
      }) as never,
      executeDecision: (async () => ({ error: "khong dung trong luoi nay" })) as never,
      kiemKillSwitch: async () => false,
    },
  });
  return { bo, goiChiMuc, goiTaiLieu };
}

const ctx = () => ({ cheDo: "hoi" as const, runId: "r1", luot: 1, signal: new AbortController().signal, phat: () => undefined });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("congCuBiAn — đọc danh sách phẩy", () => {
  it("rỗng / không đặt ⇒ tập rỗng; cắt khoảng trắng, bỏ mục rỗng", () => {
    expect(congCuBiAn(undefined).size).toBe(0);
    expect(congCuBiAn("").size).toBe(0);
    expect([...congCuBiAn(" find_symbol , ,search_code,")]).toEqual(["find_symbol", "search_code"]);
  });
  it("mặc định đọc process.env.AI_AGENT_AN_CONG_CU tại lúc gọi", () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "grep");
    expect([...congCuBiAn()]).toEqual(["grep"]);
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "");
    expect(congCuBiAn().size).toBe(0);
  });
});

describe("congCu(cheDo) — bộ phơi cho model", () => {
  it("không đặt biến ⇒ chế độ hoi CÓ cả ba tool tìm của Đợt 2", () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "");
    const { bo } = taoBo();
    expect(ten(bo.congCu("hoi"))).toEqual(expect.arrayContaining(["find_symbol", "search_code", "search_docs", "grep", "read_file"]));
  });

  it("đặt biến ⇒ bỏ ĐÚNG ba tool ở mọi chế độ, các tool khác giữ nguyên thứ tự", () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "");
    const { bo } = taoBo();
    const truocHoi = ten(bo.congCu("hoi"));
    const truocTuDong = ten(bo.congCu("tu-dong"));
    vi.stubEnv("AI_AGENT_AN_CONG_CU", AN_DOT2);
    const an = new Set(AN_DOT2.split(","));
    expect(ten(bo.congCu("hoi"))).toEqual(truocHoi.filter((t) => !an.has(t)));
    expect(ten(bo.congCu("tu-dong"))).toEqual(truocTuDong.filter((t) => !an.has(t)));
    expect(ten(bo.congCu("hoi"))).toContain("remember");
  });

  it("đọc TẠI CHỖ GỌI: cùng một bộ thực thi, đổi biến giữa hai lần gọi ⇒ kết quả đổi theo", () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "find_symbol");
    const { bo } = taoBo();
    expect(ten(bo.congCu("hoi"))).not.toContain("find_symbol");
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "");
    expect(ten(bo.congCu("hoi"))).toContain("find_symbol");
  });
});

describe("chay — model vẫn gọi tên bị ẩn", () => {
  it("bị ẩn ⇒ CONG_CU_BI_AN, KHÔNG chạm chỉ mục / truy hồi", async () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", AN_DOT2);
    const { bo, goiChiMuc, goiTaiLieu } = taoBo();
    for (const [t, thamSo] of [
      ["find_symbol", { name: "chayVong" }],
      ["search_code", { query: "vòng agent" }],
      ["search_docs", { query: "MC protocol" }],
    ] as const) {
      const kq = await bo.chay({ id: `c-${t}`, ten: t, thamSo: { ...thamSo } }, ctx());
      expect(kq.ok).toBe(false);
      expect(kq.ma).toBe("CONG_CU_BI_AN");
      expect(kq.choModel).toContain(t);
    }
    expect(goiChiMuc).toEqual([]);
    expect(goiTaiLieu).toEqual([]);
  });

  it("đối chứng: không ẩn ⇒ find_symbol chạy tới chỉ mục", async () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", "");
    const { bo, goiChiMuc } = taoBo();
    const kq = await bo.chay({ id: "c1", ten: "find_symbol", thamSo: { name: "chayVong" } }, ctx());
    expect(kq.ok).toBe(true);
    expect(goiChiMuc).toEqual(["timKyHieu:chayVong"]);
    expect(kq.choModel).toContain("src/a.ts");
  });
});

describe("qua lõi vòng thật (chayVongAgent)", () => {
  it("model KHÔNG nhìn thấy tool bị ẩn; gọi bừa ⇒ bị từ chối, chỉ mục không bị chạm", async () => {
    vi.stubEnv("AI_AGENT_AN_CONG_CU", AN_DOT2);
    const { bo, goiChiMuc } = taoBo();
    const thayDuoc: string[][] = [];
    let luot = 0;
    const goiModel: GoiModel = (v) => {
      thayDuoc.push(ten(v.congCu));
      const n = luot++;
      return (async function* (): AsyncGenerator<ManhModel> {
        if (n === 0) {
          yield {
            loai: "xong",
            toolCalls: [{ id: "t1", type: "function", function: { name: "find_symbol", arguments: JSON.stringify({ name: "chayVong" }) } }],
          };
        } else {
          yield { loai: "chu", noiDung: "Không tìm được bằng find_symbol." } as ManhModel;
          yield { loai: "xong", toolCalls: [] };
        }
      })();
    };
    const suKien: SuKienAgent[] = [];
    await chayVongAgent({
      cauHoi: "chayVong ở đâu?",
      cheDo: "hoi",
      runId: "r-ablation",
      nguCanhDuAn: "",
      goiModel,
      boThucThi: bo,
      phat: (e) => suKien.push(e),
      signal: new AbortController().signal,
    });
    expect(thayDuoc.length).toBeGreaterThanOrEqual(1);
    for (const ds of thayDuoc) for (const t of AN_DOT2.split(",")) expect(ds).not.toContain(t);
    const kq = suKien.find((e) => e.loai === "ket-qua-tool") as Extract<SuKienAgent, { loai: "ket-qua-tool" }> | undefined;
    expect(kq?.ok).toBe(false);
    expect(goiChiMuc).toEqual([]);
  });
});

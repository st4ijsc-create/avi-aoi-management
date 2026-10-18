/**
 * ★ (2026-10-19) BỘ THỰC THI MÁY CHỦ tự gắn "Gợi ý tra cứu API (tự động)" vào quan sát của `run_command` khi lệnh
 * build/test trả lỗi "không tìm thấy kiểu/thành viên" — không phụ thuộc model tự gọi `lookup_api`.
 *
 * Thuần: executeDecision / getAction là bản GIẢ (chế độ `sua`: thẻ duyệt ⇒ hàng `executed` mang đầu ra lệnh THẬT của
 * `dotnet build`, .NET SDK 10.0.302, 2026-10-19). Bộ tra là cổng tiêm.
 *
 * ĐỘT BIẾN PHẢI BẮT: gắn khi lệnh XANH · công tắc `AI_AGENT_TU_TRA_API=0` không tắt · bộ tra ném làm hỏng kết quả lệnh ·
 * khối nằm TRƯỚC đầu ra (bị lõi cắt đầu+đuôi nuốt) · khối lọt vào `hienThi.dauRa` (UI tưởng là đầu ra lệnh).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { taoBoThucThiMayChu } from "./boThucThiMayChu";
import type { KetQuaTraApi, TraApi, YeuCauTraApi } from "../apiRef/traApi";

const DAU_RA_LOI = [
  "  Determining projects to restore...",
  String.raw`D:\bai\A.cs(3,18): error CS0246: The type or namespace name 'StringBuilder' could not be found (are you missing a using directive or an assembly reference?) [D:\bai\a.csproj]`,
  "",
  "Build FAILED.",
].join("\r\n");

const KQ_SB: KetQuaTraApi = {
  khop: [{ nn: "csharp", loai: "type", ns: "System.Text", ten: "StringBuilder", chuKy: "StringBuilder", tomTat: "", nguon: 0 }],
  tongKhop: 1,
  catBot: false,
};

function taoBo(traApi: TraApi, dauRa: { exitCode: number; output: string }) {
  const nguoi = { id: 1, role: "engineer", name: "Ky su" };
  const executeDecision = vi.fn(async (d: { tool: string; args: Record<string, unknown> }) => ({
    pendingAction: {
      actionId: "pa-lenh",
      token: "tok",
      tool: d.tool,
      summary: "chay lenh",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      args: d.args,
    },
  }));
  const getAction = vi.fn(async () => ({
    status: "executed",
    resultJson: { note: null, data: { command: "dotnet build a.csproj", exitCode: dauRa.exitCode, timedOut: false, output: dauRa.output } },
  }));
  return taoBoThucThiMayChu({
    execCtx: { user: nguoi, lang: "vi", projectRoot: process.cwd() },
    gocDuAn: process.cwd(),
    user: nguoi,
    coQuyenThucThi: false,
    checkpoint: null,
    phuThuoc: {
      chiMucMa: null,
      traApi,
      executeDecision: executeDecision as never,
      getAction: getAction as never,
      kiemKillSwitch: async () => false,
      nhipKiemMs: 5,
    },
  });
}
const ctx = () => ({ cheDo: "sua" as const, runId: "r1", luot: 1, signal: new AbortController().signal, phat: () => undefined });
const goiLenh = { id: "c1", ten: "run_command", thamSo: { command: "dotnet build a.csproj" } };

afterEach(() => vi.unstubAllEnvs());

describe("run_command lỗi ⇒ gợi ý tra cứu API (tự động)", () => {
  it("★ CS0246 ⇒ khối gợi ý ở CUỐI quan sát (sau đầu ra), có using đúng; hienThi.dauRa KHÔNG chứa khối", async () => {
    vi.stubEnv("AI_AGENT_TU_TRA_API", "");
    const goi: YeuCauTraApi[] = [];
    const bo = taoBo(async (y) => {
      goi.push(y);
      return y.ten === "StringBuilder" ? KQ_SB : { khop: [], tongKhop: 0, catBot: false };
    }, { exitCode: 1, output: DAU_RA_LOI });
    const kq = await bo.chay(goiLenh, ctx());
    expect(kq.ok).toBe(true);
    expect(goi[0]).toMatchObject({ ten: "StringBuilder", ngonNgu: "csharp" });
    const i = kq.choModel.indexOf("Gợi ý tra cứu API (tự động)");
    expect(i).toBeGreaterThan(kq.choModel.indexOf("Build FAILED."));
    expect(kq.choModel.slice(i)).toContain("using System.Text;");
    expect(kq.hienThi).toMatchObject({ tool: "run_command", maThoat: 1, tuTraApi: ["StringBuilder"] });
    expect(String((kq.hienThi as { dauRa: string }).dauRa)).not.toContain("Gợi ý tra cứu API");
  });

  it("AI_AGENT_TU_TRA_API=0 ⇒ không tra, không khối", async () => {
    vi.stubEnv("AI_AGENT_TU_TRA_API", "0");
    const tra = vi.fn(async () => KQ_SB);
    const kq = await taoBo(tra, { exitCode: 1, output: DAU_RA_LOI }).chay(goiLenh, ctx());
    expect(tra).not.toHaveBeenCalled();
    expect(kq.choModel).not.toContain("Gợi ý tra cứu API");
    expect(kq.hienThi).not.toHaveProperty("tuTraApi");
  });

  it("lệnh XANH (exit 0) ⇒ không tra", async () => {
    vi.stubEnv("AI_AGENT_TU_TRA_API", "");
    const tra = vi.fn(async () => KQ_SB);
    const kq = await taoBo(tra, { exitCode: 0, output: `${DAU_RA_LOI}\nok` }).chay(goiLenh, ctx());
    expect(tra).not.toHaveBeenCalled();
    expect(kq.choModel).not.toContain("Gợi ý tra cứu API");
  });

  it("bộ tra NÉM / chỉ mục chưa dựng ⇒ kết quả lệnh nguyên vẹn, không khối", async () => {
    vi.stubEnv("AI_AGENT_TU_TRA_API", "");
    for (const tra of [
      async () => {
        throw new Error("đĩa hỏng");
      },
      async () => null,
    ] as TraApi[]) {
      const kq = await taoBo(tra, { exitCode: 1, output: DAU_RA_LOI }).chay(goiLenh, ctx());
      expect(kq.ok).toBe(true);
      expect(kq.choModel).toContain("Build FAILED.");
      expect(kq.choModel).not.toContain("Gợi ý tra cứu API");
    }
  });

  it("lỗi không thuộc dạng 'không tìm thấy' ⇒ không tra", async () => {
    vi.stubEnv("AI_AGENT_TU_TRA_API", "");
    const tra = vi.fn(async () => KQ_SB);
    const out = String.raw`D:\bai\src\BangGia.cs(5,123): error CS0029: Cannot implicitly convert type '(int, int)[]' to '(long A, long B)[]' [D:\bai\Bai.csproj]`;
    const kq = await taoBo(tra, { exitCode: 1, output: out }).chay(goiLenh, ctx());
    expect(tra).not.toHaveBeenCalled();
    expect(kq.choModel).not.toContain("Gợi ý tra cứu API");
  });
});

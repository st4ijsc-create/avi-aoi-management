/**
 * F5 — ghim tiêu đề khoá ở TỪNG nơi gọi llama-server (kiem-dinh 10/11: đột biến `tieuDeLlamaServer(...)` → `{}` sống ở cả 5 nơi).
 * Bật `LLAMA_SERVER_API_KEY_FILE` mà một nơi quên khoá thì /health hoặc /props trả 401: giám sát báo server chết, nạp model không thấy server.
 * Mỗi nơi: có khoá ⇒ gửi `Bearer <khoá>` trên MỌI yêu cầu tới llama-server; không khoá ⇒ không có `authorization`.
 * Không mạng, không GPU, không CSDL: fetch giả ghi lại tiêu đề.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultProbeLlamaServer } from "../../_core/aiReadiness";
import { docProps as docPropsDoiModel, sinhThuNgan } from "./doiModelLlamaServer";
import { thamDoCong } from "./giamSatLlamaServer";
import { docProps as docPropsHoSo } from "./hoSoModelStudio";
import { _datLaiKhoaLlamaServer } from "./khoaLlamaServer";
import { phuThuocMacDinh } from "./napServerNgoai";

const KHOA = "khoa-noi-goi-q9";
const URL_GIA = "http://127.0.0.1:65530";

type Goi = { url: string; authorization: string | null };

/** fetch giả: trả JSON theo đuôi đường dẫn, ghi tiêu đề `authorization` của mỗi lần gọi. */
function fetchGia(traLoi: Record<string, { status?: number; body: unknown }>) {
  const goi: Goi[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers ?? {});
    goi.push({ url, authorization: h.get("authorization") });
    const duoi = Object.keys(traLoi).find((k) => url.endsWith(k));
    const r = duoi ? traLoi[duoi] : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return { fn: fn as unknown as typeof fetch, goi };
}

const PROPS = { model_path: "D:/models/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", total_slots: 1, default_generation_settings: { n_ctx: 65536 } };

beforeEach(() => {
  _datLaiKhoaLlamaServer();
  vi.stubEnv("LLAMA_SERVER_API_KEY_FILE", "");
  vi.stubEnv("LLAMA_SERVER_ENABLED", "true");
  vi.stubEnv("LLAMA_SERVER_URL", URL_GIA);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  _datLaiKhoaLlamaServer();
});

/** Chạy `goiNoi` hai lần: có khoá (mọi yêu cầu mang Bearer) và không khoá (không yêu cầu nào mang authorization). */
async function kiemHaiChieu(goiNoi: (f: typeof fetch) => Promise<unknown>, traLoi: Record<string, { status?: number; body: unknown }>, toiThieu: number) {
  for (const [khoa, mong] of [
    [KHOA, `Bearer ${KHOA}`],
    ["", null],
  ] as const) {
    vi.stubEnv("LLAMA_SERVER_API_KEY", khoa);
    _datLaiKhoaLlamaServer();
    const { fn, goi } = fetchGia(traLoi);
    vi.stubGlobal("fetch", fn);
    await goiNoi(fn);
    expect(goi.length).toBeGreaterThanOrEqual(toiThieu);
    expect(goi.map((g) => g.authorization)).toEqual(goi.map(() => mong));
  }
}

describe("tiêu đề khoá ở từng nơi gọi llama-server", () => {
  it("aiReadiness: /health và /props mang Bearer", async () => {
    await kiemHaiChieu(async () => {
      const r = await defaultProbeLlamaServer(URL_GIA, 2000, process.env);
      expect(r.reachable).toBe(true);
    }, { "/health": { body: { status: "ok" } }, "/props": { body: PROPS } }, 2);
  });

  it("doiModelLlamaServer: /props và /v1/chat/completions mang Bearer", async () => {
    await kiemHaiChieu(async (f) => {
      expect((await docPropsDoiModel(URL_GIA, f, 2000, process.env)).modelPath).toBe(PROPS.model_path);
      await sinhThuNgan(URL_GIA, f, 2000, process.env);
    }, { "/props": { body: PROPS }, "/v1/chat/completions": { body: { choices: [{ message: { content: "OK" } }] } } }, 2);
  });

  it("giamSatLlamaServer: thăm dò /health mang Bearer", async () => {
    await kiemHaiChieu(async (f) => {
      expect(await thamDoCong(URL_GIA, 2000, f)).toBe("song");
    }, { "/health": { body: { status: "ok" } } }, 1);
  });

  it("hoSoModelStudio: /props mang Bearer", async () => {
    await kiemHaiChieu(async () => {
      const r = await docPropsHoSo();
      expect(r.trangThai).toBe("ok");
    }, { "/props": { body: PROPS } }, 1);
  });

  it("napServerNgoai: /props và /v1/models mang Bearer", async () => {
    await kiemHaiChieu(async () => {
      expect(await phuThuocMacDinh.modelServer(URL_GIA, 2000)).toBe("tho-ca");
    }, { "/props": { status: 404, body: {} }, "/v1/models": { body: { data: [{ id: "tho-ca" }] } } }, 2);
  });
});

describe("napServerNgoai: tên model khi llama-server chạy với --alias (a3)", () => {
  it("/props.model_path thắng bí danh của /v1/models", async () => {
    const { fn, goi } = fetchGia({ "/props": { body: PROPS }, "/v1/models": { body: { data: [{ id: "tho-ca" }] } } });
    vi.stubGlobal("fetch", fn);
    expect(await phuThuocMacDinh.modelServer(URL_GIA, 2000)).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(goi.map((g) => g.url.replace(URL_GIA, ""))).toEqual(["/props"]);
  });

  it("/props hỏng, thiếu hoặc rỗng model_path ⇒ rơi về /v1/models", async () => {
    for (const props of [{ status: 500, body: {} }, { body: {} }, { body: { model_path: "  " } }]) {
      const { fn } = fetchGia({ "/props": props, "/v1/models": { body: { data: [{ id: "D:/m/Khac-7B.gguf" }] } } });
      vi.stubGlobal("fetch", fn);
      expect(await phuThuocMacDinh.modelServer(URL_GIA, 2000)).toBe("Khac-7B");
    }
  });
});

/** F5: đọc khoá llama-server (không CSDL, không mạng) + census nơi đọc khoá và nơi gọi llama-server. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _datLaiKhoaLlamaServer, khoaLlamaServer, tieuDeLlamaServer } from "./khoaLlamaServer";

const GOC = process.cwd();
let tam = "";
beforeEach(() => {
  _datLaiKhoaLlamaServer();
  tam = fs.mkdtempSync(path.join(os.tmpdir(), "khoa-llama-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tam, { recursive: true, force: true });
});
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("khoaLlamaServer", () => {
  it("★★ không cấu hình ⇒ rỗng, không có tiêu đề", () => {
    expect(khoaLlamaServer(env({}))).toBe("");
    expect(tieuDeLlamaServer(env({}))).toEqual({});
  });
  it("★★ chỉ khoá env ⇒ dùng khoá env, cắt khoảng trắng", () => {
    expect(tieuDeLlamaServer(env({ LLAMA_SERVER_API_KEY: " k1 " }))).toEqual({ authorization: "Bearer k1" });
  });
  it("★★★ có tệp ⇒ tệp thắng khoá env, cắt xuống dòng cuối", () => {
    const p = path.join(tam, "k");
    fs.writeFileSync(p, "tu-tep\r\n");
    expect(khoaLlamaServer(env({ LLAMA_SERVER_API_KEY_FILE: p, LLAMA_SERVER_API_KEY: "k1" }))).toBe("tu-tep");
  });
  it("★★★ tệp thiếu hoặc rỗng ⇒ KHÔNG rơi về khoá env, cảnh báo một lần, không lộ khoá", () => {
    const canh = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const thieu = env({ LLAMA_SERVER_API_KEY_FILE: path.join(tam, "khong-co"), LLAMA_SERVER_API_KEY: "bi-mat-env" });
    expect(khoaLlamaServer(thieu)).toBe("");
    expect(tieuDeLlamaServer(thieu)).toEqual({});
    const rong = path.join(tam, "rong");
    fs.writeFileSync(rong, " \n");
    expect(khoaLlamaServer(env({ LLAMA_SERVER_API_KEY_FILE: rong, LLAMA_SERVER_API_KEY: "bi-mat-env" }))).toBe("");
    expect(canh).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(canh.mock.calls)).not.toContain("bi-mat-env");
  });
  it("★★ đệm 5 s: xoay khoá có hiệu lực sau hạn, không đọc đĩa mỗi lượt", () => {
    const p = path.join(tam, "k");
    fs.writeFileSync(p, "cu");
    const e = env({ LLAMA_SERVER_API_KEY_FILE: p });
    expect(khoaLlamaServer(e, 1_000)).toBe("cu");
    fs.writeFileSync(p, "moi");
    expect(khoaLlamaServer(e, 5_999)).toBe("cu");
    expect(khoaLlamaServer(e, 6_000)).toBe("moi");
  });
});

describe("D1: có --alias thì model đang giữ vẫn là tên tệp", () => {
  const ENV0 = { ...process.env };
  const traLoi = (o: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => o }) as unknown as Response;
  const datFetch = (props: Response, models: Response) => {
    const f = vi.fn(async (u: string) => (String(u).endsWith("/props") ? props : models));
    vi.stubGlobal("fetch", f);
    return f;
  };
  beforeEach(() => {
    process.env.LLAMA_SERVER_ENABLED = "true";
    process.env.LLAMA_SERVER_URL = "http://127.0.0.1:8091";
    process.env.LLAMA_SERVER_ALIAS = "thoca-coder";
    process.env.LLAMA_SERVER_API_KEY = "k9";
    delete process.env.LLAMA_SERVER_API_KEY_FILE;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["LLAMA_SERVER_ENABLED", "LLAMA_SERVER_URL", "LLAMA_SERVER_ALIAS", "LLAMA_SERVER_API_KEY"]) {
      if (ENV0[k] === undefined) delete process.env[k];
      else process.env[k] = ENV0[k];
    }
  });
  const hoi = async () => (await import("../aiLlamaServerClient")).modelServerDangChay();

  it("★★★ /props có model_path ⇒ tên tệp, dù /v1/models trả bí danh; có gửi khoá", async () => {
    const f = datFetch(traLoi({ model_path: "D:/m/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" }), traLoi({ data: [{ id: "thoca-coder" }] }));
    expect(await hoi()).toBe("Qwen3.6-35B-A3B-UD-Q4_K_XL");
    expect(f.mock.calls[0]![1]).toMatchObject({ headers: { authorization: "Bearer k9" } });
  });
  it("★★★ /props hỏng + /v1/models trả bí danh ⇒ null, không nhận bí danh làm tên model", async () => {
    datFetch(traLoi({}, false), traLoi({ data: [{ id: "thoca-coder" }] }));
    expect(await hoi()).toBeNull();
  });
  it("★★ /props hỏng + /v1/models trả tên tệp (server chưa đặt bí danh) ⇒ vẫn đọc được", async () => {
    datFetch(traLoi({}, false), traLoi({ data: [{ id: "D:/m/Qwen3.6-27B.gguf" }] }));
    expect(await hoi()).toBe("Qwen3.6-27B");
  });
});

describe("census khoá llama-server", () => {
  /** Mọi tệp .ts của server, trừ test. */
  function tepServer(d = path.join(GOC, "server")): string[] {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : tepServer(p);
      return e.name.endsWith(".ts") && !e.name.includes(".test.") ? [p] : [];
    });
  }
  const tuongDoi = (p: string) => path.relative(GOC, p).split(path.sep).join("/");

  it("★★★ chỉ khoaLlamaServer.ts đọc biến khoá; nơi khác đọc riêng thì bỏ sót LLAMA_SERVER_API_KEY_FILE", () => {
    const ra = tepServer().filter((p) => /env\.LLAMA_SERVER_API_KEY|env\[["']LLAMA_SERVER_API_KEY/.test(fs.readFileSync(p, "utf8"))).map(tuongDoi);
    expect(ra).toEqual(["server/services/ai/khoaLlamaServer.ts"]);
  });

  it("★★★ mọi tệp gọi /props hoặc /v1/models của llama-server đều gửi khoá", () => {
    const goi = /fetch(?:Fn)?\(`\$\{[^}]*\}(?:\.replace\([^)]*\)\})?\/(?:props|v1\/models|tokenize)/;
    const ra = tepServer().filter((p) => {
      const s = fs.readFileSync(p, "utf8");
      return goi.test(s) && !/tieuDeLlamaServer|authHeaders\(|tieuDe\(env\)/.test(s);
    });
    // Sidecar thị giác là tiến trình riêng ở cổng khác, không dùng khoá của khe chính.
    expect(ra.map(tuongDoi).filter((t) => t !== "server/services/llamaVisionSidecar.ts")).toEqual([]);
  });
});

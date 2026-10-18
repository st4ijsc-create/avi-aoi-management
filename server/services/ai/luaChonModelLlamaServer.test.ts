/**
 * Đợt 6 — LỰA CHỌN MODEL BỀN của llama-server (tệp ngoài repo, KHÔNG ghi `.env` chung).
 *
 * Canh BA điều, trên TỆP THẬT trong thư mục tạm:
 *   1. Tệp lựa chọn ghi nguyên tử, đọc lại đúng; nội dung hỏng / tên có đường dẫn ⇒ coi như KHÔNG có.
 *   2. Phủ env đúng "BA khoá" (bài học 2026-09-22): chỉ khoá nào ĐANG trỏ cùng model với server mới bị
 *      phủ; khoá trỏ model khác (vd. tầng code in-process riêng) giữ nguyên.
 *   3. `.env` sửa SAU lựa chọn ⇒ `.env` thắng (ý định mới hơn); lựa chọn trỏ tệp không còn ⇒ bỏ qua.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  apDungLuaChonModel,
  docLuaChon,
  ghiLuaChon,
  duongLuaChon,
  tenModelGoc,
  laTenModelHopLe,
  docNoiDungTho,
  khoiPhucNoiDungTho,
} from "./luaChonModelLlamaServer";

let thuMuc = "";
let khoModel = "";
beforeEach(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "llama-luachon-test-"));
  khoModel = path.join(thuMuc, "models");
  fs.mkdirSync(khoModel);
  for (const t of ["A.gguf", "B.gguf", "Code.gguf"]) fs.writeFileSync(path.join(khoModel, t), "x");
});
afterEach(() => {
  try {
    fs.rmSync(thuMuc, { recursive: true, force: true });
  } catch {
    /* Windows giữ handle */
  }
});

function envMau(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    GGUF_MODELS_DIR: khoModel,
    LLAMA_SERVER_MODEL: "A.gguf",
    GGUF_DEFAULT_MODEL: "A.gguf",
    GGUF_CODE_MODEL: "Code.gguf",
    LLAMA_SERVER_SELECTION_FILE: path.join(thuMuc, "sel", "lua-chon.json"),
    ...over,
  } as NodeJS.ProcessEnv;
}

describe("tên model — danh sách trắng dạng tên", () => {
  it("chỉ nhận basename .gguf, không đường dẫn, không `..`", () => {
    expect(laTenModelHopLe("Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf")).toBe(true);
    expect(laTenModelHopLe("../x.gguf")).toBe(false);
    expect(laTenModelHopLe("C:\\x.gguf")).toBe(false);
    expect(laTenModelHopLe("sub/x.gguf")).toBe(false);
    expect(laTenModelHopLe("x.bin")).toBe(false);
    expect(laTenModelHopLe(".gguf")).toBe(false);
    expect(laTenModelHopLe("..gguf")).toBe(false);
  });
  it("tenModelGoc bỏ thư mục + đuôi", () => {
    expect(tenModelGoc("D:/m/A.gguf")).toBe("A");
    expect(tenModelGoc("A.GGUF")).toBe("A");
    expect(tenModelGoc(undefined)).toBe("");
  });
});

describe("tệp lựa chọn", () => {
  it("ghi nguyên tử rồi đọc lại; tạo thư mục cha", () => {
    const d = duongLuaChon(envMau());
    ghiLuaChon(d, { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "2026-10-17T00:00:00.000Z", nguoi: "admin" });
    expect(docLuaChon(d)?.model).toBe("B.gguf");
    expect(fs.readdirSync(path.dirname(d)).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
  it("nội dung hỏng / tên có đường dẫn ⇒ null (không bao giờ ném)", () => {
    const d = duongLuaChon(envMau());
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.writeFileSync(d, "{hong");
    expect(docLuaChon(d)).toBeNull();
    fs.writeFileSync(d, JSON.stringify({ v: 1, model: "../../etc/x.gguf", envModel: "A.gguf" }));
    expect(docLuaChon(d)).toBeNull();
    fs.writeFileSync(d, JSON.stringify({ v: 2, model: "B.gguf", envModel: "A.gguf" }));
    expect(docLuaChon(d)).toBeNull();
  });
  it("khôi phục nội dung thô: null ⇒ gỡ tệp; chuỗi ⇒ ghi lại y nguyên", () => {
    const d = duongLuaChon(envMau());
    expect(docNoiDungTho(d)).toBeNull();
    ghiLuaChon(d, { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    const tho = docNoiDungTho(d);
    ghiLuaChon(d, { v: 1, model: "Code.gguf", envModel: "A.gguf", luc: "t2", nguoi: null });
    khoiPhucNoiDungTho(d, tho);
    expect(docLuaChon(d)?.model).toBe("B.gguf");
    khoiPhucNoiDungTho(d, null);
    expect(fs.existsSync(d)).toBe(false);
  });
  it("mặc định nằm NGOÀI repo (LOCALAPPDATA) — dùng chung mọi worktree cùng :8091", () => {
    const d = duongLuaChon({ LOCALAPPDATA: "C:/Users/x/AppData/Local" } as NodeJS.ProcessEnv);
    expect(d.replace(/\\/g, "/")).toBe("C:/Users/x/AppData/Local/avi-aoi-ai/llama-server-lua-chon.json");
  });
});

describe("phủ env — BA khoá", () => {
  it("không có tệp ⇒ nguồn env, không đổi gì", () => {
    const env = envMau();
    const kq = apDungLuaChonModel(env);
    expect(kq.nguon).toBe("env");
    expect(env.LLAMA_SERVER_MODEL).toBe("A.gguf");
  });

  it("có lựa chọn hợp lệ ⇒ phủ ĐÚNG các khoá đang trỏ model server; khoá trỏ model khác giữ nguyên", () => {
    const env = envMau();
    ghiLuaChon(duongLuaChon(env), { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: "admin" });
    const kq = apDungLuaChonModel(env);
    expect(kq.nguon).toBe("lua-chon");
    expect(kq.khoaDaPhu.sort()).toEqual(["GGUF_DEFAULT_MODEL", "LLAMA_SERVER_MODEL"]);
    expect(env.LLAMA_SERVER_MODEL).toBe("B.gguf");
    expect(env.GGUF_DEFAULT_MODEL).toBe("B.gguf");
    expect(env.GGUF_CODE_MODEL).toBe("Code.gguf");
  });

  it("cấu hình MỘT model (code == server) ⇒ phủ cả ba khoá — nếu không, nhãn metrics/audit sai", () => {
    const env = envMau({ GGUF_CODE_MODEL: "A.gguf" });
    ghiLuaChon(duongLuaChon(env), { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    apDungLuaChonModel(env);
    expect(env.GGUF_CODE_MODEL).toBe("B.gguf");
  });

  it(".env sửa SAU lựa chọn ⇒ .env thắng, lựa chọn bị bỏ qua có lý do", () => {
    const env = envMau({ LLAMA_SERVER_MODEL: "Code.gguf", GGUF_DEFAULT_MODEL: "Code.gguf" });
    ghiLuaChon(duongLuaChon(env), { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    const kq = apDungLuaChonModel(env);
    expect(kq.nguon).toBe("lua-chon-bo-qua");
    expect(kq.lyDo).toMatch(/\.env/);
    expect(env.LLAMA_SERVER_MODEL).toBe("Code.gguf");
  });

  it("lựa chọn trỏ tệp không còn trong kho ⇒ bỏ qua", () => {
    const env = envMau();
    ghiLuaChon(duongLuaChon(env), { v: 1, model: "Mat.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    expect(apDungLuaChonModel(env).nguon).toBe("lua-chon-bo-qua");
    expect(env.LLAMA_SERVER_MODEL).toBe("A.gguf");
  });

  it("áp lại sau khi lựa chọn đổi về model .env ⇒ trả env về GỐC (không kẹt giá trị phủ cũ)", () => {
    const env = envMau();
    const d = duongLuaChon(env);
    ghiLuaChon(d, { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    apDungLuaChonModel(env);
    expect(env.LLAMA_SERVER_MODEL).toBe("B.gguf");
    khoiPhucNoiDungTho(d, null);
    const kq = apDungLuaChonModel(env);
    expect(kq.nguon).toBe("env");
    expect(env.LLAMA_SERVER_MODEL).toBe("A.gguf");
    expect(env.GGUF_DEFAULT_MODEL).toBe("A.gguf");
  });

  it("LLAMA_SERVER_MODEL rỗng ⇒ model server suy từ GGUF_DEFAULT_MODEL (cùng thứ tự với kịch bản khởi động)", () => {
    const env = envMau({ LLAMA_SERVER_MODEL: "" });
    ghiLuaChon(duongLuaChon(env), { v: 1, model: "B.gguf", envModel: "A.gguf", luc: "t", nguoi: null });
    const kq = apDungLuaChonModel(env);
    expect(kq.nguon).toBe("lua-chon");
    expect(env.GGUF_DEFAULT_MODEL).toBe("B.gguf");
    expect(env.LLAMA_SERVER_MODEL).toBe("");
  });
});
